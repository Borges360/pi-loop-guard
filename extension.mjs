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
  glob,
  processRun,
} from './lib/core.mjs';
import { relative, resolve } from 'node:path';
import { localeName, localeShell, readProjectLocale, translate, translateText, writeProjectLocale } from './lib/i18n.mjs';
import { Guard, defaults } from './guard.mjs';
import {
  FIELDS,
  POLICY_EFFECT,
  applyField,
  fieldValues,
  panelItems,
  panelTitle,
  incidentLines,
  incidentRows,
  outOfScopeLines,
  effectiveNumbers,
  blockingCandidates,
  runDashboard,
  provideHost,
} from './menu.mjs';

/** Text-command action → table field. One mapping for help, the handler and the panel. */
const FIELD_ACTIONS = {
  policy: 'policy',
  mode: 'mode',
  'tool-repeat': 'toolRepeat',
  'no-progress-turns': 'noProgress',
  quarantine: 'quarantineTtl',
  window: 'windowSize',
  scope: 'scopeSource',
  strict: 'scopeStrict',
};

export default function loopGuard(pi, injected = {}) {
  // The entry point imported the host modules statically and hands them here; a lazy
  // import inside the extension cannot resolve (see index.ts).
  provideHost(injected.tui, injected.agent);
  const rt = createRuntime(pi, 'guard', defaults);
  let guard = new Guard(),
    scope = '',
    shown = new Set(),
    providerFailures = 0,
    plan = false,
    cost = 0,
    outOfScopePaths = [],
    declinedRescue = false,
    diffCache = { key: null, paths: [] };
  const seenCostCalls = new Set();
  const conf = () => rt.config.loopGuard;
  const locked = () => rt.config.locked?.loopGuard ?? {};

  /** Files this session changed, for the scope partition (cached per session leaf). */
  const changedPaths = async (ctx) => {
    const key = `${ctx.sessionManager.getLeafId()}:${conf().relevantPaths?.join(',')}`;
    if (diffCache.key === key) return diffCache.paths;
    let paths = [];
    try {
      const r = await processRun(
        'git',
        ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'],
        { cwd: rt.root },
      );
      if (r.code === 0)
        paths = r.output
          .split('\0')
          .filter((f) => f.length > 3 && f[2] === ' ')
          .map((f) => f.slice(3));
    } catch {
      /* not a git repo: nothing is inferred, and the panel says the counter is unknown */
    }
    diffCache = { key, paths };
    return paths;
  };

  /**
   * The scope of the guard is what it can see. A change outside `relevantPaths` used to
   * be invisible: the streak kept counting and the user only saw "no progress". The
   * partition is explicit now, visible in the panel, and `strict` decides whether an
   * out-of-scope change resets the suspicion (default: it does not).
   *
   * The suite's own state (`.pi/**` and `$PI_SUITE_HOME`) is never progress: counting it
   * would clear every streak the moment the guard wrote its own journal.
   */
  const partition = (paths, c = conf()) => {
    const suite = suiteIgnore()[0];
    const work = paths.filter(
      (p) => !p.startsWith('.pi/') && !(suite && p.startsWith(suite.replace(/\/\*\*$/, '/'))),
    );
    const relevant = c.scope?.source === 'any' ? ['**'] : c.relevantPaths ?? ['**'];
    const inside = work.filter((p) => relevant.some((g) => glob(g, p)));
    const outside = work.filter((p) => !inside.includes(p));
    const relaxed = c.scope?.strict === false;
    return {
      inside,
      outside,
      counted: relaxed ? work : inside,
      reasonCodes: [
        `scope:${c.scope?.source ?? 'relevant'}`,
        `strict:${relaxed ? 'off' : 'on'}`,
        ...(outside.length ? [`out-of-scope:${outside.length}`] : []),
      ],
    };
  };

  const init = async (ctx) => {
    await rt.init(ctx);
    const next = `${rt.projectId}/${scopeOf(ctx).sessionId}/${scopeOf(ctx).taskId ?? 'unattributed'}`;
    if (next !== scope) {
      scope = next;
      guard = new Guard(conf());
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

  /** Paths the suite writes inside the worktree (journal, config) — never progress. */
  const suiteIgnore = () => {
    const home = process.env.PI_SUITE_HOME ?? '';
    if (!home) return [];
    const rel = relative(rt.root ?? '/', resolve(home)).split(String.fromCharCode(92)).join('/');
    return rel && !rel.startsWith('..') ? [`${rel}/**`] : [];
  };

  const repo = async (ctx) => {
    const c = conf();
    const paths = await changedPaths(ctx);
    const part = partition(paths, c);
    outOfScopePaths = part.outside;
    try {
      const s = await snapshot(rt.root, {
        semantic: true,
        // `any`, or `strict: false`, widen what the progress hash looks at; `relevant`
        // with `strict: true` is the pre-0.3 behaviour and the narrow one.
        allowedPaths:
          c.scope?.source === 'any' || c.scope?.strict === false ? ['**'] : c.relevantPaths ?? ['**'],
        // The guard's own journal must never look like repository progress: with
        // PI_SUITE_HOME inside the worktree, every write would clear the streaks and
        // the loop would be invisible.
        ignorePaths: ['.pi/**', ...suiteIgnore()],
      });
      guard.repository(s.workingTreeHash);
    } catch {
      /* no Git proof: no reset inferred */
    }
    return part;
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

  /* ------------------------------------------------------------------ *\n   Rescue: when the guard pauses something, offer the cheapest way to\n   get unstuck, ordered by what actually blocked this session.\n   ------------------------------------------------------------------ */

  /** Signatures currently in quarantine, with the tool name when we know it. */
  const quarantined = () => {
    const now = Date.now();
    const rows = [];
    for (const [key, until] of guard.quarantine) {
      if (until <= now) continue;
      const hit = blockingCandidates(guard.events).find((c) => c.key === key);
      rows.push({
        key,
        until: new Date(until).toISOString(),
        hits: hit?.count ?? 1,
        exempt: (conf().exceptions ?? []).length
          ? ''
          : '',
      });
    }
    return rows;
  };

  /** The tools that produced the most blocks this session — candidates for an exemption. */
  const candidates = (configuration = conf()) => {
    const names = new Map();
    for (const event of guard.events) {
      const name = event?.name ?? null;
      if (name) names.set(name, (names.get(name) ?? 0) + 1);
    }
    const fromEvents = [...names.entries()].sort((a, b) => b[1] - a[1]).map(([tool]) => tool);
    const fallback = ['bash', 'edit', 'write', 'read', 'grep'];
    return [...new Set([...fromEvents, ...fallback])].filter(
      (t) => !(configuration.exceptions ?? []).some((e) => (typeof e === 'string' ? e : e?.tool) === t),
    );
  };

  const panelState = () => ({
    state: guard.state,
    turns: guard.turns,
    count: guard.count,
    signals: guard.signals,
    incident: guard.incident,
    quarantine: quarantined(),
    outOfScope: outOfScopePaths.length,
    outOfScopePaths,
    strict: conf().scope?.strict !== false,
    blockingCandidates: candidates(),
    changedPaths: diffCache.paths.slice(0, 12),
  });

  const writeField = async (ctx, id, value, { quiet = false } = {}) => {
    const { patch, note } = applyField(conf(), id, value, {
      locked: locked(),
      state: panelState(),
    });
    let written = null;
    try {
      written = await rt.save('loopGuard', patch);
    } catch (error) {
      const line = `${note} · aplica só nesta sessão (não foi possível salvar: ${error.message})`;
      if (quiet) return line;
      return output(ctx, line, 'warning');
    }
    // The runtime and live guard change together only after the atomic save succeeds.
    Object.assign(guard.config, conf());
    if (quiet) return note;
    // `rt.save` merged the patch into the live config, so the change is already in
    // effect; telling the user to `/reload` would teach them to distrust it.
    output(ctx, `${note}\nsalvo em ${written} · já em efeito`);
    return note;
  };

  /**
   * Widening an exemption loosens what the guard can catch, so it is two deliberate acts
   * in the panel (and an explicit confirmation in the command), and it is written to the
   * project file, never to the global one.
   */
  let pendingExempt = null;
  const exemptAct = async (ctx, value, { fromCommand = false } = {}) => {
    if (String(value).startsWith('remove:')) return writeField(ctx, 'exceptions', value, { quiet: !fromCommand });
    if (pendingExempt !== value) {
      pendingExempt = value;
      const tool = value.slice(4);
      const line = `⚠ ${tool} NADA foi escrito — isentar essa ferramenta significa que repetição dela nunca mais vira incidente; escolha o mesmo valor de novo para confirmar`;
      if (fromCommand) output(ctx, line, 'warning');
      return line;
    }
    pendingExempt = null;
    return writeField(ctx, 'exceptions', value, { quiet: !fromCommand });
  };

  const releaseOnce = async (ctx, key) => {
    guard.override(key, conf().quarantineTtlSeconds);
    const signed = await rt.store.sign({
      ...scopeOf(ctx),
      signature: key,
      scope: 'task',
      uses: 1,
      expiresAt: new Date(Date.now() + conf().quarantineTtlSeconds * 1000).toISOString(),
      approvedAt: now(),
    });
    await rt.store.append('guard-overrides', { id: uid(), signed });
    await rt.emit('loop.resumed', { signature: key, ttlSeconds: conf().quarantineTtlSeconds });
    return `Released signature once · ${key.slice(0, 12)} · valid for ${conf().quarantineTtlSeconds}s`;
  };

  /**
   * The block reason a user gets mid-run. It names the rescue options in cost order and
   * asks once; a refusal is remembered so the guard does not nag (rule F).
   */
  const askRescue = async (ctx, key) => {
    const rows = candidates();
    if (declinedRescue || !ctx.hasUI || typeof ctx.ui.confirm !== 'function') return null;
    const tool = rows[0];
    const agreed = await ctx.ui.confirm(
      'Guard paused an equivalent call',
      `Choose an alternative: exempt \`${tool ?? 'bash'}\` (▸ recommended — blocked most often this session) or release this signature once. Exempting weakens detection and writes to ${rt.configFile}.`,
    );
    if (!agreed) {
      declinedRescue = true;
      return 'recusado — não será perguntado de novo nesta sessão';
    }
    const useSelect = typeof ctx.ui.select === 'function';
    const choice = useSelect
      ? await ctx.ui.select(
          'Como destravar?',
          [`▸ Recommended: release this signature once`, `exempt ${tool} (persists)`, 'nothing'],
        )
      : 'release';
    if (!choice || /^nothing/.test(choice)) return 'Nothing was changed.';
    if (/exempt/.test(choice)) {
      const note = await exemptAct(ctx, `add:${tool}`, { fromCommand: true });
      return note;
    }
    return releaseOnce(ctx, key);
  };

  pi.on('session_start', async (_e, ctx) => {
    await init(ctx);
    await repo(ctx);
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
    await repo(ctx);
    const d = guard.before(e.toolCallId, e.toolName, e.input, rt.root);
    guard.events.at(-1) && (guard.events[guard.events.length - 1].name = e.toolName);
    if (d.action === 'block') {
      await rt.emit('loop.blocked', {
        incidentId: guard.incident?.id,
        signature: d.key,
        report: guard.report(),
      });
      const rescue = await askRescue(ctx, d.key);
      return {
        block: true,
        reason: `Loop guard pausou ação equivalente (${d.key}). /guard explain mostra os números; /guard resume libera uma vez${rescue ? ` · ${rescue}` : ''}`,
      };
    }
    if (d.action === 'warn' && !shown.has(d.key)) {
      shown.add(d.key);
      await rt.emit('loop.suspected', { signature: d.key, signals: guard.signals });
      output(
        ctx,
        `Repetição equivalente sem progresso verificado (${d.key?.slice(0, 8)}). /guard explain · ou abra /guard`,
        'warning',
      );
    }
  });
  pi.on('tool_result', async (e, ctx) => {
    await init(ctx);
    guard.after(e.toolCallId, e);
    await repo(ctx);
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

  const guardSpec = {
    name: 'guard',
    description: 'Detect repeated work without verified progress',
    actions: {
      status: { hint: '', description: 'state, signals and thresholds' },
      on: { hint: '', description: 'enable detection (warn by default)' },
      off: { hint: '', description: 'stop detecting' },
      warn: { hint: '', description: 'warn only, never block' },
      enforce: { hint: '', description: 'block the repeated equivalent call' },
      policy: {
        hint: 'POLICY',
        description: 'preset; strict also sets Action to enforce',
        args: [{ values: Object.keys(POLICY_EFFECT).map((v) => ({ value: v })), hint: 'policy' }],
      },
      'tool-repeat': {
        hint: 'N',
        description: 'identical calls before suspicion (2..100)',
        args: [{ values: fieldValues('toolRepeat').map((v) => ({ value: v })), hint: 'n' }],
      },
      'no-progress-turns': {
        hint: 'N',
        description: 'turns without verified progress (2..100)',
        args: [{ values: fieldValues('noProgress').map((v) => ({ value: v })), hint: 'n' }],
      },
      quarantine: {
        hint: 'SECONDS',
        description: 'quarantine duration (60/120/600/3600)',
        args: [{ values: fieldValues('quarantineTtl').map((v) => ({ value: v })), hint: 'seg' }],
      },
      window: {
        hint: 'N',
        description: 'history window (25/50/100/200)',
        args: [{ values: fieldValues('windowSize').map((v) => ({ value: v })), hint: 'n' }],
      },
      scope: {
        hint: 'SCOPE',
        description: 'relevant = only relevant paths count · any = any repository change',
        args: [{ values: fieldValues('scopeSource').map((v) => ({ value: v })), hint: 'source' }],
      },
      strict: {
        hint: 'ON|OFF',
        description: 'whether out-of-scope changes block or reset progress',
        args: [{ values: fieldValues('scopeStrict').map((v) => ({ value: v })), hint: 'on|off' }],
      },
      allow: {
        hint: 'TOOL',
        description: 'exempt a tool from detection (weakens it; confirmed in the project file)',
        args: [{ provide: async () => candidates().map((t) => ({ value: t })), hint: 'tool' }],
      },
      unallow: {
        hint: 'TOOL',
        description: 'remove an exemption',
        args: [
          {
            provide: async () =>
              (conf().exceptions ?? []).map((e) => ({
                value: typeof e === 'string' ? e : e?.tool ?? '',
              })),
            hint: 'tool',
          },
        ],
      },
      pause: { hint: '', description: 'pause detection for this session' },
      resume: {
        hint: '[--once]',
        description: 'release one quarantined signature after approval',
        flags: { '--once': { hint: 'single attempt (default)' } },
      },
      explain: { hint: '', description: 'why the last incident fired, with the numbers' },
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

  /** Lines the text panel and the fallback share: state first, commands after. */
  const stateLines = (locale = 'en') => {
    const c = conf();
    const numbers = effectiveNumbers(c);
    const part = partition(diffCache.paths, c);
    return [
      translate(locale, 'stateSummary', { status: c.enabled ? 'ON' : 'off', state: guard.state, mode: numbers.mode, policy: c.policy }),
      translate(locale, 'thresholds', { repeats: numbers.repeatedIdenticalCalls, turns: numbers.noProgressTurns, reasons: numbers.reasonCodes.join(' · ') }),
      translate(locale, 'activity', { turns: guard.turns, repeats: guard.count, signals: (guard.signals ?? []).join(', ') || translate(locale, 'valueIncidentNone') }),
      translate(locale, 'scopeLine', { scope: c.scope?.source ?? 'relevant', strict: c.scope?.strict === false ? translate(locale, 'valueOff') : translate(locale, 'valueOn'), included: part.counted.length, outside: part.outside.length, paths: part.outside.length ? ` → ${part.outside.slice(0, 3).join(', ')}${part.outside.length > 3 ? ' …' : ''}` : '' }),
      translate(locale, 'quarantineLine', { signatures: quarantined().length, exemptions: (c.exceptions ?? []).length }),
    ];
  };

  const fallbackPanel = (ctx, locale = 'en') =>
    output(ctx, [
      ...stateLines(locale),
      '',
      translate(locale, 'noScreen'),
      translate(locale, 'fallbacks'),
    ].join('\n'));

  const openMenu = async (ctx) => {
    const c = conf();
    const state = panelState();
    const trusted = rt.ctx?.isProjectTrusted?.() === true;
    const projectLocale = await readProjectLocale({ root: rt.root, trusted });
    let localeSaved = projectLocale.locale;
    let localeDraft = localeSaved;
    const t = (value) => translateText(localeDraft, value);
    const tr = (key, values) => translate(localeDraft, key, values);
    const items = [
      {
        id: 'language',
        label: tr('language'),
        currentValue: localeName(localeDraft),
        values: [tr('english'), tr('portuguese')],
        description: tr('languageDescription'),
      },
      ...panelItems({ conf: c, locked: locked(), state }),
    ];
    let draft = structuredClone(c);
    let draftPatch = {};
    let pendingPanelExempt = null;
    const changedFields = new Map();
    const fieldTextKeys = {
      enabled: ['fieldDetection', 'hintDetection'],
      policy: ['fieldPolicy', 'hintPolicy'],
      mode: ['fieldAction', 'hintAction'],
      toolRepeat: ['fieldToolRepeat', 'hintToolRepeat'],
      noProgress: ['fieldNoProgress', 'hintNoProgress'],
      quarantineTtl: ['fieldQuarantine', 'hintQuarantine'],
      windowSize: ['fieldHistory', 'hintHistory'],
      scopeSource: ['fieldScope', 'hintScope'],
      scopeStrict: ['fieldScopeStrict', 'hintScopeStrict'],
      exceptions: ['fieldExceptions', 'hintExceptions'],
      relevantPaths: ['fieldRelevantPaths', 'hintRelevantPaths'],
    };
    const stateTextKeys = {
      state: ['stateDetection', 'stateDescription'],
      incident: ['stateIncident', 'incidentDescription'],
      quarantine: ['stateQuarantine', 'quarantineDescription'],
      outOfScope: ['stateOutOfScope', 'outOfScopeDescription'],
      help: ['stateHelp', 'helpDescription'],
    };
    const pendingSavedNotes = [];
    const mergePatch = (target, patch) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          target[key] = mergePatch({ ...(target[key] ?? {}) }, value);
        } else {
          target[key] = structuredClone(value);
        }
      }
      return target;
    };
    const refreshItems = (update) => {
      for (const item of items) {
        if (item.id === 'language') {
          item.label = tr('language');
          item.description = tr('languageDescription');
          item.values = [tr('english'), tr('portuguese')];
          item.currentValue = localeName(localeDraft);
          update?.(item.id, item.currentValue);
          continue;
        }
        const field = FIELDS[item.id];
        const stateKeys = stateTextKeys[item.id];
        if (stateKeys) {
          item.label = tr(stateKeys[0]);
          item.description = item.id === 'state'
            ? tr(stateKeys[1], {
                turns: state.turns ?? 0,
                repeats: state.count ?? 0,
                signals: state.signals?.length ?? 0,
              })
            : tr(stateKeys[1]);
          if (item.id === 'incident') item.currentValue = state.incident ? state.incident.signals.join('+') : tr('valueIncidentNone');
          if (item.id === 'quarantine') item.currentValue = tr('valueActive', { count: state.quarantine?.length ?? 0 });
          if (item.id === 'outOfScope') item.currentValue = tr('valueChanges', { count: state.outOfScope ?? 0 });
        } else if (field) {
          const [labelKey, hintKey] = fieldTextKeys[item.id];
          const value = field.current(draft);
          item.label = tr(labelKey);
          item.currentValue = item.id === 'exceptions'
            ? tr('valueExemptCount', { count: draft.exceptions?.length ?? 0 })
            : item.id === 'relevantPaths'
              ? tr('valuePathCount', { count: (draft.relevantPaths ?? ['**']).length })
              : value;
          let note = '';
          if (item.id === 'enabled') note = tr(value === 'on' ? 'noteDetectionOn' : 'noteDetectionOff');
          else if (item.id === 'policy') {
            const effect = POLICY_EFFECT[value];
            note = tr('notePolicy', {
              policy: value,
              repeat: effect.repeatedIdenticalCalls,
              turns: effect.noProgressTurns,
              mode: effect.mode,
            });
          } else if (item.id === 'mode') note = tr(value === 'enforce' ? 'noteActionEnforce' : 'noteActionWarn');
          else if (item.id === 'toolRepeat') note = tr('noteToolRepeat', { count: value });
          else if (item.id === 'noProgress') note = tr('noteNoProgress', { count: value });
          else if (item.id === 'quarantineTtl') note = tr('noteQuarantine', { seconds: value });
          else if (item.id === 'windowSize') note = tr('noteHistory', { count: value });
          else if (item.id === 'scopeSource') note = tr(value === 'relevant' ? 'noteScopeRelevant' : 'noteScopeAny');
          else if (item.id === 'scopeStrict') note = tr(value === 'on' ? 'noteScopeStrictOn' : 'noteScopeStrictOff');
          const hint = tr(hintKey);
          item.description = note ? `${hint} · ${note}` : hint;
          if (item.id === 'exceptions' && fieldValues(item.id, draft, state).length === 0)
            item.description += ` · ${tr('noExemptionCandidates')}`;
        }
        update?.(item.id, item.currentValue);
      }
    };
    refreshItems();
    const stageField = (id, value, update) => {
      const { patch, note } = applyField(draft, id, value, { locked: locked(), state });
      draft = mergePatch(draft, patch);
      draftPatch = mergePatch(draftPatch, patch);
      changedFields.set(id, note);
      refreshItems(update);
      return { kind: 'draft', note: t(note), count: changedFields.size + Number(localeDraft !== localeSaved) };
    };
    const localizedRows = (rows) => rows.map((row) => ({
      ...row,
      label: t(row.label),
      description: t(row.description),
    }));
    const menus = {
      state: () => stateLines(localeDraft),
      incident: () => incidentLines(guard.report(), c).map(t),
      incidentActions: () => localizedRows(incidentRows(state)),
      outOfScope: () => outOfScopeLines(state).map(t),
      help: () => localeDraft === 'pt-BR'
        ? ['commandStatus', 'commandExplain', 'commandReport', 'commandResume', 'commandPause', 'commandStrategy', 'commandAbort', 'commandConfigure'].map((key) => tr(key))
        : usageText('guard', guardSpec).split('\n'),
      quarantine: () => {
        const rows = quarantined();
        if (!rows.length)
          return [
            {
              value: 'noop',
              label: tr('noQuarantine'),
              description: tr('nothingToRelease'),
            },
          ];
        return rows.map((r, i) => ({
          value: `release:${r.key}`,
          label: tr(i === 0 ? 'releaseRecommended' : 'releasePlain', { key: r.key.slice(0, 12) }),
          description: tr('releaseDescription', { time: r.until.slice(11, 19), hits: r.hits }),
        }));
      },
      exceptions: () => {
        const rows = [];
        for (const [i, e] of (draft.exceptions ?? []).entries())
          rows.push({
            value: `remove:${i}:${typeof e === 'string' ? e : e?.tool}`,
            label: tr('removeExemption', { tool: typeof e === 'string' ? e : e?.tool }),
            description: tr('monitorTool'),
          });
        candidates(draft).forEach((tool, i) =>
          rows.push({
            value: `add:${tool}`,
            label: tr(i === 0 ? 'exemptRecommended' : 'exemptPlain', { tool }),
            description: tr(i === 0 ? 'exemptionTop' : 'exemptionOther'),
          }),
        );
        return rows;
      },
      paths: () => {
        const rows = [];
        for (const [i, p] of (draft.relevantPaths ?? ['**']).entries())
          rows.push({ value: `remove:${i}:${p}`, label: tr('stopCounting', { path: p }), description: tr('noLongerProgress') });
        (state.changedPaths ?? []).forEach((p, i) =>
          rows.push({
            value: `add:${p}`,
            label: tr(i === 0 ? 'countRecommended' : 'countPath', { path: p }),
            description: tr('pathProgress'),
          }),
        );
        return rows;
      },
    };
    const onChange = async (id, value, update) => {
      if (id === 'language') {
        const nextLocale = value === tr('english') ? 'en' : value === tr('portuguese') ? 'pt-BR' : null;
        if (!nextLocale) return { kind: 'action', note: tr('language') };
        localeDraft = nextLocale;
        const languageItem = items.find((item) => item.id === 'language');
        languageItem.values = [tr('english'), tr('portuguese')];
        refreshItems(update);
        return { kind: 'draft', note: tr('chooseLanguage'), count: changedFields.size + Number(localeDraft !== localeSaved) };
      }
      if (id === 'incident') {
        if (value === 'numbers') return { kind: 'action', note: '' };
        if (String(value).startsWith('release:'))
          return { kind: 'action', note: t(await releaseOnce(ctx, value.slice(8))) };
        if (pendingPanelExempt !== value) {
          pendingPanelExempt = value;
          return { kind: 'action', note: tr('noteExemptionAdd', { tool: value.slice(4) }) + ' ' + tr('confirmSame'), level: 'warning' };
        }
        pendingPanelExempt = null;
        return stageField('exceptions', value, update);
      }
      if (id === 'quarantine') {
        if (value === 'noop') return { kind: 'action', note: t('Nothing is quarantined.') };
        return { kind: 'action', note: t(await releaseOnce(ctx, value.slice(8))) };
      }
      if (id === 'exceptions') {
        if (String(value).startsWith('remove:')) return stageField(id, value, update);
        if (pendingPanelExempt !== value) {
          pendingPanelExempt = value;
          return { kind: 'action', note: tr('noteExemptionAdd', { tool: value.slice(4) }) + ' ' + tr('confirmSame'), level: 'warning' };
        }
        pendingPanelExempt = null;
        return stageField(id, value, update);
      }
      if (id === 'help' || id === 'state' || id === 'outOfScope') return { kind: 'action', note: '' };
      return stageField(id, value, update);
    };
    const onSave = async () => {
      const localeChanged = localeDraft !== localeSaved;
      if (changedFields.size === 0 && !localeChanged) return { ok: true, note: tr('noUnsaved') };
      if (changedFields.size) {
        const count = changedFields.size;
        try {
          const written = await rt.save('loopGuard', structuredClone(draftPatch));
          Object.assign(guard.config, conf());
          draft = structuredClone(conf());
          draftPatch = {};
          pendingSavedNotes.push(...[...changedFields.values()].map(t));
          changedFields.clear();
          pendingPanelExempt = null;
          if (localeChanged) {
            try { ctx.ui.notify(tr('savedSummary', { count }), 'info'); } catch { /* panel remains usable */ }
          } else {
            return {
              ok: true,
              note: tr('saved', { count, file: written }),
              summary: tr('savedSummary', { count }),
              changed: [...pendingSavedNotes.splice(0)],
              written,
            };
          }
        } catch (error) {
          return { ok: false, note: tr('saveFailed', { error: String(error?.message ?? error).split('\n')[0] }) };
        }
      }
      if (localeChanged) {
        if (!projectLocale.canPersist || rt.ctx?.isProjectTrusted?.() !== true)
          return { ok: false, note: tr('trustRequired'), partialChanged: pendingSavedNotes.splice(0) };
        try {
          await writeProjectLocale({ root: rt.root, trusted: true, locale: localeDraft });
          localeSaved = localeDraft;
          projectLocale.locale = localeSaved;
          pendingSavedNotes.push(tr('languageSaved', { language: localeName(localeSaved) }));
          return {
            ok: true,
            note: tr('languageSaved', { language: localeName(localeSaved) }),
            summary: tr('savedSummary', { count: pendingSavedNotes.length }),
            changed: [...pendingSavedNotes.splice(0)],
          };
        } catch (error) {
          return { ok: false, note: tr('saveFailed', { error: String(error?.message ?? error).split('\n')[0] }), partialChanged: pendingSavedNotes.splice(0) };
        }
      }
      return { ok: true, note: tr('noUnsaved') };
    };
    const onDiscard = () => {
      pendingPanelExempt = null;
      draft = structuredClone(conf());
      draftPatch = {};
      changedFields.clear();
      localeDraft = localeSaved;
    };
    if (projectLocale.issue === 'invalid') {
      try { ctx.ui.notify(translate(localeDraft, 'invalidLocale'), 'warning'); } catch { /* no UI notification available */ }
    } else if (projectLocale.issue === 'unreadable') {
      try { ctx.ui.notify(translate(localeDraft, 'unreadableLocale'), 'warning'); } catch { /* no UI notification available */ }
    }
    const opened = await runDashboard({
      ctx,
      title: () => translateText(localeDraft, panelTitle(c, state)),
      items,
      onChange,
      onSave,
      onDiscard,
      menus,
      shell: localeShell(() => localeDraft),
    });
    if (opened === false) return fallbackPanel(ctx, localeDraft);
    const changed = opened?.changed?.filter(Boolean) ?? [];
    const actions = (opened?.actions?.filter(Boolean) ?? []).map(t);
    return output(
      ctx,
      changed.length
        ? tr('savedExit', {
            count: changed.length,
            notes: [...changed, ...actions].map((x) => `· ${x}`).join('\n'),
            file: rt.configFile,
          })
        : opened?.discarded
          ? [tr('discardedExit'), ...actions].join('\n')
          : actions.length
            ? actions.join('\n')
            : tr('noChangesExit'),
    );
  };

  pi.registerCommand('guard', {
    description:
      'Progress guard — (vazio abre o painel) | status | on | off | policy | scope | allow | resume | explain | report | help',
    getArgumentCompletions: buildCompletions(guardSpec),
    handler: async (args, ctx) => {
      await init(ctx);
      const argv = words(args);
      // An empty argument list is the panel. With arguments, the same table writes.
      if (!argv.length) return ctx.hasUI ? openMenu(ctx) : fallbackPanel(ctx);
      const [action = 'status', ...rest] = argv;
      if (action === 'help') return output(ctx, usageText('guard', guardSpec));
      const live = conf();
      const lockedField = {
        on: 'enabled',
        off: 'enabled',
        warn: 'mode',
        enforce: 'mode',
        resume: 'quarantineTtlSeconds',
        ...Object.fromEntries(Object.entries(FIELD_ACTIONS).map(([k, f]) => [k, FIELDS[f].lock])),
      }[action];
      if (lockedField && Object.hasOwn(locked(), lockedField))
        throw Error(
          `loopGuard.${lockedField} está travado por política global e não pode ser mudado aqui.`,
        );
      if (action === 'on') return writeField(ctx, 'enabled', 'on');
      if (action === 'off') return writeField(ctx, 'enabled', 'off');
      if (action === 'warn' || action === 'enforce') return writeField(ctx, 'mode', action);
      if (FIELD_ACTIONS[action]) {
        const field = FIELD_ACTIONS[action];
        if (!rest[0] && field !== 'policy')
          throw Error(
            `${action} precisa de um valor.\nUse: ${fieldValues(field, live).join(' | ')}`,
          );
        return writeField(ctx, field, rest[0]);
      }
      if (action === 'allow' || action === 'unallow') {
        if (!rest[0])
          throw Error(
            `${action} precisa de uma ferramenta. Candidatas: ${candidates().slice(0, 5).join(', ') || 'nenhuma'}`,
          );
        const index = (live.exceptions ?? []).findIndex(
          (e) => (typeof e === 'string' ? e : e?.tool) === rest[0],
        );
        if (action === 'unallow' && index < 0)
          throw Error(
            `${rest[0]} não está isenta. Isentas: ${(live.exceptions ?? []).map((e) => (typeof e === 'string' ? e : e?.tool)).join(', ') || 'nenhuma'}`,
          );
        if (
          action === 'allow' &&
          !(await rt.confirm(
            ctx,
            'Isentar a detecção desta ferramenta?',
            `${rest[0]} deixa de ser observada; repetição dela nunca mais vira incidente. Isto escreve em ${rt.configFile} (arquivo do projeto).`,
          ))
        )
          throw Error(`Não autorizado — nada foi escrito. Repita: /guard allow ${rest[0]}`);
        const value =
          action === 'allow' ? `add:${rest[0]}` : `remove:${index}:${rest[0]}`;
        const note = await exemptAct(ctx, value, { fromCommand: true });
        return output(ctx, `${note} · salvo em ${rt.configFile} · já em efeito`);
      }
      if (action === 'pause') guard.pause();
      else if (action === 'resume') {
        const key = guard.incident?.key ?? guard.events.at(-1)?.key;
        if (!key) throw Error('Nenhuma assinatura pausada — nada a liberar.');
        if (!(await rt.confirm(ctx, 'Allow one guarded retry?', key)))
          throw Error(
            'Human approval required; abra /guard (painel) e escolha "liberar …" ou repita /guard resume',
          );
        const note = await releaseOnce(ctx, key);
        output(ctx, note);
      } else if (action === 'abort') {
        guard.abort();
        ctx.abort();
      } else if (action === 'change-strategy') {
        guard.reset();
        await rt.emit('loop.strategy_changed', {});
      } else if (action === 'escalate') {
        await rt.emit('loop.escalation_requested', { verified: false });
      } else if (action === 'explain') {
        return output(ctx, incidentLines(guard.report(), live).join('\n'));
      } else if (action === 'report' && rest.includes('--task')) {
        const t = rest[rest.indexOf('--task') + 1];
        return output(
          ctx,
          (await rt.store.rows('audit'))
            .filter((e) => e.taskId === t && e.kind.startsWith('loop.'))
            .slice(-50),
        );
      } else if (!['status', 'report'].includes(action))
        throw Error(`Unknown /guard ${action}\n${usageText('guard', guardSpec)}`);
      if (action === 'status') return output(ctx, stateLines().join('\n'));
      await save(ctx);
      return output(ctx, guard.report());
    },
  });
}
