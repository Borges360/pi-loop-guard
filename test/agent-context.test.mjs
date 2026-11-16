import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const normalize = (text) => text.replace(/\s+/gu, ' ').trim();

test('Loop Guard specialization and metadata match across clients', () => {
  const skill = read('.agents/skills/pi-loop-guard/SKILL.md');
  const cursorSkill = read('.cursor/skills/pi-loop-guard/SKILL.md');
  const metadata = read('.agents/skills/pi-loop-guard/metadata.yaml');
  const cursorMetadata = read('.cursor/skills/pi-loop-guard/metadata.yaml');
  assert.equal(cursorSkill, skill);
  assert.equal(cursorMetadata, metadata);
  for (const field of ['id: pi-loop-guard', 'owner: pi-loop-guard', 'version: 1.0.0', 'scope: "product-local; Pi, Codex and Cursor"']) {
    assert.ok(metadata.includes(field), field);
  }
});

test('product context stays local and preserves the native Pi boundary', () => {
  const agents = read('AGENTS.md');
  const marker = agents.indexOf('<!-- harness:start -->');
  assert.ok(marker > 0);
  const preamble = agents.slice(0, marker);
  assert.ok(preamble.includes('.agents/skills/pi-loop-guard/SKILL.md'));
  assert.doesNotMatch(preamble, /INTEIRO/i);
  const skill = read('.agents/skills/pi-loop-guard/SKILL.md');
  assert.match(skill, /does not call an LLM to decide whether a loop exists/u);
  assert.match(skill, /not a security boundary or an OS sandbox/u);
});

test('specialization matches the documented loop policy, config and save behavior', () => {
  const skill = read('.agents/skills/pi-loop-guard/SKILL.md');
  const readme = normalize(read('README.md'));
  const packageJson = JSON.parse(read('package.json'));
  const extension = read('extension.mjs');
  assert.equal(packageJson.name, 'pi-loop-guard');
  assert.equal(packageJson.version, '0.3.0');
  assert.match(extension, /createRuntime\(pi, 'guard', defaults\)/u);
  for (const phrase of [
    'does not call an LLM to decide whether a loop exists',
    '`warn` reports suspicion without blocking a tool call',
    'four equivalent calls, five turns without verified progress',
    'Configuration edits are drafts until Ctrl+S',
    'reads/writes only `loopGuard` in `pi-suite.yaml`',
  ]) assert.ok(normalize(skill).includes(normalize(phrase)), phrase);
  for (const phrase of [
    'The guard uses deterministic local signals; it does not call an LLM to decide whether a loop exists.',
    '`warn` never blocks.',
    'press `Ctrl+S`',
    'reads and writes only the `loopGuard` section of `pi-suite.yaml`',
  ]) assert.ok(readme.includes(normalize(phrase)), phrase);
});
