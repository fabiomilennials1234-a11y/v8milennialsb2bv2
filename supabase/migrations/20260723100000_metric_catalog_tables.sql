-- 20260723100000_metric_catalog_tables.sql
--
-- ISSUE #1194 (PRD #986 · ADR-0023) — Métricas Montáveis, Camada 2, fatia 1/5.
-- Catálogo fechado + flag de rollout.
--
-- O QUE ESTA FATIA ESTABELECE
-- ---------------------------
-- O vocabulário FECHADO da composição, como TABELAS de referência read-only
-- semeadas por migration (ADR-0023, decisão A). São a âncora relacional a que
-- a config de composição (fatia 3) faz FK — ID fora do catálogo vira violação
-- de FK NA ESCRITA, no banco, não na app. É a forma mais forte da "validação
-- contra o catálogo" que o ADR exige como fronteira de segurança.
--
--   metric_catalog_measures         — 7 medidas (id, label, unit, anchor)
--   metric_catalog_recortes         — 10 recortes
--   metric_catalog_formats          — formatos de exibição
--   metric_catalog_measure_recortes — compatibilidade medida×recorte
--   metric_catalog_measure_formats  — compatibilidade medida×formato
--
-- DENY-ALL DE ESCRITA: RLS habilitada, SÓ policy de SELECT para authenticated,
-- nenhuma policy de escrita, e REVOKE explícito de INSERT/UPDATE/DELETE de
-- anon/authenticated/PUBLIC. Só service_role e o dono (postgres, via migration)
-- escrevem. O catálogo é global — não tem organization_id, não é dado de
-- tenant, e por isso o SELECT é liberado a todo authenticated.
--
-- FLAG DE ROLLOUT (3º mandamento do CTO): organizations.composable_metrics_enabled,
-- boolean NOT NULL DEFAULT false. Segue o precedente vivo em prod
-- (organizations.send_governor_warmup_enabled): coluna booleana por-org,
-- default OFF, ligada explicitamente. v1 = só TV, nada visível até flag ON.
-- O helper fn_composable_metrics_enabled(org) é o ponto único de checagem,
-- reusado pelo caminho de escrita (fatia 3) e leitura (fatia 4).
--
-- ROLLBACK pareado: supabase/migrations/rollback/20260723100000_metric_catalog_tables.sql
-- Aditiva → rollback = DROP reversível. É a PRIMEIRA a aplicar, ÚLTIMA a
-- reverter (fatias 2-4 dependem destas tabelas por FK / do catálogo por leitura).

-- ===========================================================================
-- 0. Flag de rollout
-- ===========================================================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS composable_metrics_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.composable_metrics_enabled IS
  'Flag de rollout das Métricas Montáveis (#1194). DEFAULT false: o motor e o '
  'esquema de composição existem inertes; nada é visível/gravável até esta flag '
  'ligar por org. v1 liga só a TV. Segue o padrão de organizations.'
  'send_governor_*_enabled (rollout por coluna booleana, não por plano).';

CREATE OR REPLACE FUNCTION public.fn_composable_metrics_enabled(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  -- Gate de rollout. SECURITY DEFINER para responder de dentro dos leitores
  -- DEFINER (snapshot) sem depender do papel do chamador. Devolver o booleano
  -- de rollout de outra org é inofensivo (não é dado de tenant); mesmo assim
  -- default é false quando a org não existe.
  SELECT COALESCE(
    (SELECT o.composable_metrics_enabled FROM public.organizations o WHERE o.id = p_org_id),
    false
  );
$$;

COMMENT ON FUNCTION public.fn_composable_metrics_enabled(uuid) IS
  'Ponto único de checagem da flag de rollout das Métricas Montáveis (#1194). '
  'Reusado pela escrita de composição (trigger) e pela leitura (fn_dashboard_snapshot).';

REVOKE EXECUTE ON FUNCTION public.fn_composable_metrics_enabled(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_composable_metrics_enabled(uuid) TO authenticated, service_role;

-- ===========================================================================
-- 1. Tabelas de referência (catálogo fechado)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.metric_catalog_measures (
  id          text PRIMARY KEY,
  label       text NOT NULL,
  unit        text NOT NULL,
  anchor      text NOT NULL,
  description text,
  sort        integer NOT NULL DEFAULT 0,
  CONSTRAINT metric_catalog_measures_unit_check
    CHECK (unit IN ('currency','count','duration_seconds','percent','ratio')),
  CONSTRAINT metric_catalog_measures_anchor_check
    CHECK (anchor IN ('entradas','fechamentos','hoje'))
);
COMMENT ON TABLE public.metric_catalog_measures IS
  'Catálogo fechado de medidas (#1194 / ADR-0023). Read-only via migration. '
  'unit e anchor são derivados no motor a partir daqui; medida sem anchor = erro.';

CREATE TABLE IF NOT EXISTS public.metric_catalog_recortes (
  id    text PRIMARY KEY,
  label text NOT NULL,
  sort  integer NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.metric_catalog_recortes IS
  'Catálogo fechado de recortes (#1194). Cada id escolhe um ramo estático do '
  'CASE do motor — nunca vira nome de coluna concatenado.';

CREATE TABLE IF NOT EXISTS public.metric_catalog_formats (
  id    text PRIMARY KEY,
  label text NOT NULL,
  sort  integer NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.metric_catalog_formats IS
  'Catálogo fechado de formatos de exibição (#1194).';

CREATE TABLE IF NOT EXISTS public.metric_catalog_measure_recortes (
  measure_id text NOT NULL REFERENCES public.metric_catalog_measures(id) ON DELETE CASCADE,
  recorte_id text NOT NULL REFERENCES public.metric_catalog_recortes(id) ON DELETE CASCADE,
  PRIMARY KEY (measure_id, recorte_id)
);
COMMENT ON TABLE public.metric_catalog_measure_recortes IS
  'Compatibilidade medida×recorte (#1194). A config de composição valida contra '
  'esta tabela no trigger de escrita: recorte incompatível é rejeitado no banco.';

CREATE TABLE IF NOT EXISTS public.metric_catalog_measure_formats (
  measure_id text NOT NULL REFERENCES public.metric_catalog_measures(id) ON DELETE CASCADE,
  format_id  text NOT NULL REFERENCES public.metric_catalog_formats(id) ON DELETE CASCADE,
  PRIMARY KEY (measure_id, format_id)
);
COMMENT ON TABLE public.metric_catalog_measure_formats IS
  'Compatibilidade medida×formato (#1194).';

-- Presets de RAZÃO semeados no catálogo (decisão de equipe #1194): conversão,
-- comparecimento e ticket médio viram linhas descobríveis via fn_metric_catalog
-- e testáveis em pgTAP — não vivem só na UI. Coerente com o catálogo fechado.
-- A unidade é DERIVADA pela mesma regra do motor (count/count→percent,
-- currency/count→currency), não armazenada, para não divergir de fn_metric_measure.
CREATE TABLE IF NOT EXISTS public.metric_catalog_ratios (
  id             text PRIMARY KEY,
  label          text NOT NULL,
  num_measure_id text NOT NULL REFERENCES public.metric_catalog_measures(id) ON DELETE RESTRICT,
  den_measure_id text NOT NULL REFERENCES public.metric_catalog_measures(id) ON DELETE RESTRICT,
  format_id      text NOT NULL REFERENCES public.metric_catalog_formats(id) ON DELETE RESTRICT,
  sort           integer NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.metric_catalog_ratios IS
  'Presets de razão semeados (#1194): pares (num,den) de measure_refs prontos '
  '(conversão, comparecimento, ticket médio). Descobríveis via fn_metric_catalog; '
  'unidade derivada no motor. Widget de razão referencia num/den direto — o '
  'preset é atalho de composição, não caminho de execução novo.';

-- ===========================================================================
-- 2. Seed do catálogo v1 (7 medidas × 10 recortes, aprovado pelo CTO)
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('receita',             'Receita',               'currency',          'fechamentos', 'Σ sale_value de vendas não estornadas no período.',              10),
  ('num_vendas',          'Nº de vendas',          'count',             'fechamentos', 'Contagem de vendas não estornadas no período.',                  20),
  ('leads_criados',       'Leads criados',         'count',             'entradas',    'Leads criados no período (metrics_period_at ou created_at).',    30),
  ('reunioes_marcadas',   'Reuniões marcadas',     'count',             'entradas',    'meeting_events booked no período.',                              40),
  ('reunioes_realizadas', 'Reuniões realizadas',   'count',             'fechamentos', 'meeting_events held no período.',                                 50),
  ('leads_na_etapa',      'Leads na etapa',        'count',             'hoje',        'Estado atual: leads em entradas abertas por etapa.',             60),
  ('tempo_medio_etapa',   'Tempo médio na etapa',  'duration_seconds',  'hoje',        'Dwell atual médio na etapa a partir do caderno de transições.',  70)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.metric_catalog_recortes (id, label, sort) VALUES
  ('total',    'Total',        10),
  ('closer',   'Closer',       20),
  ('sdr',      'SDR',          30),
  ('origem',   'Origem',       40),
  ('tag',      'Tag',          50),
  ('produto',  'Produto',      60),
  ('stream',   'Fluxo',        70),
  ('pipeline', 'Funil',        80),
  ('etapa',    'Etapa',        90),
  ('tempo',    'Tempo',       100)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.metric_catalog_formats (id, label, sort) VALUES
  ('currency_brl',   'Moeda (R$)',        10),
  ('integer',        'Número inteiro',    20),
  ('percent_1',      'Percentual (1 casa)', 30),
  ('duration_human', 'Duração',           40),
  ('ratio_2',        'Razão (2 casas)',   50)
ON CONFLICT (id) DO NOTHING;

-- Compatibilidade medida×recorte — cada par abaixo TEM um ramo estático real no
-- motor (fatia 2). Par ausente = sem query = rejeitado na escrita da composição.
INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('receita','total'),('receita','closer'),('receita','sdr'),('receita','origem'),
    ('receita','tag'),('receita','stream'),('receita','pipeline'),('receita','tempo'),
  ('num_vendas','total'),('num_vendas','closer'),('num_vendas','sdr'),('num_vendas','origem'),
    ('num_vendas','tag'),('num_vendas','stream'),('num_vendas','pipeline'),('num_vendas','tempo'),
  ('leads_criados','total'),('leads_criados','origem'),('leads_criados','tag'),
    ('leads_criados','produto'),('leads_criados','tempo'),
  ('reunioes_marcadas','total'),('reunioes_marcadas','sdr'),('reunioes_marcadas','origem'),
    ('reunioes_marcadas','tag'),('reunioes_marcadas','tempo'),
  ('reunioes_realizadas','total'),('reunioes_realizadas','sdr'),('reunioes_realizadas','origem'),
    ('reunioes_realizadas','tag'),('reunioes_realizadas','tempo'),
  ('leads_na_etapa','total'),('leads_na_etapa','pipeline'),('leads_na_etapa','etapa'),
  ('tempo_medio_etapa','etapa'),('tempo_medio_etapa','pipeline')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('receita','currency_brl'),
  ('num_vendas','integer'),
  ('leads_criados','integer'),
  ('reunioes_marcadas','integer'),
  ('reunioes_realizadas','integer'),
  ('leads_na_etapa','integer'),
  ('tempo_medio_etapa','duration_human')
ON CONFLICT DO NOTHING;

-- Presets de razão v1 (conversão count/count→percent; comparecimento idem;
-- ticket médio currency/count→currency).
INSERT INTO public.metric_catalog_ratios (id, label, num_measure_id, den_measure_id, format_id, sort) VALUES
  ('conversao',      'Taxa de conversão',   'num_vendas',          'leads_criados',      'percent_1',    10),
  ('comparecimento', 'Taxa de comparecimento','reunioes_realizadas','reunioes_marcadas', 'percent_1',    20),
  ('ticket_medio',   'Ticket médio',        'receita',             'num_vendas',         'currency_brl', 30)
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- 3. DENY-ALL de escrita (RLS: só SELECT para authenticated)
-- ===========================================================================
ALTER TABLE public.metric_catalog_measures         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_catalog_recortes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_catalog_formats          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_catalog_measure_recortes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_catalog_measure_formats  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_catalog_ratios           ENABLE ROW LEVEL SECURITY;

-- Catálogo global e público-a-autenticado: SELECT liberado, escrita sem policy.
-- Statements EXPLÍCITOS (sem DO/EXECUTE) de propósito: mantém a INVARIANTE
-- ZERO-EXECUTE observável por grep simples em toda a fatia, inclusive esta
-- migration de setup.
CREATE POLICY metric_catalog_measures_select         ON public.metric_catalog_measures         FOR SELECT TO authenticated USING (true);
CREATE POLICY metric_catalog_recortes_select         ON public.metric_catalog_recortes         FOR SELECT TO authenticated USING (true);
CREATE POLICY metric_catalog_formats_select          ON public.metric_catalog_formats          FOR SELECT TO authenticated USING (true);
CREATE POLICY metric_catalog_measure_recortes_select ON public.metric_catalog_measure_recortes FOR SELECT TO authenticated USING (true);
CREATE POLICY metric_catalog_measure_formats_select  ON public.metric_catalog_measure_formats  FOR SELECT TO authenticated USING (true);
CREATE POLICY metric_catalog_ratios_select           ON public.metric_catalog_ratios           FOR SELECT TO authenticated USING (true);

-- Deny-all de escrita: nenhuma policy de INSERT/UPDATE/DELETE + REVOKE explícito.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.metric_catalog_measures         FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.metric_catalog_recortes         FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.metric_catalog_formats          FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.metric_catalog_measure_recortes FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.metric_catalog_measure_formats  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.metric_catalog_ratios           FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.metric_catalog_measures         TO authenticated, anon;
GRANT SELECT ON public.metric_catalog_recortes         TO authenticated, anon;
GRANT SELECT ON public.metric_catalog_formats          TO authenticated, anon;
GRANT SELECT ON public.metric_catalog_measure_recortes TO authenticated, anon;
GRANT SELECT ON public.metric_catalog_measure_formats  TO authenticated, anon;
GRANT SELECT ON public.metric_catalog_ratios           TO authenticated, anon;

-- ===========================================================================
-- 4. fn_metric_catalog() — serve o catálogo montado para a UI de composição
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_metric_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = 'public'
AS $$
  -- Read-only, global, sem p_org_id: o catálogo não tem dado de tenant. RLS já
  -- libera SELECT para authenticated. SECURITY INVOKER de propósito — nada aqui
  -- justifica DEFINER.
  SELECT jsonb_build_object(
    'measures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'label', m.label, 'unit', m.unit, 'anchor', m.anchor,
        'description', m.description,
        'compatible_recortes', COALESCE((
          SELECT jsonb_agg(mr.recorte_id ORDER BY r.sort)
          FROM public.metric_catalog_measure_recortes mr
          JOIN public.metric_catalog_recortes r ON r.id = mr.recorte_id
          WHERE mr.measure_id = m.id), '[]'::jsonb),
        'compatible_formats', COALESCE((
          SELECT jsonb_agg(mf.format_id ORDER BY f.sort)
          FROM public.metric_catalog_measure_formats mf
          JOIN public.metric_catalog_formats f ON f.id = mf.format_id
          WHERE mf.measure_id = m.id), '[]'::jsonb)
      ) ORDER BY m.sort)
      FROM public.metric_catalog_measures m), '[]'::jsonb),
    'recortes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'label', r.label) ORDER BY r.sort)
      FROM public.metric_catalog_recortes r), '[]'::jsonb),
    'formats', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'label', f.label) ORDER BY f.sort)
      FROM public.metric_catalog_formats f), '[]'::jsonb),
    'ratios', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ra.id, 'label', ra.label,
        'num', ra.num_measure_id, 'den', ra.den_measure_id, 'format', ra.format_id,
        -- unit derivada pela MESMA regra do motor (não armazenada)
        'unit', CASE
          WHEN mn.unit = 'count'    AND md.unit = 'count' THEN 'percent'
          WHEN mn.unit = 'currency' AND md.unit = 'count' THEN 'currency'
          ELSE 'ratio' END
      ) ORDER BY ra.sort)
      FROM public.metric_catalog_ratios ra
      JOIN public.metric_catalog_measures mn ON mn.id = ra.num_measure_id
      JOIN public.metric_catalog_measures md ON md.id = ra.den_measure_id), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION public.fn_metric_catalog() IS
  'Serve o catálogo fechado montado (measures + recortes + formats + '
  'compatibilidade) para a UI de composição (#1194). Read-only, global, sem org.';

REVOKE EXECUTE ON FUNCTION public.fn_metric_catalog() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_metric_catalog() TO authenticated, service_role;
