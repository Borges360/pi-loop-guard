import {
  createRuntime,
  scopeOf,
  snapshot,
  output,
  usageText,
  buildCompletions,
  words,
  uid,
  now,
} from './lib/core.mjs';
import { Guard, defaults } from './guard.mjs';
export default function loopGuard(pi) {
  const rt = createRuntime(pi, 'guard', defaults);
  let guard = new Guard(),
    scope = '',
    shown = new Set(),
    providerFailures = 0,
    plan = false,
    cost = 0;
  const seenCostCalls = new Set();
  const init = async (ctx) => {
    await rt.init(ctx);
    const next = `${rt.projectId}/${scopeOf(ctx).sessionId}/${scopeOf(ctx).taskId ?? 'unattributed'}`;
    if (next !== scope) {
      scope = next;
      guard = new Guard(rt.config.loopGuard);
      shown.clear();
      seenCostCalls.clear();
      providerFailures = 0;
      cost = 0;
      const ids = new Set(ctx.sessionManager.getBranch().map((e) => e.id));
      const rows = await rt.store.rows('guard-state');
      const last = rows
        .filter(
          (r) =>
            r.sessionId === scopeOf(ctx).sessionId &&
            r.taskId === scopeOf(ctx).taskId &&
            (!r.anchorId || ids.has(r.anchorId)),
        )
        .at(-1);
      if (last) {
        guard.state = last.state;
        guard.turns = last.turns;
        guard.streaks = new Map(last.streaks ?? []);
        guard.quarantine = new Map(last.quarantine ?? []);
        guard.snapshot = last.snapshot;
      }
    }
  };
  const repo = async () => {
    try {
      const s = await snapshot(rt.root, {
        semantic: true,
        allowedPaths: rt.config.loopGuard.relevantPaths ?? ['**'],
        ignorePaths: ['.pi/**'],
      });
      guard.repository(s.workingTreeHash);
    } catch {
      /* no Git proof: no reset inferred */
    }
  };
  const save = (ctx) =>
    rt.store.append('guard-state', {
      id: uid(),
      ...scopeOf(ctx),
      anchorId: ctx.sessionManager.getLeafId(),
      state: guard.state,
      turns: guard.turns,
      streaks: [...guard.streaks],
      quarantine: [...guard.quarantine],
      snapshot: guard.snapshot,
    });
  pi.on('session_start', async (_e, ctx) => {
    await init(ctx);
    await repo();
  });
  const unsub = rt.listen(async (e) => {
    if (e.kind === 'gate.evaluated' && e.payload.verified) {
      for (const id of e.payload.evidenceIds ?? [])
        guard.observeProof({ verified: true, evidenceId: id, signal: 'new-check' });
    }
    if (e.kind === 'model.call_completed') {
      const p = e.payload;
      const key = String(p.callId ?? e.id).startsWith(p.provider + '/')
        ? p.callId
        : `${p.provider}/${p.callId ?? e.id}`;
      if (!seenCostCalls.has(key)) {
        seenCostCalls.add(key);
        cost += p.observedCostUsd ?? p.estimatedCostUsd ?? p.estimatedCost ?? 0;
        guard.cost = cost;
      }
    }
  });
  pi.on('tool_call', async (e, ctx) => {
    await init(ctx);
    await repo();
    const d = guard.before(e.toolCallId, e.toolName, e.input, rt.root);
    if (d.action === 'block') {
      await rt.emit('loop.blocked', {
        incidentId: guard.incident?.id,
        signature: d.key,
        report: guard.report(),
      });
      return {
        block: true,
        reason: `Loop guard paused equivalent action (${d.key}). /guard explain or /guard resume --once`,
      };
    }
    if (d.action === 'warn' && !shown.has(d.key)) {
      shown.add(d.key);
      await rt.emit('loop.suspected', { signature: d.key, signals: guard.signals });
      output(
        ctx,
        'Repeated equivalent action without verified progress. /guard explain',
        'warning',
      );
    }
  });
  pi.on('tool_result', async (e, ctx) => {
    await init(ctx);
    guard.after(e.toolCallId, e);
    await repo();
  });
  pi.on('message_end', async (e) => {
    if (e.message.role === 'assistant') {
      if (['error', 'aborted'].includes(e.message.stopReason)) providerFailures++;
      else providerFailures = 0;
      plan = e.message.content.some(
        (c) => c.type === 'text' && /\b(plan|plano|steps|etapas)\b/i.test(c.text),
      );
    }
  });
  pi.on('turn_end', async (_e, ctx) => {
    await init(ctx);
    const report = guard.turn({ cost, plan, providerFailure: providerFailures >= 3 });
    await save(ctx);
    if (report.state === 'intervention') await rt.emit('loop.suspected', report);
  });
  pi.on('agent_before_settle', async (_e, ctx) => {
    if (guard.incident && !shown.has(guard.incident.id)) {
      shown.add(guard.incident.id);
      output(
        ctx,
        { guard: guard.state, incidentId: guard.incident.id, options: guard.incident.actions },
        'warning',
      );
    } /* never request continuation */
  });
  pi.on('session_tree', async (_e, ctx) => {
    scope = '';
    await init(ctx);
  });
  pi.on('session_shutdown', async () => {
    unsub?.();
    await rt.dispose();
  });
  const POLICIES = [
    { value: 'conservative', description: 'warn late, almost never blocks' },
    { value: 'balanced', description: 'default thresholds, warn only' },
    { value: 'strict', description: 'early warnings and blocks repeated no-progress calls' },
  ];
  const LIMITS = [
    { value: 'tool-repeat', description: 'identical calls allowed before suspicion' },
    {
      value: 'no-progress-turns',
      description: 'turns without verified progress before suspicion',
    },
  ];
  const POLICY_IDS = POLICIES.map((p) => p.value);
  const LIMIT_IDS = LIMITS.map((l) => l.value);
  const guardSpec = {
    name: 'guard',
    description: 'Detect repeated work without verified progress',
    actions: {
      status: { hint: '', description: 'state, signals and thresholds' },
      on: { hint: '', description: 'enable detection (warn by default)' },
      off: { hint: '', description: 'stop detecting' },
      warn: { hint: '', description: 'warn only, never block' },
      enforce: { hint: '', description: 'block the 4th equivalent call' },
      policy: {
        hint: 'POLICY',
        description: 'preset; strict turns on enforce',
        args: [{ values: POLICIES, hint: 'policy' }],
      },
      limits: {
        hint: 'LIMIT N',
        description: 'tune one threshold (2..100)',
        args: [
          { values: LIMITS, hint: 'limit', advance: true },
          {
            values: [3, 4, 5, 8].map(String).map((v) => ({ value: v, description: 'integer 2..100' })),
            hint: 'count',
          },
        ],
      },
      pause: { hint: '', description: 'pause detection for this session' },
      resume: {
        hint: '[--once]',
        description: 'release one quarantined signature after approval',
        flags: { '--once': { hint: 'single attempt (default)' } },
      },
      explain: { hint: '', description: 'why the last incident fired' },
      report: {
        hint: '[--task ID]',
        description: 'incident history',
        flags: { '--task': { hint: 'task id' } },
      },
      'change-strategy': { hint: '', description: 'clear streaks and take a different approach' },
      escalate: { hint: '', description: 'ask for human intervention' },
      abort: { hint: '', description: 'abort the current run' },
      help: { hint: '', description: 'show this list' },
    },
  };
  pi.registerCommand('guard', {
    description:
      'Progress guard — status | on | off | policy | limits | pause | resume | explain | report | help',
    getArgumentCompletions: buildCompletions(guardSpec),
    handler: async (args, ctx) => {
      await init(ctx);
      const [action = 'status', ...rest] = words(args);
      const c = guard.config;
      const locked = rt.config.locked?.loopGuard ?? {};
      // A locked policy must say which knob, not just "locked".
      const lockedField = {
        on: 'enabled',
        off: 'enabled',
        warn: 'mode',
        enforce: 'mode',
        policy: 'policy',
        limits: 'repeatedIdenticalCalls',
      }[action];
      if (lockedField && Object.hasOwn(locked, lockedField))
        throw Error(`loopGuard.${lockedField} is locked by global policy and cannot be changed here.`);
      // Persisting keeps the setting after a reload; the Guard owns the live copy.
      const persist = async (patch) => {
        try {
          return await rt.save('loopGuard', patch);
        } catch (e) {
          output(
            ctx,
            `Applies to this session only — could not save: ${e.message}`,
            'warning',
          );
        }
      };
      if (action === 'help') return output(ctx, usageText('guard', guardSpec));
      if (action === 'on') {
        c.enabled = true;
        await persist({ enabled: true });
      } else if (action === 'off') {
        c.enabled = false;
        await persist({ enabled: false });
      } else if (action === 'warn' || action === 'enforce') {
        c.mode = action;
        await persist({ mode: action });
      } else if (action === 'policy') {
        if (!POLICY_IDS.includes(rest[0]))
          throw Error(`Invalid policy. Use: ${POLICY_IDS.join(' | ')}`);
        c.policy = rest[0];
        c.mode = rest[0] === 'strict' ? 'enforce' : 'warn';
        await persist({ policy: rest[0], mode: c.mode });
      } else if (action === 'limits') {
        const value = Number(rest[1]);
        if (!Number.isInteger(value) || value < 2 || value > 100)
          throw Error(
            `Limit must be an integer 2..100. Current: ${rest[0]} = ${c[rest[0] === 'tool-repeat' ? 'repeatedIdenticalCalls' : 'noProgressTurns'] ?? '?'}`,
          );
        if (rest[0] === 'tool-repeat') {
          c.repeatedIdenticalCalls = value;
          await persist({ repeatedIdenticalCalls: value });
        } else if (rest[0] === 'no-progress-turns') {
          c.noProgressTurns = value;
          await persist({ noProgressTurns: value });
        } else throw Error(`Unknown limit. Use: ${LIMIT_IDS.join(' | ')}`);
      } else if (action === 'pause') guard.pause();
      else if (action === 'resume') {
        const key = guard.incident?.key ?? guard.events.at(-1)?.key;
        if (!key) throw Error('No paused signature');
        if (!(await rt.confirm(ctx, 'Allow one guarded retry?', key)))
          throw Error('Human approval required');
        guard.override(key, c.quarantineTtlSeconds);
        const signed = await rt.store.sign({
          ...scopeOf(ctx),
          signature: key,
          scope: 'task',
          uses: 1,
          expiresAt: new Date(Date.now() + c.quarantineTtlSeconds * 1000).toISOString(),
          approvedAt: now(),
        });
        await rt.store.append('guard-overrides', { id: uid(), signed });
        await rt.emit('loop.resumed', { signature: key, ttlSeconds: c.quarantineTtlSeconds });
      } else if (action === 'abort') {
        guard.abort();
        ctx.abort();
      } else if (action === 'change-strategy') {
        guard.reset();
        await rt.emit('loop.strategy_changed', {});
      } else if (action === 'escalate') {
        await rt.emit('loop.escalation_requested', { verified: false });
      } else if (action === 'report' && rest.includes('--task')) {
        const t = rest[rest.indexOf('--task') + 1];
        return output(
          ctx,
          (await rt.store.rows('audit'))
            .filter((e) => e.taskId === t && e.kind.startsWith('loop.'))
            .slice(-50),
        );
      } else if (!['status', 'explain', 'report'].includes(action))
        throw Error(`Unknown /guard ${action}\n${usageText('guard', guardSpec)}`);
      await save(ctx);
      output(ctx, guard.report());
    },
  });
}
