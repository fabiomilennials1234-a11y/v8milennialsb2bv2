-- ROLLBACK de 20270730000040_auto_seed_deal_manual_only.sql
--
-- SCRUM-248. A migration acrescenta a `fn_auto_assign_lead_default_pipe()` o
-- bloco `(F)`: a leitura da flag por org `feature_flags.deal_manual_only`, que
-- faz o gatilho parar de semear `pipeline_entries(whatsapp/novo)` no INSERT de
-- lead quando a org optou por "Negócio nasce só de clique" (ADR-0023 decisão 3).
--
-- ── POR QUE ESTE ARQUIVO EXISTE ───────────────────────────────────────────
-- A linha 241 da migration dizia: "Não criei arquivo em
-- `supabase/migrations/rollback/` … se o orquestrador quiser o arquivo, é copiar
-- este corpo sem o bloco `(F)`." Receita correta, arquivo ausente — e receita que
-- exige transcrever 110 linhas de plpgsql à mão, no meio de um incidente, é
-- receita que produz erro de transcrição. O corpo abaixo é essa cópia, feita
-- agora, com calma, e revisável em diff.
--
-- ── PROCEDÊNCIA DO CORPO, QUE É O QUE DÁ CONFIANÇA NELE ───────────────────
-- A migration declara (linha 248) ser "cópia fiel de `pg_get_functiondef` (prod,
-- 2026-07-31) + o bloco (F)". Então o corpo pré-apply é, por construção, a
-- migration MENOS o bloco (F) — e (F) é exatamente duas coisas, ambas nomeadas
-- na própria migration:
--
--   • a declaração `v_manual_only boolean;`
--   • o `SELECT … INTO v_manual_only` seguido do `IF coalesce(v_manual_only,
--     false) THEN RETURN NULL; END IF;`
--
-- Nada mais foi tocado. Os comentários de prod (em português, numerados de (-1)
-- a (5)), o `metric-lint-allow` da linha do `type = 'system'`, o
-- `SECURITY DEFINER` e o `SET search_path` estão byte a byte como no original —
-- inclusive o `LIMIT 1` dentro dos `EXISTS`, que é redundante e é assim em prod.
--
-- ⚠️ NÃO reaplique `20260622180000_cal_leads_skip_whatsapp_default_pipe.sql`
-- como rollback: aquele arquivo NÃO tem o guard `app.skip_default_pipe` (o bloco
-- (-1)), e usá-lo faria o `import_lead_into_custom_pipeline` voltar a semear card
-- de WhatsApp em import de funil customizado. Seria trocar um rollback por uma
-- regressão. O aviso é da própria migration, seção DRIFT.
--
-- ── O QUE ESTE ROLLBACK **NÃO** DESFAZ ────────────────────────────────────
-- Os cards que NÃO foram criados enquanto a flag esteve ligada. A migration não
-- guarda o que não criou — não há linha para restaurar. Recuperar exige backfill
-- a partir de `leads` sem card, org a org, decidido caso a caso. A seção 2 conta
-- quantos leads estão nesse estado, para a decisão ter tamanho.
--
-- ── O QUE ELE RE-INTRODUZ ─────────────────────────────────────────────────
-- 🟠 O furo do SCRUM-195, pela outra metade. Com o bloco (F) fora, TODO lead novo
-- volta a ganhar card em `whatsapp/novo`, inclusive em org com
-- `deal_manual_only = true` — a flag continua no banco, ligada, e deixa de ter
-- efeito no gatilho. A org pediu para o Negócio não nascer sozinho e ele nasce.
--
-- Note que o gate do ingest (as 7 portas que leem a flag por
-- `_shared/deal-policy.ts`, SCRUM-195) NÃO é revertido por este arquivo — ele
-- vive nas edge functions. Depois deste rollback os dois lados discordam: as
-- edge functions respeitam a flag, o gatilho do banco não. Lead que entra pela
-- API não ganha card; lead que entra por qualquer outro INSERT ganha.

BEGIN;

-- ── 1. A função, sem o bloco (F) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_auto_assign_lead_default_pipe()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pipeline_id uuid;
  v_stage_exists boolean;
BEGIN
  -- (-1) Chamador declarou que já vai colocar o lead num funil nesta mesma
  -- transação (ver import_lead_into_custom_pipeline). O guard (2) abaixo não
  -- cobre esse caso: quando o trigger roda, a entry custom ainda não existe.
  IF coalesce(current_setting('app.skip_default_pipe', true), '') = '1' THEN
    RETURN NULL;
  END IF;

  -- (0) Cal.com: lead já entra em confirmacao (reunião agendada) — nunca semear whatsapp/novo.
  IF NEW.origin = 'cal' THEN
    RETURN NULL;
  END IF;

  -- (1) já está em pipeline_entries? skip
  IF EXISTS (
    SELECT 1 FROM public.pipeline_entries
    WHERE lead_id = NEW.id
    LIMIT 1
  ) THEN
    RETURN NULL;
  END IF;

  -- (2) já está em custom_pipe_entries? skip
  IF EXISTS (
    SELECT 1 FROM public.custom_pipe_entries
    WHERE lead_id = NEW.id
    LIMIT 1
  ) THEN
    RETURN NULL;
  END IF;

  -- (3) org tem pipeline system whatsapp ativo?
  SELECT id
    INTO v_pipeline_id
  FROM public.pipelines
  WHERE organization_id = NEW.organization_id
    AND type = 'system' -- metric-lint-allow: não é métrica; é o resolvedor do funil-padrão preservado de prod (ver cabeçalho §DIVERGÊNCIA)
    AND slug = 'whatsapp'
    AND is_active = true
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- (4) stage 'novo' existe e está ativo nesse pipeline?
  SELECT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE organization_id = NEW.organization_id
      AND pipeline_type = 'whatsapp'
      AND stage_key = 'novo'
      AND is_active = true
  ) INTO v_stage_exists;

  IF NOT v_stage_exists THEN
    RETURN NULL;
  END IF;

  -- (5) cria entry whatsapp/novo
  INSERT INTO public.pipeline_entries (
    organization_id,
    pipeline_id,
    lead_id,
    stage_key,
    entered_at,
    stage_changed_at
  ) VALUES (
    NEW.organization_id,
    v_pipeline_id,
    NEW.id,
    'novo',
    NOW(),
    NOW()
  );

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.fn_auto_assign_lead_default_pipe() IS
  'Semeia pipeline_entries(whatsapp/novo) no INSERT de lead. ⚠️ REVERTIDA pelo '
  'rollback de 20270730000040: NÃO lê mais organizations.feature_flags.deal_manual_only. '
  'Org com a flag ligada volta a ganhar card automático — o gate do ingest '
  '(_shared/deal-policy.ts, SCRUM-195) continua valendo nas edge functions, então '
  'os dois lados discordam enquanto este estado durar.';

-- O ACL não muda entre as duas versões, mas é reafirmado: CREATE OR REPLACE
-- preserva grants, e reafirmar torna o arquivo idempotente e auto-contido.
REVOKE ALL     ON FUNCTION public.fn_auto_assign_lead_default_pipe() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_auto_assign_lead_default_pipe() FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_auto_assign_lead_default_pipe() TO authenticated, service_role;

-- ── 2. Verificação + o tamanho do que não é desfeito ───────────────────────
DO $$
DECLARE v_tem_flag boolean; v_orgs bigint; v_sem_card bigint; v_anon boolean;
BEGIN
  -- A prova de que o bloco (F) saiu: o corpo instalado não menciona a flag.
  SELECT pg_get_functiondef(p.oid) LIKE '%deal_manual_only%'
    INTO v_tem_flag
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_auto_assign_lead_default_pipe';

  IF v_tem_flag IS NULL THEN
    RAISE EXCEPTION 'FAIL: fn_auto_assign_lead_default_pipe não existe depois do CREATE OR REPLACE.';
  END IF;
  IF v_tem_flag THEN
    RAISE EXCEPTION 'FAIL: o corpo instalado ainda menciona deal_manual_only — o bloco (F) não saiu.';
  END IF;

  SELECT has_function_privilege('anon', 'public.fn_auto_assign_lead_default_pipe()', 'EXECUTE') INTO v_anon;
  IF v_anon THEN
    RAISE EXCEPTION 'FAIL: anon executa fn_auto_assign_lead_default_pipe.';
  END IF;

  -- Quantas orgs ficam com a flag ligada e sem efeito no gatilho.
  SELECT count(*) INTO v_orgs
    FROM public.organizations
   WHERE COALESCE(feature_flags -> 'deal_manual_only' = 'true'::jsonb, false);

  -- Leads sem card nenhum: os que o bloco (F) impediu de semear enquanto esteve
  -- no ar. Este rollback NÃO os cria — o número existe para a decisão de
  -- backfill ter tamanho.
  SELECT count(*) INTO v_sem_card
    FROM public.leads l
   WHERE l.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.pipeline_entries pe WHERE pe.lead_id = l.id)
     AND NOT EXISTS (SELECT 1 FROM public.custom_pipe_entries ce WHERE ce.lead_id = l.id);

  RAISE NOTICE 'ROLLBACK OK: bloco (F) removido; o gatilho voltou a semear sempre.';

  IF v_orgs > 0 THEN
    RAISE WARNING
      '% organização(ões) seguem com deal_manual_only = true e a flag deixou de ter efeito no gatilho do banco. As edge functions (SCRUM-195) continuam respeitando-a: os dois lados discordam a partir de agora.',
      v_orgs;
  END IF;

  RAISE NOTICE
    '% lead(s) sem card em nenhum funil. Este rollback NÃO os semeia — o gatilho só roda no INSERT. Se precisar, é backfill próprio, org a org.',
    v_sem_card;
END$$;

COMMIT;
