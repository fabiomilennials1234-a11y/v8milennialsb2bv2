-- ============================================================================
-- #1721 — o estado do Blast Recipient comporta entrega, custo e reivindicação
--
-- PREFACTOR: expande a FORMA da linha do destinatário para o que o Canal Oficial
-- vai exigir (ADR-0028, ADR-0029). ZERO mudança de comportamento hoje — nenhum
-- escritor emite os valores novos, nenhuma coluna nova nasce com valor.
--
-- POR QUE AGORA, E NÃO NA FATIA QUE PRECISAR:
--   sem isto, cada slice seguinte (#1724 adiante) traria migration própria. O
--   prefactor existe exatamente para que a forma chegue uma vez só.
--
-- POR QUE OS DOIS ESTADOS NOVOS:
--   `delivered` — a Meta cobra NA ENTREGA, não no envio (ADR-0029). `sent` deixa
--     de ser o fim da linha; o custo realizado é a soma das entregues.
--   `unconfirmed` — o TTL do template vai a 30 dias e a mensagem não entregue
--     dentro dele é descartada EM SILÊNCIO. Isso não é entrega nem falha: é
--     ausência de informação, e o nome não pode alegar mais do que se sabe.
--     Não é `expired` porque o vocabulário já está ocupado neste repo (execução
--     de automação usa `expired`, #1683), e não é `undelivered` porque afirmaria
--     a não-entrega.
--
-- O CHECK É SUPERCONJUNTO ESTRITO do que vive hoje
-- ('pending','sent','skipped','failed' — ADR-0016 §4, archive/20270106000000):
-- nenhuma linha existente pode ser invalidada por esta mudança.
--
-- ÍNDICE NÃO CONCORRENTE, DELIBERADO: `CREATE INDEX CONCURRENTLY` não roda dentro
-- de bloco de transação (25001), e o ensaio deste ticket vale porque concatena
-- ESTE arquivo — não uma cópia. Concorrente aqui significaria provar um arquivo
-- diferente do que vai ser aplicado. A tabela é minúscula (ADR-0028 mediu 3
-- disparos em toda a história do produto, o maior com 235 destinatários), então o
-- lock é de milissegundos.
--
-- SÓ SCHEMA. ZERO DML (guarda F4 do CLAUDE.md).
-- ============================================================================

-- ─── 1. O estado ────────────────────────────────────────────────────────────
-- Mesmo padrão do archive/20270106000000, que é como `failed` entrou: derruba
-- pelo nome e recria com o nome, para que a constraint continue se chamando o
-- que o resto do mundo já chama.

ALTER TABLE public.blast_plan_recipients
  DROP CONSTRAINT IF EXISTS blast_plan_recipients_status_check;

ALTER TABLE public.blast_plan_recipients
  ADD CONSTRAINT blast_plan_recipients_status_check
  CHECK (status IN ('pending', 'sent', 'skipped', 'failed', 'delivered', 'unconfirmed'));

-- ─── 2. As colunas ──────────────────────────────────────────────────────────
-- Todas NULL, nenhuma com DEFAULT. É isto que torna a migration inerte para o
-- que já existe: nenhuma linha é reescrita, nenhum valor é inventado para o
-- passado. O que já passou não tem marca de entrega porque de fato não tem.

ALTER TABLE public.blast_plan_recipients
  ADD COLUMN IF NOT EXISTS sent_at             timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at        timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at          timestamptz,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS estimated_cost      numeric(12,4),
  ADD COLUMN IF NOT EXISTS actual_cost         numeric(12,4);

-- ─── 3. A idempotência ──────────────────────────────────────────────────────
-- O fornecedor não oferece chave de idempotência (ADR-0028 §5: busca por
-- `idempot`/`retry`/`duplicad` na doc do NotificaMe devolve zero ocorrências), e
-- reprocessar um lote parcialmente enviado duplica envio — duplicata que é
-- COBRADA. A garantia de envio único mora na linha.
--
-- Parcial porque a coluna nasce NULL em toda linha existente: sem risco de o
-- índice falhar ao ser criado. Forma da casa — ver
-- idx_conversation_messages_idempotency.
--
-- ESCOPO GLOBAL, e isto é uma decisão com risco registrado: esta tabela NÃO tem
-- `organization_id` (o tenant vem por plan_id → blast_plans), então o precedente
-- de channel_messages — (organization_id, provider_message_id) — não é copiável.
-- Se o fornecedor repetir id entre organizações, quem estoura 23505 é o UPDATE do
-- worker DEPOIS de a mensagem ter saído. Ver .specs/blast/HANDOFF-1721.md § R1.

CREATE UNIQUE INDEX IF NOT EXISTS idx_blast_plan_recipients_provider_message_id
  ON public.blast_plan_recipients (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- ─── 4. A documentação, no schema ───────────────────────────────────────────

COMMENT ON COLUMN public.blast_plan_recipients.status IS
  'pending | sent | skipped | failed | delivered | unconfirmed. `sent` = aceito pela fila no despacho (otimista, ADR-0016 §4); `delivered` = entrega confirmada pelo callback, e é o evento que a Meta COBRA (ADR-0028 §4); `unconfirmed` = passou o TTL de 30 dias sem confirmação — nem entregue, nem falha, apenas sem informação; `failed` = recusa do fornecedor/Meta; `skipped` = refinado para fora antes do envio.';

COMMENT ON COLUMN public.blast_plan_recipients.sent_at IS
  'Quando a mensagem foi entregue ao fornecedor. NULL em tudo que foi disparado antes de #1721 — não é retrofit, é ausência honesta.';

COMMENT ON COLUMN public.blast_plan_recipients.delivered_at IS
  'Quando o callback de status confirmou a entrega. É o instante que gera cobrança no Canal Oficial (ADR-0029: R$ 0,3217 marketing / R$ 0,0350 utility por mensagem ENTREGUE).';

COMMENT ON COLUMN public.blast_plan_recipients.claimed_at IS
  'Reivindicação do worker, gravada ANTES do envio. É o que impede dois tiques do cron de pegarem o mesmo destinatário (ADR-0028 §5), já que o fornecedor não oferece chave de idempotência.';

COMMENT ON COLUMN public.blast_plan_recipients.provider_message_id IS
  'Id da mensagem no lado do fornecedor. É a ÚNICA chave estável entre callbacks: o `messageId` do evento muda a cada callback do mesmo envio (medido em 2026-08-19, ver 20270819140000_channel_messages_provider_message_id.sql). Único por índice parcial — a garantia de envio único.';

COMMENT ON COLUMN public.blast_plan_recipients.estimated_cost IS
  'Custo previsto no momento do envio, em reais. Quatro casas decimais porque o preço unitário do utility é R$ 0,0350 — em duas casas viraria R$ 0,04, 14% de erro por mensagem, e o Teto de Gasto do ADR-0029 é uma trava em reais.';

COMMENT ON COLUMN public.blast_plan_recipients.actual_cost IS
  'Custo realizado, escrito quando a entrega é confirmada. Separado do previsto porque o que está apenas enviado ainda não é fatura (ADR-0028 §4).';
