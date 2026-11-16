/**
 * The `/guard` panel.
 *
 * Detection is a set of dials, and the interesting question is always the same one:
 * "what is it watching right now, and why did that incident fire?". The screen answers
 * that first (state, incident, quarantined signatures) and then lets every dial be moved
 * in place. Configuration edits stay in a draft until the user explicitly saves.
 *
 * The rows come from `FIELDS`, one exported table (rule B): the panel has no private
 * copy of any value list, because that duplication is what shipped a `selected-as` bug in
 * the economist — the row offered the declared default, the writer rejected it, nothing
 * was saved, and the fake agreed with the row instead of with the writer.
 *
 * The host modules are **not** imported here: `index.ts` imports them statically and
 * hands them over through `provideHost()`. A dynamic `await import()` from inside an
 * extension is resolved by Node and dies with `ERR_MODULE_NOT_FOUND`.
 */
import { defaults } from './guard.mjs';

/** Presets, and the knob each one actually moves (rule: a preset that also flips `mode` must say so). */
export const POLICY_EFFECT = {
  conservative: { mode: 'warn', repeatedIdenticalCalls: 6, noProgressTurns: 8 },
  balanced: { mode: 'warn', repeatedIdenticalCalls: 4, noProgressTurns: 5 },
  strict: { mode: 'enforce', repeatedIdenticalCalls: 3, noProgressTurns: 4 },
};

/** The one table. `patch` returns keys of `loopGuard`; `lock` names the key a policy can freeze. */
export const FIELDS = {
  enabled: {
    label: 'Detection',
    lock: 'enabled',
    values: ['on', 'off'],
    current: (c) => (c.enabled ? 'on' : 'off'),
    patch: (v) => ({ enabled: v === 'on' }),
    note: (v) => (v === 'on' ? 'detection enabled' : 'detection disabled — nothing is blocked or recorded'),
    hint: 'on watches tool calls; off watches only for silence',
  },
  policy: {
    label: 'Policy',
    lock: 'policy',
    values: Object.keys(POLICY_EFFECT),
    current: (c) => c.policy ?? 'balanced',
    // A preset that also moves `mode` has to write both, or the screen shows a preset
    // whose blocking behaviour is whatever was left over from before.
    patch: (v) => ({ policy: v, mode: POLICY_EFFECT[v].mode }),
    note: (v) =>
      `policy ${v} · ${POLICY_EFFECT[v].repeatedIdenticalCalls} identical calls and ${POLICY_EFFECT[v].noProgressTurns} turns without progress · mode → ${POLICY_EFFECT[v].mode}`,
    hint: 'sensitivity preset; conservative never blocks, strict blocks',
  },
  mode: {
    label: 'Action',
    lock: 'mode',
    values: ['warn', 'enforce'],
    current: (c) => c.mode ?? 'warn',
    patch: (v) => ({ mode: v }),
    note: (v) => (v === 'enforce' ? '⚠ the 3rd/4th equivalent call is BLOCKED' : 'warn only; nothing is blocked'),
    hint: 'warn reports; enforce blocks repeated equivalent calls',
  },
  toolRepeat: {
    label: 'Identical calls before suspicion',
    lock: 'repeatedIdenticalCalls',
    values: ['3', '4', '5', '6', '8'],
    current: (c) => String(c.repeatedIdenticalCalls ?? 4),
    patch: (v) => ({ repeatedIdenticalCalls: Number(v) }),
    note: (v) => `suspect after ${v} identical calls`,
    hint: '2..100 · lower values detect sooner and may raise false positives',
  },
  noProgress: {
    label: 'Turns without progress',
    lock: 'noProgressTurns',
    values: ['3', '4', '5', '8', '12'],
    current: (c) => String(c.noProgressTurns ?? 5),
    patch: (v) => ({ noProgressTurns: Number(v) }),
    note: (v) => `intervene after ${v} turns without evidence`,
    hint: 'progress = relevant diff or gate evidence',
  },
  quarantineTtl: {
    label: 'Quarantine duration',
    lock: 'quarantineTtlSeconds',
    values: ['60', '120', '600', '3600'],
    current: (c) => String(c.quarantineTtlSeconds ?? 120),
    patch: (v) => ({ quarantineTtlSeconds: Number(v) }),
    note: (v) => `signature is eligible again after ${v}s`,
    hint: 'how long a signature stays out after `/guard resume`',
  },
  windowSize: {
    label: 'History window',
    lock: 'windowSize',
    values: ['25', '50', '100', '200'],
    current: (c) => String(c.windowSize ?? 50),
    patch: (v) => ({ windowSize: Number(v) }),
    note: (v) => `keeps ${v} events`,
    hint: 'affects only this session’s streak history',
  },
  scopeSource: {
    label: 'Progress scope',
    lock: 'scope',
    values: ['relevant', 'any'],
    current: (c) => c.scope?.source ?? 'relevant',
    patch: (v) => ({ scope: { source: v } }),
    note: (v) =>
      v === 'relevant'
        ? 'only changes under `Relevant paths` count as progress'
        : 'any repository change counts as progress (detects fewer loops)',
    hint: 'what this session considers forward progress',
  },
  scopeStrict: {
    label: 'Out-of-scope changes count',
    lock: 'scope',
    values: ['on', 'off'],
    current: (c) => (c.scope?.strict === false ? 'off' : 'on'),
    patch: (v) => ({ scope: { strict: v === 'on' } }),
    note: (v) =>
      v === 'on'
        ? 'out-of-scope changes are shown and do not reset suspicion'
        : 'out-of-scope changes also reset suspicion — progress checks are broader',
    hint: 'on keeps detection narrow; off broadens it and shows a notice',
  },
  exceptions: {
    label: 'Exempt tools',
    lock: 'exceptions',
    kind: 'list',
    listKey: 'exceptions',
    // The table owns the shape; the candidates come from what the session actually hit.
    accepts: (v) => /^(add|remove):[\w.:@*\/-]{1,64}$/.test(String(v)),
    values: (c, state = {}) => [
      ...(c.exceptions ?? []).map((e, i) => `remove:${i}:${toolOf(e)}`),
      ...(state.blockingCandidates ?? []).filter((t) => !isExempt(c, t)).map((t) => `add:${t}`),
    ],
    current: (c) => `${(c.exceptions ?? []).length} exempt`,
    patch: (v, c) => {
      const list = c.exceptions ?? [];
      if (String(v).startsWith('remove:')) {
        const [, index] = String(v).split(':');
        return { exceptions: list.filter((_, i) => i !== Number(index)) };
      }
      const tool = v.slice(4);
      return { exceptions: [...list, { tool }] };
    },
    note: (v) =>
      String(v).startsWith('add:')
        ? `⚠ exemption: ${v.slice(4)} will no longer be monitored — repeats will not trigger an incident`
        : `exemption for ${nameOf(v)} removed`,
    hint: 'weakens detection; choose the same row twice to confirm',
  },
  relevantPaths: {
    label: 'Relevant paths',
    lock: 'relevantPaths',
    kind: 'list',
    listKey: 'relevantPaths',
    accepts: (v) => /^(add|remove):[\w.*\/@-]{1,120}$/.test(String(v)),
    values: (c, state = {}) => [
      ...(c.relevantPaths ?? []).map((p, i) => `remove:${i}:${p}`),
      ...(state.changedPaths ?? [])
        .filter((p) => !(c.relevantPaths ?? []).includes(p))
        .map((p) => `add:${p}`),
    ],
    current: (c) => `${(c.relevantPaths ?? ['**']).length} path(s)`,
    patch: (v, c) => {
      const list = c.relevantPaths ?? ['**'];
      if (String(v).startsWith('remove:')) {
        const [, index] = String(v).split(':');
        return { relevantPaths: list.filter((_, i) => i !== Number(index)) };
      }
      return { relevantPaths: [...list, v.slice(4)] };
    },
    note: (v) =>
      String(v).startsWith('add:')
        ? `${v.slice(4)} now counts as progress`
        : `${nameOf(v)} no longer counts as progress`,
    hint: 'defines what detection watches; a narrower scope can cause false no-progress signals',
  },
};

const toolOf = (e) => (typeof e === 'string' ? e : e?.tool ?? '?');
const nameOf = (value) => String(value).split(':').slice(2).join(':');
const isExempt = (conf, tool) => (conf.exceptions ?? []).some((e) => toolOf(e) === tool);

export const c0 = () => defaults.loopGuard;

/** Value list of a field, always through the table (never a copy of it). */
export function fieldValues(id, conf = c0(), state = {}) {
  const field = FIELDS[id];
  if (!field) throw Error(`campo desconhecido: ${id}`);
  return typeof field.values === 'function' ? field.values(conf ?? c0(), state) : field.values;
}

/** The single writer for both paths: lock, membership, patch. */
export function applyField(conf, id, value, { locked = {}, state = {} } = {}) {
  const field = FIELDS[id];
  if (!field) throw Error(`campo desconhecido: ${id}`);
  if (Object.hasOwn(locked, field.lock))
    throw Error(`loopGuard.${field.lock} está travado por política global.`);
  const allowed = fieldValues(id, conf, state);
  if (!allowed.includes(value) && !(field.accepts?.(value) ?? false))
    throw Error(`Invalid ${id}: ${value}\nUse: ${allowed.join(' | ') || '(nada a oferecer agora)'}`);
  return { patch: field.patch(value, conf), note: field.note(value, conf), id, value };
}

/** Enum rows, derived from the table, in table order, minus the locked keys. */
export function enumItems({ conf, locked = {} }) {
  return Object.entries(FIELDS)
    .filter(([, field]) => field.kind !== 'list')
    .filter(([id]) => !Object.hasOwn(locked, FIELDS[id].lock))
    .map(([id, field]) => ({
      id,
      label: field.label,
      currentValue: field.current(conf),
      values: fieldValues(id, conf),
      description: `${field.hint} · ${field.note(field.current(conf), conf)}`,
    }));
}

/** List rows (the two fields that are membership, not scalars). */
export function listItems(conf, { locked = {}, state = {} } = {}) {
  return Object.entries(FIELDS)
    .filter(([, field]) => field.kind === 'list')
    .filter(([id]) => !Object.hasOwn(locked, FIELDS[id].lock))
    .map(([id, field]) => ({
      id,
      label: field.label,
      currentValue: field.current(conf),
      submenu: true,
      description: fieldValues(id, conf, state).length
        ? field.hint
        : `${field.hint} · nada pendente: /guard allow <tool>`,
    }));
}

/** State rows: what the guard is doing, not what it is configured to do. */
export function stateItems(state) {
  return [
    {
      id: 'state',
      label: 'Detection state',
      currentValue: state.state ?? 'normal',
      submenu: true,
      description: `${state.turns ?? 0} turn(s) without progress · ${state.count ?? 0} repeat(s) · ${state.signals?.length ?? 0} signal(s)`,
    },
    {
      id: 'incident',
      label: 'Latest incident',
      currentValue: state.incident ? state.incident.signals.join('+') : 'none',
      submenu: true,
      description: 'why it fired, with the effective thresholds that blocked the call',
    },
    {
      id: 'quarantine',
      label: 'Quarantined signatures',
      currentValue: `${state.quarantine?.length ?? 0} active`,
      submenu: true,
      description: 'release once is the only way to retry what the guard paused',
    },
    {
      id: 'outOfScope',
      label: 'Out-of-scope changes',
      currentValue: `${state.outOfScope ?? 0} change(s)`,
      submenu: true,
      description: 'changes that did not count — a source of false no-progress signals',
    },
    {
      id: 'help',
      label: 'Command-line help',
      currentValue: '—',
      submenu: true,
      description: 'direct commands remain available with autocomplete',
    },
  ];
}

export function panelItems({ conf, locked = {}, state }) {
  return [
    ...stateItems(state),
    ...listItems(conf, { locked, state }),
    ...enumItems({ conf, locked }),
  ];
}

export function panelTitle(conf, state) {
  return [
    'Guard',
    conf.enabled ? 'ON' : 'off',
    conf.mode,
    `${state.state ?? 'normal'}`,
    `${state.turns ?? 0}/${conf.noProgressTurns ?? 5} turns`,
    `${state.outOfScope ?? 0} out of scope`,
  ].join(' · ');
}

/** The numbers that actually bind, after the preset. Shown because a hidden clamp looks like a bug. */
export function effectiveNumbers(conf) {
  const preset = POLICY_EFFECT[conf.policy] ?? POLICY_EFFECT.balanced;
  return {
    repeatedIdenticalCalls: conf.repeatedIdenticalCalls ?? preset.repeatedIdenticalCalls,
    noProgressTurns: conf.noProgressTurns ?? preset.noProgressTurns,
    mode: conf.mode ?? preset.mode,
    reasonCodes: [
      `policy:${conf.policy ?? 'balanced'}`,
      ...(conf.mode && conf.mode !== preset.mode ? ['mode-overridden-by-hand'] : []),
    ],
  };
}

/** Lines for the `incident` screen: the signals plus the numbers that produced them. */
export function incidentLines(report, conf) {
  if (!report?.incident)
    return [
      'No incident in this session.',
      'An incident appears when equivalent calls repeat or turns stop producing evidence.',
    ];
  const numbers = effectiveNumbers(conf);
  return [
    `state: ${report.state} · incident ${(report.incident.id ?? '').slice(0, 8)} · ${new Date(report.incident.at ?? Date.now()).toISOString()}`,
    `signals: ${(report.incident.signals ?? []).join(', ') || 'none'}`,
    `effective thresholds: ${numbers.repeatedIdenticalCalls} identical calls · ${numbers.noProgressTurns} turns · action ${numbers.mode} (${numbers.reasonCodes.join(' · ')})`,
    `current counts: ${report.count ?? 0} repeat(s), ${report.noProgressTurns ?? 0} turn(s) without progress`,
    report.cost ? `observed cost: $${Number(report.cost).toFixed(4)}` : 'observed cost: n/a',
    `actions: ${(report.incident.actions ?? []).join(' | ')}`,
    'release: /guard resume (one attempt) · change approach: /guard change-strategy',
  ];
}

/**
 * Rows of the `incident` screen: the two ways out, then the numbers that explain them.
 *
 * The resgates only exist when there is something to rescue. Offering "isentar bash"
 * on a quiet session would put the loosening first, which is exactly the wrong
 * recommendation, and the smoke would click it.
 */
export function incidentRows(state) {
  const rows = [];
  const key = state.incident ? state.quarantine?.[0]?.key : null;
  if (key)
    rows.push({
      value: `release:${key}`,
      label: `▸ Recommended: release ${key.slice(0, 12)}…`,
      description: 'one attempt; no configuration is written',
    });
  const tool = state.incident ? state.blockingCandidates?.[0] : null;
  if (tool)
    rows.push({
      value: `add:${tool}`,
      label: `${key ? '' : '▸ Recommended: '}exempt ${tool}`,
      description: '⚠ weakens detection · requires the same choice twice · writes project config',
    });
  rows.push({
    value: 'numbers',
    label: rows.length ? 'View blocking thresholds' : '▸ View blocking thresholds',
    description: 'opens Detection state — effective thresholds and counts',
  });
  return rows;
}

/** Lines for the `outOfScope` screen — visible, because silence is the failure mode. */
export function outOfScopeLines(state) {
  const rows = state.outOfScopePaths ?? [];
  if (!rows.length) return ['No changes outside the relevant paths in this session.'];
  return [
    `${rows.length} out-of-scope change(s) did not count as progress${state.strict ? '' : ' (counted: strict off)'}`,
    ...rows.slice(0, 8).map((p) => `  ${p}`),
    'broaden the scope with Relevant paths or switch the scope to any',
  ];
}

/** Candidates ordered by how often they were blocked this session (rule F). */
export function blockingCandidates(events = []) {
  const seen = new Map();
  for (const event of events) {
    const key = event?.key ?? '';
    if (!key) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count }));
}

/* ------------------------------------------------------------------ *\n   Host seam (M1/M2): the entry point wires the real modules in.\n   ------------------------------------------------------------------ */

/** Test/production seam for the host modules. */
export const host = { tui: undefined, agent: undefined };

/** Called once by `index.ts` with the modules it imported statically. */
export function provideHost(tui, agent) {
  if (tui) host.tui = tui;
  if (agent) host.agent = agent;
  return host;
}

/** Which export the screen needs, and from which package (checked by the smoke). */
export const HOST_EXPORTS = {
  '@earendil-works/pi-tui': ['Container', 'SettingsList', 'SelectList', 'Text', 'Input', 'matchesKey'],
  '@earendil-works/pi-coding-agent': [
    'DynamicBorder',
    'getSettingsListTheme',
    'getSelectListTheme',
  ],
};
/** Optional niceties: used when present, literal fallbacks when not. */
export const OPTIONAL_EXPORTS = {
  '@earendil-works/pi-coding-agent': ['keyHint', 'keyText'],
};

/** Name the exports the host does not provide (a missing module is all of them). */
export function missingHostExports(tuiPkg, agentPkg) {
  const mods = {
    '@earendil-works/pi-tui': tuiPkg,
    '@earendil-works/pi-coding-agent': agentPkg,
  };
  return Object.entries(HOST_EXPORTS).flatMap(([name, exports]) =>
    exports.filter((key) => typeof mods[name]?.[key] !== 'function').map((key) => `${name}.${key}`),
  );
}

function why(error) {
  return String(error?.code ?? error?.message ?? error).split('\n')[0];
}

/** Degradation is allowed; silence is not. */
function degrade(ctx, reason) {
  try {
    ctx?.ui?.notify?.(`Guard has no interactive panel: ${reason}`, 'warning');
  } catch {
    /* the reason stays, a broken notify must not add a second error */
  }
  return false;
}

/**
 * Show the panel. Returns false when the host cannot run a custom screen, so the caller
 * falls back to a text panel that leads with state.
 */
export async function runDashboard(deps, injection = {}) {
  const { ctx, title, items, onChange, onSave, onDiscard, menus, shell = {} } = deps;
  const t = typeof shell.text === 'function' ? shell.text : (value) => String(value);
  const displayItems = items.map((item) => ({
    ...item,
    label: t(item.label),
    description: t(item.description),
    currentValue: t(item.currentValue),
  }));
  if (ctx.mode !== 'tui' || typeof ctx.ui.custom !== 'function') return false;
  let tuiPkg = injection.tuiPkg ?? host.tui,
    agentPkg = injection.agentPkg ?? host.agent;
  if (!tuiPkg) {
    try {
      tuiPkg = await import('@earendil-works/pi-tui');
    } catch (error) {
      return degrade(ctx, `@earendil-works/pi-tui is unavailable (${why(error)})`);
    }
  }
  if (!agentPkg) {
    try {
      agentPkg = await import('@earendil-works/pi-coding-agent');
    } catch (error) {
      return degrade(ctx, `@earendil-works/pi-coding-agent is unavailable (${why(error)})`);
    }
  }
  const missing = missingHostExports(tuiPkg, agentPkg);
  if (missing.length)
    return degrade(
      ctx,
      `missing exports: ${missing.join(', ')} — this Pi version does not expose the required custom screen`,
    );
  const { Container, SettingsList, SelectList, Text, Input, matchesKey } = tuiPkg;
  const { DynamicBorder, getSettingsListTheme, getSelectListTheme, keyHint, keyText } = agentPkg;
  const savedChanges = [];
  const actions = [];
  const saveWarnings = [];
  let discarded = false;
  await ctx.ui.custom((tuiRef, theme, keybindings, done) => {
    let active = true;
    let dirty = false;
    let saveInFlight = false;
    let escapeWarned = false;
    let draftCount = 0;
    const cancel = (data) => keybindings?.matches?.(data, 'tui.select.cancel') === true;
    const navHint =
      typeof shell.navHint === 'function'
        ? `  ${shell.navHint({
            up: typeof keyText === 'function' ? keyText('tui.select.up') : '↑',
            down: typeof keyText === 'function' ? keyText('tui.select.down') : '↓',
            confirm: typeof keyText === 'function' ? keyText('tui.select.confirm') : 'Enter',
            cancel: typeof keyText === 'function' ? keyText('tui.select.cancel') : 'Esc',
          })}`
        : typeof keyText === 'function'
          ? `  ${keyText('tui.select.up')}/${keyText('tui.select.down')} move · ${keyText('tui.select.confirm')} choose · ${keyText('tui.select.cancel')} back`
          : '  ↑↓ move · Enter choose · Esc back';
    const backHint =
      typeof shell.backHint === 'function'
        ? `  ${shell.backHint(typeof keyHint === 'function' ? keyHint('tui.select.cancel', 'Esc') : 'Esc')}`
        : typeof keyHint === 'function'
          ? `  ${keyHint('tui.select.cancel', 'back')}`
          : '  Esc back';
    const box = new Container();
    box.addChild(new DynamicBorder((str) => theme.fg('accent', str)));
    const titleLine = new Text('', 1, 0);
    const renderTitle = () => {
      const value = typeof title === 'function' ? title() : t(title);
      titleLine.setText(theme.fg('accent', theme.bold ? theme.bold(value) : value));
    };
    renderTitle();
    box.addChild(titleLine);
    const status = new Text('', 1, 0);
    const renderStatus = (message) => {
      status.setText(theme.fg('dim', t(message)));
      tuiRef.requestRender();
    };
    const notify = (message, level = 'info') => {
      if (!active) return;
      try {
        ctx.ui.notify(t(message), level);
      } catch {
        /* A host notification failure must not break the panel. */
      }
    };
    const finish = () => {
      if (!active) return;
      active = false;
      done({ changed: savedChanges, actions: [...actions, ...(dirty ? saveWarnings : [])], discarded });
    };
    const escapeRoot = () => {
      if (saveInFlight) {
        renderStatus('Saving configuration… please wait.');
        notify('A configuration save is in progress; wait for it to finish.', 'warning');
        return;
      }
      if (dirty && !escapeWarned) {
        escapeWarned = true;
        renderStatus('Unsaved changes · Ctrl+S saves · Esc again discards.');
        notify('Unsaved changes. Press Ctrl+S to save, or Esc again to discard.', 'warning');
        return;
      }
      if (dirty) {
        discarded = true;
        onDiscard?.();
      }
      finish();
    };
    let list;
    const updateItem = (target, replacement) => {
      const source = items.find((item) => item.id === target);
      const display = displayItems.find((item) => item.id === target);
      if (!source || !display) return;
      display.label = t(source.label);
      display.description = t(source.description);
      if (Array.isArray(source.values)) display.values = [...source.values];
      display.currentValue = t(replacement);
      list.updateValue(target, display.currentValue);
      renderTitle();
    };
    list = new SettingsList(
      displayItems,
      Math.min(displayItems.length, 12),
      getSettingsListTheme(),
      async (id, value) => {
        const outcome = await onChange(id, value, updateItem);
        if (!active) return outcome?.note ?? outcome;
        const result = outcome && typeof outcome === 'object' ? outcome : { kind: 'action', note: outcome };
        const message = result.note ?? `${id} → ${value}`;
        if (result.kind === 'draft') {
          dirty = true;
          escapeWarned = false;
          draftCount = result.count ?? draftCount + 1;
          renderStatus(`${draftCount} unsaved change(s) · Ctrl+S saves · Esc twice discards.`);
        } else if (message) {
          actions.push(message);
          renderStatus(message);
        }
        notify(message, result.level ?? 'info');
        tuiRef.requestRender();
        return message;
      },
      escapeRoot,
    );
    const saveDraft = async () => {
      if (!active || saveInFlight) return;
      if (!dirty) {
        renderStatus('No unsaved changes.');
        notify('No unsaved changes.', 'info');
        return;
      }
      if (typeof onSave !== 'function') {
        renderStatus('Saving is unavailable; the draft is still available.');
        notify('Saving is unavailable; the draft was kept.', 'warning');
        return;
      }
      saveInFlight = true;
      renderStatus('Saving configuration…');
      try {
        const result = await onSave();
        if (!active) return;
        if (!result?.ok) {
          savedChanges.push(...(result.partialChanged ?? []));
          const message = result?.note ?? 'Save failed; your draft was kept. Try Ctrl+S again.';
          if (!saveWarnings.includes(message)) saveWarnings.push(message);
          renderStatus(message);
          notify(message, 'warning');
          return;
        }
        const message = result.note ?? 'Configuration saved.';
        savedChanges.push(...(result.changed ?? [result.summary ?? message]));
        dirty = false;
        draftCount = 0;
        escapeWarned = false;
        saveWarnings.length = 0;
        renderStatus(shell.savedPanelRemains?.(message) ?? `${message} · panel remains open.`);
        notify(message, 'info');
      } catch (error) {
        if (!active) return;
        const message = `Save failed; draft kept. ${String(error?.message ?? error).split('\n')[0]}`;
        if (!saveWarnings.includes(message)) saveWarnings.push(message);
        renderStatus(message);
        notify(message, 'warning');
      } finally {
        saveInFlight = false;
        if (active) tuiRef.requestRender();
      }
    };
    const frame = (heading) => {
      const inner = new Container();
      inner.addChild(new Text(theme.fg('accent', t(heading)), 1, 0));
      return inner;
    };
    const screen = (heading, rows, onPick, onClose) => {
      const inner = frame(heading);
      const select = new SelectList(rows || [], Math.min(rows?.length || 1, 8), getSelectListTheme());
      select.onSelect = (item) => onPick(item.value);
      select.onCancel = () => onClose();
      inner.addChild(select);
      inner.addChild(new Text(theme.fg('dim', navHint.trim()), 1, 0));
      return {
        render: (width) => inner.render(width),
        invalidate: () => inner.invalidate(),
        handleInput: (data) => {
          select.handleInput(data);
          tuiRef.requestRender();
        },
      };
    };
    const textScreen = (heading, lines, onClose) => {
      const inner = frame(heading);
      for (const line of (lines ?? ['(empty)']).flatMap((l) => String(l).split('\n')))
        inner.addChild(new Text(theme.fg('muted', `  ${line}`), 0, 0));
      inner.addChild(new Text(theme.fg('dim', backHint.trim()), 1, 0));
      return {
        render: (width) => inner.render(width),
        invalidate: () => inner.invalidate(),
        handleInput: (data) => {
          if (cancel(data)) onClose();
        },
      };
    };
    const panels = {
      state: (_c, close) => textScreen('Detection state', menus.state(), () => close()),
      incident: (_c, close) =>
        screen(
          'Latest incident · choose what to do',
          menus.incidentActions(),
          (value) =>
            // `numbers` is a navigation, not a write: `navigateTo` re-selects **and
            // activates** the target (`settings-list.js:222-233`), so the second level
            // opens by itself — a second Enter would pick one of its rows.
            value === 'numbers' ? close(undefined, { navigateTo: 'state' }) : close(value),
          () => close(),
        ),
      outOfScope: (_c, close) => textScreen('Out-of-scope changes', menus.outOfScope(), () => close()),
      help: (_c, close) => textScreen('Command-line help', menus.help(), () => close()),
      quarantine: (_c, close) =>
        screen(
          'Quarantine · release once is a rescue; exemption changes policy',
          menus.quarantine(),
          (value) => close(value),
          () => close(),
        ),
      exceptions: (_c, close) =>
        screen(
          'Exempt tools · weaken detection (choose the same value twice)',
          menus.exceptions(),
          (value) => close(value),
          () => close(),
        ),
      relevantPaths: (_c, close) =>
        screen(
          'Relevant paths · what counts as progress',
          menus.paths(),
          (value) => close(value),
          () => close(),
        ),
      resume: (_c, close) =>
        screen('Release this signature', menus.quarantine(), (value) => close(value), () => close()),
      explain: (_c, close) => textScreen('Why', menus.incident(), () => close()),
      allow: (_c, close) =>
        screen('Exempt tool', menus.exceptions(), (value) => close(value), () => close()),
    };
    for (const item of displayItems) {
      if (item.submenu !== true) continue;
      const panel = panels[item.id];
      if (!panel) continue;
      item.submenu = (currentValue, close) => panel(currentValue === '—' ? undefined : currentValue, close);
    }
    box.addChild(list);
    box.addChild(status);
    renderStatus(shell.mainHint ?? 'Ctrl+S saves changes · Esc returns or closes.');
    box.addChild(new DynamicBorder((str) => theme.fg('accent', str)));
    return {
      render: (width) => box.render(width),
      invalidate: () => box.invalidate(),
      handleInput: (data) => {
        if (matchesKey(data, 'ctrl+s')) {
          return saveDraft();
        }
        list.handleInput(data);
        tuiRef.requestRender();
      },
    };
  });
  return { changed: savedChanges, actions, discarded };
}
