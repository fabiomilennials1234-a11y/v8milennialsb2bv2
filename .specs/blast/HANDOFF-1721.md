# HANDOFF — #1721 · Prefactor do estado do Blast Recipient

Branch `feat/1721-blast-recipient-state` · base `origin/main` @ `215f0c13` · 2026-08-23
Plano e medições: [`.specs/blast/PLANO-1721.md`](./PLANO-1721.md)

## Por que este trabalho existiu

O Canal Oficial (ADR-0028, ADR-0029) cobra **na entrega**, tem TTL de 30 dias com descarte
silencioso, e o fornecedor **não oferece chave de idempotência**. Nada disso cabia na linha do
destinatário, que só sabia `pending | sent | skipped | failed`.

Esta fatia expande a **forma** e mais nada. Sem ela, cada slice seguinte (#1724 adiante) traria
migration própria — o prefactor existe exatamente para que a forma chegue uma vez só.

## O que foi entregue

| Arquivo | O quê |
|---|---|
| `supabase/migrations/20270823000000_blast_recipient_delivery_state.sql` | CHECK de 6 valores, 6 colunas, índice único parcial, comentários |
| `supabase/migrations/rollback/20270823000000_...sql` | reverso, **testado por execução** |
| `scripts/ensaio-1721.sh` + `-antes.sql` + `-verde.sql` + `-depois.sql` | ensaio transacional contra produção, 14 asserções |
| `tests/unit/blast-recipient-status-vocabulary.test.ts` | guarda mecânica do vocabulário (4 testes) |

**Nada foi aplicado em produção.** O apply é do humano.

## Decisões, e por quê

**1. `unconfirmed`, não `expired` nem `undelivered`.** Decisão do CTO, registrada em
`~/Dev/.maestri/briefs/1721-decisoes.md`. `expired` já está ocupado neste repo (execução de
automação, #1683) e reusar termo entre domínios é como nasce documentação que produz defeito;
`undelivered` afirmaria a não-entrega, quando a verdade é ausência de informação.

**2. Marcos de tempo entram nesta fatia.** `sent_at`, `delivered_at`, `claimed_at`. Deixá-los fora
obrigaria a #1724 a trazer migration própria.

**3. `numeric(12,4)` para custo, contra a convenção da casa.** O repo usa `numeric(12,2)` para
dinheiro (9 ocorrências no baseline). Aqui isso quebra: o utility custa **R$ 0,0350** por mensagem
(ADR-0029) e em duas casas viraria R$ 0,04 — **14% de erro por mensagem**, num número que o Teto de
Gasto usa como trava em reais. Desvio deliberado, com medição.

**4. Índice NÃO concorrente, dentro da transação.** As decisões diziam "CONCURRENTLY fora da
transação". Isso quebraria o ensaio: `CREATE INDEX CONCURRENTLY` não roda dentro de bloco de
transação (25001), e o valor do ensaio está em concatenar o **arquivo de verdade** — concorrente
significaria provar um arquivo diferente do que seria aplicado. Medido: a tabela tem **235 linhas**,
o lock é de milissegundos. Se ela crescer muito antes do apply, reavaliar; o custo de reavaliar é
uma contagem.

## As duas respostas que o CTO pediu

### A) O CHECK vivo — medido, não suposto

`scripts/ensaio-1721.sh`, `pg_get_constraintdef` contra o catálogo de **produção**, 2026-08-23:

```
CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'skipped'::text, 'failed'::text])))
```

`failed` **existe**. O arquivo que o brief citava
(`supabase/migrations/archive/20261122000000_blast_plans.sql`) é o original, revogado por
`archive/20270106000000_blast_plan_recipients_failed_status.sql` (ADR-0016 §4, #947). O baseline
reconciliado de prod (`20260101000000_baseline_prod_schema.sql:21889`) já carregava os quatro.

### B) O índice único é global — e o risco é pior do que "um callback falha"

**A tabela não tem `organization_id`.** O tenant vem por `plan_id → blast_plans.organization_id`
(ela está inclusive em `TABLES_WITHOUT_ORG_ID`, `src/shared/realtime/useRealtimeSubscription.ts:17-26`).
Então o precedente da casa **não é copiável**: `channel_messages` usa
`(organization_id, provider_message_id)`, parcial e **não único**
(`supabase/migrations/20270819140000_channel_messages_provider_message_id.sql:35-37`), e o casamento
no webhook é explicitamente por tenant (`supabase/functions/notificame-webhook/index.ts:1141-1163`).
Escopar por `(plan_id, provider_message_id)` também não serve: quem procura a linha a partir do
callback tem o id do fornecedor e **não** o plano.

O modo de falha real é na **escrita**, não na leitura. Quem grava o `provider_message_id` é o nosso
worker, logo depois do envio. Se o fornecedor repetir id entre organizações, o `UPDATE` estoura
**23505** com a mensagem **já enviada**: a linha fica sem o id, o callback nunca casa, e uma retomada
reenvia. **Duplicata cobrada** — exatamente o que o ADR-0028 §5 manda evitar. O risco não é
observabilidade perdida, é dinheiro gasto duas vezes.

**Não confirmei com o fornecedor que o id é globalmente único.** A única amostra que o repo tem é
`providerMessageId=U2hTM01ZaXNN…` (base64, medido em 2026-08-19), que é id do NotificaMe e **não** o
wamid da Meta; a documentação dele não fala de escopo. Segui com o índice global, como decidido.

**Saída de emergência, se a colisão aparecer:** acrescentar `organization_id` à tabela
(desnormalizado do plano, com backfill) e reescopar o índice para `(organization_id,
provider_message_id)` — **não** remover a unicidade, que é o que torna a idempotência real.

## Como "nada muda" foi provado

Duas provas, porque nenhuma sozinha basta.

**O banco** — ensaio transacional contra produção, uma execução, 14/14 asserções, `ROLLBACK`.
235 destinatários antes, depois e no final; distribuição por (org, status) idêntica por igualdade de
conjunto; `pg_get_indexdef` literal dos índices antigos inalterado; policies e grants inalterados;
toda linha pré-existente com as 6 colunas novas em NULL. Detalhe por asserção em `PLANO-1721.md §10`.

Três controles impedem verde por ausência: **CONTROLE VAZIO** (tabela sem linhas aborta),
**SONDA QUEBRADA** (`pending` tem de ser aceito, senão o instrumento recusa tudo) e
**CONTROLE NEGATIVO** (com o rollback aplicado, `delivered` volta a estourar 23514 — se não voltasse,
o verde teria vindo do ambiente e não da migration). O controle negativo roda **dentro da mesma
transação**, o que evitou uma segunda ida a produção.

**O código** — as suítes vitest existentes de blast rodam contra dublês em memória, que não têm CHECK
constraint: verde nelas não diz nada sobre uma migration. Então a prova do lado do código é a guarda
de vocabulário nova, e ela foi **mutada para provar que carrega peso**: tirar `unconfirmed` do CHECK,
gravar `"delivered"` em `blast-plan.ts:373`, e ampliar a union do frontend — as três mutações
reprovaram, cada uma numa asserção diferente.

## O que ficou de fora, e por quê

- **A union TS `BlastRecipientStatus`** (`src/modules/campaigns/hooks/useBlastPlanRecipients.ts:35`).
  Ampliá-la **quebra o build agora**: `BlastPlanRecipientsSheet.tsx:104` usa
  `Record<BlastRecipientStatus, number>` com literal exaustivo. E ampliar sem tratar os estados na
  tela seria mudança de comportamento — o que o ticket proíbe.
- **A tally de `useBlastPlans.ts:159-162`.** O `else p.pending += 1` joga qualquer status desconhecido
  no balde `pending`. Hoje é inerte porque ninguém escreve os valores novos. **É dívida datada**: o
  primeiro `delivered` de produção apareceria na tela como "Aguardando". Por isso virou **estopim**,
  não nota — o terceiro teste da guarda reprova no dia em que alguém gravar um estado novo, com a
  mensagem apontando para este parágrafo.
- **O worker, o webhook, a Lista de Supressão, o Teto de Gasto, o cálculo de custo.** Esta fatia dá a
  forma; quem a preenche vem depois.
- **`supabase gen types`** — só faz sentido depois do apply em prod.
- **O comentário obsoleto** em `supabase/functions/_shared/quick-blast/blast-plan.ts:59`, que ainda
  diz `pending | sent | skipped` e nunca foi atualizado quando `failed` entrou. É a mesma classe de
  drift que este ticket combate; não mexi para manter o diff honesto, mas é conserto de uma linha.

## O que sobrou para o humano

1. **Aplicar a migration em produção.** O ensaio já cumpriu o preflight de
   `Obsidian/.../05 — How-to/aplicar-migration-prod.md`: rollback capturado em arquivo **e testado
   rodando**, baseline medido no alvo (235 linhas, distribuição registrada em `PLANO-1721.md §10`).
2. **Regenerar os types** depois do apply.
3. O `supabase migration list` vai gravar a versão real (`2026…`), que ordena abaixo do prefixo
   fictício `2027…` deste arquivo. Isso é drift esperado neste repo — registrar, não "consertar".

## O que me surpreendeu

- **A tabela não tem `organization_id`.** Achei que teria, e o desenho do índice inteiro dependia
  disso. Foi o que transformou o item B de "confirme e registre" em decisão com risco real.
- **Só UM dos dois índices é parcial.** O brief dizia dois com `WHERE status='pending'`;
  `idx_blast_plan_recipients_lot` tem `status` como terceira **coluna**, sem predicado. Eu teria
  assertado a coisa errada e o ensaio passaria verde provando outra coisa.
- **Produção inteira são 235 linhas, de uma organização só.** O motor de disparo do produto tem
  três disparos em toda a história (ADR-0028) e este é o maior. Foi o que resolveu a questão do
  `CONCURRENTLY` — por medição, não por preferência.
- **`scripts/db-push-branch.sh` não existe.** O `CLAUDE.md:106` afirma que "toda escrita" passa por
  ele e lista cinco recusas mecânicas. O arquivo não está na árvore nem é rastreado
  (`git ls-files` vazio); sobrevive só num commit de resgate, `9e57b89b`. **Guarda que a
  documentação promete e o repo não tem é pior que guarda nenhuma, porque as pessoas confiam nela.**
  Fora do escopo desta fatia; fica reportado. Cabe issue própria.
