-- 20271217000000_lista_fria_fundacao.sql
--
-- Lista Fria · entrega 1 (fundação: flag, buscas, resultados, créditos, importação).
-- Desenho: board Miro uXjVHlzya2A= (capítulo "Torque · Lista Fria" e mockups) · ADR-0042.
-- ROLLBACK pareado: rollback/20271217000000_lista_fria_fundacao.sql
--
-- ── DECISÕES DO CTO (27/10) ──────────────────────────────────────────────
-- (1) Duas fontes: Instagram (seguidores de uma conta) e Google Maps (nicho + cidade).
-- (2) Maps roda no gosom (open source), para baixar custo. Instagram segue o
--     modelo do Mailerfind: dado público do perfil, sem login do cliente.
-- (3) Busca por créditos: 1 crédito = 1 contato NOVO e válido. Quem já é lead
--     não é cobrado.
-- (4) Só exporta e importa. Sem disparo.
-- (5) O único teto é o saldo de créditos (reservado na criação da busca, o que
--     sobra volta no fim).
-- (6) O contato importado vira LEAD, numa seção própria da tela de Leads
--     ("Lista fria"), sem funil e sem card.
--
-- ── MODELO ───────────────────────────────────────────────────────────────
-- A busca e seus resultados vivem em tabelas próprias (lista_fria_*). Só a
-- IMPORTAÇÃO cria linha em `leads`, marcada por `leads.lista_fria_busca_id`.
-- Essa coluna é a única fronteira: a lista de Leads filtra por ela (aba "Lista
-- fria" × demais abas) e o gatilho de lead criado a respeita (seção 6).
--
-- ── FLAG ─────────────────────────────────────────────────────────────────
-- `organizations.feature_flags -> 'lista_fria' = true` (estritamente o booleano
-- true, mesma régua do useFeatureFlag). Mesmo desenho da Cobrança (ADR-0040):
-- NÃO usa feature_catalog + organization_features, porque lá o master enxerga
-- toda feature em toda org. Ligada aqui só na TorqueCRM (b2ad1ffb-…, slug
-- torquecrm). Em banco sem essa org o UPDATE afeta 0 linhas.
--
-- ── ACESSO ───────────────────────────────────────────────────────────────
-- Leitura: RLS contra private.lista_fria_orgs_visiveis() (flag E (master OU
-- membro com lista_fria.view)).
-- Escrita: só RPC SECURITY DEFINER, que passa por private.lista_fria_exigir()
-- (sessão → flag → assert_org_access → lista_fria.edit). As tabelas não têm
-- GRANT de escrita para authenticated. As RPCs do worker (lista_fria_worker_*)
-- só têm EXECUTE para service_role.
--
-- ── LEAD FRIO NÃO DISPARA NADA ───────────────────────────────────────────
-- Inserir um lead dispara (a) o gatilho `lead_created` do motor de automações
-- e (b) o webhook de saída `lead.created`. Contato de lista fria não pode
-- acionar nenhum dos dois: a org nunca pediu esse contato. As duas funções
-- ganham um retorno antecipado para `lista_fria_busca_id IS NOT NULL`. O corpo
-- é o que está em PRODUÇÃO em 27/10 (pg_get_functiondef), não o do repo.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Tabelas
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.lista_fria_buscas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fonte            text NOT NULL CHECK (fonte IN ('maps', 'instagram')),
  -- Maps
  nicho            text CHECK (nicho IS NULL OR length(btrim(nicho)) BETWEEN 2 AND 80),
  cidade           text CHECK (cidade IS NULL OR length(btrim(cidade)) BETWEEN 2 AND 80),
  -- Instagram: só o @ (sem arroba), já validado.
  instagram_handle text CHECK (instagram_handle IS NULL OR instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  status           text NOT NULL DEFAULT 'na_fila'
                   CHECK (status IN ('na_fila', 'executando', 'concluida', 'parada', 'falhou', 'cancelada')),
  etapa            text CHECK (etapa IN ('coletando', 'lendo_sites', 'ia', 'validando')),
  progresso        smallint NOT NULL DEFAULT 0 CHECK (progresso BETWEEN 0 AND 100),
  creditos_limite  integer NOT NULL CHECK (creditos_limite BETWEEN 1 AND 100000),
  creditos_usados  integer NOT NULL DEFAULT 0 CHECK (creditos_usados >= 0),
  -- Fim da busca devolveu o que sobrou da reserva? (idempotência do estorno)
  creditos_devolvidos boolean NOT NULL DEFAULT false,
  encontrados      integer NOT NULL DEFAULT 0 CHECK (encontrados >= 0),
  com_telefone     integer NOT NULL DEFAULT 0 CHECK (com_telefone >= 0),
  com_email        integer NOT NULL DEFAULT 0 CHECK (com_email >= 0),
  ja_leads         integer NOT NULL DEFAULT 0 CHECK (ja_leads >= 0),
  sem_contato      integer NOT NULL DEFAULT 0 CHECK (sem_contato >= 0),
  importados       integer NOT NULL DEFAULT 0 CHECK (importados >= 0),
  importada_em     timestamptz,
  erro             text CHECK (length(erro) <= 500),
  worker_id        text,
  heartbeat_at     timestamptz,
  started_at       timestamptz,
  finished_at      timestamptz,
  criado_por       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lista_fria_buscas_usados_no_limite CHECK (creditos_usados <= creditos_limite),
  CONSTRAINT lista_fria_buscas_fonte_tem_alvo CHECK (
    (fonte = 'maps' AND nicho IS NOT NULL AND cidade IS NOT NULL AND instagram_handle IS NULL)
    OR (fonte = 'instagram' AND instagram_handle IS NOT NULL AND nicho IS NULL AND cidade IS NULL)
  ),
  CONSTRAINT lista_fria_buscas_terminal_tem_fim CHECK (
    (status IN ('concluida', 'parada', 'falhou', 'cancelada')) = (finished_at IS NOT NULL)
  )
);
CREATE INDEX lista_fria_buscas_org ON public.lista_fria_buscas (organization_id, created_at DESC);
-- O worker só olha o que está na fila / rodando.
CREATE INDEX lista_fria_buscas_abertas ON public.lista_fria_buscas (created_at)
  WHERE status IN ('na_fila', 'executando');

CREATE TABLE public.lista_fria_resultados (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  busca_id        uuid NOT NULL REFERENCES public.lista_fria_buscas(id) ON DELETE CASCADE,
  -- place_id do Maps ou id do usuário no Instagram: a chave da busca.
  ref_externa     text NOT NULL CHECK (length(ref_externa) BETWEEN 1 AND 200),
  nome            text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 200),
  categoria       text CHECK (length(categoria) <= 120),
  -- Só dígitos, com DDI (ex.: 5511999990000).
  telefone        text CHECK (telefone ~ '^[0-9]{10,15}$'),
  email           text CHECK (email IS NULL OR (position('@' IN email) > 1 AND length(email) <= 254)),
  site            text CHECK (length(site) <= 500),
  endereco        text CHECK (length(endereco) <= 300),
  bairro          text CHECK (length(bairro) <= 120),
  instagram       text CHECK (instagram IS NULL OR instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  qualidade       text NOT NULL DEFAULT 'nao_verificado'
                  CHECK (qualidade IN ('verificado', 'sem_whatsapp', 'email_invalido', 'nao_verificado')),
  -- Já existia como lead da org quando a busca achou: não é cobrado nem importado.
  ja_e_lead       boolean NOT NULL DEFAULT false,
  -- A marcação do usuário na revisão. Só o que está selecionado é importado.
  selecionado     boolean NOT NULL DEFAULT true,
  lead_id         uuid,
  importado_em    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lista_fria_resultados_tem_contato CHECK (telefone IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT lista_fria_resultados_ref_unica UNIQUE (busca_id, ref_externa)
);
CREATE INDEX lista_fria_resultados_busca ON public.lista_fria_resultados (busca_id, created_at);
-- A importação anda pelo que falta importar.
CREATE INDEX lista_fria_resultados_pendentes ON public.lista_fria_resultados (busca_id)
  WHERE lead_id IS NULL AND NOT ja_e_lead AND selecionado;

-- Livro de créditos: só soma. O saldo é SUM(delta) da org.
CREATE TABLE public.lista_fria_creditos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  delta           integer NOT NULL CHECK (delta <> 0),
  motivo          text NOT NULL CHECK (motivo IN ('concessao', 'reserva', 'devolucao', 'ajuste')),
  busca_id        uuid REFERENCES public.lista_fria_buscas(id) ON DELETE SET NULL,
  nota            text CHECK (length(nota) <= 300),
  criado_por      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Reserva e devolução pertencem a uma busca; concessão e ajuste, a ninguém.
  CONSTRAINT lista_fria_creditos_busca_coerente CHECK (
    (motivo IN ('reserva', 'devolucao')) = (busca_id IS NOT NULL) OR busca_id IS NULL
  )
);
CREATE INDEX lista_fria_creditos_org ON public.lista_fria_creditos (organization_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. A coluna que separa o lead frio, e a guarda dela
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS lista_fria_busca_id uuid;
COMMENT ON COLUMN public.leads.lista_fria_busca_id IS
  'Busca da Lista Fria que originou o lead (lista_fria_buscas.id). NULL = lead comum. '
  'Preenchido, o lead aparece só na aba "Lista fria" de /leads, não nasce com gatilho '
  'de lead criado nem webhook, e fica fora das métricas. Só as RPCs da Lista Fria gravam.';

-- Parcial: quase toda linha é NULL, o índice só pesa o que é lista fria.
CREATE INDEX IF NOT EXISTS leads_lista_fria_idx
  ON public.leads (organization_id, created_at DESC)
  WHERE lista_fria_busca_id IS NOT NULL;

-- Quem marca é a RPC (SET LOCAL app.lista_fria_rpc = 'on') ou o service_role.
-- Sem isto, qualquer membro com UPDATE em leads empurraria um lead para a
-- seção, ou tiraria um da seção, pela API.
CREATE FUNCTION private.lista_fria_guarda_marca()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role'
     OR COALESCE(current_setting('app.lista_fria_rpc', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A seção Lista fria só muda pelas ações da própria Lista fria.'
    USING ERRCODE = '42501', DETAIL = 'lista_fria_marca_protegida';
END
$fn$;

CREATE TRIGGER leads_lista_fria_guarda_ins
  BEFORE INSERT ON public.leads
  FOR EACH ROW WHEN (NEW.lista_fria_busca_id IS NOT NULL)
  EXECUTE FUNCTION private.lista_fria_guarda_marca();
CREATE TRIGGER leads_lista_fria_guarda_upd
  BEFORE UPDATE OF lista_fria_busca_id ON public.leads
  FOR EACH ROW WHEN (NEW.lista_fria_busca_id IS DISTINCT FROM OLD.lista_fria_busca_id)
  EXECUTE FUNCTION private.lista_fria_guarda_marca();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Helpers de acesso (private)
-- ─────────────────────────────────────────────────────────────────────────

CREATE FUNCTION private.lista_fria_habilitada(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(
    (SELECT o.feature_flags -> 'lista_fria' = 'true'::jsonb
       FROM public.organizations o
      WHERE o.id = p_org),
    false);
$fn$;

CREATE FUNCTION private.lista_fria_orgs_visiveis()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT o.id
    FROM public.organizations o
   WHERE o.feature_flags -> 'lista_fria' = 'true'::jsonb
     AND (COALESCE(public.is_master_user(), false)
          OR public.has_feature_permission('lista_fria.view', o.id));
$fn$;

CREATE FUNCTION private.lista_fria_exigir(p_org uuid, p_acao text)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Sessão expirada. Entre de novo para continuar.'
      USING ERRCODE = '42501', DETAIL = 'sem_sessao';
  END IF;
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'Organização obrigatória.'
      USING ERRCODE = 'PT422', DETAIL = 'org_obrigatoria';
  END IF;
  IF NOT private.lista_fria_habilitada(p_org) THEN
    RAISE EXCEPTION 'A Lista fria não está liberada para esta organização.'
      USING ERRCODE = '42501', DETAIL = 'lista_fria_desligada';
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN;
  END IF;
  PERFORM public.assert_org_access(p_org);
  IF NOT public.has_feature_permission('lista_fria.' || p_acao, p_org) THEN
    RAISE EXCEPTION 'Você não tem permissão para usar a Lista fria.'
      USING ERRCODE = '42501', DETAIL = 'sem_permissao_lista_fria';
  END IF;
END
$fn$;

-- Saldo da org, sem checar acesso: uso interno das RPCs, que já passaram por exigir().
CREATE FUNCTION private.lista_fria_saldo_da_org(p_org uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(SUM(c.delta), 0)::integer
    FROM public.lista_fria_creditos c
   WHERE c.organization_id = p_org;
$fn$;

-- Só dígitos de um texto; NULL se não sobrar nada.
CREATE FUNCTION private.lista_fria_so_digitos(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT NULLIF(regexp_replace(COALESCE(p, ''), '\D', '', 'g'), '');
$fn$;

-- Devolve à org o que a busca reservou e não usou, e fecha a busca. Idempotente:
-- chamar de novo não devolve duas vezes.
CREATE FUNCTION private.lista_fria_encerrar(p_busca uuid, p_status text, p_erro text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  b public.lista_fria_buscas%ROWTYPE;
  v_sobra integer;
BEGIN
  SELECT * INTO b FROM public.lista_fria_buscas WHERE id = p_busca FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF b.status IN ('concluida', 'parada', 'falhou', 'cancelada') THEN
    RETURN;
  END IF;

  v_sobra := b.creditos_limite - b.creditos_usados;
  IF v_sobra > 0 AND NOT b.creditos_devolvidos THEN
    INSERT INTO public.lista_fria_creditos (organization_id, delta, motivo, busca_id, nota, criado_por)
    VALUES (b.organization_id, v_sobra, 'devolucao', b.id, 'Sobra da reserva da busca', NULL);
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

REVOKE ALL ON FUNCTION private.lista_fria_guarda_marca() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.lista_fria_habilitada(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.lista_fria_orgs_visiveis() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.lista_fria_exigir(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.lista_fria_saldo_da_org(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.lista_fria_so_digitos(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.lista_fria_encerrar(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.lista_fria_habilitada(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.lista_fria_orgs_visiveis() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.lista_fria_exigir(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION private.lista_fria_saldo_da_org(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.lista_fria_so_digitos(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.lista_fria_encerrar(uuid, text, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. RLS e grants
-- ─────────────────────────────────────────────────────────────────────────

DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lista_fria_buscas', 'lista_fria_resultados', 'lista_fria_creditos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (organization_id IN (SELECT private.lista_fria_orgs_visiveis()))',
      t || '_leitura', t);
  END LOOP;
END
$do$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. RPCs do usuário (public, SECURITY DEFINER)
-- ─────────────────────────────────────────────────────────────────────────

CREATE FUNCTION public.lista_fria_saldo(p_org uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM private.lista_fria_exigir(p_org, 'view');
  RETURN private.lista_fria_saldo_da_org(p_org);
END
$fn$;

-- Cria a busca e RESERVA os créditos. p_params:
--   maps:      { "nicho": "Dentistas", "cidade": "São Paulo - SP" }
--   instagram: { "url": "https://www.instagram.com/clinicaodontovida/" }
CREATE FUNCTION public.lista_fria_busca_criar(
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

CREATE FUNCTION public.lista_fria_busca_cancelar(p_busca uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org uuid;
  v_status text;
BEGIN
  SELECT organization_id, status INTO v_org, v_status FROM public.lista_fria_buscas WHERE id = p_busca;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Busca não encontrada.' USING ERRCODE = 'PT404', DETAIL = 'busca_inexistente';
  END IF;
  PERFORM private.lista_fria_exigir(v_org, 'edit');
  IF v_status NOT IN ('na_fila', 'executando') THEN
    RAISE EXCEPTION 'Esta busca já terminou.' USING ERRCODE = 'PT422', DETAIL = 'busca_encerrada';
  END IF;
  -- "Parar e ficar com o que achou": a busca em andamento vira 'parada' e guarda
  -- o que já achou; a que ainda está na fila vira 'cancelada'.
  PERFORM private.lista_fria_encerrar(p_busca, CASE WHEN v_status = 'executando' THEN 'parada' ELSE 'cancelada' END);
END
$fn$;

-- Marca ou desmarca resultados na revisão.
CREATE FUNCTION public.lista_fria_resultados_selecionar(p_busca uuid, p_ids uuid[], p_selecionado boolean)
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org uuid;
  v_n integer;
BEGIN
  SELECT organization_id INTO v_org FROM public.lista_fria_buscas WHERE id = p_busca;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Busca não encontrada.' USING ERRCODE = 'PT404', DETAIL = 'busca_inexistente';
  END IF;
  PERFORM private.lista_fria_exigir(v_org, 'edit');

  UPDATE public.lista_fria_resultados
     SET selecionado = COALESCE(p_selecionado, true)
   WHERE busca_id = p_busca
     AND lead_id IS NULL
     AND NOT ja_e_lead
     AND (p_ids IS NULL OR id = ANY (p_ids));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;

-- Importa o próximo lote (até p_limite) do que está selecionado e pendente, como
-- LEAD da seção Lista fria: sem funil, sem card, fora das métricas. A tela chama
-- de novo enquanto `restantes` > 0 (lote pequeno cabe no timeout da API).
CREATE FUNCTION public.lista_fria_importar(p_busca uuid, p_limite integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  b public.lista_fria_buscas%ROWTYPE;
  r public.lista_fria_resultados%ROWTYPE;
  v_lead uuid;
  v_novos integer := 0;
  v_repetidos integer := 0;
  v_restantes integer;
  v_notas text;
BEGIN
  SELECT * INTO b FROM public.lista_fria_buscas WHERE id = p_busca;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Busca não encontrada.' USING ERRCODE = 'PT404', DETAIL = 'busca_inexistente';
  END IF;
  PERFORM private.lista_fria_exigir(b.organization_id, 'edit');
  IF b.status NOT IN ('concluida', 'parada') THEN
    RAISE EXCEPTION 'A busca ainda não terminou.' USING ERRCODE = 'PT422', DETAIL = 'busca_em_andamento';
  END IF;
  p_limite := LEAST(GREATEST(COALESCE(p_limite, 200), 1), 500);

  -- Libera a marca em lead só dentro desta transação.
  PERFORM set_config('app.lista_fria_rpc', 'on', true);

  FOR r IN
    SELECT * FROM public.lista_fria_resultados
     WHERE busca_id = p_busca AND lead_id IS NULL AND NOT ja_e_lead AND selecionado
     ORDER BY created_at, id
     LIMIT p_limite
     FOR UPDATE SKIP LOCKED
  LOOP
    -- Corrida: virou lead (WhatsApp, planilha) entre a busca e a importação.
    IF (r.telefone IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.leads l
           WHERE l.organization_id = r.organization_id AND l.deleted_at IS NULL
             AND l.normalized_phone = public.normalize_brazilian_phone(r.telefone)))
       OR (r.email IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.leads l
           WHERE l.organization_id = r.organization_id AND l.deleted_at IS NULL
             AND lower(l.email) = lower(r.email))) THEN
      UPDATE public.lista_fria_resultados SET ja_e_lead = true WHERE id = r.id;
      v_repetidos := v_repetidos + 1;
      CONTINUE;
    END IF;

    v_notas := concat_ws(E'\n',
      'Lista fria · ' || CASE b.fonte
        WHEN 'maps' THEN 'Maps · ' || b.nicho || ', ' || b.cidade
        ELSE 'Instagram · @' || b.instagram_handle END,
      CASE WHEN r.site IS NOT NULL THEN 'Site: ' || r.site END,
      CASE WHEN r.endereco IS NOT NULL THEN 'Endereço: ' || r.endereco END,
      CASE WHEN r.instagram IS NOT NULL THEN 'Instagram: @' || r.instagram END);

    INSERT INTO public.leads (
      organization_id, name, phone, email, segment, origin, notes,
      lista_fria_busca_id, excluded_from_metrics
    ) VALUES (
      r.organization_id, r.nome, r.telefone, r.email, r.categoria, 'lista_fria', v_notas,
      b.id, true
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_lead;

    IF v_lead IS NULL THEN
      -- O índice único de telefone barrou: já é lead.
      UPDATE public.lista_fria_resultados SET ja_e_lead = true WHERE id = r.id;
      v_repetidos := v_repetidos + 1;
    ELSE
      UPDATE public.lista_fria_resultados
         SET lead_id = v_lead, importado_em = now()
       WHERE id = r.id;
      v_novos := v_novos + 1;
    END IF;
    v_lead := NULL;
  END LOOP;

  SELECT count(*) INTO v_restantes
    FROM public.lista_fria_resultados
   WHERE busca_id = p_busca AND lead_id IS NULL AND NOT ja_e_lead AND selecionado;

  UPDATE public.lista_fria_buscas
     SET importados = importados + v_novos,
         ja_leads = ja_leads + v_repetidos,
         importada_em = CASE WHEN v_restantes = 0 THEN now() ELSE importada_em END,
         updated_at = now()
   WHERE id = p_busca;

  RETURN jsonb_build_object('importados', v_novos, 'ja_eram_leads', v_repetidos, 'restantes', v_restantes);
END
$fn$;

-- Concessão de créditos: só master. Não há compra no produto ainda; quem libera
-- saldo é o time Torque, org a org.
CREATE FUNCTION public.lista_fria_creditos_conceder(p_org uuid, p_qtd integer, p_nota text DEFAULT NULL)
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
  IF p_qtd IS NULL OR p_qtd < 1 OR p_qtd > 1000000 THEN
    RAISE EXCEPTION 'Informe de 1 a 1.000.000 créditos.' USING ERRCODE = 'PT422', DETAIL = 'creditos_invalidos';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('lista_fria:' || p_org::text, 0));
  INSERT INTO public.lista_fria_creditos (organization_id, delta, motivo, nota)
  VALUES (p_org, p_qtd, 'concessao', left(p_nota, 300));
  RETURN private.lista_fria_saldo_da_org(p_org);
END
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. RPCs do worker (service_role)
-- ─────────────────────────────────────────────────────────────────────────

-- Pega a próxima busca da fila. SKIP LOCKED: dois workers nunca pegam a mesma.
-- Só orgs com a flag ligada: desligar a flag para a fila.
CREATE FUNCTION public.lista_fria_worker_reivindicar(p_worker text)
RETURNS SETOF public.lista_fria_buscas
LANGUAGE sql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
  UPDATE public.lista_fria_buscas b
     SET status = 'executando', worker_id = p_worker, started_at = now(),
         heartbeat_at = now(), etapa = 'coletando', updated_at = now()
   WHERE b.id = (
     SELECT x.id
       FROM public.lista_fria_buscas x
      WHERE x.status = 'na_fila'
        AND private.lista_fria_habilitada(x.organization_id)
      ORDER BY x.created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED)
  RETURNING b.*;
$fn$;

-- Progresso + sinal de vida. Devolve o status: se virou 'parada'/'cancelada', o
-- worker para de gastar.
CREATE FUNCTION public.lista_fria_worker_progresso(
  p_busca uuid, p_worker text, p_etapa text, p_progresso integer,
  p_encontrados integer, p_com_telefone integer, p_com_email integer, p_sem_contato integer
)
RETURNS text
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_status text;
BEGIN
  UPDATE public.lista_fria_buscas
     SET etapa = CASE WHEN status = 'executando' THEN p_etapa ELSE etapa END,
         progresso = CASE WHEN status = 'executando' THEN LEAST(GREATEST(COALESCE(p_progresso, progresso), 0), 99) ELSE progresso END,
         encontrados = GREATEST(encontrados, COALESCE(p_encontrados, 0)),
         com_telefone = GREATEST(com_telefone, COALESCE(p_com_telefone, 0)),
         com_email = GREATEST(com_email, COALESCE(p_com_email, 0)),
         sem_contato = GREATEST(sem_contato, COALESCE(p_sem_contato, 0)),
         heartbeat_at = now(),
         updated_at = now()
   WHERE id = p_busca AND worker_id = p_worker
  RETURNING status INTO v_status;
  RETURN COALESCE(v_status, 'cancelada');
END
$fn$;

-- Grava um lote de resultados e COBRA. Cada item novo e válido consome 1 crédito
-- da reserva; quem já é lead entra marcado e não consome. Passou do limite: para
-- de aceitar e devolve limite_atingido.
--   item: { ref_externa, nome, categoria?, telefone?, email?, site?, endereco?,
--           bairro?, instagram?, qualidade? }
CREATE FUNCTION public.lista_fria_worker_registrar(p_busca uuid, p_worker text, p_itens jsonb)
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

CREATE FUNCTION public.lista_fria_worker_encerrar(p_busca uuid, p_worker text, p_status text, p_erro text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF p_status NOT IN ('concluida', 'parada', 'falhou') THEN
    RAISE EXCEPTION 'Status final inválido.' USING ERRCODE = 'PT422', DETAIL = 'status_invalido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lista_fria_buscas WHERE id = p_busca AND worker_id = p_worker) THEN
    RETURN;
  END IF;
  PERFORM private.lista_fria_encerrar(p_busca, p_status, p_erro);
END
$fn$;

-- Busca 'executando' sem sinal de vida há 10 min: o worker morreu. Fecha como
-- falha e devolve a sobra da reserva. O worker chama isto a cada volta.
CREATE FUNCTION public.lista_fria_worker_recuperar_travadas()
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id uuid;
  v_n integer := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM public.lista_fria_buscas
     WHERE status = 'executando' AND heartbeat_at < now() - interval '10 minutes'
     FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM private.lista_fria_encerrar(v_id, 'falhou', 'worker_sem_sinal');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$fn$;

DO $do$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.lista_fria_saldo(uuid)',
    'public.lista_fria_busca_criar(uuid, text, jsonb, integer)',
    'public.lista_fria_busca_cancelar(uuid)',
    'public.lista_fria_resultados_selecionar(uuid, uuid[], boolean)',
    'public.lista_fria_importar(uuid, integer)',
    'public.lista_fria_creditos_conceder(uuid, integer, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'public.lista_fria_worker_reivindicar(text)',
    'public.lista_fria_worker_progresso(uuid, text, text, integer, integer, integer, integer, integer)',
    'public.lista_fria_worker_registrar(uuid, text, jsonb)',
    'public.lista_fria_worker_encerrar(uuid, text, text, text)',
    'public.lista_fria_worker_recuperar_travadas()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END
$do$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Lead frio não dispara gatilho de lead criado nem webhook de saída
-- ─────────────────────────────────────────────────────────────────────────
-- Corpo = produção em 27/10 (pg_get_functiondef) + a linha de retorno antecipado.

CREATE OR REPLACE FUNCTION public.trigger_workflow_lead_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Lista fria: o contato não pediu nada a esta org. Nenhuma automação nasce dele.
  IF NEW.lista_fria_busca_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.fire_workflow_trigger(
    NEW.organization_id,
    'lead_created',
    NEW.id,
    jsonb_build_object(
      'trigger', 'lead_created',
      'origin', COALESCE(NEW.origin::text, 'outro'),
      'pipe_type', 'pipe_whatsapp'
    )
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_lead_webhooks()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ev TEXT;
  payload JSONB;
  w RECORD;
BEGIN
  -- Lista fria: não vira evento para os sistemas de fora da org.
  IF NEW.lista_fria_busca_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    ev := 'lead.created';
  ELSIF TG_OP = 'UPDATE' THEN
    ev := 'lead.updated';
  ELSE
    RETURN NEW;
  END IF;

  payload := jsonb_build_object(
    'event', ev,
    'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'data', jsonb_build_object(
      'id', NEW.id,
      'name', NEW.name,
      'email', NEW.email,
      'phone', NEW.phone,
      'company', NEW.company,
      'organization_id', NEW.organization_id,
      'origin', NEW.origin
    )
  );

  FOR w IN
    SELECT id FROM public.webhooks
    WHERE organization_id = NEW.organization_id
      AND is_active = true
      AND events @> ARRAY[ev]::text[]
  LOOP
    INSERT INTO public.webhook_deliveries (webhook_id, event, payload, next_retry_at)
    VALUES (w.id, ev, payload, now());
  END LOOP;

  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Permissões (catálogo), origem e flag
-- ─────────────────────────────────────────────────────────────────────────

-- default_value false: admin e master passam por cima no has_feature_permission;
-- membro só com liberação.
INSERT INTO public.feature_permissions (key, module, name, description, is_admin_only, default_value, sort_order)
VALUES
  ('lista_fria.view', 'Lista fria', 'Ver a Lista fria',
   'Vê a aba Lista fria de Leads, as buscas, os resultados e o saldo de créditos.', false, false, 20),
  ('lista_fria.edit', 'Lista fria', 'Usar a Lista fria',
   'Cria buscas (gasta créditos), cancela buscas e importa os contatos encontrados.', false, false, 21)
ON CONFLICT (key) DO NOTHING;

-- Liga só na TorqueCRM. Em banco sem essa org, nada acontece.
UPDATE public.organizations
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"lista_fria": true}'::jsonb
 WHERE id = 'b2ad1ffb-e136-4356-846b-9f210f902573'
   AND slug = 'torquecrm';

-- A origem "Lista fria" para a org que tem a flag, no registro de origens
-- (as telas leem de lá; sem a linha o rótulo cai no slug cru).
INSERT INTO public.lead_origins (organization_id, name, slug, is_active)
SELECT o.id, 'Lista fria', 'lista_fria', true
  FROM public.organizations o
 WHERE o.feature_flags -> 'lista_fria' = 'true'::jsonb
   AND NOT EXISTS (
     SELECT 1 FROM public.lead_origins x WHERE x.organization_id = o.id AND x.slug = 'lista_fria');

COMMIT;
