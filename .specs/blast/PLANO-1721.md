# PLANO — #1721 · O estado do Blast Recipient comporta entrega, custo e reivindicação

Ticket: https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/1721 (pai: #1719)
Branch: `feat/1721-blast-recipient-state` · base `origin/main` @ `215f0c13`
Escrito antes de qualquer pergunta, porque raciocínio que só existe na janela morre com ela.

## 1. Por que este ticket existe

Prefactor. Expande a **forma** da linha do destinatário para o que o Canal Oficial vai exigir
(ADR-0028, ADR-0029), **sem mudar comportamento nenhum hoje**. Se `sent_at`/`delivered_at`/custo
ficassem de fora, cada slice seguinte (#1724 em diante) traria migration própria — e o prefactor
teria falhado no seu único objetivo.

Três forças do canal oficial, medidas em ADR-0028/0029:
- A Meta cobra **na entrega**, não no envio. `sent` deixa de ser o fim da linha.
- O TTL do template vai a **30 dias**, e o não entregue é descartado **em silêncio** — logo existe
  um terminal que não é nem entrega nem falha.
- O fornecedor **não oferece chave de idempotência**. A garantia de envio único tem de morar na
  própria linha, reivindicada antes do envio.

## 2. Estado medido (fonte de cada fato)

Tabela `public.blast_plan_recipients`, forma viva segundo o baseline reconciliado de produção
`supabase/migrations/20260101000000_baseline_prod_schema.sql:21877-21896`:

| Coluna | Tipo |
|---|---|
| `id` | uuid PK default `gen_random_uuid()` |
| `plan_id` | uuid NOT NULL → `blast_plans(id) ON DELETE CASCADE` |
| `lead_id` | uuid → `leads(id) ON DELETE SET NULL` |
| `phone` | text |
| `variable_snapshot` | jsonb NOT NULL default `'{}'` |
| `lot_index` | int NOT NULL default 0, CHECK `>= 0` |
| `status` | text NOT NULL default `'pending'` |
| `reason` | text |
| `created_at` | timestamptz NOT NULL default `now()` |
| `instance_id` | uuid → `whatsapp_instances(id) ON DELETE SET NULL` |

- **Não tem `organization_id`.** O tenant vem por `plan_id → blast_plans.organization_id`. Confirmado
  também em `src/shared/realtime/useRealtimeSubscription.ts:17-26` (`TABLES_WITHOUT_ORG_ID`).
- **Não tem `updated_at`** e **não tem trigger**.
- CHECK vivo — `baseline:21889`:
  `blast_plan_recipients_status_check CHECK (status = ANY (ARRAY['pending','sent','skipped','failed']))`
- Índices — exatamente dois, mais a PK:
  - `idx_blast_plan_recipients_instance` — `(plan_id, lot_index, instance_id) WHERE status = 'pending'` (`baseline:30260`)
  - `idx_blast_plan_recipients_lot` — `(plan_id, lot_index, status)`, **sem predicado** (`baseline:30264`)
- RLS ligada (`baseline:37185`), duas policies, **ambas só de SELECT**:
  `master_select_all_blast_plan_recipients` (`baseline:39335`) e `tenant_isolation_select`
  (`baseline:41064`, via `get_my_organization_ids()`). Toda escrita é `service_role`, que passa por fora.
- Grants (`baseline:44410-44412`): `ALL` para `authenticated` e `service_role`, `SELECT` para `mcp_readonly`.

Literais de status usados em **todo** o código, para esta tabela: `pending`, `sent`, `skipped`,
`failed` — e nada além disso. `delivered`/`unconfirmed` não aparecem em lugar nenhum ainda.
Escritores: `_shared/quick-blast/blast-plan-store.ts:64` (`markRecipients`),
`blast-plan-control/index.ts:142` (`skipped`), `mass-send-status/index.ts:89` (`failed`).

## 3. Premissas do brief que não sobreviveram à conferência

**(a) `failed` existe — o ticket estava certo, o brief citava o arquivo superado.**
Fonte: `supabase/migrations/archive/20270106000000_blast_plan_recipients_failed_status.sql:22-34`
(ADR-0016 §4 / #947) faz `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` com os quatro valores.
Chegou em produção: o baseline reconciliado — que é dump de prod, não história — traz o CHECK com
`failed` em `baseline:21889`, e o changelog registra o apply
(`Obsidian/.../07 — Changelog/2026-07-02-migration-blast-failed-prod.md`).
O `archive/20261122000000_blast_plans.sql:102-104` que o brief cita é o **original**, revogado.
→ **Pendente**: a medição literal `pg_get_constraintdef` contra o banco vivo. Ver §9.

**(b) Só UM índice tem `WHERE status='pending'`, não dois.**
`idx_blast_plan_recipients_lot` tem `status` como terceira **coluna**, sem predicado. O ensaio
asserta o `pg_get_indexdef` literal dos dois, o que torna a distinção irrelevante para a prova —
mas o brief teria me feito assertar a coisa errada.

## 4. O que vai ser construído

### 4.1 Migration — `supabase/migrations/20270823000000_blast_recipient_delivery_state.sql`

Timestamp `20270823000000`: livre aqui e em `origin/main` (topo atual `20270822130000_lead_uf_source_erp.sql`),
conforme a guarda de colisão `scripts/check-migration-versions.sh` roda no CI.

Conteúdo, em ordem:

1. **CHECK ampliado**, no padrão da casa (`DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` com o mesmo
   nome — precedente `20270106000000`):
   `CHECK (status IN ('pending','sent','skipped','failed','delivered','unconfirmed'))`
   Superconjunto estrito do vivo: nenhuma linha existente pode ser invalidada.
2. **Seis colunas novas**, todas `ADD COLUMN IF NOT EXISTS`, todas **NULL**, nenhuma com DEFAULT —
   é o que torna a migration inerte para o que já existe:

   | Coluna | Tipo | Por quê |
   |---|---|---|
   | `sent_at` | `timestamptz` | quando saiu para o fornecedor |
   | `delivered_at` | `timestamptz` | quando a Meta confirmou entrega — é o instante que **gera cobrança** |
   | `claimed_at` | `timestamptz` | a reivindicação do worker; dois tiques não pegam o mesmo destinatário |
   | `provider_message_id` | `text` | a única chave estável do fornecedor entre callbacks |
   | `estimated_cost` | `numeric(12,4)` | custo previsto no envio |
   | `actual_cost` | `numeric(12,4)` | custo realizado na entrega |

3. **Índice único parcial** em `provider_message_id`, `WHERE provider_message_id IS NOT NULL`
   (forma da casa: `baseline:30616` `idx_conversation_messages_idempotency`).
4. `COMMENT ON COLUMN` em `status` e nas seis novas — a doc mora no schema, como no
   `20270106000000` e no `20270819140000`.

**Só schema. Zero DML.** Respeita a guarda F4 (`CLAUDE.md:108`): nenhum `INSERT/UPDATE/DELETE/
TRUNCATE/COPY`, logo um alvo errado vira erro de schema recuperável, nunca mudança de dado.

#### Por que `numeric(12,4)` e não o `numeric(12,2)` da casa
A casa usa `numeric(12,2)` para dinheiro (`sale_value`, `unit_price`, `amount` — 9 ocorrências no
baseline). Aqui isso **quebra**: o preço unitário medido em ADR-0029 é R$ 0,3217 (marketing) e
R$ 0,0350 (utility). Em duas casas, utility vira R$ 0,04 — **14% de erro por mensagem**, e o Teto de
Gasto do ADR-0029 é justamente uma trava em reais. Desvio deliberado da convenção, com medição.

### 4.2 Rollback — `supabase/migrations/rollback/20270823000000_blast_recipient_delivery_state.sql`

Mesmo nome do arquivo que reverte, como manda o diretório `rollback/`. Derruba o índice, derruba as
seis colunas, restaura o CHECK de quatro valores. O preflight de
`05 — How-to/aplicar-migration-prod.md` exige rollback **capturado em arquivo e testado por
execução** antes de qualquer escrita — o ensaio (§6) executa o rollback dentro da mesma transação,
o que satisfaz isso sem tocar em prod.

## 5. Seams — onde a prova encosta

O ticket pede "provado, não presumido". As suítes vitest existentes
(`tests/unit/blast-plan.test.ts`, `blast-plan-multinumber.test.ts`, `blast-plan-failure-sync.test.ts`)
rodam contra **fakes em memória** — não tocam Postgres, logo **não conseguem provar nada sobre uma
migration**. Verde nelas seria verde por ausência. As duas seams reais:

- **Seam 1 — a fronteira SQL, contra os dados reais de produção.** É o ensaio transacional (§6).
  Único lugar onde "o Disparo por Chip segue idêntico" tem sujeito: as linhas que existem hoje.
- **Seam 2 — a fronteira de tipos do frontend.** Deliberadamente **não tocada** nesta fatia (§7).
  A prova de que ela não mudou é `npm run lint` + `npm run build` + `npm run test:unit` verdes com
  o diff aplicado — nenhum arquivo TS entra no commit.

## 6. Desenho do ensaio

`scripts/ensaio-1721.sh` + `ensaio-1721-antes.sql` + `ensaio-1721-depois.sql`, no molde exato do
#1693 (commit `2ac64268`): o `.sh` **concatena o arquivo de migration de verdade** — não uma cópia —
entre antes e depois, e manda tudo em uma requisição para `scripts/prod-sql.mjs --file`, que abre uma
sessão só. `BEGIN` no topo do antes, `ROLLBACK` na última linha do depois. Toda asserção é
`DO $ensaio$ … RAISE EXCEPTION 'ENSAIO 1721 / <CATEGORIA>: %' … $ensaio$`, e qualquer uma que dispare
aborta antes do ROLLBACK. Estado em TEMP TABLEs prefixadas `e_`.

### ANTES
- `SET LOCAL statement_timeout='600s'`, `lock_timeout='5s'`.
- `e_antes_total` — contagem total da tabela, **todas as organizações**.
- `e_antes_dist` — distribuição por `(org, status)` via join em `blast_plans`.
- `e_antes_idx` — `pg_get_indexdef` literal de **todo** índice da tabela.
- `e_antes_pol` — `pg_policies` (nome, cmd, qual) e `e_antes_acl` — `has_table_privilege` para
  `anon`/`authenticated`/`service_role`/`mcp_readonly`.
- `e_antes_check` — `pg_get_constraintdef` literal do CHECK. **Esta é a medição que responde a §3(a).**
- **CONTROLE POSITIVO**: se a tabela tiver zero linhas, `RAISE 'ENSAIO 1721 / CONTROLE VAZIO'`.
  Prova de inércia sem sujeito é verde por ausência. Se disparar, planto fixtures (um plano
  sintético com uma linha em cada status) sob `session_replication_role = replica`, como o #1693 fez.
- **VERMELHO**: `INSERT` com `status='delivered'` tem de estourar **23514** hoje. Capturado em
  `BEGIN … EXCEPTION WHEN check_violation` — se **não** estourar, `RAISE 'VERMELHO NAO REPRODUZIDO'`.
  Mesmo para `'unconfirmed'`.

### (migration real, concatenada)

### DEPOIS
| # | Asserção | Categoria se falhar |
|---|---|---|
| 1 | `INSERT status='delivered'` agora passa; idem `'unconfirmed'` | `VERDE FALHOU` |
| 2 | `INSERT status='bogus'` **continua** estourando 23514 — teste de mutação: prova que eu ampliei o CHECK, não que o derrubei | `CHECK FROUXO` |
| 3 | Contagem total idêntica ao ANTES | `CONTAGEM MUDOU` |
| 4 | Distribuição `(org, status)` idêntica — **igualdade de conjunto**, não contagem parecida | `DISTRIBUICAO MUDOU` |
| 5 | Toda linha pré-existente com as 6 colunas novas em NULL | `COLUNA NASCEU SUJA` |
| 6 | Os 2 índices antigos + PK vivos com `pg_get_indexdef` **literalmente idêntico** | `INDICE MUDOU` |
| 7 | Policies e ACL idênticas ao ANTES | `POLICY MUDOU` / `GRANT ERRADO` |
| 8 | Default de `status` ainda `'pending'`; `NOT NULL` preservado | `DEFAULT MUDOU` |
| 9 | Índice único faz o seu trabalho: dois `provider_message_id` iguais → **23505**; e vários NULL convivem | `UNICIDADE NAO PEGA` |
| 10 | Nenhum trigger novo na tabela | `TRIGGER NOVO` |
| 11 | Rollback executado em seguida devolve CHECK, colunas e índices ao estado do ANTES | `ROLLBACK NAO FECHA` |
- Relatório final `jsonb_pretty(...)` com antes/depois lado a lado, e `ROLLBACK;`.

**Nada é aplicado.** A última instrução é ROLLBACK e o `prod-sql.mjs` não tem modo de escrita
implícito — o payload inteiro é uma transação só.

## 7. Fora de escopo, deliberado

Cada item abaixo é omissão **escolhida**, não esquecimento:

- **A union TS** `BlastRecipientStatus` (`src/modules/campaigns/hooks/useBlastPlanRecipients.ts:35`).
  Ampliá-la **quebra o build agora**: `BlastPlanRecipientsSheet.tsx:104` usa
  `Record<BlastRecipientStatus, number>` com literal exaustivo. E ampliar sem tratar os novos
  estados na UI seria mudança de comportamento — exatamente o que o ticket proíbe.
- **A tally** `useBlastPlans.ts:159-162`, cujo `else p.pending += 1` joga qualquer status
  desconhecido no balde `pending`. Hoje é inerte (ninguém escreve os valores novos). **Vira defeito
  no dia em que o worker escrever `delivered`** — registrado no HANDOFF como dívida datada.
- **O Sheet** (`BlastPlanRecipientsSheet.tsx`), as abas e os rótulos.
- **O worker** do canal oficial, a reivindicação em si, o webhook, a Lista de Supressão, o Teto de
  Gasto, o cálculo de custo. Esta fatia dá a **forma**; quem a preenche vem depois.
- **`supabase gen types`** — só faz sentido depois do apply em prod, que é botão do humano.
- **O comentário obsoleto** em `_shared/quick-blast/blast-plan.ts:59` (`pending | sent | skipped`,
  nunca atualizado quando `failed` entrou). Fora de escopo, mas é a mesma classe de drift que este
  ticket combate — anotado no HANDOFF.

## 8. Ordem de execução

1. Ensaio montado, rodado contra prod, **vermelho reproduzido** (`delivered` estoura 23514 hoje).
2. `/tdd` — a migration é escrita para virar aquele vermelho em verde, uma asserção por vez.
3. Rollback escrito e provado pela asserção 11.
4. `npm run lint` + `npm run test:unit` + `npm run build`.
5. `/code-review`.
6. push da branch.
7. `.specs/blast/HANDOFF-1721.md`.
8. Fecha a #1721 com comentário de resolução.

**Nada aplicado em produção.** Deploy é humano.

## 9. Riscos e perguntas registradas

**R1 — Unicidade global de `provider_message_id` (resposta ao item B).**
A tabela **não tem `organization_id`**, então o índice não pode ser escopado por tenant como o
precedente da casa: `channel_messages` usa `(organization_id, provider_message_id)` parcial e **não
único** (`supabase/migrations/20270819140000_channel_messages_provider_message_id.sql:35-37`), e o
casamento no webhook é explicitamente por tenant (`notificame-webhook/index.ts:1141-1163`,
`.eq("organization_id", organizationId)`). Aqui só sobra o escopo global — ou `(plan_id,
provider_message_id)`, que não serve, porque quem procura a linha a partir do callback tem o id do
fornecedor e **não** o plano.

O modo de falha é mais afiado do que o brief supôs, e é do lado da **escrita**, não da leitura:
quem grava o `provider_message_id` é o nosso worker, logo depois do envio. Se o fornecedor repetir
um id entre organizações, o `UPDATE` do worker estoura **23505** — e a mensagem **já saiu**. A linha
fica sem o id, o casamento do callback nunca acontece, e uma retomada reenvia: **duplicata cobrada**,
que é precisamente o que o ADR-0028 §5 manda evitar. Ou seja: o risco não é um callback perdido, é
dinheiro gasto duas vezes.

Não confirmei com o fornecedor que o id é globalmente único — a única amostra que o repo tem é
`providerMessageId=U2hTM01ZaXNN…` (base64, medida em 2026-08-19,
`20270819140000_channel_messages_provider_message_id.sql:10-12`). Não é wamid da Meta; é id do
NotificaMe, e a documentação dele não fala de escopo. Sigo com o índice único global, conforme
decidido, e registro no HANDOFF **com a saída de emergência**: se a colisão aparecer, o conserto é
acrescentar `organization_id` (desnormalizado do plano) e reescopar o índice — não remover a
unicidade, que é o que torna a idempotência real.

**R2 — `CONCURRENTLY` versus a integridade do ensaio.** As decisões diziam "CONCURRENTLY fora da
transação". Isso **quebra o ensaio**: `CREATE INDEX CONCURRENTLY` não roda dentro de um bloco de
transação (25001), e o ensaio vale porque concatena o arquivo **de verdade**. Ou o ensaio prova um
arquivo diferente do que vai ser aplicado, ou o índice sai concorrente. Minha recomendação é o
índice **não** concorrente, porque a tabela é minúscula: ADR-0028 mediu **3 disparos em toda a
história do produto**, o maior com 235 destinatários. O lock é de milissegundos sobre centenas de
linhas. Falta confirmar com uma contagem viva — mesma medição bloqueada de §3(a). Pergunto depois
desta escrita.

**R3 — `prod-sql.mjs` não tem guarda nenhuma.** Sem modo read-only, sem checagem de ref, sem
confirmação; o ref de prod é literal na linha 12. O que torna o ensaio seguro é só a forma do
payload (uma transação terminando em ROLLBACK) — a mesma aposta que o #1693 fez. Trato o arquivo
montado como artefato revisável: fica em disco, é lido antes de rodar, e o ROLLBACK é a última linha
conferida a olho.

---

## 10. MEDIÇÃO — ensaio rodado contra produção em 2026-08-23

`scripts/ensaio-1721.sh`, uma execução, autorizada pelo CTO
(`~/Dev/.maestri/briefs/1721-autorizacao-prod.md`). **14/14 asserções passaram, ROLLBACK executado,
nada aplicado.** O relatório só é impresso se nenhuma asserção tiver disparado antes dele.

### Item A — respondido por medição, não por suposição

CHECK vivo, lido de `pg_get_constraintdef` no catálogo de **produção**:

```
CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'skipped'::text, 'failed'::text])))
```

`failed` **existe**. O arquivo que o brief citava (`archive/20261122000000_blast_plans.sql`) é o
original, revogado por `archive/20270106000000_blast_plan_recipients_failed_status.sql` (ADR-0016 §4).
Depois da migration, medido na mesma transação:

```
CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'skipped'::text, 'failed'::text, 'delivered'::text, 'unconfirmed'::text])))
```

### O universo, medido

235 destinatários, **uma única organização** (`1ec200ca-d928-4b0c-bcd0-a9f4189876f5`):
`skipped=104`, `pending=71`, `sent=59`, `failed=1`. É o disparo de 235 da Distetica que o ADR-0028
mediu em 2026-08-21. Total idêntico nos três momentos: **235 → 235 → 235**.

### R2 resolvido pela medição

235 linhas. O `CREATE INDEX` não concorrente lockeia a tabela por milissegundos, então fica **dentro**
da transação — e é isso que permite ao ensaio concatenar o arquivo de verdade em vez de uma cópia.
A ressalva das decisões ("CONCURRENTLY fora da transação") era certa para tabela grande; esta não é.
Se a tabela crescer antes do apply, reavaliar — o custo de reavaliar é uma contagem.

### O que cada asserção provou

| # | Provou | Resultado |
|---|---|---|
| 1 | `delivered` e `unconfirmed` passam a ser aceitos | ACEITO |
| 2 | Nenhum dos quatro estados vivos foi perdido | ACEITO nos 4 |
| 3 | Mutação: status inválido **continua** estourando 23514 — ampliei o CHECK, não o derrubei | 23514 |
| 4 | Contagem total idêntica | 235 = 235 |
| 5 | Distribuição por (org, status) idêntica — igualdade de conjunto, dois `EXCEPT` | sem diferença |
| 6 | Toda linha pré-existente com as 6 colunas novas em NULL | 0 linhas sujas |
| 7 | Os 2 índices antigos + PK com `pg_get_indexdef` literalmente idêntico; exatamente 1 índice novo | idêntico |
| 8 | O índice novo é UNIQUE e parcial, e de fato pega id repetido | 23505 |
| 9 | Vários NULL convivem no índice parcial | ACEITO |
| 10 | Policies idênticas (as 2, ambas SELECT) | sem diferença |
| 11 | Grants idênticos (`authenticated`/`service_role` ALL, `mcp_readonly` SELECT) | sem diferença |
| 12 | **Controle negativo**: com o rollback aplicado, `delivered` volta a estourar | 23514 |
| 13 | Rollback devolve índices, constraints, colunas, policies e grants ao estado do ANTES | sem diferença |
| 14 | Contagem e distribuição intactas do começo ao fim | 235, sem diferença |

Controles que impedem verde por ausência: CONTROLE VAZIO (tabela com 0 linhas aborta o ensaio),
SONDA QUEBRADA (`pending` tem de ser aceito, senão o instrumento recusa tudo) e COLUNA JA EXISTE
(`provider_message_id` tem de dar 42703 antes da migration).
