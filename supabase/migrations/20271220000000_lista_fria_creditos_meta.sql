-- 20271220000000_lista_fria_creditos_meta.sql
--
-- Lista Fria · dois saldos de crédito: NORMAL (Maps e CNPJ) e META (Instagram). ADR-0044.
-- ROLLBACK pareado: rollback/20271220000000_lista_fria_creditos_meta.sql
--
-- Por que separar: o custo por contato é de outra ordem. Maps e CNPJ custam ~R$ 0; o Instagram
-- (Apify) cobra por SEGUIDOR PROCESSADO, não por contato achado, e rende de 2% a 21,6% conforme a conta
-- alvo (R$ 0,31 a R$ 3,30 por contato). Preço de lista decidido pelo CTO em 29/10/2026:
--   crédito normal R$ 0,15 · crédito Meta R$ 1,00.
-- O preço NÃO mora no banco (não há cobrança ainda): o banco só garante que cada fonte gasta do saldo certo.
--
-- O que muda:
--   1. `lista_fria_creditos.tipo` ('normal' | 'meta'). As linhas existentes viram 'normal'.
--   2. O saldo passa a ser por tipo. A busca debita o tipo da FONTE e a sobra volta para o mesmo tipo.
--   3. `lista_fria_saldo(uuid)` CONTINUA devolvendo um número (o saldo normal): o front já publicado
--      não quebra. `lista_fria_saldos(uuid)` é nova e devolve os dois.
--   4. `lista_fria_creditos_conceder` ganha `p_tipo` (padrão 'normal'): chamadas antigas seguem valendo.
-- CREATE OR REPLACE preserva as permissões; só o que é novo recebe REVOKE/GRANT.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Tipo no livro de créditos
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.lista_fria_creditos
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'normal'
    CONSTRAINT lista_fria_creditos_tipo_check CHECK (tipo IN ('normal', 'meta'));

COMMENT ON COLUMN public.lista_fria_creditos.tipo IS
  'Saldo a que a linha pertence: normal (Maps, CNPJ) ou meta (Instagram). Reserva e devolução seguem o tipo da fonte da busca.';

CREATE INDEX IF NOT EXISTS lista_fria_creditos_org_tipo ON public.lista_fria_creditos (organization_id, tipo);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Qual saldo cada fonte gasta, e o saldo por tipo
-- ─────────────────────────────────────────────────────────────────────────

CREATE FUNCTION private.lista_fria_tipo_da_fonte(p_fonte text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT CASE WHEN p_fonte = 'instagram' THEN 'meta' ELSE 'normal' END;
$fn$;

CREATE FUNCTION private.lista_fria_saldo_da_org(p_org uuid, p_tipo text)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(SUM(c.delta), 0)::integer
    FROM public.lista_fria_creditos c
   WHERE c.organization_id = p_org AND c.tipo = p_tipo;
$fn$;

-- A versão de 1 argumento passa a significar "saldo normal" (quem ainda a chamar não muda de resultado).
CREATE OR REPLACE FUNCTION private.lista_fria_saldo_da_org(p_org uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT private.lista_fria_saldo_da_org(p_org, 'normal');
$fn$;

REVOKE ALL ON FUNCTION private.lista_fria_tipo_da_fonte(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.lista_fria_saldo_da_org(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.lista_fria_tipo_da_fonte(text) TO service_role;
GRANT EXECUTE ON FUNCTION private.lista_fria_saldo_da_org(uuid, text) TO service_role;

CREATE FUNCTION public.lista_fria_saldos(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM private.lista_fria_exigir(p_org, 'view');
  RETURN jsonb_build_object(
    'normal', private.lista_fria_saldo_da_org(p_org, 'normal'),
    'meta', private.lista_fria_saldo_da_org(p_org, 'meta'));
END
$fn$;

REVOKE ALL ON FUNCTION public.lista_fria_saldos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lista_fria_saldos(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. A devolução da sobra volta para o saldo de onde a reserva saiu
-- ─────────────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────────────
-- 4. A busca reserva do saldo da fonte
-- ─────────────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Concessão por tipo (só master / service_role)
-- ─────────────────────────────────────────────────────────────────────────

DROP FUNCTION public.lista_fria_creditos_conceder(uuid, integer, text);

CREATE FUNCTION public.lista_fria_creditos_conceder(p_org uuid, p_qtd integer, p_nota text DEFAULT NULL, p_tipo text DEFAULT 'normal')
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sessão expirada. Entre de novo para continuar.'
      USING ERRCODE = '42501', DETAIL = 'sem_sessao';
  END IF;
  IF NOT (COALESCE(public.is_master_user(), false) OR COALESCE(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'Só o time Torque libera créditos.' USING ERRCODE = '42501', DETAIL = 'so_master';
  END IF;
  IF NOT private.lista_fria_habilitada(p_org) THEN
    RAISE EXCEPTION 'A Lista fria não está liberada para esta organização.'
      USING ERRCODE = '42501', DETAIL = 'lista_fria_desligada';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('normal', 'meta') THEN
    RAISE EXCEPTION 'Tipo de crédito inválido (normal ou meta).' USING ERRCODE = 'PT422', DETAIL = 'tipo_invalido';
  END IF;
  IF p_qtd IS NULL OR p_qtd < 1 OR p_qtd > 1000000 THEN
    RAISE EXCEPTION 'Informe de 1 a 1.000.000 créditos.' USING ERRCODE = 'PT422', DETAIL = 'creditos_invalidos';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('lista_fria:' || p_org::text, 0));
  INSERT INTO public.lista_fria_creditos (organization_id, delta, motivo, nota, tipo)
  VALUES (p_org, p_qtd, 'concessao', left(p_nota, 300), p_tipo);
  RETURN private.lista_fria_saldo_da_org(p_org, p_tipo);
END
$fn$;

REVOKE ALL ON FUNCTION public.lista_fria_creditos_conceder(uuid, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lista_fria_creditos_conceder(uuid, integer, text, text) TO authenticated, service_role;
