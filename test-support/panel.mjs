/**
 * Shared fixture for the `/guard` panel tests: a throwaway git project, the fake TUI
 * wired through the `host` seam, and the real `extension.mjs` on a fake `pi`.
 *
 * Nothing here calls a model, and nothing here waits on a tick budget: the drivers in
 * `fake-tui.mjs` return the promise the component returned, and `waitFor` polls an
 * observable effect (the file on disk) when a test cannot await it.
 */
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseDocument } from 'yaml';
import install from '../extension.mjs';
import { host } from '../menu.mjs';
import { fakeTui, withCustomUi } from './fake-tui.mjs';
import { fakePi } from './fakes.mjs';

export const CONFIG = 'loopGuard:\n  enabled: true\n  policy: balanced\n  mode: warn\n';

export async function guardEnv(
  t,
  { config = CONFIG, global = null, seed = { 'code.js': 'const value=1;\n' } } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'guard-panel-'));
  const old = process.env.PI_SUITE_HOME;
  process.env.PI_SUITE_HOME = join(dir, 'state');
  const savedHost = { tui: host.tui, agent: host.agent };
  t.after(async () => {
    process.env.PI_SUITE_HOME = old;
    host.tui = savedHost.tui;
    host.agent = savedHost.agent;
    await rm(dir, { recursive: true, force: true });
  });
  execFileSync('git', ['init', dir], { stdio: 'ignore' });
  await mkdir(join(dir, 'state'), { recursive: true });
  if (global) await writeFile(join(dir, 'state', 'config.yaml'), global);
  await mkdir(join(dir, '.pi'), { recursive: true });
  for (const [name, body] of Object.entries(seed)) {
    const target = join(dir, name);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, body);
  }
  if (config) await writeFile(join(dir, '.pi', 'pi-suite.yaml'), config);
  const tui = fakeTui();
  host.tui = tui.tuiPkg;
  host.agent = tui.agentPkg;
  const f = fakePi(dir);
  withCustomUi(f.ctx, tui);
  const command = (args) => f.command('guard', args);
  install(f.pi);
  await f.emit('session_start');
  const env = {
    dir,
    f,
    tui,
    command,
    /** Repeats one equivalent call until the guard starts objecting. */
    hammer: async (n = 4, command1 = 'npm test') => {
      const results = [];
      for (let i = 0; i < n; i++) {
        results.push(
          await f.emit('tool_call', {
            toolCallId: `c${i}`,
            toolName: 'bash',
            input: { command: command1 },
          }),
        );
        await f.emit('tool_result', {
          toolCallId: `c${i}`,
          toolName: 'bash',
          input: { command: command1 },
          isError: true,
          content: [{ type: 'text', text: 'failure' }],
        });
      }
      return results;
    },
    settings: () => tui.created.settings[0],
    saved: async () =>
      (parseDocument(await readFile(join(dir, '.pi', 'pi-suite.yaml'), 'utf8')).toJS() ?? {})
        .loopGuard,
    file: async () => {
      try {
        return await readFile(join(dir, '.pi', 'pi-suite.yaml'), 'utf8');
      } catch {
        return '';
      }
    },
    open: async () => {
      const settled = { done: false };
      const running = command('')
        .then((r) => {
          settled.done = true;
          return r;
        })
        .catch((e) => {
          settled.done = true;
          throw e;
        });
      await waitFor(() => f.ctx.lastScreen || settled.done, 'abrir o painel (ou degradar)');
      return { running };
    },
  };
  return env;
}

/** Waits on an observable effect, never on a number of ticks. */
export async function waitFor(predicate, what, ms = 4000) {
  const until = Date.now() + ms;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > until) throw Error(`timeout aguardando: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
