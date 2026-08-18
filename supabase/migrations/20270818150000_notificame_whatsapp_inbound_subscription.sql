-- ============================================================================
-- Migration: NotificaMe — estado da subscription de entrada para WHATSAPP
-- Data: 2027-08-18
-- Branch: feat/notificame-inbound-whatsapp-p2
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  O QUE FALTA, E POR QUE ESTA TABELA                                      ║
-- ║                                                                          ║
-- ║  A 20270816120000 deu ESTADO e FILA ao recebimento — mas só em            ║
-- ║  `messaging_channels`, que hospeda apenas canais SOCIAIS. O WhatsApp      ║
-- ║  oficial mora em `whatsapp_instances`, e por decisão explícita:           ║
-- ║  gravá-lo em `messaging_channels` daria a ele o rótulo errado em 13       ║
-- ║  telas e comeria vaga de canal social.                                    ║
-- ║                                                                          ║
-- ║  Resultado hoje: `notificame-channel-finish` tem um gate                  ║
-- ║  `if (channelKind === "instagram")` em volta do registro da subscription, ║
-- ║  porque para WhatsApp não HAVIA onde carimbar o resultado. O canal        ║
-- ║  conecta, envia, e nunca recebe.                                          ║
-- ║                                                                          ║
-- ║  Medido em produção (Chique Distribuidora, 2026-08-18): canal oficial     ║
-- ║  vinculado, log com `notificame.channel_bound` e SEM                      ║
-- ║  `subscription_registered` — enquanto o Instagram da Milennials, no dia   ║
-- ║  anterior, tem os dois.                                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ─── POR QUE COLUNAS, E NÃO `provider_config` ───────────────────────────────
--
-- `whatsapp_instances.provider_config` é jsonb e já carrega `channel_id`,
-- `subaccount_id` e afins. Seria uma linha a menos de migration guardar o estado
-- ali — e seria repetir EXATAMENTE o defeito que a 20270816120000 existe para
-- corrigir: o estado morava em `provider_config.subscription`, ninguém lia, e o
-- sintoma ("não recebe") era indistinguível de "ninguém mandou mensagem".
--
-- O que dá leitor ao sinal é a FILA, e fila precisa de predicado indexável. Um
-- índice parcial sobre expressão jsonb é possível, mas paga custo e esconde a
-- pergunta: "quantos canais estão conectados sem receber?" tem que ser um
-- SELECT COUNT trivial, não uma expedição pelo jsonb.
--
-- ─── SIMETRIA DELIBERADA ────────────────────────────────────────────────────
--
-- Nomes, defaults e CHECK são IDÊNTICOS aos de `messaging_channels`. O cron de
-- reparo vai varrer as duas tabelas, e duas formas diferentes para o mesmo
-- conceito transformariam esse worker em dois caminhos que divergem na primeira
-- manutenção.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. As colunas.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `ADD COLUMN ... NOT NULL DEFAULT` com default NÃO-VOLÁTIL é metadata-only no
-- Postgres 11+: não reescreve a tabela, não trava a fila de escrita.
--
-- ⚠️ O DEFAULT É 'not_applicable', e aqui ele DIVERGE de `messaging_channels`
-- de propósito. Aquela tabela só tem canal social, e todo canal social precisa
-- de subscription — 'pending' é o estado certo lá. Esta tabela é majoritariamente
-- Uazapi/Evolution, que não têm subscription NENHUMA no NotificaMe: nascer
-- 'pending' jogaria toda instância não-oficial do produto numa fila de reparo que
-- nunca teria o que reparar. Quem marca 'pending' é o `channel-finish`, no
-- momento em que sabe que o canal é notificame.
ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS inbound_subscription_status TEXT NOT NULL DEFAULT 'not_applicable';

ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS inbound_subscription_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS inbound_subscription_last_error TEXT;

ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS inbound_subscription_last_attempt_at TIMESTAMPTZ;

ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS inbound_subscription_next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS inbound_subscription_registered_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O CHECK — o mesmo vocabulário das duas tabelas.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Sem ele, um valor inventado ('ok', 'done') entra e o predicado da fila deixa
-- de encontrar a linha — falha silenciosa, que é o modo de falha que esta fatia
-- inteira existe para eliminar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_whatsapp_instances_inbound_subscription_status'
  ) THEN
    ALTER TABLE public.whatsapp_instances
      ADD CONSTRAINT chk_whatsapp_instances_inbound_subscription_status
      CHECK (inbound_subscription_status IN ('pending', 'active', 'failed', 'not_applicable'));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. O índice da fila: PARCIAL, pelo mesmo motivo da irmã.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Aqui o parcial importa MAIS que em `messaging_channels`: a esmagadora maioria
-- desta tabela é Uazapi e nasce 'not_applicable', fora do predicado. O índice
-- cobre só o punhado de linhas notificame que realmente entram na fila.
CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_subscription_due
  ON public.whatsapp_instances (inbound_subscription_next_attempt_at)
  WHERE inbound_subscription_status IN ('pending', 'failed');

COMMENT ON INDEX public.idx_whatsapp_instances_subscription_due IS
  'Fila do notificame-subscription-repair para o WhatsApp oficial. Gêmeo de '
  'idx_messaging_channels_subscription_due — o worker varre as duas.';

COMMENT ON COLUMN public.whatsapp_instances.inbound_subscription_status IS
  'Recebimento registrado no NotificaMe. Default not_applicable: só instância '
  'com provider=notificame entra na fila; Uazapi/Evolution não têm subscription.';
