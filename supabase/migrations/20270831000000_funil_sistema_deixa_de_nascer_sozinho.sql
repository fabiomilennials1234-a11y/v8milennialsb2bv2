-- 20270831000000_funil_sistema_deixa_de_nascer_sozinho.sql
--
-- Funil de SISTEMA (Oportunidades/whatsapp, Agendamentos/confirmacao,
-- Orçamentos/propostas, Carteira/upsell) deixa de nascer sozinho em org nova, e
-- passa a ser EXCLUÍVEL de verdade.
--
-- ── O PROBLEMA, MEDIDO ──────────────────────────────────────────────────────
--
-- Não havia como excluir esses funis porque o sistema se RECRIA sozinho. Havia
-- quatro torneiras de auto-semeadura no caminho de LEITURA — apagar as linhas e
-- recarregar a página trazia tudo de volta:
--
--   1. `ensure_pipeline_display_config`  ← chamada por usePipelineDisplayConfig
--      a CADA leitura. Reinsere as 4 linhas de nome/visibilidade.
--   2. `create_default_pipelines`        ← chamada por usePipelineId quando a
--      linha em `pipelines` não é achada. Reinsere as 3 linhas.
--   3. `ensureDefaultStagesInDb` (front) ← upsert direto em `pipeline_stages`.
--   4. `buildFallbackStages`   (front)   ← fabrica etapas EM MEMÓRIA, então o
--      funil renderizava mesmo com o banco limpo.
--
-- Esta migration fecha as duas primeiras. As duas do front saem no mesmo PR.
--
-- Medido em prod 2026-08-26: 105 das 107 orgs têm as 4 linhas de display e as 3
-- de `pipelines` (315 = 105 × 3), e ZERO org tem qualquer pipe oculto. Ou seja,
-- o estado "ligado" é universal e foi produzido por estas torneiras, não por
-- escolha de ninguém.
--
-- ⚠️ O trigger `trigger_create_default_stages` EXISTE como função mas NÃO está
--    ligado a tabela nenhuma (`pg_trigger` não tem entrada para ele). Quem
--    semeava org nova era o front, preguiçosamente. Não mexo nele: já é inerte,
--    e dropar função sem chamador é fora do escopo deste diff.
--
-- ── A REGRA NOVA ────────────────────────────────────────────────────────────
--
-- `pipeline_display_config` vira o REGISTRO de quais funis de sistema a org
-- tem. A semântica passa a ser:
--
--   linha ausente          → a org NÃO tem esse funil. Não existe.
--   linha, is_visible=true → tem, e aparece.
--   linha, is_visible=false→ tem, mas está oculto (estado antigo, preservado).
--
-- Isso é o que torna a exclusão possível: apagar a linha é o ato, e nada a
-- recria. E é o que entrega "não vem por padrão" — org nova nasce com zero
-- linhas, logo com zero funis de sistema.
--
-- 🔒 NENHUMA ORG EXISTENTE MUDA. As três funções só param de CRIAR; nenhuma
--    apaga nada. As 105 orgs seguem com exatamente as linhas que já têm.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. `ensure_pipeline_display_config` vira NO-OP.
--
-- Por que manter a função em vez de dropar: o front chama esta RPC a cada
-- leitura de `usePipelineDisplayConfig`, e durante a janela de deploy os
-- navegadores continuam servindo o bundle ANTIGO por um tempo. Dropar faria
-- essas chamadas devolverem 404 (PGRST202). Não quebraria a tela — o
-- supabase-js devolve `{error}` em vez de levantar, e a chamada é `await`ada
-- sem checagem — mas encheria o log de erro por um comportamento que é, na
-- verdade, o desejado. No-op é mais honesto que ausência aqui.
--
-- A assinatura fica idêntica de propósito: nenhum chamador precisa mudar para
-- a migration ser segura sozinha.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_pipeline_display_config(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Deliberadamente vazia. Ver cabeçalho da migration
  -- 20270831000000_funil_sistema_deixa_de_nascer_sozinho.sql.
  --
  -- ANTES: INSERT das 4 linhas (whatsapp/confirmacao/propostas/upsell) com
  -- is_visible = true e ON CONFLICT DO NOTHING. Era a torneira que fazia toda
  -- org nova nascer com os 4 funis, e a que desfazia qualquer exclusão na
  -- leitura seguinte.
  --
  -- Criar funil de sistema agora é ato EXPLÍCITO: `enable_system_pipeline`.
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.ensure_pipeline_display_config(uuid) IS
  'NO-OP desde 20270831000000. Era a auto-semeadura dos 4 funis de sistema; funil de sistema agora nasce só por enable_system_pipeline. Mantida (não dropada) para não gerar PGRST202 em bundle antigo durante a janela de deploy.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. `create_default_pipelines` passa a CONSULTAR o registro.
--
-- Ela continua existindo e continua sendo chamada por `usePipelineId` quando a
-- linha em `pipelines` não é achada — isso é legítimo: repara o caso em que a
-- linha de registro existe mas o espelho em `pipelines` sumiu.
--
-- O que muda: ela não inventa mais os 3 funis. Cria só o que a org DECLARA ter
-- em `pipeline_display_config`. Org sem registro → não cria nada, e
-- `usePipelineId` devolve null (que o front já sabe tratar).
--
-- ⚠️ `upsell` fica de fora do INSERT como já ficava: `pipelines` nunca teve
--    linha de Carteira (medido: 315 = 105 orgs × 3 tipos, não × 4). A rota
--    /upsell não passa por `usePipelineId`. Não é omissão; é o estado atual.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_default_pipelines(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.pipelines (organization_id, name, slug, type, display_order, icon, color)
  SELECT p_org_id, d.name, d.slug, 'system', d.display_order, d.icon, d.color
    FROM (VALUES
      ('Qualificação', 'whatsapp',    0, 'zap',         '#22c55e'),
      ('Confirmação',  'confirmacao', 1, 'calendar',    '#3b82f6'),
      ('Propostas',    'propostas',   2, 'dollar-sign', '#f59e0b')
    ) AS d(name, slug, display_order, icon, color)
   WHERE EXISTS (
     SELECT 1 FROM public.pipeline_display_config c
      WHERE c.organization_id = p_org_id
        AND c.pipe_type = d.slug
   )
  ON CONFLICT (organization_id, slug) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.create_default_pipelines(uuid) IS
  'Repara o espelho em pipelines para os funis de sistema que a org DECLARA ter em pipeline_display_config. Desde 20270831000000 não inventa mais os 3 funis: org sem registro não ganha nada. É o que impede a exclusão de ser desfeita na leitura seguinte.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. `enable_system_pipeline` — o caminho de VOLTA.
--
-- Sem isto, "não vem por padrão" viraria "não dá para ter": org nova nunca
-- teria como ganhar um funil de sistema, e excluir seria irreversível até na
-- estrutura. O diálogo "Ativar funil oculto" do front hoje só sabe virar
-- `is_visible` de uma linha que já existe — passa a chamar esta RPC.
--
-- As ETAPAS não são criadas aqui de propósito. A fonte canônica delas é
-- `DEFAULT_STAGES` em `@/contracts/pipe` (TypeScript), não a função SQL
-- `create_default_pipeline_stages` — que está DEFASADA (semeia 7 etapas de
-- `propostas` onde o front semeia 8; ver a nota em usePipelineStages.ts:30,
-- confirmada pelas orgs Liris e Bolivar). Duplicar a lista aqui criaria uma
-- segunda fonte de verdade fadada a divergir. Quem semeia é o front, na
-- leitura seguinte, agora que existe linha de registro autorizando.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enable_system_pipeline(
  p_org_id    uuid,
  p_pipe_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_nome text;
  v_pos  integer;
BEGIN
  -- SECURITY DEFINER bypassa RLS: a autorização é reimplementada aqui.
  -- `current_setting('role')` é a convenção do repo para a chave de serviço.
  -- Numa conexão direta (Management API) ela vale 'none', não 'service_role' —
  -- então SQL administrativo não passa por aqui de graça.
  IF NOT (p_org_id IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre esta organização' USING ERRCODE = '42501';
  END IF;

  SELECT d.nome, d.pos INTO v_nome, v_pos
    FROM (VALUES
      ('whatsapp',    'Oportunidades', 1),
      ('confirmacao', 'Agendamentos',  2),
      ('propostas',   'Orçamentos',    3),
      ('upsell',      'Carteira',      4)
    ) AS d(tipo, nome, pos)
   WHERE d.tipo = p_pipe_type;

  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'tipo de funil de sistema desconhecido: %', p_pipe_type
      USING ERRCODE = 'P0002';
  END IF;

  -- Idempotente: reativar algo que já existe só religa a visibilidade, sem
  -- reescrever o nome que a org tenha personalizado.
  INSERT INTO public.pipeline_display_config
    (organization_id, pipe_type, display_name, is_visible, position)
  VALUES
    (p_org_id, p_pipe_type, v_nome, true, v_pos)
  ON CONFLICT (organization_id, pipe_type)
  DO UPDATE SET is_visible = true, updated_at = now();

  -- Agora que o registro autoriza, o espelho pode nascer.
  PERFORM public.create_default_pipelines(p_org_id);

  RETURN jsonb_build_object(
    'pipe_type',    p_pipe_type,
    'display_name', v_nome,
    'pipeline_id',  (SELECT id FROM public.pipelines
                      WHERE organization_id = p_org_id
                        AND slug = p_pipe_type
                        AND type = 'system') -- metric-lint-allow: não é métrica — é a devolução do id da linha de REGISTRO que esta própria função acabou de garantir. O predicado `type='system'` aqui não cega funil custom: ele DESAMBIGUA, porque `pipelines` é a união dos dois modelos e um funil custom pode ter o mesmo slug (`whatsapp`) numa org. Sem ele a função devolveria o id do funil errado. Parametrizar por pipeline_id é impossível: é exatamente o id que esta linha existe para descobrir.
  );
END;
$$;

COMMENT ON FUNCTION public.enable_system_pipeline(uuid, text) IS
  'Cria (ou reativa) um funil de sistema numa org. Ato EXPLÍCITO — substitui a auto-semeadura de ensure_pipeline_display_config. Não cria etapas: a fonte canônica é DEFAULT_STAGES no front, que semeia na leitura seguinte.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Grants — nunca anon.
--
-- ⚠️ `create_default_pipeline_stages` carrega EXECUTE para `anon` desde o
--    baseline (herdado, ver 20270805000010 §4). Não é criada por este diff e
--    não é tocada aqui — mas a função NOVA não repete o erro.
-- ────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.enable_system_pipeline(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enable_system_pipeline(uuid, text) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Verificação — falha alto no próprio apply.
-- ────────────────────────────────────────────────────────────────────────────
DO $do$
DECLARE
  v_corpo  text;
  v_antes  bigint;
  v_depois bigint;
  v_org    uuid;
BEGIN
  -- (a) A torneira 1 está mesmo fechada?
  SELECT pg_get_functiondef(p.oid) INTO v_corpo
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ensure_pipeline_display_config';
  IF v_corpo ~* 'insert into' THEN
    RAISE EXCEPTION 'FALHA: ensure_pipeline_display_config ainda insere.';
  END IF;

  -- (b) A torneira 2 consulta o registro?
  SELECT pg_get_functiondef(p.oid) INTO v_corpo
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_default_pipelines';
  IF v_corpo !~* 'pipeline_display_config' THEN
    RAISE EXCEPTION 'FALHA: create_default_pipelines não consulta o registro.';
  END IF;

  -- (c) A prova que importa: numa org SEM registro, chamar as duas torneiras
  --     não pode produzir linha nenhuma. Org fantasma, desfeita no fim.
  v_org := gen_random_uuid();
  SELECT count(*) INTO v_antes FROM public.pipelines WHERE organization_id = v_org;
  PERFORM public.ensure_pipeline_display_config(v_org);
  PERFORM public.create_default_pipelines(v_org);
  SELECT count(*) INTO v_depois FROM public.pipelines WHERE organization_id = v_org;
  IF v_depois <> v_antes OR v_depois <> 0 THEN
    RAISE EXCEPTION 'FALHA: org sem registro ganhou % linha(s) em pipelines.', v_depois;
  END IF;
  IF EXISTS (SELECT 1 FROM public.pipeline_display_config WHERE organization_id = v_org) THEN
    RAISE EXCEPTION 'FALHA: org sem registro ganhou linha em pipeline_display_config.';
  END IF;

  -- (d) anon não pode executar a função nova.
  IF has_function_privilege('anon', 'public.enable_system_pipeline(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHA: anon ficou com EXECUTE em enable_system_pipeline.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: torneiras fechadas, org sem registro nasce sem funil de sistema, anon sem EXECUTE.';
END
$do$;

COMMIT;
