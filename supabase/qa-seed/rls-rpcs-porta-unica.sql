-- ============================================================================
-- SCRUM-172, parte 2 — `abrir_negocio` sob sessão real.
--
-- Ela é a PORTA ÚNICA de criação de Negócio (ADR-0023 §3/§4). Porta única com
-- furo de tenant é pior que nenhuma porta: concentra o tráfego exatamente onde
-- o furo está. A migration prova que a função existe e é SECURITY INVOKER;
-- aqui se prova que ela respeita quem chamou.
--
-- Assinatura real, medida no banco:
--   abrir_negocio(p_lead_id uuid, p_pipe text, p_stage text, p_owner_id uuid,
--                 p_value numeric, p_meeting_date timestamptz, p_notes text,
--                 p_title text)
-- `p_pipe`/`p_stage` são TEXTO (slug do funil e chave da etapa), não uuid.
--
-- Roda depois de rls-deals-tres-papeis.sql.
-- ============================================================================

DROP TABLE IF EXISTS public.qa_resultado_rpc_172;
CREATE TABLE public.qa_resultado_rpc_172 (caso text, esperado text, obtido text, passou boolean);

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- As etapas dos funis do sistema para as duas orgs. Sem elas a RPC não tem
-- destino e o teste mediria "etapa não existe" em vez de tenant.
SELECT public.create_default_pipeline_stages('aaaa0000-0000-0000-0000-00000000000a');
SELECT public.create_default_pipeline_stages('bbbb0000-0000-0000-0000-00000000000b');

-- E a LINHA do funil em `pipelines`. `create_default_pipeline_stages` semeia só
-- `pipeline_stages`; `abrir_negocio` resolve o funil pelo slug em `pipelines` e
-- devolve "Pipeline whatsapp not found for org" sem ela. Em produção quem cria
-- essa linha é o provisionamento da org, que não roda numa branch vazia.
INSERT INTO public.pipelines (organization_id, name, slug, type, is_active)
VALUES ('aaaa0000-0000-0000-0000-00000000000a', 'Qualificação', 'whatsapp', 'system', true),
       ('bbbb0000-0000-0000-0000-00000000000b', 'Qualificação', 'whatsapp', 'system', true)
ON CONFLICT DO NOTHING;

-- ── ADMIN abre negócio no lead da PRÓPRIA org: tem que funcionar ──────────
-- Admin, e não membro: a RLS de `leads` esconde de um `member` o lead que não
-- é dele (o gate `leads.view_all`), então o membro esbarra na VISIBILIDADE
-- antes de chegar à porta. Isso é a regra funcionando — está medido no caso
-- seguinte, para não virar surpresa em produção.
DO $$
DECLARE v_id uuid; v_erro text := 'ok';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"dee05255-199b-4cfb-bda3-89035f8473a5","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT public.abrir_negocio('1eaa0000-0000-0000-0000-00000000000a'::uuid, 'whatsapp', 'novo',
                                NULL, NULL, NULL, NULL, NULL) INTO v_id;
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  INSERT INTO public.qa_resultado_rpc_172 VALUES
    ('admin abre negócio no lead da própria org', 'ok', v_erro, v_erro = 'ok' AND v_id IS NOT NULL);
END $$;

-- ── MEMBRO sem o lead atribuído: a visibilidade barra ANTES da porta ──────
DO $$
DECLARE v_id uuid; v_erro text := 'PASSOU (visibilidade furada)';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"a989b6b7-87f3-4c92-b0dc-1dd1349980a3","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT public.abrir_negocio('1eaa0000-0000-0000-0000-00000000000a'::uuid, 'whatsapp', 'novo',
                                NULL, NULL, NULL, NULL, NULL) INTO v_id;
  EXCEPTION WHEN OTHERS THEN
    v_erro := 'recusado (' || SQLSTATE || ')';
  END;
  RESET ROLE;
  INSERT INTO public.qa_resultado_rpc_172 VALUES
    ('membro sem lead atribuído esbarra na RLS de leads, não na porta', 'recusado', v_erro, v_erro LIKE 'recusado%');
END $$;

-- ── MEMBRO tentando abrir no lead da org VIZINHA: tem que RECUSAR ─────────
DO $$
DECLARE v_id uuid; v_erro text := 'PASSOU (furo de tenant)';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"a989b6b7-87f3-4c92-b0dc-1dd1349980a3","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT public.abrir_negocio('1ebb0000-0000-0000-0000-00000000000b'::uuid, 'whatsapp', 'novo',
                                NULL, NULL, NULL, NULL, NULL) INTO v_id;
  EXCEPTION WHEN OTHERS THEN
    v_erro := 'recusado (' || SQLSTATE || ')';
  END;
  RESET ROLE;
  INSERT INTO public.qa_resultado_rpc_172 VALUES
    ('membro NÃO abre negócio em lead de outra org (IDOR)', 'recusado', v_erro, v_erro LIKE 'recusado%');
END $$;

-- ── anon chamando a porta ─────────────────────────────────────────────────
DO $$
DECLARE v_id uuid; v_erro text := 'EXECUTOU (grant indevido)';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN
    SELECT public.abrir_negocio('1eaa0000-0000-0000-0000-00000000000a'::uuid, 'whatsapp', 'novo',
                                NULL, NULL, NULL, NULL, NULL) INTO v_id;
  EXCEPTION WHEN insufficient_privilege THEN
    v_erro := 'sem grant';
  WHEN OTHERS THEN
    v_erro := 'recusado (' || SQLSTATE || ')';
  END;
  RESET ROLE;
  INSERT INTO public.qa_resultado_rpc_172 VALUES
    ('anon NÃO cria negócio pela porta única', 'sem grant ou recusado', v_erro,
     v_erro = 'sem grant' OR v_erro LIKE 'recusado%');
END $$;
