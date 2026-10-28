-- ROLLBACK de 20271218000000_lista_fria_fonte_cnpj.sql
--
-- Tira a fonte CNPJ: a coluna `filtros`, o valor 'cnpj' e o ramo de `lista_fria_busca_criar`.
-- Recusa se já existir busca de CNPJ, para não perder histórico nem créditos reservados: cancele ou
-- apague essas buscas antes (os créditos voltam pelo livro, não pelo rollback).
--   SELECT id, status FROM public.lista_fria_buscas WHERE fonte = 'cnpj';

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.lista_fria_buscas WHERE fonte = 'cnpj') THEN
    RAISE EXCEPTION 'Há buscas de CNPJ. Cancele/apague antes de desfazer.';
  END IF;
END
$$;

ALTER TABLE public.lista_fria_buscas DROP CONSTRAINT IF EXISTS lista_fria_buscas_fonte_tem_alvo;
ALTER TABLE public.lista_fria_buscas DROP CONSTRAINT IF EXISTS lista_fria_buscas_fonte_check;
ALTER TABLE public.lista_fria_buscas
  ADD CONSTRAINT lista_fria_buscas_fonte_check CHECK (fonte IN ('maps', 'instagram'));
ALTER TABLE public.lista_fria_buscas
  ADD CONSTRAINT lista_fria_buscas_fonte_tem_alvo CHECK (
    (fonte = 'maps' AND nicho IS NOT NULL AND cidade IS NOT NULL AND instagram_handle IS NULL)
    OR (fonte = 'instagram' AND instagram_handle IS NOT NULL AND nicho IS NULL AND cidade IS NULL)
  );
ALTER TABLE public.lista_fria_buscas DROP COLUMN IF EXISTS filtros;

-- Corpo da fundação (20271217000000), de volta.
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
  v_abertas integer;
BEGIN
  PERFORM private.lista_fria_exigir(p_org, 'edit');

  IF p_fonte NOT IN ('maps', 'instagram') THEN
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
  ELSE
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

  INSERT INTO public.lista_fria_buscas (organization_id, fonte, nicho, cidade, instagram_handle, creditos_limite)
  VALUES (p_org, p_fonte, v_nicho, v_cidade, v_handle, p_creditos)
  RETURNING id INTO v_id;

  INSERT INTO public.lista_fria_creditos (organization_id, delta, motivo, busca_id, nota)
  VALUES (p_org, -p_creditos, 'reserva', v_id, 'Reserva da busca');

  RETURN v_id;
END
$fn$;

COMMIT;
