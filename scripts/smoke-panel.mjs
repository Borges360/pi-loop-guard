/**
 * Real-host smoke for the `/guard` panel.
 *
 * The unit tests drive `test-support/fake-tui.mjs`; that double is only faithful if it
 * mirrors the host's module shape. In the economist the fake put `DynamicBorder` in the
 * wrong package, `new DynamicBorder(...)` threw inside `ctx.ui.custom()`, the menu never
 * opened and 49 unit tests stayed green. This script uses the INSTALLED pi — its jiti
 * loader with the host module map, the real `pi-tui` components, the real theme and the
 * real keybindings — and drives the screen with terminal bytes.
 *
 * It never calls a model: the guard only reads local command results from the fake pi
 * object, and the panel writes only this repo's config file.
 *
 *   node scripts/smoke-panel.mjs       # optionally PI_CODING_AGENT_ENTRY=<pi>/dist/index.js
 *
 * Exit 0 with the screens and the decisions on stdout; exit 1 on any mismatch.
 */
import { mkdtemp, rm, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { piExtensions } from './pi-module.mjs';
import { fakePi } from '../test-support/fakes.mjs';
import { HOST_EXPORTS, missingHostExports, panelItems, FIELDS } from '../menu.mjs';
import { defaults as guardDefaults } from '../guard.mjs';

const DOWN = '\x1b[B';
const ENTER = '\r';
const CTRL_S = '\x13';
const ESC = '\x1b';
const url = (p) => pathToFileURL(p).href;
const firstLine = (t) => String(t).split('\n')[0];
const strip = (line) => String(line).replace(/\x1b\[[0-9;]*m/g, '');

async function exists(path) {
  try {
    return (await readFile(path)) && path;
  } catch {
    return undefined;
  }
}

async function agentEntry() {
  const releases = join(homedir(), '.pi', 'agent', 'install', 'releases');
  const candidates = [
    process.env.PI_CODING_AGENT_ENTRY,
    ...(await readdir(releases)
      .catch(() => [])
      .then((versions) =>
        versions
          .sort()
          .reverse()
          .map((v) =>
            join(releases, v, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'),
          ),
      )),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const path = candidate.replace(/[/\\]$/, '').replace(/[\\/]dist[/\\]?$/, '/dist/index.js');
    if (await exists(path)) return path;
  }
  throw Error('installed pi-coding-agent/dist/index.js not found; set PI_CODING_AGENT_ENTRY');
}

async function realModules() {
  const entry = await agentEntry();
  const dist = dirname(entry);
  const agent = await import(url(entry));
  const theme = await import(url(join(dist, 'modes', 'interactive', 'theme', 'theme.js')));
  let tui;
  for (const candidate of [
    join(dist, '..', '..', 'pi-tui', 'dist', 'index.js'),
    join(dist, '..', '..', '..', 'pi-tui', 'dist', 'index.js'),
  ]) {
    try {
      const mod = await import(url(candidate));
      if (mod.SettingsList && mod.Container && mod.Input && mod.getKeybindings) {
        tui = mod;
        break;
      }
    } catch {
      /* next candidate */
    }
  }
  if (!tui) throw Error('installed pi-tui not importable from the pi release directory');
  return { entry, agent, theme, tui };
}

const run = async () => {
  const host = await realModules();
  console.log(`host: ${host.entry}`);
  for (const name of HOST_EXPORTS['@earendil-works/pi-tui'])
    console.log(`  pi-tui.${name}: ${typeof host.tui[name]}`);
  for (const name of [...HOST_EXPORTS['@earendil-works/pi-coding-agent'], 'keyHint', 'keyText'])
    console.log(`  pi-coding-agent.${name}: ${typeof host.agent[name]}`);
  const table = missingHostExports(host.tui, host.agent);
  if (table.length) throw Error(`host module shape changed: missing ${table.join(', ')}`);

  const { loadExtensions, createExtensionRuntime } = await piExtensions();
  const entry = join(process.cwd(), 'index.ts');
  const loaded = await loadExtensions([entry], process.cwd(), undefined, createExtensionRuntime());
  if (loaded.errors?.length)
    throw Error(`extension did not load: ${loaded.errors.map((e) => e.error ?? e).join('; ')}`);
  const command = loaded.extensions
    .flatMap((e) => [...e.commands.values()])
    .find((c) => c.name === 'guard');
  if (!command) throw Error('the real loader did not register /guard');

  host.theme.initTheme?.();
  const theme = host.theme.theme;
  const keybindings = host.tui.getKeybindings();

  const dir = await mkdtemp(join(tmpdir(), 'guard-smoke-'));
  const state = await mkdtemp(join(tmpdir(), 'guard-smoke-state-'));
  const old = process.env.PI_SUITE_HOME;
  process.env.PI_SUITE_HOME = state;
  try {
    execFileSync('git', ['init', dir], { stdio: 'ignore' });
    await mkdir(join(dir, '.pi'), { recursive: true });
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'app.ts'), 'export const a = 1;\n');
    await writeFile(
      join(dir, '.pi', 'pi-suite.yaml'),
      'loopGuard:\n  enabled: true\n  policy: balanced\n  mode: warn\n',
    );

    const notes = [];
    const f = fakePi(dir);
    f.ctx.ui.notify = (text) => notes.push(String(text));
    f.ctx.ui.setStatus = () => {};
    f.ctx.ui.confirm = async () => false;
    let screen = null;
    let close;
    const closed = new Promise((resolve) => (close = resolve));
    f.ctx.ui.custom = (factory) => {
      screen = factory({ requestRender: () => {} }, theme, keybindings, (result) => close(result));
      return closed;
    };
    const ctx = f.ctx;
    const show = (label, limit = 30) => {
      console.log(`\n──── ${label}`);
      if (!screen) {
        console.log('   (nenhuma tela: /guard não abriu painel)');
        return;
      }
      for (const line of screen.render(96).slice(0, limit)) console.log(`   ${strip(line)}`);
    };
    const send = (bytes) => screen.handleInput(bytes);
    const saved = () => readFile(join(dir, '.pi', 'pi-suite.yaml'), 'utf8').catch(() => '(sem arquivo)');
    const waitFor = async (predicate, what, ms = 8000) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (await predicate()) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw Error(`timeout aguardando: ${what}`);
    };
    const decision = async (label, args = 'status') => {
      await command.handler(args, ctx);
      console.log(`\n${label}`);
      for (const line of String(notes.at(-1)).split('\n')) console.log('   ' + strip(line));
    };

    await decision('DECISÃO ANTES DO PAINEL (estado, limites efetivos, escopo):');
    const before = await saved();

    const rows = panelItems({ conf: guardDefaults.loopGuard, locked: {}, state: {} }).map((r) => r.id);
    const rowIndex = (id) => rows.indexOf(id);
    let cursor = 0;
    const goto = (index) => {
      const steps = (index - cursor + rows.length) % rows.length;
      for (let i = 0; i < steps; i++) send(DOWN);
      cursor = index;
      return steps;
    };
    const modeRow = rowIndex('mode');
    const incidentRow = rowIndex('incident');
    if (modeRow < 0 || incidentRow < 0) throw Error('linhas esperadas fora da tabela');

    const running = command.handler('', ctx);
    await waitFor(() => screen, 'a tela do painel aparecer');
    show('painel aberto com /guard (vazio)');

    console.log(`\n(cursor 0 → ${goto(modeRow)}× ↓ até "Modo")`);
    send(ENTER);
    await waitFor(
      async () => screen.render(96).map(strip).join("\n").includes("unsaved change"),
      'o modo virar rascunho',
    );
    send(CTRL_S);
    await waitFor(async () => (await saved()) !== before, 'Ctrl+S ter persistido o modo');
    show('após salvar o modo com Ctrl+S');
    const afterMode = parse(await saved()).loopGuard ?? {};
    if (afterMode.mode === (parse(before).loopGuard ?? {}).mode)
      throw Error('o modo não mudou no arquivo depois do Enter');

    // Two levels with navigateTo: the incident screen, then the numbers open themselves.
    console.log(`\n(cursor ${cursor} → ${goto(incidentRow)}× ↓ até "Último incidente")`);
    send(ENTER);
    show('submenu do incidente (resgates ordenados por custo)');
    send(ENTER); // picks the first row: `numbers` when nothing is quarantined
    await new Promise((r) => setImmediate(r));
    show('segundo nível aberto pelo navigateTo (Estado da detecção)');
    send(ESC);
    await new Promise((r) => setImmediate(r));
    show('após Esc: voltou um nível — o painel continua aberto');

    send(ESC);
    console.log('\nFECHAMENTO →', JSON.stringify(await closed));
    console.log('ÚLTIMAS NOTAS →', JSON.stringify(notes.slice(-4).map(firstLine)));
    await running;

    await decision('DECISÃO DEPOIS DO PAINEL (mesma pergunta, modo novo):');
    await command.handler('explain', ctx);
    console.log('\nEXPLAIN →', strip(String(notes.at(-1)).split('\n')[0]));
    console.log('\nARQUIVO FINAL GRAVADO PELO PAINEL:\n' + (await saved()).trimEnd());
    console.log('\nOK: menu abriu, navegou, persistiu e fechou com resumo contra o host real.');
  } finally {
    if (old === undefined) delete process.env.PI_SUITE_HOME;
    else process.env.PI_SUITE_HOME = old;
    await rm(dir, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  }
};

run().catch((error) => {
  console.error('SMOKE FALHOU:', error?.stack ?? error);
  process.exitCode = 1;
});
