-- ============================================================================
-- Auto-distribuição round-robin de lead novo (opt-in por org)
--
-- Problema (feedback Sorvfoods #2, 2026-07-14): lead novo que entra sem
-- `place_in_pipe` (caso comum Meta Ads / n8n) cai UNASSIGNED — vendedores
-- recebem tudo misturado, sem dono. Round-robin já existe (get_next_pipe_sdr +
-- pipe_distribution_rules/members) mas o lead-webhook só o aciona quando o
-- payload posiciona o lead num pipe.
--
-- Este flag liga a distribuição automática de TODO lead novo (via pool do pipe
-- whatsapp) para a org. Opt-in: default OFF para não mudar comportamento das
-- ~30 orgs sem pedido. A org que ligar precisa ter pool configurado em
-- pipe_distribution_members (senão nada é atribuído — degrada silencioso).
-- ============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS auto_distribute_new_leads boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.auto_distribute_new_leads IS
  'Se true, lead novo sem place_in_pipe é auto-distribuído round-robin ao pré-venda (pool do pipe whatsapp) no ingest. Default false (opt-in).';
