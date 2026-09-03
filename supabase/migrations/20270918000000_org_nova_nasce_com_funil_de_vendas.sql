-- 20270918000000_org_nova_nasce_com_funil_de_vendas.sql — SCRUM-641 (W6 · Funil é Funil)
--
-- Org NOVA nasce com UM funil de fábrica: "Funil de Vendas" (slug 'vendas'),
-- já apontado como `organizations.default_pipeline_id`. Etapas com PAPEL:
--
--   Novo → Em conversa → Reunião marcada (meeting_booked) → Proposta enviada
--   → Ganhou (won, is_final_positive, requires_sale_value) → Perdeu (lost,
--   is_final_negative)
--
-- ── MEDIDO EM PROD (2026-09-03, jsjsmuncfkbsbzqzqhfq) ───────────────────────
--
--   · Desde a 20270902000000 org nova nasce com ZERO funis (as 4 torneiras de
--     auto-semeadura fecharam). Caminhos reais de criação de org:
--       1. `useMasterCreateOrganization` (front master) — INSERT direto em
--          `organizations`; funil só se o master escolher template (clone).
--       2. `billing_provision_new_org` (checkout self-serve) — INSERT direto;
--          NENHUM funil semeado (medido no corpo da função).
--       3. `create_org_sandbox` — INSERT + cópia de etapas (função já quebrada
--          em prod: insere coluna `display_order` que `pipeline_stages` não
--          tem; fora do escopo deste diff).
--     → o único choke comum é o INSERT em `organizations`. O seed vai de
--       trigger AFTER INSERT, no molde do `trg_seed_loss_reasons` que já mora
--       nessa tabela.
--   · 2/108 orgs existentes têm zero funis (criadas pós-20270902). DECISÃO DO
--     CTO: orgs existentes têm ZERO mudança observável — nenhum backfill aqui.
--     O trigger só dispara para org criada daqui pra frente.
--   · 0 linhas em `pipelines` com slug 'vendas' — o slug nasce livre.
--   · Convenção de funil comum (a que a UI inteira já entende): linha em
--     `pipelines` com `type='custom'`, etapas com `pipeline_id` (FK) e
--     `pipeline_type` NULL (556 etapas custom em prod, 100% assim). A view
--     `custom_pipelines` (nav, kanban, editor, rename, delete) é
--     `WHERE type='custom'` — semear como 'system' deixaria o funil INVISÍVEL
--     na navegação atual, que só mostra 'system' via `pipeline_display_config`
--     (registro exclusivo do trio). ADR-0034: `type` é marca de origem do
--     seed, sem efeito de comportamento — 'custom' aqui significa "funil
--     comum", que é exatamente o que a decisão pede (renomeável, deletável,
--     editável desde o dia 1).
--   · `custom_pipelines.position` = `display_order - 3` → display_order 3 dá
--     position 0 (primeiro da lista).
--   · Padrão da casa para etapa de ganho: `requires_sale_value = true`
--     (20270903000020 ligou em todas as won; 91/126 seguem true — os false
--     são o rollout-off por org da 20270909000010). Org nova nasce no padrão.
--   · Trigger `trg_pipeline_stages_won_lost_guard` (dinheiro): `postgres` no
--     Supabase NÃO é superuser e o guard barra (provado no 1º ensaio). O seed
--     entra como backend via `SET "role" = 'service_role'` na função (ver §1).
--   · Trigger `pipeline_stages_assign_system_stage_role` só reescreve quando
--     stage_role='open' — os papéis explícitos abaixo passam intactos.
--
-- ── O QUE ESTA MIGRATION NÃO FAZ ────────────────────────────────────────────
--
--   · Não toca org existente (nem as 2 sem funil — mudança observável vetada).
--   · Não mexe em `create_default_pipelines`/`create_default_pipeline_stages`/
--     `enable_system_pipeline`: elas seguem registry-gated e são o caminho de
--     REATIVAÇÃO das orgs antigas que declaram o trio em
--     `pipeline_display_config`. Org nova nunca tem registro → essas funções
--     são no-op para ela por construção (provado na 20270902000000 §5c).
--
-- Rollback pareado: supabase/migrations/rollback/20270918000000_org_nova_nasce_com_funil_de_vendas.sql

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Guard de dinheiro reconhece o OPERADOR DIRETO (session_user postgres)
-- ════════════════════════════════════════════════════════════════════════════
-- `trg_pipeline_stages_won_lost_guard` (ADR-0017 §1) barra escrita de
-- stage_role won/lost por quem não é backend/master/admin da org. Provado nos
-- ensaios deste card:
--   · `postgres` no Supabase NÃO é superuser → a liberação por rolsuper não
--     pega para migration/Management API;
--   · `SET "role" = 'service_role'` é proibido sob QUALQUER frame
--     SECURITY DEFINER (erro 42501 "cannot set parameter role", medido) —
--     impossível impersonar backend dentro do trigger de seed.
-- Sem isto, o INSERT de org por SQL direto (e o próprio bloco de verificação
-- desta migration) morre no guard. A liberação nova é `session_user IN
-- ('postgres','supabase_admin')` — o MESMO gate de operador que
-- `billing_provision_new_org` já usa. Não é afrouxamento de superfície de
-- app: conexão PostgREST tem session_user = 'authenticator', então
-- anon/authenticated/service_role continuam caindo nas checagens existentes.
-- Quem tem session postgres já pode reescrever o próprio guard.
-- CREATE OR REPLACE (não DROP) de propósito: preserva a ACL existente.

CREATE OR REPLACE FUNCTION public.fn_pipeline_stages_guard_money_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.stage_role IS DISTINCT FROM 'won' AND NEW.stage_role IS DISTINCT FROM 'lost' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.stage_role IS NOT DISTINCT FROM NEW.stage_role THEN
    RETURN NEW;
  END IF;
  IF coalesce(auth.role(), '') = 'service_role'
     OR current_user = 'service_role'
     OR session_user IN ('postgres', 'supabase_admin')  -- SCRUM-641: operador direto (migration/console); PostgREST nunca chega aqui com esse session_user
     OR coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     OR public.is_master_user()
     OR NEW.organization_id IN (SELECT public.get_my_admin_organization_ids()) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'access_denied: stage_role % é dinheiro (ADR-0017 §1) — só admin da org ou master pode definir/alterar won/lost', NEW.stage_role USING ERRCODE = 'P0001';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. A receita: seed_default_sales_funnel(org)
-- ════════════════════════════════════════════════════════════════════════════
-- Função separada do trigger de propósito: é a receita nomeada do funil de
-- fábrica (um chamador futuro — ex.: reparo explícito — chama ela, não o
-- trigger). Idempotente: ON CONFLICT no slug e nas etapas; default só é
-- escrito se ainda não houver.

CREATE OR REPLACE FUNCTION public.seed_default_sales_funnel(p_org_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pipeline_id uuid;
BEGIN
  -- Autorização por GRANT, não por gate no corpo: EXECUTE só para
  -- service_role (abaixo). O trigger não depende do grant — dentro de
  -- fn_seed_default_funnel_for_org (DEFINER, owner postgres) o current_user
  -- é o owner, então QUALQUER caminho legítimo de INSERT em organizations
  -- (master no front, billing_provision_new_org, create_org_sandbox por
  -- admin) semeia sem tropeçar em permissão. Um gate por is_master_user()
  -- aqui quebraria o sandbox criado por admin comum.
  --
  -- O guard de dinheiro (won/lost) deixa o seed passar por uma das vias já
  -- existentes conforme o caminho: service_role (billing/edge), master
  -- (front), admin da org, ou — via §0 desta migration — session_user
  -- postgres (migration/console). Impersonar service_role aqui é impossível:
  -- `SET "role"` é proibido sob frame SECURITY DEFINER (medido, erro 42501).
  INSERT INTO public.pipelines
    (organization_id, name, slug, type, description, icon, color, display_order, is_active, config)
  VALUES
    (p_org_id, 'Funil de Vendas', 'vendas', 'custom',
     'Funil padrão da organização — renomeie e adapte as etapas ao seu processo.',
     'trending-up', '#f59e0b', 3, true, '{}'::jsonb)
  ON CONFLICT (organization_id, slug) DO NOTHING;

  SELECT id INTO v_pipeline_id
    FROM public.pipelines
   WHERE organization_id = p_org_id AND slug = 'vendas';

  IF v_pipeline_id IS NULL THEN
    -- Impossível no caminho do trigger; guarda contra chamada manual esquisita.
    RAISE EXCEPTION 'seed_default_sales_funnel: funil vendas não resolveu para org %', p_org_id;
  END IF;

  -- `pipeline_type` NULL = convenção de funil comum (medido: 556/556 etapas
  -- custom em prod). Papéis explícitos: o trigger de system_stage_role só age
  -- sobre 'open', e aqui o que importa (meeting_booked/won/lost) vai declarado.
  INSERT INTO public.pipeline_stages
    (organization_id, pipeline_id, pipeline_type, stage_key, name, color,
     position, is_active, stage_role, is_final_positive, is_final_negative,
     requires_sale_value)
  SELECT p_org_id, v_pipeline_id, NULL, d.stage_key, d.nome, d.cor, d.pos,
         true, d.papel::public.stage_role, d.final_pos, d.final_neg, d.exige_valor
    FROM (VALUES
      ('novo',             'Novo',             '#6366f1', 0, 'open',           false, false, false),
      ('em_conversa',      'Em conversa',      '#3b82f6', 1, 'open',           false, false, false),
      ('reuniao_marcada',  'Reunião marcada',  '#8b5cf6', 2, 'meeting_booked', false, false, false),
      ('proposta_enviada', 'Proposta enviada', '#0ea5e9', 3, 'open',           false, false, false),
      ('ganhou',           'Ganhou',           '#22c55e', 4, 'won',            true,  false, true),
      ('perdeu',           'Perdeu',           '#ef4444', 5, 'lost',           false, true,  false)
    ) AS d(stage_key, nome, cor, pos, papel, final_pos, final_neg, exige_valor)
  ON CONFLICT (pipeline_id, stage_key) DO NOTHING;

  -- Já nasce como funil padrão (D4: fallback único das portas). Nunca
  -- sobrescreve um padrão que já exista.
  UPDATE public.organizations
     SET default_pipeline_id = v_pipeline_id
   WHERE id = p_org_id
     AND default_pipeline_id IS NULL;

  RETURN v_pipeline_id;
END;
$$;

COMMENT ON FUNCTION public.seed_default_sales_funnel(uuid) IS
  'Receita do funil de fábrica (SCRUM-641): "Funil de Vendas" (slug vendas, type custom) com papéis meeting_booked/won/lost, já como default_pipeline_id. Idempotente. Chamada pelo trigger trg_seed_default_funnel em org nova.';

-- Superfície mínima: com o SET role embutido, EXECUTE aqui é poder de
-- service_role — NUNCA para authenticated/anon. O trigger não precisa de
-- grant (roda com current_user = owner).
REVOKE ALL ON FUNCTION public.seed_default_sales_funnel(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_sales_funnel(uuid) TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. O choke: trigger AFTER INSERT em organizations
-- ════════════════════════════════════════════════════════════════════════════
-- AFTER (não BEFORE) porque `pipelines.organization_id` tem FK para
-- `organizations` — a linha da org precisa existir antes do funil.

CREATE OR REPLACE FUNCTION public.fn_seed_default_funnel_for_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.seed_default_sales_funnel(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_seed_default_funnel_for_org() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_seed_default_funnel ON public.organizations;
CREATE TRIGGER trg_seed_default_funnel
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_seed_default_funnel_for_org();

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Verificação — falha alto no próprio apply
-- ════════════════════════════════════════════════════════════════════════════

DO $do$
DECLARE
  v_org uuid;
  v_pipe uuid;
  v_stages int;
  v_meeting int;
  v_won int;
  v_lost int;
  v_default uuid;
  v_antes_orgs_com_funil bigint;
  v_depois_orgs_com_funil bigint;
BEGIN
  SELECT count(DISTINCT organization_id) INTO v_antes_orgs_com_funil FROM public.pipelines;

  -- (a) Org sintética: criada → verificada → apagada, tudo nesta transação.
  INSERT INTO public.organizations (name, slug)
  VALUES ('__ensaio_scrum641__', 'ensaio-scrum641-' || left(md5(random()::text), 8))
  RETURNING id INTO v_org;

  SELECT id INTO v_pipe FROM public.pipelines
   WHERE organization_id = v_org AND slug = 'vendas' AND type = 'custom';
  IF v_pipe IS NULL THEN
    RAISE EXCEPTION 'SCRUM641 FALHA: org nova não ganhou o Funil de Vendas.';
  END IF;

  IF (SELECT count(*) FROM public.pipelines WHERE organization_id = v_org) <> 1 THEN
    RAISE EXCEPTION 'SCRUM641 FALHA: org nova nasceu com % funis, esperado exatamente 1.',
      (SELECT count(*) FROM public.pipelines WHERE organization_id = v_org);
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE stage_role = 'meeting_booked'),
         count(*) FILTER (WHERE stage_role = 'won' AND is_final_positive AND requires_sale_value),
         count(*) FILTER (WHERE stage_role = 'lost' AND is_final_negative)
    INTO v_stages, v_meeting, v_won, v_lost
    FROM public.pipeline_stages
   WHERE pipeline_id = v_pipe AND is_active;
  IF v_stages <> 6 OR v_meeting <> 1 OR v_won <> 1 OR v_lost <> 1 THEN
    RAISE EXCEPTION 'SCRUM641 FALHA: etapas=% meeting_booked=% won=% lost=% (esperado 6/1/1/1).',
      v_stages, v_meeting, v_won, v_lost;
  END IF;

  SELECT default_pipeline_id INTO v_default FROM public.organizations WHERE id = v_org;
  IF v_default IS DISTINCT FROM v_pipe THEN
    RAISE EXCEPTION 'SCRUM641 FALHA: default_pipeline_id=% não aponta o funil semeado %.', v_default, v_pipe;
  END IF;

  -- (b) Idempotência da receita: chamar de novo não duplica nada.
  PERFORM public.seed_default_sales_funnel(v_org);
  IF (SELECT count(*) FROM public.pipelines WHERE organization_id = v_org) <> 1
     OR (SELECT count(*) FROM public.pipeline_stages WHERE pipeline_id = v_pipe) <> 6 THEN
    RAISE EXCEPTION 'SCRUM641 FALHA: receita não é idempotente.';
  END IF;

  -- (c) Desfaz a org fantasma — em ORDEM EXPLÍCITA, não por CASCADE puro.
  --     Achado no ensaio (bug LATENTE de prod, anterior a este card): DELETE
  --     de org com etapas morre em `trg_queue_followup_reclassify` — o
  --     CASCADE apaga a org primeiro e o trigger AFTER DELETE das etapas
  --     re-insere o org_id já morto em followup_reclassify_queue (23503).
  --     Ordem segura: default→NULL, etapas, fila, funil, org.
  UPDATE public.organizations SET default_pipeline_id = NULL WHERE id = v_org;
  DELETE FROM public.pipeline_stages WHERE organization_id = v_org;
  DELETE FROM public.followup_reclassify_queue WHERE organization_id = v_org;
  DELETE FROM public.pipelines WHERE organization_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;
  IF EXISTS (SELECT 1 FROM public.pipelines WHERE organization_id = v_org) THEN
    RAISE EXCEPTION 'SCRUM641 FALHA: funil da org fantasma sobreviveu ao DELETE.';
  END IF;

  -- (d) Nenhuma org EXISTENTE mudou: o conjunto de orgs com funil é o mesmo.
  SELECT count(DISTINCT organization_id) INTO v_depois_orgs_com_funil FROM public.pipelines;
  IF v_depois_orgs_com_funil <> v_antes_orgs_com_funil THEN
    RAISE EXCEPTION 'SCRUM641 FALHA: orgs com funil mudou de % para % — org existente foi tocada.',
      v_antes_orgs_com_funil, v_depois_orgs_com_funil;
  END IF;

  -- (e) anon/authenticated nunca executam a receita (ela embute service_role).
  IF has_function_privilege('anon', 'public.seed_default_sales_funnel(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.seed_default_sales_funnel(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SCRUM641 FALHA: anon/authenticated ficou com EXECUTE em seed_default_sales_funnel.';
  END IF;

  RAISE NOTICE 'SCRUM641 OK: org nova nasce com o Funil de Vendas (6 etapas, papéis completos) como padrão.';
END $do$;
