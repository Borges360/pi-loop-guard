# Pi Loop Guard

Detect repeated work without verified progress in Pi Coding Agent. The guard uses deterministic local signals; it does not call an LLM to decide whether a loop exists.

**Package:** `pi-loop-guard` · **version:** `0.3.0` · **Node.js:** `>=20`

**Distribution:** the current manifest sets `private: true`. This repository copy is for local installation and development; npm publication and registry availability have not been verified. The package declares Pi host peer dependencies as `*`; that declaration is not a compatibility guarantee. One offline command observation was made on Pi CLI `1.4.0`; a full host-version matrix has not been tested.

## English

### Install locally

From the directory that contains the cloned `pi-loop-guard` folder:

~~~sh
pi install ./pi-loop-guard
~~~

Pi's installer adds the local extension to Pi settings and may resolve the declared `yaml` dependency. This README does not claim that the package is published to npm.

### Development checks

From the repository root:

~~~sh
npm test
npm pack --dry-run --ignore-scripts
~~~

These commands run the unit suite and preview the package contents; the preview does not publish or create a registry release.

### Use

Run `/guard` with no arguments to open the interactive panel. In a client without a custom UI, the command prints a text status and command summary instead.

| Command | Effect |
| --- | --- |
| `/guard status` | Show state, effective thresholds, progress scope, quarantine, and exemptions. |
| `/guard help` | Show the command grammar and available values. |
| `/guard on` / `/guard off` | Enable or disable detection. `off` stops detection. |
| `/guard warn` / `/guard enforce` | Choose warning-only or blocking behavior. `warn` never blocks. |
| `/guard policy conservative\|balanced\|strict` | Set a preset and its mode. `strict` selects `enforce`; `conservative` never blocks. |
| `/guard tool-repeat N` | Set the repeated-call threshold. Suggested values: `3`, `4`, `5`, `6`, `8`. |
| `/guard no-progress-turns N` | Set the no-progress threshold. Suggested values: `3`, `4`, `5`, `8`, `12`. |
| `/guard quarantine SECONDS` | Set quarantine expiry: `60`, `120`, `600`, or `3600` seconds. |
| `/guard window N` | Set the event window: `25`, `50`, `100`, or `200`. |
| `/guard scope relevant\|any` | Count changes in configured relevant paths or anywhere in the repository as progress. |
| `/guard strict on\|off` | Decide whether out-of-scope changes leave the current suspicion unchanged or relax it. |
| `/guard allow TOOL` / `/guard unallow TOOL` | Add or remove a tool exemption. Adding one requires confirmation and weakens detection for that tool. |
| `/guard pause` / `/guard resume` | Pause detection for the session, or request approval for one quarantined retry. |
| `/guard explain` | Explain the most recent incident and its measurements. |
| `/guard report --task ID` | Show recent loop audit events for a task. |
| `/guard change-strategy` | Clear the current streaks after choosing a different approach. |
| `/guard escalate` | Request human intervention; it does not select a model or continue automatically. |
| `/guard abort` | Abort the current Pi run. |

### Defaults and behavior

Detection starts enabled in `warn` mode with the `balanced` preset: four equivalent calls, five turns without verified progress, a 120-second quarantine, and a 50-event window. The preset thresholds are:

| Preset | Mode | Equivalent calls | Turns without progress |
| --- | --- | ---: | ---: |
| `conservative` | `warn` | 6 | 8 |
| `balanced` | `warn` | 4 | 5 |
| `strict` | `enforce` | 3 | 4 |

`warn` reports a suspected loop without blocking a tool call. In `enforce`, the guard can block a repeated equivalent call after the configured threshold. A verified progress signal can clear a streak or quarantine. Signals include tool-call fingerprints and repository progress within the selected scope; semantic normalization is conservative and is not a parser for every programming language. A new diff is not proof that a change is correct.

The guard does not automatically continue a task, change models, or override a deny from another extension. `resume` requires human approval and releases one retry. `/guard allow` requires a confirmation because an exempt tool is no longer monitored for repeated calls.

### Configuration and state

The extension reads and writes only the `loopGuard` section of `pi-suite.yaml`. In a trusted project, settings are saved to `.pi/pi-suite.yaml`. In an untrusted project, settings fall back to the global file `~/.pi/agent/pi-suite/config.yaml`. The global policy may lock fields and prevent changes. `PI_SUITE_HOME` changes the suite root used for global configuration and state.

For example, in a trusted project:

~~~yaml
loopGuard:
  enabled: true
  mode: warn
  policy: balanced
  repeatedIdenticalCalls: 4
  noProgressTurns: 5
  quarantineTtlSeconds: 120
  windowSize: 50
  relevantPaths:
    - "**"
  scope:
    source: relevant
    strict: true
~~~

Panel configuration changes remain a draft until you press `Ctrl+S`. A successful save keeps the panel open; a failed save keeps the draft so you can retry. `Esc` in a submenu returns to the panel. If the root panel has unsaved changes, the first `Esc` warns and the second discards them. The explicit release-once action remains separate from configuration saving. Direct setting commands still apply immediately.

Guard state and audit records are stored as local JSON/JSONL files under the suite storage root, separated by project and Pi session/task. The extension does not require a database or a hosted service for loop detection. These files are not an operating-system sandbox: Pi and the extension run with the current user's permissions.

### Language

The panel uses English on first use and falls back to English if the saved preference is missing, invalid, or unreadable. Choose `Português (Brasil)` from the first row of the `/guard` dashboard to preview the dashboard and its submenus immediately. `Ctrl+S` saves the language preference for this trusted project in `.pi/pi-loop-guard.locale.json`; `Esc` follows the panel's warn-then-discard behavior. An untrusted project can preview a language but cannot persist it. The preference is project-scoped; command names, arguments, IDs, signals, and configuration keys remain unchanged.

### Troubleshooting and limits

- If `/guard` has no interactive UI, use the printed status and direct commands.
- If a field is locked, inspect the global `locked.loopGuard` policy with the person who manages that configuration.
- If Git or repository snapshots cannot establish progress, the guard does not infer a verified reset from that failure.
- Calibrate thresholds against your own tasks. False-positive rates have not been established across a representative workload.
- The extension is an aid to notice repeated work, not a security boundary or a substitute for reviewing tool actions.

### License

This checkout does not declare a software license in `package.json` and does not include a root `LICENSE` file. No license for the extension code is asserted here. The bundled INTEIRO mark has separate attribution and license terms in the [asset notice](docs/assets/INTEIRO-MARK-LICENSE.txt).

## Português (Brasil)

### Instalação local

No diretório que contém a pasta clonada `pi-loop-guard`:

~~~sh
pi install ./pi-loop-guard
~~~

O instalador do Pi adiciona a extensão local às configurações do Pi e pode resolver a dependência declarada `yaml`. Este README não afirma que o pacote foi publicado no npm.

### Verificações locais

Na raiz do repositório:

~~~sh
npm test
npm pack --dry-run --ignore-scripts
~~~

Esses comandos executam os testes unitários e mostram o conteúdo do pacote; o preview não publica nem cria uma release no registry.

### Uso

Execute `/guard` sem argumentos para abrir o painel interativo. Em um cliente sem UI customizada, o comando mostra o estado em texto e um resumo da gramática.

| Comando | Efeito |
| --- | --- |
| `/guard status` | Mostra estado, limites efetivos, escopo de progresso, quarentena e isenções. |
| `/guard help` | Mostra a gramática e os valores disponíveis. |
| `/guard on` / `/guard off` | Liga ou desliga a detecção. `off` interrompe a detecção. |
| `/guard warn` / `/guard enforce` | Define aviso sem bloqueio ou modo de bloqueio. `warn` nunca bloqueia. |
| `/guard policy conservative\|balanced\|strict` | Define uma política e seu modo. `strict` ativa `enforce`; `conservative` nunca bloqueia. |
| `/guard tool-repeat N` | Define o limite de chamadas repetidas. Sugestões: `3`, `4`, `5`, `6`, `8`. |
| `/guard no-progress-turns N` | Define o limite de turnos sem progresso. Sugestões: `3`, `4`, `5`, `8`, `12`. |
| `/guard quarantine SEGUNDOS` | Define a expiração da quarentena: `60`, `120`, `600` ou `3600` segundos. |
| `/guard window N` | Define a janela de eventos: `25`, `50`, `100` ou `200`. |
| `/guard scope relevant\|any` | Conta mudanças nos caminhos relevantes ou em qualquer ponto do repositório como progresso. |
| `/guard strict on\|off` | Define se mudanças fora do escopo mantêm a suspeita ou a relaxam. |
| `/guard allow TOOL` / `/guard unallow TOOL` | Adiciona ou remove uma isenção de ferramenta. A inclusão pede confirmação e reduz a detecção para essa ferramenta. |
| `/guard pause` / `/guard resume` | Pausa a detecção na sessão ou pede aprovação para uma tentativa em quarentena. |
| `/guard explain` | Explica o incidente mais recente e suas medidas. |
| `/guard report --task ID` | Mostra eventos recentes de loop auditados para uma tarefa. |
| `/guard change-strategy` | Limpa as repetições atuais depois da escolha de outra abordagem. |
| `/guard escalate` | Pede intervenção humana; não escolhe modelo nem continua automaticamente. |
| `/guard abort` | Aborta a execução atual do Pi. |

### Defaults e comportamento

A detecção começa ligada em modo `warn` com a política `balanced`: quatro chamadas equivalentes, cinco turnos sem progresso verificado, quarentena de 120 segundos e janela de 50 eventos. Os limites das políticas são:

| Política | Modo | Chamadas equivalentes | Turnos sem progresso |
| --- | --- | ---: | ---: |
| `conservative` | `warn` | 6 | 8 |
| `balanced` | `warn` | 4 | 5 |
| `strict` | `enforce` | 3 | 4 |

`warn` informa uma suspeita sem bloquear a ferramenta. Em `enforce`, o guard pode bloquear uma chamada equivalente repetida depois do limite configurado. Um sinal verificado de progresso pode limpar a sequência ou a quarentena. Os sinais incluem fingerprints de chamadas e progresso no repositório dentro do escopo escolhido; a normalização semântica é conservadora e não é um parser para todas as linguagens. Um diff novo não prova que a alteração esteja correta.

O guard não continua uma tarefa automaticamente, não troca modelos e não substitui uma negação de outra extensão. `resume` exige aprovação humana e libera uma tentativa. `/guard allow` pede confirmação porque uma ferramenta isenta deixa de ser monitorada para chamadas repetidas.

### Configuração e estado

A extensão lê e grava somente a seção `loopGuard` de `pi-suite.yaml`. Em projeto confiável, as configurações são salvas em `.pi/pi-suite.yaml`. Em projeto não confiável, elas vão para o arquivo global `~/.pi/agent/pi-suite/config.yaml`. A política global pode bloquear campos. `PI_SUITE_HOME` altera a raiz usada para configuração global e estado.

Exemplo em um projeto confiável:

~~~yaml
loopGuard:
  enabled: true
  mode: warn
  policy: balanced
  repeatedIdenticalCalls: 4
  noProgressTurns: 5
  quarantineTtlSeconds: 120
  windowSize: 50
  relevantPaths:
    - "**"
  scope:
    source: relevant
    strict: true
~~~

As mudanças de configuração no painel ficam em rascunho até `Ctrl+S`. Depois de salvar, o painel continua aberto; se a gravação falhar, o rascunho permanece para nova tentativa. `Esc` em um submenu volta ao painel. Se houver mudanças não salvas no painel raiz, o primeiro `Esc` avisa e o segundo descarta. A ação explícita de liberar uma assinatura uma vez não depende do salvamento da configuração. Comandos diretos de configuração continuam aplicando imediatamente.

O estado e os registros de auditoria ficam em arquivos JSON/JSONL locais sob a raiz de armazenamento do suite, separados por projeto e sessão/tarefa Pi. A detecção não depende de banco de dados nem de serviço hospedado. Esses arquivos não formam um sandbox do sistema operacional: Pi e a extensão usam as permissões do usuário atual.

### Idioma

O painel usa inglês no primeiro acesso e volta ao inglês se a preferência salva estiver ausente, inválida ou ilegível. Escolha `Português (Brasil)` na primeira linha do painel `/guard` para visualizar imediatamente o painel e seus submenus traduzidos. `Ctrl+S` salva a preferência deste projeto confiável em `.pi/pi-loop-guard.locale.json`; `Esc` mantém o aviso e o descarte do rascunho. Um projeto não confiável pode pré-visualizar o idioma, mas não pode salvá-lo. A preferência é específica do projeto; nomes de comandos, argumentos, IDs, sinais e chaves de configuração permanecem iguais.

### Diagnóstico e limites

- Se `/guard` não tiver UI interativa, use o estado e os comandos mostrados em texto.
- Se um campo estiver travado, peça a quem administra a configuração que verifique a política global `locked.loopGuard`.
- Se Git ou os snapshots do repositório não conseguirem estabelecer progresso, uma falha de observação não é tratada como prova de que a suspeita foi resolvida.
- Calibre os limites com suas próprias tarefas. A taxa de falsos positivos não foi estabelecida em uma carga de trabalho representativa.
- A extensão ajuda a notar trabalho repetido; não é uma fronteira de segurança nem substitui a revisão das ações das ferramentas.

### Licença

Este checkout não declara licença de software em `package.json` e não contém um arquivo raiz `LICENSE`. Este README não afirma uma licença para o código da extensão. A marca INTEIRO incluída tem atribuição e termos separados no [aviso do asset](docs/assets/INTEIRO-MARK-LICENSE.txt).
