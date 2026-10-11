import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Guard } from '../guard.mjs';
const input = { command: 'npm test' };
test('warn after two, block fourth, edits reset', () => {
  const g = new Guard();
  for (let n = 0; n < 3; n++) {
    const d = g.before(String(n), 'bash', input, '/repo', true);
    assert.equal(d.action, n === 2 ? 'warn' : 'allow');
    g.after(String(n), { isError: true, content: [{ type: 'text', text: 'failure' }] });
  }
  assert.equal(g.before('4', 'bash', input, '/repo', true).action, 'block');
  g.reset();
  assert.equal(g.before('5', 'bash', input, '/repo', true).action, 'allow');
});
test('parallel calls and differing results do not cause false positives', () => {
  const g = new Guard();
  g.before('a', 'bash', input, '/repo', true);
  g.before('b', 'bash', input, '/repo', true);
  g.after('a', { isError: true, content: [] });
  g.after('b', { isError: true, content: [] });
  assert.equal(g.count, 1);
  g.before('c', 'bash', input, '/repo', true);
  g.after('c', { isError: false, content: [] });
  assert.equal(g.count, 1);
  assert.equal(g.before('x', 'read', { path: 'x' }, '/repo', true).action, 'allow');
});
