# pi-loop-guard

Detector determinístico de falta de progresso para **Pi 1.1.0 / Node >=20**. Sem chamadas LLM para detectar loops; interface compacta, detalhes somente sob demanda.

```sh
npm ci --ignore-scripts --legacy-peer-deps
pi -e ./index.ts
```

`/guard on|off`,` status`,` policy conservative|balanced|strict`,` limits tool-repeat N`,` limits no-progress-turns N`,` pause`,` resume --once`,` explain`,` report --task ID`,` change-strategy`,` escalate`,` abort`,` help`.` warn`/`enforce` são aliases de modo. **Warn é o padrão**; strict habilita enforce.

Autocomplete de argumentos nativo em todos os subcomandos: `/guard` lista as ações com o que fazem, `policy` mostra as presets e o que cada uma bloqueia, `limits` mostra os dois limiares e `limits tool-repeat` sugere valores. `/guard` sem argumento dá o estado; um comando errado devolve a gramática.` policy`,` limits`,` on|off`,` warn`,` enforce` persistem em `.pi/pi-suite.yaml` (somente a seção` loopGuard`); se o projeto não é confiável, o ajuste vale só para a sessão e isso é dito em vez de falhar em silêncio.

Fingerprints canônicos de qualquer ferramenta/argumentos/diretório; hashes de resultado/exit code; streaks de erro; ausência de mudança relevante; falta de critérios novos; budget_burn; plan_churn (sinal fraco) e falhas repetidas de provedor. Duas chamadas iguais em paralelo não produzem duas penalidades. Reads/observação são isentos; paginação com cursor diferente não repete a mesma assinatura. Polling/backoff autorizado pode ser declarado como exceção com ferramenta, comando e TTL.

Estados normal/watch/warn/intervention/paused/resumed/aborted, janela limitada de eventos e quarentena por assinatura. Em enforce a quarta chamada equivalente com resultado igual e sem progresso é bloqueada. Um progresso comprovado limpa a quarentena; override libera exatamente uma tentativa com TTL e escopo auditados. Warn-only jamais bloqueia. Nenhuma liberação supera o deny de outra extensão.

Provas de progresso vêm de checks verificados do gate e de hash semântico dos arquivos relevantes. Markdown, espaços e comentários isolados não reiniciam contadores. Configure `relevantPaths` para restringir a fonte real da tarefa (p.ex.` src/**`,` test/**`). A normalização semântica é conservadora/lexical, **não um parser de todas as linguagens**; mudanças ambíguas não devem ser tratadas como prova forte sem checks. Um novo conteúdo não é garantia de correção.

`turn_end` atualiza suspeita sem LLM.` agent_before_settle` emite diagnóstico deduplicado por incidente, nunca pede continuação automática. Relatórios incluem sinais, últimas assinaturas, custo conhecido e opções de recuperação. Escalate solicita intervenção; não troca modelo arbitrariamente nem inventa aceite.

Estado, incidentes e overrides em JSON/JSONL isolado por projeto/sessão; **sem banco**. Instalar/remover com `pi install ./pi-loop-guard` /` pi remove ./pi-loop-guard`.` npm test` valida warn/enforce, paralelismo, fingerprints, provas, TTL e exceções. Calibração de falsos positivos em tarefas reais ainda requer um conjunto de avaliação do seu ambiente.
# pi-loop-guard
