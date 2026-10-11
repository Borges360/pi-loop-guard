import { createRuntime, scopeOf, snapshot, output, words, uid, now } from './lib/core.mjs';
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
  pi.registerCommand('guard', {
    description:
      'Progress guard: status | on/off | policy | limits | pause | resume --once | explain | report',
    handler: async (args, ctx) => {
      await init(ctx);
      const [action = 'status', ...rest] = words(args);
      const c = guard.config;
      const locked = rt.config.locked?.loopGuard ?? {};
      if (
        ['on', 'off', 'warn', 'enforce', 'policy', 'limits'].includes(action) &&
        Object.keys(locked).length
      )
        throw Error('Loop guard settings are locked by global policy');
      if (action === 'on') c.enabled = true;
      else if (action === 'off') c.enabled = false;
      else if (action === 'warn' || action === 'enforce') c.mode = action;
      else if (action === 'policy') {
        if (!['conservative', 'balanced', 'strict'].includes(rest[0]))
          throw Error('Invalid policy');
        c.policy = rest[0];
        c.mode = rest[0] === 'strict' ? 'enforce' : 'warn';
      } else if (action === 'limits') {
        const value = Number(rest[1]);
        if (!Number.isInteger(value) || value < 2 || value > 100)
          throw Error('Limit must be 2..100');
        if (rest[0] === 'tool-repeat') c.repeatedIdenticalCalls = value;
        else if (rest[0] === 'no-progress-turns') c.noProgressTurns = value;
        else throw Error('Unknown limit');
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
        throw Error('Unknown /guard command');
      await save(ctx);
      output(ctx, guard.report());
    },
  });
}
