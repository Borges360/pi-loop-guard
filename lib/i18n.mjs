import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const LOCALES = Object.freeze(['en', 'pt-BR']);

const EN = Object.freeze({
  language: 'Language',
  languageDescription: 'Panel language; saved only for this trusted project.',
  english: 'English (default)',
  portuguese: 'Português (Brasil)',
  guard: 'Guard',
  panelTitle: 'Guard · {status} · {mode} · {state} · {turns}/{limit} turns · {outside} out of scope',
  stateDetection: 'Detection state',
  stateIncident: 'Latest incident',
  stateQuarantine: 'Quarantined signatures',
  stateOutOfScope: 'Out-of-scope changes',
  stateHelp: 'Command-line help',
  stateDescription: '{turns} turn(s) without progress · {repeats} repeat(s) · {signals} signal(s)',
  incidentDescription: 'why it fired, with the effective thresholds that blocked the call',
  quarantineDescription: 'release once is the only way to retry what the guard paused',
  outOfScopeDescription: 'changes that did not count — a source of false no-progress signals',
  helpDescription: 'direct commands remain available with autocomplete',
  fieldDetection: 'Detection',
  fieldPolicy: 'Policy',
  fieldAction: 'Action',
  fieldToolRepeat: 'Identical calls before suspicion',
  fieldNoProgress: 'Turns without progress',
  fieldQuarantine: 'Quarantine duration',
  fieldHistory: 'History window',
  fieldScope: 'Progress scope',
  fieldScopeStrict: 'Out-of-scope changes count',
  fieldExceptions: 'Exempt tools',
  fieldRelevantPaths: 'Relevant paths',
  hintDetection: 'on watches tool calls; off watches only for silence',
  hintPolicy: 'sensitivity preset; conservative never blocks, strict blocks',
  hintAction: 'warn reports; enforce blocks repeated equivalent calls',
  hintToolRepeat: '2..100 · lower values detect sooner and may raise false positives',
  hintNoProgress: 'progress = relevant diff or gate evidence',
  hintQuarantine: 'how long a signature stays out after `/guard resume`',
  hintHistory: 'affects only this session’s streak history',
  hintScope: 'what this session considers forward progress',
  hintScopeStrict: 'on keeps detection narrow; off broadens it and shows a notice',
  hintExceptions: 'weakens detection; choose the same row twice to confirm',
  hintRelevantPaths: 'defines what detection watches; a narrower scope can cause false no-progress signals',
  noteDetectionOn: 'detection enabled',
  noteDetectionOff: 'detection disabled — nothing is blocked or recorded',
  notePolicy: 'policy {policy} · {repeat} identical calls and {turns} turns without progress · mode → {mode}',
  noteActionWarn: 'warn only; nothing is blocked',
  noteActionEnforce: '⚠ the 3rd/4th equivalent call is BLOCKED',
  noteToolRepeat: 'suspect after {count} identical calls',
  noteNoProgress: 'intervene after {count} turns without evidence',
  noteQuarantine: 'signature is eligible again after {seconds}s',
  noteHistory: 'keeps {count} events',
  noteScopeRelevant: 'only changes under `Relevant paths` count as progress',
  noteScopeAny: 'any repository change counts as progress (detects fewer loops)',
  noteScopeStrictOn: 'out-of-scope changes are shown and do not reset suspicion',
  noteScopeStrictOff: 'out-of-scope changes also reset suspicion — progress checks are broader',
  noteExemptionAdd: '⚠ exemption: {tool} will no longer be monitored — repeats will not trigger an incident',
  noteExemptionRemove: 'exemption for {tool} removed',
  notePathAdd: '{path} now counts as progress',
  notePathRemove: '{path} no longer counts as progress',
  valueOn: 'on',
  valueOff: 'off',
  valuePathCount: '{count} path(s)',
  valueNormal: 'normal',
  valueIncidentNone: 'none',
  valueActive: '{count} active',
  valueChanges: '{count} change(s)',
  valueExemptCount: '{count} exempt',
  noExemptionCandidates: 'No exemption candidates right now.',
  turnsWithoutProgress: '{count} turn(s) without progress',
  repeats: '{count} repeat(s)',
  signals: '{count} signal(s)',
  stateSummary: 'Guard · {status} · {state} · action {mode} · policy {policy}',
  thresholds: 'thresholds: {repeats} identical calls · {turns} turns without progress ({reasons})',
  activity: 'activity: {turns} turn(s) without progress · {repeats} repeat(s) · signals {signals}',
  scopeLine: 'scope: {scope} (strict {strict}) · {included} included · {outside} out of scope{paths}',
  quarantineLine: 'quarantine: {signatures} signature(s) · exemptions: {exemptions}',
  noScreen: 'This client has no custom screen; direct commands are available:',
  fallbackSummary: 'Guard — estado em primeiro lugar; comandos diretos disponíveis:',
  fallbacks: '/guard status | explain | report | resume | pause | change-strategy | abort\n/guard on | off | warn | enforce | policy strict | scope any | allow <tool>',
  noQuarantine: 'No quarantined signatures',
  nothingToRelease: 'Nothing to release right now.',
  releaseRecommended: '▸ Recommended: release {key}…',
  releasePlain: 'release {key}…',
  releaseDescription: 'expires {time} · {hits} block(s) · releases once; config is unchanged',
  removeExemption: 'Remove exemption for {tool}',
  monitorTool: 'monitor this tool again',
  exemptRecommended: '▸ Recommended: exempt {tool}',
  exemptPlain: 'exempt {tool}',
  exemptionTop: 'blocked most often this session · weakens detection · asks for confirmation',
  exemptionOther: 'exempts a tool without evidence that it blocked',
  stopCounting: 'Stop counting {path}',
  noLongerProgress: 'no longer counts as progress',
  countRecommended: '▸ Recommended: count {path}',
  countPath: 'count {path}',
  pathProgress: 'changes here reset loop suspicion',
  noIncident: 'No incident in this session.',
  incidentWhy: 'An incident appears when equivalent calls repeat or turns stop producing evidence.',
  incidentState: 'state: {state} · incident {id} · {date}',
  incidentSignals: 'signals: {signals}',
  effectiveThresholds: 'effective thresholds: {repeats} identical calls · {turns} turns · action {mode} ({reasons})',
  currentCounts: 'current counts: {repeats} repeat(s), {turns} turn(s) without progress',
  observedCost: 'observed cost: ${cost}',
  observedCostNA: 'observed cost: n/a',
  incidentActions: 'actions: {actions}',
  incidentRescue: 'release: /guard resume (one attempt) · change approach: /guard change-strategy',
  noOutOfScope: 'No changes outside the relevant paths in this session.',
  outOfScopeCount: '{count} out-of-scope change(s) did not count as progress{strict}',
  outOfScopeStrictOff: ' (counted: strict off)',
  broadenScope: 'broaden the scope with Relevant paths or switch the scope to any',
  viewThresholds: 'View blocking thresholds',
  viewThresholdsRecommended: '▸ View blocking thresholds',
  oneAttempt: 'one attempt; no configuration is written',
  weakenExemption: '⚠ weakens detection · requires the same choice twice · writes project config',
  openDetectionState: 'opens Detection state — effective thresholds and counts',
  releaseOnce: '▸ Recommended: release {key}',
  exemptIncident: '▸ Recommended: exempt {tool}',
  exemptIncidentPlain: 'exempt {tool}',
  incidentExemptionDescription: '⚠ weakens detection · requires the same choice twice · writes project config',
  panelNoIncident: 'No incident in this session.',
  panelIncidentExplanation: 'An incident appears when equivalent calls repeat or turns stop producing evidence.',
  screenState: 'Detection state',
  screenIncident: 'Latest incident · choose what to do',
  screenOutOfScope: 'Out-of-scope changes',
  screenHelp: 'Command-line help',
  screenQuarantine: 'Quarantine · release once is a rescue; exemption changes policy',
  screenExceptions: 'Exempt tools · weaken detection (choose the same value twice)',
  screenRelevantPaths: 'Relevant paths · what counts as progress',
  screenRelease: 'Release this signature',
  screenWhy: 'Why',
  screenExemptTool: 'Exempt tool',
  savingPleaseWait: 'Saving configuration… please wait.',
  saveInProgress: 'A configuration save is in progress; wait for it to finish.',
  unsavedStatus: 'Unsaved changes · Ctrl+S saves · Esc again discards.',
  unsavedWarning: 'Unsaved changes. Press Ctrl+S to save, or Esc again to discard.',
  draftStatus: '{count} unsaved change(s) · Ctrl+S saves · Esc twice discards.',
  noUnsaved: 'No unsaved changes.',
  saveUnavailable: 'Saving is unavailable; the draft is still available.',
  saveUnavailableWarning: 'Saving is unavailable; the draft was kept.',
  saving: 'Saving configuration…',
  savedPanelRemains: '{message} · panel remains open.',
  saveFailed: 'Save failed; your draft was kept. {error}',
  saveFailedRetry: 'Save failed; draft kept. {error}',
  saveNoChanges: 'No unsaved changes.',
  saved: 'Saved {count} setting change(s) to {file}.',
  savedSummary: 'Saved {count} setting change(s).',
  savedExit: 'Guard · {count} saved change(s)\n{notes}\nSaved to {file}',
  discardedExit: 'Guard · Unsaved changes discarded.',
  noChangesExit: 'Guard · No changes were made in the panel.',
  shellBack: '{back} back',
  shellMove: '{up}/{down} move · {confirm} choose · {cancel} back',
  shellChoose: '↑↓ move · Enter choose · Esc back',
  shellMain: 'Ctrl+S saves changes · Esc returns or closes.',
  chooseLanguage: 'Choose English or Brazilian Portuguese for this project.',
  confirmSame: 'Choose the same value again to confirm.',
  trustRequired: 'Trust this project to save its language preference. English remains active.',
  invalidLocale: 'The saved language is invalid; English is active until you choose a language.',
  unreadableLocale: 'The saved language could not be read; English is active.',
  languageSaved: 'Language saved: {language}.',
  noChanges: 'No unsaved changes.',
  outputNoChanges: 'Guard · no changes were made in the panel.',
  activityCost: 'observed cost: ${cost}',
  commandStatus: '/guard status — state, signals and thresholds',
  commandExplain: '/guard explain — why the last incident fired',
  commandReport: '/guard report — incident history',
  commandResume: '/guard resume — release one quarantined signature after approval',
  commandPause: '/guard pause — pause detection for this session',
  commandStrategy: '/guard change-strategy — clear streaks and try a different approach',
  commandAbort: '/guard abort — abort the current run',
  commandConfigure: '/guard on|off|warn|enforce|policy|scope|allow — update configuration',
});

const PT = Object.freeze({
  language: 'Idioma',
  languageDescription: 'Idioma do painel, salvo apenas neste projeto confiável.',
  english: 'English (padrão)',
  portuguese: 'Português (Brasil)',
  guard: 'Proteção contra loops',
  panelTitle: 'Proteção · {status} · {mode} · {state} · {turns}/{limit} turnos · {outside} fora do escopo',
  stateDetection: 'Estado da detecção',
  stateIncident: 'Incidente mais recente',
  stateQuarantine: 'Assinaturas em quarentena',
  stateOutOfScope: 'Mudanças fora do escopo',
  stateHelp: 'Ajuda dos comandos',
  stateDescription: '{turns} turno(s) sem progresso · {repeats} repetição(ões) · {signals} sinal(is)',
  incidentDescription: 'por que disparou e quais limites efetivos bloquearam a chamada',
  quarantineDescription: 'liberar uma vez é o único modo de tentar de novo o que a proteção pausou',
  outOfScopeDescription: 'mudanças que não contaram — podem causar alertas falsos de falta de progresso',
  helpDescription: 'comandos diretos continuam disponíveis com autocomplete',
  fieldDetection: 'Detecção',
  fieldPolicy: 'Política',
  fieldAction: 'Ação',
  fieldToolRepeat: 'Chamadas idênticas antes da suspeita',
  fieldNoProgress: 'Turnos sem progresso',
  fieldQuarantine: 'Duração da quarentena',
  fieldHistory: 'Janela do histórico',
  fieldScope: 'Escopo do progresso',
  fieldScopeStrict: 'Mudanças fora do escopo contam',
  fieldExceptions: 'Ferramentas isentas',
  fieldRelevantPaths: 'Caminhos relevantes',
  hintDetection: 'ativada monitora chamadas; desativada só observa silêncio',
  hintPolicy: 'nível de sensibilidade; conservadora nunca bloqueia, rigorosa bloqueia',
  hintAction: 'avisar informa; aplicar bloqueia chamadas equivalentes repetidas',
  hintToolRepeat: '2..100 · valores menores detectam antes e podem gerar falsos positivos',
  hintNoProgress: 'progresso = diff relevante ou evidência de gate',
  hintQuarantine: 'por quanto tempo a assinatura fica de fora após `/guard resume`',
  hintHistory: 'afeta apenas o histórico de repetições desta sessão',
  hintScope: 'o que esta sessão considera progresso',
  hintScopeStrict: 'ativado mantém o escopo estreito; desativado amplia e exibe um aviso',
  hintExceptions: 'enfraquece a detecção; escolha a mesma linha duas vezes para confirmar',
  hintRelevantPaths: 'define o que a detecção observa; escopo estreito pode acusar falta de progresso sem motivo',
  noteDetectionOn: 'detecção ativada',
  noteDetectionOff: 'detecção desativada — nada será bloqueado ou registrado',
  notePolicy: 'política {policy} · {repeat} chamadas idênticas e {turns} turnos sem progresso · ação → {mode}',
  noteActionWarn: 'somente avisos; nada é bloqueado',
  noteActionEnforce: '⚠ a 3ª/4ª chamada equivalente é BLOQUEADA',
  noteToolRepeat: 'suspeita após {count} chamadas idênticas',
  noteNoProgress: 'intervém após {count} turnos sem evidência',
  noteQuarantine: 'a assinatura volta a ser elegível após {seconds}s',
  noteHistory: 'mantém {count} eventos',
  noteScopeRelevant: 'só mudanças em `Caminhos relevantes` contam como progresso',
  noteScopeAny: 'qualquer mudança no repositório conta como progresso (detecta menos ciclos)',
  noteScopeStrictOn: 'mudanças fora do escopo aparecem e não reiniciam a suspeita',
  noteScopeStrictOff: 'mudanças fora do escopo também reiniciam a suspeita — a verificação fica mais ampla',
  noteExemptionAdd: '⚠ isenção: {tool} deixará de ser monitorada — repetições não gerarão incidentes',
  noteExemptionRemove: 'isenção de {tool} removida',
  notePathAdd: '{path} passa a contar como progresso',
  notePathRemove: '{path} deixa de contar como progresso',
  valueOn: 'Ativada',
  valueOff: 'Desativada',
  valuePathCount: '{count} caminho(s)',
  valueNormal: 'normal',
  valueIncidentNone: 'nenhum',
  valueActive: '{count} ativa(s)',
  valueChanges: '{count} mudança(s)',
  valueExemptCount: '{count} isenta(s)',
  noExemptionCandidates: 'Nenhuma ferramenta candidata a isenção agora.',
  turnsWithoutProgress: '{count} turno(s) sem progresso',
  repeats: '{count} repetição(ões)',
  signals: '{count} sinal(is)',
  stateSummary: 'Proteção · {status} · {state} · ação {mode} · política {policy}',
  thresholds: 'limites: {repeats} chamadas idênticas · {turns} turnos sem progresso ({reasons})',
  activity: 'atividade: {turns} turno(s) sem progresso · {repeats} repetição(ões) · sinais {signals}',
  scopeLine: 'escopo: {scope} (estrito {strict}) · {included} incluído(s) · {outside} fora do escopo{paths}',
  quarantineLine: 'quarentena: {signatures} assinatura(s) · isenções: {exemptions}',
  noScreen: 'Este cliente não tem tela personalizada; use os comandos diretos:',
  fallbackSummary: 'Proteção — estado primeiro; comandos diretos disponíveis:',
  fallbacks: '/guard status | explain | report | resume | pause | change-strategy | abort\n/guard on | off | warn | enforce | policy strict | scope any | allow <tool>',
  noQuarantine: 'Não há assinaturas em quarentena',
  nothingToRelease: 'Nada para liberar agora.',
  releaseRecommended: '▸ Recomendado: liberar {key}…',
  releasePlain: 'liberar {key}…',
  releaseDescription: 'expira às {time} · {hits} bloqueio(s) · libera uma vez; configuração inalterada',
  removeExemption: 'Remover isenção de {tool}',
  monitorTool: 'voltar a monitorar esta ferramenta',
  exemptRecommended: '▸ Recomendado: isentar {tool}',
  exemptPlain: 'isentar {tool}',
  exemptionTop: 'mais bloqueada nesta sessão · enfraquece a detecção · pede confirmação',
  exemptionOther: 'isenta uma ferramenta sem evidência de bloqueio',
  stopCounting: 'Parar de contar {path}',
  noLongerProgress: 'deixa de contar como progresso',
  countRecommended: '▸ Recomendado: contar {path}',
  countPath: 'contar {path}',
  pathProgress: 'mudanças aqui reiniciam a suspeita de ciclo',
  noIncident: 'Nenhum incidente nesta sessão.',
  incidentWhy: 'Um incidente aparece quando chamadas equivalentes se repetem ou turnos deixam de produzir evidências.',
  incidentState: 'estado: {state} · incidente {id} · {date}',
  incidentSignals: 'sinais: {signals}',
  effectiveThresholds: 'limites efetivos: {repeats} chamadas idênticas · {turns} turnos · ação {mode} ({reasons})',
  currentCounts: 'contagem atual: {repeats} repetição(ões), {turns} turno(s) sem progresso',
  observedCost: 'custo observado: ${cost}',
  observedCostNA: 'custo observado: n/d',
  incidentActions: 'ações: {actions}',
  incidentRescue: 'liberar: /guard resume (uma tentativa) · mudar estratégia: /guard change-strategy',
  noOutOfScope: 'Nenhuma mudança fora dos caminhos relevantes nesta sessão.',
  outOfScopeCount: '{count} mudança(s) fora do escopo não contou(aram) como progresso{strict}',
  outOfScopeStrictOff: ' (contadas: estrito desativado)',
  broadenScope: 'amplie o escopo em Caminhos relevantes ou mude o escopo para any',
  viewThresholds: 'Ver limites de bloqueio',
  viewThresholdsRecommended: '▸ Ver limites de bloqueio',
  oneAttempt: 'uma tentativa; nenhuma configuração será gravada',
  weakenExemption: '⚠ enfraquece a detecção · exige a mesma escolha duas vezes · grava a configuração do projeto',
  openDetectionState: 'abre Estado da detecção — limites efetivos e contagens',
  releaseOnce: '▸ Recomendado: liberar {key}',
  exemptIncident: '▸ Recomendado: isentar {tool}',
  exemptIncidentPlain: 'isentar {tool}',
  incidentExemptionDescription: '⚠ enfraquece a detecção · exige a mesma escolha duas vezes · grava a configuração do projeto',
  panelNoIncident: 'Nenhum incidente nesta sessão.',
  panelIncidentExplanation: 'Um incidente aparece quando chamadas equivalentes se repetem ou turnos deixam de produzir evidências.',
  screenState: 'Estado da detecção',
  screenIncident: 'Incidente mais recente · escolha uma ação',
  screenOutOfScope: 'Mudanças fora do escopo',
  screenHelp: 'Ajuda dos comandos',
  screenQuarantine: 'Quarentena · liberar uma vez é resgate; isenção altera a política',
  screenExceptions: 'Ferramentas isentas · enfraquece a detecção (escolha o mesmo valor duas vezes)',
  screenRelevantPaths: 'Caminhos relevantes · o que conta como progresso',
  screenRelease: 'Liberar esta assinatura',
  screenWhy: 'Por quê',
  screenExemptTool: 'Isentar ferramenta',
  savingPleaseWait: 'Salvando configuração… aguarde.',
  saveInProgress: 'Uma gravação está em andamento; aguarde a conclusão.',
  unsavedStatus: 'Alterações sem salvar · Ctrl+S salva · Esc novamente descarta.',
  unsavedWarning: 'Há alterações sem salvar. Ctrl+S salva; pressione Esc novamente para descartar.',
  draftStatus: '{count} alteração(ões) sem salvar · Ctrl+S salva · Esc duas vezes descarta.',
  noUnsaved: 'Não há alterações sem salvar.',
  saveUnavailable: 'O salvamento está indisponível; o rascunho continua acessível.',
  saveUnavailableWarning: 'O salvamento está indisponível; o rascunho foi mantido.',
  saving: 'Salvando configuração…',
  savedPanelRemains: '{message} · o painel continua aberto.',
  saveFailed: 'Falha ao salvar; o rascunho foi mantido. {error}',
  saveFailedRetry: 'Falha ao salvar; rascunho mantido. {error}',
  saveNoChanges: 'Não há alterações sem salvar.',
  saved: '{count} alteração(ões) salva(s) em {file}.',
  savedSummary: '{count} alteração(ões) salva(s).',
  savedExit: 'Proteção · {count} alteração(ões) salva(s)\n{notes}\nSalvo em {file}',
  discardedExit: 'Proteção · alterações sem salvar descartadas.',
  noChangesExit: 'Proteção · nenhuma alteração foi feita no painel.',
  shellBack: '{back} voltar',
  shellMove: '{up}/{down} mover · {confirm} escolher · {cancel} voltar',
  shellChoose: '↑↓ mover · Enter escolher · Esc voltar',
  shellMain: 'Ctrl+S salva mudanças · Esc volta ou fecha.',
  chooseLanguage: 'Escolha inglês ou português brasileiro para este projeto.',
  confirmSame: 'Escolha o mesmo valor novamente para confirmar.',
  trustRequired: 'Confie neste projeto para salvar a preferência de idioma. O inglês continua ativo.',
  invalidLocale: 'O idioma salvo é inválido; o inglês fica ativo até você escolher outro.',
  unreadableLocale: 'Não foi possível ler o idioma salvo; o inglês fica ativo.',
  languageSaved: 'Idioma salvo: {language}.',
  noChanges: 'Não há alterações sem salvar.',
  outputNoChanges: 'Proteção · nenhuma alteração foi feita no painel.',
  activityCost: 'custo observado: ${cost}',
  commandStatus: '/guard status — estado, sinais e limites',
  commandExplain: '/guard explain — motivo do último incidente',
  commandReport: '/guard report — histórico de incidentes',
  commandResume: '/guard resume — liberar uma assinatura em quarentena após aprovação',
  commandPause: '/guard pause — pausar a detecção nesta sessão',
  commandStrategy: '/guard change-strategy — limpar repetições e tentar outra abordagem',
  commandAbort: '/guard abort — interromper a execução atual',
  commandConfigure: '/guard on|off|warn|enforce|policy|scope|allow — atualizar configuração',
});

export const CATALOGS = Object.freeze({ en: EN, 'pt-BR': PT });

export function translate(locale, key, values = {}) {
  const template = CATALOGS[locale]?.[key] ?? EN[key];
  if (typeof template !== 'string') return key;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}

function templateRegex(template) {
  let pattern = '^';
  const names = [];
  let cursor = 0;
  for (const match of template.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
    pattern += template.slice(cursor, match.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([\\s\\S]*?)';
    names.push(match[1]);
    cursor = match.index + match[0].length;
  }
  pattern += template.slice(cursor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
  return { regex: new RegExp(pattern), names };
}

/** Translate only complete known UI phrases; embedded command IDs, paths, and signals stay intact. */
export function translateText(locale, text) {
  const source = String(text);
  if (locale !== 'pt-BR') return source;
  for (const [key, template] of Object.entries(EN)) {
    const { regex, names } = templateRegex(template);
    const match = regex.exec(source);
    if (!match) continue;
    return translate(locale, key, Object.fromEntries(names.map((name, index) => [name, match[index + 1]])));
  }
  return source;
}

export function localizedPanelItem(locale, item) {
  return {
    ...item,
    label: translateText(locale, item.label),
    description: translateText(locale, item.description),
    currentValue: translateText(locale, item.currentValue),
  };
}

export function localeName(locale) {
  return translate(locale, locale === 'pt-BR' ? 'portuguese' : 'english');
}

export function localeShell(localeOrGetter) {
  const currentLocale = () => typeof localeOrGetter === 'function' ? localeOrGetter() : localeOrGetter;
  return {
    text: (value) => translateText(currentLocale(), value),
    navHint: ({ up, down, confirm, cancel }) =>
      translate(currentLocale(), 'shellMove', { up, down, confirm, cancel }),
    backHint: (back) => translate(currentLocale(), 'shellBack', { back }),
    savedPanelRemains: (message) => translate(currentLocale(), 'savedPanelRemains', { message }),
  };
}

export async function readProjectLocale({ root, trusted }) {
  if (!trusted || typeof root !== 'string' || !root)
    return { locale: 'en', canPersist: false, issue: null, file: null };
  const file = join(resolve(root), '.pi', 'pi-loop-guard.locale.json');
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    if (saved?.schemaVersion !== 1 || !LOCALES.includes(saved.locale))
      return { locale: 'en', canPersist: true, issue: 'invalid', file };
    return { locale: saved.locale, canPersist: true, issue: null, file };
  } catch (error) {
    if (error?.code === 'ENOENT') return { locale: 'en', canPersist: true, issue: null, file };
    return { locale: 'en', canPersist: true, issue: 'unreadable', file };
  }
}

export async function writeProjectLocale({ root, trusted, locale, signal }) {
  if (!trusted || typeof root !== 'string' || !root)
    throw new Error('Project trust is required to save a project language preference.');
  if (!LOCALES.includes(locale)) throw new Error('Unsupported language preference.');
  if (signal?.aborted) throw signal.reason ?? new Error('Operation canceled');
  const file = join(resolve(root), '.pi', 'pi-loop-guard.locale.json');
  const temp = file + '.' + randomUUID() + '.tmp';
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temp, JSON.stringify({ schemaVersion: 1, locale }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (signal?.aborted) throw signal.reason ?? new Error('Operation canceled');
    await rename(temp, file);
    return file;
  } finally {
    await unlink(temp).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  }
}

export function catalogKeys(locale = 'en') {
  return Object.keys(CATALOGS[locale] ?? EN);
}

export function placeholderNames(template) {
  return [...template.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort();
}

export function wrapPanelText(text, width) {
  const lines = [];
  for (const source of String(text).split('\n')) {
    const words = source.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      if (word.length > width) {
        if (line) lines.push(line);
        for (let index = 0; index < word.length; index += width) lines.push(word.slice(index, index + width));
        line = '';
      } else if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ' ' + word;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  }
  return lines;
}
