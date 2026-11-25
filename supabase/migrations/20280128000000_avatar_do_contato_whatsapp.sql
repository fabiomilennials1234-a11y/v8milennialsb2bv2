-- 20280128000000_avatar_do_contato_whatsapp.sql
--
-- WhatsApp (Uazapi) · foto de perfil do contato nas conversas.
-- ROLLBACK pareado: rollback/20280128000000_avatar_do_contato_whatsapp.sql
--
-- O webhook `messages` da Uazapi já traz `chat.imagePreview`/`chat.image`: a URL
-- (assinada, com prazo `oe=`) da foto do contato no CDN do WhatsApp. Hoje ela é
-- descartada e a conversa mostra só a inicial com gradiente.
--
--  · whatsapp_contact_avatars: UMA foto por (org, telefone normalizado) — a foto
--    é do contato, não da caixa. O webhook só REGISTRA a candidata (zero
--    download no caminho do ack); o cron contact-avatar-sync baixa, valida e
--    grava no bucket privado `contact-avatars`.
--  · Sem SELECT para authenticated/anon na tabela. O front lê por
--    `avatares_das_conversas` (DEFINER, gate de org + caixa legível) e assina a
--    URL no Storage, cuja policy exige a MESMA visibilidade de caixa.
--  · contact_avatar_storage_deletions: fila de arquivos a remover. Linha apagada
--    (órfã, cascade da org) ou foto que sumiu (`none`) enfileira o objeto; o cron
--    drena. O banco não chama o Storage — a fila é o contrato entre os dois.
--  · Telefone NUNCA entra no path do objeto (PII em URL): `<org>/avatars/<id>.jpg`.

-- ── Tabela principal ─────────────────────────────────────────────────────────
CREATE TABLE public.whatsapp_contact_avatars (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  normalized_phone   text NOT NULL CHECK (normalized_phone ~ '^[0-9]{8,15}$'),
  source_instance_id uuid REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL,
  candidate_url      text CHECK (candidate_url IS NULL OR char_length(candidate_url) <= 2048),
  candidate_key      text,
  candidate_seen_at  timestamptz,
  storage_path       text,
  content_sha256     text CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'),
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'ok', 'none', 'error')),
  attempts           smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error         text CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  avatar_updated_at  timestamptz,
  claimed_until      timestamptz,
  -- Recuo de pendente: erro (1 h por tentativa) e adiada (teto/kill switch do
  -- /chat/details). Candidata nova ou renovada pelo webhook zera — fura o recuo.
  retry_after        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_contact_avatars_org_phone_key UNIQUE (organization_id, normalized_phone),
  -- O path é determinístico: nada vindo de fora entra nele.
  CONSTRAINT whatsapp_contact_avatars_path_shape CHECK (
    storage_path IS NULL
    OR storage_path = organization_id::text || '/avatars/' || id::text || '.jpg'
  ),
  CONSTRAINT whatsapp_contact_avatars_ok_has_file CHECK (
    status <> 'ok' OR (storage_path IS NOT NULL AND content_sha256 IS NOT NULL)
  )
);

COMMENT ON TABLE public.whatsapp_contact_avatars IS
  'Foto de perfil do contato WhatsApp (Uazapi) por org+telefone. Escrita só pelo service_role (webhook/cron); leitura do front via avatares_das_conversas.';

-- Fila do cron: pendentes primeiro, nunca-tentadas antes.
CREATE INDEX whatsapp_contact_avatars_pending_idx
  ON public.whatsapp_contact_avatars (avatar_updated_at ASC NULLS FIRST)
  WHERE status = 'pending';
-- Revalidação semanal.
CREATE INDEX whatsapp_contact_avatars_updated_idx
  ON public.whatsapp_contact_avatars (avatar_updated_at);
-- FK ON DELETE SET NULL sem índice = seq scan a cada caixa apagada.
CREATE INDEX whatsapp_contact_avatars_source_instance_idx
  ON public.whatsapp_contact_avatars (source_instance_id)
  WHERE source_instance_id IS NOT NULL;

CREATE TRIGGER whatsapp_contact_avatars_updated_at
  BEFORE UPDATE ON public.whatsapp_contact_avatars
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.whatsapp_contact_avatars ENABLE ROW LEVEL SECURITY;
-- Sem policy de propósito: só service_role (BYPASSRLS) toca a tabela.
REVOKE ALL ON TABLE public.whatsapp_contact_avatars FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.whatsapp_contact_avatars TO service_role;

-- ── Fila de remoção de arquivos ──────────────────────────────────────────────
CREATE TABLE public.contact_avatar_storage_deletions (
  object_path text PRIMARY KEY,
  queued_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.contact_avatar_storage_deletions IS
  'Objetos do bucket contact-avatars a remover (linha apagada, órfã ou foto que sumiu). Drenada pelo cron contact-avatar-sync.';
ALTER TABLE public.contact_avatar_storage_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contact_avatar_storage_deletions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.contact_avatar_storage_deletions TO service_role;

CREATE FUNCTION public.enfileirar_remocao_avatar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- DELETE (inclusive cascade da org) e UPDATE que tirou/trocou o arquivo.
  IF OLD.storage_path IS NOT NULL
     AND (TG_OP = 'DELETE' OR NEW.storage_path IS DISTINCT FROM OLD.storage_path) THEN
    INSERT INTO public.contact_avatar_storage_deletions (object_path)
    VALUES (OLD.storage_path)
    ON CONFLICT (object_path) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.enfileirar_remocao_avatar() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER whatsapp_contact_avatars_enfileira_delete
  AFTER DELETE ON public.whatsapp_contact_avatars
  FOR EACH ROW EXECUTE FUNCTION public.enfileirar_remocao_avatar();
CREATE TRIGGER whatsapp_contact_avatars_enfileira_update
  AFTER UPDATE OF storage_path ON public.whatsapp_contact_avatars
  FOR EACH ROW
  WHEN (OLD.storage_path IS NOT NULL AND OLD.storage_path IS DISTINCT FROM NEW.storage_path)
  EXECUTE FUNCTION public.enfileirar_remocao_avatar();

-- ── Bucket privado ───────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('contact-avatars', 'contact-avatars', false, 2097152,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Quem pode LER um objeto: membro da org dona, com acesso de leitura a uma
-- caixa que conversou com o telefone dono da foto E dentro do escopo de
-- responsável (can_see_chat_scope) — a mesma regra de quem vê a conversa. Path malformado = false (não quebra leitura de outros buckets).
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE FUNCTION private.contact_avatar_object_readable(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_org   uuid;
  v_id    uuid;
  v_phone text;
BEGIN
  IF p_name IS NULL OR p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatars/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$' THEN
    RETURN false;
  END IF;
  v_org := split_part(p_name, '/', 1)::uuid;
  v_id  := split_part(split_part(p_name, '/', 3), '.', 1)::uuid;

  IF NOT (EXISTS (SELECT 1 FROM public.get_my_organization_ids() g(id) WHERE g.id = v_org)
          OR COALESCE(public.is_master_user(), false)) THEN
    RETURN false;
  END IF;

  SELECT a.normalized_phone INTO v_phone
  FROM public.whatsapp_contact_avatars a
  WHERE a.id = v_id AND a.organization_id = v_org AND a.storage_path = p_name AND a.status = 'ok';
  IF v_phone IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM unnest(public.whatsapp_readable_instance_ids(v_org, NULL)) b(id)
    JOIN public.whatsapp_conversation_summary s
      ON s.organization_id = v_org AND s.instance_id = b.id AND s.normalized_phone = v_phone
  )
  -- Escopo por responsável (chat_restrict_to_owner, strict_lead_owner_access,
  -- chat_scope_for_recipient): o mesmo predicado da lista de conversas.
  AND COALESCE(public.can_see_chat_scope(v_org, NULL, v_phone), false);
END;
$$;
REVOKE ALL ON FUNCTION private.contact_avatar_object_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.contact_avatar_object_readable(text) TO authenticated;

-- Só leitura. Escrita/remoção é do service_role (bypassa RLS).
CREATE POLICY contact_avatars_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'contact-avatars'
  AND split_part(name, '/', 2) = 'avatars'
  AND (split_part(name, '/', 1) IN (SELECT public.get_my_organization_ids()::text)
       OR (SELECT public.is_master_user()))
  AND private.contact_avatar_object_readable(name)
);

-- ── Webhook: registrar a candidata ───────────────────────────────────────────
-- Idempotente e barata: só escreve quando a foto mudou (chave = URL sem query)
-- ou a última visita da candidata passou de 1 dia (renova o `oe=`). Foto nova
-- volta a `pending`. Devolve true quando escreveu.
CREATE FUNCTION public.registrar_avatar_candidato(
  p_organization_id uuid, p_instance_id uuid, p_phone text, p_url text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_phone text := public.normalize_brazilian_phone(p_phone);
  v_key   text;
  v_n     integer;
BEGIN
  IF p_organization_id IS NULL OR p_instance_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.whatsapp_instances wi
    WHERE wi.id = p_instance_id AND wi.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'instância fora da organização' USING ERRCODE = '42501';
  END IF;
  IF v_phone IS NULL OR v_phone !~ '^[0-9]{8,15}$' THEN
    RAISE EXCEPTION 'telefone inválido' USING ERRCODE = '22023';
  END IF;
  -- Defesa em profundidade: a mesma allowlist do webhook (https, *.whatsapp.net,
  -- sem userinfo/porta, ≤ 2048).
  IF p_url IS NULL OR char_length(p_url) > 2048
     OR p_url !~* '^https://([a-z0-9-]+\.)+whatsapp\.net/' THEN
    RAISE EXCEPTION 'url de avatar fora da allowlist' USING ERRCODE = '22023';
  END IF;
  v_key := split_part(split_part(p_url, '?', 1), '#', 1);

  INSERT INTO public.whatsapp_contact_avatars AS a
    (organization_id, normalized_phone, source_instance_id, candidate_url, candidate_key, candidate_seen_at)
  VALUES (p_organization_id, v_phone, p_instance_id, p_url, v_key, now())
  ON CONFLICT (organization_id, normalized_phone) DO UPDATE SET
    candidate_url      = EXCLUDED.candidate_url,
    candidate_key      = EXCLUDED.candidate_key,
    candidate_seen_at  = EXCLUDED.candidate_seen_at,
    source_instance_id = EXCLUDED.source_instance_id,
    status   = CASE WHEN a.candidate_key IS DISTINCT FROM EXCLUDED.candidate_key THEN 'pending' ELSE a.status END,
    attempts = CASE WHEN a.candidate_key IS DISTINCT FROM EXCLUDED.candidate_key THEN 0 ELSE a.attempts END,
    -- URL nova ou renovada (oe novo) merece tentativa já: fura o recuo.
    retry_after = NULL
  WHERE a.candidate_key IS DISTINCT FROM EXCLUDED.candidate_key
     OR a.candidate_seen_at IS NULL
     OR a.candidate_seen_at < now() - interval '1 day';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_avatar_candidato(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_avatar_candidato(uuid, uuid, text, text) TO service_role;

-- ── Cron: reivindicar o lote ─────────────────────────────────────────────────
-- Pendentes fora do recuo (`retry_after`) e depois as vencidas há 7 dias.
-- Só contato com conversa nos últimos 30 dias. Cada parte usa o seu índice; a
-- conversa é achada pela PK do resumo (org, caixa, telefone) via caixas da org.
-- `p_exclude`: ids já vistos nesta rodada do cron — linha adiada (teto do
-- /chat/details) não volta no lote seguinte da mesma rodada.
-- Devolve também a caixa elegível para o fallback /chat/details: a de origem se
-- estiver apta, senão a da conversa mais recente — sempre connected, sessão viva,
-- Uazapi e COM conversa com o telefone.
CREATE FUNCTION public.reivindicar_avatares(p_limit integer DEFAULT 25, p_exclude uuid[] DEFAULT '{}')
RETURNS TABLE (
  id uuid, organization_id uuid, normalized_phone text, candidate_url text,
  storage_path text, content_sha256 text, status text, attempts smallint,
  details_instance_id uuid, details_number text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 25);
  v_ids   uuid[];
  v_more  uuid[];
BEGIN
  SELECT coalesce(array_agg(x.id), ARRAY[]::uuid[]) INTO v_ids FROM (
    SELECT a.id FROM public.whatsapp_contact_avatars a
    WHERE a.status = 'pending'
      AND (a.claimed_until IS NULL OR a.claimed_until < now())
      AND NOT (a.id = ANY (coalesce(p_exclude, '{}')))
      AND (a.retry_after IS NULL OR a.retry_after <= now())
      AND EXISTS (
        SELECT 1 FROM public.whatsapp_instances wi
        JOIN public.whatsapp_conversation_summary s
          ON s.organization_id = wi.organization_id AND s.instance_id = wi.id
         AND s.normalized_phone = a.normalized_phone
        WHERE wi.organization_id = a.organization_id
          AND s.last_message_time > now() - interval '30 days')
    ORDER BY a.avatar_updated_at ASC NULLS FIRST
    LIMIT v_limit
    FOR UPDATE OF a SKIP LOCKED
  ) x;

  IF cardinality(v_ids) < v_limit THEN
    SELECT coalesce(array_agg(x.id), ARRAY[]::uuid[]) INTO v_more FROM (
      SELECT a.id FROM public.whatsapp_contact_avatars a
      WHERE a.status <> 'pending'
        AND a.avatar_updated_at < now() - interval '7 days'
        AND (a.claimed_until IS NULL OR a.claimed_until < now())
        AND NOT (a.id = ANY (coalesce(p_exclude, '{}')))
        AND EXISTS (
          SELECT 1 FROM public.whatsapp_instances wi
          JOIN public.whatsapp_conversation_summary s
            ON s.organization_id = wi.organization_id AND s.instance_id = wi.id
           AND s.normalized_phone = a.normalized_phone
          WHERE wi.organization_id = a.organization_id
            AND s.last_message_time > now() - interval '30 days')
      ORDER BY a.avatar_updated_at ASC
      LIMIT v_limit - cardinality(v_ids)
      FOR UPDATE OF a SKIP LOCKED
    ) x;
    v_ids := v_ids || v_more;
  END IF;

  IF cardinality(v_ids) = 0 THEN
    RETURN;
  END IF;

  UPDATE public.whatsapp_contact_avatars a
  SET claimed_until = now() + interval '5 minutes'
  WHERE a.id = ANY (v_ids);

  RETURN QUERY
  SELECT a.id, a.organization_id, a.normalized_phone, a.candidate_url,
         a.storage_path, a.content_sha256, a.status, a.attempts,
         d.instance_id, d.phone_number
  FROM public.whatsapp_contact_avatars a
  LEFT JOIN LATERAL (
    SELECT s.instance_id, s.phone_number
    FROM public.whatsapp_instances wi
    JOIN public.whatsapp_conversation_summary s
      ON s.organization_id = wi.organization_id AND s.instance_id = wi.id
     AND s.normalized_phone = a.normalized_phone
    WHERE wi.organization_id = a.organization_id
      AND wi.status = 'connected'
      AND wi.session_dead_since IS NULL
      AND wi.provider = 'uazapi'
    ORDER BY (s.instance_id = a.source_instance_id) DESC NULLS LAST, s.last_message_time DESC
    LIMIT 1
  ) d ON true
  WHERE a.id = ANY (v_ids)
  ORDER BY (a.status = 'pending') DESC, a.avatar_updated_at ASC NULLS FIRST;
END;
$$;
REVOKE ALL ON FUNCTION public.reivindicar_avatares(integer, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reivindicar_avatares(integer, uuid[]) TO service_role;

-- ── Cron: podar órfãs ────────────────────────────────────────────────────────
-- Linha sem NENHUMA conversa (org, telefone) é apagada; o trigger enfileira o
-- arquivo. Varre por janela de id com cursor em cron_config, para o custo por
-- rodada ser limitado e a tabela inteira ser coberta em rodadas sucessivas.
CREATE FUNCTION public.podar_avatares_orfaos(p_limit integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_limit  integer := least(greatest(coalesce(p_limit, 200), 1), 200);
  v_janela constant integer := 2000;
  v_cursor uuid;
  v_ultimo uuid;
  v_lidos  integer;
  v_n      integer;
BEGIN
  BEGIN
    SELECT c.value::uuid INTO v_cursor FROM public.cron_config c
    WHERE c.key = 'contact_avatar_orphan_cursor';
  EXCEPTION WHEN invalid_text_representation THEN
    v_cursor := NULL;
  END;

  WITH janela AS (
    SELECT a.id, a.organization_id, a.normalized_phone
    FROM public.whatsapp_contact_avatars a
    WHERE v_cursor IS NULL OR a.id > v_cursor
    ORDER BY a.id
    LIMIT v_janela
  ), orfas AS (
    SELECT j.id FROM janela j
    WHERE NOT EXISTS (
      SELECT 1 FROM public.whatsapp_instances wi
      JOIN public.whatsapp_conversation_summary s
        ON s.organization_id = wi.organization_id AND s.instance_id = wi.id
       AND s.normalized_phone = j.normalized_phone
      WHERE wi.organization_id = j.organization_id)
    ORDER BY j.id
    LIMIT v_limit
  ), apagadas AS (
    DELETE FROM public.whatsapp_contact_avatars a USING orfas o WHERE a.id = o.id RETURNING a.id
  )
  SELECT (SELECT count(*) FROM janela),
         (SELECT j.id FROM janela j ORDER BY j.id DESC LIMIT 1),
         (SELECT count(*) FROM apagadas)
  INTO v_lidos, v_ultimo, v_n;

  -- Bateu no teto: a próxima rodada revisita a mesma janela (as apagadas saíram).
  IF v_n < v_limit THEN
    IF v_lidos < v_janela THEN
      DELETE FROM public.cron_config WHERE key = 'contact_avatar_orphan_cursor';
    ELSE
      INSERT INTO public.cron_config (key, value) VALUES ('contact_avatar_orphan_cursor', v_ultimo::text)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
    END IF;
  END IF;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.podar_avatares_orfaos(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.podar_avatares_orfaos(integer) TO service_role;

-- ── Front: avatares de uma página de conversas ───────────────────────────────
-- Uma chamada por janela de render (≤ 500 telefones). Devolve só foto `ok` de
-- telefone com conversa numa caixa que o chamador pode ler. O telefone volta
-- como foi pedido, para o front casar sem normalizar.
CREATE FUNCTION public.avatares_das_conversas(p_org uuid, p_phones text[])
RETURNS TABLE (phone text, storage_path text, content_sha256 text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
  v_boxes uuid[];
BEGIN
  IF p_org IS NULL OR (NOT EXISTS (
       SELECT 1 FROM public.get_my_organization_ids() g(id) WHERE g.id = p_org)
     AND NOT COALESCE(public.is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;
  IF p_phones IS NULL OR cardinality(p_phones) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_phones) > 500 THEN
    RAISE EXCEPTION 'no máximo 500 telefones por chamada' USING ERRCODE = '22023';
  END IF;

  v_boxes := public.whatsapp_readable_instance_ids(p_org, NULL);
  IF cardinality(v_boxes) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (p.phone) p.phone, a.storage_path, a.content_sha256
  FROM unnest(p_phones) AS p(phone)
  JOIN public.whatsapp_contact_avatars a
    ON a.organization_id = p_org
   AND a.normalized_phone = public.normalize_brazilian_phone(p.phone)
  WHERE p.phone IS NOT NULL
    AND a.status = 'ok'
    AND a.storage_path IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM unnest(v_boxes) b(id)
      JOIN public.whatsapp_conversation_summary s
        ON s.organization_id = p_org AND s.instance_id = b.id
       AND s.normalized_phone = a.normalized_phone)
    -- Escopo por responsável, depois dos filtros baratos: o mesmo predicado
    -- da lista (20280119010000). Vendedor fora do escopo não recebe path.
    AND COALESCE(public.can_see_chat_scope(p_org, NULL, a.normalized_phone), false)
  ORDER BY p.phone;
END;
$$;
REVOKE ALL ON FUNCTION public.avatares_das_conversas(uuid, text[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.avatares_das_conversas(uuid, text[]) TO authenticated;
