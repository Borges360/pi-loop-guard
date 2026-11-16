import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { guardEnv, waitFor } from '../test-support/panel.mjs';
import { fakeTui, withCustomUi } from '../test-support/fake-tui.mjs';
import { runDashboard } from '../menu.mjs';

test('panel edits are drafts until Ctrl+S and successful save keeps the panel open', async (t) => {
  const env = await guardEnv(t);
  const { running } = await env.open();
  const settings = env.settings();
  const before = await env.file();

  await settings.cycle('toolRepeat', '8');
  assert.equal(await env.file(), before, 'editing must not write configuration');
  assert.equal(settings.find('toolRepeat').currentValue, '8', 'the row shows the draft value');
  assert.match(env.f.ctx.lastScreen.render(80).join('\n'), /unsaved change\(s\).*Ctrl\+S/);

  env.f.ctx.lastScreen.handleInput('\u0013');
  await waitFor(async () => (await env.saved()).repeatedIdenticalCalls === 8, 'Ctrl+S save');
  assert.ok(env.f.ctx.lastScreen, 'saving leaves the panel open');
  assert.match(env.tui.created.text.map((item) => item.text).join('\n'), /Saved 1 setting change/);
  settings.onCancel();
  await running;
});

test('save failure keeps the draft and a later Ctrl+S retries successfully', async (t) => {
  const env = await guardEnv(t);
  const { running } = await env.open();
  const settings = env.settings();
  const target = join(env.dir, '.pi', 'pi-suite.yaml');
  const original = await env.file();

  await settings.cycle('toolRepeat', '8');
  await rm(target);
  await mkdir(target);
  env.f.ctx.lastScreen.handleInput('\u0013');
  await waitFor(
    () => env.f.notifications.some((message) => /Save failed; your draft was kept/i.test(String(message))),
    'visible save failure',
  );
  assert.equal(settings.find('toolRepeat').currentValue, '8', 'the failed save leaves the draft visible');
  await assert.rejects(readFile(target, 'utf8'));

  await rm(target, { recursive: true });
  await writeFile(target, original);
  env.f.ctx.lastScreen.handleInput('\u0013');
  await waitFor(async () => (await env.saved()).repeatedIdenticalCalls === 8, 'save retry');
  assert.ok(env.f.ctx.lastScreen, 'the retry also leaves the panel open');
  settings.onCancel();
  await running;
});

test('Escape returns from a submenu, warns once, then discards the root draft', async (t) => {
  const env = await guardEnv(t);
  const { running } = await env.open();
  const settings = env.settings();
  const before = await env.file();

  await settings.cycle('policy', 'strict');
  settings.open('exceptions');
  env.tui.created.select.at(-1).cancel();
  assert.ok(env.f.ctx.lastScreen, 'Escape in a submenu returns to the root panel');
  assert.equal(await env.file(), before, 'navigation still does not save the draft');

  env.f.ctx.lastScreen.handleInput('\u001b');
  assert.ok(env.f.ctx.lastScreen, 'the first root Escape warns instead of closing');
  assert.match(env.f.notifications.at(-1), /Unsaved changes/);
  env.f.ctx.lastScreen.handleInput('\u001b');
  await running;
  assert.equal(await env.file(), before, 'the second Escape discards without writing');
  assert.equal(env.f.ctx.customResult.discarded, true);
  assert.match(String(env.f.notifications.at(-1)), /Unsaved changes discarded/);
});

test('late async action results cannot update a closed dashboard', async () => {
  const tui = fakeTui();
  const notifications = [];
  const ctx = { mode: 'tui', ui: { notify: (message) => notifications.push(String(message)) } };
  withCustomUi(ctx, tui);
  let resolveChange;
  const delayed = new Promise((resolve) => {
    resolveChange = resolve;
  });
  const running = runDashboard(
    {
      ctx,
      title: 'Guard',
      items: [{ id: 'mode', label: 'Action', currentValue: 'warn', values: ['warn', 'enforce'] }],
      onChange: () => delayed,
      onSave: async () => ({ ok: true, note: 'Saved.' }),
      menus: {},
    },
    { tuiPkg: tui.tuiPkg, agentPkg: tui.agentPkg },
  );
  await waitFor(() => ctx.lastScreen, 'custom dashboard');
  const pending = tui.created.settings[0].cycle('mode', 'enforce');
  ctx.lastScreen.handleInput('\u001b');
  await running;
  resolveChange({ kind: 'action', note: 'late result must stay hidden' });
  await pending;
  assert.ok(!notifications.includes('late result must stay hidden'));
});

test('English labels, Unicode and 40/80/120-column renders remain usable', async (t) => {
  const env = await guardEnv(t, { config: 'loopGuard:\n  policy: strict\n  mode: enforce\n' });
  await env.hammer(4);
  const { running } = await env.open();
  const settings = env.settings();
  for (const width of [40, 80, 120]) {
    const rendered = env.f.ctx.lastScreen.render(width).join('\n');
    assert.match(rendered, /Detection state/);
    assert.match(rendered, /Ctrl\+S saves/);
    assert.ok(!rendered.includes('\uFFFD'), `no replacement character at ${width} columns`);
  }
  settings.open('incident');
  const incident = env.tui.created.select.at(-1).render(40).join('\n');
  assert.match(incident, /Recommended/);
  assert.ok(incident.includes('▸'), 'the native recommendation marker remains Unicode-safe');
  settings.onCancel();
  await running;
});
