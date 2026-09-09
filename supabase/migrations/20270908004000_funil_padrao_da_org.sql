-- 20270908004000_funil_padrao_da_org.sql — SCRUM-624 (W3 · Funil é Funil)
--
-- D4 (spec funis-unificacao): "Um único fallback: o funil padrão da org."
-- Toda porta de entrada sem destino declarado cai aqui — a primeira consumidora
-- é o lead-webhook (lead sem place_in_pipe), que aposenta o hardcode
-- whatsapp/novo.
--
-- Por que COLUNA em organizations (e não tabela de config nem feature_flags):
-- é o padrão da casa para configuração escalar de org com FK — vizinhos diretos
-- `confirmacao_overdue_days`, `default_reorder_cycle_days`,
-- `auto_create_lead_on_inbound`, `whatsapp_provider_override`. FK real dá
-- integridade que jsonb (feature_flags) não dá: funil deletado nunca deixa
-- referência pendurada.
--
-- Fatos medidos em prod 2026-09-02 que sustentam o backfill:
--   • 108 orgs; 106 têm funil com slug 'whatsapp' (o semeado de Oportunidades);
--     0 desses estão inativos. Backfill cobre 106/108.
--   • slug é único por org (medição da 20270908003000) → resolução por
--     (org, slug) é determinística.
--   • As 2 orgs sem o funil ficam com default NULL = "sem funil padrão":
--     lead que chega sem destino é criado SEM card (mesmo comportamento que
--     essas orgs já têm hoje, agora explícito e logado).
--
-- Deleção do funil apontado (D3/D4): trigger BEFORE DELETE recusa apagar o
-- funil que é padrão de alguma org, com mensagem que pede substituto. A
-- checagem mora na TABELA (não nas RPCs delete_pipeline/delete_*_pipeline da
-- 20270908003000/SCRUM-626) de propósito: cobre todo caminho de DELETE sem
-- editar as RPCs em fusão pelo outro trilho. O FK ainda declara ON DELETE SET
-- NULL como cinto de segurança — se um dia o trigger cair, a org degrada para
-- "sem padrão" em vez de quebrar o DELETE com erro de FK cru.
--
-- Sem BEGIN/COMMIT de topo: o CLI embrulha em transação e o ensaio
-- (scripts/ensaio-scrum624.sh) concatena este arquivo numa transação maior.
-- Rollback pareado: supabase/migrations/rollback/20270908004000_funil_padrao_da_org.sql

-- ─── 1. Coluna ──────────────────────────────────────────────────────────────

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_pipeline_id uuid
    REFERENCES public.pipelines(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.organizations.default_pipeline_id IS
  'Funil padrão da org (D4, SCRUM-624): fallback único das portas de entrada sem destino declarado. NULL = sem padrão (lead entra sem card). Protegido contra DELETE do funil apontado por trg_guard_default_pipeline_delete.';

-- Índice no lado referenciador: o SET NULL do FK e a guarda do trigger varrem
-- organizations por default_pipeline_id. 108 linhas hoje — o índice é sobre
-- higiene (FK sem índice é o anti-padrão nº 1 de lock em DELETE), não sobre
-- volume.
CREATE INDEX IF NOT EXISTS idx_organizations_default_pipeline
  ON public.organizations (default_pipeline_id)
  WHERE default_pipeline_id IS NOT NULL;

-- ─── 2. Backfill ────────────────────────────────────────────────────────────
-- Aponta para o funil semeado slug 'whatsapp' de cada org, onde existir.
-- Guardas no próprio UPDATE (regra da casa: critério de aceite como predicado):
--   • só orgs ainda sem padrão (idempotente em replay);
--   • nunca aponta para funil desativado (0 em prod, mas o predicado fica).

UPDATE public.organizations o
SET default_pipeline_id = p.id
FROM public.pipelines p
WHERE p.organization_id = o.id
  AND p.slug = 'whatsapp'
  AND p.is_active IS DISTINCT FROM false
  AND o.default_pipeline_id IS NULL;

-- ─── 3. Guarda de deleção: funil padrão exige substituto ───────────────────

CREATE OR REPLACE FUNCTION public.fn_guard_default_pipeline_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só bloqueia quando a PRÓPRIA org ainda aponta para o funil. Deleção de org
  -- inteira não cai aqui: quando o CASCADE de organizations→pipelines dispara,
  -- a linha da org já saiu e o EXISTS não encontra nada.
  IF EXISTS (
    SELECT 1 FROM public.organizations
    WHERE default_pipeline_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'pipeline_is_org_default: o funil "%" é o funil padrão da organização. Escolha outro funil padrão em Configurações antes de excluí-lo.', OLD.name
      USING ERRCODE = 'P0001',
            HINT = 'Configurações → Geral → Funil padrão';
  END IF;
  RETURN OLD;
END;
$$;

-- DEFINER: o corpo lê organizations sob RLS deny-por-padrão; sem DEFINER a
-- guarda viraria no-op silencioso para roles que não enxergam a linha da org.
-- Superfície mínima: trigger function não é chamável por RPC, mas ainda assim
-- revogamos EXECUTE do PUBLIC (regra da casa: DROP/CREATE reseta ACL).
REVOKE ALL ON FUNCTION public.fn_guard_default_pipeline_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_default_pipeline_delete ON public.pipelines;
CREATE TRIGGER trg_guard_default_pipeline_delete
  BEFORE DELETE ON public.pipelines
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_default_pipeline_delete();
