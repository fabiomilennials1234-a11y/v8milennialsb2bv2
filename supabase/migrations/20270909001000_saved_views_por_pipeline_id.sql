-- ============================================================================
-- SCRUM-634 (W4 · Funil é Funil): saved_views de funil por pipeline_id.
--
-- entity_type de view de funil deixava o slug da view legada
-- ("pipe_whatsapp"/"pipe_confirmacao"/"pipe_propostas"). A página unificada
-- consulta por funil — sistema OU custom — então o formato canônico passa a
-- ser 'pipeline:{uuid}'. "leads" não é funil e continua como está.
--
-- Resolução: (organization_id da view) → funil de sistema da org com
-- pipelines.slug = slug da view sem o prefixo "pipe_". O UNIQUE
-- (organization_id, slug) de pipelines torna a resolução determinística.
-- is_active não filtra: funil inativo ainda existe e a view continua dele.
--
-- Órfãs — view de org SEM o funil de sistema semeado (em 2026-09-02 duas orgs
-- não têm os funis de sistema: AUTOTEK e Emdisa Distribuidora): a view fica
-- COMO ESTÁ, com o slug legado, e a migration só reporta via WARNING. Motivo:
-- (a) prod tem hoje 0 linhas em saved_views — o caso é defensivo; (b) apagar
-- ou remarcar destruiria dado de usuário por um estado recuperável (a org pode
-- ganhar o funil depois); (c) o front trata slug legado como fallback
-- documentado — a view órfã só não aparece em listagem nenhuma, nada quebra
-- (src/types/saved-views.ts).
--
-- Idempotente: linhas já migradas não casam mais o predicado de slug legado;
-- na segunda execução origem = órfãs e o UPDATE afeta 0 linhas — a asserção
-- (migradas = origem − órfãs) segue válida.
--
-- Rollback pareado: supabase/migrations/rollback/20270909001000_*.sql
-- (reverso determinístico uuid → 'pipe_' || slug).
-- ============================================================================

DO $$
DECLARE
  v_origem   integer;
  v_migradas integer;
  v_orfas    integer;
BEGIN
  SELECT count(*) INTO v_origem
    FROM public.saved_views
   WHERE entity_type IN ('pipe_whatsapp', 'pipe_confirmacao', 'pipe_propostas');

  UPDATE public.saved_views sv
     SET entity_type = 'pipeline:' || p.id,
         updated_at  = now()
    FROM public.pipelines p
   WHERE sv.entity_type IN ('pipe_whatsapp', 'pipe_confirmacao', 'pipe_propostas')
     AND p.organization_id = sv.organization_id
     AND p.type = 'system' -- metric-lint-allow: migração de dado — resolve o funil SEMEADO, não filtra métrica
     AND p.slug = substring(sv.entity_type FROM 'pipe_(.*)');
  GET DIAGNOSTICS v_migradas = ROW_COUNT;

  SELECT count(*) INTO v_orfas
    FROM public.saved_views
   WHERE entity_type IN ('pipe_whatsapp', 'pipe_confirmacao', 'pipe_propostas');

  -- Contabilidade fechada ou aborta: tudo que saiu da origem virou
  -- 'pipeline:{uuid}'; o que sobrou é exatamente o conjunto órfão.
  IF v_migradas <> v_origem - v_orfas THEN
    RAISE EXCEPTION
      'saved_views: contabilidade não fecha — migradas % <> origem % - órfãs %',
      v_migradas, v_origem, v_orfas;
  END IF;

  IF v_orfas > 0 THEN
    RAISE WARNING
      'saved_views: % view(s) órfã(s) mantida(s) com slug legado (org sem funil de sistema correspondente)',
      v_orfas;
  END IF;

  RAISE NOTICE
    'saved_views → pipeline:{uuid}: origem=% migradas=% órfãs=%',
    v_origem, v_migradas, v_orfas;
END $$;
