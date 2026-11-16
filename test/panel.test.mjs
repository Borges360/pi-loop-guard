import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { guardEnv, waitFor } from '../test-support/panel.mjs';
import {
  FIELDS,
  HOST_EXPORTS,
  missingHostExports,
  fieldValues,
  enumItems,
  panelItems,
  applyField,
  c0,
  host,
} from '../menu.mjs';
import install from '../extension.mjs';

const text = (env) => String(env.f.notifications.at(-1));

/** The tool name inside a `remove:<index>:<tool>` action. */
const nameOfValue = (value) => String(value).split(':').slice(2).join(':');

/* ------------------------------------------------------------------ *
 *  1. Pure units of the table.
 * ------------------------------------------------------------------ */

test('every field offers values, patches a real key and points at a real lock', () => {
  const keys = new Set(Object.keys(c0()));
  for (const [id, field] of Object.entries(FIELDS)) {
    assert.equal(typeof field.patch, 'function', id);
    assert.equal(typeof field.note, 'function', id);
    assert.ok(keys.has(field.lock), `${id}.lock aponta para chave inexistente: ${field.lock}`);
    const values = fieldValues(id, c0(), { routable: ['openrouter/x'], changedPaths: ['src/a.ts'] });
    assert.ok(Array.isArray(values), `${id}.values`);
    if (field.kind !== 'list') assert.ok(values.length, `${id}: values vazia`);
    for (const value of values) {
      const { patch } = applyField(c0(), id, value, {
        state: { routable: ['openrouter/x'], changedPaths: ['src/a.ts'] },
      });
      for (const key of Object.keys(patch))
        assert.ok(keys.has(key), `${id}: patch escreve fora da seção: ${key}`);
      const merged = { ...c0(), ...patch };
      if (field.kind === 'list') {
        // A list row is an action on membership, not a scalar: `add:x` puts x in the
        // section, `remove:<i>:x` takes it out. The scalar round-trip is the enum case.
        const list = merged[field.listKey] ?? [];
        if (String(value).startsWith('add:'))
          assert.ok(list.includes(String(value).slice(4)), `${id}: ${value} não entrou na lista`);
        else
          assert.ok(
            !list.some((x) => (typeof x === 'string' ? x : x?.tool) === nameOfValue(value)),
            `${id}: ${value} não saiu da lista`,
          );
        continue;
      }
      assert.equal(field.current(merged), value, `${id}: ${value} não sobrevive ao round-trip`);
    }
  }
});

test('the preset writes the dial it silently moves, and says so in the note', () => {
  const strict = applyField(c0(), 'policy', 'strict');
  assert.deepEqual(strict.patch, { policy: 'strict', mode: 'enforce' }, 'preset sem mode deixaria a Ação antiga por trás');
  assert.match(strict.note, /mode → enforce/);
  assert.match(FIELDS.mode.note('enforce'), /BLOCKED/);
  assert.throws(() => applyField(c0(), 'policy', 'paranoid'), /Invalid policy[\s\S]*conservative/);
});

/* ------------------------------------------------------------------ *
 *  2. Parity: the panel cycles, the file agrees.
 * ------------------------------------------------------------------ */

test('every value the panel offers is accepted by the same table that writes it', async (t) => {
  const env = await guardEnv(t);
  const { running } = await env.open();
  const s = env.settings();
  const rows = s.items.filter((i) => i.id !== 'language' && Array.isArray(i.values) && i.values.length);
  assert.ok(rows.length >= 9, `esperava pelo menos 9 linhas enum, achei ${rows.length}`);
  for (const row of rows) {
    const before = await env.file();
    for (const value of row.values) await s.cycle(row.id, value);
    assert.equal(await env.file(), before, `${row.id}: navigation must not persist a draft`);
    await env.f.ctx.lastScreen.handleInput('\u0013');
    await waitFor(async () => FIELDS[row.id].current(await env.saved()) === row.values.at(-1), `${row.id} save`);
    const written = await env.saved();
    assert.equal(
      FIELDS[row.id].current(written),
      row.values.at(-1),
      `${row.id}: ofereceu ${JSON.stringify(row.values)} e o último valor não chegou ao arquivo`,
    );
  }
  for (const id of Object.keys(FIELDS)) {
    if (FIELDS[id].kind === 'list') continue;
    assert.ok(
      fieldValues(id, c0()).includes(FIELDS[id].current(c0())),
      `${id}: o default declarado não está entre os valores`,
    );
  }
  s.onCancel();
  await running;
});

test('language selector previews every root label and submenu heading, then persists on Ctrl+S', async (t) => {
  const env = await guardEnv(t);
  const before = await env.file();
  const { running } = await env.open();
  const settings = env.settings();
  const language = settings.find('language');
  assert.equal(settings.items[0].id, 'language');
  assert.deepEqual(language.values, ['English (default)', 'Português (Brasil)']);
  assert.equal(language.currentValue, 'English (default)');
  assert.match(env.f.ctx.lastScreen.render(80).join('\n'), /Guard ·/);

  await settings.cycle('language', 'Português (Brasil)');
  assert.equal(language.currentValue, 'Português (Brasil)');
  assert.deepEqual(language.values, ['English (padrão)', 'Português (Brasil)']);
  assert.equal(settings.find('state').label, 'Estado da detecção');
  assert.equal(settings.find('toolRepeat').label, 'Chamadas idênticas antes da suspeita');
  assert.match(settings.find('toolRepeat').description, /valores menores detectam antes/);
  assert.doesNotMatch(settings.find('toolRepeat').description, /lower values detect sooner/);
  assert.match(env.f.ctx.lastScreen.render(80).join('\n'), /Proteção ·/);
  assert.equal(await env.file(), before, 'preview does not persist a locale or config draft');

  settings.open('state');
  assert.match(settings.top().render(40).join('\n'), /Estado da detecção/);
  assert.match(settings.top().render(40).join('\n'), /limites:/);
  settings.top().handleInput('\u001b');
  await env.f.ctx.lastScreen.handleInput('\u0013');
  const localeFile = join(env.dir, '.pi', 'pi-loop-guard.locale.json');
  await waitFor(async () => {
    try { return JSON.parse(await readFile(localeFile, 'utf8')).locale === 'pt-BR'; }
    catch { return false; }
  }, 'persistir preferência pt-BR');
  assert.equal(settings.find('language').currentValue, 'Português (Brasil)');
  settings.onCancel();
  await running;

  const reopened = env.command('');
  await waitFor(() => env.tui.created.settings.length === 2, 'reabrir painel com idioma salvo');
  const reopenedSettings = env.tui.created.settings.at(-1);
  assert.equal(reopenedSettings.find('language').currentValue, 'Português (Brasil)');
  assert.equal(reopenedSettings.find('language').label, 'Idioma');
  reopenedSettings.onCancel();
  await reopened;
});

test('every reachable dashboard submenu renders Portuguese headings and row copy', async (t) => {
  const env = await guardEnv(t);
  const { running } = await env.open();
  const settings = env.settings();
  await settings.cycle('language', 'Português (Brasil)');
  const screens = [
    ['state', 'Estado da detecção', 'Detection state'],
    ['incident', 'Incidente mais recente · escolha uma ação', 'Latest incident · choose what to do'],
    ['outOfScope', 'Mudanças fora do escopo', 'Out-of-scope changes'],
    ['help', 'Ajuda dos comandos', 'Command-line help'],
    ['quarantine', 'Quarentena · liberar uma vez é resgate', 'Quarantine · release once is a rescue'],
    ['exceptions', 'Ferramentas isentas · enfraquece a detecção', 'Exempt tools · weaken detection'],
    ['relevantPaths', 'Caminhos relevantes · o que conta como progresso', 'Relevant paths · what counts as progress'],
  ];
  for (const [id, expected, english] of screens) {
    settings.open(id);
    const rendered = settings.top().render(80).join('\n');
    assert.ok(rendered.includes(expected), `${id} heading/rows were not localized: ${rendered}`);
    assert.ok(!rendered.includes(english), `${id} retained an English heading`);
    settings.top().handleInput('\u001b');
  }
  await env.f.ctx.lastScreen.handleInput('\u0013');
  await waitFor(async () => {
    try { return JSON.parse(await readFile(join(env.dir, '.pi', 'pi-loop-guard.locale.json'), 'utf8')).locale === 'pt-BR'; }
    catch { return false; }
  }, 'persistir preferência de idioma após conferir submenus');
  settings.onCancel();
  await running;
});

test('unsaved language preview warns once and Esc again discards without creating a preference', async (t) => {
  const env = await guardEnv(t);
  const { running } = await env.open();
  const settings = env.settings();
  await settings.cycle('language', 'Português (Brasil)');
  await env.f.ctx.lastScreen.handleInput('\u001b');
  assert.match(String(env.f.notifications.at(-1)), /pressione Esc novamente para descartar/);
  await env.f.ctx.lastScreen.handleInput('\u001b');
  await running;
  assert.equal(env.f.ctx.customResult.discarded, true);
  await assert.rejects(readFile(join(env.dir, '.pi', 'pi-loop-guard.locale.json')), { code: 'ENOENT' });
  assert.match(String(env.f.notifications.at(-1)), /Guard · Unsaved changes discarded/);
});

test('locale save failure retains the preview and Ctrl+S succeeds when the cause is removed', async (t) => {
  const env = await guardEnv(t);
  const { running } = await env.open();
  const settings = env.settings();
  const localeFile = join(env.dir, '.pi', 'pi-loop-guard.locale.json');
  await mkdir(localeFile);
  await settings.cycle('language', 'Português (Brasil)');
  await env.f.ctx.lastScreen.handleInput('\u0013');
  await waitFor(() => env.f.notifications.some((message) => /Falha ao salvar/.test(String(message))), 'avisar falha de locale');
  assert.equal(settings.find('language').currentValue, 'Português (Brasil)');
  assert.match(env.f.ctx.lastScreen.render(80).join('\n'), /Idioma/);
  await rm(localeFile, { recursive: true, force: true });

  await env.f.ctx.lastScreen.handleInput('\u0013');
  await waitFor(async () => {
    try { return JSON.parse(await readFile(localeFile, 'utf8')).locale === 'pt-BR'; }
    catch { return false; }
  }, 'salvar preferência após retry');
  assert.equal(settings.find('language').currentValue, 'Português (Brasil)');
  settings.onCancel();
  await running;
  assert.doesNotMatch(String(env.f.notifications.at(-1)), /Falha ao salvar/);
});

test('untrusted project can preview Portuguese but cannot persist the preference', async (t) => {
  const env = await guardEnv(t);
  env.f.ctx.isProjectTrusted = () => false;
  const { running } = await env.open();
  const settings = env.settings();
  await settings.cycle('language', 'Português (Brasil)');
  await env.f.ctx.lastScreen.handleInput('\u0013');
  await waitFor(() => env.f.notifications.some((message) => /Confie neste projeto/.test(String(message))), 'recusar persistência não confiável');
  assert.equal(settings.find('language').currentValue, 'Português (Brasil)');
  await assert.rejects(readFile(join(env.dir, '.pi', 'pi-loop-guard.locale.json')), { code: 'ENOENT' });
  await env.f.ctx.lastScreen.handleInput('\u001b');
  await env.f.ctx.lastScreen.handleInput('\u001b');
  await running;
});

test('invalid saved locale warns before the panel opens and uses English', async (t) => {
  const env = await guardEnv(t);
  await writeFile(join(env.dir, '.pi', 'pi-loop-guard.locale.json'), '{"schemaVersion":9,"locale":"pt-BR"}');
  const { running } = await env.open();
  assert.equal(env.settings().find('language').currentValue, 'English (default)');
  assert.match(env.f.notifications.join('\n'), /The saved language is invalid/);
  env.settings().onCancel();
  await running;
});

test('non-TUI fallback uses the saved project language and preserves command names', async (t) => {
  const env = await guardEnv(t);
  await writeFile(join(env.dir, '.pi', 'pi-loop-guard.locale.json'), '{"schemaVersion":1,"locale":"pt-BR"}');
  env.f.ctx.mode = 'rpc';
  await env.command('');
  assert.match(text(env), /Proteção · ON/);
  assert.match(text(env), /limites:/);
  assert.match(text(env), /\/guard status \| explain \| report/);
  assert.doesNotMatch(text(env), /effective thresholds/);
});

test('panel rows come from the table, in table order, and locked rows disappear', () => {
  const items = panelItems({ conf: c0(), locked: {}, state: {} });
  assert.deepEqual(
    items.filter((i) => Array.isArray(i.values)).map((i) => i.id),
    enumItems({ conf: c0() }).map((i) => i.id),
  );
  const locked = panelItems({ conf: c0(), locked: { noProgressTurns: 5 }, state: {} });
  assert.ok(!locked.some((i) => i.id === 'noProgress'), 'linha travada some do painel');
  assert.ok(locked.some((i) => i.id === 'toolRepeat'), 'as demais continuam');
});

test('a locked key blocks the command too, and nothing is written on the way', async (t) => {
  const env = await guardEnv(t, { global: 'locked:\n  loopGuard:\n    mode: warn\n' });
  const before = await env.file();
  await assert.rejects(env.command('enforce'), /travado por política global/);
  assert.equal(await env.file(), before, 'campo travado não escreve nada');
  await assert.rejects(env.command('strict maybe'), /Invalid scopeStrict|travado/);
});

test('an invalid value cites the options; a valid one says it took effect, never /reload', async (t) => {
  const env = await guardEnv(t);
  const before = await env.file();
  await assert.rejects(env.command('tool-repeat 99'), (e) => {
    assert.match(e.message, /Invalid toolRepeat: 99/);
    assert.match(e.message, /Use: 3 \| 4 \| 5 \| 6 \| 8/);
    return true;
  });
  assert.equal(await env.file(), before, 'recusado antes de escrever');
  await env.command('tool-repeat 6');
  assert.match(text(env), /já em efeito/);
  assert.doesNotMatch(env.f.notifications.join('\n'), /\/reload/i);
  assert.equal((await env.saved()).repeatedIdenticalCalls, 6);
});

/* ------------------------------------------------------------------ *
 *  3. Scope, quarantine and rescue — the guard's own surface.
 * ------------------------------------------------------------------ */

test('scope: relevant hides out-of-scope progress and shows it; scope: any counts it', async (t) => {
  const env = await guardEnv(t, {
    config: 'loopGuard:\n  enabled: true\n  policy: strict\n  mode: enforce\n  scope: { source: relevant, strict: true }\n  relevantPaths: [src/**]\n',
    seed: { 'src/a.ts': 'x\n', 'docs/notes.ts': 'y\n' },
  });
  // Refuse the rescue: the block has to stay, or the test measures its own release.
  env.f.ctx.ui.confirm = async () => false;
  const hits = await env.hammer(4);
  assert.equal(hits[3]?.block, true, 'repetição equivalente bloqueia em enforce');
  await env.command('status');
  assert.match(text(env), /scope: relevant \(strict on\)/);
  // A change outside the relevant paths does not count, but is visible as out-of-scope.
  await writeFile(join(env.dir, 'README.md'), 'docs\n');
  env.f.ctx.sessionManager.getLeafId = () => 'leaf-2';
  await env.command('status');
  assert.match(text(env), /1 out of scope/);
  const still = await env.f.emit('tool_call', {
    toolCallId: 'x1b',
    toolName: 'bash',
    input: { command: 'npm test' },
  });
  assert.equal(still?.block, true, 'com strict on a mudança fora do escopo não solta a sessão');
  assert.match(String(env.f.notifications.at(-1)), /recusado|fora do escopo|/, 'a recusa aparece onde o usuário viu');
  // Widening the scope to `any` makes the same change count as progress and unblock.
  await env.command('scope any');
  const after = await env.f.emit('tool_call', {
    toolCallId: 'x2',
    toolName: 'bash',
    input: { command: 'npm test' },
  });
  assert.equal(after?.block, undefined, 'com o escopo alargado a mudança contou como progresso');
  assert.equal((await env.saved()).scope.source, 'any');
});

test('quarantine can be released once from the panel, without writing config', async (t) => {
  const env = await guardEnv(t, {
    config: 'loopGuard:\n  policy: strict\n  mode: enforce\n',
  });
  await env.hammer(4);
  const { running } = await env.open();
  const s = env.settings();
  assert.match(s.find('quarantine').currentValue, /1 active/, 'the quarantined signature is visible');
  s.open('quarantine');
  const picker = env.tui.created.select.at(-1);
  assert.match(picker.items[0].label, /^▸ Recommended: release/);
  const before = await env.file();
  await picker.pick(picker.items[0].value);
  assert.match(text(env), /Released signature once/);
  assert.equal(await env.file(), before, 'liberar uma vez não escreve nada');
  const again = await env.f.emit('tool_call', {
    toolCallId: 'z9',
    toolName: 'bash',
    input: { command: 'npm test' },
  });
  assert.equal(again?.block, undefined, 'a liberação vale para a próxima chamada');
  assert.equal(again?.override, undefined);
  s.onCancel();
  await running;
});

test('exempting a tool is two acts in the panel and one confirmed act in the command', async (t) => {
  const env = await guardEnv(t, { config: 'loopGuard:\n  mode: enforce\n  policy: strict\n' });
  await env.hammer(4);
  const { running } = await env.open();
  const s = env.settings();
  s.open('exceptions');
  const picker = env.tui.created.select.at(-1);
  assert.match(picker.items.find((i) => i.value === 'add:bash').label, /^▸ Recommended: exempt bash/);
  const before = await env.file();
  await picker.pick('add:bash');
  assert.match(text(env), /Choose the same value again to confirm/, 'the first choice only explains what it would do');
  assert.equal(await env.file(), before);
  s.open('exceptions');
  await env.tui.created.select.at(-1).pick('add:bash');
  assert.equal(await env.file(), before, 'the second choice stages but does not save');
  assert.match(text(env), /exemption: bash will no longer be monitored/);
  await env.f.ctx.lastScreen.handleInput('\u0013');
  await waitFor(async () => (await env.saved()).exceptions?.some((x) => x.tool === 'bash'), 'save exemption draft');
  s.onCancel();
  await running;
  // The command path asks once, explicitly, and writes the project file.
  env.f.ctx.ui.confirm = async () => false;
  await assert.rejects(env.command('allow edit'), /Não autorizado — nada foi escrito/);
  assert.ok(!(await env.file()).includes('edit'));
});

test('the block reason names the rescue and never asks twice after a refusal', async (t) => {
  const env = await guardEnv(t, { config: 'loopGuard:\n  mode: enforce\n  policy: strict\n' });
  const asks = [];
  env.f.ctx.ui.confirm = async (title, detail) => {
    asks.push([title, detail]);
    return false;
  };
  await env.hammer(3);
  const blocked = await env.f.emit('tool_call', {
    toolCallId: 'r1',
    toolName: 'bash',
    input: { command: 'npm test' },
  });
  assert.equal(blocked?.block, true);
  assert.match(blocked.reason, /guard explain|\/guard resume/);
  assert.equal(asks.length, 1, 'perguntou o resgate uma vez');
  await env.f.emit('tool_call', { toolCallId: 'r2', toolName: 'bash', input: { command: 'npm test' } });
  assert.equal(asks.length, 1, 'depois de recusar, não insiste nesta sessão');
});

/* ------------------------------------------------------------------ *
 *  4. Degradation and the entry point.
 * ------------------------------------------------------------------ */

test('the incident screen offers the two ways out and navigateTo opens the numbers by itself', async (t) => {
  const env = await guardEnv(t, { config: 'loopGuard:\n  policy: strict\n  mode: enforce\n' });
  env.f.ctx.ui.confirm = async () => false;
  await env.hammer(4);
  const { running } = await env.open();
  const s = env.settings();
  s.open('incident');
  const picker = env.tui.created.select.at(-1);
  assert.match(picker.items[0].label, /^▸ Recommended: release/, 'the least costly rescue comes first');
  assert.deepEqual(
    picker.items.map((i) => i.value).map((v) => (v.startsWith('release:') ? 'release' : v)),
    ['release', 'add:bash', 'numbers'],
  );
  await picker.pick('numbers');
  // navigateTo re-selects AND activates: the state screen is already open here.
  assert.match(
    s.top().render(90).join('\n'),
    /effective thresholds: 3 identical calls|thresholds:/,
    'o segundo nível veio sem apertar Enter de novo',
  );
  s.onCancel();
  await running;
});

test('a missing host export degrades to the text panel and names the export', async (t) => {
  const env = await guardEnv(t);
  delete host.agent.getSelectListTheme;
  assert.deepEqual(missingHostExports(env.tui.tuiPkg, host.agent), [
    '@earendil-works/pi-coding-agent.getSelectListTheme',
  ]);
  await env.command('');
  assert.ok(!env.f.ctx.lastScreen, 'nenhuma tela montada');
  assert.match(env.f.notifications.join('\n'), /no interactive panel.*getSelectListTheme/);
  const fallback = text(env);
  assert.match(fallback, /Guard ·/);
  assert.ok(
    fallback.indexOf('limites:') < fallback.indexOf('/guard status'),
    'o fallback mostra estado antes das linhas de comando',
  );
  assert.match(fallback, /scope: relevant/);
});

test('a non-tui client gets state before grammar', async (t) => {
  const env = await guardEnv(t);
  env.f.ctx.mode = 'rpc';
  const { running } = await env.open();
  assert.equal(env.tui.created.settings.length, 0);
  await running.catch(() => {});
  const lines = text(env).split('\n');
  assert.match(lines[0], /Guard ·/);
  assert.ok(lines.join('\n').indexOf('activity:') < lines.join('\n').indexOf('/guard status'));
});

test('the pi entry point imports the host modules statically and hands them over', async () => {
  const entry = await readFile(new URL('../index.ts', import.meta.url), 'utf8');
  assert.match(entry, /import \* as piTui from ['"]@earendil-works\/pi-tui['"]/);
  assert.match(entry, /import \* as piAgent from ['"]@earendil-works\/pi-coding-agent['"]/);
  assert.match(entry, /install\(pi, \{ tui: piTui, agent: piAgent \}\)/);
  const extension = await readFile(new URL('../extension.mjs', import.meta.url), 'utf8');
  assert.match(extension, /provideHost\(injected\.tui, injected\.agent\)/);
  assert.deepEqual(HOST_EXPORTS['@earendil-works/pi-tui'], [
    'Container',
    'SettingsList',
    'SelectList',
    'Text',
    'Input',
    'matchesKey',
  ]);
});

test('bare /guard closes with a count and the file it wrote', async (t) => {
  const env = await guardEnv(t);
  const { running } = await env.open();
  const s = env.settings();
  await s.cycle('toolRepeat', '8');
  await s.cycle('mode', 'enforce');
  assert.equal((await env.saved()).mode, 'warn', 'draft changes do not persist before Ctrl+S');
  await env.f.ctx.lastScreen.handleInput('\u0013');
  await waitFor(async () => (await env.saved()).mode === 'enforce', 'save panel draft');
  s.onCancel();
  await running;
  const closed = env.f.ctx.customResult;
  assert.equal(closed.changed.length, 2);
  assert.match(text(env), /Guard · 2 saved change\(s\)/);
  assert.ok(text(env).includes(join(env.dir, '.pi', 'pi-suite.yaml')));
  // `mode` is also moved by the policy preset; both writes landed in the same file.
  assert.equal((await env.saved()).mode, 'enforce');
  assert.equal((await env.saved()).repeatedIdenticalCalls, 8);
  await waitFor(async () => (await env.saved()).mode === 'enforce', 'gravação do modo');
});

test('install() without a host still runs the guard (no crash in print mode)', async (t) => {
  const env = await guardEnv(t);
  env.f.ctx.mode = 'print';
  env.f.ctx.hasUI = false;
  await env.command('status');
  assert.match(text(env) || 'ok', /./, 'o comando respondeu sem tela');
  assert.equal(typeof install, 'function');
});
