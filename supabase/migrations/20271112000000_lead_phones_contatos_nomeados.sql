-- 20271112000000_lead_phones_contatos_nomeados.sql
--
-- Chamado 82c50502 (Café Jurerê) — ADR-0039 "Contatos nomeados do lead".
--
-- O lead passa a ter VÁRIOS telefones, cada um com o nome do contato
-- ("José Luiz - Compras"), vindos do ERP Toth e editáveis no CRM. O negócio
-- guarda com qual telefone é (`deals.lead_phone_id`). Mensagem de qualquer
-- telefone do lead cai no lead certo.
--
-- Ordem dos Chamados (CTO 08/10): 93027ffb → ESTE → 793f4b05 (que rebaseia
-- sobre a assinatura nova de `abrir_negocio`).
--
-- Regras de casa seguidas aqui:
--   - RLS por `get_my_organization_ids()` (plural), nunca a singular;
--   - nada de UPDATE em massa em `leads` (21+ gatilhos, webhook por linha): o
--     backfill escreve SÓ em `lead_phones`;
--   - `resolve_message_lead_id` roda em TODA mensagem de TODAS as orgs: as três
--     passadas vigentes (pg_get_functiondef de prod, 08/10) ficam intactas; a
--     quarta só roda quando as três não acharam ninguém;
--   - `abrir_negocio`/`api_create_deal` ganham parâmetro novo: a assinatura
--     antiga é DROPADA aqui e o GRANT reafirmado idêntico — sobrecarga faria o
--     PostgREST escolher a errada.
--
-- Ordem: tabela → backfill → gatilhos → RPCs. O backfill vem ANTES do gatilho
-- de adoção de órfãs: os 66 mil principais já adotaram pelo gatilho de leads.

-- ============================================================================
-- 1. Tabela
-- ============================================================================
CREATE TABLE public.lead_phones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id          uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  -- Nome do contato como foi escrito ("José Luiz - Compras"). NULL = sem nome.
  label            text NULL CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 120),
  -- true quando alguém nomeou no CRM: o sync do ERP não mexe mais no nome.
  label_locked     boolean NOT NULL DEFAULT false,
  phone            text NOT NULL CHECK (length(btrim(phone)) > 0),
  normalized_phone text NULL,
  phone_digits     text GENERATED ALWAYS AS (regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')) STORED,
  is_primary       boolean NOT NULL DEFAULT false,
  is_whatsapp      boolean NULL,
  source           text NOT NULL CHECK (source IN ('crm', 'erp')),
  -- Toth `telefones[].idContato`: id da LINHA de telefone, não da pessoa.
  erp_phone_id     text NULL,
  created_by       uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz NULL,
  deleted_by       uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Telefone apagado não pode continuar principal.
  CONSTRAINT lead_phones_primary_ativo CHECK (NOT (is_primary AND deleted_at IS NOT NULL))
);

COMMENT ON TABLE public.lead_phones IS
  'Telefones do lead, cada um com o nome do contato (Chamado 82c50502, ADR-0039). '
  'leads.phone continua sendo o principal; esta tabela espelha o principal e guarda os demais. '
  'O ERP sugere, o CRM manda: o sync nunca desfaz nome travado nem ressuscita telefone apagado.';
COMMENT ON COLUMN public.lead_phones.erp_phone_id IS
  'Id da LINHA de telefone no ERP (Toth telefones[].idContato). Chave do sync; nunca agrupa pessoa.';

-- Um número por lead (entre os ativos).
CREATE UNIQUE INDEX lead_phones_lead_numero_uq
  ON public.lead_phones (lead_id, normalized_phone)
  WHERE deleted_at IS NULL AND normalized_phone IS NOT NULL;
-- Um principal por lead.
CREATE UNIQUE INDEX lead_phones_lead_principal_uq
  ON public.lead_phones (lead_id)
  WHERE is_primary AND deleted_at IS NULL;
-- Inclui as apagadas de propósito: o que o usuário apagou não volta pelo sync.
CREATE UNIQUE INDEX lead_phones_lead_erp_id_uq
  ON public.lead_phones (lead_id, erp_phone_id)
  WHERE erp_phone_id IS NOT NULL;
-- SEM unique por org: o mesmo número existe em dois clientes no ERP.
CREATE INDEX lead_phones_org_normalized_idx
  ON public.lead_phones (organization_id, normalized_phone)
  WHERE deleted_at IS NULL;
CREATE INDEX lead_phones_org_digits_idx
  ON public.lead_phones (organization_id, phone_digits)
  WHERE deleted_at IS NULL;
-- 4ª passada do webhook (variação do 9º dígito), sem varrer a org.
CREATE INDEX lead_phones_org_br_mobile_idx
  ON public.lead_phones (organization_id, public.normalize_br_mobile(phone_digits))
  WHERE deleted_at IS NULL AND length(phone_digits) >= 10;

-- ============================================================================
-- 2. Gatilhos da própria tabela
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tg_lead_phones_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  NEW.phone := btrim(NEW.phone);
  NEW.normalized_phone := public.normalize_brazilian_phone(NEW.phone);
  NEW.label := NULLIF(btrim(COALESCE(NEW.label, '')), '');
  RETURN NEW;
END;
$function$;

CREATE TRIGGER lead_phones_normalize
  BEFORE INSERT OR UPDATE OF phone, label ON public.lead_phones
  FOR EACH ROW EXECUTE FUNCTION public.tg_lead_phones_normalize();

-- A org vem do LEAD. Quem tenta gravar outra org recebe erro, não correção
-- silenciosa: divergência aqui é bug ou tentativa de cruzar inquilino.
CREATE OR REPLACE FUNCTION public.tg_lead_phones_org_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
BEGIN
  SELECT l.organization_id INTO v_org FROM public.leads l WHERE l.id = NEW.lead_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := v_org;
  ELSIF NEW.organization_id <> v_org THEN
    RAISE EXCEPTION 'lead_phones_org_mismatch' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_lead_phones_org_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER lead_phones_org_guard
  BEFORE INSERT OR UPDATE OF lead_id, organization_id ON public.lead_phones
  FOR EACH ROW EXECUTE FUNCTION public.tg_lead_phones_org_guard();

CREATE TRIGGER lead_phones_updated_at
  BEFORE UPDATE ON public.lead_phones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 3. RLS e GRANTs
-- ============================================================================
ALTER TABLE public.lead_phones ENABLE ROW LEVEL SECURITY;

-- A visibilidade é a do LEAD: o EXISTS passa pela RLS de leads, então quem não
-- vê o lead não vê os telefones (e N donos, Chamado 793f4b05, vale aqui sem
-- mudança).
CREATE POLICY lead_phones_select ON public.lead_phones
  FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_phones.lead_id)
  );

CREATE POLICY lead_phones_select_master ON public.lead_phones
  FOR SELECT TO authenticated
  USING (public.is_master_user());

-- Pelo cliente só nasce telefone do CRM. Linha do ERP nasce pelo sync
-- (service_role) ou pelo espelho do principal (gatilho DEFINER).
CREATE POLICY lead_phones_insert ON public.lead_phones
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND source = 'crm'
    AND erp_phone_id IS NULL
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_phones.lead_id)
  );

CREATE POLICY lead_phones_update ON public.lead_phones
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_phones.lead_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_phones.lead_id)
  );
-- Sem policy de DELETE: apagar é soft delete (deleted_at).

REVOKE ALL ON TABLE public.lead_phones FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.lead_phones TO authenticated;
GRANT INSERT (organization_id, lead_id, label, label_locked, phone, is_primary, is_whatsapp, source, created_by)
  ON TABLE public.lead_phones TO authenticated;
-- `source` e `erp_phone_id` não são editáveis pelo cliente.
GRANT UPDATE (label, label_locked, phone, is_primary, is_whatsapp, deleted_at, deleted_by)
  ON TABLE public.lead_phones TO authenticated;
GRANT ALL ON TABLE public.lead_phones TO service_role;

-- ============================================================================
-- 4. Backfill — 1 linha principal por lead ativo com telefone (~66 mil).
--    Escreve SÓ em lead_phones. Os gatilhos de lead_phones ainda não incluem
--    a adoção de órfãs (criada abaixo), então nada mais é tocado.
-- ============================================================================
INSERT INTO public.lead_phones (organization_id, lead_id, phone, is_primary, source)
SELECT l.organization_id, l.id, btrim(l.phone), true, 'crm'
  FROM public.leads l
 WHERE l.deleted_at IS NULL
   -- 13 leads legados (jan–mar/2026) não têm org; o guard de org recusaria.
   AND l.organization_id IS NOT NULL
   AND l.phone IS NOT NULL
   AND public.normalize_brazilian_phone(l.phone) IS NOT NULL
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 5. Espelho do principal (mão única: leads.phone → lead_phones)
-- ============================================================================
-- Trocar o principal = UPDATE leads.phone (a RPC salvar_telefones_do_lead faz
-- isso). O número antigo continua no lead como telefone secundário — trocar o
-- principal não apaga o contato.
CREATE OR REPLACE FUNCTION public.tg_leads_espelha_telefone_principal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_norm   text;
  v_row_id uuid;
  v_source text := COALESCE(NULLIF(current_setting('app.lead_phone_source', true), ''), 'crm');
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  -- Lead sem org (legado) não tem onde morar o telefone; o guard de org
  -- recusaria e derrubaria o INSERT/UPDATE do próprio lead.
  IF NEW.organization_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.phone IS NOT DISTINCT FROM OLD.phone THEN RETURN NEW; END IF;
  IF v_source NOT IN ('crm', 'erp') THEN v_source := 'crm'; END IF;

  v_norm := public.normalize_brazilian_phone(NEW.phone);

  IF v_norm IS NULL THEN
    -- Principal apagado: o lead fica sem principal; os contatos continuam.
    UPDATE public.lead_phones SET is_primary = false
     WHERE lead_id = NEW.id AND is_primary AND deleted_at IS NULL;
    RETURN NEW;
  END IF;

  SELECT id INTO v_row_id FROM public.lead_phones
   WHERE lead_id = NEW.id AND normalized_phone = v_norm AND deleted_at IS NULL;

  -- Idempotente: já é o principal → nada a fazer.
  IF v_row_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.lead_phones WHERE id = v_row_id AND is_primary) THEN
    RETURN NEW;
  END IF;

  UPDATE public.lead_phones SET is_primary = false
   WHERE lead_id = NEW.id AND is_primary AND deleted_at IS NULL;

  IF v_row_id IS NOT NULL THEN
    UPDATE public.lead_phones SET is_primary = true WHERE id = v_row_id;
  ELSE
    INSERT INTO public.lead_phones (organization_id, lead_id, phone, is_primary, source, created_by)
    VALUES (NEW.organization_id, NEW.id, btrim(NEW.phone), true, v_source, auth.uid());
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_leads_espelha_telefone_principal() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_leads_espelha_telefone_principal
  AFTER INSERT OR UPDATE OF phone ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_leads_espelha_telefone_principal();

-- ============================================================================
-- 6. Adoção de mensagens órfãs pelo telefone novo
--    Espelho de tg_leads_adopt_orphan_messages (prod, 08/10).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tg_lead_phones_adopt_orphan_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.normalized_phone IS NULL OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads l
                  WHERE l.id = NEW.lead_id AND l.deleted_at IS NULL) THEN
    RETURN NEW;
  END IF;
  UPDATE public.whatsapp_messages m SET lead_id = NEW.lead_id
   WHERE m.lead_id IS NULL AND m.organization_id = NEW.organization_id
     AND m.normalized_phone = NEW.normalized_phone;
  UPDATE public.whatsapp_conversation_summary s SET lead_id = NEW.lead_id, updated_at = now()
   WHERE s.lead_id IS NULL AND s.organization_id = NEW.organization_id
     AND s.normalized_phone = NEW.normalized_phone;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_lead_phones_adopt_orphan_messages() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_lead_phones_adopt_orphan_messages
  AFTER INSERT ON public.lead_phones
  FOR EACH ROW EXECUTE FUNCTION public.tg_lead_phones_adopt_orphan_messages();

-- ============================================================================
-- 7. deals.lead_phone_id
-- ============================================================================
-- ON DELETE SET NULL (e não RESTRICT): lead_phones some em CASCADE quando o
-- lead é purgado da lixeira ou a org é apagada; RESTRICT travaria a purga.
-- O apagar do dia a dia é soft delete e não passa por aqui.
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS lead_phone_id uuid NULL
    REFERENCES public.lead_phones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS deals_lead_phone_id_idx
  ON public.deals (lead_phone_id) WHERE lead_phone_id IS NOT NULL;
COMMENT ON COLUMN public.deals.lead_phone_id IS
  'Com qual telefone (contato) do lead é este negócio. Obrigatório ao abrir pela UI quando o lead tem 2+ telefones (Chamado 82c50502).';

-- Validação comum às portas: telefone ATIVO do MESMO lead. INVOKER de
-- propósito: chamada de abrir_negocio (invoker) passa pela RLS de lead_phones;
-- chamada de api_create_deal (DEFINER) já recortou a org antes.
CREATE OR REPLACE FUNCTION public.fn_telefone_do_lead_valido(p_lead_id uuid, p_lead_phone_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.lead_phones lp
     WHERE lp.id = p_lead_phone_id AND lp.lead_id = p_lead_id AND lp.deleted_at IS NULL)
$function$;
REVOKE ALL ON FUNCTION public.fn_telefone_do_lead_valido(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_telefone_do_lead_valido(uuid, uuid) TO authenticated, service_role;

-- ============================================================================
-- 8. resolve_message_lead_id — 3 passadas vigentes + 4ª em lead_phones
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resolve_message_lead_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Exact match on full digits
  SELECT l.id INTO resolved_id
  FROM leads l
  WHERE l.organization_id = NEW.organization_id
    AND l.phone_digits = digits
    AND l.phone_digits != ''
  LIMIT 1;

  -- BR mobile normalization match (handles 9th digit differences)
  IF resolved_id IS NULL AND length(digits) >= 10 THEN
    normalized := normalize_br_mobile(digits);
    SELECT l.id INTO resolved_id
    FROM leads l
    WHERE l.organization_id = NEW.organization_id
      AND l.phone_digits != ''
      AND length(l.phone_digits) >= 10
      AND normalize_br_mobile(l.phone_digits) = normalized
    LIMIT 1;
  END IF;

  -- Suffix match: last 11 digits (fallback for international numbers)
  IF resolved_id IS NULL AND length(digits) >= 10 THEN
    SELECT l.id INTO resolved_id
    FROM leads l
    WHERE l.organization_id = NEW.organization_id
      AND l.phone_digits != ''
      AND length(l.phone_digits) >= 10
      AND right(l.phone_digits, 11) = right(digits, 11)
    LIMIT 1;
  END IF;

  -- 4ª passada (Chamado 82c50502): telefones secundários do lead.
  -- Mesmo número em mais de um lead: vence o que tem negócio aberto com ESTE
  -- telefone; depois o telefone atualizado por último; id desempata.
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
$function$;

-- ============================================================================
-- 9. abrir_negocio — + p_lead_phone_id. DROP da assinatura vigente (9 args,
--    20271004000000) e re-GRANT idêntico ao de prod (authenticated, service_role).
-- ============================================================================
DROP FUNCTION IF EXISTS public.abrir_negocio(uuid, text, text, uuid, numeric, timestamp with time zone, text, text, text);

CREATE FUNCTION public.abrir_negocio(p_lead_id uuid, p_pipe text, p_stage text, p_owner_id uuid DEFAULT NULL::uuid, p_value numeric DEFAULT NULL::numeric, p_meeting_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notes text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_lead_phone_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_org        uuid;
  v_tz         text;
  v_deal_id    uuid;
  v_entry_id   uuid := gen_random_uuid();
  v_title      text;
  v_pip        public.pipelines%ROWTYPE;
  v_stage_txt  text := NULLIF(btrim(COALESCE(p_stage, '')), '');
  v_stage_id   uuid;
  v_notes      text := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_phone_id   uuid := p_lead_phone_id;
  v_phones     integer;
BEGIN
  -- A org vem do LEAD, nunca de parâmetro. Com RLS de invoker, um lead de outra
  -- organização simplesmente não é visível e a função aborta aqui — o chamador
  -- não consegue escolher em qual org escreve.
  SELECT l.organization_id INTO v_org
    FROM public.leads l
   WHERE l.id = p_lead_id AND l.deleted_at IS NULL;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Lead % não encontrado (ou está na lixeira).', p_lead_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- O CHECK da coluna também recusa, mas a mensagem dele fala de constraint.
  -- Esta diz o que fazer, e é a que o integrador lê.
  IF p_source IS NOT NULL
     AND p_source NOT IN ('human','workflow','api','import','backfill') THEN
    RAISE EXCEPTION 'Procedência inválida: %. Válidas: human, workflow, api, import, backfill.', p_source
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Com quem é o negócio (Chamado 82c50502). Informado → tem de ser telefone
  -- ativo DESTE lead. Omitido por um humano num lead com 2+ telefones → recusa:
  -- chutar o principal é como o vendedor acaba falando com a pessoa errada.
  -- Com 1 telefone, é esse. Workflow/API/import seguem sem exigir.
  IF v_phone_id IS NOT NULL THEN
    IF NOT public.fn_telefone_do_lead_valido(p_lead_id, v_phone_id) THEN
      RAISE EXCEPTION 'lead_phone_invalid' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT count(*) INTO v_phones FROM public.lead_phones lp
     WHERE lp.lead_id = p_lead_id AND lp.deleted_at IS NULL;
    IF v_phones >= 2 AND p_source = 'human' THEN
      RAISE EXCEPTION 'lead_phone_required' USING ERRCODE = 'check_violation';
    ELSIF v_phones = 1 THEN
      SELECT lp.id INTO v_phone_id FROM public.lead_phones lp
       WHERE lp.lead_id = p_lead_id AND lp.deleted_at IS NULL;
    END IF;
  END IF;

  -- Qualquer funil, por id/slug/alias — erra alto antes de escrever qualquer
  -- coisa. 'upsell' segue sem porta aqui: não existe linha em `pipelines` com
  -- esse slug (carteira entra por regra própria, ADR-0023 decisão 8), então o
  -- resolvedor recusa com "não existe" — mesmo destino do ELSE antigo.
  v_pip := public.fn_resolver_funil(v_org, p_pipe);

  SELECT o.timezone INTO v_tz FROM public.organizations o WHERE o.id = v_org;

  -- Dono de outra org é recusado aqui, e não só pela trava do M6: a mensagem
  -- daqui diz o que aconteceu, a do gatilho diz que uma constraint falhou.
  IF p_owner_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.team_members m
                      WHERE m.id = p_owner_id AND m.organization_id = v_org) THEN
    RAISE EXCEPTION 'Responsável % não pertence à organização deste lead.', p_owner_id
      USING ERRCODE = 'check_violation';
  END IF;

  v_title := COALESCE(
    NULLIF(btrim(COALESCE(p_title, '')), ''),
    public.fn_negocio_titulo_padrao(now(), v_tz)
  );

  INSERT INTO public.deals (organization_id, title, source_lead_id, owner_id, value, notes, created_by, source, lead_phone_id)
  VALUES (v_org, v_title, p_lead_id, p_owner_id, p_value, v_notes, auth.uid(), p_source, v_phone_id)
  RETURNING id INTO v_deal_id;

  IF v_pip.type = 'custom' THEN
    -- Etapa por stage_key OU uuid. O catálogo (`api_list_pipelines`) publica os
    -- dois; antes só o uuid era aceito e stage_key quebrava com "invalid input
    -- syntax for type uuid" — erro de encanamento no lugar de erro de domínio.
    IF v_stage_txt IS NULL THEN
      RAISE EXCEPTION 'Etapa é obrigatória para abrir Negócio em funil personalizado.'
        USING ERRCODE = 'invalid_parameter_value';
    ELSIF v_stage_txt ~ v_uuid_re THEN
      v_stage_id := v_stage_txt::uuid;  -- pertencimento ao funil é validado pela função compartilhada
    ELSE
      SELECT ps.id INTO v_stage_id
        FROM public.pipeline_stages ps
       WHERE ps.organization_id = v_org
         AND ps.pipeline_id = v_pip.id
         AND ps.stage_key = v_stage_txt;
      IF v_stage_id IS NULL THEN
        RAISE EXCEPTION 'Etapa "%" não existe no funil %.', v_stage_txt, v_pip.id
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
    END IF;

    -- Caminho único pós-674: a função compartilhada escreve em pipeline_entries,
    -- valida funil/etapa/tenancy e já liga o card ao negócio.
    PERFORM public.fn_entrada_custom_criar(
      p_organization_id => v_org,
      p_pipeline_id     => v_pip.id,
      p_lead_id         => p_lead_id,
      p_stage_id        => v_stage_id,
      p_assigned_to     => p_owner_id,
      p_deal_id         => v_deal_id,
      p_notes           => v_notes,
      p_id              => v_entry_id);

  ELSIF v_pip.slug = 'whatsapp' THEN
    PERFORM public.fn_entrada_sistema_criar(
      p_organization_id => v_org,
      p_slug            => 'whatsapp',
      p_lead_id         => p_lead_id,
      p_stage_key       => COALESCE(v_stage_txt, 'novo_lead'),
      p_assigned_to     => p_owner_id,
      p_metadata        => jsonb_build_object(
        'responsible_id', p_owner_id,
        'sdr_id',         p_owner_id,
        'scheduled_date', NULL::timestamptz),
      p_notes           => v_notes,
      p_id              => v_entry_id);

  ELSIF v_pip.slug = 'confirmacao' THEN
    PERFORM public.fn_entrada_sistema_criar(
      p_organization_id => v_org,
      p_slug            => 'confirmacao',
      p_lead_id         => p_lead_id,
      p_stage_key       => COALESCE(v_stage_txt, 'marcada'),
      p_assigned_to     => p_owner_id,
      p_metadata        => jsonb_build_object(
        'meeting_date',      p_meeting_date,
        'is_confirmed',      false,
        'closer_id',         NULL::uuid,
        'responsible_id',    p_owner_id,
        'sdr_id',            p_owner_id,
        'meet_link',         NULL::text,
        'metrics_period_at', NULL::timestamptz),
      p_notes           => v_notes,
      p_id              => v_entry_id);

  ELSIF v_pip.slug = 'propostas' THEN
    PERFORM public.fn_entrada_sistema_criar(
      p_organization_id => v_org,
      p_slug            => 'propostas',
      p_lead_id         => p_lead_id,
      p_stage_key       => COALESCE(v_stage_txt, 'enviada'),
      p_assigned_to     => p_owner_id,
      p_metadata        => jsonb_build_object(
        'sale_value',        p_value,
        'closer_id',         p_owner_id,
        'responsible_id',    p_owner_id,
        'product_id',        NULL::uuid,
        'product_type',      NULL::text,
        'calor',             NULL::integer,
        'loss_reason',       NULL::text,
        'loss_reason_id',    NULL::uuid,
        'commitment_date',   NULL::date,
        'contract_duration', NULL::integer,
        'metrics_period_at', NULL::timestamptz),
      p_notes           => v_notes,
      p_id              => v_entry_id);

  ELSE
    -- Funil de sistema com slug sem porta própria (não existe em prod hoje —
    -- medido 2026-09-02: só whatsapp/confirmacao/propostas). Erra alto em vez
    -- de inventar um caminho.
    RAISE EXCEPTION 'Funil % não abre negócio por esta porta.', v_pip.slug
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Liga a posição à identidade. A função de sistema não recebe `deal_id`;
  -- a função custom já criou o card ligado.
  IF v_pip.type <> 'custom' THEN
    UPDATE public.pipeline_entries SET deal_id = v_deal_id WHERE id = v_entry_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Card criado mas não encontrado para ligar ao negócio (entry %). Transação desfeita para não deixar negócio sem posição.', v_entry_id
        USING ERRCODE = 'internal_error';
    END IF;
  END IF;

  RETURN v_deal_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.abrir_negocio(uuid, text, text, uuid, numeric, timestamp with time zone, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_negocio(uuid, text, text, uuid, numeric, timestamp with time zone, text, text, text, uuid) TO authenticated, service_role;

-- ============================================================================
-- 10. api_create_deal — + p_lead_phone_id (opcional, valida posse, não exige).
--     DROP da assinatura vigente (10 args, 20271021000009); GRANT só service_role.
-- ============================================================================
DROP FUNCTION IF EXISTS public.api_create_deal(uuid, uuid, text, text, uuid, numeric, text, text, text, text);

CREATE FUNCTION public.api_create_deal(
  p_org             uuid,
  p_lead_id         uuid,
  p_pipe            text,
  p_stage           text,
  p_owner_id        uuid    DEFAULT NULL,
  p_value           numeric DEFAULT NULL,
  p_title           text    DEFAULT NULL,
  p_notes           text    DEFAULT NULL,
  p_source          text    DEFAULT 'api',
  p_idempotency_key text    DEFAULT NULL,
  p_lead_phone_id   uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_endpoint constant text := 'POST /deals';
  v_lead_org uuid;
  v_existente uuid;
  v_hash text; v_saved_hash text;
  v_deal_id  uuid;
  v_aberto   record;
  v_row      public.deals%ROWTYPE;
  v_aviso    jsonb := NULL;
  v_pip      public.pipelines%ROWTYPE;
  v_payload  jsonb;
BEGIN
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'organization_id é obrigatório';
  END IF;

  -- ── Recorte por inquilino, ANTES de qualquer coisa ────────────────────────
  -- A função roda como DEFINER e é chamada por service_role: RLS não protege
  -- este caminho. Se o Lead não é desta organização, a chave não pode alcançá-lo.
  SELECT l.organization_id INTO v_lead_org
    FROM public.leads l
   WHERE l.id = p_lead_id AND l.deleted_at IS NULL;

  IF v_lead_org IS NULL OR v_lead_org <> p_org THEN
    RAISE EXCEPTION 'Lead % não encontrado nesta organização.', p_lead_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Telefone de outro lead (ou de outra org) é recusado antes de qualquer
  -- escrita — inclusive antes do replay.
  IF p_lead_phone_id IS NOT NULL
     AND NOT public.fn_telefone_do_lead_valido(p_lead_id, p_lead_phone_id) THEN
    RAISE EXCEPTION 'lead_phone_invalid' USING ERRCODE = 'check_violation';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    IF length(btrim(p_idempotency_key)) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'invalid_idempotency_key' USING ERRCODE = '22023';
    END IF;
    -- O telefone só entra no hash quando vem: assim as chaves gravadas antes
    -- desta migration continuam batendo no replay do mesmo corpo.
    v_payload := jsonb_build_array(p_lead_id,p_pipe,p_stage,p_owner_id,
      trim_scale(p_value),p_title,p_notes,p_source);
    IF p_lead_phone_id IS NOT NULL THEN
      v_payload := v_payload || jsonb_build_array(p_lead_phone_id);
    END IF;
    v_hash := encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
    -- Serializa a transação inteira antes da leitura, inclusive quando a chave ainda não existe.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || v_endpoint || ':' || p_idempotency_key, 0));
  END IF;

  -- ── Replay ────────────────────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT k.resource_id, k.request_hash INTO v_existente, v_saved_hash
      FROM public.api_idempotency_keys k
     WHERE k.organization_id = p_org
       AND k.endpoint = v_endpoint
       AND k.idempotency_key = p_idempotency_key;

    IF v_saved_hash IS NOT NULL AND v_saved_hash <> v_hash THEN
      RAISE EXCEPTION 'idempotency_key_conflict' USING ERRCODE = '23505';
    END IF;
    IF v_existente IS NOT NULL THEN
      SELECT * INTO v_row FROM public.deals WHERE id = v_existente AND organization_id = p_org AND source_lead_id = p_lead_id AND deleted_at IS NULL;
      IF FOUND THEN
        RETURN jsonb_build_object(
          'status', 'replayed',
          'deal', jsonb_build_object('id', v_row.id, 'title', v_row.title,
                                     'value', v_row.value, 'source', v_row.source));
      END IF;
      RAISE EXCEPTION 'idempotent_resource_unavailable' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Erra alto DEPOIS do replay (retry idempotente devolve o Negócio mesmo se o
  -- funil sumiu no meio-tempo — comportamento herdado) e ANTES do aviso e da
  -- abertura: funil inexistente não abre nada nem conta aviso.
  v_pip := public.fn_resolver_funil(p_org, p_pipe);

  -- ── O aviso, medido ANTES de abrir ────────────────────────────────────────
  SELECT d.id, pe.stage_key INTO v_aberto
    FROM public.deals d
    JOIN public.pipeline_entries pe ON pe.deal_id = d.id
   WHERE d.source_lead_id = p_lead_id
     AND d.organization_id = p_org
     AND d.closed_at IS NULL
     AND d.deleted_at IS NULL
     AND pe.pipeline_id = v_pip.id
   LIMIT 1;

  IF FOUND THEN
    v_aviso := jsonb_build_object(
      'code', 'lead_has_open_deal_in_pipeline',
      'open_deal_id', v_aberto.id,
      'stage', v_aberto.stage_key);
  END IF;

  -- ── Delega para a porta única ─────────────────────────────────────────────
  -- p_source = 'api' (fixo na rota): abrir_negocio não EXIGE telefone fora do
  -- humano; com 1 telefone no lead, grava esse.
  v_deal_id := public.abrir_negocio(
    p_lead_id, p_pipe, p_stage, p_owner_id, p_value, NULL, p_notes, p_title, p_source, p_lead_phone_id);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.api_idempotency_keys (organization_id, endpoint, idempotency_key, resource_id, request_hash)
    VALUES (p_org, v_endpoint, p_idempotency_key, v_deal_id, v_hash)
    ;
  END IF;

  SELECT * INTO v_row FROM public.deals WHERE id = v_deal_id;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'status', 'created',
    'deal', jsonb_build_object('id', v_row.id, 'title', v_row.title,
                               'value', v_row.value, 'source', v_row.source,
                               'lead_phone_id', v_row.lead_phone_id),
    'warning', v_aviso));
END;
$$;

REVOKE ALL ON FUNCTION public.api_create_deal(uuid,uuid,text,text,uuid,numeric,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_create_deal(uuid,uuid,text,text,uuid,numeric,text,text,text,text,uuid) TO service_role;

-- ============================================================================
-- 11. garantir_negocio_da_entrada — mesma assinatura; grava o telefone só
--     quando o lead tem exatamente 1.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.garantir_negocio_da_entrada(p_entry_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_entry public.pipeline_entries%ROWTYPE;
  v_deal_id uuid; v_titulo text; v_valor numeric;
  v_phone_id uuid;
BEGIN
  SELECT * INTO v_entry FROM public.pipeline_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entrada % não existe', p_entry_id USING ERRCODE = '22023';
  END IF;

  -- A checagem que faltava. Vem DEPOIS do SELECT porque a org é da entrada, e
  -- ANTES de qualquer escrita. `assert_org_access` libera service_role e
  -- master, que é como os chamadores de servidor continuam passando.
  PERFORM public.assert_org_access(v_entry.organization_id);

  IF v_entry.deal_id IS NOT NULL THEN
    RETURN v_entry.deal_id;
  END IF;

  SELECT COALESCE(NULLIF(l.name, ''), 'Negócio sem título') INTO v_titulo
    FROM public.leads l WHERE l.id = v_entry.lead_id;

  BEGIN
    v_valor := NULLIF(v_entry.metadata->>'sale_value', '')::numeric;
  EXCEPTION WHEN OTHERS THEN v_valor := NULL;
  END;

  -- Exatamente 1 telefone ativo: é com ele. 2+: fica NULL e a UI pede a escolha.
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(lp.id))[1] END INTO v_phone_id
    FROM public.lead_phones lp
   WHERE lp.lead_id = v_entry.lead_id AND lp.deleted_at IS NULL;

  INSERT INTO public.deals (organization_id, title, value, source_lead_id, owner_id, source, lead_phone_id)
  VALUES (v_entry.organization_id, COALESCE(v_titulo, 'Negócio'), v_valor,
          v_entry.lead_id, v_entry.assigned_to, 'entrada_materializada', v_phone_id)
  RETURNING id INTO v_deal_id;

  UPDATE public.pipeline_entries SET deal_id = v_deal_id WHERE id = p_entry_id;
  RETURN v_deal_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.garantir_negocio_da_entrada(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.garantir_negocio_da_entrada(uuid) TO authenticated, service_role;

-- ============================================================================
-- 12. definir_telefone_do_negocio — escolher/trocar o contato do negócio
-- ============================================================================
CREATE OR REPLACE FUNCTION public.definir_telefone_do_negocio(p_deal_id uuid, p_lead_phone_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead uuid;
BEGIN
  -- RLS de deals decide se o usuário enxerga (e altera) o negócio.
  SELECT d.source_lead_id INTO v_lead
    FROM public.deals d WHERE d.id = p_deal_id AND d.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deal_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_lead_phone_id IS NOT NULL AND (v_lead IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.lead_phones lp
        WHERE lp.id = p_lead_phone_id AND lp.lead_id = v_lead AND lp.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'lead_phone_invalid' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.deals SET lead_phone_id = p_lead_phone_id WHERE id = p_deal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deal_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN p_lead_phone_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.definir_telefone_do_negocio(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.definir_telefone_do_negocio(uuid, uuid) TO authenticated, service_role;

-- ============================================================================
-- 13. salvar_telefones_do_lead — o editor de contatos da ficha
-- ============================================================================
-- p_phones: [{ "id"?: uuid, "phone": text, "label"?: text, "is_primary"?: bool }]
-- É a lista COMPLETA: o que não vier é apagado (soft delete). SECURITY INVOKER:
-- quem não pode editar o lead não passa pela RLS de leads/lead_phones.
CREATE OR REPLACE FUNCTION public.salvar_telefones_do_lead(p_lead_id uuid, p_phones jsonb)
RETURNS SETOF public.lead_phones
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org        uuid;
  v_lead_phone text;
  v_item       jsonb;
  v_norm       text;
  v_label      text;
  v_row        public.lead_phones%ROWTYPE;
  v_keep       uuid[] := '{}';
  v_norms      text[] := '{}';
  v_primary    text;
  v_primaries  integer := 0;
  v_tinha      integer;
BEGIN
  IF p_phones IS NULL OR jsonb_typeof(p_phones) <> 'array' THEN
    RAISE EXCEPTION 'phones_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT l.organization_id, l.phone INTO v_org, v_lead_phone
    FROM public.leads l WHERE l.id = p_lead_id AND l.deleted_at IS NULL;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT count(*) INTO v_tinha FROM public.lead_phones
   WHERE lead_id = p_lead_id AND deleted_at IS NULL;

  -- Validação inteira ANTES de escrever.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_phones) LOOP
    v_norm := public.normalize_brazilian_phone(v_item->>'phone');
    IF v_norm IS NULL OR length(v_norm) < 10 THEN
      RAISE EXCEPTION 'phone_invalid' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF v_norm = ANY (v_norms) THEN
      RAISE EXCEPTION 'phone_duplicated' USING ERRCODE = 'unique_violation';
    END IF;
    v_norms := v_norms || v_norm;
    IF COALESCE((v_item->>'is_primary')::boolean, false) THEN
      v_primaries := v_primaries + 1;
      v_primary := btrim(v_item->>'phone');
    END IF;
  END LOOP;
  IF v_primaries > 1 THEN
    RAISE EXCEPTION 'primary_duplicated' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_primaries = 0 AND jsonb_array_length(p_phones) > 0 THEN
    RAISE EXCEPTION 'primary_required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_phones) LOOP
    v_norm  := public.normalize_brazilian_phone(v_item->>'phone');
    v_label := NULLIF(btrim(COALESCE(v_item->>'label', '')), '');
    v_row   := NULL;

    IF v_item ? 'id' AND NULLIF(v_item->>'id', '') IS NOT NULL THEN
      SELECT * INTO v_row FROM public.lead_phones
       WHERE id = (v_item->>'id')::uuid AND lead_id = p_lead_id AND deleted_at IS NULL;
      IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'lead_phone_invalid' USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      SELECT * INTO v_row FROM public.lead_phones
       WHERE lead_id = p_lead_id AND normalized_phone = v_norm AND deleted_at IS NULL;
    END IF;

    IF v_row.id IS NOT NULL THEN
      UPDATE public.lead_phones SET
        phone        = CASE WHEN normalized_phone IS DISTINCT FROM v_norm
                            THEN btrim(v_item->>'phone') ELSE phone END,
        label        = v_label,
        -- Nome alterado pelo usuário: o ERP não mexe mais.
        label_locked = label_locked OR (label IS DISTINCT FROM v_label)
       WHERE id = v_row.id;
      v_keep := v_keep || v_row.id;
    ELSE
      -- Telefone novo no CRM tem nome — é ele que diz com quem se fala. Exceção:
      -- o primeiro telefone de um lead que não tinha nenhum (é o do próprio lead).
      IF v_label IS NULL AND v_tinha > 0 THEN
        RAISE EXCEPTION 'label_required' USING ERRCODE = 'invalid_parameter_value';
      END IF;
      INSERT INTO public.lead_phones (organization_id, lead_id, phone, label, label_locked, source, created_by)
      VALUES (v_org, p_lead_id, btrim(v_item->>'phone'), v_label, v_label IS NOT NULL, 'crm', auth.uid())
      RETURNING * INTO v_row;
      v_keep := v_keep || v_row.id;
    END IF;
  END LOOP;

  -- O que saiu da lista é apagado (soft). Principal apagado deixa de ser principal.
  UPDATE public.lead_phones
     SET deleted_at = now(), deleted_by = auth.uid(), is_primary = false
   WHERE lead_id = p_lead_id AND deleted_at IS NULL AND NOT (id = ANY (v_keep));

  -- Principal: o espelho de leads.phone faz o resto. Comparação normalizada para
  -- não regravar leads.phone (21 gatilhos) só por formatação.
  IF v_primary IS NULL THEN
    IF v_lead_phone IS NOT NULL THEN
      UPDATE public.leads SET phone = NULL WHERE id = p_lead_id;
    END IF;
  ELSIF public.normalize_brazilian_phone(v_lead_phone) IS DISTINCT FROM public.normalize_brazilian_phone(v_primary) THEN
    UPDATE public.leads SET phone = v_primary WHERE id = p_lead_id;
  ELSE
    -- Mesmo número: garante a marca sem tocar em leads.
    UPDATE public.lead_phones SET is_primary = false
     WHERE lead_id = p_lead_id AND is_primary AND deleted_at IS NULL
       AND normalized_phone IS DISTINCT FROM public.normalize_brazilian_phone(v_primary);
    UPDATE public.lead_phones SET is_primary = true
     WHERE lead_id = p_lead_id AND deleted_at IS NULL
       AND normalized_phone = public.normalize_brazilian_phone(v_primary) AND NOT is_primary;
  END IF;

  RETURN QUERY SELECT * FROM public.lead_phones
                WHERE lead_id = p_lead_id AND deleted_at IS NULL
                ORDER BY is_primary DESC, label NULLS LAST, created_at;
END;
$function$;
REVOKE ALL ON FUNCTION public.salvar_telefones_do_lead(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_telefones_do_lead(uuid, jsonb) TO authenticated, service_role;

-- ============================================================================
-- 14. nomear_contato_do_telefone — o "Nomear contato" do painel do chat
-- ============================================================================
CREATE OR REPLACE FUNCTION public.nomear_contato_do_telefone(p_lead_id uuid, p_phone text, p_label text)
RETURNS public.lead_phones
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org   uuid;
  v_norm  text := public.normalize_brazilian_phone(p_phone);
  v_label text := NULLIF(btrim(COALESCE(p_label, '')), '');
  v_row   public.lead_phones%ROWTYPE;
BEGIN
  IF v_norm IS NULL OR length(v_norm) < 10 THEN
    RAISE EXCEPTION 'phone_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT l.organization_id INTO v_org
    FROM public.leads l WHERE l.id = p_lead_id AND l.deleted_at IS NULL;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE public.lead_phones SET label = v_label, label_locked = true
   WHERE lead_id = p_lead_id AND normalized_phone = v_norm AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    -- O número da conversa ainda não estava no lead: entra como contato do CRM.
    -- Formato do banco (sem 55), o mesmo de leads.phone.
    INSERT INTO public.lead_phones (organization_id, lead_id, phone, label, label_locked, source, created_by)
    VALUES (v_org, p_lead_id, v_norm, v_label, true, 'crm', auth.uid())
    RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END;
$function$;
REVOKE ALL ON FUNCTION public.nomear_contato_do_telefone(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nomear_contato_do_telefone(uuid, text, text) TO authenticated, service_role;

-- ============================================================================
-- 15. contatos_das_conversas — o nome do contato de UMA página do chat
-- ============================================================================
-- p_pairs: [{ "lead_id": uuid, "phone": text }] — até 500. Uma chamada por
-- página da lista, nunca uma por conversa. INVOKER: a RLS de lead_phones
-- devolve só o que o usuário vê.
CREATE OR REPLACE FUNCTION public.contatos_das_conversas(p_pairs jsonb)
RETURNS TABLE (lead_id uuid, normalized_phone text, label text, lead_phone_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH pares AS (
    SELECT DISTINCT (e->>'lead_id')::uuid AS lead_id,
           public.normalize_brazilian_phone(e->>'phone') AS norm
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(p_pairs) = 'array' THEN p_pairs ELSE '[]'::jsonb END
           ) WITH ORDINALITY AS t(e, n)
     WHERE n <= 500
       AND NULLIF(e->>'lead_id', '') IS NOT NULL
  )
  SELECT lp.lead_id, lp.normalized_phone, lp.label, lp.id
    FROM pares p
    JOIN public.lead_phones lp
      ON lp.lead_id = p.lead_id AND lp.normalized_phone = p.norm AND lp.deleted_at IS NULL
$function$;
REVOKE ALL ON FUNCTION public.contatos_das_conversas(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contatos_das_conversas(jsonb) TO authenticated, service_role;

-- ============================================================================
-- 16. aplicar_telefones_do_erp — a escrita do sync (service_role)
-- ============================================================================
-- Recebe o plano de `planLeadPhoneOps` (edge) e REPETE as guardas: a decisão
-- do TypeScript pode ter envelhecido entre a leitura e a escrita.
--   insert: { op, lead_id, phone, label, erp_phone_id, is_whatsapp }
--   update: { op, lead_id, normalized_phone, label?, erp_phone_id? }
CREATE OR REPLACE FUNCTION public.aplicar_telefones_do_erp(p_organization_id uuid, p_ops jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op       jsonb;
  v_norm     text;
  v_inserted integer := 0;
  v_updated  integer := 0;
  v_n        integer;
BEGIN
  IF p_organization_id IS NULL OR jsonb_typeof(p_ops) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('app.lead_phone_source', 'erp', true);

  FOR v_op IN SELECT * FROM jsonb_array_elements(p_ops) LOOP
    -- Recorte por inquilino: lead de outra org (ou na lixeira) é ignorado.
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.leads l
       WHERE l.id = (v_op->>'lead_id')::uuid
         AND l.organization_id = p_organization_id
         AND l.deleted_at IS NULL);

    IF v_op->>'op' = 'insert' THEN
      v_norm := public.normalize_brazilian_phone(v_op->>'phone');
      CONTINUE WHEN v_norm IS NULL;
      -- Apagado no CRM não volta, nem casado pelo número.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.lead_phones lp
         WHERE lp.lead_id = (v_op->>'lead_id')::uuid
           AND lp.deleted_at IS NOT NULL AND lp.normalized_phone = v_norm);
      INSERT INTO public.lead_phones
        (organization_id, lead_id, phone, label, is_whatsapp, source, erp_phone_id)
      VALUES (p_organization_id, (v_op->>'lead_id')::uuid, v_op->>'phone',
              NULLIF(left(btrim(COALESCE(v_op->>'label', '')), 120), ''),
              (v_op->>'is_whatsapp')::boolean, 'erp',
              NULLIF(v_op->>'erp_phone_id', ''))
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_inserted := v_inserted + v_n;

    ELSIF v_op->>'op' = 'update' THEN
      UPDATE public.lead_phones lp SET
        label = CASE
                  WHEN v_op ? 'label' AND NOT lp.label_locked
                       AND (lp.source = 'erp' OR lp.label IS NULL)
                  THEN NULLIF(left(btrim(COALESCE(v_op->>'label', '')), 120), '')
                  ELSE lp.label END,
        erp_phone_id = CASE
                  WHEN v_op ? 'erp_phone_id' AND lp.erp_phone_id IS NULL
                       AND NOT EXISTS (SELECT 1 FROM public.lead_phones o
                                        WHERE o.lead_id = lp.lead_id
                                          AND o.erp_phone_id = v_op->>'erp_phone_id')
                  THEN v_op->>'erp_phone_id'
                  ELSE lp.erp_phone_id END
       WHERE lp.lead_id = (v_op->>'lead_id')::uuid
         AND lp.normalized_phone = v_op->>'normalized_phone'
         AND lp.deleted_at IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_updated := v_updated + v_n;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
END;
$function$;
REVOKE ALL ON FUNCTION public.aplicar_telefones_do_erp(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_telefones_do_erp(uuid, jsonb) TO service_role;
