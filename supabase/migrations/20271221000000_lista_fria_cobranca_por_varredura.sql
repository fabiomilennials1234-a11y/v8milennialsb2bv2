-- Lista Fria: credito Meta cobrado por seguidor varrido (ADR-0046).
--
-- Antes: o Instagram gastava 1 credito por contato novo e valido, mas o custo (Apify) e por seguidor
-- processado, ache contato ou nao. A margem da busca ia de -230% a +69% conforme a conta-alvo.
-- Agora: 1 credito Meta = 1 seguidor varrido; contato achado nao gasta credito; busca que termina sem
-- nenhum resultado devolve metade dos creditos gastos.
--
-- ADITIVA E COMPATIVEL: a busca grava o modo de cobranca. As que ja existem (e as de Maps e CNPJ) ficam
-- `por_contato`, com o comportamento de antes. So a busca de Instagram CRIADA depois desta migration nasce
-- `por_varredura`. Ordem de implantacao: worker novo (tolera a RPC ausente) -> esta migration -> front.

-- ---------------------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------------------

ALTER TABLE public.lista_fria_buscas
  ADD COLUMN cobranca text NOT NULL DEFAULT 'por_contato'
    CONSTRAINT lista_fria_buscas_cobranca_valida CHECK (cobranca IN ('por_contato', 'por_varredura')),
  ADD COLUMN varridos integer NOT NULL DEFAULT 0
    CONSTRAINT lista_fria_buscas_varridos_nao_negativo CHECK (varridos >= 0),
  ADD COLUMN seguidores_por_credito integer NOT NULL DEFAULT 1
    CONSTRAINT lista_fria_buscas_spc_positivo CHECK (seguidores_por_credito >= 1),
  ADD COLUMN contatos_novos integer NOT NULL DEFAULT 0
    CONSTRAINT lista_fria_buscas_contatos_nao_negativo CHECK (contatos_novos >= 0);

-- Ate aqui todo credito gasto era um contato novo: o backfill preserva o que as telas mostram.
UPDATE public.lista_fria_buscas SET contatos_novos = creditos_usados;

COMMENT ON COLUMN public.lista_fria_buscas.contatos_novos IS
  'Contatos novos e validos que a busca entregou (sem contar quem ja e lead). Em busca por_contato e igual a creditos_usados; em por_varredura nao.';
COMMENT ON COLUMN public.lista_fria_buscas.cobranca IS
  'por_contato: 1 credito por contato novo (Maps, CNPJ e buscas antigas). por_varredura: 1 credito por seguidor varrido (Instagram, ADR-0046).';
COMMENT ON COLUMN public.lista_fria_buscas.varridos IS
  'Seguidores que o coletor processou (total acumulado informado pelo worker). So cresce.';

-- O custo real da execucao (Apify usageTotalUsd) e a MARGEM da casa: fica fora de `lista_fria_buscas`, que o
-- cliente le inteira (`select *`). Tabela so do servico: RLS ligada, sem policy e sem grant para o usuario.
CREATE TABLE public.lista_fria_busca_custos (
  busca_id   uuid PRIMARY KEY REFERENCES public.lista_fria_buscas(id) ON DELETE CASCADE,
  custo_usd  numeric(10, 4) NOT NULL CONSTRAINT lista_fria_busca_custos_nao_negativo CHECK (custo_usd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lista_fria_busca_custos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lista_fria_busca_custos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lista_fria_busca_custos TO service_role;
COMMENT ON TABLE public.lista_fria_busca_custos IS
  'Custo real do coletor por busca (auditoria da margem, ADR-0046). Nunca exposta ao cliente; so o servico le e escreve.';
COMMENT ON COLUMN public.lista_fria_buscas.seguidores_por_credito IS
  'Seguidores por credito NO MOMENTO da criacao: mudar o preco depois nao mexe em busca em andamento.';

-- ---------------------------------------------------------------------------
-- 2. Encerramento: devolve metade quando a busca por varredura nao acha nada
-- ---------------------------------------------------------------------------

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
  v_extra integer := 0;
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

  -- Cobranca por varredura (ADR-0046): busca que termina SEM NENHUM resultado registrado devolve metade
  -- dos creditos gastos, arredondada para baixo (a casa fica com pelo menos metade). Resultado que ja e
  -- lead conta como resultado. Parada ou cancelada pelo usuario nao entra: ele mesmo parou.
  IF b.cobranca = 'por_varredura'
     AND p_status IN ('concluida', 'falhou')
     AND NOT b.creditos_devolvidos
     AND b.creditos_usados > 0
     AND NOT EXISTS (SELECT 1 FROM public.lista_fria_resultados r WHERE r.busca_id = b.id)
  THEN
    v_extra := b.creditos_usados / 2;
    IF v_extra > 0 THEN
      INSERT INTO public.lista_fria_creditos (organization_id, delta, motivo, busca_id, nota, criado_por, tipo)
      VALUES (b.organization_id, v_extra, 'devolucao', b.id, 'Metade dos créditos gastos: busca sem nenhum contato', NULL, v_tipo);
    END IF;
  END IF;

  UPDATE public.lista_fria_buscas
     SET status = p_status,
         creditos_usados = creditos_usados - v_extra,
         erro = left(p_erro, 500),
         etapa = NULL,
         progresso = CASE WHEN p_status = 'concluida' THEN 100 ELSE progresso END,
         creditos_devolvidos = true,
         finished_at = now(),
         updated_at = now()
   WHERE id = b.id;
END
$fn$;

-- ---------------------------------------------------------------------------
-- 3. A busca de Instagram nasce por varredura, com reserva fixa
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 4. O registro nao cobra contato nem para no limite quando a busca e por varredura
-- ---------------------------------------------------------------------------
-- Mesmo corpo da fundacao, com tres mudancas marcadas por `cobranca`.

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

    IF NOT v_ja AND b.cobranca = 'por_contato' AND b.creditos_usados + v_aceitos >= b.creditos_limite THEN
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
     SET contatos_novos = contatos_novos + v_aceitos,
         creditos_usados = creditos_usados + CASE WHEN b.cobranca = 'por_contato' THEN v_aceitos ELSE 0 END,
         ja_leads = ja_leads + v_ja_leads,
         heartbeat_at = now(),
         updated_at = now()
   WHERE id = b.id;

  RETURN jsonb_build_object(
    'aceitos', v_aceitos,
    'ja_eram_leads', v_ja_leads,
    'limite_atingido', b.cobranca = 'por_contato' AND (v_limite OR (b.creditos_usados + v_aceitos >= b.creditos_limite)),
    'ativa', true);
END
$fn$;
-- ---------------------------------------------------------------------------
-- 5. O worker informa os seguidores varridos; o banco debita
-- ---------------------------------------------------------------------------
-- O total e CUMULATIVO e MONOTONICO (GREATEST): repetir ou atrasar uma chamada nao cobra duas vezes. O
-- debito sobe ate a reserva e para nela. Em busca `por_contato` so audita (varridos e custo), nao cobra. O custo so cresce.

CREATE FUNCTION public.lista_fria_worker_varrer(p_busca uuid, p_worker text, p_varridos integer, p_custo_usd numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  b public.lista_fria_buscas%ROWTYPE;
  v_varridos integer;
  v_usados integer;
  v_cobrando boolean;
BEGIN
  SELECT * INTO b FROM public.lista_fria_buscas
   WHERE id = p_busca AND worker_id = p_worker AND status = 'executando'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ativa', false, 'cobrando', false, 'limite_atingido', false, 'creditos_usados', 0);
  END IF;

  v_cobrando := b.cobranca = 'por_varredura';
  v_varridos := GREATEST(b.varridos, LEAST(GREATEST(COALESCE(p_varridos, 0), 0), 1000000));
  v_usados := b.creditos_usados;
  IF v_cobrando THEN
    v_usados := GREATEST(b.creditos_usados,
                         LEAST(b.creditos_limite, ceil(v_varridos::numeric / b.seguidores_por_credito)::integer));
  END IF;

  UPDATE public.lista_fria_buscas
     SET varridos = v_varridos,
         creditos_usados = v_usados,
         heartbeat_at = now(),
         updated_at = now()
   WHERE id = b.id;

  IF p_custo_usd IS NOT NULL THEN
    INSERT INTO public.lista_fria_busca_custos (busca_id, custo_usd)
    VALUES (b.id, LEAST(GREATEST(p_custo_usd, 0), 100000))
    ON CONFLICT (busca_id) DO UPDATE
      SET custo_usd = GREATEST(public.lista_fria_busca_custos.custo_usd, EXCLUDED.custo_usd),
          updated_at = now();
  END IF;

  RETURN jsonb_build_object(
    'ativa', true,
    'cobrando', v_cobrando,
    'creditos_usados', v_usados,
    'limite_atingido', v_cobrando AND v_usados >= b.creditos_limite);
END
$fn$;

REVOKE ALL ON FUNCTION public.lista_fria_worker_varrer(uuid, text, integer, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lista_fria_worker_varrer(uuid, text, integer, numeric) TO service_role;
