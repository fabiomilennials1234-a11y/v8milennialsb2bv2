-- ROLLBACK de 20271222000000_lista_fria_instagram_busca_por_creditos.sql
--
-- Volta a reserva fixa de 50 creditos Meta no Instagram (corpo da 20271221000000). Buscas em andamento nao sao afetadas.

BEGIN;

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
  v_creditos integer := p_creditos;
  v_cobranca text := 'por_contato';
BEGIN
  PERFORM private.lista_fria_exigir(p_org, 'edit');

  IF p_fonte NOT IN ('maps', 'instagram', 'cnpj') THEN
    RAISE EXCEPTION 'Fonte inválida.' USING ERRCODE = 'PT422', DETAIL = 'fonte_invalida';
  END IF;
  IF p_creditos IS NULL OR p_creditos < 1 OR p_creditos > 100000 THEN
    RAISE EXCEPTION 'Informe de 1 a 100.000 créditos.' USING ERRCODE = 'PT422', DETAIL = 'creditos_invalidos';
  END IF;

  -- Instagram e cobrado por seguidor varrido (ADR-0046): a reserva e fixa, o teto de seguidores que o
  -- acesso sem login entrega (50). O que o cliente pediu em `p_creditos` nao vale para esta fonte.
  IF p_fonte = 'instagram' THEN
    v_creditos := 50;
    v_cobranca := 'por_varredura';
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

  IF private.lista_fria_saldo_da_org(p_org, v_tipo) < v_creditos THEN
    IF v_tipo = 'meta' THEN
      RAISE EXCEPTION 'Saldo de créditos Meta insuficiente.'
        USING ERRCODE = 'PT422', DETAIL = 'creditos_meta_insuficientes';
    END IF;
    RAISE EXCEPTION 'Saldo de créditos insuficiente.'
      USING ERRCODE = 'PT422', DETAIL = 'creditos_insuficientes';
  END IF;

  INSERT INTO public.lista_fria_buscas (organization_id, fonte, nicho, cidade, instagram_handle, filtros, creditos_limite, cobranca)
  VALUES (p_org, p_fonte, v_nicho, v_cidade, v_handle, v_filtros, v_creditos, v_cobranca)
  RETURNING id INTO v_id;

  INSERT INTO public.lista_fria_creditos (organization_id, delta, motivo, busca_id, nota, tipo)
  VALUES (p_org, -v_creditos, 'reserva', v_id, 'Reserva da busca', v_tipo);

  RETURN v_id;
END
$fn$;

COMMIT;
