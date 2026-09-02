-- ═══════════════════════════════════════════════════════════════════════════
-- SCRUM-629 (W3) · Disparo por etapa em funil custom — freio triplo D11
-- ═══════════════════════════════════════════════════════════════════════════
-- Destrava o que a 20270908001000 deixou tripwired: o dispatch por etapa
-- (pipe_dispatch_rules → scheduled_pipe_messages → pipe-rule-dispatch) passa
-- a valer para QUALQUER funil — mas atrás de três freios (decisão CTO D11,
-- 3 bans históricos de WhatsApp):
--
--   Freio 1 — nasce DESLIGADO por funil. `pipelines.stage_dispatch_enabled`
--     default false; só o toggle explícito na config do funil liga.
--   Freio 2 — NUNCA retroativo. `stage_dispatch_enabled_at` é carimbado
--     server-side no flip false→true; o trigger só agenda movimento posterior
--     ao carimbo, e o claim da fila re-checa (item criado antes da ativação
--     não sai). Desligar o toggle CANCELA a fila pendente do funil.
--   Freio 3 — todo envio passa pelo send-governor. O caminho já é
--     pipe-rule-dispatch → sendTextViaInstance/sendAudioViaInstance
--     (_shared/whatsapp-dispatch.ts) → governSend. Nada aqui abre rota nova
--     de envio; o gate de claim só REDUZ o que chega lá.
--
-- Decisão de backfill (menos-surpresa, documentada):
--   · Funis de SISTEMA já disparam hoje — nascem `enabled = true` com
--     `enabled_at = epoch`. O epoch torna o corte temporal INERTE para
--     sistema (nenhuma regra viva é barrada) sem abrir branch por tipo:
--     um único mecanismo (`movimento >= enabled_at`) vale para todos.
--   · Funis CUSTOM nascem `false/NULL` — o early-return de hoje vira gate.
--
-- Chaveamento por id (fim do pipe_type como chave):
--   · pipe_dispatch_rules.pipeline_id (FK, CASCADE) — backfill por
--     (org, slug, type='system'); trigger resolve/ecoa daqui em diante
--     (pipe_type vira eco do slug).
--   · scheduled_pipe_messages.pipeline_id (FK, CASCADE) — backfill via
--     pipe_record_id → pipeline_entries; trigger BEFORE INSERT resolve no
--     choke (nenhum caller precisa mudar — schedule_pipe_rule_steps_from_position
--     continua intocada). Linhas históricas cujo card já morreu ficam NULL
--     (só história; o gate de claim trata NULL como legado-sistema).
--
-- Compat (janela migration→deploy do edge): o edge deployado processa por
-- pipe_type e continua funcionando — o gate novo mora no claim RPC que ele já
-- chama. O edge novo processa por pipeline_id (claim_pipe_dispatch_batch_by_pipeline).
--
-- Rollback pareado: supabase/migrations/rollback/20270908008000_disparo_por_etapa_em_funil_custom.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- §1 · pipelines: toggle + carimbo temporal (freios 1 e 2)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS stage_dispatch_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stage_dispatch_enabled_at timestamptz;

COMMENT ON COLUMN public.pipelines.stage_dispatch_enabled IS
  'D11/W3 (SCRUM-629): liga o disparo por etapa (pipe_dispatch_rules) neste funil. Custom nasce false; system nasce true (comportamento pré-existente preservado).';
COMMENT ON COLUMN public.pipelines.stage_dispatch_enabled_at IS
  'Corte temporal do D11: só movimento >= este carimbo agenda disparo. Carimbado server-side no flip false→true (trigger). System = epoch (corte inerte — regra viva nunca barra).';

-- Backfill: sistema já dispara hoje — preserva. Epoch = corte inerte.
UPDATE public.pipelines
   SET stage_dispatch_enabled    = true,
       stage_dispatch_enabled_at = 'epoch'::timestamptz
 WHERE type = 'system' -- metric-lint-allow: backfill one-shot de legado — "quem já dispara hoje" é exatamente o gate antigo por type; daqui em diante a decisão é stage_dispatch_enabled, nunca type (ADR-0034); morre com a migration
   AND stage_dispatch_enabled = false;

-- Carimbo e cancelamento server-side. O front escreve SÓ o boolean; a hora é
-- do servidor (nunca do relógio do cliente). Desligar cancela a fila pendente
-- do funil — pendência velha não "acorda" num religa futuro (o religa renova
-- enabled_at, e o claim barra created_at < enabled_at de qualquer forma:
-- cinto E suspensório).
CREATE OR REPLACE FUNCTION public.pipelines_stage_dispatch_toggle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage_dispatch_enabled AND NEW.stage_dispatch_enabled_at IS NULL THEN
      NEW.stage_dispatch_enabled_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.stage_dispatch_enabled AND NOT OLD.stage_dispatch_enabled THEN
    NEW.stage_dispatch_enabled_at := now();
  ELSIF NOT NEW.stage_dispatch_enabled AND OLD.stage_dispatch_enabled THEN
    -- Freio 2: desligou → nada pendente deste funil pode sair depois.
    UPDATE public.scheduled_pipe_messages
       SET status = 'cancelled',
           error_message = 'Disparo por etapa desligado no funil (D11/SCRUM-629)'
     WHERE pipeline_id = NEW.id
       AND status IN ('scheduled', 'waiting_response');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pipelines_stage_dispatch_toggle ON public.pipelines;
CREATE TRIGGER trg_pipelines_stage_dispatch_toggle
  BEFORE INSERT OR UPDATE OF stage_dispatch_enabled ON public.pipelines
  FOR EACH ROW EXECUTE FUNCTION public.pipelines_stage_dispatch_toggle();

-- ────────────────────────────────────────────────────────────────────────────
-- §2 · pipe_dispatch_rules: chave por funil (pipe_type vira eco)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.pipe_dispatch_rules
  ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES public.pipelines(id) ON DELETE CASCADE;

-- pipe_type deixa de ser vocabulário fechado (era CHECK dos 3 slugs de
-- sistema) e vira eco do slug de QUALQUER funil — o trigger de resolução
-- abaixo é quem garante a integridade (eco = pipelines.slug).
ALTER TABLE public.pipe_dispatch_rules DROP CONSTRAINT IF EXISTS pipe_dispatch_rules_pipe_type_check;
ALTER TABLE public.pipe_dispatch_rules ADD CONSTRAINT pipe_dispatch_rules_pipe_type_check CHECK (pipe_type <> '');

COMMENT ON COLUMN public.pipe_dispatch_rules.pipeline_id IS
  'SCRUM-629: funil dono da regra (qualquer tipo). pipe_type é eco do slug — a chave é esta.';

-- Backfill: regras existentes são todas de funil de sistema (pipe_type ∈
-- whatsapp/confirmacao/propostas). Medido em prod 2026-09-02: 1 regra,
-- 0 sem match, 0 match ambíguo.
UPDATE public.pipe_dispatch_rules r
   SET pipeline_id = p.id
  FROM public.pipelines p
 WHERE r.pipeline_id IS NULL
   AND p.organization_id = r.organization_id
   AND p.slug = r.pipe_type
   AND p.type = 'system'; -- metric-lint-allow: backfill one-shot — regras legadas só existiam para os 3 funis de sistema (CHECK antigo); morre com a migration

CREATE INDEX IF NOT EXISTS idx_pipe_dispatch_rules_pipeline
  ON public.pipe_dispatch_rules (pipeline_id) WHERE pipeline_id IS NOT NULL;

-- Choke de escrita: front antigo (só pipe_type) resolve o funil de sistema;
-- front novo (pipeline_id) tem o eco garantido e a org validada. Fail-closed:
-- regra sem funil resolvível não entra.
CREATE OR REPLACE FUNCTION public.pipe_dispatch_rules_resolve_pipeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_pipe RECORD;
BEGIN
  IF NEW.pipeline_id IS NULL THEN
    -- (organization_id, slug) é UNIQUE em pipelines: o slug identifica o
    -- funil sem olhar type (ADR-0034 — comportamento nunca decide por type).
    SELECT p.id, p.slug INTO v_pipe
      FROM public.pipelines p
     WHERE p.organization_id = NEW.organization_id
       AND p.slug = NEW.pipe_type;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'pipe_dispatch_rules: funil não resolvível para pipe_type % na org %', NEW.pipe_type, NEW.organization_id;
    END IF;
    NEW.pipeline_id := v_pipe.id;
  ELSE
    SELECT p.id, p.slug INTO v_pipe
      FROM public.pipelines p
     WHERE p.id = NEW.pipeline_id
       AND p.organization_id = NEW.organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'pipe_dispatch_rules: pipeline % não pertence à org %', NEW.pipeline_id, NEW.organization_id;
    END IF;
    NEW.pipe_type := v_pipe.slug;  -- eco
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pipe_dispatch_rules_resolve_pipeline ON public.pipe_dispatch_rules;
CREATE TRIGGER trg_pipe_dispatch_rules_resolve_pipeline
  BEFORE INSERT OR UPDATE OF pipeline_id, pipe_type, organization_id ON public.pipe_dispatch_rules
  FOR EACH ROW EXECUTE FUNCTION public.pipe_dispatch_rules_resolve_pipeline();

-- ────────────────────────────────────────────────────────────────────────────
-- §3 · scheduled_pipe_messages: fila carrega o funil
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.scheduled_pipe_messages
  ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES public.pipelines(id) ON DELETE CASCADE;

-- Mesmo destravamento do vocabulário: a fila carrega slug de qualquer funil.
ALTER TABLE public.scheduled_pipe_messages DROP CONSTRAINT IF EXISTS scheduled_pipe_messages_pipe_type_check;
ALTER TABLE public.scheduled_pipe_messages ADD CONSTRAINT scheduled_pipe_messages_pipe_type_check CHECK (pipe_type <> '');

COMMENT ON COLUMN public.scheduled_pipe_messages.pipeline_id IS
  'SCRUM-629: funil do item. Resolvido no choke (BEFORE INSERT via pipe_record_id → pipeline_entries). NULL = linha histórica cujo card já morreu (gate de claim trata como legado).';

-- Backfill pela procedência real (pipe_record_id → pipeline_entries), não por
-- slug: mais preciso e imune a colisão de slug entre orgs.
UPDATE public.scheduled_pipe_messages m
   SET pipeline_id = pe.pipeline_id
  FROM public.pipeline_entries pe
 WHERE m.pipeline_id IS NULL
   AND pe.id = m.pipe_record_id;

CREATE INDEX IF NOT EXISTS idx_scheduled_pipe_messages_pipeline_status
  ON public.scheduled_pipe_messages (pipeline_id, status) WHERE pipeline_id IS NOT NULL;

-- Choke: qualquer INSERT futuro (schedule_pipe_rule_steps_from_position ou
-- quem vier) ganha pipeline_id sem mudar assinatura de RPC nenhuma.
CREATE OR REPLACE FUNCTION public.scheduled_pipe_messages_resolve_pipeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.pipeline_id IS NULL THEN
    SELECT pe.pipeline_id INTO NEW.pipeline_id
      FROM public.pipeline_entries pe
     WHERE pe.id = NEW.pipe_record_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scheduled_pipe_messages_resolve_pipeline ON public.scheduled_pipe_messages;
CREATE TRIGGER trg_scheduled_pipe_messages_resolve_pipeline
  BEFORE INSERT ON public.scheduled_pipe_messages
  FOR EACH ROW EXECUTE FUNCTION public.scheduled_pipe_messages_resolve_pipeline();

-- ────────────────────────────────────────────────────────────────────────────
-- §4 · Claim da fila: gate D11 no choke (freio 2, camada de leitura)
-- ────────────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE preserva grants (authenticated + service_role, medidos em
-- prod). O predicado novo: item de funil com toggle OFF não sai; item criado
-- ANTES da ativação não sai. NULL pipeline_id = linha histórica de sistema
-- (comportamento de hoje preservado).

CREATE OR REPLACE FUNCTION public.claim_pipe_dispatch_batch(p_pipe_type text DEFAULT NULL::text, p_limit integer DEFAULT 50)
RETURNS TABLE (claimed_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY
  WITH batch AS (
    SELECT spm.id
    FROM public.scheduled_pipe_messages spm
    WHERE spm.status = 'scheduled'
      AND spm.scheduled_at <= now()
      AND (p_pipe_type IS NULL OR spm.pipe_type = p_pipe_type)
      AND (
        spm.pipeline_id IS NULL  -- legado sem funil resolvível: fluxo de hoje
        OR EXISTS (
          SELECT 1 FROM public.pipelines p
          WHERE p.id = spm.pipeline_id
            AND p.stage_dispatch_enabled
            AND p.stage_dispatch_enabled_at IS NOT NULL
            AND spm.created_at >= p.stage_dispatch_enabled_at  -- D11: nunca retroativo
        )
      )
    ORDER BY spm.scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.scheduled_pipe_messages spm
  SET status = 'processing', scheduled_at = now()
  FROM batch
  WHERE spm.id = batch.id
  RETURNING spm.id AS claimed_id;
END;
$$;

-- Variante por funil — o edge novo processa a fila por pipeline_id.
CREATE OR REPLACE FUNCTION public.claim_pipe_dispatch_batch_by_pipeline(p_pipeline_id uuid, p_limit integer)
RETURNS TABLE (claimed_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN QUERY
  WITH batch AS (
    SELECT spm.id
    FROM public.scheduled_pipe_messages spm
    JOIN public.pipelines p ON p.id = spm.pipeline_id
    WHERE spm.status = 'scheduled'
      AND spm.scheduled_at <= now()
      AND spm.pipeline_id = p_pipeline_id
      AND p.stage_dispatch_enabled
      AND p.stage_dispatch_enabled_at IS NOT NULL
      AND spm.created_at >= p.stage_dispatch_enabled_at  -- D11: nunca retroativo
    ORDER BY spm.scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.scheduled_pipe_messages spm
  SET status = 'processing', scheduled_at = now()
  FROM batch
  WHERE spm.id = batch.id
  RETURNING spm.id AS claimed_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pipe_dispatch_batch_by_pipeline(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_pipe_dispatch_batch_by_pipeline(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.claim_pipe_dispatch_batch_by_pipeline(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pipe_dispatch_batch_by_pipeline(uuid, integer) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- §5 · trigger_pipeline_entries_dispatch: early-return de custom vira gate D11
-- ────────────────────────────────────────────────────────────────────────────
-- O tripwire da 20270908001000 (11.9) previa exatamente este destravamento
-- ("Destravar é W3, não aqui"). Mudanças vs. a versão de prod:
--   · resolve o funil por NEW.pipeline_id SEM filtrar type='system';
--   · gate: enabled + enabled_at carimbado + movimento >= enabled_at (freio 1+2);
--   · regra casada SÓ por pipeline_id — sem fallback por pipe_type: o
--     backfill preencheu todas e o trigger de resolução é fail-closed
--     (pipeline_id NULL não existe pós-migration; front antigo resolve no choke);
--   · etapa resolvida por NEW.stage_id (canônico D3, o BEFORE-mirror já
--     preencheu) com fallback por (pipeline_id, stage_key);
--   · trigger re-chaveado para UPDATE OF stage_key, stage_id — escritor futuro
--     que mude só stage_id não escapa (nota D-f da 20270906002000);
--   · nudge pg_net carrega pipeline_id (edge antigo ignora a chave extra).

CREATE OR REPLACE FUNCTION public.trigger_pipeline_entries_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pipe RECORD;
  r RECORD;
  v_org_id UUID;
  v_already_exists BOOLEAN;
  v_scheduled_any BOOLEAN := false;
  v_stage_id UUID;
  v_worker_url TEXT;
  v_secret_val TEXT;
BEGIN
  v_org_id := NEW.organization_id;

  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- D11 (SCRUM-629): qualquer funil, desde que o disparo por etapa esteja
  -- LIGADO e o movimento seja posterior à ativação. System nasce ligado com
  -- enabled_at = epoch (corte inerte); custom só arma via toggle.
  SELECT pip.id, pip.slug, pip.stage_dispatch_enabled, pip.stage_dispatch_enabled_at
    INTO v_pipe
    FROM public.pipelines pip
   WHERE pip.id = NEW.pipeline_id;

  IF NOT FOUND
     OR NOT v_pipe.stage_dispatch_enabled
     OR v_pipe.stage_dispatch_enabled_at IS NULL
     OR now() < v_pipe.stage_dispatch_enabled_at THEN
    RETURN NEW;
  END IF;

  -- ON INSERT: rules with trigger_type = 'lead_added'
  IF TG_OP = 'INSERT' THEN
    FOR r IN
      SELECT id, whatsapp_instance_id
      FROM public.pipe_dispatch_rules
      WHERE organization_id = v_org_id
        AND is_active = true
        AND trigger_type = 'lead_added'
        AND pipeline_id = v_pipe.id
    LOOP
      IF public.schedule_pipe_rule_steps_from_position(
        v_org_id, v_pipe.slug, r.id, NEW.id, NEW.lead_id,
        r.whatsapp_instance_id, 0
      ) THEN
        v_scheduled_any := true;
      END IF;
    END LOOP;

    IF v_scheduled_any THEN
      BEGIN
        SELECT value INTO v_worker_url FROM public.cron_config WHERE key = 'pipe_rule_dispatch_url';
        SELECT value INTO v_secret_val FROM public.cron_config WHERE key = 'cron_secret';
        IF v_worker_url IS NOT NULL AND v_worker_url != '' THEN
          PERFORM net.http_post(
            url := v_worker_url,
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', COALESCE(v_secret_val, '')
            ),
            body := jsonb_build_object(
              'pipe_type', v_pipe.slug,
              'pipeline_id', v_pipe.id::text,
              'organization_id', v_org_id::text
            )
          );
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;

    RETURN NEW;
  END IF;

  -- ON UPDATE de etapa: rules with trigger_type = 'lead_moved_to_stage'.
  -- stage_id é o canônico (D3); o BEFORE-mirror já resolveu NEW.stage_id
  -- quando o escritor mandou só stage_key.
  IF TG_OP = 'UPDATE' AND (OLD.stage_key IS DISTINCT FROM NEW.stage_key
                           OR OLD.stage_id IS DISTINCT FROM NEW.stage_id) THEN
    SELECT ps.id INTO v_stage_id
    FROM public.pipeline_stages ps
    WHERE ps.id = NEW.stage_id
      AND ps.is_active = true;

    IF v_stage_id IS NULL THEN
      SELECT ps.id INTO v_stage_id
      FROM public.pipeline_stages ps
      WHERE ps.pipeline_id = v_pipe.id
        AND ps.stage_key = NEW.stage_key
        AND ps.is_active = true
      LIMIT 1;
    END IF;

    IF v_stage_id IS NOT NULL THEN
      FOR r IN
        SELECT id, whatsapp_instance_id
        FROM public.pipe_dispatch_rules
        WHERE organization_id = v_org_id
          AND is_active = true
          AND trigger_type = 'lead_moved_to_stage'
          AND pipeline_stage_id = v_stage_id
          AND pipeline_id = v_pipe.id
      LOOP
        SELECT EXISTS (
          SELECT 1 FROM public.scheduled_pipe_messages
          WHERE pipe_record_id = NEW.id
            AND rule_id = r.id
            AND status IN ('scheduled', 'sent', 'waiting_response')
        ) INTO v_already_exists;

        IF v_already_exists THEN
          CONTINUE;
        END IF;

        IF public.schedule_pipe_rule_steps_from_position(
          v_org_id, v_pipe.slug, r.id, NEW.id, NEW.lead_id,
          r.whatsapp_instance_id, 0
        ) THEN
          v_scheduled_any := true;
        END IF;
      END LOOP;

      IF v_scheduled_any THEN
        BEGIN
          SELECT value INTO v_worker_url FROM public.cron_config WHERE key = 'pipe_rule_dispatch_url';
          SELECT value INTO v_secret_val FROM public.cron_config WHERE key = 'cron_secret';
          IF v_worker_url IS NOT NULL AND v_worker_url != '' THEN
            PERFORM net.http_post(
              url := v_worker_url,
              headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'x-cron-secret', COALESCE(v_secret_val, '')
              ),
              body := jsonb_build_object(
                'pipe_type', v_pipe.slug,
                'pipeline_id', v_pipe.id::text,
                'organization_id', v_org_id::text
              )
            );
          END IF;
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Re-chaveia o evento: escritor que mude só stage_id também dispara.
DROP TRIGGER IF EXISTS trg_pipeline_entries_dispatch ON public.pipeline_entries;
CREATE TRIGGER trg_pipeline_entries_dispatch
  AFTER INSERT OR UPDATE OF stage_key, stage_id ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION public.trigger_pipeline_entries_dispatch();

-- ────────────────────────────────────────────────────────────────────────────
-- §6 · Asserções — a migration se recusa a concluir errada
-- ────────────────────────────────────────────────────────────────────────────

DO $assert$
DECLARE
  v_n bigint;
  v_src text;
  v_tgdef text;
BEGIN
  -- 6.1 Colunas no lugar.
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (table_name, column_name) IN (('pipelines','stage_dispatch_enabled'),
                                           ('pipelines','stage_dispatch_enabled_at'),
                                           ('pipe_dispatch_rules','pipeline_id'),
                                           ('scheduled_pipe_messages','pipeline_id'))) <> 4 THEN
    RAISE EXCEPTION 'SCRUM629: colunas novas ausentes';
  END IF;

  -- 6.2 Backfill de pipelines: todo system ligado com epoch; nenhum custom ligado.
  SELECT count(*) INTO v_n FROM public.pipelines
   WHERE type = 'system' -- metric-lint-allow: asserção one-shot do backfill acima; morre com a migration
     AND (NOT stage_dispatch_enabled OR stage_dispatch_enabled_at IS DISTINCT FROM 'epoch'::timestamptz);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SCRUM629: % funil(is) de sistema sem enabled=true/epoch', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.pipelines
   WHERE type <> 'system' AND stage_dispatch_enabled;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SCRUM629: % funil(is) não-sistema nasceram LIGADOS — D11 exige OFF', v_n;
  END IF;

  -- 6.3 Backfill de regras: nenhuma regra órfã de funil.
  SELECT count(*) INTO v_n FROM public.pipe_dispatch_rules WHERE pipeline_id IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SCRUM629: % regra(s) sem pipeline_id após backfill', v_n;
  END IF;

  -- 6.4 Eco íntegro: pipe_type das regras = slug do funil.
  SELECT count(*) INTO v_n
    FROM public.pipe_dispatch_rules r
    JOIN public.pipelines p ON p.id = r.pipeline_id
   WHERE r.pipe_type IS DISTINCT FROM p.slug;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SCRUM629: % regra(s) com pipe_type divergente do slug (eco quebrado)', v_n;
  END IF;

  -- 6.5 Fila: só fica NULL quem perdeu o card (história).
  SELECT count(*) INTO v_n
    FROM public.scheduled_pipe_messages m
   WHERE m.pipeline_id IS NULL
     AND EXISTS (SELECT 1 FROM public.pipeline_entries pe WHERE pe.id = m.pipe_record_id);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SCRUM629: % item(ns) de fila com card vivo e pipeline_id NULL', v_n;
  END IF;

  -- 6.6 O early-return de custom morreu; o gate D11 vive.
  SELECT p.prosrc INTO v_src FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'trigger_pipeline_entries_dispatch';
  IF v_src LIKE '%pip.type = ''system''%' THEN
    RAISE EXCEPTION 'SCRUM629: early-return de custom ainda vivo no dispatch';
  END IF;
  IF v_src NOT LIKE '%stage_dispatch_enabled%' THEN
    RAISE EXCEPTION 'SCRUM629: gate D11 ausente do dispatch';
  END IF;

  -- 6.7 Evento re-chaveado para stage_id também.
  SELECT pg_get_triggerdef(t.oid) INTO v_tgdef
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'pipeline_entries' AND t.tgname = 'trg_pipeline_entries_dispatch';
  IF v_tgdef NOT LIKE '%stage_id%' THEN
    RAISE EXCEPTION 'SCRUM629: trigger não re-chaveado para stage_id';
  END IF;

  -- 6.8 Claims com gate + variante por funil no ar.
  IF (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'claim_pipe_dispatch_batch')
     NOT LIKE '%stage_dispatch_enabled%' THEN
    RAISE EXCEPTION 'SCRUM629: claim legado sem gate D11';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'claim_pipe_dispatch_batch_by_pipeline') THEN
    RAISE EXCEPTION 'SCRUM629: claim por pipeline ausente';
  END IF;

  -- 6.9 Grants da variante nova: authenticated/anon NÃO executam.
  IF has_function_privilege('authenticated',
       'public.claim_pipe_dispatch_batch_by_pipeline(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.claim_pipe_dispatch_batch_by_pipeline(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SCRUM629: claim_by_pipeline executável por authenticated/anon';
  END IF;

  RAISE NOTICE 'SCRUM629 OK: toggle D11 no ar — system preservado (epoch), custom OFF, fila e regras chaveadas por funil.';
END;
$assert$;
