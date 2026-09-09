-- ============================================================================
-- ROLLBACK de 20270909001000_saved_views_por_pipeline_id (SCRUM-634).
--
-- Reverso determinístico: 'pipeline:{uuid}' → 'pipe_' || pipelines.slug, só
-- pra funis de SISTEMA com os 3 slugs legados — exatamente o conjunto que a
-- migration de ida podia ter produzido a partir de slug legado.
--
-- Views de funil CUSTOM ('pipeline:{uuid}' de type='custom') NÃO são tocadas:
-- nunca tiveram forma legada — nasceram já no formato novo pela UI da W4.
-- Ficam como linhas inertes que a UI pré-W4 não lista; dado preservado pra
-- re-aplicação da migration. Views órfãs (slug legado mantido na ida) já
-- estão na forma revertida — no-op.
--
-- Idempotente: linha revertida não casa mais 'pipeline:' || p.id.
-- ============================================================================

DO $$
DECLARE
  v_revertidas integer;
BEGIN
  UPDATE public.saved_views sv
     SET entity_type = 'pipe_' || p.slug,
         updated_at  = now()
    FROM public.pipelines p
   WHERE sv.entity_type = 'pipeline:' || p.id
     AND p.type = 'system' -- metric-lint-allow: migração de dado — resolve o funil SEMEADO, não filtra métrica
     AND p.slug IN ('whatsapp', 'confirmacao', 'propostas');
  GET DIAGNOSTICS v_revertidas = ROW_COUNT;

  RAISE NOTICE 'saved_views rollback: % view(s) revertida(s) pra slug legado', v_revertidas;
END $$;
