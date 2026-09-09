# PLANO — #1722 · Disparo pelo Canal Oficial ponta a ponta: fila, worker e progresso

Ticket: https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/1722 (pai: #1719)
Branch: `feat/1722-disparo-canal-oficial`, empilhada em `feat/1721-blast-recipient-state`
Base medida: `origin/main` + 3 commits (HEAD `5856bd60`), 0 atrás de `origin/main`
ADRs: [0028](../../docs/adr/0028-disparo-canal-oficial-motor-proprio.md) (motor) · [0029](../../docs/adr/0029-guardrails-do-disparo-oficial.md) (guardrails)
Antecessor: [`PLANO-1721.md`](./PLANO-1721.md) · [`HANDOFF-1721.md`](./HANDOFF-1721.md)

Escrito antes de qualquer pergunta ao CTO, como manda o ciclo. O que está aqui foi
**medido** nesta árvore; onde é hipótese, está escrito que é.

---

## 1. O que este ticket é

O **tracer bullet** do épico: corta fila, envio e tela de uma vez. Seis tickets dependem
dele (#1723 variáveis, #1724 ciclo de entrega, #1725 teto, #1726 erros, #1727 supressão,
#1728 ritmo adaptativo, #1729 pausar/parar, #1730 Disparo Rápido oficial, #1731 chip).

Nove critérios de aceite. O nono — "a decisão de enviar, pular ou recusar é legível num
lugar só" — é o que o brief avisa que se esquece, e é o que decide se as seis fatias
seguintes têm onde encostar.

---

## 2. Estado medido (fonte de cada fato)

### 2.1 O módulo de números, e quem o consome

`src/modules/campaigns/components/disparo-wizard/instances-to-numbers.ts:31`

```ts
const BLASTABLE_PROVIDERS = new Set(["uazapi", "evolution"]);
```

**Único consumidor de produção**: `disparo-wizard/DisparoWizard.tsx:30,52` (rota
`/disparos/novo`). Nenhum outro arquivo o importa.

Existem **três** seletores de instância no repo, e os outros dois reimplementam
"conectado" **sem allowlist de provedor**:

| Superfície | Arquivo:linha | Filtra provedor? |
|---|---|---|
| Wizard de Disparo | `disparo-wizard/instances-to-numbers.ts:31` | sim (allowlist) |
| Disparo Rápido (bulk de leads) | `leads/components/bulk-actions/QuickBlastDialog.tsx:91-95` | **não** |
| Dialog "Disparo" dos funis | `pipelines/components/disparo/DisparoWizard.tsx:410-413` | **não** |

A hipótese do brief se confirma, com um alvo a mais do que ele previa: o terceiro
seletor alimenta 6 telas (`PipeConfirmacao`, `PipePropostas`, `PipeWhatsapp`,
`CustomPipeline`, `CarteiraBulkBar`, `Upsell`) e tem exatamente o mesmo defeito.
Ver §7 (escopo) para o que faço com ele.

Existe ainda um quarto registro de verdade sobre provedores, desconectado dos três:
`src/modules/communication/lib/whatsapp-provider.ts` — `capabilities.massSend`,
`capabilities.templates`, `official`.

⚠️ **Armadilha medida**: `EVOLUTION.capabilities.massSend = false`
(`whatsapp-provider.ts:81`), mas `evolution` **está** em `BLASTABLE_PROVIDERS`. Derivar
o regime de `capabilities.massSend`, que era o caminho elegante, **removeria o Evolution
do wizard** — mudança de comportamento no regime Chip, que o critério 8 proíbe. As duas
listas ficam, e um teste gêmeo passa a acusar a divergência (§5.1).

### 2.2 A ordem dos passos do wizard colide com o critério 3

`disparo-wizard/wizard-machine.ts:32-39`:

```
audience → message → postsend → speed → review → monitor
 (1)        (2)       (3)        (4)     (5)      (6)
```

O **conteúdo** é escrito no passo 2 (`StepMessage.tsx`, textarea livre). O **número** é
escolhido no passo 4 (`StepSpeed.tsx:41-47`, toggle sobre `draft.numbers[].selected`).

O critério 3 diz: *"escolher o número oficial troca o passo de conteúdo para seleção de
Template aprovado"*. Hoje o passo de conteúdo acontece **antes** da escolha do número.

Atenuante medido: `draft.numbers` já nasce populado no `createInitialState`
(`wizard-machine.ts:170-196`) e `instancesToNumbers` **pré-seleciona o primeiro**
(`instances-to-numbers.ts:74`, `selected: idx === 0`). Ou seja, existe um número
selecionado desde o passo 1 — o regime é conhecível no passo 2. O que não existe é
*decisão do operador* antes do conteúdo. **É a pergunta 1 ao CTO.**

Segundo fato do mesmo lugar: `StepSpeed` permite selecionar **vários** números
(`selectedDailyCapacity` soma capacidades). Chip + Oficial selecionados juntos é conteúdo
incoerente — texto livre e Template não coexistem num Disparo. O plano trata regime misto
como inválido (§4.1).

### 2.3 A fila hoje é de lote, não de linha

`_shared/quick-blast/blast-plan.ts` (869 linhas): `createBlastPlan` congela a audiência em
`blast_plan_recipients`, fatia em `lot_index`, e **despacha o lote inteiro** via
`deps.dispatch` (linhas 363, 505, 734, 774) — em produção,
`runUazapiSenderJob` do `_shared/dispatch-router.ts`, que fala só `/sender/*` da Uazapi.

Não existe hoje **nenhum** worker que reivindique uma linha de `blast_plan_recipients`.
`blast-plan-control` cancela com um `UPDATE ... WHERE status='pending'` em massa
(`index.ts:142-147`); `mass-send-status` reclassifica `sent → failed` por polling do job
do fornecedor (`index.ts:85-95`).

### 2.4 O transporte de Template já existe, e o choke também

`_shared/whatsapp-dispatch.ts:393` — `sendTemplateViaInstance(supabaseAdmin, instance,
phone, {name, language, components, previewText, buttonLabels}, {trackSource, trackId,
idempotencyKey})`. Ele já faz, dentro:

- `governSend` (`_shared/send-governor/gate.ts:279-330`) — **o choke único**: dedup,
  governor e accounting num lugar só;
- espelhamento da mídia de cabeçalho (`whatsapp-dispatch.ts:438-442`) — sem isso a Meta
  recusa por `131053` **via callback**, depois do `success` já devolvido;
- retorno `{success, messageId}` com `messageId = governed.message_id`.

**Único caller hoje**: `_shared/action-handlers/enviar-template.ts:80-93`, chamado por
`send-whatsapp-rich.ts` (#1688) e `send-whatsapp.ts` (#1689), ambos dentro do executor de
Workflows. O worker de #1722 é o **primeiro** caminho de Template em massa.

### 2.5 Gravação dupla — o mecanismo, medido

Quem grava a linha da conversa é o **próprio provider**, dentro do envio:
`_shared/whatsapp-providers/notificame-provider.ts:1297-1316` —
`channel_messages.upsert(row, {onConflict: "external_id,channel,organization_id"})`.

`enviar-template.ts:103-105` já diz, em comentário, a regra que o worker herda:

> **NÃO grava a linha. O provider do canal oficial já a escreve, no mesmo instante do
> envio — gravar de novo aqui duplicaria a mensagem na conversa.**

E o webhook, do outro lado, **não insere** em `message_status`: acha a linha e faz UPDATE
(`notificame-webhook/index.ts:1139-1174`), com guarda de eco explícita para evento de
saída (`index.ts:1757-1768`).

⚠️ **Achado que o brief não tinha, e que muda o que #1724 vai encontrar.** A linha gravada
no envio nasce com `external_id = <id da resposta do envio>` e **`provider_message_id`
NULL** — `buildOutboundChannelMessageRow` (`notificame-provider.ts:979-1003`) não escreve
essa coluna. Quem a escreve é o **primeiro callback que casar**
(`notificame-webhook/index.ts:1131-1138`). Portanto:

- o id que `sendTemplateViaInstance` devolve é o **id da resposta do envio**, que é o que
  vira `external_id` — **não** é, comprovadamente, o `providerMessageId` estável;
- gravá-lo em `blast_plan_recipients.provider_message_id` segue o precedente da casa
  (`_shared/message-gateway.ts:497` faz exatamente isso), e é o que #1724 vai casar;
- **risco registrado para #1724**: se o `providerMessageId` estável **não** for igual ao
  id da resposta do envio, o casamento do callback tem de repetir as duas chaves, como o
  webhook já faz. Não tenho amostra para decidir — a única do repo é
  `providerMessageId=U2hTM01ZaXNN…` (medida 19/08, citada em `HANDOFF-1721.md`).

### 2.6 Prior art de claim atômico

`claim_pending_ai_actions` (`20260101000000_baseline_prod_schema.sql:2382-2408`):
CTE `eligible` → `capped` (per-org) → `picked` com `FOR UPDATE SKIP LOCKED` →
`UPDATE ... RETURNING *`. Re-claim de `processing` parado há mais de 10 minutos.
Consumido por `process-ai-actions/index.ts:58-60`, auth `x-cron-secret` +
`timingSafeCompare`.

`process-workflow-executions` acrescenta orçamento de wall-clock e devolução do que não
coube (`releaseClaimed`) — é a evolução, não o ponto de partida.

### 2.7 Schema

`blast_plans` (`baseline:21900-21927`): `message text NOT NULL`, `instance_id NOT NULL`,
`organization_id NOT NULL`, `status IN ('active','paused','completed','cancelled')`.
**Não existe coluna de template.**

`blast_plan_recipients` (`baseline:21877-21896` + `20270823000000` do #1721): sem
`organization_id` (tenant via `plan_id`), CHECK já com 6 valores, colunas `sent_at`,
`delivered_at`, `claimed_at`, `provider_message_id`, `estimated_cost`, `actual_cost`,
índice único parcial global em `provider_message_id`. RLS com **duas policies, ambas
SELECT** — toda escrita é `service_role`.

Índice que a consulta do worker vai precisar **não existe** —
`HANDOFF-1721.md` já registrou a dívida e disse que "a fatia do worker paga essa conta".
Esta fatia paga.

### 2.8 Cron versionado

12 migrations com `cron.schedule`. O padrão vivo mais recente e mais correto
(`20270821140000_toth_cron_sync.sql:11-45`, `20270816120000_notificame_subscription_repair.sql:212-292`)
deriva a URL de `public.cron_config` em vez de chumbar o ref, lê `cron_config.cron_secret`,
trata `invalid_schema_name` (sem pg_net o Postgres falha no schema antes da função) e faz
`cron.unschedule` condicional antes do `cron.schedule`. O template do
`supabase/migrations/CLAUDE.md` está **desatualizado** (chumba o ref e usa
`current_setting('app.cron_secret')`); sigo o padrão vivo, não o template.

Precedente direto do domínio: `invoke_blast_plan_release()` (`baseline:12754-12770`), chave
`blast_plan_release_url`.

---

## 3. Premissas do brief conferidas

| Premissa | Veredito |
|---|---|
| `instances-to-numbers.ts` é o módulo único candidato | ✅ confirmada — e há um **terceiro** seletor que o brief não cita (§2.1) |
| #1721 não está na main (PR #1777 aberto) | ✅ confirmada — `mergedAt: null`, migration ausente de `origin/main` |
| HEAD `2309d6df` | ⚠️ HEAD real é `5856bd60` (um commit `chore(lint)` a mais, mesma linhagem) |
| `messageId` do NotificaMe muda a cada callback; `providerMessageId` é a chave estável | ✅ confirmada no webhook — **e** descobri que a linha do envio nasce com `provider_message_id` NULL (§2.5) |
| Migration via CLI escreve em prod se o ref vazar | ✅ `config.toml` aponta prod; `scripts/db-push-branch.sh` **existe** nesta árvore (o `HANDOFF-1721` dizia que não) |
| Funções org-scoped: o front precisa mandar a org | ✅ confirmada — `useNotificameTemplates.ts:199-203` manda `organization_id` no body |
| `tests/` não é type-checked | ✅ `tsconfig.app.json:29` inclui só `src` |
| **"Dedup de envio cobre workflow e o copilot escapa"** | ❌ **NÃO SOBREVIVE** — ver abaixo |

### A premissa que não sobrevive, e o que sobra dela

O brief diz: *"Dedup de envio: hoje cobre workflow e o copilot escapa."* Isso descreve um
bug **já corrigido**. Hoje o dedup mora **dentro de `governSend`**
(`_shared/send-governor/gate.ts:279-291`), e o comentário do próprio arquivo registra a
correção:

> cobre TODOS os callers diretos de `governSend` (copilot-v2-worker, dispatch-router,
> followup-sender, outbound-sender + helpers do whatsapp-dispatch) — o v2 chamava
> `governSend` direto e bypassava o fix que morava nas closures.

`copilot_v2` está no `TRACK_SOURCE_MAP` (`send-dedup.ts:70`). A cobertura hoje é do choke,
não de cada caller.

**O que sobra da advertência, e continua valendo com força**: `deriveSendSource` só
reconhece um vocabulário fechado de `trackSource` (`send-dedup.ts:65-77`); um valor fora
do mapa faz o dedup ser **pulado fail-open, com um único log**. Se o worker inventar um
`trackSource` novo, ele sai do choke em silêncio. Por isso o worker usa `mass_send`, que
já está mapeado — decisão §4.3, com teste que a trava.

---

## 4. O que vai ser construído

Seis fatias, na ordem em que entram. Cada uma é vermelha antes de ser verde.

### 4.1 Fatia 1 — o módulo único de números, com regime

**Move** `disparo-wizard/instances-to-numbers.ts` → `src/modules/campaigns/lib/disparo-numbers.ts`,
exportado pelo barrel `@/modules/campaigns` (o Disparo Rápido vive em `leads` e o
cross-module tem de passar pelo barrel — regra do `CLAUDE.md`).

```ts
export type RegimeDeDisparo = "chip" | "oficial";
export interface DisparoNumber {
  id: string; label: string; cap: number; selected: boolean; isNew?: boolean;
  regime: RegimeDeDisparo;          // novo
}
```

- `chip`: `provider ∈ {uazapi, evolution}` — a allowlist de hoje, **intocada** (critério 8).
- `oficial`: `provider === "notificame"`.
- Qualquer outro (inclusive `meta_cloud`, que também é oficial mas não tem transporte de
  Disparo nesta fatia): **excluído, fail-closed**, como hoje.
- Regime misto na seleção é **inválido**: `validateStep("speed")` passa a recusar seleção
  que misture regimes, com motivo legível.

Consumidores nesta fatia: o wizard e o `QuickBlastDialog`. O terceiro seletor: §7.

### 4.2 Fatia 2 — a regra composta, num lugar só (critério 9)

`supabase/functions/_shared/blast/decisao-do-disparo.ts` — **puro, sem I/O, sem relógio**,
no molde de `_shared/decisao-de-envio.ts` (#1689), que é o prior art nomeado pela spec.

```ts
export type AcaoDoDisparo = "enviar" | "pular" | "recusar";
export interface DecisaoDoDisparo { acao: AcaoDoDisparo; motivo: string | null; }

export function decidirDisparoDoDestinatario(entrada: {
  regime: RegimeDeDisparo;
  plano: { status: string; template: TemplateDoDisparo | null };
  destinatario: { status: string; phone: string | null; claimedAt: string | null };
  agoraMs: number;                  // injetado — o relógio mora fora
}): DecisaoDoDisparo;
```

As fatias seguintes acrescentam **campos de entrada**, não lugares de decisão: supressão
(#1727), teto restante (#1725), saúde da conta (#1728), classificação de erro da Meta
(#1726). A assinatura é desenhada para isso.

### 4.3 Fatia 3 — o worker

`supabase/functions/process-blast-recipients/index.ts` — nome no padrão da casa
(`process-ai-actions`, `process-workflow-executions`, `process-outbound-dispatches`).

- `Deno.serve(withErrorBoundary('process-blast-recipients', handler))`,
  `withSecurityHeaders(getCorsHeaders(req))`, OPTIONS early return, `verify_jwt = false`
  em `config.toml` com comentário do gate;
- auth **cron-only**: `x-cron-secret` + `timingSafeCompare` (`_shared/auth.ts`), como
  `blast-plan-release/index.ts:53-56`;
- claim via RPC (§4.4), lote pequeno e **ritmo fixo conservador** — o adaptativo é #1728,
  e dizer isso no código evita que a fatia seguinte ache que já existe;
- envio por `sendTemplateViaInstance(..., { trackSource: "mass_send", trackId: <recipient.id> })`
  — `mass_send` **já está** no `TRACK_SOURCE_MAP`, então o dedup do choke vale (§3);
- marca a linha: sucesso → `status='sent'`, `sent_at=now()`, `provider_message_id=<messageId>`;
  falha → `status='failed'`, `reason=<motivo>`;
- **não grava `channel_messages` nem `conversation_messages`** — critério 6.

### 4.4 Fatia 4 — schema, claim e cron (uma migration)

`supabase/migrations/20270824000000_blast_official_worker.sql` (timestamp livre: o topo é
`20270823000000`), **só schema, zero DML** (guarda F4):

1. `blast_plans` ganha `template jsonb NULL` — `{name, language, components, previewText,
   buttonLabels}`. Nulo em plano de Chip; preenchido em plano oficial.
   `message` é `NOT NULL` e **continua sendo escrito**: recebe o `previewText` do Template
   aprovado, que é literalmente o texto que a pessoa recebe (sem variáveis nesta fatia).
   Nada de string vazia nem de nome de template no lugar do corpo.
2. Índice parcial que sustenta o claim:
   `(plan_id, lot_index) WHERE status = 'pending' AND claimed_at IS NULL` — a conta que o
   `HANDOFF-1721` deixou marcada.
3. RPC `claim_blast_recipients(batch_size int, per_org_cap int)` — `SECURITY DEFINER`,
   `REVOKE ALL FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE TO service_role`.
   Molde: `claim_pending_ai_actions`. `FOR UPDATE SKIP LOCKED`, `UPDATE ... RETURNING`,
   marca `claimed_at = now()`, re-reivindica linha `pending` com `claimed_at` mais velho
   que 10 minutos (worker morto no meio).
   O tenant sai por join com `blast_plans` — a tabela não tem `organization_id`.
4. `cron.schedule` do worker, no padrão vivo (`cron_config` + `invalid_schema_name` +
   `unschedule` condicional). **Job versionado, como o CTO exigiu.**
5. Rollback em `supabase/migrations/rollback/` com o mesmo nome.

### 4.5 Fatia 5 — o passo de conteúdo troca (critérios 3 e 4)

O painel de Template do nó de Workflow (`workflows/components/action-configs/TemplateNodeConfig.tsx`)
é o que a spec manda reusar. Ele **não** é reusável como está: é amarrado a
`ActionNodeData`, lê a instância de `data.whatsappInstanceId` (linha 109, fora do mapa
`campos` que já parametriza os outros cinco campos) e importa `VariableInserter` de
`@/modules/workflows`.

Extração: um `TemplateAprovadoPicker` **apresentacional** em `@/modules/communication`
(onde já vive `useNotificameTemplates`), com props `{instanceId, escolhido, onEscolher}`.
`TemplateNodeConfig` passa a consumi-lo; o wizard também. Uma listagem, dois consumidores.

Filtro `status === "APPROVED"` fica no picker — medido: `listTemplates`
(`_shared/notificame-templates.ts`) **não filtra**, devolve PENDING/REJECTED/PAUSED também.
Sem catálogo local, direto do fornecedor (critério 4).

Mapeamento de variáveis fica **desligado** nesta fatia — é #1723.

### 4.6 Fatia 6 — progresso por pessoa (critério 7)

Hoje `StepMonitor.tsx:54,201-211` e `BlastPlanCard.tsx:101,300-321` mostram
`useBlastPlanProgress` — um `Record` de 4 contadores (`useBlastPlans.ts:145-168`). Lista
por pessoa só existe no drill-down `BlastPlanRecipientsSheet.tsx`.

`StepMonitor` passa a mostrar **as pessoas**, com estado por linha, alimentado por
`useBlastPlanRecipients` (que já pagina 1000/página e já tem realtime declarado em
`StepMonitor.tsx:49-50`). O contador continua como resumo — o critério pede que a tela
mostre pessoas, não que esconda o total.

⚠️ **A union `BlastRecipientStatus` NÃO é ampliada nesta fatia.** O worker escreve
`sent`/`failed`; `delivered`/`unconfirmed` são #1724. Isso mantém verdes os quatro testes
da guarda de vocabulário do #1721 — inclusive o teste 4, que fixa a union em quatro
valores, e o teste 3, que reprova quem gravar os estados novos. **A guarda do #1721 não é
tocada, e o PR #1777 segue como está.**

---

## 5. Seams — onde a prova encosta

Quatro seams, na ordem da spec #1719 (§Testing Decisions). Toda guarda nova é **vista
vermelha uma vez** antes de ficar verde; verde de primeira aqui é indistinguível de teste
que não exercita nada.

### 5.1 Módulo puro de números (`tests/unit/disparo-numbers.test.ts`)

- Org só com Chip → conjunto **idêntico** ao de hoje (critério 8, provado e não presumido).
- Org só com Oficial → o número aparece, com `regime: "oficial"`.
- Org com os dois → os dois aparecem, cada um com seu regime.
- Provedor desconhecido / sem `provider` → excluído (fail-closed, comportamento de hoje).
- `meta_cloud` → excluído, com o motivo nomeado no teste.
- **Teste gêmeo** contra `getProviderProfile` — acusa o dia em que
  `capabilities.massSend`/`templates` divergirem das duas listas. É o teste que a
  armadilha do Evolution (§2.1) exige.
- **Um só módulo**: teste que afirma que wizard e Disparo Rápido derivam do mesmo módulo,
  vermelho se um deles voltar a filtrar por conta própria.

### 5.2 Regra composta (`tests/unit/decisao-do-disparo.test.ts` + `-twin.test.ts`)

Tabela de decisão inteira, por comportamento observável na borda: linha sem telefone →
`pular`; linha já `sent` → `pular`; linha reivindicada há 10 segundos → `pular`; plano
`paused` → `recusar`; regime oficial sem template → `recusar`; caminho feliz → `enviar`.

**Gêmeo** no molde de `tests/unit/decisao-de-envio-twin.test.ts`: roda o módulo real de
onde vem o motivo (o governor) e confere que a regra reconhece a string exata que ele
emite — é o que impede a regra de decidir sobre um motivo que ninguém mais produz.

### 5.3 Worker (`tests/unit/process-blast-recipients.test.ts`)

Dublês no molde de `tests/unit/process-scheduled-user-messages.test.ts`
(`vi.hoisted` montando `globalThis.Deno` antes do import, `createMockSupabase` de
`tests/helpers/supabase-mock.ts`, relógio via `vi.useFakeTimers`) e de
`tests/unit/quick-blast-run.test.ts` (injeção de dependência direta).

O que **só** existe no laço, e por isso só aqui se prova:

- **Idempotência da reivindicação** — duas passadas concorrentes não pegam a mesma linha
  (o claim é RPC; o teste dubla a RPC e prova que o worker respeita o que ela devolveu, e
  a prova do SQL vai na branch, §6);
- **Retomada exata** — segunda passada começa na próxima `pending`, nunca reenvia `sent`;
- **Critério 6, provado e não lido**: o worker executa um envio completo e o teste afirma
  **zero escritas** em `channel_messages` e `conversation_messages`. Mutação que prova o
  peso: acrescentar a gravação e ver o teste ficar vermelho;
- **O choke**: o envio sai com `trackSource: "mass_send"`; teste vermelho se alguém trocar
  por um valor fora do `TRACK_SOURCE_MAP` (a armadilha que sobrou do brief, §3);
- Ritmo fixo respeitado; falha do provedor marca `failed` com motivo, não derruba o tique.

### 5.4 Handler de status do webhook

Existente. **Nesta fatia não muda** — o ciclo de entrega é #1724. O que esta fatia lhe deve
é escrever `provider_message_id` na linha, e o que ela lhe entrega registrado é o achado
de §2.5 (a linha do envio nasce com essa coluna NULL).

### 5.5 O que a prova de banco cobre, e onde ela mora

O claim é SQL, e SQL não se prova com dublê. Contra a **branch efêmera** (§6):

- duas sessões concorrentes chamando `claim_blast_recipients` não recebem a mesma linha
  (`FOR UPDATE SKIP LOCKED` de verdade, não a promessa dele);
- linha `pending` com `claimed_at` velho volta a ser reivindicável; recente, não;
- `per_org_cap` não deixa uma org monopolizar o tique;
- ACL do RPC: `anon` e `authenticated` sem EXECUTE, `service_role` com — conferido por
  `has_function_privilege` **e** pela borda do PostgREST, como manda o runbook §6.

---

## 6. Ambiente de validação

Branch efêmera de prod, **pré-autorizada pelo CTO neste ticket** (aviso quando subir,
derrubo ao fechar). Runbook: `.specs/project/runbook-validacao-local.md`.

Fatos do runbook que **mudam o desenho da prova**, e que registro antes de chegar lá:

- a branch nasce `MIGRATIONS_FAILED` com o ledger mentindo em 3 linhas — reverter antes do
  `db push`;
- **a branch tem zero edge functions** (`list_edge_functions` devolve `[]`; prod tem 78+).
  Logo, "worker rodando ponta a ponta na branch" custa deploy das funções **na branch**.
  A divisão honesta: **o SQL do claim se prova na branch** (§5.5), **o laço do worker se
  prova por dublê** (§5.3). Não vou chamar de ponta-a-ponta o que for só um dos dois;
- toda escrita por `scripts/db-push-branch.sh --db-url … --confirm <ref>`;
- `supabase gen types` **não** roda a partir da branch — corrompe `types.ts`. Fica para
  depois do apply em prod, que é botão do humano.

---

## 7. O que fica de fora, e por quê

| Fora | Por quê |
|---|---|
| Variáveis do Template | #1723 — a spec e o ticket dizem "sem variáveis nesta fatia" |
| Teto de Gasto, custo estimado na tela | #1725 |
| Ciclo de entrega (`delivered`, custo realizado, `unconfirmed`) | #1724. É o que mantém a union em 4 valores e a guarda do #1721 verde |
| Erros da Meta viram decisões (131050, 131049, 132015…) | #1726 — a regra composta (§4.2) é onde eles vão encostar |
| Lista de Supressão | #1727 |
| Ritmo adaptativo, saúde da conta, suspensão diária | #1728 — aqui o ritmo é **fixo e conservador**, e o código diz isso |
| Pausar/retomar/parar pelo worker | #1729 |
| **Disparo Rápido enviando pelo Canal Oficial** | #1730, que está bloqueado por #1723 e #1725. Nesta fatia o Disparo Rápido **lista** pelo mesmo módulo, com o regime visível (critério 2) — enviar por ele é a fatia seguinte |
| Migrar o Chip para o motor próprio | ADR-0028 §Out of Scope. O Chip segue no `/sender/*` da Uazapi |
| O terceiro seletor de instância (`pipelines/components/disparo/DisparoWizard.tsx`) | **HERDADO** — `src/modules/pipelines/components/disparo/DisparoWizard.tsx:410-413` não filtra provedor, alimenta 6 telas e tem o mesmo defeito que o ticket conserta nas outras duas. O ticket nomeia "wizard e Disparo Rápido"; apontá-lo para o módulo novo o faria **oferecer** o número oficial numa tela que não sabe enviar por ele — exposição nova, não conserto. Fica reportado, com issue própria sugerida no handoff |
| `supabase gen types` | Só depois do apply em prod (runbook) |

---

## 8. Riscos, com o custo de cada um

1. **A ordem dos passos do wizard** (§2.2) — sem decisão do CTO, qualquer caminho que eu
   escolher é premissa não confirmada num critério de aceite. **É a pergunta 1, e ela
   bloqueia a fatia 5.** As fatias 1–4 não dependem dela e começam antes.
2. **O id do fornecedor** (§2.5) — se o `providerMessageId` estável não for o id da
   resposta do envio, #1724 casa o callback errado. Custo de descobrir agora: uma medição
   contra um callback real. Custo de descobrir depois: entrega que nunca fecha e custo
   realizado que nunca sobe.
3. **O índice único global em `provider_message_id`** — herdado do #1721, com o modo de
   falha documentado lá (23505 na escrita **depois** do envio já feito = duplicata
   cobrada). Esta fatia é a **primeira** que escreve nessa coluna, ou seja, é a primeira
   que pode disparar o risco. A saída de emergência está no `HANDOFF-1721.md`.
4. **Regime misto na seleção de números** (§2.2) — tratado como inválido; se o CTO quiser
   permitir (um Disparo com dois regimes = dois conteúdos), o desenho muda e vira outra
   fatia.
5. **`message NOT NULL` em plano oficial** (§4.4) — resolvido gravando o `previewText`.
   Se amanhã o Template mudar de corpo na Meta, o `message` do plano fica histórico; é o
   comportamento certo (registra o que foi enviado), mas é preciso não lê-lo como "o
   template atual".

---

## 9. Ordem de execução

1. Fatia 1 (módulo + regime) — não depende de pergunta nenhuma.
2. Fatia 2 (regra composta) — idem.
3. Fatia 4 (migration: template, índice, RPC, cron) — idem.
4. Fatia 3 (worker) — depende de 2 e 4.
5. Branch efêmera: prova do claim (§5.5), depois **derrubada**.
6. Fatia 5 (passo de conteúdo) — **depende da resposta à pergunta 1**.
7. Fatia 6 (progresso por pessoa).
8. `/code-review`, push, `HANDOFF-1722.md`, fechamento da #1722.

Se a janela passar de 70% antes do fim, o handoff é escrito **primeiro**.
