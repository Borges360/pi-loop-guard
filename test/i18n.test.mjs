import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CATALOGS,
  LOCALES,
  catalogKeys,
  placeholderNames,
  readProjectLocale,
  translate,
  translateText,
  wrapPanelText,
  writeProjectLocale,
} from '../lib/i18n.mjs';

test('English and Brazilian Portuguese catalogs have matching keys and placeholders', () => {
  assert.deepEqual([...catalogKeys('en')].sort(), [...catalogKeys('pt-BR')].sort());
  assert.deepEqual([...LOCALES].sort(), ['en', 'pt-BR']);
  for (const key of catalogKeys('en')) {
    assert.deepEqual(
      placeholderNames(CATALOGS.en[key]),
      placeholderNames(CATALOGS['pt-BR'][key]),
      `${key} placeholders`,
    );
  }
});

test('translation preserves values, paths, command names, and unknown source text', () => {
  const title = translateText('pt-BR', 'Guard · ON · warn · normal · 0/5 turns · 2 out of scope');
  assert.match(title, /^Proteção · ON · warn · normal · 0\/5 turnos · 2 fora do escopo$/);
  const path = 'C:\\repo\\src\\a.ts';
  const row = translateText('pt-BR', `${path} now counts as progress`);
  assert.equal(row, `${path} passa a contar como progresso`);
  assert.match(translateText('pt-BR', '/guard resume (one attempt)'), /\/guard resume/);
  for (const [english, portuguese] of [
    ['Latest incident · choose what to do', 'Incidente mais recente · escolha uma ação'],
    ['Out-of-scope changes', 'Mudanças fora do escopo'],
    ['Command-line help', 'Ajuda dos comandos'],
    ['Quarantine · release once is a rescue; exemption changes policy', 'Quarentena · liberar uma vez é resgate; isenção altera a política'],
    ['Exempt tools · weaken detection (choose the same value twice)', 'Ferramentas isentas · enfraquece a detecção (escolha o mesmo valor duas vezes)'],
    ['Relevant paths · what counts as progress', 'Caminhos relevantes · o que conta como progresso'],
    ['Release this signature', 'Liberar esta assinatura'],
    ['Why', 'Por quê'],
    ['Exempt tool', 'Isentar ferramenta'],
  ]) assert.equal(translateText('pt-BR', english), portuguese);
  assert.equal(translateText('pt-BR', 'an extension-specific unknown phrase'), 'an extension-specific unknown phrase');
  assert.equal(translate('pt-BR', 'notAKey'), 'notAKey');
});

test('catalog strings wrap within narrow and wide terminal widths', () => {
  for (const locale of LOCALES) {
    for (const [key, template] of Object.entries(CATALOGS[locale])) {
      const values = Object.fromEntries(placeholderNames(template).map((name) => [name, 'valor-áéç-123']));
      const text = translate(locale, key, values);
      for (const width of [40, 80, 120]) {
        const lines = wrapPanelText(text, width);
        assert.ok(lines.length > 0, `${locale}.${key} produced no lines`);
        assert.ok(lines.every((line) => line.length <= width), `${locale}.${key} exceeded ${width} columns`);
      }
    }
  }
});

test('project language preference defaults safely and persists only for a trusted project', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'loop-guard-i18n-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  assert.deepEqual(await readProjectLocale({ root, trusted: true }), {
    locale: 'en',
    canPersist: true,
    issue: null,
    file: join(root, '.pi', 'pi-loop-guard.locale.json'),
  });
  assert.deepEqual(await readProjectLocale({ root, trusted: false }), {
    locale: 'en',
    canPersist: false,
    issue: null,
    file: null,
  });
  await assert.rejects(writeProjectLocale({ root, trusted: false, locale: 'pt-BR' }), /trust/i);

  await writeProjectLocale({ root, trusted: true, locale: 'pt-BR' });
  assert.deepEqual(JSON.parse(await readFile(join(root, '.pi', 'pi-loop-guard.locale.json'), 'utf8')), {
    schemaVersion: 1,
    locale: 'pt-BR',
  });
  assert.equal((await readProjectLocale({ root, trusted: true })).locale, 'pt-BR');
  assert.equal((await readProjectLocale({ root, trusted: false })).locale, 'en');
});

test('invalid or unreadable project language falls back to English', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'loop-guard-i18n-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, '.pi');
  const file = join(dir, 'pi-loop-guard.locale.json');
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify({ schemaVersion: 9, locale: 'pt-BR' }));
  assert.deepEqual(await readProjectLocale({ root, trusted: true }), {
    locale: 'en',
    canPersist: true,
    issue: 'invalid',
    file,
  });
  await writeFile(file, '{');
  assert.equal((await readProjectLocale({ root, trusted: true })).issue, 'unreadable');
});

test('an already-aborted save creates no preference directory or temporary file', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'loop-guard-i18n-abort-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const controller = new AbortController();
  controller.abort(new Error('test canceled'));
  await assert.rejects(
    writeProjectLocale({ root, trusted: true, locale: 'pt-BR', signal: controller.signal }),
    /test canceled/,
  );
  assert.deepEqual(await (await import('node:fs/promises')).readdir(root), []);
});
