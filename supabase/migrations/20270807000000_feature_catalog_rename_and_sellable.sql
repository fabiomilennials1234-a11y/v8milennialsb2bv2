-- 20270805000000_feature_catalog_rename_and_sellable.sql
--
-- Fatia 2 do PRD #1393 — FASE EXPAND.
-- Resolve #1386: a tabela vira a fonte de verdade única do catálogo de features.
--
-- Duas mudanças, ambas aditivas do ponto de vista de quem lê:
--
--   1. `feature_flags` (tabela) é renomeada para `feature_catalog`, e uma VIEW com o nome
--      antigo mantém todos os leitores e escritores atuais funcionando sem alteração.
--      O rename existe porque havia DUAS coisas chamadas `feature_flags` com populações
--      completamente diferentes: esta tabela (catálogo de features de produto) e a coluna
--      `organizations.feature_flags` (flags de rollout por org — `new_lead_modal_v2`,
--      `canonical_metrics`, `meta_cloud`). Nenhuma chave de rollout existe nesta tabela.
--
--   2. Nova coluna `is_sellable` separa feature comercial (vendável, entra no snapshot da
--      assinatura) de flag de infraestrutura. `feature_type` volta a descrever só formato.
--
-- NÃO faz parte desta migration: apagar as chaves que nenhum código consulta. Isso remove
-- configuração de cliente por CASCADE e vive numa migration própria, revisável em separado.
--
-- FASE CONTRACT (migration futura, só depois que nenhum caller usar o nome antigo):
--   DROP VIEW public.feature_flags;

-- ---------------------------------------------------------------------------
-- 1. Rename da tabela e dos objetos dependentes
-- ---------------------------------------------------------------------------

ALTER TABLE public.feature_flags RENAME TO feature_catalog;

ALTER TABLE public.feature_catalog RENAME CONSTRAINT feature_flags_pkey TO feature_catalog_pkey;
ALTER TABLE public.feature_catalog RENAME CONSTRAINT feature_flags_key_key TO feature_catalog_key_key;

-- A FK de organization_features segue a tabela automaticamente; renomeada só por clareza.
ALTER TABLE public.organization_features
  RENAME CONSTRAINT organization_features_feature_key_fkey TO organization_features_feature_catalog_fkey;

ALTER POLICY feature_flags_all ON public.feature_catalog RENAME TO feature_catalog_all;
ALTER POLICY feature_flags_select ON public.feature_catalog RENAME TO feature_catalog_select;

COMMENT ON TABLE public.feature_catalog IS
  'Catálogo de features de produto. Fonte de verdade única — src/modules/platform/lib/feature-catalog.generated.ts é gerado daqui. NÃO confundir com organizations.feature_flags (jsonb), que carrega flags de rollout por organização.';

-- ---------------------------------------------------------------------------
-- 2. is_sellable
-- ---------------------------------------------------------------------------

ALTER TABLE public.feature_catalog
  ADD COLUMN is_sellable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.feature_catalog.is_sellable IS
  'true = feature comercial: aparece no montador do link de pagamento e é congelada no snapshot da assinatura. false = infraestrutura ou rollout, nunca vendida.';

-- Tudo é vendável, exceto infraestrutura e rollout.
--
-- As quatro exceções, com a razão de cada uma:
--   unified_message_gateway     — rollout de infraestrutura de envio
--   user_write_instance_strict  — rollout de vínculo user↔instância de escrita
--   portfolio_alerts_whatsapp   — gatilho de backend da carteira, não é módulo vendido
--   merged_opportunity_funnel   — rollout, e o próprio registry TypeScript já o marcava
--                                 como "não é feature de plano" enquanto a tabela o
--                                 arquivava como feature de catálogo
UPDATE public.feature_catalog
   SET is_sellable = true
 WHERE key NOT IN (
   'unified_message_gateway',
   'user_write_instance_strict',
   'portfolio_alerts_whatsapp',
   'merged_opportunity_funnel'
 );

-- ---------------------------------------------------------------------------
-- 3. View de compatibilidade
-- ---------------------------------------------------------------------------
--
-- security_invoker é obrigatório: sem ele a view roda com a permissão do dono e a RLS da
-- tabela deixa de valer, o que abriria escrita no catálogo para qualquer authenticated.
-- A tabela tem RLS com escrita restrita a is_master_user() e leitura liberada.
--
-- Colunas enumeradas explicitamente (nunca SELECT *) para que a view não mude de forma
-- quando a tabela ganhar coluna nova — is_sellable fica de fora de propósito, para que o
-- tipo TablesInsert<"feature_flags"> gerado hoje continue válido.

CREATE VIEW public.feature_flags
WITH (security_invoker = true)
AS
SELECT
  id,
  key,
  name,
  description,
  category,
  default_enabled,
  requires_plan,
  created_at,
  display_name,
  icon,
  sidebar_path,
  feature_type,
  "position"
FROM public.feature_catalog;

COMMENT ON VIEW public.feature_flags IS
  'DEPRECATED — compatibilidade durante a fatia 2 do PRD #1393. Use public.feature_catalog. Removida na fase contract.';

-- Grants explícitos. CREATE VIEW nasce sem grant nenhum, e o padrão do repo é nunca
-- deixar objeto novo cair em PUBLIC/anon por omissão.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_flags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_flags TO service_role;
GRANT SELECT ON public.feature_flags TO mcp_readonly;
REVOKE ALL ON public.feature_flags FROM anon;

-- ---------------------------------------------------------------------------
-- 4. Correção dos dados do catálogo
-- ---------------------------------------------------------------------------
--
-- A tabela vira fonte de verdade, mas os dados dela estavam DEFASADOS em relação ao
-- `feature-registry.ts` escrito à mão, que é o que vinha sendo mantido. Promover a tabela
-- sem corrigir os dados regride o produto:
--
--   * `chat` tinha sidebar_path = '/chat-whatsapp', rota stale. O item "Chat" da navegação
--     (path '/chat') deixaria de mostrar cadeado — regressão já corrigida uma vez no TS e
--     coberta por tests/unit/feature-registry-plan-gating.test.ts.
--   * `automations`, `whatsapp_bulk`, `carteira` e `message_templates` não tinham
--     sidebar_path nenhum, e são features pagas com rota própria.
--   * Várias features estavam sem ícone, o que deixaria o editor de planos com o ícone
--     genérico de fallback.
--   * `oraculo` e `scheduled_messages` estavam em `modules` e são `advanced`.
--
-- Depois deste bloco, todo o catálogo satisfaz o invariante que o frontend sempre assumiu:
-- ícone presente e categoria em (modules, campaigns, advanced).

UPDATE public.feature_catalog AS f
   SET icon         = v.icon,
       category     = v.category,
       sidebar_path = v.sidebar_path
  FROM (VALUES
    ('analytics',                   'BarChart3',    'modules',   NULL::text),
    ('api_access',                  'Code',         'advanced',  NULL),
    ('automations',                 'Workflow',     'modules',   '/automacoes'),
    ('campaigns_auto',              'Bot',          'campaigns', NULL),
    ('campaigns_manual',            'MousePointer', 'campaigns', NULL),
    ('campaigns_semi',              'Zap',          'campaigns', NULL),
    ('carteira',                    'TrendingUp',   'modules',   '/upsell'),
    ('chat',                        'Zap',          'modules',   '/chat'),
    ('commissions',                 'DollarSign',   'modules',   '/comissoes'),
    ('copilot',                     'Bot',          'modules',   '/copilot'),
    ('copilot_advanced',            'Sparkles',     'advanced',  NULL),
    ('customer_portfolio',          'Users',        'advanced',  NULL),
    ('deals',                       'Briefcase',    'modules',   '/negocios'),
    ('external_cadastro',           'UserPlus',     'advanced',  NULL),
    ('funnels',                     'GitBranch',    'modules',   '/funis'),
    ('funnels_custom',              'GitBranch',    'modules',   NULL),
    ('funnels_template_indicacao',  'Heart',        'modules',   NULL),
    ('funnels_template_prospeccao', 'Target',       'modules',   NULL),
    ('funnels_template_reativacao', 'RefreshCw',    'modules',   NULL),
    ('leads',                       'Fuel',         'modules',   '/leads'),
    ('marketing',                   'BarChart2',    'modules',   '/marketing'),
    ('merged_opportunity_funnel',   'GitMerge',     'advanced',  NULL),
    ('message_templates',           'FileText',     'modules',   '/templates'),
    ('oraculo',                     'Sparkles',     'advanced',  NULL),
    ('performance',                 'Trophy',       'modules',   '/performance'),
    ('portfolio_alerts_whatsapp',   'BellRing',     'advanced',  NULL),
    ('products',                    'Package',      'modules',   '/produtos'),
    ('review',                      'Wrench',       'modules',   '/follow-ups'),
    ('scheduled_messages',          'Clock',        'advanced',  NULL),
    ('tv_dashboard',                'Tv',           'modules',   '/tv'),
    ('unified_message_gateway',     'Send',         'advanced',  NULL),
    ('user_write_instance_strict',  'Lock',         'advanced',  NULL),
    ('voice_calls',                 'Phone',        'advanced',  NULL),
    ('whatsapp_bulk',               'Send',         'advanced',  '/disparos'),
    ('white_label',                 'Palette',      'advanced',  NULL)
  ) AS v(key, icon, category, sidebar_path)
 WHERE f.key = v.key;

-- Guarda: nenhuma feature pode sobrar sem ícone ou fora das três categorias que o editor
-- de planos e a navegação sabem renderizar. As quatro chaves que ainda não foram removidas
-- (migration seguinte) são a única exceção tolerada aqui.
DO $$
DECLARE
  v_ruins integer;
BEGIN
  SELECT count(*) INTO v_ruins
    FROM public.feature_catalog
   WHERE key NOT IN ('custom_reports', 'gamification', 'multi_pipeline', 'whatsapp_integration')
     AND (icon IS NULL OR icon = '' OR category NOT IN ('modules', 'campaigns', 'advanced'));

  IF v_ruins > 0 THEN
    RAISE EXCEPTION 'feature_catalog: % feature(s) sem ícone ou com categoria fora de (modules, campaigns, advanced)', v_ruins;
  END IF;
END $$;
