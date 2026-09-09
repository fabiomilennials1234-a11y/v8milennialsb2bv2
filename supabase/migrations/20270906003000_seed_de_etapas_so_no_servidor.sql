-- 20270906003000_seed_de_etapas_so_no_servidor.sql
--
-- SCRUM-618 · Funil é funil (Wave 2, F1) — o seed de etapas passa a ser 100%
-- server-side. `ensureDefaultStagesInDb` (front) morre no mesmo branch; a
-- partir daqui a ÚNICA torneira de etapas default é
-- `create_default_pipeline_stages`, chamada por `enable_system_pipeline`.
-- Rollback pareado em
-- supabase/migrations/rollback/20270906003000_seed_de_etapas_so_no_servidor.sql.
--
-- Depende da 20270906001000 (SCRUM-616): `pipeline_stages.pipeline_id` existe,
-- o CHECK dos 5 tipos caiu e a UNIQUE legada (organization_id, pipeline_type,
-- stage_key) segue de pé como arbiter do ON CONFLICT.
--
-- ── MEDIDO EM PROD (2026-09-01, jsjsmuncfkbsbzqzqhfq) ───────────────────────
--
--   · O gatilho de criação de org NÃO existe: `trigger_create_default_stages`
--     é função órfã — `pg_trigger` não tem entrada para ela (já documentado no
--     cabeçalho da 20270902000000). Quem semeava etapa era SÓ o front,
--     preguiçosamente, na primeira leitura da sessão.
--   · `enable_system_pipeline` (o ato explícito que cria funil de sistema
--     desde 20270902000000) cria o registro + a linha em `pipelines`, mas
--     NUNCA criou etapa. O funil recém-ativado dependia do front pra nascer
--     com colunas.
--   · Zero (org, funil) registrado em `pipeline_display_config` sem etapa
--     ativa — nenhuma org depende HOJE do caminho do front que este branch
--     remove. O backfill do fim é guarda de deriva, esperado no-op.
--   · A função SQL estava DEFASADA da semeadura real (front): `propostas` com
--     7 etapas (sem `proposta_enviada`) e títulos sem os sufixos ✓/✗/📅 que
--     toda org semeada pelo front tem. Esta migration alinha a função ao
--     `DEFAULT_STAGES` do front — a receita que de fato populou as orgs —
--     antes de torná-la a única torneira (divergência registrada no §5 do
--     rodapé da 20270805000010).
--
-- ── ORDEM DE DEPLOY ─────────────────────────────────────────────────────────
--
--   Migration ANTES do deploy do front. Bundle antigo + migration aplicada é
--   compatível (o upsert do front colide no arbiter e vira no-op). Front novo
--   + migration ausente deixaria funil recém-ativado nascer sem etapas.
--
-- ── O QUE ESTA MIGRATION NÃO FAZ (D9 / SCRUM-618) ───────────────────────────
--
--   Não toca nas 1.144 etapas de carteira aposentadas (is_active=false,
--   pipeline_id NULL — D-b da 20270906001000) nem em `/upsell`,
--   `upsell_clients` ou `upsell_orders`. A faxina final delas é a W6.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

-- ════════════════════════════════════════════════════════════════════════════
-- 1. `create_default_pipeline_stages` — registro como portão + pipeline_id
-- ════════════════════════════════════════════════════════════════════════════
-- Mudanças sobre a versão anterior (preservada no rollback pareado):
--   a) Portão do registro: só semeia os tipos que a org DECLARA em
--      `pipeline_display_config` (mesma regra que a 20270902000000 deu a
--      `create_default_pipelines`). A versão anterior semeava os 3
--      incondicionalmente — inerte enquanto ninguém a chamava; ressuscitaria
--      funil excluído agora que ela volta a ser chamada.
--   b) Preenche `pipeline_id` resolvendo (org, slug, type='system') — a FK
--      real pós-SCRUM-616. `pipeline_type` continua preenchido como espelho
--      de compat (morre na F6). Sem linha em `pipelines`, fica NULL (mesmo
--      contrato dos inserts legados; o resolver D-g da 20270906001000 também
--      cobre por trigger).
--   c) Conteúdo alinhado ao DEFAULT_STAGES do front (a receita que semeou as
--      orgs reais): propostas ganha `proposta_enviada` (8 etapas) e os títulos
--      passam a ser os que toda org já tem.
-- Idempotência: ON CONFLICT no arbiter legado (organization_id, pipeline_type,
-- stage_key) DO NOTHING — nunca reativa etapa desativada, nunca reescreve nome
-- que a org personalizou. `stage_role` fica com o default 'open'; o trigger
-- `pipeline_stages_assign_system_stage_role` (#990) aplica o papel de sistema
-- no INSERT, como sempre fez com o seed do front.
--
-- ⚠️ Posição sob a UNIQUE (pipeline_id, position) da 20270906001000: a posição
-- canônica só vale quando o funil está VAZIO (primeiro seed). Num funil que já
-- tem linhas, uma chave default ausente entra em APPEND depois da última etapa
-- ativa (a mesma convenção D-d dos editores: inserem em len(ativas), abaixo do
-- headroom 1000+ das inativas) — inserir na posição canônica colidiria com a
-- etapa que a org já tem lá e derrubaria o enable inteiro.
--
-- ACL herdada preservada de propósito (CREATE OR REPLACE não toca grants);
-- o EXECUTE de anon/PUBLIC herdado é dívida de card próprio (rodapé §4 da
-- 20270805000010) — inerte: SECURITY INVOKER e anon sem INSERT.

CREATE OR REPLACE FUNCTION public.create_default_pipeline_stages(org_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  INSERT INTO pipeline_stages
    (organization_id, pipeline_id, pipeline_type, stage_key, name, color,
     position, is_active, is_final_positive, is_final_negative,
     target_pipe_type, target_stage_key)
  SELECT org_id,
         (SELECT p.id FROM pipelines p
           WHERE p.organization_id = org_id
             AND p.slug = d.pipe
             AND p.type = 'system'),  -- metric-lint-allow: resolução de FK do seed, não métrica (SCRUM-618)
         d.pipe, d.stage_key, d.nome, d.cor,
         CASE
           WHEN NOT EXISTS (SELECT 1 FROM pipeline_stages ps0
                             WHERE ps0.organization_id = org_id
                               AND ps0.pipeline_type = d.pipe)
             THEN d.pos  -- funil vazio: ordem canônica
           ELSE  -- funil povoado: append depois da última ativa (convenção D-d)
             (SELECT COALESCE(MAX(ps1.position), -1)
                FROM pipeline_stages ps1
               WHERE ps1.organization_id = org_id
                 AND ps1.pipeline_type = d.pipe
                 AND ps1.position < 1000)
             + (row_number() OVER (PARTITION BY d.pipe ORDER BY d.pos))::int
         END,
         true, d.final_pos, d.final_neg, d.target_pipe, d.target_key
    FROM (VALUES
      -- whatsapp (Qualificação)
      ('whatsapp', 'novo',      'Novo',       '#6366f1', 0, false, false, NULL, NULL),
      ('whatsapp', 'abordado',  'Abordado',   '#f59e0b', 1, false, false, NULL, NULL),
      ('whatsapp', 'respondeu', 'Respondeu',  '#3b82f6', 2, false, false, NULL, NULL),
      ('whatsapp', 'esfriou',   'Esfriou',    '#ef4444', 3, false, false, NULL, NULL),
      ('whatsapp', 'agendado',  'Agendado ✓', '#22c55e', 4, true,  false, 'confirmacao', 'reuniao_marcada'),
      -- confirmacao (Confirmação)
      ('confirmacao', 'reuniao_marcada',    'Reunião Marcada',    '#6366f1', 0, false, false, NULL, NULL),
      ('confirmacao', 'confirmar_d5',       'Confirmar D-5',      '#8b5cf6', 1, false, false, NULL, NULL),
      ('confirmacao', 'confirmar_d3',       'Confirmar D-3',      '#a855f7', 2, false, false, NULL, NULL),
      ('confirmacao', 'confirmar_d2',       'Confirmar D-2',      '#f59e0b', 3, false, false, NULL, NULL),
      ('confirmacao', 'confirmar_d1',       'Confirmar D-1',      '#f97316', 4, false, false, NULL, NULL),
      ('confirmacao', 'confirmacao_no_dia', 'Confirmação no Dia', '#ef4444', 5, false, false, NULL, NULL),
      ('confirmacao', 'remarcar',           'Remarcar 📅',        '#f97316', 6, false, false, NULL, NULL),
      ('confirmacao', 'compareceu',         'Compareceu ✓',       '#22c55e', 7, true,  false, 'propostas', 'marcar_compromisso'),
      ('confirmacao', 'perdido',            'Perdido ✗',          '#ef4444', 8, false, true,  NULL, NULL),
      -- propostas (8 etapas — inclui proposta_enviada, que a versão anterior não tinha)
      ('propostas', 'marcar_compromisso',  'Marcar Compromisso',  '#F5C518', 0, false, false, NULL, NULL),
      ('propostas', 'reativar',            'Reativar',            '#F97316', 1, false, false, NULL, NULL),
      ('propostas', 'compromisso_marcado', 'Compromisso Marcado', '#3B82F6', 2, false, false, NULL, NULL),
      ('propostas', 'proposta_enviada',    'Proposta Enviada',    '#0EA5E9', 3, false, false, NULL, NULL),
      ('propostas', 'esfriou',             'Esfriou',             '#64748B', 4, false, false, NULL, NULL),
      ('propostas', 'futuro',              'Futuro',              '#8B5CF6', 5, false, false, NULL, NULL),
      ('propostas', 'vendido',             'Vendido ✓',           '#22C55E', 6, true,  false, NULL, NULL),
      ('propostas', 'perdido',             'Perdido',             '#EF4444', 7, false, true,  NULL, NULL)
    ) AS d(pipe, stage_key, nome, cor, pos, final_pos, final_neg, target_pipe, target_key)
   WHERE EXISTS (
     SELECT 1 FROM pipeline_display_config c
      WHERE c.organization_id = org_id
        AND c.pipe_type = d.pipe
   )
  ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

  -- Carteira segue fora da semeadura desde 20270805000010 (funil aposentado,
  -- ADR-0023 §8). A prova (d) daquela migration lê este corpo — os nomes das
  -- famílias aposentadas não aparecem aqui de propósito.
END;
$function$;

COMMENT ON FUNCTION public.create_default_pipeline_stages(uuid) IS
  'Única torneira de etapas default (SCRUM-618): registry-gated (pipeline_display_config), '
  'preenche pipeline_id (FK pós-SCRUM-616) e pipeline_type (compat, morre na F6), '
  'idempotente pelo arbiter legado. Chamada por enable_system_pipeline. '
  'O seed do front (ensureDefaultStagesInDb) morreu no mesmo branch.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. `enable_system_pipeline` passa a semear as etapas do funil que ativa
-- ════════════════════════════════════════════════════════════════════════════
-- Corpo idêntico ao de prod + 1 linha: PERFORM create_default_pipeline_stages
-- depois de create_default_pipelines (o registro e a linha de `pipelines`
-- precisam existir antes — o portão e o resolve de pipeline_id dependem dos
-- dois). Para `p_pipe_type = 'upsell'` a semeadura é no-op por construção:
-- o portão do VALUES só conhece os 3 tipos com etapa.
-- SECURITY DEFINER preservado — e é ele que dá o INSERT em pipeline_stages ao
-- caller autenticado (create_default_pipeline_stages é INVOKER e roda no
-- contexto do owner quando chamada daqui).

CREATE OR REPLACE FUNCTION public.enable_system_pipeline(p_org_id uuid, p_pipe_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- SCRUM-618: e as etapas nascem AQUI, não mais no front. Idempotente e
  -- registry-gated — reativar funil existente não reescreve nada.
  PERFORM public.create_default_pipeline_stages(p_org_id);

  RETURN jsonb_build_object(
    'pipe_type',    p_pipe_type,
    'display_name', v_nome,
    'pipeline_id',  (SELECT id FROM public.pipelines
                      WHERE organization_id = p_org_id
                        AND slug = p_pipe_type
                        AND type = 'system') -- metric-lint-allow: não é métrica — é a devolução do id da linha de REGISTRO que esta própria função acabou de garantir. O predicado `type='system'` aqui não cega funil custom: ele DESAMBIGUA, porque `pipelines` é a união dos dois modelos e um funil custom pode ter o mesmo slug (`whatsapp`) numa org. Sem ele a função devolveria o id do funil errado. Parametrizar por pipeline_id é impossível: é exatamente o id que esta linha existe para descobrir.
  );
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Backfill de deriva: org registrada sem NENHUMA linha de etapa do funil
-- ════════════════════════════════════════════════════════════════════════════
-- Medido 2026-09-01: ZERO casos — nenhuma org depende do seed do front. Este
-- laço existe para a janela entre a medição e o apply (alguém ativa funil e
-- não abre a tela). Predicado por "zero LINHAS" (não "zero ativas") de
-- propósito: org que desativou todas as etapas de um funil mantém as linhas e
-- NÃO é tocada — desativação é escolha, e o ON CONFLICT ainda protegeria.

DO $$
DECLARE
  r record;
  v_orgs int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT c.organization_id
      FROM public.pipeline_display_config c
     WHERE c.pipe_type IN ('whatsapp','confirmacao','propostas')
       AND NOT EXISTS (
         SELECT 1 FROM public.pipeline_stages ps
          WHERE ps.organization_id = c.organization_id
            AND ps.pipeline_type = c.pipe_type
       )
  LOOP
    PERFORM public.create_default_pipeline_stages(r.organization_id);
    v_orgs := v_orgs + 1;
  END LOOP;

  RAISE NOTICE 'SCRUM618: backfill de deriva semeou % org(s) (medição de 2026-09-01 previa 0)', v_orgs;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Asserções — qualquer falha aborta a transação inteira
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_body   text;
  v_gap    bigint;
BEGIN
  -- 4.1 A torneira nova é registry-gated e resolve pipeline_id.
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_default_pipeline_stages';
  IF v_body NOT LIKE '%pipeline_display_config%' OR v_body NOT LIKE '%pipeline_id%' THEN
    RAISE EXCEPTION 'SCRUM618: create_default_pipeline_stages sem portão de registro ou sem pipeline_id';
  END IF;
  IF v_body NOT LIKE '%proposta_enviada%' THEN
    RAISE EXCEPTION 'SCRUM618: create_default_pipeline_stages não foi alinhada ao DEFAULT_STAGES';
  END IF;

  -- 4.2 A ativação de funil semeia etapas (o único caminho de nascimento).
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'enable_system_pipeline';
  IF v_body NOT LIKE '%create_default_pipeline_stages%' THEN
    RAISE EXCEPTION 'SCRUM618: enable_system_pipeline não semeia etapas';
  END IF;

  -- 4.3 Nenhum (org, funil) registrado ficou sem linha de etapa.
  SELECT count(*) INTO v_gap
    FROM public.pipeline_display_config c
   WHERE c.pipe_type IN ('whatsapp','confirmacao','propostas')
     AND NOT EXISTS (
       SELECT 1 FROM public.pipeline_stages ps
        WHERE ps.organization_id = c.organization_id
          AND ps.pipeline_type = c.pipe_type
     );
  IF v_gap <> 0 THEN
    RAISE EXCEPTION 'SCRUM618: % funis registrados seguem sem etapa após o backfill', v_gap;
  END IF;

  RAISE NOTICE 'SCRUM618 OK: seed de etapas é 100%% server-side.';
END $$;
