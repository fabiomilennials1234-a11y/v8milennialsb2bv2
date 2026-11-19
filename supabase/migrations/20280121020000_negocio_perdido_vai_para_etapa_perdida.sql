-- Negócio perdido vai para a etapa de perda do funil — só em org com a flag.
--
-- Chamado Café Jurerê (19/11): ao marcar "Perdeu" no negócio, o card ficava na
-- etapa de origem; era preciso arrastar para "Perdido". O "Ganhou" já move
-- sozinho (20271021000039: "Vendido" é etapa de sucesso nos funis da org), mas
-- não existe equivalente para perda.
--
-- Flag `organizations.feature_flags->>'negocio_perdido_vai_para_etapa_perdida'`
-- = 'true'. Sem ela o trigger sai no primeiro IF: comportamento idêntico ao de
-- antes para todas as outras orgs.
--
-- Qual é "a etapa de perda": etapa ATIVA do mesmo funil, nesta ordem:
--   1. stage_role = 'lost' (menor position);
--   2. nome que diz "perdido"/"lost" com clareza (as etapas da Café Jurerê são
--      todas stage_role='open'; ver project_cafe_jurere_funis_sem_stage_role_terminal).
-- Sem nenhuma, nada se move — o desfecho vale sozinho. Etapa que também diz
-- "vendido/ganho" nunca é destino de perda.
--
-- Só a MOVIMENTAÇÃO falha em silêncio (check_violation): o desfecho já foi
-- gravado e é o fato. Reabrir (outcome -> open) não devolve o card.
-- Mover dispara o evento de etapa como qualquer arrasto.
--
-- Rollback: supabase/migrations/rollback/20280121020000_negocio_perdido_vai_para_etapa_perdida.sql

CREATE OR REPLACE FUNCTION public.fn_negocio_perdido_vai_para_etapa_perdida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_entry       record;
  v_ja_no_alvo  boolean;
  v_etapa       uuid;
  v_chave       text;
  v_nome_perda  constant text := '(^|[^[:alpha:]])(perdid[oa]s?|lost)([^[:alpha:]]|$)';
  v_nome_ganho  constant text := '(^|[^[:alpha:]])(vendid[oa]s?|ganh[oa]s?|won)([^[:alpha:]]|$)';
BEGIN
  IF NOT COALESCE((
    SELECT o.feature_flags ->> 'negocio_perdido_vai_para_etapa_perdida' = 'true'
      FROM public.organizations o
     WHERE o.id = NEW.organization_id
  ), false) THEN
    RETURN NULL;
  END IF;

  FOR v_entry IN
    SELECT pe.id, pe.pipeline_id, pe.stage_id, pe.stage_key
      FROM public.pipeline_entries pe
     WHERE pe.deal_id = NEW.id
       AND pe.organization_id = NEW.organization_id
  LOOP
    SELECT (ps.stage_role IS NOT DISTINCT FROM 'lost'
            OR (ps.name ~* v_nome_perda AND ps.name !~* v_nome_ganho))
      INTO v_ja_no_alvo
      FROM public.pipeline_stages ps
     WHERE ps.organization_id = NEW.organization_id
       AND ps.pipeline_id = v_entry.pipeline_id
       AND ((v_entry.stage_id IS NOT NULL AND ps.id = v_entry.stage_id)
         OR (v_entry.stage_id IS NULL AND ps.stage_key = v_entry.stage_key))
     LIMIT 1;

    CONTINUE WHEN COALESCE(v_ja_no_alvo, false);

    v_etapa := NULL;
    SELECT ps.id, ps.stage_key INTO v_etapa, v_chave
      FROM public.pipeline_stages ps
     WHERE ps.organization_id = NEW.organization_id
       AND ps.pipeline_id = v_entry.pipeline_id
       AND ps.is_active
       AND (ps.stage_role = 'lost'
            OR (ps.name ~* v_nome_perda AND ps.name !~* v_nome_ganho))
     ORDER BY (ps.stage_role IS NOT DISTINCT FROM 'lost') DESC, ps.position, ps.id
     LIMIT 1;

    CONTINUE WHEN v_etapa IS NULL;

    BEGIN
      -- stage_key junto com stage_id: o trigger de evento de etapa dispara pela
      -- lista do SET (ver 20271021000039).
      UPDATE public.pipeline_entries pe
         SET stage_id = v_etapa,
             stage_key = v_chave
       WHERE pe.id = v_entry.id;
    EXCEPTION WHEN check_violation THEN
      RAISE LOG 'fn_negocio_perdido_vai_para_etapa_perdida: entrada % ficou na etapa atual (%)',
        v_entry.id, SQLERRM;
    END;
  END LOOP;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.fn_negocio_perdido_vai_para_etapa_perdida() IS
  'Negócio perdido (deals.outcome -> lost) vai para a etapa ativa de perda do funil (stage_role=lost ou nome "Perdido"). Só com a flag negocio_perdido_vai_para_etapa_perdida na org. Ver 20280121020000.';

REVOKE ALL ON FUNCTION public.fn_negocio_perdido_vai_para_etapa_perdida() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_negocio_perdido_vai_para_etapa_perdida() FROM anon;
REVOKE ALL ON FUNCTION public.fn_negocio_perdido_vai_para_etapa_perdida() FROM authenticated;

DROP TRIGGER IF EXISTS trg_negocio_perdido_vai_para_etapa_perdida ON public.deals;
CREATE TRIGGER trg_negocio_perdido_vai_para_etapa_perdida
  AFTER UPDATE OF outcome ON public.deals
  FOR EACH ROW
  WHEN (NEW.outcome = 'lost' AND OLD.outcome IS DISTINCT FROM 'lost' AND NEW.deleted_at IS NULL)
  EXECUTE FUNCTION public.fn_negocio_perdido_vai_para_etapa_perdida();

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgrelid = 'public.deals'::regclass
         AND t.tgname = 'trg_negocio_perdido_vai_para_etapa_perdida'
         AND NOT t.tgisinternal) <> 1 THEN
    RAISE EXCEPTION 'trg_negocio_perdido_vai_para_etapa_perdida nao existe em deals';
  END IF;
  IF has_function_privilege('anon', 'public.fn_negocio_perdido_vai_para_etapa_perdida()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_negocio_perdido_vai_para_etapa_perdida()', 'EXECUTE') THEN
    RAISE EXCEPTION 'fn_negocio_perdido_vai_para_etapa_perdida ficou executavel por anon/authenticated';
  END IF;
END $$;
