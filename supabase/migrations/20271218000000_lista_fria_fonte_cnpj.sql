-- 20271218000000_lista_fria_fonte_cnpj.sql
--
-- Lista Fria · terceira fonte: CNPJ por CNAE/segmento (base enxuta da Receita em Parquet).
-- Desenho e medição: ADR-0043. ROLLBACK pareado: rollback/20271218000000_lista_fria_fonte_cnpj.sql
--
-- O que muda:
--   1. `lista_fria_buscas.fonte` aceita 'cnpj'.
--   2. `lista_fria_buscas.filtros` (jsonb) guarda o alvo da busca de CNPJ: CNAEs, UF,
--      município e a exigência de contato. Maps e Instagram seguem com seus campos.
--   3. `lista_fria_busca_criar` entende p_fonte = 'cnpj'.
--
-- O resto do fluxo (reserva de créditos, registrar, encerrar, importar) é o mesmo das outras
-- fontes e NÃO muda. `lista_fria_worker_reivindicar` devolve a linha inteira, filtros incluídos.
-- CREATE OR REPLACE preserva as permissões da função (REVOKE/GRANT da fundação seguem valendo).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Coluna e restrições
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.lista_fria_buscas
  ADD COLUMN IF NOT EXISTS filtros jsonb
    CONSTRAINT lista_fria_buscas_filtros_objeto CHECK (
      filtros IS NULL OR (jsonb_typeof(filtros) = 'object' AND pg_column_size(filtros) <= 2000)
    );

COMMENT ON COLUMN public.lista_fria_buscas.filtros IS
  'Alvo da busca de CNPJ: {cnaes: text[], uf: text, municipio?: text, contato: qualquer|email|telefone|ambos}. '
  'NULL nas buscas de Maps e Instagram.';

ALTER TABLE public.lista_fria_buscas DROP CONSTRAINT IF EXISTS lista_fria_buscas_fonte_check;
ALTER TABLE public.lista_fria_buscas
  ADD CONSTRAINT lista_fria_buscas_fonte_check CHECK (fonte IN ('maps', 'instagram', 'cnpj'));

ALTER TABLE public.lista_fria_buscas DROP CONSTRAINT IF EXISTS lista_fria_buscas_fonte_tem_alvo;
ALTER TABLE public.lista_fria_buscas
  ADD CONSTRAINT lista_fria_buscas_fonte_tem_alvo CHECK (
    (fonte = 'maps' AND nicho IS NOT NULL AND cidade IS NOT NULL AND instagram_handle IS NULL AND filtros IS NULL)
    OR (fonte = 'instagram' AND instagram_handle IS NOT NULL AND nicho IS NULL AND cidade IS NULL AND filtros IS NULL)
    OR (fonte = 'cnpj' AND filtros IS NOT NULL AND nicho IS NULL AND cidade IS NULL AND instagram_handle IS NULL)
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Criação da busca (as três fontes)
-- ─────────────────────────────────────────────────────────────────────────
-- Cria a busca e RESERVA os créditos. p_params:
--   maps:      { "nicho": "Dentistas", "cidade": "São Paulo - SP" }
--   instagram: { "url": "https://www.instagram.com/clinicaodontovida/" }
--   cnpj:      { "cnaes": ["4639", "8630"], "uf": "SP", "municipio": "SAO PAULO", "contato": "email" }
--              cnaes: 1 a 20 códigos de 2 a 7 dígitos (prefixo: "46" pega todo o grupo);
--              municipio: opcional; contato: qualquer (padrão) | email | telefone | ambos.

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

  -- Uma busca por vez cria e reserva por org: duas abas não gastam o mesmo saldo.
  PERFORM pg_advisory_xact_lock(hashtextextended('lista_fria:' || p_org::text, 0));

  SELECT count(*) INTO v_abertas
    FROM public.lista_fria_buscas
   WHERE organization_id = p_org AND status IN ('na_fila', 'executando');
  IF v_abertas >= 3 THEN
    RAISE EXCEPTION 'Já há 3 buscas em andamento. Espere uma terminar.'
      USING ERRCODE = 'PT422', DETAIL = 'buscas_demais';
  END IF;

  IF private.lista_fria_saldo_da_org(p_org) < p_creditos THEN
    RAISE EXCEPTION 'Saldo de créditos insuficiente.'
      USING ERRCODE = 'PT422', DETAIL = 'creditos_insuficientes';
  END IF;

  INSERT INTO public.lista_fria_buscas (organization_id, fonte, nicho, cidade, instagram_handle, filtros, creditos_limite)
  VALUES (p_org, p_fonte, v_nicho, v_cidade, v_handle, v_filtros, p_creditos)
  RETURNING id INTO v_id;

  INSERT INTO public.lista_fria_creditos (organization_id, delta, motivo, busca_id, nota)
  VALUES (p_org, -p_creditos, 'reserva', v_id, 'Reserva da busca');

  RETURN v_id;
END
$fn$;
