import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import install from '../extension.mjs';
import { fakePi } from '../test-support/fakes.mjs';
test('semantic source edit permits retest; cosmetic/documentation edit does not reset streak', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'guard-runtime-')),
    state = await mkdtemp(join(tmpdir(), 'guard-state-'));
  const old = process.env.PI_SUITE_HOME;
  process.env.PI_SUITE_HOME = state;
  try {
    execFileSync('git', ['init', dir], { stdio: 'ignore' });
    await writeFile(join(dir, 'code.js'), 'const value=1;\n');
    const f = fakePi(dir);
    install(f.pi);
    await f.emit('session_start');
    await f.command('guard', 'policy strict');
    const call = (id) =>
      f.emit('tool_call', { toolCallId: id, toolName: 'bash', input: { command: 'npm test' } });
    const result = (id) =>
      f.emit('tool_result', {
        toolCallId: id,
        toolName: 'bash',
        input: { command: 'npm test' },
        isError: true,
        content: [{ type: 'text', text: 'failure' }],
      });
    for (let i = 0; i < 3; i++) {
      assert.equal((await call(String(i)))?.block, undefined);
      await result(String(i));
    }
    await writeFile(join(dir, 'README.md'), 'not source progress');
    assert.equal((await call('4')).block, true);
    await writeFile(join(dir, 'code.js'), 'const value=2;\n');
    assert.equal((await call('5'))?.block, undefined);
    await f.emit('session_shutdown');
  } finally {
    if (old === undefined) delete process.env.PI_SUITE_HOME;
    else process.env.PI_SUITE_HOME = old;
    await rm(dir, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  }
});
