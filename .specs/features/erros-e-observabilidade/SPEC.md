# Erros e observabilidade: fundação + Sentry

**Decisão:** [ADR-0038](../../../docs/adr/0038-erro-e-contrato-e-o-sentry-observa-excecao.md)
**Status:** spec. Nada implementado.
**Data:** 2026-09-30
**Escopo desta spec:** Passo 1 (fundação) e Passo 2 (Sentry). Os Passos 3 e 4 estão no fim, só
delineados.

## O problema, em uma frase

Erro no Torque é texto solto. Por isso o cliente recebe mensagem técnica em inglês ou um genérico
sem explicação, e a gente só descobre que quebrou quando o cliente manda mensagem.

## Linha de base (medida em 2026-09-30)

Todo número abaixo vira critério de aceite ou métrica de acompanhamento.

| Sinal | Hoje | Alvo ao fim do Passo 2 |
|---|---|---|
| Sítios com mensagem técnica crua no toast | ~268 | 0 (lint trava a volta) |
| Sítios `instanceof Error ? .message` | 118 | 0 |
| Erro de front visível sem o cliente abrir Chamado | nunca | todo erro, no Sentry |
| Exceção não tratada de edge function persistida | só `console.error` | Sentry + `runtime_logs` |
| Resposta 500 do `withErrorBoundary` | `error.message` cru | mensagem PT + `code` + `request_id` |
| `GlobalErrorBoundary` | `<pre>{error.message}</pre>` | código copiável + "Abrir chamado" |
| Source map em prod | público (`index-*.js.map`, 7,3 MB) | 404 |
| Alertas `critical` de cron em 30 dias | 19.692, 0 resolvidos | só falha sustentada; resolve sozinho |

Comando para recontar os sítios:

```bash
grep -rnE "toast\.error\([^)]*\.message|description: *(error|err|e)\.message" src | wc -l
```

## Fora de escopo

- Catálogo de mensagens PT por domínio (Passo 3). Aqui entram só os códigos genéricos.
- Traduzir as strings em inglês das 176 edge functions (Passo 3).
- UX preventiva de permissão (Passo 4).
- O cockpit do #805. O ADR-0038 reescopa o #805; a fatia de exceção dele morre aqui.

---

## Fatias

A ordem é a de dependência. **S0 e S7b são independentes** e podem ir antes de tudo.

### S0: fechar o source map público (segurança, horas)

**Por quê:** hoje o código-fonte inteiro, com comentários de incidente, está servido em
`https://torquecrm.com.br/assets/*.js.map`. Não depende de nada desta spec.

- `Dockerfile`: no bloco do nginx, `location ~* \.map$ { return 404; }`.
- `vite.config.ts`: `sourcemap: 'hidden'`. O arquivo continua sendo gerado (a S6 o envia ao
  Sentry), mas o bundle deixa de apontar para ele.

**Aceite:** `curl -o /dev/null -w "%{http_code}" https://torquecrm.com.br/assets/<index>.js.map`
devolve `404` depois do deploy. O bundle não contém `//# sourceMappingURL`.

---

### S1: contrato `AppError` e normalizador (puro, TDD)

Módulo novo em `src/shared/errors/`. O `src/shared/errors.ts` atual vira
`src/shared/errors/index.ts` e reexporta `getErrorMessage` para não quebrar os 3 usuários atuais.

```
src/shared/errors/
├── index.ts          # barrel público
├── app-error.ts      # tipos: AppError, ErrorCode, ErrorAction
├── to-app-error.ts   # normalizador: unknown → AppError (puro, síncrono)
├── catalog.ts        # código → mensagem PT + ação + retryable
└── *.test.ts
```

**`toAppError(error: unknown, fallback: string): AppError`**: puro e síncrono. Reconhece:

| Entrada | Como reconhece | Código |
|---|---|---|
| `PostgrestError` | objeto com `code` string | pelo `code` (tabela abaixo) |
| `FunctionsHttpError` | `name === "FunctionsHttpError"`, `context.status` | pelo status HTTP |
| `FunctionsFetchError` / `TypeError: Failed to fetch` | nome/mensagem | `network.offline` |
| `AuthApiError` / `AuthSessionMissingError` | `name` + `status` | `auth.*` |
| `AbortError` / timeout | `name` | `network.timeout` |
| Mensagem de RPC com código de máquina (`access_denied`, `reference_unavailable`, …) | prefixo da mensagem | pela tabela |
| `Error` nativo e qualquer outra coisa | resto | `unknown` |

Mapeamento inicial (só códigos genéricos; o domínio fica para o Passo 3):

| Origem | `ErrorCode` | Mensagem PT (rascunho) | `retryable` |
|---|---|---|---|
| `42501`, `access_denied`, `forbidden:*`, HTTP 403 | `permission.denied` | "Você não tem permissão para fazer isso. Peça acesso ao administrador da sua organização." | não |
| `PGRST301`, JWT expirado, HTTP 401 | `auth.session_expired` | "Sua sessão expirou. Entre novamente para continuar." | não |
| `PGRST116`, `reference_unavailable`, HTTP 404 | `record.not_found` | "Este registro não existe mais ou foi removido por outra pessoa." | não |
| `23505` | `record.duplicate` | "Já existe um registro com esses dados." | não |
| `23503` | `record.in_use` | "Não dá para concluir: este registro está ligado a outros dados." | não |
| `23514`, `22023`, `PT422`, `invalid_*`, HTTP 400/422 | `validation.invalid` | "Algum dado enviado não é válido. Revise e tente de novo." | não |
| `PT409`, `*_revision_conflict`, HTTP 409 | `conflict.stale` | "Alguém alterou isso enquanto você editava. Recarregue e tente de novo." | sim |
| HTTP 429, `rate_limited` | `rate.limited` | "Muitas tentativas seguidas. Aguarde alguns segundos." | sim |
| rede | `network.offline` | "Sem conexão com o Torque. Verifique sua internet." | sim |
| timeout | `network.timeout` | "O Torque demorou a responder. Tente de novo." | sim |
| HTTP 5xx | `server.unavailable` | "Tivemos um problema do nosso lado. Já fomos avisados." | sim |
| resto | `unknown` | **o `fallback` do chamador** ("Não foi possível salvar o lead.") | não |

Regras do normalizador (cada uma vira teste):

1. **Nunca devolve texto técnico em `userMessage`.** Nem `message`, nem `details`, nem `hint` do
   Postgres. A causa vai inteira em `cause`.
2. `[object Object]`, string vazia e `"Erro desconhecido"` são ausência de informação e caem no
   `fallback` (memória *erro-do-supabase-nao-e-instanceof-error*).
3. `reference` é um id nosso (8 hex), estável por objeto de erro. Vai como tag `reference` para o
   Sentry na S6 (o Sentry não busca `eventId` parcial).
4. Não lê corpo de `Response`, porque é síncrono. O corpo das edge functions entra na S5, pelo
   envelope `{ error, code, request_id }`: quando o `context` do `FunctionsHttpError` já foi lido
   por um helper, o `code` do corpo vence o status.

**Aceite:** cobertura de teste das 12 linhas da tabela, mais os três casos de ausência de
informação e um teste de propriedade: para qualquer entrada, `userMessage` nunca contém
`violates`, `policy`, `PGRST`, `null value`, `relation` nem `(` seguido de código de 5 caracteres.

---

### S2: `notifyError`: reportar e mostrar numa chamada só

`src/shared/errors/notify.ts`

```ts
notifyError(error: unknown, opts: {
  fallback: string;                 // PT, do domínio: "Não foi possível mover o card."
  context?: Record<string, string>; // tags seguras para o Sentry: { feature: "kanban" }
  silent?: boolean;                 // só reporta, não mostra toast
}): AppError
```

Faz, nesta ordem:

1. `toAppError(error, fallback)`.
2. Reporta: `recordClientError` (anel do Chamado, fonte `handled`, causa resumida sem `details`
   do Postgres e com PII mascarada) **e** o `ErrorReporter` registrado (o Sentry, na S6).
   O `AppError.reportable` decide se vira evento: recusa **deliberada** (RPC com código de
   máquina, frase PT, 4xx de edge function, auth) vira breadcrumb; o mesmo código vindo cru do
   Postgres (ex.: RLS `violates row-level security policy`) é defeito e vira evento.
3. Toast padrão (sonner):
   - título = `userMessage`;
   - descrição = `Código: 7F3A9C21`, clicável para copiar;
   - ação = `action` do catálogo quando houver ("Entrar novamente", "Recarregar"); senão
     "Falar com suporte", que abre o `SupportPanel` em "novo chamado" já com o código na descrição;
   - dedup: o mesmo `code` em menos de 3 s gera um toast só.

**Abrir o Chamado de fora do React.** `notifyError` é função, não hook. O `SupportPanelProvider`
registra o próprio `openNewTicket` num registro de módulo
(`src/modules/platform/lib/support-launcher.ts`: `registerSupportLauncher` / `openSupportWith`),
exportado pelo barrel do `platform`. Sem launcher registrado (tela pública, login), a ação vira
"Copiar código".

**Não entra no `notifyError`:** validação de formulário escrita pelo próprio app
(`toast.error("Nome é obrigatório")`). Isso é UX, não erro, e continua como está.

**Aceite:** testes do dedup, da regra "não reporta recusa esperada", do fallback sem launcher e do
toast sem nenhum texto técnico. Teste de componente: o toast renderiza com título, código e ação.

---

### S3: pontos globais

**`src/App.tsx`: `QueryClient`**

- `queryCache: new QueryCache({ onError })`: **só reporta**, sem toast. Query com erro já mostra o
  estado de erro inline na tela; toast em query que refaz sozinha vira spam. A query que quiser
  toast declara `meta: { errorToast: "Não foi possível carregar os leads." }`.
- `mutationCache: new MutationCache({ onError })`: **só reporta**. Toast é opt-in por
  `meta: { errorMessage }`. *Revisto na implementação:* a regra original ("toast quando não há
  `onError` próprio") daria toast duplo — no TanStack v5, `mutate(vars, { onError })` e `try/catch`
  em volta de `mutateAsync` não aparecem em `mutation.options`. Como o `MutationCache` roda antes
  do `onError` local, o relatório sai do cache e o `notifyError` da tela reusa a referência sem
  relatar de novo.

**`GlobalErrorBoundary`**

- Sai o `<pre>{error.message}</pre>`.
- Entra: "Algo deu errado nesta tela", o código copiável, "Recarregar", "Ir para o início" e
  "Abrir chamado".
- `componentDidCatch` reporta com `componentStack`. O ramo de chunk (auto-reload) fica como está.

**Aceite:** teste do `MutationCache` (relata sem toast; `meta` liga o toast; o `notifyError`
local reusa a referência). Teste do boundary: o texto do erro não aparece no DOM e o código
aparece.

**Status:** S1–S3 entregues no PR #2191.

---

### S4: codemod e trava de lint

**Codemod** (`scripts/codemods/notify-error.ts`, ts-morph, idempotente, com `--dry-run`)
reescreve os padrões medidos:

| Antes | Depois |
|---|---|
| `toast.error(err.message \|\| "Erro ao X")` | `notifyError(err, { fallback: "Erro ao X" })` |
| `toast.error("Erro ao X", { description: err.message })` | `notifyError(err, { fallback: "Erro ao X" })` |
| `toast.error(err instanceof Error ? err.message : "Erro ao X")` | `notifyError(err, { fallback: "Erro ao X" })` |
| `` toast.error(`Erro ao X: ${err.message}`) `` / `"Erro ao X: " + err.message` | `notifyError(err, { fallback: "Erro ao X" })` |

O que não casar vai para uma lista, e essa lista é tratada à mão no mesmo PR. O fallback reescrito
segue a forma "Não foi possível <verbo> <objeto>." quando o original era "Erro ao …". Esse texto
aparece para o cliente, então vale revisar.

**Lint** (`eslint.config.js`, `no-restricted-syntax`, nível `error`, dentro do `lint:ratchet`):

- `toast.error(...)` / `toast.warning(...)` com `MemberExpression[property.name="message"]` em
  qualquer argumento → "Use `notifyError(err, { fallback })` de `@/shared/errors`. Mensagem técnica
  não vai para a tela (ADR-0038)."
- `ConditionalExpression` com `instanceof Error` no teste e `.message` no consequente → mesma
  mensagem.

**Aceite:** a contagem da linha de base cai para 0. `npm run lint:ratchet`, `typecheck:ratchet`,
`test:ratchet` e `build` verdes em delta. O PR lista os sítios migrados à mão.

---

### S5: edge functions: boundary, envelope e `runtime_logs`

**`_shared/error-boundary.ts`: `withErrorBoundary`** (vale para as 169 funções que já o usam):

1. Resposta 500 **compatível para trás**. Os chamadores leem `body.error` como string, então ele
   continua string, agora em PT, e ganha campos ao lado:

   ```json
   { "error": "Tivemos um problema do nosso lado. Já fomos avisados.",
     "code": "server.unavailable", "request_id": "<uuid>" }
   ```

   O `error.message` cru sai da resposta e vai para os logs.
2. Grava em `runtime_logs` (`module: "general"`, `action: "unhandled_exception"`,
   `status: "error"`, `session_id`/`request_id` via `getTraceContext`, `triggered_by` do JWT).
   Fecha o buraco de exceção que só existia em `console.error`.
3. Chama `reportException` (S6-edge).

**`_shared/response.ts`: `errorResponse`** ganha `code?: ErrorCode` opcional. As funções migram
para ele no Passo 3; nada muda de comportamento aqui.

**Front:** `toAppError` lê `code` do corpo quando um helper já o extraiu. O helper único de
desembrulho (`src/core/invoke.ts`: `invokeFunction`, substituindo as ~10 reimplementações de
"non-2xx") entra aqui, mas a migração dos 109 `functions.invoke` fica para o Passo 3.

**Aceite:** teste deno do boundary: o 500 leva CORS, `error` em PT, `code`, `request_id` e
**não** leva a mensagem original; a linha de `runtime_logs` é gravada; um `logRuntime` que falha
não derruba a resposta.

**Deploy:** só surte efeito com redeploy das funções, que é manual. Deployar **a partir de `main`
depois do merge**, nunca da branch (memórias *drift de deploy de edge function* e *o `cd` do
deploy precisa ir na mesma linha*). Começar por 3 funções de tráfego de usuário, observar 24h,
depois o resto.

---

### S6: Sentry

#### Front (`@sentry/react`)

`src/core/observability/sentry.ts`, com init em `main.tsx` antes do `render`:

```ts
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,          // ausente → SDK desligado (dev, teste, preview)
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_APP_VERSION,
  sendDefaultPii: false,
  integrations: [
    Sentry.supabaseIntegration({ supabaseClient }), // SEM sendOperationData
    Sentry.browserTracingIntegration(),
  ],
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,                  // plano grátis: 50/mês; baixar se estourar
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});
// Replay carregado sob demanda para não pesar no primeiro carregamento:
Sentry.lazyLoadIntegration("replayIntegration").then((replay) =>
  Sentry.addIntegration(replay({ maskAllText: true, maskAllInputs: true, blockAllMedia: true })));
```

- **`scrubEvent` / `scrubBreadcrumb`** (módulo puro, testado; é a fronteira de LGPD): remove query
  string de toda URL (reaproveitando `SAFE_QUERY_KEYS` do `support-context.ts`), remove
  `request.data`, `request.cookies`, headers `authorization`/`apikey`/`x-user-jwt`, e mascara
  telefone e e-mail em `message` e `exception.values[].value` com a mesma regra do `runtime_logs`
  (`5511*****2210`).
- **Identidade:** ao autenticar, `Sentry.setUser({ id: userId })` e `Sentry.setTags({ org_id, role })`.
  Nada além de UUID e role. No logout, `setUser(null)`.
- **Tags de correlação:** `session_id` (fixo por aba) e, quando existir, `request_id` do request que
  falhou.
- **Import cíclico:** a `supabaseIntegration` precisa do client, e o client não pode importar o
  Sentry. O init recebe o client como parâmetro, e o `main.tsx` monta os dois na ordem certa.

**CSP (Dockerfile):** o `connect-src` já tem `https://*.sentry.io`, que cobre o ingest EU
(`o<id>.ingest.de.sentry.io`); confirmar no QA. Acrescentar `worker-src 'self' blob:`: o replay
comprime num worker criado de blob, e sem isso cai para compressão na thread principal.

**Source maps:** `@sentry/vite-plugin` com `sourcemaps.filesToDeleteAfterUpload: ["dist/**/*.map"]`,
ativo só quando `SENTRY_AUTH_TOKEN` existe. Sem token, o build segue normal; a S0 já garante que
nenhum `.map` fica público.

**Dockerfile / EasyPanel:** `ARG VITE_SENTRY_DSN` e `ENV` no estágio de build, como os outros
`VITE_*`. `ARG SENTRY_AUTH_TOKEN`, `SENTRY_ORG` e `SENTRY_PROJECT` **só no estágio `builder`**: o
estágio final (nginx) não herda `ARG`, então o token não fica gravado na imagem publicada.
Preferir `RUN --mount=type=secret` se o EasyPanel suportar BuildKit secrets.

#### Edge (`_shared/sentry.ts`)

- SDK Deno por `npm:@sentry/deno` com versão fixada (confirmar a versão estável na implementação).
- Init preguiçoso, uma vez por isolate, **`defaultIntegrations: false`**. O SDK não instrumenta o
  `Deno.serve`, então breadcrumb e contexto globais vazariam entre requests do mesmo isolate, e
  entre orgs. Todo contexto vai por `withScope` ou direto no `captureException`.
- `reportException(error, { functionName, organizationId, userId, sessionId, requestId })`
  captura e faz `await Sentry.flush(2000)`, sempre dentro de `try/catch`: telemetria nunca muda a
  resposta.
- Sem `SENTRY_DSN` nos secrets, é no-op.
- O mesmo `scrubEvent` (porta Deno do módulo puro) roda no `beforeSend`.

**Aceite:**
- Teste do `scrubEvent` com um evento real de PostgREST contendo `?name=eq.Fulano`, telefone e
  header `authorization`: nada disso sai.
- Teste do escopo Deno: duas exceções em sequência com orgs diferentes saem com o `org_id` certo.
- QA em prod depois do deploy: um erro provocado no front aparece no Sentry com stack
  desminificada, tags `org_id`/`session_id`, replay mascarado e **sem** query string; o código
  mostrado no toast encontra o evento na busca do Sentry.

---

### S7: alertas e rotina

**S7a: regras no Sentry** (configuração, sem código):

| Regra | Condição | Canal |
|---|---|---|
| Erro novo | issue visto pela primeira vez | e-mail do CTO |
| Regressão | issue resolvido que voltou | e-mail do CTO |
| Pico | > 50 eventos do mesmo issue em 1h | e-mail do CTO |
| Muitas orgs | issue afetando ≥ 3 orgs (tag `org_id`) em 1h | e-mail do CTO |

Ao migrar para o plano Team, as mesmas regras passam a ir para o Slack.

**S7b: `check_cron_job_health` para de gritar** (migration, independente do resto):

- Alerta de falha só quando o job falha **≥ 3 vezes nas últimas 5 execuções**. Hoje uma falha
  isolada de `job startup timeout` (~0,7% das execuções) gera um `critical`.
- Auto-resolve: quando as 3 últimas execuções do job passam, `resolved_at = now()` no alerta aberto.
- Limpeza única dos 19.692 alertas abertos: marcar como resolvidos com
  `metadata.resolved_reason = 'adr-0038-ruido'`. É DML em prod, então vai **fora** da migration,
  como passo manual com `--allow-dml` (guarda F4).

**Rotina** (entra no vault, `05 — How-to/triagem-semanal-de-erros.md`): 15 min por semana, top
issues por eventos e por orgs afetadas; cada um vira issue no GitHub (`needs-triage`), é resolvido
ou é ignorado com motivo. Sem dono e sem rotina, o Sentry morre de novo pelo mesmo motivo do
ADR-0017.

**Aceite:** alerta de teste chega ao e-mail. Em 7 dias depois da S7b, `system_alerts` de
`cron_job_failure` cai para a casa de unidades por dia, e os abertos são só falhas sustentadas.

---

## Ações humanas (bloqueiam a S6)

1. **Criar a organização no Sentry na região EU** e assinar o DPA. A região não muda depois.
2. Criar dois projetos: `torque-web` (React) e `torque-edge` (Deno). O plano Developer permite
   isso com 1 usuário.
3. `VITE_SENTRY_DSN` do `torque-web` → build args do EasyPanel.
4. `SENTRY_DSN` do `torque-edge` → `supabase secrets set` no projeto de prod.
5. Token de upload de source map, escopo `project:releases` → build arg do EasyPanel (só estágio
   `builder`).

## Riscos

| Risco | Mitigação |
|---|---|
| Ruído estoura a cota grátis de 5k/mês antes de gerar sinal | recusa esperada (`permission`, `validation`, `auth`) vira breadcrumb, não evento; `sampleRate` ajustável; rate limit por projeto no Sentry |
| PII vaza por um campo que ninguém previu | `scrubEvent` testado com evento real; revisão pela `/security-rubric` (PII); DSN só entra em prod depois do QA do scrub |
| Contexto de uma org em evento de outra (Deno) | `defaultIntegrations: false` + `withScope`; teste de dois eventos em sequência |
| Toast duplo (global + local) | `MutationCache` só mostra quando a mutation não tem `onError` próprio; teste |
| Codemod muda texto que o cliente vê | fallback revisado no diff; nada é traduzido automaticamente para além do padrão "Erro ao X" → "Não foi possível X" |
| Deploy de edge function a partir de branch atrasada reverte prod | deploy só de `main`, depois do merge, em lotes (S5) |
| Número de ADR colide | `0037` está no PR aberto #2084; conferir `0038` de novo na hora do merge |

## Depois desta spec (só delineado)

**Passo 3: catálogo por domínio.** Duas semanas depois da S6, ordenar os issues do Sentry por
eventos × orgs afetadas e escrever os códigos de domínio (`lead.phone_taken`,
`whatsapp.instance_disconnected`, `pipeline.is_org_default`, …) na ordem desse ranking. As edge
functions migram para `errorResponse` com `code`. Os 109 `functions.invoke` migram para
`invokeFunction`. Os 13 tradutores ad hoc (`mensagemDeFalhaAoExcluir` e afins) viram entradas do
catálogo.

**Passo 4: permissão explicada antes do clique.** Ação sem permissão fica desabilitada com o
motivo e quem libera ("Precisa da permissão *Excluir leads*. Quem libera: admin da organização."),
em vez de deixar clicar e recusar.
