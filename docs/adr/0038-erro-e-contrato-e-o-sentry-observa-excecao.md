# 38. Erro é contrato; o Sentry volta para observar exceção

Date: 2026-09-30

## Status

Proposed

Substitui as decisões **1** (remover o Sentry) e **3** (erro do cliente só num anel em memória) do
[ADR-0017](0017-drop-sentry-for-in-house-runtime-logs.md). Mantém as decisões 2, 4, 5 e 6 dele.
Reescopa o PRD #805 (cockpit de observabilidade nativo) — ver "Relação com o #805".

## Context

Duas queixas do CTO, que parecem separadas e têm a mesma raiz:

1. **O cliente não entende o erro.** Às vezes aparece o genérico ("Erro ao salvar"), às vezes o
   texto do Postgres em inglês, às vezes nada que explique o que aconteceu ou o que fazer.
2. **A gente só descobre o erro quando o cliente manda mensagem.** Não dá para saber quando
   quebrou, o que quebrou, nem o passo a passo que levou até ali.

A raiz: **no Torque, erro circula como texto solto, não como dado.** Sem código estável, a tela não
tem o que traduzir e o sistema não tem o que agrupar, contar ou alertar.

### O que foi medido (2026-09-30, repo em `3a6add35d` e prod read-only)

Mensagem ao cliente:

- ~**268** sítios jogam a mensagem técnica crua no toast (`toast.error(err.message)`,
  `description: error.message`).
- **118** sítios usam `e instanceof Error ? e.message : …`, que devolve vazio para todo erro do
  Supabase: `PostgrestError` é objeto simples, não `Error`.
- `getErrorMessage` (`src/shared/errors.ts`) existe, mas é usado em 3 arquivos, e **por desenho**
  concatena o texto do Postgres. `new row violates row-level security policy (42501)` vai para a tela.
- As edge functions respondem em inglês em 100 arquivos (`"Unauthorized"` 73×, `"Forbidden"` 27×,
  `"Internal server error"` 12×). O envelope padrão `_shared/response.ts`, que já tem `request_id`,
  é usado por **7 de 176** funções. O `withErrorBoundary` devolve o `error.message` cru no 500.
- O banco já lança código de máquina bom (`access_denied` 369×, `reference_unavailable` 115×,
  `invalid_configuration` 60×). O front traduz isso caso a caso em ~13 arquivos.
- O `GlobalErrorBoundary` mostra `error.message` num `<pre>`, em inglês, na tela inteira.

Observabilidade:

- **Erro do front nunca sai do navegador**, a não ser que o usuário abra um Chamado. É a decisão 3
  do ADR-0017, e está funcionando como desenhada: **24 dos 25** Chamados dos últimos 30 dias
  chegaram com `client_errors` anexados. O erro existia, e a gente soube pelo cliente.
- **Exceção não tratada de edge function não vai para `runtime_logs`.** O `withErrorBoundary`
  escreve só em `console.error`, que vive na retenção curta dos logs da função.
- **Ação iniciada por usuário quase não deixa rastro no backend.** Em 7 dias, das 355 mil linhas
  de `runtime_logs`, 308 mil são `webhook` e o resto é cron/worker. Linhas com `triggered_by`
  preenchido: ~30. Linhas com `session_id`: 16. A correlação por sessão (decisão 4 do ADR-0017)
  está implementada e quase nunca é exercitada, porque quase nada do caminho do usuário loga.
- **Alerta existe e ninguém ouve.** `system_alerts` gerou **19.692** alertas `critical` de
  `cron_job_failure` em 30 dias (~650/dia), **0 resolvidos**. A causa medida é `job startup
  timeout` transitório em ~0,7% das execuções dos crons de 1 minuto: cada falha isolada vira um
  alerta crítico, e o volume enterra qualquer sinal real.
- **Source map público.** `https://torquecrm.com.br/assets/index-*.js.map` responde 200 com
  7,3 MB: o código-fonte inteiro, com comentários, está servido para qualquer um
  (`vite.config.ts` com `sourcemap: true`, e o `Dockerfile` copia `dist/` inteiro para o nginx).

### Por que o in-house não basta

O ADR-0017 tirou o Sentry porque "ninguém lia o dashboard e o DSN não era mantido". O diagnóstico
estava errado: aquilo era falha de processo, não de ferramenta. Os 19.692 alertas não lidos em
`system_alerts` mostram que o in-house sofre a mesma coisa.

O que falta construir para o in-house chegar ao básico: agrupar por fingerprint, simbolizar stack
minificada com source map, breadcrumbs, regras de alerta com regressão e deduplicação, release
health e um console de investigação. Para um time de CTO + 1 dev júnior, isso são meses para
chegar a um Sentry pior. É commodity. Não se constrói commodity.

O ADR-0017 também dispensou o replay como "quase inútil" com texto mascarado. Para reproduzir bug,
o que importa é a sequência (qual tela, qual botão, em que ordem, o que respondeu), e isso
sobrevive à máscara. É exatamente o "passo a passo" que falta hoje.

O ADR-0017 **acertou** em duas coisas que ficam: dado de lead do nosso cliente não sai sem máscara,
e o Sentry não enxerga o domínio (webhook do WhatsApp, cron, disparo, Copilot). Isso continua
sendo trabalho do `runtime_logs`.

## Decision

1. **Erro é um contrato, não um texto.** Todo erro que atravessa uma fronteira (banco → front,
   edge → front, front → tela) é normalizado num `AppError`:

   ```ts
   interface AppError {
     code: ErrorCode;          // estável, máquina: "permission.denied", "lead.phone_taken", "network.offline"
     userMessage: string;      // PT-BR: o que aconteceu e o que fazer
     action?: ErrorAction;     // "Pedir acesso", "Reconectar WhatsApp", "Tentar de novo"
     reference: string;        // código curto e copiável mostrado ao cliente (= eventId do Sentry)
     retryable: boolean;
     cause: unknown;           // técnico: vai para o Sentry, nunca para a tela
   }
   ```

   A `reference` é o id do evento no Sentry: o cliente lê "Código: 7F3A9C21", o suporte cola esse
   código na busca do Sentry e chega ao evento, com stack, breadcrumbs, replay e as tags
   `session_id`/`request_id` que levam ao `runtime_logs`. Sem DSN (dev, teste), a referência é um
   id local registrado no anel do Chamado.

   **Texto técnico nunca vai para a tela.** Código desconhecido cai numa mensagem PT de fallback
   que o chamador fornece ("Não foi possível salvar o lead"), mais o código copiável.

2. **Um ponto de passagem por lado.** Nada chama o Sentry diretamente fora destes pontos:
   - Front: `toAppError` (normalizador), `notifyError` (reporta e mostra), `QueryCache` e
     `MutationCache` `onError` globais, `GlobalErrorBoundary`.
   - Edge: `withErrorBoundary` e um `reportException` do `_shared`.

   Quem trata erro localmente chama `notifyError`, nunca `toast.error` com a mensagem do erro. Uma
   regra de lint garante isso, e ela entra no `lint:ratchet`.

3. **O Sentry volta para exceção; o `runtime_logs` fica com o domínio.**
   - Sentry: exceções do front (render, PostgREST, RLS, `functions.invoke`) e das edge functions,
     com breadcrumbs, source maps, replay só em erro e alertas.
   - `runtime_logs`: trilha operacional do domínio (webhook, cron, disparo, Copilot), como hoje.
   - A ponte são as tags `session_id` e `request_id` em todo evento do Sentry. Dado um issue, a
     busca em `runtime_logs` usa os mesmos ids. A decisão 4 do ADR-0017 fica valendo e ganha o
     segundo lado.
   - O anel de 20 entradas continua existindo para o Chamado (evidência local e imediata), e o
     Chamado passa a levar também o link do evento no Sentry.

4. **PII: o Sentry recebe estrutura, não conteúdo.** Isto é inegociável e entra no primeiro deploy:
   - Região **EU** (`de.sentry.io`), com DPA assinado. Não existe região Brasil; a transferência
     internacional se apoia nas cláusulas-padrão.
   - `sendDefaultPii: false`. O `beforeSend` e o `beforeBreadcrumb` removem query string (filtro do
     PostgREST é `?name=eq.Fulano`), corpo de request/response e headers de auth. As mesmas chaves
     seguras de rota do `support-context.ts` valem aqui.
   - A `supabaseIntegration` do SDK fica **sem** `sendOperationData`: filtro e corpo de mutation
     continuam redigidos, que é o default.
   - Replay: `maskAllText`, `maskAllInputs`, `blockAllMedia`, `replaysSessionSampleRate: 0`,
     `replaysOnErrorSampleRate` ajustado à cota. Replay só existe quando há erro.
   - Usuário identificado só por `user_id` e `organization_id` (UUIDs), mais `role`. Nunca nome,
     e-mail ou telefone.

5. **Source map não é público.** O build gera o map como `hidden`, o envia ao Sentry e o apaga do
   artefato servido pelo nginx. Isso fecha a exposição de hoje, independentemente do resto.

6. **Alerta é sobre mudança de estado, não sobre ocorrência.** Alertar sobre erro **novo**,
   **regressão** (issue resolvido que voltou) e **pico** (taxa acima do normal). Nunca "toda
   ocorrência". Todo alerta tem dono, canal lido (e-mail no plano grátis, Slack/WhatsApp depois) e
   critério de resolução. O mesmo princípio vale para o `system_alerts`: falha isolada não é
   crítica; N falhas consecutivas são, e a próxima execução bem-sucedida resolve o alerta sozinha.

7. **Começa no plano grátis (Developer)**: 1 usuário, 5k erros/mês, 50 replays, alerta por e-mail.
   Passa para o Team quando o dev júnior precisar entrar, a cota estourar ou o alerta precisar ir
   para o Slack. A integração é a mesma nos dois planos; trocar é só billing.

## Relação com o #805

O PRD #805 (junho de 2026, nunca executado) desenhou um cockpit nativo que **substituiria** o
Sentry. Com esta decisão:

- **Continua valendo** o que o Sentry não vê: saúde de cron, drift de WhatsApp, integrações,
  plano de ação ranqueado e a consolidação das telas master (fatias S0, S1 e S5 do #805).
- **Sai** o que agora é do Sentry: fingerprint de erro, sink de erro de front, motor de alerta
  para exceção e remoção do Sentry (fatias S2, S3, S6, e a parte de exceção da S4).

## Consequences

- **Dependência de vendor volta**, com custo previsível (US$0 hoje, US$26/mês no Team). O
  contrato `AppError` e o ponto único de passagem mantêm a troca de vendor barata: é uma função.
- **Dado técnico sai da nossa infraestrutura**, com escopo fechado: stack, rota sanitizada, UUIDs,
  release, navegador. O `beforeSend` é a fronteira de LGPD e ganha teste próprio. Mudar a
  redação exige revisão de segurança.
- **O Sentry no Deno não separa escopo por request.** O SDK não instrumenta o `Deno.serve`, então
  breadcrumb e contexto globais vazariam entre requests do mesmo isolate. Nas edge functions,
  `defaultIntegrations: false` e todo contexto passado por `withScope` ou direto no
  `captureException`. Sem isso, um erro de uma org poderia sair com o contexto de outra.
- **Peso de bundle.** SDK e replay entram no front. O replay é carregado sob demanda
  (`lazyLoadIntegration`) para não pesar no primeiro carregamento.
- **O build do EasyPanel precisa de dois segredos novos**: o DSN (público por natureza) e um token
  de upload de source map (secreto, escopo mínimo `project:releases`). O token não pode ficar
  gravado na imagem final.
- **O contrato só melhora a tela quando o catálogo cresce.** Até lá, o cliente vê o fallback PT com
  código copiável, o que já é melhor que o texto técnico em inglês de hoje. A ordem do catálogo
  sai da frequência medida no Sentry, não de palpite.
