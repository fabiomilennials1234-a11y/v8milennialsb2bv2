// PostgreSQL isolado (PGlite). Não conecta ao Supabase nem usa dados de clientes.
// node scripts/test-negocio-ganho-etapa-won.mjs
//
// Migration 20271021000039 — negócio ganho vai para a etapa de ganho do funil.
// Espelha os cenários de supabase/tests/negocio_ganho_vai_para_etapa_won_test.sql
// (pgTAP, que exige psql/pg_prove) sobre a CADEIA REAL de gatilhos de prod:
// os corpos abaixo foram lidos de prod em 2026-09-30 (pg_get_functiondef) e as
// definições de trigger são as de pg_get_triggerdef. Ficaram de fora só os
// gatilhos que saem da cadeia deals → pipeline_entries → pipeline_stage_events →
// sale_events (webhook, workflow, dispatch, checklist, agenda, relação do lead).
//
// Mutation check no fim: a migration SEM `stage_key` no SET tem de reprovar —
// `AFTER UPDATE OF stage_key` dispara pela lista do SET, e só com `stage_id` a
// movimentação não deixaria evento de etapa.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const MIGRATION = '20271021000039_negocio_ganho_vai_para_etapa_won.sql';
const load = (path) => readFile(new URL(`../supabase/migrations/${path}`, import.meta.url), 'utf8');

const O1 = 'deadbeef-0000-4000-8000-00000000f001';
const O2 = 'deadbeef-0000-4000-8000-00000000f002';
const u = (suffix) => `deadbeef-0000-4000-8000-00000000${suffix}`;

// ── Schema mínimo: só as colunas que a cadeia lê ou escreve ──────────────────
const SCHEMA = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
  CREATE TYPE public.stage_role AS ENUM ('open','meeting_booked','meeting_held','won','lost');

  CREATE TABLE public.organizations (id uuid PRIMARY KEY, name text, slug text, timezone text,
    carteira_emits_revenue_enabled boolean DEFAULT false);
  CREATE TABLE public.rollout_exige_valor_venda (organization_id uuid PRIMARY KEY, motivo text,
    vendas_6m int, pct_sem_valor numeric, religado_em timestamptz);
  CREATE TABLE public.team_members (id uuid PRIMARY KEY, user_id uuid, organization_id uuid, name text, avatar_url text);
  CREATE TABLE public.leads (id uuid PRIMARY KEY, organization_id uuid, name text, company text, email text,
    phone text, rating int, origin text, segment text, faturamento text, urgency text, notes text,
    compromisso_date timestamptz, ai_disabled boolean, avatar_url text, erp_code text,
    pre_qualification_tier text, qualification_tier text, sdr_id uuid, closer_id uuid, responsible_id uuid,
    pre_sale_responsible_id uuid, sale_responsible_id uuid);
  CREATE TABLE public.tags (id uuid PRIMARY KEY, name text, color text);
  CREATE TABLE public.lead_tags (lead_id uuid, tag_id uuid);
  CREATE TABLE public.scheduled_user_messages (lead_id uuid, organization_id uuid, status text);
  CREATE TABLE public.upsell_clients (organization_id uuid, lead_id uuid, is_active boolean);
  CREATE TABLE public.pipelines (id uuid PRIMARY KEY, organization_id uuid, name text, slug text, type text);
  CREATE TABLE public.pipeline_stages (id uuid PRIMARY KEY, organization_id uuid, pipeline_id uuid,
    pipeline_type text, stage_key text, name text, position int, stage_role public.stage_role,
    is_active boolean, requires_sale_value boolean DEFAULT false, is_final_positive boolean DEFAULT false);
  CREATE TABLE public.deals (id uuid PRIMARY KEY, organization_id uuid, source_lead_id uuid, title text,
    source text, value numeric, outcome text NOT NULL DEFAULT 'open', outcome_source text,
    outcome_at timestamptz, won boolean DEFAULT false, closed_at timestamptz, created_by uuid,
    deleted_at timestamptz);
  CREATE TABLE public.pipeline_entries (id uuid PRIMARY KEY, organization_id uuid, pipeline_id uuid,
    lead_id uuid, stage_key text, stage_id uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
    deal_id uuid, metadata jsonb, assigned_to uuid, notes text, entered_at timestamptz DEFAULT now(),
    stage_changed_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz,
    closed_at timestamptz);
  CREATE TABLE public.pipeline_stage_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid, lead_id uuid, pipeline_id uuid, entry_id uuid, from_stage_key text,
    to_stage_key text, occurred_at timestamptz, actor uuid, source text, from_pipeline_id uuid,
    from_pipeline_name text, to_pipeline_name text, from_stage_name text, to_stage_name text, actor_name text);
  CREATE TABLE public.sale_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
    lead_id uuid, pipeline_id uuid, stage_key text, stage_event_id uuid, event_type text,
    reversed_event_id uuid, sold_at timestamptz, sale_value numeric, currency text, revenue_stream text,
    sale_responsible_id uuid, pre_sale_responsible_id uuid, actor uuid, source text, deal_id uuid,
    producer text, created_at timestamptz DEFAULT now());
`;

// ── Corpos de prod (2026-09-30), verbatim ────────────────────────────────────
const PROD_FUNCTIONS = String.raw`
CREATE OR REPLACE FUNCTION public.metric_stage_role(p_organization_id uuid, p_pipeline_id uuid, p_stage_key text)
 RETURNS stage_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p.type = 'custom' THEN (
      SELECT cps.stage_role FROM public.pipeline_stages cps
      WHERE cps.pipeline_id = p.id AND cps.organization_id = p.organization_id AND cps.stage_key = p_stage_key
    )
    ELSE (
      SELECT ps.stage_role FROM public.pipeline_stages ps
      WHERE ps.organization_id = p.organization_id AND ps.pipeline_type = p.slug AND ps.stage_key = p_stage_key
    )
  END
  FROM public.pipelines p
  WHERE p.id = p_pipeline_id AND p.organization_id = p_organization_id AND p_stage_key IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION public._registrar_desfecho_no_caderno(p_org uuid, p_lead uuid, p_pipeline uuid, p_stage_key text, p_stage_event_id uuid, p_deal_id uuid, p_de text, p_para text, p_actor uuid, p_source text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_meta jsonb; v_sale_value numeric; v_currency text;
  v_sale_resp uuid; v_pre_resp uuid; v_stream text;
  v_original public.sale_events%ROWTYPE; v_enabled boolean;
BEGIN
  IF p_de IS NOT DISTINCT FROM p_para THEN
    RETURN;
  END IF;
  IF p_de = 'won' THEN
    SELECT s.* INTO v_original FROM public.sale_events s
     WHERE s.lead_id = p_lead
       AND s.pipeline_id IS NOT DISTINCT FROM p_pipeline
       AND s.event_type = 'sale'
       AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                        WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = s.id)
     ORDER BY s.sold_at DESC, s.created_at DESC
     LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.sale_events
        (organization_id, lead_id, pipeline_id, stage_key, stage_event_id, event_type,
         reversed_event_id, sold_at, sale_value, currency, revenue_stream,
         sale_responsible_id, pre_sale_responsible_id, actor, source, deal_id, producer)
      VALUES
        (p_org, p_lead, p_pipeline, p_stage_key, p_stage_event_id, 'sale_reversed',
         v_original.id, now(), v_original.sale_value, v_original.currency, v_original.revenue_stream,
         v_original.sale_responsible_id, v_original.pre_sale_responsible_id, p_actor, p_source, p_deal_id,
         CASE WHEN p_pipeline IS NULL THEN 'deal' ELSE 'funnel' END);
    END IF;
  END IF;
  IF p_para NOT IN ('won', 'lost') THEN
    RETURN;
  END IF;
  SELECT pe.metadata INTO v_meta
    FROM public.pipeline_entries pe
   WHERE (p_deal_id IS NOT NULL AND pe.deal_id = p_deal_id)
      OR (p_deal_id IS NULL AND pe.lead_id = p_lead AND pe.pipeline_id IS NOT DISTINCT FROM p_pipeline)
   ORDER BY pe.closed_at NULLS FIRST, pe.entered_at DESC
   LIMIT 1;
  BEGIN
    v_sale_value := NULLIF(v_meta->>'sale_value', '')::numeric;
  EXCEPTION WHEN OTHERS THEN v_sale_value := NULL;
  END;
  IF p_deal_id IS NOT NULL THEN
    SELECT COALESCE(d.value, v_sale_value) INTO v_sale_value
      FROM public.deals d WHERE d.id = p_deal_id;
  END IF;
  v_currency := COALESCE(NULLIF(upper(v_meta->>'currency'), ''), 'BRL');
  IF v_currency !~ '^[A-Z]{3}$' THEN v_currency := 'BRL'; END IF;
  SELECT COALESCE(l.sale_responsible_id, l.closer_id), l.pre_sale_responsible_id
    INTO v_sale_resp, v_pre_resp
    FROM public.leads l WHERE l.id = p_lead AND l.organization_id = p_org;
  SELECT o.carteira_emits_revenue_enabled INTO v_enabled
    FROM public.organizations o WHERE o.id = p_org;
  -- metric_revenue_stream fica de fora: as orgs da fixture têm a flag desligada.
  v_stream := CASE WHEN EXISTS (
      SELECT 1 FROM public.upsell_clients uc
       WHERE uc.organization_id = p_org AND uc.lead_id = p_lead AND uc.is_active
    ) THEN 'carteira' ELSE 'novo_negocio' END;
  INSERT INTO public.sale_events
    (organization_id, lead_id, pipeline_id, stage_key, stage_event_id, event_type,
     reversed_event_id, sold_at, sale_value, currency, revenue_stream,
     sale_responsible_id, pre_sale_responsible_id, actor, source, deal_id, producer)
  VALUES
    (p_org, p_lead, p_pipeline, p_stage_key, p_stage_event_id,
     CASE WHEN p_para = 'won' THEN 'sale' ELSE 'sale_lost' END,
     NULL, now(), v_sale_value, v_currency, v_stream,
     v_sale_resp, v_pre_resp, p_actor, p_source, p_deal_id,
     CASE WHEN p_pipeline IS NULL THEN 'deal' ELSE 'funnel' END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_exige_valor_no_negocio()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_recuperado numeric;
BEGIN
  IF NEW.outcome IS DISTINCT FROM 'won' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.outcome IS NOT DISTINCT FROM NEW.outcome THEN
    RETURN NEW;
  END IF;
  IF NEW.value IS NULL THEN
    BEGIN
      SELECT NULLIF(btrim(pe.metadata->>'sale_value'), '')::numeric
        INTO v_recuperado
        FROM public.pipeline_entries pe
       WHERE pe.deal_id = NEW.id
         AND NULLIF(btrim(COALESCE(pe.metadata->>'sale_value', '')), '') IS NOT NULL
       ORDER BY pe.closed_at DESC NULLS LAST, pe.entered_at DESC
       LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_recuperado := NULL;
    END;
    IF v_recuperado IS NOT NULL THEN
      NEW.value := v_recuperado;
    END IF;
  END IF;
  IF NEW.value IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rollout_exige_valor_venda r
     WHERE r.organization_id = NEW.organization_id
       AND r.religado_em IS NULL
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    'Informe o valor antes de marcar o negócio como ganho.'
    USING ERRCODE = 'check_violation';
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_deals_espelha_outcome()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.outcome IS DISTINCT FROM OLD.outcome THEN
    NEW.won := (NEW.outcome = 'won');
    IF NEW.outcome = 'open' THEN
      NEW.closed_at := NULL;
      NEW.outcome_at := NULL;
    ELSE
      NEW.closed_at := COALESCE(NEW.closed_at, now());
      NEW.outcome_at := COALESCE(NEW.outcome_at, now());
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_deal_outcome_para_caderno()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_pipeline uuid; v_stage_key text;
BEGIN
  IF NEW.outcome IS NOT DISTINCT FROM OLD.outcome THEN
    RETURN NEW;
  END IF;
  SELECT pe.pipeline_id, pe.stage_key INTO v_pipeline, v_stage_key
    FROM public.pipeline_entries pe
   WHERE pe.deal_id = NEW.id
   ORDER BY pe.closed_at NULLS FIRST, pe.entered_at DESC
   LIMIT 1;
  PERFORM public._registrar_desfecho_no_caderno(
    NEW.organization_id, NEW.source_lead_id, v_pipeline, v_stage_key,
    NULL, NEW.id, OLD.outcome, NEW.outcome, NEW.created_by,
    COALESCE(NEW.outcome_source, 'api'));
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pipeline_entries_stage_mirror()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_stage public.pipeline_stages%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage_id IS NOT NULL THEN
      SELECT * INTO v_stage FROM public.pipeline_stages WHERE id = NEW.stage_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'pipeline_entries: stage_id % não existe em pipeline_stages', NEW.stage_id;
      END IF;
      IF v_stage.pipeline_id IS DISTINCT FROM NEW.pipeline_id THEN
        RAISE EXCEPTION 'pipeline_entries: etapa % pertence ao funil %, não ao funil % do card',
          NEW.stage_id, v_stage.pipeline_id, NEW.pipeline_id;
      END IF;
      NEW.stage_key := v_stage.stage_key;
    ELSE
      SELECT ps.id INTO NEW.stage_id
      FROM public.pipeline_stages ps
      WHERE ps.pipeline_id = NEW.pipeline_id
        AND ps.stage_key   = NEW.stage_key;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id AND NEW.stage_id IS NOT NULL THEN
    SELECT * INTO v_stage FROM public.pipeline_stages WHERE id = NEW.stage_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'pipeline_entries: stage_id % não existe em pipeline_stages', NEW.stage_id;
    END IF;
    IF v_stage.pipeline_id IS DISTINCT FROM NEW.pipeline_id THEN
      RAISE EXCEPTION 'pipeline_entries: etapa % pertence ao funil %, não ao funil % do card',
        NEW.stage_id, v_stage.pipeline_id, NEW.pipeline_id;
    END IF;
    NEW.stage_key := v_stage.stage_key;
  ELSIF NEW.stage_key    IS DISTINCT FROM OLD.stage_key
     OR NEW.pipeline_id  IS DISTINCT FROM OLD.pipeline_id
     OR (NEW.stage_id IS NULL AND OLD.stage_id IS NULL) THEN
    SELECT ps.id INTO NEW.stage_id
    FROM public.pipeline_stages ps
    WHERE ps.pipeline_id = NEW.pipeline_id
      AND ps.stage_key   = NEW.stage_key;
    IF NOT FOUND THEN
      NEW.stage_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_exige_valor_na_venda()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  v_exige boolean;
  v_valor text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.organization_id, NEW.pipeline_id, NEW.stage_id, NEW.stage_key) IS NOT DISTINCT FROM (OLD.organization_id, OLD.pipeline_id, OLD.stage_id, OLD.stage_key) THEN
    RETURN NEW;
  END IF;
  SELECT s.requires_sale_value INTO v_exige
    FROM public.pipeline_stages s
   WHERE s.organization_id = NEW.organization_id
     AND s.pipeline_id = NEW.pipeline_id
     AND ((NEW.stage_id IS NOT NULL AND s.id = NEW.stage_id)
       OR (NEW.stage_id IS NULL AND s.stage_key = NEW.stage_key))
     AND s.stage_role = 'won'
     AND s.is_active;
  IF NOT COALESCE(v_exige, false) THEN
    RETURN NEW;
  END IF;
  v_valor := NULLIF(btrim(COALESCE(NEW.metadata->>'sale_value', '')), '');
  IF v_valor IS NULL THEN
    RAISE EXCEPTION
      'Informe o valor da venda antes de mover para "%".', NEW.stage_key
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_valor !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
    RAISE EXCEPTION
      'O valor da venda ("%") não é um número.', v_valor
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_closed_at_on_final_stage()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.stage_key IN ('vendido', 'perdido') AND NEW.closed_at IS NULL THEN
    NEW.closed_at := NOW();
  END IF;
  IF NEW.stage_key NOT IN ('vendido', 'perdido')
     AND OLD IS NOT NULL
     AND OLD.stage_key IN ('vendido', 'perdido') THEN
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_capture_pipeline_stage_event()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_from_pipe uuid;
  v_from_key text;
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.pipeline_id IS NOT DISTINCT FROM NEW.pipeline_id
       AND OLD.stage_key IS NOT DISTINCT FROM NEW.stage_key THEN RETURN NEW; END IF;
    v_from_pipe := OLD.pipeline_id;
    v_from_key := OLD.stage_key;
  END IF;
  INSERT INTO public.pipeline_stage_events
    (organization_id, lead_id, pipeline_id, entry_id, from_stage_key, to_stage_key,
     occurred_at, actor, source, from_pipeline_id, from_pipeline_name, to_pipeline_name,
     from_stage_name, to_stage_name, actor_name)
  VALUES
    (NEW.organization_id, NEW.lead_id, NEW.pipeline_id, NEW.id, v_from_key, NEW.stage_key,
     clock_timestamp(), v_actor, 'trigger',
     v_from_pipe,
     (SELECT name FROM public.pipelines WHERE id = v_from_pipe AND organization_id = NEW.organization_id),
     (SELECT name FROM public.pipelines WHERE id = NEW.pipeline_id AND organization_id = NEW.organization_id),
     (SELECT name FROM public.pipeline_stages WHERE pipeline_id = v_from_pipe AND stage_key = v_from_key AND organization_id = NEW.organization_id LIMIT 1),
     (SELECT name FROM public.pipeline_stages WHERE pipeline_id = NEW.pipeline_id AND stage_key = NEW.stage_key AND organization_id = NEW.organization_id LIMIT 1),
     (SELECT name FROM public.team_members WHERE user_id = v_actor AND organization_id = NEW.organization_id LIMIT 1));
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_capture_sale_event()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_from_role public.stage_role; v_to_role public.stage_role;
  v_deal_id uuid; v_outcome_atual text; v_novo text;
BEGIN
  v_from_role := public.metric_stage_role(NEW.organization_id, COALESCE(NEW.from_pipeline_id, NEW.pipeline_id), NEW.from_stage_key);
  v_to_role   := public.metric_stage_role(NEW.organization_id, NEW.pipeline_id, NEW.to_stage_key);
  IF NEW.from_pipeline_id IS NOT NULL AND NEW.from_pipeline_id <> NEW.pipeline_id
     AND v_from_role = 'won' AND v_to_role IS DISTINCT FROM 'won'
     AND v_to_role IS DISTINCT FROM 'lost' THEN
    RETURN NEW;
  END IF;
  IF v_from_role IS DISTINCT FROM 'won'
     AND v_to_role IS DISTINCT FROM 'won'
     AND v_to_role IS DISTINCT FROM 'lost' THEN
    RETURN NEW;
  END IF;
  v_novo := CASE
    WHEN v_to_role = 'won'  THEN 'won'
    WHEN v_to_role = 'lost' THEN 'lost'
    ELSE 'open'
  END;
  SELECT pe.deal_id INTO v_deal_id
    FROM public.pipeline_entries pe WHERE pe.id = NEW.entry_id;
  IF v_deal_id IS NOT NULL THEN
    SELECT d.outcome INTO v_outcome_atual FROM public.deals d WHERE d.id = v_deal_id;
    IF v_outcome_atual IS DISTINCT FROM v_novo THEN
      UPDATE public.deals
         SET outcome = v_novo, outcome_source = 'stage', outcome_at = now()
       WHERE id = v_deal_id;
    END IF;
    RETURN NEW;
  END IF;
  PERFORM public._registrar_desfecho_no_caderno(
    NEW.organization_id, NEW.lead_id, NEW.pipeline_id, NEW.to_stage_key,
    NEW.id, NULL,
    CASE WHEN v_from_role = 'won' THEN 'won'
         WHEN v_from_role = 'lost' THEN 'lost' ELSE 'open' END,
    v_novo, NEW.actor, 'trigger');
  RETURN NEW;
END;
$function$;
`;

// ── Gatilhos de prod (pg_get_triggerdef, 2026-09-30) ─────────────────────────
const PROD_TRIGGERS = `
  CREATE TRIGGER a_trg_exige_valor_no_negocio BEFORE INSERT OR UPDATE OF outcome ON public.deals FOR EACH ROW EXECUTE FUNCTION fn_exige_valor_no_negocio();
  CREATE TRIGGER trg_deal_outcome_para_caderno AFTER UPDATE OF outcome ON public.deals FOR EACH ROW EXECUTE FUNCTION fn_deal_outcome_para_caderno();
  CREATE TRIGGER trg_deals_espelha_outcome BEFORE UPDATE OF outcome ON public.deals FOR EACH ROW EXECUTE FUNCTION fn_deals_espelha_outcome();
  CREATE TRIGGER trg_enforce_closed_at BEFORE INSERT OR UPDATE OF stage_key ON public.pipeline_entries FOR EACH ROW EXECUTE FUNCTION enforce_closed_at_on_final_stage();
  CREATE TRIGGER trg_pe_stage_mirror BEFORE INSERT OR UPDATE ON public.pipeline_entries FOR EACH ROW EXECUTE FUNCTION pipeline_entries_stage_mirror();
  CREATE TRIGGER trg_pipeline_entries_stage_event_insert AFTER INSERT ON public.pipeline_entries FOR EACH ROW WHEN ((new.lead_id IS NOT NULL)) EXECUTE FUNCTION fn_capture_pipeline_stage_event();
  CREATE TRIGGER trg_pipeline_entries_stage_event_update AFTER UPDATE OF stage_key, pipeline_id ON public.pipeline_entries FOR EACH ROW WHEN ((((old.stage_key IS DISTINCT FROM new.stage_key) OR (old.pipeline_id IS DISTINCT FROM new.pipeline_id)) AND (new.lead_id IS NOT NULL))) EXECUTE FUNCTION fn_capture_pipeline_stage_event();
  CREATE TRIGGER trg_zz_exige_valor_na_venda BEFORE INSERT OR UPDATE ON public.pipeline_entries FOR EACH ROW EXECUTE FUNCTION fn_exige_valor_na_venda();
  CREATE TRIGGER trg_pipeline_stage_events_sale_capture AFTER INSERT ON public.pipeline_stage_events FOR EACH ROW WHEN ((new.source = 'trigger'::text)) EXECUTE FUNCTION fn_capture_sale_event();
`;

// ── Fixtures: as mesmas do pgTAP ─────────────────────────────────────────────
const FIXTURES = `
  SET session_replication_role = replica;
  INSERT INTO organizations (id, name, slug, timezone) VALUES
    ('${O1}', 'Org Ganho', 'org-ganho', 'America/Sao_Paulo'),
    ('${O2}', 'Org Ganho Poupada', 'org-ganho-poupada', 'America/Sao_Paulo');
  INSERT INTO rollout_exige_valor_venda (organization_id, motivo, vendas_6m, pct_sem_valor) VALUES ('${O2}', 'fixture', 0, 0);
  INSERT INTO leads (id, organization_id, name) VALUES ('${u('f0a1')}', '${O1}', 'Lead Ganho'), ('${u('f0a2')}', '${O2}', 'Lead Poupado');
  INSERT INTO pipelines (id, organization_id, name, slug, type) VALUES
    ('${u('f0b1')}', '${O1}', 'Com ganho', 'com-ganho', 'custom'),
    ('${u('f0b2')}', '${O1}', 'Sem ganho', 'sem-ganho', 'custom'),
    ('${u('f0b3')}', '${O1}', 'Exige valor', 'exige-valor', 'custom'),
    ('${u('f0b4')}', '${O2}', 'Poupada', 'poupada', 'custom'),
    ('${u('f0b5')}', '${O1}', 'Sucesso', 'sucesso', 'custom'),
    ('${u('f0b6')}', '${O1}', 'Sucesso reunião', 'sucesso-reuniao', 'custom');
  INSERT INTO pipeline_stages (id, organization_id, pipeline_id, pipeline_type, stage_key, name, position, stage_role, is_active, requires_sale_value, is_final_positive) VALUES
    ('${u('f1b5')}', '${O1}', '${u('f0b1')}', 'custom', 'sucesso_p1', 'Sucesso P1', 4, 'open', true, false, true),
    ('${u('f5b1')}', '${O1}', '${u('f0b5')}', 'custom', 'proposta', 'Proposta', 0, 'open', true, false, false),
    ('${u('f5b2')}', '${O1}', '${u('f0b5')}', 'custom', 'qualificado', 'Qualificado', 1, 'open', true, false, true),
    ('${u('f5b3')}', '${O1}', '${u('f0b5')}', 'custom', 'fechado', 'Fechado', 2, 'open', true, false, true),
    ('${u('f6b1')}', '${O1}', '${u('f0b6')}', 'custom', 'proposta', 'Proposta', 0, 'open', true, false, false),
    ('${u('f6b2')}', '${O1}', '${u('f0b6')}', 'custom', 'orcamento', 'Orçamento ✓', 1, 'meeting_booked', true, false, true),
    ('${u('f1b1')}', '${O1}', '${u('f0b1')}', 'custom', 'proposta', 'Proposta', 0, 'open', true, false, false),
    ('${u('f1b2')}', '${O1}', '${u('f0b1')}', 'custom', 'ganho_antigo', 'Ganho antigo', 1, 'won', false, false, false),
    ('${u('f1b3')}', '${O1}', '${u('f0b1')}', 'custom', 'ganhou', 'Ganhou', 2, 'won', true, false, false),
    ('${u('f1b4')}', '${O1}', '${u('f0b1')}', 'custom', 'perdeu', 'Perdeu', 3, 'lost', true, false, false),
    ('${u('f2b1')}', '${O1}', '${u('f0b2')}', 'custom', 'proposta', 'Proposta', 0, 'open', true, false, false),
    ('${u('f3b1')}', '${O1}', '${u('f0b3')}', 'custom', 'proposta', 'Proposta', 0, 'open', true, false, false),
    ('${u('f3b2')}', '${O1}', '${u('f0b3')}', 'custom', 'vendido', 'Vendido', 1, 'won', true, true, false),
    ('${u('f4b1')}', '${O2}', '${u('f0b4')}', 'custom', 'proposta', 'Proposta', 0, 'open', true, false, false),
    ('${u('f4b2')}', '${O2}', '${u('f0b4')}', 'custom', 'vendido', 'Vendido', 1, 'won', true, true, false);
  INSERT INTO deals (id, organization_id, source_lead_id, title, source, value) VALUES
    ('${u('fd01')}', '${O1}', '${u('f0a1')}', 'Move', 'human', 1000),
    ('${u('fd02')}', '${O1}', '${u('f0a1')}', 'Sem etapa', 'human', 1000),
    ('${u('fd03')}', '${O1}', '${u('f0a1')}', 'Já lá', 'human', 1000),
    ('${u('fd04')}', '${O1}', '${u('f0a1')}', 'Exige', 'human', 1500),
    ('${u('fd05')}', '${O2}', '${u('f0a2')}', 'Poupado', 'human', NULL),
    ('${u('fd06')}', '${O1}', '${u('f0a1')}', 'Sucesso', 'human', 1000),
    ('${u('fd07')}', '${O1}', '${u('f0a1')}', 'Reunião', 'human', 1000),
    ('${u('fd08')}', '${O1}', '${u('f0a1')}', 'Sucesso já', 'human', 1000);
  INSERT INTO pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key, stage_id, deal_id) VALUES
    ('${u('fe01')}', '${O1}', '${u('f0b1')}', '${u('f0a1')}', 'proposta', '${u('f1b1')}', '${u('fd01')}'),
    ('${u('fe02')}', '${O1}', '${u('f0b2')}', '${u('f0a1')}', 'proposta', '${u('f2b1')}', '${u('fd02')}'),
    ('${u('fe03')}', '${O1}', '${u('f0b1')}', '${u('f0a1')}', 'ganhou', '${u('f1b3')}', '${u('fd03')}'),
    ('${u('fe04')}', '${O1}', '${u('f0b3')}', '${u('f0a1')}', 'proposta', '${u('f3b1')}', '${u('fd04')}'),
    ('${u('fe05')}', '${O2}', '${u('f0b4')}', '${u('f0a2')}', 'proposta', '${u('f4b1')}', '${u('fd05')}'),
    ('${u('fe06')}', '${O1}', '${u('f0b5')}', '${u('f0a1')}', 'proposta', '${u('f5b1')}', '${u('fd06')}'),
    ('${u('fe07')}', '${O1}', '${u('f0b6')}', '${u('f0a1')}', 'proposta', '${u('f6b1')}', '${u('fd07')}'),
    ('${u('fe08')}', '${O1}', '${u('f0b5')}', '${u('f0a1')}', 'qualificado', '${u('f5b2')}', '${u('fd08')}');
  SET session_replication_role = origin;
`;

async function banco(migrationSql) {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(PROD_FUNCTIONS);
  await db.exec(PROD_TRIGGERS);
  await db.exec(migrationSql);
  await db.exec(FIXTURES);
  return db;
}

const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const ganhar = (db, deal) => db.query(`UPDATE deals SET outcome = 'won', outcome_source = 'ui' WHERE id = $1`, [u(deal)]);
const etapa = async (db, entry) => (await one(db, 'SELECT stage_key, stage_id FROM pipeline_entries WHERE id = $1', [u(entry)]));
const eventos = async (db, entry) => (await one(db, 'SELECT count(*)::int n FROM pipeline_stage_events WHERE entry_id = $1', [u(entry)])).n;

let checks = 0;
let quieto = false; // o run mutante não conta nem imprime: só interessa se reprova
async function check(name, test) {
  await test();
  if (quieto) return;
  checks++;
  console.log(`PASS ${name}`);
}

/** Todos os cenários do pgTAP; devolve na primeira asserção que falhar. */
async function cenarios(db) {
  await check('(STRUCT) trigger existe em deals e a função não é porta de anon/authenticated', async () => {
    const t = await one(db, `SELECT count(*)::int n FROM pg_trigger WHERE tgrelid = 'public.deals'::regclass AND tgname = 'trg_negocio_ganho_vai_para_etapa_won'`);
    assert.equal(t.n, 1);
    const p = await one(db, `SELECT has_function_privilege('authenticated', 'public.fn_negocio_ganho_vai_para_etapa_won()', 'EXECUTE') a,
                                    has_function_privilege('anon', 'public.fn_negocio_ganho_vai_para_etapa_won()', 'EXECUTE') b`);
    assert.deepEqual([p.a, p.b], [false, false]);
  });

  await ganhar(db, 'fd01');
  await check('(MOVE)(INATIVA)(PRIORIDADE) vai para a won ativa — pula a inativa, prefere won a sucesso', async () => {
    assert.deepEqual(await etapa(db, 'fe01'), { stage_key: 'ganhou', stage_id: u('f1b3') });
  });
  await check('(MOVE) a movimentação fica no histórico de etapas', async () => {
    const e = await one(db, `SELECT count(*)::int n FROM pipeline_stage_events WHERE entry_id = $1 AND from_stage_key = 'proposta' AND to_stage_key = 'ganhou'`, [u('fe01')]);
    assert.equal(e.n, 1);
  });
  await check('(CADERNO) exatamente UMA venda e o desfecho segue ganho', async () => {
    const s = await one(db, `SELECT count(*)::int n FROM sale_events WHERE deal_id = $1 AND event_type = 'sale'`, [u('fd01')]);
    assert.equal(s.n, 1);
    const r = await one(db, `SELECT count(*)::int n FROM sale_events WHERE lead_id = $1 AND event_type = 'sale_reversed'`, [u('f0a1')]);
    assert.equal(r.n, 0);
    assert.equal((await one(db, 'SELECT outcome FROM deals WHERE id = $1', [u('fd01')])).outcome, 'won');
  });

  await ganhar(db, 'fd02');
  await check('(SEM-ETAPA) o card fica e o ganho vale', async () => {
    assert.equal((await etapa(db, 'fe02')).stage_key, 'proposta');
    assert.equal((await one(db, 'SELECT outcome FROM deals WHERE id = $1', [u('fd02')])).outcome, 'won');
    assert.equal(await eventos(db, 'fe02'), 0);
  });

  await ganhar(db, 'fd03');
  await check('(JÁ-LÁ) card já em etapa won não gera evento de etapa', async () => {
    assert.equal(await eventos(db, 'fe03'), 0);
  });

  await ganhar(db, 'fd04');
  await check('(VALOR) vai para a etapa que exige valor levando deals.value, e fecha o card', async () => {
    const e = await one(db, `SELECT stage_key, (metadata->>'sale_value')::numeric v, closed_at FROM pipeline_entries WHERE id = $1`, [u('fe04')]);
    assert.equal(e.stage_key, 'vendido');
    assert.equal(Number(e.v), 1500);
    // `trg_enforce_closed_at` é OF stage_key: só dispara porque stage_key está no SET.
    assert.ok(e.closed_at, 'closed_at deveria ter sido preenchido');
  });

  await ganhar(db, 'fd05');
  await check('(PODADO) org poupada ganha sem valor — só a posição volta', async () => {
    assert.equal((await one(db, 'SELECT outcome FROM deals WHERE id = $1', [u('fd05')])).outcome, 'won');
    assert.equal((await etapa(db, 'fe05')).stage_key, 'proposta');
    assert.equal(await eventos(db, 'fe05'), 0);
  });

  await ganhar(db, 'fd06');
  await check('(SUCESSO) sem won, vai para a etapa de sucesso mais adiantada, sem segunda venda', async () => {
    assert.equal((await etapa(db, 'fe06')).stage_key, 'fechado');
    assert.equal(await eventos(db, 'fe06'), 1);
    const s = await one(db, `SELECT count(*)::int n FROM sale_events WHERE deal_id = $1 AND event_type = 'sale'`, [u('fd06')]);
    assert.equal(s.n, 1);
  });

  await ganhar(db, 'fd07');
  await check('(REUNIÃO) sucesso com papel de reunião não recebe o card', async () => {
    assert.equal((await etapa(db, 'fe07')).stage_key, 'proposta');
    assert.equal(await eventos(db, 'fe07'), 0);
  });

  await ganhar(db, 'fd08');
  await check('(SUCESSO-JÁ) card já numa etapa de sucesso fica nela', async () => {
    assert.equal((await etapa(db, 'fe08')).stage_key, 'qualificado');
    assert.equal(await eventos(db, 'fe08'), 0);
  });

  await check('(REABRIR) reabrir não move de volta e ganhar de novo não duplica evento de etapa', async () => {
    await db.query(`UPDATE deals SET outcome = 'open', outcome_source = 'ui' WHERE id = $1`, [u('fd01')]);
    assert.equal((await etapa(db, 'fe01')).stage_key, 'ganhou');
    await ganhar(db, 'fd01');
    assert.equal(await eventos(db, 'fe01'), 1);
  });

  await check('(KANBAN) get_pipeline_page projeta deal_outcome — dentro e fora da etapa won', async () => {
    const page = (stage, pipeline, entry) => one(db,
      `SELECT metadata->>'deal_outcome' o FROM public.get_pipeline_page(p_stage_id => $1, p_org_id => $2, p_pipeline_id => $3) WHERE id = $4`,
      [stage, O1, u(pipeline), u(entry)]);
    assert.equal((await page('ganhou', 'f0b1', 'fe01')).o, 'won');
    assert.equal((await page('proposta', 'f0b2', 'fe02')).o, 'won');
  });

  await check('(ISOLAMENTO) get_pipeline_page de outra org não devolve o card', async () => {
    const r = await db.query(`SELECT 1 FROM public.get_pipeline_page(p_stage_id => 'proposta', p_org_id => $1, p_pipeline_id => $2)`, [O2, u('f0b2')]);
    assert.equal(r.rows.length, 0);
  });
}

const migration = await load(MIGRATION);
const rollback = await load(`rollback/${MIGRATION}`);

try {
  const db = await banco(migration);
  await cenarios(db);

  await check('(REAPLICAR) reaplicar a migration é no-op', async () => {
    await db.exec(migration);
  });
  await check('(ROLLBACK) desliga o trigger e tira deal_outcome do kanban', async () => {
    await db.exec(rollback);
    const t = await one(db, `SELECT count(*)::int n FROM pg_trigger WHERE tgrelid = 'public.deals'::regclass AND tgname = 'trg_negocio_ganho_vai_para_etapa_won'`);
    assert.equal(t.n, 0);
    const def = await one(db, `SELECT pg_get_functiondef('public.get_pipeline_page'::regproc) d`);
    assert.ok(!def.d.includes('deal_outcome'));
    await db.query(`UPDATE deals SET outcome = 'open' WHERE id = $1`, [u('fd06')]);
    await db.query(`UPDATE pipeline_entries SET stage_key = 'proposta' WHERE id = $1`, [u('fe06')]);
    await ganhar(db, 'fd06');
    assert.equal((await etapa(db, 'fe06')).stage_key, 'proposta');
  });
  await db.close();

  // ── Mutation check: sem stage_key no SET, a suíte TEM de reprovar ──────────
  const mutante = migration.replace(/^\s*stage_key = v_chave_ganho,\n/m, '');
  assert.notEqual(mutante, migration, 'mutation check não encontrou a linha a remover');
  const dbMutante = await banco(mutante);
  let reprovou = null;
  quieto = true;
  try {
    await cenarios(dbMutante);
  } catch (error) {
    reprovou = error;
  } finally {
    quieto = false;
  }
  await dbMutante.close();
  await check('(MUTAÇÃO) sem stage_key no SET a movimentação não deixa evento — a suíte pega', async () => {
    assert.ok(reprovou, 'a suíte passou com a migration mutante');
    console.log(`       reprovou em: ${reprovou.message.split('\n')[0]}`);
  });

  console.log(`\n${checks} verificações passaram.`);
} catch (error) {
  console.error(`FAIL depois de ${checks} verificações:`, error);
  process.exitCode = 1;
}
