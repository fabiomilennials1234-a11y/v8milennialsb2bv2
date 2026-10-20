// F5b — custo das triggers de INSERT em public.whatsapp_messages (PGlite, sem Docker).
//
// Corpos das funções copiados de prod com pg_get_functiondef (2026-10-19), sem
// mudar lógica. Esqueleto das tabelas tocadas com os índices de prod que essas
// funções usam. Volume calibrado em prod no mesmo dia:
//   • maior org: 11.303 leads elegíveis ao passe 2 de resolve_message_lead_id;
//   • 75% das mensagens de 24 h chegam SEM lead (8.788/11.724) → passes 1–5 rodam;
//   • lead mais pesado: 15.219 linhas em lead_history; média ponderada por
//     INSERT: 171 linhas varridas pelo EXISTS de idempotência do histórico.
//
// O que este arquivo prova:
//   1. Medição: o custo do INSERT está em DOIS lookups sem índice — passe 2 de
//      resolve_message_lead_id (normalize_br_mobile por linha da org) e o EXISTS
//      de fn_whatsapp_message_to_history (filtro jsonb sobre todo o histórico do
//      lead). As demais triggers são sub-ms.
//   2. As migrations 20271201000200/…201 (índices) cortam esses dois custos e
//      deixam o estado final IDÊNTICO (lead_id, histórico, summary, webhooks).
//   3. Cada migration/rollback é um statement CONCURRENTLY, recusado em transação.
//
// LIMITE DECLARADO: PGlite é PG 18 em WASM, single-thread, sem I/O real nem
// concorrência. Os números absolutos NÃO são os de prod; vale o custo RELATIVO
// entre variantes. Fora do esqueleto (não medidas aqui): fn_aviso_de_mensagem
// (≤ 9 destinatários, lookups indexados), whatsapp_messages_set_media_file_name
// (só document), fn_human_pause_on_manual_send (só outgoing manual) e as 5 da
// Riofix (WHEN por organization_id fixo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIG = '../../supabase/migrations/';
const IDX_LEADS = '20271201000200_leads_org_br_mobile_idx.sql';
const IDX_HIST = '20271201000201_lead_history_whatsapp_message_id_idx.sql';
const ORG = '00000000-0000-0000-0000-00000000a001';
const ORG2 = '00000000-0000-0000-0000-00000000a002';
const INST = '00000000-0000-0000-0000-00000000b001';
const HEAVY = '00000000-0000-0000-0000-00000000c001';

const SCHEMA = `
CREATE SCHEMA IF NOT EXISTS private;

-- ── funções auxiliares (prod) ──────────────────────────────────────────────
CREATE FUNCTION public.normalize_br_mobile(digits text) RETURNS text
 LANGUAGE sql IMMUTABLE STRICT SET search_path TO 'public' AS $f$
  SELECT CASE
    WHEN length(digits) = 13 AND left(digits, 2) = '55' THEN digits
    WHEN length(digits) = 12 AND left(digits, 2) = '55' THEN left(digits, 4) || '9' || substr(digits, 5)
    WHEN length(digits) = 11 AND substr(digits, 3, 1) = '9' THEN '55' || digits
    WHEN length(digits) = 10 THEN '55' || left(digits, 2) || '9' || substr(digits, 3)
    ELSE digits
  END;
$f$;

CREATE FUNCTION public.normalize_brazilian_phone(phone text) RETURNS text
 LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $f$
DECLARE cleaned TEXT;
BEGIN
  IF phone IS NULL OR phone = '' THEN RETURN NULL; END IF;
  cleaned := regexp_replace(phone, '\\D', '', 'g');
  IF cleaned = '' THEN RETURN NULL; END IF;
  IF length(cleaned) >= 12 AND left(cleaned, 2) = '55' THEN cleaned := substring(cleaned from 3); END IF;
  IF length(cleaned) = 10 THEN cleaned := left(cleaned, 2) || '9' || substring(cleaned from 3); END IF;
  RETURN cleaned;
END;
$f$;

-- ── tabelas tocadas (colunas usadas + índices de prod relevantes) ───────────
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text,
  phone_digits text NOT NULL DEFAULT '',
  normalized_phone text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_leads_organization_id ON public.leads (organization_id);
CREATE INDEX idx_leads_org_phone_digits ON public.leads (organization_id, phone_digits) WHERE (phone_digits <> ''::text);
CREATE INDEX idx_leads_org_normalized_phone ON public.leads (organization_id, normalized_phone) WHERE (normalized_phone IS NOT NULL);

CREATE TABLE public.lead_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL, organization_id uuid NOT NULL,
  phone_digits text NOT NULL, normalized_phone text,
  deleted_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_phones_org_digits_idx ON public.lead_phones (organization_id, phone_digits) WHERE (deleted_at IS NULL);
CREATE INDEX lead_phones_org_br_mobile_idx ON public.lead_phones (organization_id, public.normalize_br_mobile(phone_digits))
  WHERE ((deleted_at IS NULL) AND (length(phone_digits) >= 10));
CREATE TABLE public.deals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_phone_id uuid, closed_at timestamptz, deleted_at timestamptz);

CREATE TABLE public.lead_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL, organization_id uuid,
  action text NOT NULL, description text, source text, metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lead_history_lead_created ON public.lead_history (lead_id, created_at DESC);
CREATE INDEX idx_lead_history_lead_source ON public.lead_history (lead_id, source, created_at DESC);

CREATE TABLE public.whatsapp_conversation_summary (
  organization_id uuid NOT NULL, instance_id uuid NOT NULL, normalized_phone text NOT NULL,
  phone_number text, last_message text, last_message_time timestamptz,
  last_message_direction text, last_message_sent_source text, last_push_name text,
  lead_id uuid, is_group boolean NOT NULL DEFAULT false, updated_at timestamptz,
  saved_contact_name text,
  PRIMARY KEY (organization_id, instance_id, normalized_phone)
);
CREATE INDEX idx_wa_conv_summary_recency ON public.whatsapp_conversation_summary (organization_id, instance_id, last_message_time DESC);

CREATE TABLE public.whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, instance_id uuid NOT NULL, normalized_phone text NOT NULL,
  archived_at timestamptz, deleted_at timestamptz
);
CREATE INDEX ON public.whatsapp_conversations (organization_id, instance_id, normalized_phone);

CREATE TABLE public.webhooks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true, events text[] NOT NULL DEFAULT '{}');
CREATE INDEX idx_webhooks_organization_active ON public.webhooks (organization_id, is_active);
CREATE TABLE public.webhook_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), webhook_id uuid NOT NULL,
  event text NOT NULL, payload jsonb NOT NULL, next_retry_at timestamptz);
CREATE INDEX idx_webhook_deliveries_next_retry ON public.webhook_deliveries (next_retry_at);

CREATE TABLE public.scheduled_campaign_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campanha_id uuid, rule_id uuid,
  campanha_lead_id uuid, lead_id uuid, whatsapp_instance_id uuid, step_position int, status text, sent_at timestamptz);
CREATE INDEX idx_scm_waiting_response_lead ON public.scheduled_campaign_messages (lead_id, status) WHERE (status = 'waiting_response');
CREATE TABLE public.scheduled_pipe_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, pipe_type text,
  rule_id uuid, pipe_record_id uuid, lead_id uuid, whatsapp_instance_id uuid, step_position int, status text, sent_at timestamptz);
CREATE INDEX idx_spm_waiting_response_lead ON public.scheduled_pipe_messages (lead_id, status) WHERE (status = 'waiting_response');

CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, instance_id uuid,
  message_id text NOT NULL, remote_jid text NOT NULL, phone_number text NOT NULL, normalized_phone text,
  direction text NOT NULL, message_type text NOT NULL DEFAULT 'text', content text,
  status text DEFAULT 'received', lead_id uuid,
  "timestamp" timestamptz NOT NULL DEFAULT now(), created_at timestamptz DEFAULT now(),
  raw_payload jsonb, push_name text, received_via text, edited boolean, deleted_at timestamptz,
  is_group boolean NOT NULL DEFAULT false, sent_source text NOT NULL DEFAULT 'manual', sent_by_ai boolean,
  UNIQUE (message_id, instance_id)
);

-- ── corpos REAIS de prod (pg_get_functiondef, 2026-10-19) ──────────────────
CREATE FUNCTION public.normalize_whatsapp_message_phone() RETURNS trigger
 LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $f$
BEGIN
  NEW.normalized_phone := public.normalize_brazilian_phone(NEW.phone_number);
  RETURN NEW;
END;
$f$;

CREATE FUNCTION public.resolve_message_lead_id() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  resolved_id uuid;
  digits text;
  normalized text;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  digits := regexp_replace(COALESCE(NEW.phone_number, ''), '[^0-9]', '', 'g');
  IF digits = '' THEN
    RETURN NEW;
  END IF;
  SELECT l.id INTO resolved_id
  FROM leads l
  WHERE l.organization_id = NEW.organization_id
    AND l.deleted_at IS NULL
    AND l.phone_digits = digits
    AND l.phone_digits != ''
  LIMIT 1;
  IF resolved_id IS NULL AND length(digits) >= 10 THEN
    normalized := normalize_br_mobile(digits);
    SELECT l.id INTO resolved_id
    FROM leads l
    WHERE l.organization_id = NEW.organization_id
      AND l.deleted_at IS NULL
      AND l.phone_digits != ''
      AND length(l.phone_digits) >= 10
      AND normalize_br_mobile(l.phone_digits) = normalized
    LIMIT 1;
  END IF;
  IF resolved_id IS NULL AND length(digits) >= 10 THEN
    SELECT l.id INTO resolved_id
    FROM leads l
    WHERE l.organization_id = NEW.organization_id
      AND l.deleted_at IS NULL
      AND l.phone_digits != ''
      AND length(l.phone_digits) >= 10
      AND right(l.phone_digits, 11) = right(digits, 11)
    LIMIT 1;
  END IF;
  IF resolved_id IS NULL THEN
    SELECT lp.lead_id INTO resolved_id
    FROM lead_phones lp
    JOIN leads l ON l.id = lp.lead_id AND l.deleted_at IS NULL
    WHERE lp.organization_id = NEW.organization_id
      AND lp.deleted_at IS NULL
      AND lp.phone_digits = digits
    ORDER BY EXISTS (SELECT 1 FROM deals d
                      WHERE d.lead_phone_id = lp.id
                        AND d.closed_at IS NULL AND d.deleted_at IS NULL) DESC,
             lp.updated_at DESC, lp.id
    LIMIT 1;
    IF resolved_id IS NULL AND length(digits) >= 10 THEN
      normalized := normalize_br_mobile(digits);
      SELECT lp.lead_id INTO resolved_id
      FROM lead_phones lp
      JOIN leads l ON l.id = lp.lead_id AND l.deleted_at IS NULL
      WHERE lp.organization_id = NEW.organization_id
        AND lp.deleted_at IS NULL
        AND length(lp.phone_digits) >= 10
        AND normalize_br_mobile(lp.phone_digits) = normalized
      ORDER BY EXISTS (SELECT 1 FROM deals d
                        WHERE d.lead_phone_id = lp.id
                          AND d.closed_at IS NULL AND d.deleted_at IS NULL) DESC,
               lp.updated_at DESC, lp.id
      LIMIT 1;
    END IF;
  END IF;
  IF resolved_id IS NOT NULL THEN
    NEW.lead_id := resolved_id;
  END IF;
  RETURN NEW;
END;
$f$;

CREATE FUNCTION public.fn_whatsapp_message_to_history() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  v_lead_id uuid; v_action text; v_description text; v_preview text; v_normalized text;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    v_lead_id := NEW.lead_id;
  ELSE
    v_normalized := public.normalize_brazilian_phone(NEW.phone_number);
    SELECT id INTO v_lead_id FROM public.leads
    WHERE organization_id = NEW.organization_id AND normalized_phone = v_normalized AND deleted_at IS NULL
    ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF v_lead_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.lead_history
    WHERE lead_id = v_lead_id
      AND metadata->>'message_id' = NEW.message_id
      AND metadata->>'channel' = 'whatsapp'
  ) THEN
    RETURN NEW;
  END IF;
  v_action := CASE NEW.direction WHEN 'incoming' THEN 'whatsapp_received' WHEN 'outgoing' THEN 'whatsapp_sent' ELSE 'whatsapp_event' END;
  v_preview := COALESCE(substring(NEW.content from 1 for 80), '');
  v_description := CASE NEW.direction WHEN 'incoming' THEN 'WhatsApp recebido' WHEN 'outgoing' THEN 'WhatsApp enviado' ELSE 'Evento WhatsApp' END
    || CASE WHEN length(v_preview) > 0 THEN ': ' || v_preview ELSE '' END;
  INSERT INTO public.lead_history (lead_id, organization_id, action, description, source, metadata, created_at)
  VALUES (v_lead_id, NEW.organization_id, v_action, v_description, 'system',
    jsonb_build_object('channel', 'whatsapp', 'message_id', NEW.message_id, 'direction', NEW.direction,
      'phone_number', NEW.phone_number, 'instance_id', NEW.instance_id, 'remote_jid', NEW.remote_jid,
      'message_type', NEW.message_type),
    COALESCE(NEW.timestamp, NEW.created_at, now()));
  RETURN NEW;
END;
$f$;

CREATE FUNCTION public.tg_whatsapp_conversation_summary() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.normalized_phone IS NULL OR NEW.instance_id IS NULL OR NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.whatsapp_conversation_summary AS s
    (organization_id, instance_id, normalized_phone, phone_number, last_message,
     last_message_time, last_message_direction, last_message_sent_source,
     last_push_name, lead_id, is_group, updated_at)
  VALUES (
    NEW.organization_id, NEW.instance_id, NEW.normalized_phone, NEW.phone_number,
    CASE WHEN NEW.deleted_at IS NULL THEN NEW.content ELSE NULL END,
    NEW."timestamp", NEW.direction, NEW.sent_source,
    CASE WHEN NEW.direction = 'incoming' THEN NEW.push_name ELSE NULL END,
    NEW.lead_id, coalesce(NEW.is_group, false), now()
  )
  ON CONFLICT (organization_id, instance_id, normalized_phone) DO UPDATE SET
    phone_number             = CASE WHEN EXCLUDED.last_message_time >= s.last_message_time THEN EXCLUDED.phone_number             ELSE s.phone_number END,
    last_message             = CASE WHEN EXCLUDED.last_message_time >= s.last_message_time THEN EXCLUDED.last_message             ELSE s.last_message END,
    last_message_direction   = CASE WHEN EXCLUDED.last_message_time >= s.last_message_time THEN EXCLUDED.last_message_direction   ELSE s.last_message_direction END,
    last_message_sent_source = CASE WHEN EXCLUDED.last_message_time >= s.last_message_time THEN EXCLUDED.last_message_sent_source ELSE s.last_message_sent_source END,
    last_message_time        = greatest(s.last_message_time, EXCLUDED.last_message_time),
    last_push_name           = COALESCE(EXCLUDED.last_push_name, s.last_push_name),
    lead_id                  = COALESCE(s.lead_id, EXCLUDED.lead_id),
    is_group                 = s.is_group OR EXCLUDED.is_group,
    updated_at               = now();
  RETURN NEW;
END $f$;

CREATE FUNCTION public.capture_whatsapp_saved_contact_name() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$
DECLARE saved text := nullif(btrim(NEW.raw_payload->>'wa_contactName'), '');
BEGIN
  IF saved IS NOT NULL THEN
    UPDATE public.whatsapp_conversation_summary SET saved_contact_name = saved
    WHERE organization_id = NEW.organization_id AND instance_id = NEW.instance_id
      AND normalized_phone = NEW.normalized_phone;
  END IF;
  RETURN NEW;
END;
$f$;

CREATE FUNCTION public.enqueue_webhook_deliveries_for_org(p_organization_id uuid, p_event text, p_payload jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE w RECORD;
BEGIN
  IF p_organization_id IS NULL THEN RETURN; END IF;
  FOR w IN
    SELECT id FROM public.webhooks
    WHERE organization_id = p_organization_id AND is_active = true AND events @> ARRAY[p_event]::text[]
  LOOP
    INSERT INTO public.webhook_deliveries (webhook_id, event, payload, next_retry_at)
    VALUES (w.id, p_event, p_payload, now());
  END LOOP;
END;
$f$;

CREATE FUNCTION public.enqueue_whatsapp_messages_webhooks() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE ev TEXT; payload JSONB;
BEGIN
  IF NEW.organization_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.direction = 'incoming' THEN ev := 'whatsapp_message.received'; ELSE ev := 'whatsapp_message.sent'; END IF;
  payload := jsonb_build_object(
    'event', ev,
    'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'data', jsonb_build_object(
      'id', NEW.id, 'organization_id', NEW.organization_id, 'lead_id', NEW.lead_id,
      'direction', NEW.direction, 'message_type', NEW.message_type,
      'content', CASE WHEN length(COALESCE(NEW.content, '')) > 500 THEN left(NEW.content, 500) || '...' ELSE NEW.content END,
      'phone_number', NEW.phone_number, 'status', NEW.status, 'message_id', NEW.message_id));
  PERFORM enqueue_webhook_deliveries_for_org(NEW.organization_id, ev, payload);
  RETURN NEW;
END;
$f$;

-- Recorte do corpo de prod: os dois laços (campanha e pipe) com os mesmos
-- SELECTs de entrada. Sem linha 'waiting_response' (o caso de quase toda
-- mensagem), o resto do corpo de prod não executa.
CREATE FUNCTION public.trigger_whatsapp_response_detection() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE waiting_rec RECORD;
BEGIN
  IF NEW.direction != 'incoming' THEN RETURN NEW; END IF;
  FOR waiting_rec IN
    SELECT scm.id FROM public.scheduled_campaign_messages scm
    WHERE scm.lead_id = NEW.lead_id AND scm.status = 'waiting_response'
  LOOP
    RAISE EXCEPTION 'fora do recorte medido';
  END LOOP;
  FOR waiting_rec IN
    SELECT spm.id FROM public.scheduled_pipe_messages spm
    WHERE spm.lead_id = NEW.lead_id AND spm.status = 'waiting_response'
  LOOP
    RAISE EXCEPTION 'fora do recorte medido';
  END LOOP;
  RETURN NEW;
END;
$f$;

CREATE FUNCTION private.unarchive_conversation_on_inbound() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$
BEGIN
  BEGIN
    UPDATE public.whatsapp_conversations c
       SET archived_at = NULL
     WHERE c.organization_id = NEW.organization_id
       AND c.instance_id = NEW.instance_id
       AND c.normalized_phone = NEW.normalized_phone
       AND c.deleted_at IS NULL
       AND c.archived_at IS NOT NULL
       AND c.archived_at <= NEW."timestamp";
  EXCEPTION WHEN others THEN
    RAISE WARNING 'unarchive_conversation_on_inbound: não aplicado (SQLSTATE %)', SQLSTATE;
  END;
  RETURN NULL;
END
$f$;

-- ── triggers: nomes, timing e WHEN idênticos a prod ────────────────────────
CREATE TRIGGER trg_normalize_whatsapp_message_phone BEFORE INSERT OR UPDATE OF phone_number ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.normalize_whatsapp_message_phone();
CREATE TRIGGER trg_resolve_message_lead_id BEFORE INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.resolve_message_lead_id();
CREATE TRIGGER trg_enqueue_whatsapp_messages_webhooks AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW WHEN ((new.received_via IS DISTINCT FROM 'history_sync'::text)) EXECUTE FUNCTION public.enqueue_whatsapp_messages_webhooks();
CREATE TRIGGER trg_unarchive_on_inbound AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW WHEN (((new.direction = 'incoming'::text) AND (new.received_via IS DISTINCT FROM 'history_sync'::text)
    AND (NOT COALESCE(new.is_group, false)) AND (new.remote_jid !~~ '%@g.us'::text) AND (NOT COALESCE(new.edited, false))
    AND (new.deleted_at IS NULL) AND (new.instance_id IS NOT NULL) AND (new.normalized_phone IS NOT NULL)
    AND (new."timestamp" IS NOT NULL))) EXECUTE FUNCTION private.unarchive_conversation_on_inbound();
CREATE TRIGGER trg_whatsapp_conversation_summary AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_whatsapp_conversation_summary();
CREATE TRIGGER trg_whatsapp_message_to_history AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_whatsapp_message_to_history();
CREATE TRIGGER trg_whatsapp_response_detection AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW WHEN (((new.direction = 'incoming'::text) AND (new.received_via IS DISTINCT FROM 'history_sync'::text)))
  EXECUTE FUNCTION public.trigger_whatsapp_response_detection();
CREATE TRIGGER zz_capture_whatsapp_saved_contact_name AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.capture_whatsapp_saved_contact_name();
`;

const TRIGGERS = [
  'trg_normalize_whatsapp_message_phone', 'trg_resolve_message_lead_id', 'trg_enqueue_whatsapp_messages_webhooks',
  'trg_unarchive_on_inbound', 'trg_whatsapp_conversation_summary', 'trg_whatsapp_message_to_history',
  'trg_whatsapp_response_detection', 'zz_capture_whatsapp_saved_contact_name',
];

// Telefones determinísticos: lead i da org grande = 55119 + 8 dígitos de i.
const phoneOf = (i) => `55119${String(10000000 + i).slice(-8)}`;
const N_LEADS = 11300;
const NORMAL_LEADS = 40; // leads "comuns", 170 linhas de histórico cada

const SEED = `
INSERT INTO public.leads (organization_id, name, phone_digits, normalized_phone)
  SELECT '${ORG}', 'Lead ' || i, '55119' || right((10000000 + i)::text, 8),
         public.normalize_brazilian_phone('55119' || right((10000000 + i)::text, 8))
    FROM generate_series(1, ${N_LEADS}) i;
INSERT INTO public.leads (id, organization_id, name, phone_digits, normalized_phone)
  VALUES ('${HEAVY}', '${ORG}', 'Pesado', '5511977777777', public.normalize_brazilian_phone('5511977777777'));
-- Outra org com o mesmo telefone do lead 1: isolamento por org.
INSERT INTO public.leads (organization_id, name, phone_digits, normalized_phone)
  VALUES ('${ORG2}', 'Outra org', '${phoneOf(1)}', public.normalize_brazilian_phone('${phoneOf(1)}'));
-- Lead pesado: 15.219 linhas de histórico (o maior de prod), 2/3 WhatsApp.
INSERT INTO public.lead_history (lead_id, organization_id, action, source, metadata, created_at)
  SELECT '${HEAVY}', '${ORG}', CASE WHEN i % 3 = 0 THEN 'stage_changed' ELSE 'whatsapp_received' END, 'system',
         CASE WHEN i % 3 = 0 THEN jsonb_build_object('from', 'a', 'to', 'b')
              ELSE jsonb_build_object('channel', 'whatsapp', 'message_id', 'old-' || i, 'direction', 'incoming',
                     'phone_number', '5511977777777', 'remote_jid', '5511977777777@s.whatsapp.net', 'message_type', 'text') END,
         now() - (i || ' minutes')::interval
    FROM generate_series(1, 15219) i;
INSERT INTO public.lead_history (lead_id, organization_id, action, source, metadata)
  SELECT l.id, '${ORG}', 'whatsapp_received', 'system',
         jsonb_build_object('channel', 'whatsapp', 'message_id', 'old-' || l.id || '-' || g, 'direction', 'incoming')
    FROM (SELECT id FROM public.leads WHERE organization_id = '${ORG}' AND name LIKE 'Lead %' ORDER BY phone_digits LIMIT ${NORMAL_LEADS}) l,
         generate_series(1, 170) g;
INSERT INTO public.webhooks (organization_id, events) VALUES ('${ORG}', ARRAY['whatsapp_message.received']);
ANALYZE;
`;

async function freshDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(SEED);
  return db;
}

// Três classes de INSERT incoming (todas fora de history_sync):
//   U = telefone desconhecido (75% de prod) · H = lead pesado · N = lead comum.
const CLASSES = {
  U: (i) => `55219${String(20000000 + i).slice(-8)}`,
  H: () => '5511977777777',
  N: (i) => phoneOf(1 + (i % NORMAL_LEADS)),
};

async function insertMsg(db, cls, i, tag) {
  const phone = CLASSES[cls](i);
  await db.query(
    `INSERT INTO public.whatsapp_messages
       (organization_id, instance_id, message_id, remote_jid, phone_number, direction, content, push_name, raw_payload, "timestamp")
     VALUES ($1, $2, $3, $4, $5, 'incoming', 'Oi, tudo bem?', 'Fulano', $6::jsonb, now() + ($7 || ' seconds')::interval)`,
    [ORG, INST, `${tag}-${cls}-${i}`, `${phone}@s.whatsapp.net`, phone,
     JSON.stringify({ wa_contactName: 'Contato ' + i }), String(i)]);
}

async function timeClass(db, cls, n, tag) {
  await insertMsg(db, cls, -1, tag + 'warm'); // aquece cache de plano do plpgsql
  const t0 = performance.now();
  for (let i = 0; i < n; i++) await insertMsg(db, cls, i, tag);
  return (performance.now() - t0) / n;
}

const setTrigger = (db, name, on) =>
  db.exec(`ALTER TABLE public.whatsapp_messages ${on ? 'ENABLE' : 'DISABLE'} TRIGGER ${name}`);

const statementsOf = (sql) => sql.replace(/--[^\n]*/g, '').split(';').map((x) => x.trim()).filter(Boolean);

// Estado observável que as triggers produzem — tem que ser idêntico com e sem índice.
async function snapshot(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  return {
    messages: await q(`SELECT message_id, normalized_phone, lead_id FROM public.whatsapp_messages ORDER BY message_id`),
    history: await q(`SELECT lead_id, action, description, metadata - 'instance_id' AS m FROM public.lead_history
                       WHERE metadata->>'message_id' NOT LIKE 'old-%' ORDER BY metadata->>'message_id'`),
    summary: await q(`SELECT organization_id, instance_id, normalized_phone, last_message, last_message_direction, lead_id,
                             last_push_name, saved_contact_name FROM public.whatsapp_conversation_summary ORDER BY normalized_phone`),
    deliveries: await q(`SELECT event, payload->'data'->>'message_id' AS mid, payload->'data'->>'lead_id' AS lead
                           FROM public.webhook_deliveries ORDER BY 2`),
  };
}

test('migrations e rollbacks: um statement CONCURRENTLY cada', () => {
  for (const f of [IDX_LEADS, IDX_HIST]) {
    for (const path of [MIG + f, MIG + 'rollback/' + f]) {
      const st = statementsOf(read(path));
      assert.equal(st.length, 1, path);
      assert.match(st[0], /\bCONCURRENTLY\b/, path);
    }
  }
});

test('medição: custo relativo de cada trigger e efeito dos índices (PGlite, limite declarado)', async (t) => {
  const db = await freshDb();
  const N = 40;
  try {
    const rows = [];
    const measure = async (label) => {
      const r = { label };
      for (const cls of Object.keys(CLASSES)) r[cls] = await timeClass(db, cls, N, `${label}`);
      rows.push(r);
      return r;
    };
    const all = await measure('todas');
    for (const trg of TRIGGERS) {
      await setTrigger(db, trg, false);
      await measure(`sem ${trg}`);
      await setTrigger(db, trg, true);
    }
    for (const trg of TRIGGERS) await setTrigger(db, trg, false);
    const none = await measure('nenhuma');
    for (const trg of TRIGGERS) await setTrigger(db, trg, true);

    for (const f of [IDX_LEADS, IDX_HIST]) await db.exec(read(MIG + f));
    await db.exec('ANALYZE public.leads; ANALYZE public.lead_history;');
    const idx = await measure('todas + índices F5b');

    const fmt = (v) => v.toFixed(2).padStart(7);
    t.diagnostic('ms/INSERT        U(sem lead)  H(lead pesado)  N(lead comum)');
    for (const r of rows) t.diagnostic(`${fmt(r.U)} ${fmt(r.H)} ${fmt(r.N)}   ${r.label}`);

    // Controle positivo: o custo existe e é das triggers (senão o resto não prova nada).
    assert.ok(all.U > none.U * 3, `U: triggers deveriam dominar: ${JSON.stringify({ all, none })}`);
    // Os dois lookups sem índice são o custo: com os índices, U e H caem ≥ 3×.
    assert.ok(idx.U * 3 < all.U, `U com índice: ${idx.U} vs ${all.U}`);
    assert.ok(idx.H * 3 < all.H, `H com índice: ${idx.H} vs ${all.H}`);
    // Desligar history/summary/webhooks isoladamente (o que a fila tiraria) rende
    // menos que os índices no caso dominante (U, 75% de prod).
    const without = (name) => rows.find((r) => r.label === `sem ${name}`);
    const queueable = ['trg_whatsapp_message_to_history', 'trg_whatsapp_conversation_summary', 'trg_enqueue_whatsapp_messages_webhooks'];
    const gainQueue = queueable.reduce((a, n) => a + (all.U - without(n).U), 0);
    assert.ok(all.U - idx.U > gainQueue, `índices (${(all.U - idx.U).toFixed(2)}) vs fila (${gainQueue.toFixed(2)}) em U`);
  } finally { await db.close(); }
});

test('planner usa os índices novos nas consultas exatas das triggers', async () => {
  const db = await freshDb();
  try {
    for (const f of [IDX_LEADS, IDX_HIST]) await db.exec(read(MIG + f));
    await db.exec('ANALYZE public.leads; ANALYZE public.lead_history;');
    // Mesma forma que o plpgsql gera (plano genérico: parâmetros).
    await db.exec(`PREPARE p2(uuid, text) AS SELECT l.id FROM leads l WHERE l.organization_id = $1 AND l.deleted_at IS NULL
                     AND l.phone_digits != '' AND length(l.phone_digits) >= 10 AND normalize_br_mobile(l.phone_digits) = $2 LIMIT 1;
                   PREPARE ph(uuid, text) AS SELECT 1 FROM public.lead_history WHERE lead_id = $1
                     AND metadata->>'message_id' = $2 AND metadata->>'channel' = 'whatsapp';
                   SET plan_cache_mode = force_generic_plan;`);
    const plan = async (sql) => (await db.query(`EXPLAIN ${sql}`)).rows.map((r) => r['QUERY PLAN']).join('\n');
    assert.match(await plan(`EXECUTE p2('${ORG}', '5521999999999')`), /leads_org_br_mobile_idx/);
    assert.match(await plan(`EXECUTE ph('${HEAVY}', 'x')`), /lead_history_whatsapp_message_id_idx/);
  } finally { await db.close(); }
});

test('consistência: mesmo fluxo com e sem índices → estado final idêntico; reprocessar não duplica; org isolada', async () => {
  const run = async (withIdx) => {
    const db = await freshDb();
    try {
      if (withIdx) { for (const f of [IDX_LEADS, IDX_HIST]) await db.exec(read(MIG + f)); await db.exec('ANALYZE;'); }
      // Lead resolvido só pelo passe 2 (9º dígito ausente: 12 dígitos → normalize_br_mobile).
      const p2 = phoneOf(7).slice(0, 4) + phoneOf(7).slice(5); // 551110000007 (sem o 9)
      await db.query(`INSERT INTO public.whatsapp_messages (organization_id, instance_id, message_id, remote_jid, phone_number, direction, content)
                      VALUES ($1, $2, 'p2-hit', $3, $3, 'incoming', 'passe 2')`, [ORG, INST, p2]);
      for (let i = 0; i < 15; i++) for (const cls of Object.keys(CLASSES)) await insertMsg(db, cls, i, 'flow');
      // Reprocessamento: mesmo message_id em outra instância (o UNIQUE é por instância)
      // → linha nova, mas o histórico do lead NÃO duplica (idempotência por message_id).
      const INST2 = '00000000-0000-0000-0000-00000000b002';
      await db.query(`INSERT INTO public.whatsapp_messages (organization_id, instance_id, message_id, remote_jid, phone_number, direction, content)
                      VALUES ($1, $2, 'flow-H-0', '5511977777777@s.whatsapp.net', '5511977777777', 'incoming', 'Oi, tudo bem?')`, [ORG, INST2]);
      // Mensagem da ORG2 com telefone do lead 1 da ORG: resolve para o lead da ORG2.
      await db.query(`INSERT INTO public.whatsapp_messages (organization_id, instance_id, message_id, remote_jid, phone_number, direction, content)
                      VALUES ($1, $2, 'org2-1', $3, $3, 'incoming', 'outra org')`, [ORG2, INST2, phoneOf(1)]);
      const snap = await snapshot(db);
      const p2Lead = (await db.query(`SELECT id FROM public.leads WHERE organization_id = $1 AND phone_digits = $2`, [ORG, phoneOf(7)])).rows[0].id;
      const org2Lead = (await db.query(`SELECT id FROM public.leads WHERE organization_id = $1`, [ORG2])).rows[0].id;
      const dupHist = (await db.query(`SELECT count(*)::int AS n FROM public.lead_history WHERE metadata->>'message_id' = 'flow-H-0'`)).rows[0].n;
      return { snap, p2Lead, org2Lead, dupHist };
    } finally { await db.close(); }
  };
  const [sem, com] = [await run(false), await run(true)];
  // Controle positivo: o fluxo exercita todos os ramos que importam.
  const msg = (id) => sem.snap.messages.find((m) => m.message_id === id);
  assert.equal(msg('p2-hit').lead_id, sem.p2Lead, 'passe 2 resolveu');
  assert.equal(msg('flow-U-0').lead_id, null, 'desconhecido sem lead');
  assert.equal(msg('flow-H-0').lead_id, HEAVY);
  assert.equal(msg('org2-1').lead_id, sem.org2Lead, 'org2 resolve para o próprio lead');
  assert.equal(sem.dupHist, 1, 'reprocessar não duplica histórico');
  assert.ok(sem.snap.history.length >= 31 && sem.snap.deliveries.length >= 46 && sem.snap.summary.length >= 16, JSON.stringify({
    h: sem.snap.history.length, d: sem.snap.deliveries.length, s: sem.snap.summary.length }));
  // Prova: índices não mudam nada observável.
  assert.equal(com.dupHist, 1);
  // lead_id dos leads gerados difere entre bancos (gen_random_uuid): compara por papel.
  const norm = (r) => JSON.stringify(r.snap, (k, v) => (v === r.p2Lead ? 'P2' : v === r.org2Lead ? 'ORG2' : v));
  const strip = (s) => s.replace(/"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}"/g, '"<lead>"');
  assert.equal(strip(norm(com)), strip(norm(sem)));
});

test('rollback remove os índices; reaplicar é idempotente', async () => {
  const db = await freshDb();
  try {
    await assert.rejects(db.exec('BEGIN;' + read(MIG + IDX_LEADS)), /cannot run inside a transaction block/);
    await db.exec('ROLLBACK');
    for (const f of [IDX_LEADS, IDX_HIST, IDX_LEADS, IDX_HIST]) await db.exec(read(MIG + f));
    const def = async (n) => (await db.query(`SELECT pg_get_indexdef(to_regclass($1)) AS d`, [`public.${n}`])).rows[0].d;
    assert.match(await def('leads_org_br_mobile_idx'), /normalize_br_mobile\(phone_digits\)/);
    assert.match(await def('lead_history_whatsapp_message_id_idx'), /USING hash/);
    for (const f of [IDX_LEADS, IDX_HIST, IDX_LEADS]) await db.exec(read(MIG + 'rollback/' + (f)));
    assert.equal(await def('leads_org_br_mobile_idx'), null);
    assert.equal(await def('lead_history_whatsapp_message_id_idx'), null);
  } finally { await db.close(); }
});
