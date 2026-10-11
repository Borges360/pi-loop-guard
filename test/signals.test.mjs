import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Guard } from '../guard.mjs';
test('general fingerprints normalize arguments, quarantine expires, override exactly once', () => {
  let time = 0;
  const g = new Guard({ mode: 'enforce', policy: 'strict', quarantineTtlSeconds: 1 }, () => time);
  const input = { query: 'x', count: 2 };
  for (let i = 0; i < 3; i++) {
    g.before(String(i), 'custom', input, 'repo');
    g.after(String(i), { isError: true, content: [{ type: 'text', text: 'same' }] });
  }
  const block = g.before('4', 'custom', { count: 2, query: 'x' }, 'repo');
  assert.equal(block.action, 'block');
  g.override(block.key, 1);
  assert.equal(g.before('5', 'custom', input, 'repo').action, 'allow');
  assert.equal(g.before('6', 'custom', input, 'repo').action, 'block');
  time = 2000;
  assert.equal(g.overrides.get(block.key).remaining, 0);
});
test('warn-only never blocks, progress proof deduplicated, weak plan churn alone not hard-stop', () => {
  const g = new Guard({ mode: 'warn', noProgressTurns: 3 });
  for (let i = 0; i < 10; i++) {
    assert.notEqual(g.before(String(i), 'custom', {}, 'repo').action, 'block');
    g.after(String(i), { isError: true, content: [] });
  }
  for (let i = 0; i < 3; i++) g.turn({ plan: true, cost: 1 });
  assert.ok(g.signals.includes('budget_burn'));
  assert.equal(g.state, 'intervention');
  assert.equal(g.observeProof({ verified: true, evidenceId: 'pass:1' }), true);
  assert.equal(g.observeProof({ verified: true, evidenceId: 'pass:1' }), false);
  assert.equal(g.observeProof({ verified: false, evidenceId: 'fake' }), false);
  assert.equal(g.state, 'normal');
});
test('polling exceptions scoped and cursor changes do not repeat', () => {
  const g = new Guard({
    mode: 'enforce',
    exceptions: [{ tool: 'poll', expiresAt: new Date(Date.now() + 1000).toISOString() }],
  });
  for (let i = 0; i < 10; i++)
    assert.equal(g.before(String(i), 'poll', {}, 'repo').action, 'allow');
  for (let i = 0; i < 10; i++) {
    assert.equal(g.before(`c${i}`, 'page', { cursor: i }, 'repo').action, 'allow');
    g.after(`c${i}`, { isError: false, content: [] });
  }
});
