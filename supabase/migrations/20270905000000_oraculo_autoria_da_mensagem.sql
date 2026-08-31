-- Autoria da mensagem enviada — SCRUM-593, ADR-0033 §4.
--
-- `whatsapp_messages.sent_source` distingue robô de gente. "Gente", porém, não
-- tem nome: a atividade principal de um vendedor fica sem dono no banco.
--
-- ── ALCANCE REAL, MEDIDO ANTES DE ESCREVER ────────────────────────────────
-- Em 30 dias de produção houve 268.735 mensagens humanas `outgoing`. Delas,
-- 53 (0,020%) saíram pela caixa de entrada do CRM; as outras saíram do
-- WhatsApp Web ou do celular do vendedor e chegaram aqui espelhadas pelo
-- provedor. Só 2 das 31 organizações que enviam usam a caixa do CRM.
--
-- Ou seja: esta coluna nasce cobrindo uma fração pequena da atividade, e o
-- caminho pessoa↔instância não salva (101 instâncias enviam, 5 têm dono único
-- declarado). Ela entra assim mesmo porque NÃO HÁ BACKFILL — cada semana sem
-- ela é uma semana de perfil que nunca vai existir — e porque é pré-requisito
-- de qualquer caminho futuro. O que fazer com a lacuna é decisão de produto.
--
-- Nullable de propósito: envio de robô, de Master e de Gestor de Portfólio
-- não tem Team Member autor, e inventar um seria pior que não ter.

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS sent_by_team_member_id uuid
    REFERENCES public.team_members(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.whatsapp_messages.sent_by_team_member_id IS
  'Team Member que enviou esta mensagem pela caixa de entrada do CRM. NULL para robô (sent_source != manual), para envio espelhado do aparelho do vendedor, e para ator sem cadeira na org (Master, Gestor). Não há backfill — mensagens anteriores a 2026-08-31 permanecem anônimas.';

ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS sent_by_team_member_id uuid
    REFERENCES public.team_members(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.channel_messages.sent_by_team_member_id IS
  'Team Member que enviou esta mensagem pelo canal oficial. Mesmas regras de whatsapp_messages.sent_by_team_member_id.';

-- Índice para a leitura que motivou a coluna: "o que esta pessoa fez no
-- período". Parcial — a esmagadora maioria das linhas é NULL e não interessa.
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_autor
  ON public.whatsapp_messages (organization_id, sent_by_team_member_id, created_at DESC)
  WHERE sent_by_team_member_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_channel_messages_autor
  ON public.channel_messages (organization_id, sent_by_team_member_id, created_at DESC)
  WHERE sent_by_team_member_id IS NOT NULL;
