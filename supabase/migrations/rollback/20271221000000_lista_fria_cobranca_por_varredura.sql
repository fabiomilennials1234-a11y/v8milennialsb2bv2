-- ROLLBACK de 20271221000000_lista_fria_cobranca_por_varredura.sql
--
-- Volta a cobranca por contato. Recusa se existir busca por varredura: ela ja gastou creditos por seguidor e
-- mudar o modo reescreveria o que o cliente pagou. Resolva antes (feche as buscas e confira o livro) e rode de novo:
--   SELECT id, status, varridos, creditos_usados FROM public.lista_fria_buscas WHERE cobranca = 'por_varredura';

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.lista_fria_buscas WHERE cobranca = 'por_varredura') THEN
    RAISE EXCEPTION 'Ha buscas cobradas por varredura. Resolva antes de desfazer.';
  END IF;
END
$$;

DROP FUNCTION public.lista_fria_worker_varrer(uuid, text, integer, numeric);

-- Corpos anteriores (meta 20271220000000 e fundacao 20271217000000).
CREATE OR REPLACE FUNCTION private.lista_fria_encerrar(p_busca uuid, p_status text, p_erro text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  b public.lista_fria_buscas%ROWTYPE;
  v_sobra integer;
  v_tipo text;
BEGIN
  SELECT * INTO b FROM public.lista_fria_buscas WHERE id = p_busca FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF b.status IN ('concluida', 'parada', 'falhou', 'cancelada') THEN
    RETURN;
  END IF;

  -- A sobra volta para o MESMO saldo de onde a reserva saiu: o tipo vem da fonte da busca.
  v_tipo := private.lista_fria_tipo_da_fonte(b.fonte);
  v_sobra := b.creditos_limite - b.creditos_usados;
  IF v_sobra > 0 AND NOT b.creditos_devolvidos THEN
    INSERT INTO public.lista_fria_creditos (organization_id, delta, motivo, busca_id, nota, criado_por, tipo)
    VALUES (b.organization_id, v_sobra, 'devolucao', b.id, 'Sobra da reserva da busca', NULL, v_tipo);
  END IF;

  UPDATE public.lista_fria_buscas
     SET status = p_status,
         erro = left(p_erro, 500),
         etapa = NULL,
         progresso = CASE WHEN p_status = 'concluida' THEN 100 ELSE progresso END,
         creditos_devolvidos = true,
         finished_at = now(),
         updated_at = now()
   WHERE id = b.id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.lista_fria_busca_criar(
  p_org uuid, p_fonte text, p_params jsonb, p_creditos integer
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id uuid;
  v_nicho text;
  v_cidade text;
  v_handle text;
  v_filtros jsonb;
  v_cnaes text[];
  v_uf text;
  v_municipio text;
  v_contato text;
  v_abertas integer;
  v_tipo text;
BEGIN
  PERFORM private.lista_fria_exigir(p_org, 'edit');

  IF p_fonte NOT IN ('maps', 'instagram', 'cnpj') THEN
    RAISE EXCEPTION 'Fonte inválida.' USING ERRCODE = 'PT422', DETAIL = 'fonte_invalida';
  END IF;
  IF p_creditos IS NULL OR p_creditos < 1 OR p_creditos > 100000 THEN
    RAISE EXCEPTION 'Informe de 1 a 100.000 créditos.' USING ERRCODE = 'PT422', DETAIL = 'creditos_invalidos';
  END IF;

  IF p_fonte = 'maps' THEN
    v_nicho := btrim(COALESCE(p_params ->> 'nicho', ''));
    v_cidade := btrim(COALESCE(p_params ->> 'cidade', ''));
    IF length(v_nicho) < 2 OR length(v_nicho) > 80 OR length(v_cidade) < 2 OR length(v_cidade) > 80 THEN
      RAISE EXCEPTION 'Informe o nicho e a cidade.' USING ERRCODE = 'PT422', DETAIL = 'alvo_invalido';
    END IF;
  ELSIF p_fonte = 'instagram' THEN
    -- Aceita a URL do perfil (com ou sem www, com ou sem barra final, com query)
    -- ou o @ direto. Fica só o handle.
    v_handle := lower(btrim(COALESCE(p_params ->> 'url', '')));
    v_handle := regexp_replace(v_handle, '^(https?://)?(www\.)?instagram\.com/', '');
    v_handle := regexp_replace(v_handle, '^@', '');
    v_handle := split_part(split_part(split_part(v_handle, '?', 1), '#', 1), '/', 1);
    IF v_handle !~ '^[a-z0-9._]{1,30}$'
       OR v_handle IN ('p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'direct') THEN
      RAISE EXCEPTION 'Cole a URL de uma conta do Instagram.' USING ERRCODE = 'PT422', DETAIL = 'alvo_invalido';
    END IF;
  ELSE
    IF jsonb_typeof(p_params -> 'cnaes') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Escolha ao menos um CNAE.' USING ERRCODE = 'PT422', DETAIL = 'alvo_invalido';
    END IF;
    -- Só dígitos, sem repetição, de 1 a 20 códigos. O código pode vir com pontuação
    -- ("46.39-7-01"); fica só o número.
    SELECT COALESCE(array_agg(DISTINCT d ORDER BY d), ARRAY[]::text[])
      INTO v_cnaes
      FROM (SELECT regexp_replace(x, '[^0-9]', '', 'g') AS d
              FROM jsonb_array_elements_text(p_params -> 'cnaes') AS x) s
     WHERE d ~ '^[0-9]{2,7}$';
    IF cardinality(v_cnaes) < 1 OR cardinality(v_cnaes) > 20 THEN
      RAISE EXCEPTION 'Escolha de 1 a 20 CNAEs válidos.' USING ERRCODE = 'PT422', DETAIL = 'alvo_invalido';
    END IF;

    v_uf := upper(btrim(COALESCE(p_params ->> 'uf', '')));
    IF v_uf NOT IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') THEN
      RAISE EXCEPTION 'Escolha o estado.' USING ERRCODE = 'PT422', DETAIL = 'alvo_invalido';
    END IF;

    v_municipio := NULLIF(btrim(COALESCE(p_params ->> 'municipio', '')), '');
    IF v_municipio IS NOT NULL AND (length(v_municipio) < 2 OR length(v_municipio) > 80) THEN
      RAISE EXCEPTION 'Município inválido.' USING ERRCODE = 'PT422', DETAIL = 'alvo_invalido';
    END IF;

    v_contato := COALESCE(NULLIF(btrim(p_params ->> 'contato'), ''), 'qualquer');
    IF v_contato NOT IN ('qualquer', 'email', 'telefone', 'ambos') THEN
      RAISE EXCEPTION 'Tipo de contato inválido.' USING ERRCODE = 'PT422', DETAIL = 'alvo_invalido';
    END IF;

    v_filtros := jsonb_strip_nulls(jsonb_build_object(
      'cnaes', to_jsonb(v_cnaes), 'uf', v_uf, 'municipio', v_municipio, 'contato', v_contato));
  END IF;

  -- Instagram gasta crédito Meta; Maps e CNPJ, crédito normal (saldos separados, ADR-0044).
  v_tipo := private.lista_fria_tipo_da_fonte(p_fonte);

  -- Uma busca por vez cria e reserva por org: duas abas não gastam o mesmo saldo.
  PERFORM pg_advisory_xact_lock(hashtextextended('lista_fria:' || p_org::text, 0));

  SELECT count(*) INTO v_abertas
    FROM public.lista_fria_buscas
   WHERE organization_id = p_org AND status IN ('na_fila', 'executando');
  IF v_abertas >= 3 THEN
    RAISE EXCEPTION 'Já há 3 buscas em andamento. Espere uma terminar.'
      USING ERRCODE = 'PT422', DETAIL = 'buscas_demais';
  END IF;

  IF private.lista_fria_saldo_da_org(p_org, v_tipo) < p_creditos THEN
    IF v_tipo = 'meta' THEN
      RAISE EXCEPTION 'Saldo de créditos Meta insuficiente.'
        USING ERRCODE = 'PT422', DETAIL = 'creditos_meta_insuficientes';
    END IF;
    RAISE EXCEPTION 'Saldo de créditos insuficiente.'
      USING ERRCODE = 'PT422', DETAIL = 'creditos_insuficientes';
  END IF;

  INSERT INTO public.lista_fria_buscas (organization_id, fonte, nicho, cidade, instagram_handle, filtros, creditos_limite)
  VALUES (p_org, p_fonte, v_nicho, v_cidade, v_handle, v_filtros, p_creditos)
  RETURNING id INTO v_id;

  INSERT INTO public.lista_fria_creditos (organization_id, delta, motivo, busca_id, nota, tipo)
  VALUES (p_org, -p_creditos, 'reserva', v_id, 'Reserva da busca', v_tipo);

  RETURN v_id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.lista_fria_worker_registrar(p_busca uuid, p_worker text, p_itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  b public.lista_fria_buscas%ROWTYPE;
  it jsonb;
  v_tel text;
  v_email text;
  v_ja boolean;
  v_aceitos integer := 0;
  v_ja_leads integer := 0;
  v_limite boolean := false;
  v_n integer;
BEGIN
  SELECT * INTO b FROM public.lista_fria_buscas
   WHERE id = p_busca AND worker_id = p_worker AND status = 'executando'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('aceitos', 0, 'limite_atingido', false, 'ativa', false);
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) LOOP
    v_tel := private.lista_fria_so_digitos(it ->> 'telefone');
    IF v_tel IS NOT NULL AND v_tel !~ '^[0-9]{10,15}$' THEN
      v_tel := NULL;
    END IF;
    -- Telefone brasileiro sem DDI (10 ou 11 dígitos) ganha o 55.
    IF v_tel IS NOT NULL AND length(v_tel) IN (10, 11) THEN
      v_tel := '55' || v_tel;
    END IF;
    v_email := lower(NULLIF(btrim(COALESCE(it ->> 'email', '')), ''));
    IF v_email IS NOT NULL AND (position('@' IN v_email) < 2 OR length(v_email) > 254) THEN
      v_email := NULL;
    END IF;
    IF v_tel IS NULL AND v_email IS NULL THEN
      CONTINUE;
    END IF;

    v_ja := (v_tel IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.leads l
                WHERE l.organization_id = b.organization_id AND l.deleted_at IS NULL
                  AND l.normalized_phone = public.normalize_brazilian_phone(v_tel)))
         OR (v_email IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.leads l
                WHERE l.organization_id = b.organization_id AND l.deleted_at IS NULL
                  AND lower(l.email) = v_email));

    IF NOT v_ja AND b.creditos_usados + v_aceitos >= b.creditos_limite THEN
      v_limite := true;
      EXIT;
    END IF;

    INSERT INTO public.lista_fria_resultados (
      organization_id, busca_id, ref_externa, nome, categoria, telefone, email, site,
      endereco, bairro, instagram, qualidade, ja_e_lead, selecionado
    ) VALUES (
      b.organization_id, b.id,
      left(it ->> 'ref_externa', 200),
      left(COALESCE(NULLIF(btrim(it ->> 'nome'), ''), 'Sem nome'), 200),
      left(it ->> 'categoria', 120), v_tel, v_email,
      left(it ->> 'site', 500), left(it ->> 'endereco', 300), left(it ->> 'bairro', 120),
      NULLIF(it ->> 'instagram', ''),
      COALESCE(NULLIF(it ->> 'qualidade', ''), 'nao_verificado'),
      v_ja, NOT v_ja
    )
    ON CONFLICT (busca_id, ref_externa) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 1 THEN
      IF v_ja THEN v_ja_leads := v_ja_leads + 1; ELSE v_aceitos := v_aceitos + 1; END IF;
    END IF;
  END LOOP;

  UPDATE public.lista_fria_buscas
     SET creditos_usados = creditos_usados + v_aceitos,
         ja_leads = ja_leads + v_ja_leads,
         heartbeat_at = now(),
         updated_at = now()
   WHERE id = b.id;

  RETURN jsonb_build_object(
    'aceitos', v_aceitos,
    'ja_eram_leads', v_ja_leads,
    'limite_atingido', v_limite OR (b.creditos_usados + v_aceitos >= b.creditos_limite),
    'ativa', true);
END
$fn$;

DROP TABLE public.lista_fria_busca_custos;

ALTER TABLE public.lista_fria_buscas
  DROP COLUMN contatos_novos,
  DROP COLUMN seguidores_por_credito,
  DROP COLUMN varridos,
  DROP COLUMN cobranca;

COMMIT;
