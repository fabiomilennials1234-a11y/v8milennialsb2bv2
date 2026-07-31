-- ============================================================================
-- Fixture de QA para o M4 — branch efêmera SOMENTE.
--
-- Por que existe: a branch nasce com `with_data: false`. Rodar o M4 contra 2
-- cards prova que o SQL compila e nada mais — nenhuma guarda é EXERCITADA. Este
-- arquivo constrói, um por um, os casos que cada guarda existe para pegar, mais
-- uma org vizinha que precisa sair intacta.
--
-- Roda por `node scripts/seed-branch.mjs --db-url <branch> --file supabase/qa-seed/m4-fixture.sql`
-- (recusa prod pelo ref). Idempotente: `ON CONFLICT DO NOTHING` em tudo.
--
-- MAPA CASO → GUARDA
--   drift pipe_whatsapp (card 'abordado' × lead 'novo') ....... 1b + 3e
--   card ganho (stage_role='won' em funil system) ............. deals.won = true
--   card ganho em funil CUSTOM ............................... deals.won via cs.stage_role
--   stage_key órfão (etapa que não existe) ................... won = false, nunca NULL
--   dois cards do mesmo lead no mesmo funil (recompra) ....... prova de 1:1 com N>1
--   par custom com stage_changed_at divergente ............... 3f (muda 1, e só 1)
--   org vizinha com cards .................................... escopo do --org
--
-- `deal_manual_only` fica ON na org alvo de propósito: sem isso o gatilho
-- DEFERRABLE `trg_auto_assign_lead_default_pipe` cria cards de whatsapp no
-- COMMIT e a fixture deixa de ser determinística. Efeito colateral útil: exercita
-- o gate do M2.
-- ============================================================================

-- ── Claims de service_role, escopadas à transação ──────────────────────────
-- `stage_role IN ('won','lost')` é guardado por `fn_pipeline_stages_guard_money_role`
-- ("stage_role won é dinheiro, ADR-0017 §1"). O caminho de escape por superusuário
-- NÃO serve aqui: no Supabase o papel `postgres` tem `rolsuper = false` (medido —
-- a primeira execução desta fixture morreu exatamente nessa linha). Sobra
-- `auth.role() = 'service_role'`, que lê `request.jwt.claims`.
-- `set_config(..., true)` é local à transação: acaba junto com o seed.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ── Org alvo (já existe do teste do M1) ─────────────────────────────────────
UPDATE public.organizations
   SET feature_flags = coalesce(feature_flags, '{}'::jsonb) || '{"deal_manual_only": true}'::jsonb
 WHERE id = '11111111-1111-1111-1111-111111111111';

-- ── Funil de sistema whatsapp + etapas ──────────────────────────────────────
INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES ('44444444-4444-4444-4444-444444444444',
        '11111111-1111-1111-1111-111111111111', 'WhatsApp', 'whatsapp', 'system')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_stages (id, organization_id, pipeline_type, stage_key, name, position, stage_role)
VALUES ('44440001-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','whatsapp','novo','Novo',0,'open'),
       ('44440002-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','whatsapp','abordado','Abordado',1,'open'),
       -- COLISÃO DELIBERADA: 'vendido' existe em `propostas` E em `whatsapp` na
       -- mesma org, com stage_role diferente. É a forma exata dos 266 pares
       -- (organization_id, stage_key) duplicados de prod que fabricavam 2.667
       -- negócios fantasma quando o join não discriminava funil. Sem esta linha
       -- a prova de 1:1 passa por sorte, não por estar certa.
       ('44440003-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','whatsapp','vendido','Vendido (WA)',2,'open')
ON CONFLICT (id) DO NOTHING;

-- ── Funil custom + etapas (o `pipelines` espelho nasce do gatilho
--    trg_sync_custom_pipeline, com o MESMO id) ──────────────────────────────
INSERT INTO public.custom_pipelines (id, organization_id, name, slug, position)
VALUES ('55555555-5555-5555-5555-555555555555',
        '11111111-1111-1111-1111-111111111111', 'Reativação', 'reativacao', 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.custom_pipeline_stages (id, organization_id, pipeline_id, stage_key, name, position, stage_role)
VALUES ('55550001-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','55555555-5555-5555-5555-555555555555','reativ_novo','Novo',0,'open'),
       ('55550002-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','55555555-5555-5555-5555-555555555555','reativ_ganho','Ganho',1,'won')
ON CONFLICT (id) DO NOTHING;

-- ── Leads da org alvo ───────────────────────────────────────────────────────
INSERT INTO public.leads (id, organization_id, name, phone, pipe_whatsapp)
VALUES ('22220002-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Lead Drift WA','5511900000002','novo'),
       ('22220003-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Lead Ganho','5511900000003',NULL),
       ('22220004-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','Lead Etapa Orfa','5511900000004',NULL),
       ('22220005-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111','Lead Custom Recompra','5511900000005',NULL),
       ('22220006-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111','Lead Custom Ganho','5511900000006',NULL)
ON CONFLICT (id) DO NOTHING;

-- ── Cards de funil de sistema ───────────────────────────────────────────────
-- C1: o card diz 'abordado', o lead dirá 'novo'. É o par que faz
-- trg_sync_whatsapp_stage_to_lead reescrever dado de cliente se ficar ligado.
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key)
VALUES ('c0000001-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        '44444444-4444-4444-4444-444444444444','22220002-0000-0000-0000-000000000002','abordado')
ON CONFLICT (id) DO NOTHING;

-- C2: ganho em funil de sistema (stage_role='won' → deals.won = true).
-- trg_enforce_closed_at carimba closed_at no INSERT; é o comportamento real.
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key)
VALUES ('c0000002-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
        '4df170e7-dc0d-42df-8804-e94916f99270','22220003-0000-0000-0000-000000000003','vendido')
ON CONFLICT (id) DO NOTHING;

-- C3: stage_key que não existe em etapa nenhuma. Os dois LEFT JOIN falham e
-- `(coalesce(...) = 'won') IS TRUE` tem que dar false — nunca NULL.
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key)
VALUES ('c0000003-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
        '4df170e7-dc0d-42df-8804-e94916f99270','22220004-0000-0000-0000-000000000004','etapa_fantasma')
ON CONFLICT (id) DO NOTHING;

-- ── Cards de funil custom (escrevem na FONTE; o sync cria o espelho) ────────
-- C4 e C6: MESMO lead, MESMO funil. Impossível antes do M1 — é a recompra. Serve
-- também para a prova de 1:1 encontrar N>1 por lead e continuar 1 linha por card.
INSERT INTO public.custom_pipe_entries (id, organization_id, pipeline_id, lead_id, stage_id)
VALUES ('c0000004-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111',
        '55555555-5555-5555-5555-555555555555','22220005-0000-0000-0000-000000000005','55550001-0000-0000-0000-000000000001'),
       ('c0000006-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111',
        '55555555-5555-5555-5555-555555555555','22220005-0000-0000-0000-000000000005','55550001-0000-0000-0000-000000000001'),
       ('c0000005-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111',
        '55555555-5555-5555-5555-555555555555','22220006-0000-0000-0000-000000000006','55550002-0000-0000-0000-000000000002')
ON CONFLICT (id) DO NOTHING;

-- ── Org vizinha: tem card, e o M4 da org alvo não pode encostar nele ────────
INSERT INTO public.organizations (id, name, slug)
VALUES ('33333333-3333-3333-3333-333333333333', 'QA Vizinha', 'qa-vizinha')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, slug, type)
VALUES ('66666666-6666-6666-6666-666666666666',
        '33333333-3333-3333-3333-333333333333', 'Propostas', 'propostas', 'system')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_stages (id, organization_id, pipeline_type, stage_key, name, position, stage_role)
VALUES ('66660001-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','propostas','enviada','Enviada',0,'open')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name, phone)
VALUES ('77777777-7777-7777-7777-777777777777','33333333-3333-3333-3333-333333333333','Lead Vizinho','5511900000009')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key)
VALUES ('c0000009-0000-0000-0000-000000000009','33333333-3333-3333-3333-333333333333',
        '66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777','enviada')
ON CONFLICT (id) DO NOTHING;

-- ── Divergências fabricadas — DEPOIS dos INSERTs, senão os gatilhos as desfazem ──

-- (a) drift de pipe_whatsapp: o card ficou 'abordado', o lead volta para 'novo'.
--     Nada sincroniza lead → card, então a divergência persiste.
UPDATE public.leads SET pipe_whatsapp = 'novo'
 WHERE id = '22220002-0000-0000-0000-000000000002';

-- (b) stage_changed_at divergente em UM par custom, e só um. A guarda 3f exige
--     que o backfill reconcilie exatamente este e nenhum outro.
UPDATE public.pipeline_entries SET stage_changed_at = now() - interval '30 days'
 WHERE id = 'c0000004-0000-0000-0000-000000000004';

-- ── Retrato para conferir a olho antes de rodar o M4 ────────────────────────
DO $$
DECLARE v_alvo bigint; v_viz bigint; v_drift bigint; v_scat bigint; v_0b bigint;
BEGIN
  SELECT count(*) INTO v_alvo FROM public.pipeline_entries
   WHERE organization_id='11111111-1111-1111-1111-111111111111' AND deal_id IS NULL AND lead_id IS NOT NULL;
  SELECT count(*) INTO v_viz FROM public.pipeline_entries
   WHERE organization_id='33333333-3333-3333-3333-333333333333';
  SELECT count(*) INTO v_drift FROM public.pipeline_entries pe
    JOIN public.pipelines p ON p.id=pe.pipeline_id JOIN public.leads l ON l.id=pe.lead_id
   WHERE p.type='system' AND p.slug='whatsapp' AND pe.organization_id='11111111-1111-1111-1111-111111111111'
     AND l.pipe_whatsapp IS DISTINCT FROM pe.stage_key;
  SELECT count(*) INTO v_scat FROM public.custom_pipe_entries c JOIN public.pipeline_entries pe ON pe.id=c.id
   WHERE c.organization_id='11111111-1111-1111-1111-111111111111'
     AND pe.stage_changed_at IS DISTINCT FROM c.stage_changed_at;
  SELECT count(*) INTO v_0b FROM public.custom_pipe_entries c
    JOIN public.pipeline_entries pe ON pe.id=c.id
    LEFT JOIN public.custom_pipeline_stages cs ON cs.id=c.stage_id
   WHERE c.organization_id='11111111-1111-1111-1111-111111111111'
     AND coalesce(cs.stage_key,'unknown') IS DISTINCT FROM pe.stage_key;

  RAISE NOTICE 'FIXTURE: % card(s) alvo · % na org vizinha · drift pipe_whatsapp=% · stage_changed_at divergente=% · pre-condicao 0b (tem que ser 0)=%',
    v_alvo, v_viz, v_drift, v_scat, v_0b;
END$$;
