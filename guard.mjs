import { hash, redact, uid, glob } from './lib/core.mjs';
export const defaults = {
  loopGuard: {
    enabled: true,
    mode: 'warn',
    policy: 'balanced',
    repeatedIdenticalCalls: 4,
    noProgressTurns: 5,
    quarantineTtlSeconds: 120,
    windowSize: 50,
    exceptions: [],
  },
};
export const digest = hash;
export const isTest = (name, input) =>
  ['bash', 'powershell'].includes(name) && /\b(test|pytest|verify)\b/.test(input?.command ?? '');
export class Guard {
  constructor(config = defaults.loopGuard, clock = () => Date.now()) {
    this.config = { ...defaults.loopGuard, ...config };
    this.clock = clock;
    this.pending = new Map();
    this.completed = new Set();
    this.streaks = new Map();
    this.quarantine = new Map();
    this.overrides = new Map();
    this.events = [];
    this.state = 'normal';
    this.incident = null;
    this.turns = 0;
    this.progress = new Set();
    this.signals = [];
    this.count = 0;
    this.snapshot = null;
  }
  fingerprint(name, input, cwd) {
    return hash({ name, input: redact(input), cwd });
  }
  exempt(name, input) {
    return (
      ['read', 'find', 'grep', 'ls', 'tool_search'].includes(name) ||
      this.config.exceptions.some(
        (e) =>
          typeof e === 'object' &&
          glob(e.tool ?? '*', name) &&
          (!e.command || glob(e.command, input?.command ?? '')) &&
          (!e.expiresAt || Date.parse(e.expiresAt) > this.clock()),
      )
    );
  }
  before(id, name, input, cwd, enforce = this.config.mode === 'enforce') {
    if (!this.config.enabled || this.exempt(name, input)) return { action: 'allow' };
    const key = this.fingerprint(name, input, cwd),
      stamp = this.clock();
    const permit = this.overrides.get(key);
    if (permit && permit.until > stamp && permit.remaining > 0) {
      permit.remaining--;
      this.pending.set(id, { key, name, duplicate: false });
      return { action: 'allow', override: true, key };
    }
    if (this.state === 'aborted' || (this.state === 'paused' && this.manualPause))
      return { action: enforce ? 'block' : 'warn', key };
    if ((this.quarantine.get(key) ?? 0) > stamp) return { action: enforce ? 'block' : 'warn', key };
    const streak = this.streaks.get(key);
    this.count = streak?.count ?? 0;
    if (
      streak?.count >= this.config.repeatedIdenticalCalls - 1 &&
      this.config.policy !== 'conservative'
    ) {
      this.state = enforce ? 'paused' : 'warn';
      this.quarantine.set(key, stamp + this.config.quarantineTtlSeconds * 1000);
      this.incident ??= {
        id: uid(),
        key,
        at: stamp,
        signals: ['tool_fingerprint_repeat', 'result_fingerprint_repeat', 'no_repository_change'],
        actions: ['resume', 'change-strategy', 'escalate', 'abort'],
      };
      if (enforce) return { action: 'block', key, incident: this.incident };
    }
    const duplicate = [...this.pending.values()].some((p) => p.key === key);
    this.pending.set(id, { key, name, duplicate });
    return { action: streak?.count >= 2 && !duplicate ? 'warn' : 'allow', key };
  }
  after(id, result) {
    if (this.completed.has(id)) return;
    this.completed.add(id);
    const pending = this.pending.get(id);
    this.pending.delete(id);
    if (!pending || pending.duplicate) return;
    const key = pending.key;
    const fingerprint = hash({
      error: result.isError,
      exitCode: result.structuredContent?.exit_code ?? result.details?.exitCode ?? null,
      result: redact(
        result.content
          ?.filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('') ?? '',
      ),
    });
    const previous = this.streaks.get(key);
    const count = previous?.result === fingerprint ? previous.count + 1 : 1;
    this.streaks.set(key, { count, result: fingerprint, error: result.isError });
    this.count = count;
    this.events.push({
      id,
      key,
      at: this.clock(),
      error: result.isError,
      resultFingerprint: fingerprint,
    });
    this.events = this.events.slice(-this.config.windowSize);
    if (count >= 2) this.state = 'watch';
    if (count >= 3) this.state = 'warn';
    if (result.isError && count >= 3) this.signals.push('error_churn');
  }
  observeProof(proof) {
    if (!proof?.verified || !proof.evidenceId || this.progress.has(proof.evidenceId)) return false;
    this.progress.add(proof.evidenceId);
    this.reset();
    return true;
  }
  repository(next) {
    if (this.snapshot !== null && next !== this.snapshot)
      this.observeProof({ verified: true, evidenceId: next, signal: 'relevant-diff' });
    this.snapshot = next;
  }
  turn({ passingIds = [], cost = 0, plan = false, providerFailure = false } = {}) {
    let progress = false;
    for (const id of passingIds)
      progress =
        this.observeProof({ verified: true, evidenceId: `check:${id}`, signal: 'new-check' }) ||
        progress;
    if (!progress) this.turns++;
    this.signals = [
      ...new Set([
        ...this.signals,
        ...(this.turns >= this.config.noProgressTurns
          ? ['low_acceptance_progress', 'no_repository_change']
          : []),
        ...(cost > 0 && this.turns >= this.config.noProgressTurns ? ['budget_burn'] : []),
        ...(plan && this.turns >= 3 ? ['plan_churn'] : []),
        ...(providerFailure ? ['provider_failure_loop'] : []),
      ]),
    ];
    if (this.turns >= this.config.noProgressTurns) {
      this.state = 'intervention';
      this.incident ??= {
        id: uid(),
        at: this.clock(),
        signals: this.signals,
        actions: ['change-strategy', 'escalate', 'abort'],
      };
    }
    return this.report();
  }
  reset() {
    this.streaks.clear();
    this.quarantine.clear();
    this.turns = 0;
    this.signals = [];
    this.count = 0;
    this.state = 'normal';
    this.incident = null;
    this.manualPause = false;
  }
  override(key, ttlSeconds) {
    this.overrides.set(key, { until: this.clock() + ttlSeconds * 1000, remaining: 1 });
    this.state = 'resumed';
    this.manualPause = false;
  }
  pause() {
    this.state = 'paused';
    this.manualPause = true;
    this.incident ??= {
      id: uid(),
      at: this.clock(),
      signals: ['user-pause'],
      actions: ['resume', 'abort'],
    };
  }
  abort() {
    this.state = 'aborted';
  }
  report() {
    return {
      state: this.state,
      mode: this.config.mode,
      signals: this.signals,
      count: this.count,
      noProgressTurns: this.turns,
      incident: this.incident,
      lastActions: this.events.slice(-10),
      cost: this.cost ?? null,
    };
  }
}
