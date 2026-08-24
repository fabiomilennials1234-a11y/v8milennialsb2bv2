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
3. Conferir o ledger depois do apply. `supabase/migrations/CLAUDE.md` § "Listar migrations
   aplicadas" avisa que a versão gravada pode não bater com o prefixo do arquivo, e que divergência
   aí é drift a registrar, **não** a reaplicar. O `/code-review` contestou o mecanismo (sustenta que
   `db push` grava o próprio prefixo do arquivo). **Eu não medi qual dos dois está certo** — só
   sei que o repo documenta a primeira versão. Conferir na hora do apply, com o ledger na mão.

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


## O que o /code-review mudou

Dois eixos em paralelo (Standards, Spec). **Zero violações duras de padrão documentado.** O que
saiu de lá e virou conserto:

**Consertado — rollback devolvia o comentário pela metade.** O `COMMENT ON COLUMN` do rollback
truncava o texto vivo, perdendo a segunda metade (`…the mass-send-status poll may reclassify it to
failed…`). O arquivo afirmava no cabeçalho que devolvia a tabela "à forma medida"; devolvia quase.
Agora é **verbatim** de `20260101000000_baseline_prod_schema.sql:21896`. E o achado expõe um limite
real do ensaio: a asserção 13 compara índices, constraints, colunas, policies e grants — **não
comentários** — então ela passou por cima desta perda. Quem mexer no ensaio depois: acrescentar
`obj_description`/`col_description` ao eixo comparado.

**Consertado — a guarda 4 do `ensaio-1721.sh` afirmava mais do que checava.** Ela dizia "todo INSERT
está dentro de uma sonda" mas casava por **texto** (`grep -v 'blast_plan_recipients (plan_id'`), de
modo que um INSERT de topo no mesmo formato passaria. Agora checa **posição**: conta as aberturas
`$sonda$` antes de cada INSERT e recusa os de número par (fora de sonda). Mutado para provar que
pega — e a primeira tentativa de mutação foi capturada pela guarda 1 (última instrução), o que não
exercitava a guarda 4; refiz com o INSERT antes do `ROLLBACK` e vi a recusa certa.

**Consertado — a prova não era reconferível a partir do repo.** Os `235 → 235 → 235` viviam só como
prosa. A saída literal da execução está agora em
[`.specs/blast/ensaio-1721-relatorio-2026-08-23.md`](./ensaio-1721-relatorio-2026-08-23.md), com a
ressalva de proveniência: é transcrição do stdout, não arquivo que o script escreveu. O próximo
ensaio deve fazer `tee`.

**Consertado — a varredura de forasteiros só conhecia uma forma de escrever status.** Casava
`status: "x"` e deixava passar `.eq("status", "x")`, que é justamente como `mass-send-status` filtra.
Agora cobre as duas.

**Recusado, de propósito — de-duplicar os snapshots do ensaio e renomear as variáveis (`v_a`
reusada para duas coisas).** Os três blocos repetidos e os nomes fracos são reais. Mas os `.sql` do
ensaio **já foram executados contra produção**: editá-los faria o arquivo em disco deixar de
corresponder ao que rodou, e a evidência viraria ficção. Revalidar exigiria reexecutar, e a
autorização do CTO valeu para aquela execução e se encerrou. Fica como dívida explícita para quem
tiver o próximo ensaio autorizado. (O `.sh` é outra coisa — é o arreio, não a evidência; por isso a
guarda 4 pôde ser apertada.)

**Aceito como escopo deliberado, não creep** — a varredura de vocabulário de outras tabelas
(`blast_plans`, `uazapi_sender_jobs`, `runtime_logs`) e o teste 4, que fixa a union em quatro
valores. A revisão está certa que a spec não pediu nenhum dos dois. Ambos seguem o precedente do
`tests/unit/role-vocabulary.test.ts`, e o custo de manutenção é uma linha na allowlist **com
motivo**. O teste 4 é o estopim que obriga a próxima fatia a tratar a tela antes de gravar
`delivered` — sem ele, o primeiro `delivered` de produção aparece como "Aguardando".

**Registrado, não construído — `claimed_at` não tem índice que a sustente.** A spec pede que "a
linha guarde" a marca, e ela guarda. Mas a consulta que o worker vai fazer
(`claimed_at IS NULL AND status = 'pending'`, por plano e lote) não tem índice parcial que a sirva;
o `idx_blast_plan_recipients_instance` cobre `(plan_id, lot_index, instance_id) WHERE status =
'pending'` e serve de ponto de partida. **A fatia do worker paga essa conta** — e paga barato hoje,
com 235 linhas.

**Pendente de você, e é o único item que precisa da sua palavra:** o índice **não** concorrente
contraria a decisão 3 do `1721-decisoes.md` ("CONCURRENTLY fora da transação"). Eu inverti com base
em medição (235 linhas; e concorrente tornaria impossível o ensaio concatenar o arquivo real).
A revisão observou, com razão, que inverter uma decisão fechada pede reconhecimento explícito do
CTO, não um parágrafo de handoff. Está dito aqui e no PR.
