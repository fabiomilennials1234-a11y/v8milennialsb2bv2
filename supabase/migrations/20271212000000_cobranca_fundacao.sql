-- 20271212000000_cobranca_fundacao.sql
--
-- Cobrança de inadimplência · entrega 1 (fundação, sem envio).
-- Desenho: board Miro uXjVHlzya2A= (BPMN, regras, mockups) · ADR-0040.
-- ROLLBACK pareado: rollback/20271212000000_cobranca_fundacao.sql
--
-- ── DECISÕES DO CTO (21/10) ──────────────────────────────────────────────
-- (1) Um caso (card) por inadimplente: índice único parcial em
--     cobranca_casos(inadimplente_id) WHERE encerrado_em IS NULL.
-- (2) Entrada por ERP, planilha e cadastro manual (`origem`). Esta entrega
--     cobre planilha e manual; o ERP (titulos_receber) entra na entrega 3 —
--     a coluna titulo_receber_id já existe para isso.
-- (3) O valor vem do ERP; título de planilha/manual usa o valor informado.
--     Nada aqui calcula juros ou multa.
-- (4) Negativação/protesto/jurídico são só registrados (etapa Jurídico).
-- (5) Cobrança e comercial são setores separados: inadimplente NÃO é lead,
--     nenhuma FK para `leads`, nenhuma linha em pipelines/pipeline_entries.
--     Por isso as métricas são isoladas por construção: nada que já existe
--     (sale_events, dashboard, Estúdio, "Todos os funis") lê estas tabelas.
-- (6) Sem alçada: o Torque só registra promessa/acordo; a negociação é humana.
-- (7) Dívida sem ERP baixa por "Registrar pagamento" (FIFO por vencimento).
-- (8) Acesso por permissão própria: cobranca.view / cobranca.edit
--     (default false para membro; master e admin da org passam).
--
-- ── FLAG ─────────────────────────────────────────────────────────────────
-- `organizations.feature_flags -> 'cobranca' = true` (estritamente o booleano
-- true, mesma regra do useFeatureFlag do front). NÃO usa feature_catalog +
-- organization_features: lá o master enxerga toda feature em toda org, e na
-- TorqueCRM só master entra — a área apareceria em todas as orgs para eles.
-- Ligada aqui só na TorqueCRM (b2ad1ffb-…, slug torquecrm). Em banco sem
-- essa org o UPDATE afeta 0 linhas.
--
-- ── ACESSO ───────────────────────────────────────────────────────────────
-- Leitura: RLS, uma policy por tabela, contra private.cobranca_orgs_visiveis()
--   (org com a flag E (master OU membro com cobranca.view)). Avaliada uma vez
--   por consulta (initplan), não por linha.
-- Escrita: só RPC SECURITY DEFINER (search_path ''), que checa a flag e
--   cobranca.edit via private.cobranca_exigir(). As tabelas não têm GRANT de
--   escrita para authenticated.
-- Histórico (cobranca_eventos) é append-only: nem as RPCs fazem UPDATE/DELETE.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Tabelas
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.cobranca_etapas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  nome            text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 60),
  posicao         integer NOT NULL,
  papel           text NOT NULL DEFAULT 'aberta'
                  CHECK (papel IN ('aberta', 'recuperado', 'perdido', 'cancelado')),
  cor             text NOT NULL DEFAULT '#3ea6f5' CHECK (cor ~ '^#[0-9a-fA-F]{6}$'),
  -- Etapa em que a régua (entrega 2) não toca o devedor.
  pausa_regua     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cobranca_etapas_posicao_unica UNIQUE (organization_id, posicao) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT cobranca_etapas_nome_unico UNIQUE (organization_id, nome)
);
-- Um desfecho de cada por org: é por ele que a baixa acha a coluna certa.
CREATE UNIQUE INDEX cobranca_etapas_um_desfecho_por_papel
  ON public.cobranca_etapas (organization_id, papel) WHERE papel <> 'aberta';

CREATE TABLE public.cobranca_inadimplentes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  nome               text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 200),
  -- Só dígitos: 11 (CPF) ou 14 (CNPJ). Formatação é da tela.
  documento          text CHECK (documento ~ '^([0-9]{11}|[0-9]{14})$'),
  -- Só dígitos, com DDI (ex.: 5548999990000).
  telefone           text CHECK (telefone ~ '^[0-9]{10,15}$'),
  email              text CHECK (email IS NULL OR (position('@' IN email) > 1 AND length(email) <= 254)),
  contato_nome       text CHECK (length(contato_nome) <= 120),
  cidade             text CHECK (length(cidade) <= 120),
  origem             text NOT NULL CHECK (origem IN ('erp', 'planilha', 'manual')),
  referencia_externa text CHECK (length(referencia_externa) <= 120),
  nao_contatar       boolean NOT NULL DEFAULT false,
  nao_contatar_em    timestamptz,
  observacoes        text CHECK (length(observacoes) <= 4000),
  criado_por         uuid DEFAULT auth.uid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  arquivado_em       timestamptz
);
CREATE UNIQUE INDEX cobranca_inadimplentes_documento_unico
  ON public.cobranca_inadimplentes (organization_id, documento)
  WHERE documento IS NOT NULL AND arquivado_em IS NULL;
CREATE INDEX cobranca_inadimplentes_telefone
  ON public.cobranca_inadimplentes (organization_id, telefone)
  WHERE telefone IS NOT NULL AND arquivado_em IS NULL;
CREATE INDEX cobranca_inadimplentes_org
  ON public.cobranca_inadimplentes (organization_id, created_at DESC)
  WHERE arquivado_em IS NULL;

CREATE TABLE public.cobranca_titulos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  inadimplente_id   uuid NOT NULL REFERENCES public.cobranca_inadimplentes(id) ON DELETE CASCADE,
  origem            text NOT NULL CHECK (origem IN ('erp', 'planilha', 'manual')),
  -- Entrega 3: o título do ERP aponta para titulos_receber e o saldo é lido de lá.
  titulo_receber_id uuid REFERENCES public.titulos_receber(id) ON DELETE SET NULL,
  numero            text CHECK (length(btrim(numero)) BETWEEN 1 AND 80),
  descricao         text CHECK (length(descricao) <= 300),
  valor             numeric(14, 2) NOT NULL CHECK (valor > 0),
  vencimento        date NOT NULL,
  -- baixado = dado como perda (caso fechado em Perdido): sai do saldo, fica no histórico.
  status            text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'pago', 'cancelado', 'baixado')),
  pago_em           date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cobranca_titulos_pago_tem_data CHECK ((status = 'pago') = (pago_em IS NOT NULL))
);
CREATE UNIQUE INDEX cobranca_titulos_numero_unico
  ON public.cobranca_titulos (inadimplente_id, numero) WHERE numero IS NOT NULL;
CREATE INDEX cobranca_titulos_abertos
  ON public.cobranca_titulos (inadimplente_id, vencimento) WHERE status = 'aberto';
CREATE INDEX cobranca_titulos_org ON public.cobranca_titulos (organization_id);

CREATE TABLE public.cobranca_casos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  inadimplente_id uuid NOT NULL REFERENCES public.cobranca_inadimplentes(id) ON DELETE CASCADE,
  etapa_id        uuid NOT NULL REFERENCES public.cobranca_etapas(id) ON DELETE RESTRICT,
  responsavel_id  uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  -- Ordem dentro da coluna (fracionária: inserir entre dois não renumera).
  posicao         double precision NOT NULL DEFAULT 0,
  aberto_em       timestamptz NOT NULL DEFAULT now(),
  etapa_desde     timestamptz NOT NULL DEFAULT now(),
  encerrado_em    timestamptz,
  desfecho        text CHECK (desfecho IN ('recuperado', 'perdido', 'cancelado')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cobranca_casos_desfecho_fecha CHECK ((encerrado_em IS NULL) = (desfecho IS NULL))
);
-- Decisão (1): um card por inadimplente.
CREATE UNIQUE INDEX cobranca_casos_um_aberto_por_inadimplente
  ON public.cobranca_casos (inadimplente_id) WHERE encerrado_em IS NULL;
CREATE INDEX cobranca_casos_quadro
  ON public.cobranca_casos (organization_id, etapa_id, posicao);
CREATE INDEX cobranca_casos_encerrados
  ON public.cobranca_casos (organization_id, encerrado_em DESC) WHERE encerrado_em IS NOT NULL;

CREATE TABLE public.cobranca_compromissos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  caso_id         uuid NOT NULL REFERENCES public.cobranca_casos(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN ('promessa', 'acordo')),
  status          text NOT NULL DEFAULT 'ativo'
                  CHECK (status IN ('ativo', 'cumprido', 'quebrado', 'cancelado')),
  observacao      text CHECK (length(observacao) <= 2000),
  criado_por      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  encerrado_em    timestamptz,
  CONSTRAINT cobranca_compromissos_encerrado CHECK ((status = 'ativo') = (encerrado_em IS NULL))
);
CREATE UNIQUE INDEX cobranca_compromissos_um_ativo_por_caso
  ON public.cobranca_compromissos (caso_id) WHERE status = 'ativo';

CREATE TABLE public.cobranca_compromisso_parcelas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  compromisso_id  uuid NOT NULL REFERENCES public.cobranca_compromissos(id) ON DELETE CASCADE,
  numero          smallint NOT NULL CHECK (numero BETWEEN 1 AND 120),
  vencimento      date NOT NULL,
  valor           numeric(14, 2) NOT NULL CHECK (valor > 0),
  CONSTRAINT cobranca_parcelas_numero_unico UNIQUE (compromisso_id, numero)
);
CREATE INDEX cobranca_parcelas_vencimento
  ON public.cobranca_compromisso_parcelas (organization_id, vencimento);

CREATE TABLE public.cobranca_pagamentos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  caso_id         uuid NOT NULL REFERENCES public.cobranca_casos(id) ON DELETE CASCADE,
  titulo_id       uuid NOT NULL REFERENCES public.cobranca_titulos(id) ON DELETE CASCADE,
  valor           numeric(14, 2) NOT NULL CHECK (valor > 0),
  pago_em         date NOT NULL,
  origem          text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'erp')),
  -- Um registro de pagamento vira N linhas (uma por título, FIFO). O lote as junta.
  lote            uuid NOT NULL,
  registrado_por  uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cobranca_pagamentos_titulo ON public.cobranca_pagamentos (titulo_id);
CREATE INDEX cobranca_pagamentos_org_data ON public.cobranca_pagamentos (organization_id, pago_em);

CREATE TABLE public.cobranca_eventos (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  inadimplente_id uuid NOT NULL REFERENCES public.cobranca_inadimplentes(id) ON DELETE CASCADE,
  caso_id         uuid REFERENCES public.cobranca_casos(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN (
                    'inadimplente_criado', 'inadimplente_editado', 'inadimplente_arquivado',
                    'titulo_incluido', 'titulo_cancelado', 'importado',
                    'caso_aberto', 'etapa_alterada', 'responsavel_alterado', 'caso_encerrado',
                    'promessa_registrada', 'acordo_registrado', 'compromisso_encerrado',
                    'pagamento_registrado', 'contato_registrado', 'nao_contatar_alterado')),
  dados           jsonb NOT NULL DEFAULT '{}'::jsonb,
  autor_id        uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cobranca_eventos_inadimplente
  ON public.cobranca_eventos (inadimplente_id, created_at DESC);
CREATE INDEX cobranca_eventos_contato
  ON public.cobranca_eventos (caso_id, created_at DESC) WHERE tipo = 'contato_registrado';

CREATE TRIGGER trg_cobranca_etapas_updated_at BEFORE UPDATE ON public.cobranca_etapas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_cobranca_inadimplentes_updated_at BEFORE UPDATE ON public.cobranca_inadimplentes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_cobranca_titulos_updated_at BEFORE UPDATE ON public.cobranca_titulos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_cobranca_casos_updated_at BEFORE UPDATE ON public.cobranca_casos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_cobranca_compromissos_updated_at BEFORE UPDATE ON public.cobranca_compromissos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Helpers de acesso (private)
-- ─────────────────────────────────────────────────────────────────────────

-- A flag, com a mesma régua do useFeatureFlag: só o booleano true liga.
CREATE FUNCTION private.cobranca_habilitada(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(
    (SELECT o.feature_flags -> 'cobranca' = 'true'::jsonb
       FROM public.organizations o
      WHERE o.id = p_org),
    false);
$fn$;

-- Orgs cuja cobrança o usuário corrente pode LER. Poucas orgs têm a flag, então
-- o conjunto é pequeno; a RLS o consulta uma vez por statement (initplan).
CREATE FUNCTION private.cobranca_orgs_visiveis()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT o.id
    FROM public.organizations o
   WHERE o.feature_flags -> 'cobranca' = 'true'::jsonb
     AND (COALESCE(public.is_master_user(), false)
          OR public.has_feature_permission('cobranca.view', o.id));
$fn$;

-- Porta única das RPCs de escrita: sessão, flag e permissão, nesta ordem.
CREATE FUNCTION private.cobranca_exigir(p_org uuid, p_acao text)
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
  IF NOT private.cobranca_habilitada(p_org) THEN
    RAISE EXCEPTION 'A área de cobrança não está liberada para esta organização.'
      USING ERRCODE = '42501', DETAIL = 'cobranca_desligada';
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN;
  END IF;
  PERFORM public.assert_org_access(p_org);
  IF NOT public.has_feature_permission('cobranca.' || p_acao, p_org) THEN
    RAISE EXCEPTION 'Você não tem permissão para operar a cobrança.'
      USING ERRCODE = '42501', DETAIL = 'sem_permissao_cobranca';
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION private.cobranca_habilitada(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.cobranca_orgs_visiveis() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.cobranca_exigir(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.cobranca_habilitada(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.cobranca_orgs_visiveis() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.cobranca_exigir(uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RLS e grants
-- ─────────────────────────────────────────────────────────────────────────

DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cobranca_etapas', 'cobranca_inadimplentes', 'cobranca_titulos', 'cobranca_casos',
    'cobranca_compromissos', 'cobranca_compromisso_parcelas', 'cobranca_pagamentos',
    'cobranca_eventos'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (organization_id IN (SELECT private.cobranca_orgs_visiveis()))',
      t || '_select', t);
  END LOOP;
END
$do$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Leitura: views (security_invoker — a RLS das tabelas decide)
-- ─────────────────────────────────────────────────────────────────────────

-- Saldo de cada título: valor menos o que já foi pago nele.
CREATE VIEW public.cobranca_titulos_saldo
WITH (security_invoker = true) AS
SELECT t.id,
       t.organization_id,
       t.inadimplente_id,
       t.origem,
       t.numero,
       t.descricao,
       t.valor,
       t.vencimento,
       t.status,
       t.pago_em,
       COALESCE(p.pago, 0)::numeric(14, 2)                           AS valor_pago,
       CASE WHEN t.status = 'aberto'
            THEN GREATEST(t.valor - COALESCE(p.pago, 0), 0)
            ELSE 0 END::numeric(14, 2)                                AS saldo,
       t.created_at
  FROM public.cobranca_titulos t
  LEFT JOIN LATERAL (
    SELECT sum(pg.valor) AS pago
      FROM public.cobranca_pagamentos pg
     WHERE pg.titulo_id = t.id
  ) p ON true;

-- Uma linha por inadimplente não arquivado, com o caso aberto (se houver).
CREATE VIEW public.cobranca_inadimplentes_resumo
WITH (security_invoker = true) AS
SELECT i.id,
       i.organization_id,
       i.nome,
       i.documento,
       i.telefone,
       i.email,
       i.contato_nome,
       i.cidade,
       i.origem,
       i.nao_contatar,
       i.created_at,
       c.id              AS caso_id,
       c.etapa_id,
       e.nome            AS etapa_nome,
       e.papel           AS etapa_papel,
       e.cor             AS etapa_cor,
       c.responsavel_id,
       tm.name           AS responsavel_nome,
       c.posicao,
       c.aberto_em,
       c.etapa_desde,
       COALESCE(s.titulos_abertos, 0)::integer        AS titulos_abertos,
       COALESCE(s.saldo_aberto, 0)::numeric(14, 2)    AS saldo_aberto,
       s.vencimento_mais_antigo,
       cp.tipo                                        AS compromisso_tipo,
       cp.proxima_vencimento                          AS compromisso_proxima_vencimento,
       cp.proxima_valor                               AS compromisso_proxima_valor,
       cp.parcelas_total                              AS compromisso_parcelas,
       uc.ultimo_contato_em,
       uc.ultimo_contato_canal,
       ud.desfecho       AS ultimo_desfecho,
       ud.encerrado_em   AS ultimo_encerramento
  FROM public.cobranca_inadimplentes i
  LEFT JOIN public.cobranca_casos c
         ON c.inadimplente_id = i.id AND c.encerrado_em IS NULL
  LEFT JOIN public.cobranca_etapas e ON e.id = c.etapa_id
  LEFT JOIN public.team_members tm ON tm.id = c.responsavel_id
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE ts.saldo > 0) AS titulos_abertos,
           sum(ts.saldo)                        AS saldo_aberto,
           min(ts.vencimento) FILTER (WHERE ts.saldo > 0) AS vencimento_mais_antigo
      FROM public.cobranca_titulos_saldo ts
     WHERE ts.inadimplente_id = i.id
  ) s ON true
  LEFT JOIN LATERAL (
    SELECT co.tipo,
           (SELECT count(*) FROM public.cobranca_compromisso_parcelas pa
             WHERE pa.compromisso_id = co.id)::integer AS parcelas_total,
           nx.vencimento AS proxima_vencimento,
           nx.valor      AS proxima_valor
      FROM public.cobranca_compromissos co
      LEFT JOIN LATERAL (
        SELECT pa.vencimento, pa.valor
          FROM public.cobranca_compromisso_parcelas pa
         WHERE pa.compromisso_id = co.id
           AND pa.vencimento >= CURRENT_DATE - 1
         ORDER BY pa.vencimento
         LIMIT 1
      ) nx ON true
     WHERE co.caso_id = c.id AND co.status = 'ativo'
  ) cp ON true
  LEFT JOIN LATERAL (
    SELECT ev.created_at AS ultimo_contato_em,
           ev.dados ->> 'canal' AS ultimo_contato_canal
      FROM public.cobranca_eventos ev
     WHERE ev.caso_id = c.id AND ev.tipo = 'contato_registrado'
     ORDER BY ev.created_at DESC
     LIMIT 1
  ) uc ON true
  LEFT JOIN LATERAL (
    SELECT cf.desfecho, cf.encerrado_em
      FROM public.cobranca_casos cf
     WHERE cf.inadimplente_id = i.id AND cf.encerrado_em IS NOT NULL AND c.id IS NULL
     ORDER BY cf.encerrado_em DESC
     LIMIT 1
  ) ud ON true
 WHERE i.arquivado_em IS NULL;

REVOKE ALL ON public.cobranca_titulos_saldo FROM PUBLIC, anon;
REVOKE ALL ON public.cobranca_inadimplentes_resumo FROM PUBLIC, anon;
GRANT SELECT ON public.cobranca_titulos_saldo TO authenticated, service_role;
GRANT SELECT ON public.cobranca_inadimplentes_resumo TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Internos (sem EXECUTE para clientes)
-- ─────────────────────────────────────────────────────────────────────────

-- Semeia as etapas padrão (decisão de 21/10) se a org ainda não tem nenhuma.
CREATE FUNCTION private.cobranca_semear_etapas(p_org uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cobranca_etapas WHERE organization_id = p_org) THEN
    RETURN;
  END IF;
  INSERT INTO public.cobranca_etapas (organization_id, nome, posicao, papel, cor, pausa_regua) VALUES
    (p_org, 'Vencido',            1, 'aberta',     '#7cc3f8', false),
    (p_org, 'Em cobrança',        2, 'aberta',     '#3ea6f5', false),
    (p_org, 'Em negociação',      3, 'aberta',     '#a78bfa', true),
    (p_org, 'Promessa ou acordo', 4, 'aberta',     '#ffc800', true),
    (p_org, 'Cobrança intensiva', 5, 'aberta',     '#fb923c', false),
    (p_org, 'Jurídico',           6, 'aberta',     '#f26d6d', true),
    (p_org, 'Recuperado',         7, 'recuperado', '#50d685', true),
    (p_org, 'Perdido',            8, 'perdido',    '#ef4444', true),
    (p_org, 'Cancelado',          9, 'cancelado',  '#a3a3a3', true);
END
$fn$;

CREATE FUNCTION private.cobranca_evento(
  p_org uuid, p_inadimplente uuid, p_caso uuid, p_tipo text, p_dados jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
  INSERT INTO public.cobranca_eventos (organization_id, inadimplente_id, caso_id, tipo, dados)
  VALUES (p_org, p_inadimplente, p_caso, p_tipo, COALESCE(p_dados, '{}'::jsonb));
$fn$;

-- Abre o caso do inadimplente se ele tem saldo e nenhum caso aberto.
-- Devolve o id do caso aberto (novo ou existente), ou NULL sem saldo.
CREATE FUNCTION private.cobranca_garantir_caso(p_inadimplente uuid, p_responsavel uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org   uuid;
  v_caso  uuid;
  v_etapa uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.cobranca_inadimplentes WHERE id = p_inadimplente;

  SELECT id INTO v_caso FROM public.cobranca_casos
   WHERE inadimplente_id = p_inadimplente AND encerrado_em IS NULL;
  IF v_caso IS NOT NULL THEN
    RETURN v_caso;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cobranca_titulos_saldo
                  WHERE inadimplente_id = p_inadimplente AND saldo > 0) THEN
    RETURN NULL;
  END IF;

  PERFORM private.cobranca_semear_etapas(v_org);
  SELECT id INTO v_etapa FROM public.cobranca_etapas
   WHERE organization_id = v_org AND papel = 'aberta'
   ORDER BY posicao LIMIT 1;

  INSERT INTO public.cobranca_casos (organization_id, inadimplente_id, etapa_id, responsavel_id, posicao)
  VALUES (v_org, p_inadimplente, v_etapa, p_responsavel,
          COALESCE((SELECT max(posicao) FROM public.cobranca_casos
                     WHERE etapa_id = v_etapa AND encerrado_em IS NULL), 0) + 1)
  RETURNING id INTO v_caso;

  PERFORM private.cobranca_evento(v_org, p_inadimplente, v_caso, 'caso_aberto',
                                  jsonb_build_object('etapa_id', v_etapa));
  RETURN v_caso;
END
$fn$;

-- Fecha o caso numa coluna de desfecho. Chamado pela baixa e pelo mover.
CREATE FUNCTION private.cobranca_encerrar_caso(p_caso uuid, p_desfecho text)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_caso  public.cobranca_casos%ROWTYPE;
  v_etapa uuid;
BEGIN
  SELECT * INTO v_caso FROM public.cobranca_casos WHERE id = p_caso FOR UPDATE;
  IF v_caso.encerrado_em IS NOT NULL THEN
    RETURN;
  END IF;
  PERFORM private.cobranca_semear_etapas(v_caso.organization_id);
  SELECT id INTO v_etapa FROM public.cobranca_etapas
   WHERE organization_id = v_caso.organization_id AND papel = p_desfecho;

  UPDATE public.cobranca_casos
     SET etapa_id = v_etapa, etapa_desde = now(), encerrado_em = now(), desfecho = p_desfecho
   WHERE id = p_caso;

  -- Perdido: a dívida é dada como perda. Sai do saldo (não reabre o caso numa
  -- reimportação da mesma planilha) e fica no histórico com o valor.
  IF p_desfecho = 'perdido' THEN
    UPDATE public.cobranca_titulos SET status = 'baixado'
     WHERE inadimplente_id = v_caso.inadimplente_id AND status = 'aberto';
  END IF;

  UPDATE public.cobranca_compromissos
     SET status = CASE WHEN p_desfecho = 'recuperado' THEN 'cumprido' ELSE 'cancelado' END,
         encerrado_em = now()
   WHERE caso_id = p_caso AND status = 'ativo';

  PERFORM private.cobranca_evento(v_caso.organization_id, v_caso.inadimplente_id, p_caso,
    'caso_encerrado', jsonb_build_object('desfecho', p_desfecho, 'etapa_anterior', v_caso.etapa_id));
END
$fn$;

REVOKE ALL ON FUNCTION private.cobranca_semear_etapas(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cobranca_evento(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cobranca_garantir_caso(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cobranca_encerrar_caso(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.cobranca_semear_etapas(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.cobranca_evento(uuid, uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.cobranca_garantir_caso(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.cobranca_encerrar_caso(uuid, text) TO service_role;

-- Normalização compartilhada pelas RPCs (pura).
CREATE FUNCTION private.cobranca_so_digitos(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT NULLIF(regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g'), '');
$fn$;
REVOKE ALL ON FUNCTION private.cobranca_so_digitos(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.cobranca_so_digitos(text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. RPCs públicas
-- ─────────────────────────────────────────────────────────────────────────

-- Garante as etapas da org (a tela chama ao abrir o Fluxo pela primeira vez).
CREATE FUNCTION public.cobranca_etapas_garantir(p_org uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'view');
  PERFORM private.cobranca_semear_etapas(p_org);
  RETURN (SELECT count(*)::integer FROM public.cobranca_etapas WHERE organization_id = p_org);
END
$fn$;

-- Cria (p_id NULL) ou edita um inadimplente. Na criação aceita títulos e o
-- responsável do caso. Devolve o id.
--   p_dados: { nome, documento?, telefone?, email?, contato_nome?, cidade?,
--              observacoes?, responsavel_id?, titulos?: [{numero?, descricao?, valor, vencimento}] }
CREATE FUNCTION public.cobranca_inadimplente_salvar(p_org uuid, p_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id      uuid := p_id;
  v_nome    text := NULLIF(btrim(p_dados ->> 'nome'), '');
  v_doc     text := private.cobranca_so_digitos(p_dados ->> 'documento');
  v_tel     text := private.cobranca_so_digitos(p_dados ->> 'telefone');
  v_email   text := NULLIF(lower(btrim(p_dados ->> 'email')), '');
  v_resp    uuid := NULLIF(p_dados ->> 'responsavel_id', '')::uuid;
  v_titulo  jsonb;
  v_n       integer := 0;
  v_caso    uuid;
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'edit');

  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'Informe o nome do inadimplente.'
      USING ERRCODE = 'PT422', DETAIL = 'nome_obrigatorio';
  END IF;
  IF v_doc IS NOT NULL AND length(v_doc) NOT IN (11, 14) THEN
    RAISE EXCEPTION 'CPF ou CNPJ inválido.'
      USING ERRCODE = 'PT422', DETAIL = 'documento_invalido';
  END IF;
  IF v_tel IS NOT NULL AND length(v_tel) NOT BETWEEN 10 AND 15 THEN
    RAISE EXCEPTION 'Telefone inválido.'
      USING ERRCODE = 'PT422', DETAIL = 'telefone_invalido';
  END IF;
  IF v_doc IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.cobranca_inadimplentes
        WHERE organization_id = p_org AND documento = v_doc AND arquivado_em IS NULL
          AND id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Já existe um inadimplente com este CPF/CNPJ.'
      USING ERRCODE = 'PT409', DETAIL = 'documento_duplicado';
  END IF;
  IF v_resp IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.team_members
        WHERE id = v_resp AND organization_id = p_org AND is_active) THEN
    RAISE EXCEPTION 'Responsável não pertence a esta organização.'
      USING ERRCODE = 'PT422', DETAIL = 'responsavel_invalido';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.cobranca_inadimplentes
      (organization_id, nome, documento, telefone, email, contato_nome, cidade, origem, observacoes)
    VALUES
      (p_org, v_nome, v_doc, v_tel, v_email,
       NULLIF(btrim(p_dados ->> 'contato_nome'), ''), NULLIF(btrim(p_dados ->> 'cidade'), ''),
       'manual', NULLIF(btrim(p_dados ->> 'observacoes'), ''))
    RETURNING id INTO v_id;
    PERFORM private.cobranca_evento(p_org, v_id, NULL, 'inadimplente_criado',
                                    jsonb_build_object('origem', 'manual'));

    FOR v_titulo IN SELECT * FROM jsonb_array_elements(COALESCE(p_dados -> 'titulos', '[]'::jsonb)) LOOP
      PERFORM public.cobranca_titulo_incluir(v_id, v_titulo);
      v_n := v_n + 1;
    END LOOP;
    v_caso := private.cobranca_garantir_caso(v_id, v_resp);
    -- O caso pode ter nascido no primeiro título (sem responsável): completa.
    IF v_caso IS NOT NULL AND v_resp IS NOT NULL THEN
      UPDATE public.cobranca_casos SET responsavel_id = v_resp
       WHERE id = v_caso AND responsavel_id IS NULL;
    END IF;
  ELSE
    UPDATE public.cobranca_inadimplentes
       SET nome = v_nome, documento = v_doc, telefone = v_tel, email = v_email,
           contato_nome = NULLIF(btrim(p_dados ->> 'contato_nome'), ''),
           cidade = NULLIF(btrim(p_dados ->> 'cidade'), ''),
           observacoes = NULLIF(btrim(p_dados ->> 'observacoes'), '')
     WHERE id = v_id AND organization_id = p_org AND arquivado_em IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Inadimplente não encontrado.'
        USING ERRCODE = 'PT404', DETAIL = 'inadimplente_nao_encontrado';
    END IF;
    PERFORM private.cobranca_evento(p_org, v_id, NULL, 'inadimplente_editado', '{}'::jsonb);
  END IF;

  RETURN v_id;
END
$fn$;

-- Inclui um título manual num inadimplente. Abre o caso se não houver.
--   p_dados: { numero?, descricao?, valor, vencimento (aaaa-mm-dd) }
CREATE FUNCTION public.cobranca_titulo_incluir(p_inadimplente uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org    uuid;
  v_id     uuid;
  v_valor  numeric;
  v_venc   date;
  v_numero text := NULLIF(btrim(p_dados ->> 'numero'), '');
BEGIN
  SELECT organization_id INTO v_org FROM public.cobranca_inadimplentes
   WHERE id = p_inadimplente AND arquivado_em IS NULL;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Inadimplente não encontrado.'
      USING ERRCODE = 'PT404', DETAIL = 'inadimplente_nao_encontrado';
  END IF;
  PERFORM private.cobranca_exigir(v_org, 'edit');

  BEGIN
    v_valor := round((p_dados ->> 'valor')::numeric, 2);
    v_venc  := (p_dados ->> 'vencimento')::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Valor ou vencimento inválido.'
      USING ERRCODE = 'PT422', DETAIL = 'titulo_invalido';
  END;
  IF v_valor IS NULL OR v_valor <= 0 OR v_venc IS NULL THEN
    RAISE EXCEPTION 'Informe valor maior que zero e o vencimento.'
      USING ERRCODE = 'PT422', DETAIL = 'titulo_invalido';
  END IF;
  IF v_numero IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.cobranca_titulos
        WHERE inadimplente_id = p_inadimplente AND numero = v_numero) THEN
    RAISE EXCEPTION 'Este inadimplente já tem um título com esse número.'
      USING ERRCODE = 'PT409', DETAIL = 'titulo_duplicado';
  END IF;

  INSERT INTO public.cobranca_titulos (organization_id, inadimplente_id, origem, numero, descricao, valor, vencimento)
  VALUES (v_org, p_inadimplente, 'manual', v_numero, NULLIF(btrim(p_dados ->> 'descricao'), ''), v_valor, v_venc)
  RETURNING id INTO v_id;

  PERFORM private.cobranca_evento(v_org, p_inadimplente,
    (SELECT id FROM public.cobranca_casos WHERE inadimplente_id = p_inadimplente AND encerrado_em IS NULL),
    'titulo_incluido', jsonb_build_object('titulo_id', v_id, 'valor', v_valor, 'vencimento', v_venc));
  PERFORM private.cobranca_garantir_caso(p_inadimplente);
  RETURN v_id;
END
$fn$;

-- Cancela um título (contestação procedente, lançamento errado). Sem saldo
-- restante, o caso fecha em Cancelado — ou em Recuperado, se algo foi pago.
CREATE FUNCTION public.cobranca_titulo_cancelar(p_titulo uuid, p_motivo text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_t    public.cobranca_titulos%ROWTYPE;
  v_caso uuid;
BEGIN
  SELECT * INTO v_t FROM public.cobranca_titulos WHERE id = p_titulo FOR UPDATE;
  IF v_t.id IS NULL THEN
    RAISE EXCEPTION 'Título não encontrado.' USING ERRCODE = 'PT404', DETAIL = 'titulo_nao_encontrado';
  END IF;
  PERFORM private.cobranca_exigir(v_t.organization_id, 'edit');
  IF NULLIF(btrim(p_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = 'PT422', DETAIL = 'motivo_obrigatorio';
  END IF;
  IF v_t.status <> 'aberto' THEN
    RAISE EXCEPTION 'Só título em aberto pode ser cancelado.' USING ERRCODE = 'PT422', DETAIL = 'titulo_nao_aberto';
  END IF;

  UPDATE public.cobranca_titulos SET status = 'cancelado' WHERE id = p_titulo;
  SELECT id INTO v_caso FROM public.cobranca_casos
   WHERE inadimplente_id = v_t.inadimplente_id AND encerrado_em IS NULL;
  PERFORM private.cobranca_evento(v_t.organization_id, v_t.inadimplente_id, v_caso, 'titulo_cancelado',
    jsonb_build_object('titulo_id', p_titulo, 'motivo', btrim(p_motivo)));

  IF v_caso IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.cobranca_titulos_saldo
        WHERE inadimplente_id = v_t.inadimplente_id AND saldo > 0) THEN
    PERFORM private.cobranca_encerrar_caso(v_caso,
      CASE WHEN EXISTS (SELECT 1 FROM public.cobranca_pagamentos WHERE caso_id = v_caso)
           THEN 'recuperado' ELSE 'cancelado' END);
  END IF;
  RETURN p_titulo;
END
$fn$;

-- Importa linhas de planilha (o navegador já leu o arquivo). Agrupa por
-- inadimplente (CPF/CNPJ; sem documento, telefone), cria ou reaproveita o
-- inadimplente, inclui ou atualiza títulos (por número) e abre os casos.
-- Com p_dry_run = true só conta — nada é gravado.
--   p_linhas: [{ nome, documento?, telefone?, email?, contato_nome?, cidade?,
--                numero?, descricao?, valor, vencimento }]
CREATE FUNCTION public.cobranca_importar(p_org uuid, p_linhas jsonb, p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_linha      jsonb;
  v_idx        integer := 0;
  v_nome       text;
  v_doc        text;
  v_tel        text;
  v_numero     text;
  v_valor      numeric;
  v_venc       date;
  v_inad       uuid;
  v_tit        uuid;
  v_invalidas  jsonb := '[]'::jsonb;
  v_novos      integer := 0;
  v_existentes integer := 0;
  v_tit_novos  integer := 0;
  v_tit_atual  integer := 0;
  v_casos      integer := 0;
  v_vistos     uuid[] := '{}';
  v_chaves     text[] := '{}';
  v_chave      text;
  v_tit_chave  text;
  v_tit_vistos text[] := '{}';
  v_caso_antes uuid;
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'edit');
  IF jsonb_typeof(p_linhas) <> 'array' THEN
    RAISE EXCEPTION 'Formato de importação inválido.' USING ERRCODE = 'PT422', DETAIL = 'linhas_invalidas';
  END IF;
  IF jsonb_array_length(p_linhas) > 2000 THEN
    RAISE EXCEPTION 'Importe no máximo 2.000 linhas por vez.' USING ERRCODE = 'PT422', DETAIL = 'linhas_demais';
  END IF;

  FOR v_linha IN SELECT * FROM jsonb_array_elements(p_linhas) LOOP
    v_idx := v_idx + 1;
    v_nome   := NULLIF(btrim(v_linha ->> 'nome'), '');
    v_doc    := private.cobranca_so_digitos(v_linha ->> 'documento');
    v_tel    := private.cobranca_so_digitos(v_linha ->> 'telefone');
    v_numero := NULLIF(btrim(v_linha ->> 'numero'), '');

    BEGIN
      v_valor := round((v_linha ->> 'valor')::numeric, 2);
      v_venc  := (v_linha ->> 'vencimento')::date;
    EXCEPTION WHEN others THEN
      v_invalidas := v_invalidas || jsonb_build_object('linha', v_idx, 'motivo', 'valor ou vencimento ilegível');
      CONTINUE;
    END;

    IF v_nome IS NULL THEN
      v_invalidas := v_invalidas || jsonb_build_object('linha', v_idx, 'motivo', 'sem nome');
      CONTINUE;
    END IF;
    IF v_doc IS NOT NULL AND length(v_doc) NOT IN (11, 14) THEN
      v_invalidas := v_invalidas || jsonb_build_object('linha', v_idx, 'motivo', 'CPF/CNPJ inválido');
      CONTINUE;
    END IF;
    IF v_tel IS NOT NULL AND length(v_tel) NOT BETWEEN 10 AND 15 THEN
      v_invalidas := v_invalidas || jsonb_build_object('linha', v_idx, 'motivo', 'telefone inválido');
      CONTINUE;
    END IF;
    IF v_doc IS NULL AND v_tel IS NULL THEN
      v_invalidas := v_invalidas || jsonb_build_object('linha', v_idx, 'motivo', 'sem CPF/CNPJ e sem telefone');
      CONTINUE;
    END IF;
    IF v_valor IS NULL OR v_valor <= 0 OR v_venc IS NULL THEN
      v_invalidas := v_invalidas || jsonb_build_object('linha', v_idx, 'motivo', 'valor ou vencimento ausente');
      CONTINUE;
    END IF;

    -- Quem é: documento manda; sem ele, telefone.
    v_inad := NULL;
    IF v_doc IS NOT NULL THEN
      SELECT id INTO v_inad FROM public.cobranca_inadimplentes
       WHERE organization_id = p_org AND documento = v_doc AND arquivado_em IS NULL;
    ELSE
      SELECT id INTO v_inad FROM public.cobranca_inadimplentes
       WHERE organization_id = p_org AND telefone = v_tel AND arquivado_em IS NULL
       ORDER BY created_at LIMIT 1;
    END IF;

    v_chave := COALESCE('d:' || v_doc, 't:' || v_tel);
    IF v_inad IS NULL THEN
      IF NOT (v_chave = ANY (v_chaves)) THEN
        v_novos := v_novos + 1;
      END IF;
      IF NOT p_dry_run THEN
        INSERT INTO public.cobranca_inadimplentes
          (organization_id, nome, documento, telefone, email, contato_nome, cidade, origem)
        VALUES
          (p_org, v_nome, v_doc, v_tel, NULLIF(lower(btrim(v_linha ->> 'email')), ''),
           NULLIF(btrim(v_linha ->> 'contato_nome'), ''), NULLIF(btrim(v_linha ->> 'cidade'), ''), 'planilha')
        RETURNING id INTO v_inad;
        PERFORM private.cobranca_evento(p_org, v_inad, NULL, 'inadimplente_criado',
                                        jsonb_build_object('origem', 'planilha'));
      END IF;
    ELSIF NOT (v_inad = ANY (v_vistos)) AND NOT (v_chave = ANY (v_chaves)) THEN
      v_existentes := v_existentes + 1;
    END IF;
    v_chaves := array_append(v_chaves, v_chave);

    -- A mesma linha repetida no arquivo conta uma vez só (vale a primeira).
    v_tit_chave := v_chave || '|' || COALESCE('n:' || v_numero, 'v:' || v_valor || '@' || v_venc);
    IF v_tit_chave = ANY (v_tit_vistos) THEN
      CONTINUE;
    END IF;
    v_tit_vistos := array_append(v_tit_vistos, v_tit_chave);

    -- O título: por número, se houver; sem número, por (valor, vencimento).
    v_tit := NULL;
    IF v_inad IS NOT NULL THEN
      SELECT id INTO v_tit FROM public.cobranca_titulos
       WHERE inadimplente_id = v_inad
         AND ((v_numero IS NOT NULL AND numero = v_numero)
           OR (v_numero IS NULL AND numero IS NULL AND valor = v_valor AND vencimento = v_venc))
       LIMIT 1;
    END IF;

    IF v_tit IS NULL THEN
      v_tit_novos := v_tit_novos + 1;
      IF NOT p_dry_run THEN
        INSERT INTO public.cobranca_titulos
          (organization_id, inadimplente_id, origem, numero, descricao, valor, vencimento)
        VALUES
          (p_org, v_inad, 'planilha', v_numero, NULLIF(btrim(v_linha ->> 'descricao'), ''), v_valor, v_venc);
      END IF;
    ELSE
      -- Planilha nova corrige valor/vencimento de título ainda em aberto.
      IF EXISTS (SELECT 1 FROM public.cobranca_titulos
                  WHERE id = v_tit AND status = 'aberto'
                    AND (valor <> v_valor OR vencimento <> v_venc)) THEN
        v_tit_atual := v_tit_atual + 1;
        IF NOT p_dry_run THEN
          UPDATE public.cobranca_titulos SET valor = v_valor, vencimento = v_venc WHERE id = v_tit;
        END IF;
      END IF;
    END IF;

    IF NOT p_dry_run AND NOT (v_inad = ANY (v_vistos)) THEN
      v_vistos := array_append(v_vistos, v_inad);
    END IF;
  END LOOP;

  IF NOT p_dry_run THEN
    FOREACH v_inad IN ARRAY v_vistos LOOP
      SELECT id INTO v_caso_antes FROM public.cobranca_casos
       WHERE inadimplente_id = v_inad AND encerrado_em IS NULL;
      IF v_caso_antes IS NULL AND private.cobranca_garantir_caso(v_inad) IS NOT NULL THEN
        v_casos := v_casos + 1;
      END IF;
      PERFORM private.cobranca_evento(p_org, v_inad,
        (SELECT id FROM public.cobranca_casos WHERE inadimplente_id = v_inad AND encerrado_em IS NULL),
        'importado', '{}'::jsonb);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'linhas', v_idx,
    'inadimplentes_novos', v_novos,
    'inadimplentes_existentes', v_existentes,
    'titulos_novos', v_tit_novos,
    'titulos_atualizados', v_tit_atual,
    'casos_abertos', v_casos,
    'linhas_invalidas', v_invalidas
  );
END
$fn$;

-- Move o caso para outra etapa (e posição). Coluna de desfecho fecha o caso:
-- Recuperado só com saldo zero (a baixa é pelo pagamento); Cancelado cancela
-- os títulos em aberto; Perdido baixa os títulos como perda e fecha o caso.
CREATE FUNCTION public.cobranca_caso_mover(p_caso uuid, p_etapa uuid, p_posicao double precision DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_caso  public.cobranca_casos%ROWTYPE;
  v_etapa public.cobranca_etapas%ROWTYPE;
BEGIN
  SELECT * INTO v_caso FROM public.cobranca_casos WHERE id = p_caso FOR UPDATE;
  IF v_caso.id IS NULL THEN
    RAISE EXCEPTION 'Caso não encontrado.' USING ERRCODE = 'PT404', DETAIL = 'caso_nao_encontrado';
  END IF;
  PERFORM private.cobranca_exigir(v_caso.organization_id, 'edit');
  IF v_caso.encerrado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Caso encerrado não volta ao fluxo.' USING ERRCODE = 'PT422', DETAIL = 'caso_encerrado';
  END IF;

  SELECT * INTO v_etapa FROM public.cobranca_etapas
   WHERE id = p_etapa AND organization_id = v_caso.organization_id;
  IF v_etapa.id IS NULL THEN
    RAISE EXCEPTION 'Etapa não encontrada.' USING ERRCODE = 'PT404', DETAIL = 'etapa_nao_encontrada';
  END IF;

  IF v_etapa.papel = 'aberta' THEN
    UPDATE public.cobranca_casos
       SET etapa_id = p_etapa,
           posicao = COALESCE(p_posicao,
                       COALESCE((SELECT max(posicao) FROM public.cobranca_casos
                                  WHERE etapa_id = p_etapa AND encerrado_em IS NULL), 0) + 1),
           etapa_desde = CASE WHEN etapa_id = p_etapa THEN etapa_desde ELSE now() END
     WHERE id = p_caso;
    IF v_caso.etapa_id <> p_etapa THEN
      PERFORM private.cobranca_evento(v_caso.organization_id, v_caso.inadimplente_id, p_caso,
        'etapa_alterada', jsonb_build_object('de', v_caso.etapa_id, 'para', p_etapa));
    END IF;
    RETURN p_caso;
  END IF;

  IF v_etapa.papel = 'recuperado' AND EXISTS (
       SELECT 1 FROM public.cobranca_titulos_saldo
        WHERE inadimplente_id = v_caso.inadimplente_id AND saldo > 0) THEN
    RAISE EXCEPTION 'Ainda há saldo em aberto. Registre o pagamento para recuperar o caso.'
      USING ERRCODE = 'PT422', DETAIL = 'saldo_em_aberto';
  END IF;

  IF v_etapa.papel = 'cancelado' THEN
    UPDATE public.cobranca_titulos SET status = 'cancelado'
     WHERE inadimplente_id = v_caso.inadimplente_id AND status = 'aberto';
  END IF;

  PERFORM private.cobranca_encerrar_caso(p_caso, v_etapa.papel);
  RETURN p_caso;
END
$fn$;

-- Atribui (ou tira, com NULL) o responsável de vários casos. Devolve quantos mudaram.
CREATE FUNCTION public.cobranca_casos_atribuir(p_org uuid, p_casos uuid[], p_responsavel uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_row public.cobranca_casos%ROWTYPE;
  v_n   integer := 0;
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'edit');
  IF p_responsavel IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.team_members
        WHERE id = p_responsavel AND organization_id = p_org AND is_active) THEN
    RAISE EXCEPTION 'Responsável não pertence a esta organização.'
      USING ERRCODE = 'PT422', DETAIL = 'responsavel_invalido';
  END IF;

  FOR v_row IN
    SELECT * FROM public.cobranca_casos
     WHERE id = ANY (COALESCE(p_casos, '{}')) AND organization_id = p_org
       AND encerrado_em IS NULL
       AND responsavel_id IS DISTINCT FROM p_responsavel
     FOR UPDATE
  LOOP
    UPDATE public.cobranca_casos SET responsavel_id = p_responsavel WHERE id = v_row.id;
    PERFORM private.cobranca_evento(p_org, v_row.inadimplente_id, v_row.id, 'responsavel_alterado',
      jsonb_build_object('de', v_row.responsavel_id, 'para', p_responsavel));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$fn$;

-- Registra promessa (1 parcela) ou acordo (N parcelas). Um compromisso ativo
-- por caso: registrar outro substitui o anterior (renegociação).
--   p_parcelas: [{ vencimento, valor }]
CREATE FUNCTION public.cobranca_compromisso_registrar(
  p_caso uuid, p_tipo text, p_parcelas jsonb, p_observacao text DEFAULT NULL, p_mover_para uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_caso  public.cobranca_casos%ROWTYPE;
  v_id    uuid;
  v_p     jsonb;
  v_n     integer := 0;
  v_total numeric := 0;
  v_valor numeric;
  v_venc  date;
BEGIN
  SELECT * INTO v_caso FROM public.cobranca_casos WHERE id = p_caso FOR UPDATE;
  IF v_caso.id IS NULL OR v_caso.encerrado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Caso não encontrado ou já encerrado.' USING ERRCODE = 'PT404', DETAIL = 'caso_nao_encontrado';
  END IF;
  PERFORM private.cobranca_exigir(v_caso.organization_id, 'edit');

  IF p_tipo NOT IN ('promessa', 'acordo') THEN
    RAISE EXCEPTION 'Tipo de compromisso inválido.' USING ERRCODE = 'PT422', DETAIL = 'tipo_invalido';
  END IF;
  IF jsonb_typeof(p_parcelas) <> 'array' OR jsonb_array_length(p_parcelas) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma data e valor.' USING ERRCODE = 'PT422', DETAIL = 'parcelas_obrigatorias';
  END IF;
  IF p_tipo = 'promessa' AND jsonb_array_length(p_parcelas) <> 1 THEN
    RAISE EXCEPTION 'Promessa tem uma data só. Para várias, registre um acordo.'
      USING ERRCODE = 'PT422', DETAIL = 'promessa_uma_parcela';
  END IF;
  IF jsonb_array_length(p_parcelas) > 120 THEN
    RAISE EXCEPTION 'No máximo 120 parcelas.' USING ERRCODE = 'PT422', DETAIL = 'parcelas_demais';
  END IF;

  UPDATE public.cobranca_compromissos SET status = 'cancelado', encerrado_em = now()
   WHERE caso_id = p_caso AND status = 'ativo';

  INSERT INTO public.cobranca_compromissos (organization_id, caso_id, tipo, observacao)
  VALUES (v_caso.organization_id, p_caso, p_tipo, NULLIF(btrim(p_observacao), ''))
  RETURNING id INTO v_id;

  FOR v_p IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    v_n := v_n + 1;
    BEGIN
      v_valor := round((v_p ->> 'valor')::numeric, 2);
      v_venc  := (v_p ->> 'vencimento')::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Parcela % com valor ou data inválida.', v_n
        USING ERRCODE = 'PT422', DETAIL = 'parcela_invalida';
    END;
    IF v_valor IS NULL OR v_valor <= 0 OR v_venc IS NULL THEN
      RAISE EXCEPTION 'Parcela % precisa de valor maior que zero e data.', v_n
        USING ERRCODE = 'PT422', DETAIL = 'parcela_invalida';
    END IF;
    INSERT INTO public.cobranca_compromisso_parcelas (organization_id, compromisso_id, numero, vencimento, valor)
    VALUES (v_caso.organization_id, v_id, v_n, v_venc, v_valor);
    v_total := v_total + v_valor;
  END LOOP;

  PERFORM private.cobranca_evento(v_caso.organization_id, v_caso.inadimplente_id, p_caso,
    CASE p_tipo WHEN 'promessa' THEN 'promessa_registrada' ELSE 'acordo_registrado' END,
    jsonb_build_object('compromisso_id', v_id, 'parcelas', v_n, 'total', v_total,
                       'primeira', (SELECT min(vencimento) FROM public.cobranca_compromisso_parcelas
                                     WHERE compromisso_id = v_id)));

  IF p_mover_para IS NOT NULL AND p_mover_para <> v_caso.etapa_id THEN
    PERFORM public.cobranca_caso_mover(p_caso, p_mover_para, NULL);
  END IF;
  RETURN v_id;
END
$fn$;

-- Encerra o compromisso ativo: quebrado (não pagou), cancelado ou cumprido.
CREATE FUNCTION public.cobranca_compromisso_encerrar(p_compromisso uuid, p_status text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_c public.cobranca_compromissos%ROWTYPE;
  v_inad uuid;
BEGIN
  SELECT * INTO v_c FROM public.cobranca_compromissos WHERE id = p_compromisso FOR UPDATE;
  IF v_c.id IS NULL THEN
    RAISE EXCEPTION 'Compromisso não encontrado.' USING ERRCODE = 'PT404', DETAIL = 'compromisso_nao_encontrado';
  END IF;
  PERFORM private.cobranca_exigir(v_c.organization_id, 'edit');
  IF p_status NOT IN ('quebrado', 'cancelado', 'cumprido') THEN
    RAISE EXCEPTION 'Situação inválida.' USING ERRCODE = 'PT422', DETAIL = 'status_invalido';
  END IF;
  IF v_c.status <> 'ativo' THEN
    RAISE EXCEPTION 'Este compromisso já foi encerrado.' USING ERRCODE = 'PT422', DETAIL = 'compromisso_encerrado';
  END IF;

  UPDATE public.cobranca_compromissos SET status = p_status, encerrado_em = now() WHERE id = p_compromisso;
  SELECT inadimplente_id INTO v_inad FROM public.cobranca_casos WHERE id = v_c.caso_id;
  PERFORM private.cobranca_evento(v_c.organization_id, v_inad, v_c.caso_id, 'compromisso_encerrado',
    jsonb_build_object('compromisso_id', p_compromisso, 'tipo', v_c.tipo, 'status', p_status));
  RETURN p_compromisso;
END
$fn$;

-- Registra um pagamento recebido fora do ERP (decisão 7). Abate os títulos em
-- aberto do mais antigo para o mais novo (ou só o título indicado). Saldo zero
-- fecha o caso em Recuperado. Título do ERP não baixa aqui — baixa pelo ERP.
CREATE FUNCTION public.cobranca_pagamento_registrar(
  p_caso uuid, p_valor numeric, p_pago_em date, p_titulo uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_caso     public.cobranca_casos%ROWTYPE;
  v_restante numeric := round(p_valor, 2);
  v_lote     uuid := gen_random_uuid();
  v_t        record;
  v_parte    numeric;
  v_saldo    numeric;
  v_quitado  boolean := false;
BEGIN
  SELECT * INTO v_caso FROM public.cobranca_casos WHERE id = p_caso FOR UPDATE;
  IF v_caso.id IS NULL OR v_caso.encerrado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Caso não encontrado ou já encerrado.' USING ERRCODE = 'PT404', DETAIL = 'caso_nao_encontrado';
  END IF;
  PERFORM private.cobranca_exigir(v_caso.organization_id, 'edit');

  IF v_restante IS NULL OR v_restante <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.' USING ERRCODE = 'PT422', DETAIL = 'valor_invalido';
  END IF;
  IF p_pago_em IS NULL OR p_pago_em > CURRENT_DATE + 1 THEN
    RAISE EXCEPTION 'Informe a data do pagamento (não pode ser futura).' USING ERRCODE = 'PT422', DETAIL = 'data_invalida';
  END IF;

  SELECT COALESCE(sum(ts.saldo), 0) INTO v_saldo
    FROM public.cobranca_titulos_saldo ts
   WHERE ts.inadimplente_id = v_caso.inadimplente_id AND ts.origem <> 'erp'
     AND (p_titulo IS NULL OR ts.id = p_titulo);
  IF v_saldo = 0 THEN
    RAISE EXCEPTION 'Não há saldo em aberto para baixar aqui.' USING ERRCODE = 'PT422', DETAIL = 'sem_saldo';
  END IF;
  IF v_restante > v_saldo THEN
    RAISE EXCEPTION 'O valor passa do saldo em aberto (R$ %).', to_char(v_saldo, 'FM999G999G990D00')
      USING ERRCODE = 'PT422', DETAIL = 'valor_maior_que_saldo';
  END IF;

  -- O caso já está travado; trava também os títulos antes de ler os saldos.
  PERFORM 1 FROM public.cobranca_titulos
   WHERE inadimplente_id = v_caso.inadimplente_id AND status = 'aberto'
   FOR UPDATE;

  FOR v_t IN
    SELECT ts.id, ts.saldo
      FROM public.cobranca_titulos_saldo ts
     WHERE ts.inadimplente_id = v_caso.inadimplente_id AND ts.origem <> 'erp' AND ts.saldo > 0
       AND (p_titulo IS NULL OR ts.id = p_titulo)
     ORDER BY ts.vencimento, ts.created_at
  LOOP
    EXIT WHEN v_restante <= 0;
    v_parte := LEAST(v_t.saldo, v_restante);
    INSERT INTO public.cobranca_pagamentos (organization_id, caso_id, titulo_id, valor, pago_em, lote)
    VALUES (v_caso.organization_id, p_caso, v_t.id, v_parte, p_pago_em, v_lote);
    IF v_parte = v_t.saldo THEN
      UPDATE public.cobranca_titulos SET status = 'pago', pago_em = p_pago_em WHERE id = v_t.id;
    END IF;
    v_restante := v_restante - v_parte;
  END LOOP;

  SELECT COALESCE(sum(saldo), 0) INTO v_saldo
    FROM public.cobranca_titulos_saldo WHERE inadimplente_id = v_caso.inadimplente_id;

  PERFORM private.cobranca_evento(v_caso.organization_id, v_caso.inadimplente_id, p_caso,
    'pagamento_registrado',
    jsonb_build_object('lote', v_lote, 'valor', round(p_valor, 2), 'pago_em', p_pago_em, 'saldo_restante', v_saldo));

  IF v_saldo = 0 THEN
    PERFORM private.cobranca_encerrar_caso(p_caso, 'recuperado');
    v_quitado := true;
  END IF;

  RETURN jsonb_build_object('lote', v_lote, 'saldo_restante', v_saldo, 'quitado', v_quitado);
END
$fn$;

-- Registra um contato feito por uma pessoa (ligação, mensagem, visita).
CREATE FUNCTION public.cobranca_contato_registrar(p_caso uuid, p_canal text, p_resultado text, p_nota text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_caso public.cobranca_casos%ROWTYPE;
BEGIN
  SELECT * INTO v_caso FROM public.cobranca_casos WHERE id = p_caso;
  IF v_caso.id IS NULL THEN
    RAISE EXCEPTION 'Caso não encontrado.' USING ERRCODE = 'PT404', DETAIL = 'caso_nao_encontrado';
  END IF;
  PERFORM private.cobranca_exigir(v_caso.organization_id, 'edit');
  IF p_canal NOT IN ('whatsapp', 'telefone', 'email', 'presencial', 'outro') THEN
    RAISE EXCEPTION 'Canal inválido.' USING ERRCODE = 'PT422', DETAIL = 'canal_invalido';
  END IF;
  IF p_resultado NOT IN ('falou', 'nao_atendeu', 'recado', 'outro') THEN
    RAISE EXCEPTION 'Resultado inválido.' USING ERRCODE = 'PT422', DETAIL = 'resultado_invalido';
  END IF;
  IF length(p_nota) > 2000 THEN
    RAISE EXCEPTION 'Nota longa demais (máx. 2.000 caracteres).' USING ERRCODE = 'PT422', DETAIL = 'nota_longa';
  END IF;

  PERFORM private.cobranca_evento(v_caso.organization_id, v_caso.inadimplente_id, p_caso, 'contato_registrado',
    jsonb_build_object('canal', p_canal, 'resultado', p_resultado, 'nota', NULLIF(btrim(p_nota), '')));
  RETURN p_caso;
END
$fn$;

-- Marca (ou desmarca) "não contatar": o devedor pediu para não receber
-- mensagens. A régua (entrega 2) respeita; o contato humano continua possível.
CREATE FUNCTION public.cobranca_nao_contatar(p_inadimplente uuid, p_valor boolean, p_motivo text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.cobranca_inadimplentes
   WHERE id = p_inadimplente AND arquivado_em IS NULL;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Inadimplente não encontrado.' USING ERRCODE = 'PT404', DETAIL = 'inadimplente_nao_encontrado';
  END IF;
  PERFORM private.cobranca_exigir(v_org, 'edit');

  UPDATE public.cobranca_inadimplentes
     SET nao_contatar = COALESCE(p_valor, false),
         nao_contatar_em = CASE WHEN COALESCE(p_valor, false) THEN now() END
   WHERE id = p_inadimplente AND nao_contatar IS DISTINCT FROM COALESCE(p_valor, false);
  IF FOUND THEN
    PERFORM private.cobranca_evento(v_org, p_inadimplente,
      (SELECT id FROM public.cobranca_casos WHERE inadimplente_id = p_inadimplente AND encerrado_em IS NULL),
      'nao_contatar_alterado',
      jsonb_build_object('valor', COALESCE(p_valor, false), 'motivo', NULLIF(btrim(p_motivo), '')));
  END IF;
  RETURN p_inadimplente;
END
$fn$;

-- Arquiva (exclusão lógica) um inadimplente lançado por engano. O caso aberto
-- fecha em Cancelado e os títulos em aberto são cancelados.
CREATE FUNCTION public.cobranca_inadimplente_arquivar(p_inadimplente uuid, p_motivo text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_org  uuid;
  v_caso uuid;
BEGIN
  SELECT organization_id INTO v_org FROM public.cobranca_inadimplentes
   WHERE id = p_inadimplente AND arquivado_em IS NULL;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Inadimplente não encontrado.' USING ERRCODE = 'PT404', DETAIL = 'inadimplente_nao_encontrado';
  END IF;
  PERFORM private.cobranca_exigir(v_org, 'edit');
  IF NULLIF(btrim(p_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo.' USING ERRCODE = 'PT422', DETAIL = 'motivo_obrigatorio';
  END IF;

  UPDATE public.cobranca_titulos SET status = 'cancelado'
   WHERE inadimplente_id = p_inadimplente AND status = 'aberto';
  SELECT id INTO v_caso FROM public.cobranca_casos
   WHERE inadimplente_id = p_inadimplente AND encerrado_em IS NULL;
  IF v_caso IS NOT NULL THEN
    PERFORM private.cobranca_encerrar_caso(v_caso, 'cancelado');
  END IF;
  UPDATE public.cobranca_inadimplentes SET arquivado_em = now() WHERE id = p_inadimplente;
  PERFORM private.cobranca_evento(v_org, p_inadimplente, v_caso, 'inadimplente_arquivado',
    jsonb_build_object('motivo', btrim(p_motivo)));
  RETURN p_inadimplente;
END
$fn$;

-- Métricas do Fluxo — SÓ destas tabelas (decisão 5: isoladas dos funis).
-- SECURITY INVOKER: a RLS decide o que entra na conta. p_hoje vem do
-- navegador (dia local do usuário), como no resto do produto.
CREATE FUNCTION public.cobranca_metricas(p_org uuid, p_hoje date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path = ''
AS $fn$
  WITH abertos AS (
    SELECT r.* FROM public.cobranca_inadimplentes_resumo r
     WHERE r.organization_id = p_org AND r.caso_id IS NOT NULL
  ), mes AS (
    SELECT date_trunc('month', p_hoje)::date AS ini,
           (date_trunc('month', p_hoje) - interval '1 month')::date AS ini_ant
  ), saldos AS (
    SELECT ts.saldo, p_hoje - ts.vencimento AS dias
      FROM public.cobranca_titulos_saldo ts
      JOIN public.cobranca_casos c ON c.inadimplente_id = ts.inadimplente_id AND c.encerrado_em IS NULL
     WHERE ts.organization_id = p_org AND ts.saldo > 0
  )
  SELECT jsonb_build_object(
    'em_aberto',        COALESCE((SELECT sum(saldo_aberto) FROM abertos), 0),
    'casos_abertos',    (SELECT count(*) FROM abertos),
    'titulos_abertos',  COALESCE((SELECT sum(titulos_abertos) FROM abertos), 0),
    'faixas', jsonb_build_object(
       'a_vencer', COALESCE((SELECT sum(saldo) FROM saldos WHERE dias <= 0), 0),
       'ate_30',   COALESCE((SELECT sum(saldo) FROM saldos WHERE dias BETWEEN 1 AND 30), 0),
       'ate_60',   COALESCE((SELECT sum(saldo) FROM saldos WHERE dias BETWEEN 31 AND 60), 0),
       'ate_90',   COALESCE((SELECT sum(saldo) FROM saldos WHERE dias BETWEEN 61 AND 90), 0),
       'acima_90', COALESCE((SELECT sum(saldo) FROM saldos WHERE dias > 90), 0)),
    'recuperado_mes', COALESCE((SELECT sum(pg.valor) FROM public.cobranca_pagamentos pg, mes
                                 WHERE pg.organization_id = p_org AND pg.pago_em >= mes.ini
                                   AND pg.pago_em <= p_hoje), 0),
    'recuperado_mes_anterior', COALESCE((SELECT sum(pg.valor) FROM public.cobranca_pagamentos pg, mes
                                 WHERE pg.organization_id = p_org AND pg.pago_em >= mes.ini_ant
                                   AND pg.pago_em < mes.ini), 0),
    'acordos_ativos', (SELECT count(*) FROM public.cobranca_compromissos co
                        WHERE co.organization_id = p_org AND co.status = 'ativo'),
    'acordos_ativos_valor', COALESCE((SELECT sum(pa.valor)
                        FROM public.cobranca_compromissos co
                        JOIN public.cobranca_compromisso_parcelas pa ON pa.compromisso_id = co.id
                       WHERE co.organization_id = p_org AND co.status = 'ativo'), 0),
    'quebras_mes', (SELECT count(*) FROM public.cobranca_compromissos co, mes
                     WHERE co.organization_id = p_org AND co.status = 'quebrado'
                       AND co.encerrado_em >= mes.ini),
    'compromissos_hoje', (SELECT count(*) FROM public.cobranca_compromissos co
                           JOIN public.cobranca_compromisso_parcelas pa ON pa.compromisso_id = co.id
                          WHERE co.organization_id = p_org AND co.status = 'ativo' AND pa.vencimento = p_hoje),
    'compromissos_hoje_valor', COALESCE((SELECT sum(pa.valor) FROM public.cobranca_compromissos co
                           JOIN public.cobranca_compromisso_parcelas pa ON pa.compromisso_id = co.id
                          WHERE co.organization_id = p_org AND co.status = 'ativo' AND pa.vencimento = p_hoje), 0),
    'sem_contato_7d', (SELECT count(*) FROM abertos
                        WHERE ultimo_contato_em IS NULL OR ultimo_contato_em < p_hoje - 7),
    'sem_contato_7d_valor', COALESCE((SELECT sum(saldo_aberto) FROM abertos
                        WHERE ultimo_contato_em IS NULL OR ultimo_contato_em < p_hoje - 7), 0),
    'recuperados_mes', (SELECT count(*) FROM public.cobranca_casos c, mes
                         WHERE c.organization_id = p_org AND c.desfecho = 'recuperado'
                           AND c.encerrado_em >= mes.ini),
    'dias_ate_pagar_mediana', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (t.pago_em - t.vencimento))
                                 FROM public.cobranca_titulos t, mes
                                WHERE t.organization_id = p_org AND t.status = 'pago'
                                  AND t.pago_em >= mes.ini_ant)
  );
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Grants das RPCs
-- ─────────────────────────────────────────────────────────────────────────

DO $do$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.cobranca_etapas_garantir(uuid)',
    'public.cobranca_inadimplente_salvar(uuid, uuid, jsonb)',
    'public.cobranca_titulo_incluir(uuid, jsonb)',
    'public.cobranca_titulo_cancelar(uuid, text)',
    'public.cobranca_importar(uuid, jsonb, boolean)',
    'public.cobranca_caso_mover(uuid, uuid, double precision)',
    'public.cobranca_casos_atribuir(uuid, uuid[], uuid)',
    'public.cobranca_compromisso_registrar(uuid, text, jsonb, text, uuid)',
    'public.cobranca_compromisso_encerrar(uuid, text)',
    'public.cobranca_pagamento_registrar(uuid, numeric, date, uuid)',
    'public.cobranca_contato_registrar(uuid, text, text, text)',
    'public.cobranca_nao_contatar(uuid, boolean, text)',
    'public.cobranca_inadimplente_arquivar(uuid, text)',
    'public.cobranca_metricas(uuid, date)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END
$do$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Permissões (catálogo) e flag
-- ─────────────────────────────────────────────────────────────────────────

-- default_value false: setor separado (decisão 5). Admin e master passam por
-- cima no has_feature_permission; membro só com liberação.
INSERT INTO public.feature_permissions (key, module, name, description, is_admin_only, default_value, sort_order)
VALUES
  ('cobranca.view', 'Cobrança', 'Ver a cobrança',
   'Vê inadimplentes, o Fluxo de Cobrança e o histórico dos casos.', false, false, 10),
  ('cobranca.edit', 'Cobrança', 'Operar a cobrança',
   'Cadastra e importa inadimplentes, move casos e registra promessa, acordo, pagamento e contato.', false, false, 11)
ON CONFLICT (key) DO NOTHING;

-- Liga só na TorqueCRM. Em banco sem essa org, nada acontece.
UPDATE public.organizations
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"cobranca": true}'::jsonb
 WHERE id = 'b2ad1ffb-e136-4356-846b-9f210f902573'
   AND slug = 'torquecrm';

DO $do$
DECLARE
  v_org uuid;
BEGIN
  FOR v_org IN SELECT id FROM public.organizations WHERE feature_flags -> 'cobranca' = 'true'::jsonb LOOP
    PERFORM private.cobranca_semear_etapas(v_org);
  END LOOP;
END
$do$;

COMMIT;
