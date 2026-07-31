-- ============================================================================
-- Teste de COMPORTAMENTO do M6 — branch efêmera SOMENTE.
--
-- A verificação embutida da migration `20270731000010_assert_member_same_org.sql`
-- é estrutural de propósito: provar que a trava RECUSA exige duas orgs e um
-- membro cruzado, que é dado, e migration não é lugar de dado (guarda F4).
-- O comportamento se prova aqui.
--
-- Depende da fixture `supabase/qa-seed/m4-fixture.sql` (orgs 1111… e 3333…).
-- Idempotente: o membro de teste entra com ON CONFLICT DO NOTHING e cada caso
-- desfaz o que escreveu.
--
-- CASOS
--   1. UPDATE em `leads` apontando responsável de OUTRA org  → tem que RECUSAR
--   2. INSERT em `pipeline_entries` com assigned_to de OUTRA org → tem que RECUSAR
--   3. UPDATE em `leads` com responsável da PRÓPRIA org      → tem que PASSAR
--   4. `UPDATE ... SET deal_id` (a forma do M4)              → NÃO acorda a trava
--      Este é o caso que justifica a lista de colunas no CREATE TRIGGER: com
--      `UPDATE` nu, o M4 pagaria to_jsonb por card e acordaria a trava à toa.
-- ============================================================================

-- Claims de service_role, locais à transação: escrever em `team_members` sem
-- contexto de auth esbarra em `assert_org_access` e volta um `access_denied` nu.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Membro da org VIZINHA (3333…). É ele que não pode ser responsável na org 1111…
-- `is_active = false` por necessidade e sem prejuízo: `enforce_seat_limit` só
-- checa quota quando o membro nasce ATIVO, e a org de QA tem 0 seats pagos.
-- Não enfraquece o teste — `fn_assert_member_same_org` casa por `id` e não olha
-- `is_active`, o que é o certo: membro inativo de outra org continua sendo
-- responsável errado.
INSERT INTO public.team_members (id, organization_id, name, role, is_active)
VALUES ('99999999-9999-9999-9999-999999999999',
        -- `member`, não `membro`: o enum `app_role` real é
        -- (admin, sdr, closer, agency, bdr, cliente, member). A CLAUDE.md diz
        -- "admin/master/membro" e erra em dois dos três. Medido aqui: a primeira
        -- versão deste arquivo morreu com `invalid input value for enum app_role`.
        '33333333-3333-3333-3333-333333333333', 'Vendedor da Vizinha', 'member', false)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_org_a  uuid := '11111111-1111-1111-1111-111111111111';
  v_lead_a uuid := '22220003-0000-0000-0000-000000000003';
  v_membro_b uuid := '99999999-9999-9999-9999-999999999999';
  v_membro_a uuid := '36df197c-2abe-4e7d-8ed7-d4bba6f2363b';  -- QA Vendedor, org A
  v_pipe_a uuid := '4df170e7-dc0d-42df-8804-e94916f99270';    -- propostas da org A
  v_recusou boolean;
  v_deal uuid;
BEGIN
  -- ── 1. responsável de outra org em `leads` ────────────────────────────────
  v_recusou := false;
  BEGIN
    UPDATE public.leads SET responsible_id = v_membro_b WHERE id = v_lead_a;
  EXCEPTION WHEN raise_exception THEN
    v_recusou := true;
  END;
  IF NOT v_recusou THEN
    RAISE EXCEPTION 'FAIL caso 1: a trava ACEITOU responsible_id de outra org em leads.';
  END IF;
  RAISE NOTICE 'caso 1 OK: leads.responsible_id cross-org RECUSADO.';

  -- ── 2. assigned_to de outra org em `pipeline_entries` ─────────────────────
  v_recusou := false;
  BEGIN
    INSERT INTO public.pipeline_entries (organization_id, pipeline_id, lead_id, stage_key, assigned_to)
    VALUES (v_org_a, v_pipe_a, v_lead_a, 'enviada', v_membro_b);
  EXCEPTION WHEN raise_exception THEN
    v_recusou := true;
  END;
  IF NOT v_recusou THEN
    RAISE EXCEPTION 'FAIL caso 2: a trava ACEITOU assigned_to de outra org em pipeline_entries.';
  END IF;
  RAISE NOTICE 'caso 2 OK: pipeline_entries.assigned_to cross-org RECUSADO.';

  -- ── 3. o caminho legítimo continua passando ───────────────────────────────
  UPDATE public.leads SET responsible_id = v_membro_a WHERE id = v_lead_a;
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = v_lead_a AND responsible_id = v_membro_a) THEN
    RAISE EXCEPTION 'FAIL caso 3: responsavel da PROPRIA org nao foi gravado — a trava virou bloqueio geral.';
  END IF;
  RAISE NOTICE 'caso 3 OK: responsavel da propria org ACEITO.';
  UPDATE public.leads SET responsible_id = NULL WHERE id = v_lead_a;

  -- ── 4. a forma do M4 não acorda a trava ───────────────────────────────────
  -- Prova indireta e suficiente: se o gatilho fosse `UPDATE` nu, ele rodaria
  -- to_jsonb aqui. Com a lista de colunas, `SET deal_id` não o menciona.
  SELECT id INTO v_deal FROM public.deals WHERE organization_id = v_org_a LIMIT 1;
  IF v_deal IS NULL THEN
    RAISE NOTICE 'caso 4 PULADO: nenhum deal nesta org (rode o M4 antes).';
  ELSE
    UPDATE public.pipeline_entries SET deal_id = deal_id
     WHERE organization_id = v_org_a AND deal_id IS NOT NULL;
    RAISE NOTICE 'caso 4 OK: UPDATE SET deal_id passou sem acordar a trava.';
  END IF;

  -- ── 5. `responsible_user_id` — a coluna que três documentos não viam ──────
  -- O nome sugere auth.users; a FK é team_members. 1.594 valores cross-org em
  -- prod. Se este caso passar sem recusar, a trava tem buraco do tamanho do
  -- problema que ela existe para resolver.
  v_recusou := false;
  BEGIN
    UPDATE public.leads SET responsible_user_id = v_membro_b WHERE id = v_lead_a;
  EXCEPTION WHEN raise_exception THEN
    v_recusou := true;
  END;
  IF NOT v_recusou THEN
    RAISE EXCEPTION 'FAIL caso 5: a trava ACEITOU responsible_user_id de outra org.';
  END IF;
  RAISE NOTICE 'caso 5 OK: leads.responsible_user_id cross-org RECUSADO.';

  -- ── 6. `claimed_by` — a coluna que a propria fatia 2 criou ────────────────
  v_recusou := false;
  BEGIN
    UPDATE public.leads SET claimed_by = v_membro_b WHERE id = v_lead_a;
  EXCEPTION WHEN raise_exception THEN
    v_recusou := true;
  END;
  IF NOT v_recusou THEN
    RAISE EXCEPTION 'FAIL caso 6: a trava ACEITOU claimed_by de outra org — o "Assumir" nasceria furado.';
  END IF;
  RAISE NOTICE 'caso 6 OK: leads.claimed_by cross-org RECUSADO.';

  RAISE NOTICE 'M6 VALIDATION PASSED: recusa cross-org nas 8 colunas, aceita a propria org, e ignora o UPDATE do M4.';
END$$;
