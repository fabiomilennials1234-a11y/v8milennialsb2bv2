-- 20270821180000_seed_feature_catalog.sql
--
-- SCRUM-362 — `feature_catalog` era DADO de produção, e por isso um banco
-- construído do repositório nascia com um catálogo diferente do que o código
-- espera.
--
-- O QUE ISSO QUEBRAVA
--
-- `tests/integration/feature-catalog-parity.test.ts` compara o arquivo gerado
-- (`src/modules/platform/lib/feature-catalog.generated.ts`, retrato de prod)
-- com a tabela. No CI a tabela tinha DUAS linhas — `chat` e `voice_calls`, as
-- únicas que alguma migration inseriu de passagem — contra 35 no arquivo. O
-- teste reprovava sempre, e a mensagem ("rode gen-feature-catalog") apontava
-- para o lado errado: não havia banco de onde regerar.
--
-- E não era só teste. A guarda da migration 20270821145000 (SCRUM-409) morreu
-- pela mesma razão: afirmou "o rótulo de leads é Leads" num banco onde a linha
-- `leads` não existia.
--
-- POR QUE SEMEAR É O LADO CERTO
--
-- O catálogo de features é METADADO DE PLATAFORMA, não dado de tenant: não tem
-- `organization_id`, é global, e o código o consome como vocabulário fechado
-- (`FeatureKey` é união literal gerada dele). Vocabulário de código pertence ao
-- schema. O que é dado de cliente — quais features cada org tem — vive em
-- `organization_features`, e essa continua fora daqui.
--
-- IDEMPOTENTE E NÃO-DESTRUTIVA
--
-- `ON CONFLICT (key) DO NOTHING`: em produção, onde as 35 linhas já existem com
-- edições feitas pela equipe, nada é sobrescrito. Num banco novo, o catálogo
-- nasce igual ao que o código declara.
--
-- As linhas abaixo foram GERADAS do arquivo gerado, não digitadas — 35 linhas
-- de 10 colunas transcritas à mão divergiriam em silêncio, que é o defeito que
-- esta migration existe para fechar.
--
-- ROLLBACK pareado: rollback/20270821180000_seed_feature_catalog.sql

-- `name` e `display_name` recebem o MESMO texto: o arquivo gerado carrega só o
-- rótulo efetivo (`display_name || name || key`), e `name` é NOT NULL. Nas
-- linhas que já existem em produção os dois podem divergir — e continuam como
-- estão, porque o ON CONFLICT não toca nelas.
INSERT INTO public.feature_catalog
  (key, name, display_name, description, icon, category, sidebar_path, feature_type, position, default_enabled, is_sellable)
VALUES
  ('analytics', 'Analytics', 'Analytics', 'Painel de inteligência com métricas avançadas', 'BarChart3', 'modules', NULL, 'boolean', 0, true, true),
  ('api_access', 'Acesso API', 'Acesso API', 'Acesso a API publica', 'Code', 'advanced', NULL, 'advanced', 32, false, true),
  ('automations', 'Automações', 'Automações', 'Workflows e automações', 'Workflow', 'modules', '/automacoes', 'boolean', 0, true, true),
  ('campaigns_auto', 'Campanhas Automaticas', 'Campanhas Automaticas', 'Campanhas com IA conversacional', 'Bot', 'campaigns', NULL, 'campaign_type', 22, false, true),
  ('campaigns_manual', 'Campanhas Manuais', 'Campanhas Manuais', 'Criacao de campanhas manuais via Kanban', 'MousePointer', 'campaigns', NULL, 'campaign_type', 20, true, true),
  ('campaigns_semi', 'Campanhas Semi-Auto', 'Campanhas Semi-Auto', 'Campanhas com disparo de templates em lote', 'Zap', 'campaigns', NULL, 'campaign_type', 21, false, true),
  ('carteira', 'Carteira', 'Carteira', 'Gestão de carteira de clientes', 'TrendingUp', 'modules', '/upsell', 'boolean', 0, true, true),
  ('chat', 'Chat', 'Chat', 'Modulo de chat e mensagens WhatsApp', 'Zap', 'modules', '/chat', 'boolean', 1, true, true),
  ('commissions', 'Comissoes', 'Comissoes', 'Modulo de comissoes e pagamentos', 'DollarSign', 'modules', '/comissoes', 'boolean', 5, true, true),
  ('copilot', 'Copilot IA', 'Copilot IA', 'Acesso ao agente de IA conversacional', 'Bot', 'modules', '/copilot', 'boolean', 10, false, true),
  ('copilot_advanced', 'Copilot Avancado', 'Copilot Avancado', 'Funcoes avancadas do Copilot (follow-up, qualificacao)', 'Sparkles', 'advanced', NULL, 'advanced', 30, false, true),
  ('customer_portfolio', 'Customer Portfolio & Reorder', 'Customer Portfolio & Reorder', 'Enables customer portfolio management: health scores, reorder prediction, retention copilot, and client 360 view', 'Users', 'advanced', NULL, 'boolean', 0, false, true),
  ('deals', 'Negócios', 'Negócios', 'Gestão de negócios com produtos, probabilidade e forecast', 'Briefcase', 'modules', NULL, 'module', 0, false, true),
  ('external_cadastro', 'Cadastro Externo', 'Cadastro Externo', 'Modal de cadastro automático no sistema externo ao fechar venda', 'UserPlus', 'advanced', NULL, 'advanced', 40, false, true),
  ('funnels', 'Funis', 'Funis', 'Pipelines de qualificacao, confirmacao e propostas', 'GitBranch', 'modules', '/funis', 'boolean', 2, true, true),
  ('funnels_custom', 'Funis Customizados', 'Funis Customizados', 'Funis personalizados', 'GitBranch', 'modules', NULL, 'boolean', 0, false, true),
  ('funnels_template_indicacao', 'Funil de Indicação', 'Funil de Indicação', 'Templates de funil de indicação', 'Heart', 'modules', NULL, 'boolean', 0, false, true),
  ('funnels_template_prospeccao', 'Funil de Prospecção', 'Funil de Prospecção', 'Templates de funil de prospecção', 'Target', 'modules', NULL, 'boolean', 0, false, true),
  ('funnels_template_reativacao', 'Funil de Reativação', 'Funil de Reativação', 'Templates de funil de reativação', 'RefreshCw', 'modules', NULL, 'boolean', 0, false, true),
  ('leads', 'Leads', 'Leads', 'Gestao de leads e contatos', 'Fuel', 'modules', '/leads', 'boolean', 4, true, true),
  ('marketing', 'Marketing', 'Marketing', 'Modulo de marketing e analises', 'BarChart2', 'modules', '/marketing', 'boolean', 7, false, true),
  ('merged_opportunity_funnel', 'Funil Oportunidades Consolidado', 'Funil Oportunidades Consolidado', 'Mergeia Agendamentos em Oportunidades — anexa etapas de reunião + confirmação por status (ADR-0004)', 'GitMerge', 'advanced', NULL, 'boolean', 0, false, false),
  ('message_templates', 'Templates de Mensagem', 'Templates de Mensagem', 'Templates de mensagem com slash commands no chat', 'FileText', 'modules', '/templates', 'boolean', 0, false, true),
  ('oraculo', 'Oráculo', 'Oráculo', 'IA de análise e recomendações', 'Sparkles', 'advanced', NULL, 'boolean', 0, true, true),
  ('performance', 'Podio', 'Podio', 'Modulo de performance, ranking e metas', 'Trophy', 'modules', '/performance', 'boolean', 6, true, true),
  ('portfolio_alerts_whatsapp', 'Portfolio Alerts via WhatsApp', 'Portfolio Alerts via WhatsApp', 'Send WhatsApp notifications to salespeople when critical portfolio alerts fire', 'BellRing', 'advanced', NULL, 'boolean', 0, false, false),
  ('products', 'Produtos', 'Produtos', 'Catalogo de produtos', 'Package', 'modules', '/produtos', 'boolean', 8, true, true),
  ('review', 'Revisao', 'Revisao', 'Modulo de revisao e follow-ups', 'Wrench', 'modules', '/follow-ups', 'boolean', 3, true, true),
  ('scheduled_messages', 'Mensagens Agendadas', 'Mensagens Agendadas', 'Agendamento de mensagens WhatsApp', 'Clock', 'advanced', NULL, 'boolean', 0, true, true),
  ('tv_dashboard', 'TV Dashboard', 'TV Dashboard', 'Dashboard para exibicao em TV', 'Tv', 'modules', '/tv', 'boolean', 9, true, true),
  ('unified_message_gateway', 'Unified Message Gateway', 'Unified Message Gateway', 'Route outbound WhatsApp messages through the unified message-gateway module instead of per-caller send logic', 'Send', 'advanced', NULL, 'boolean', 0, false, false),
  ('user_write_instance_strict', 'Vínculo estrito user-instância de escrita', 'Vínculo estrito user-instância de escrita', 'Quando ativo, envio só ocorre via instância vinculada ao responsável do lead. Admin/master sempre permitidos.', 'Lock', 'advanced', NULL, 'boolean', 0, false, false),
  ('voice_calls', 'TorqueCalls (Voz)', 'TorqueCalls (Voz)', 'Chamada de voz pelo WhatsApp direto no CRM, sem sair da conversa', 'Phone', 'advanced', NULL, 'advanced', 45, false, true),
  ('whatsapp_bulk', 'Disparo em Massa', 'Disparo em Massa', 'Disparo de mensagens em lote', 'Send', 'advanced', '/disparos', 'advanced', 31, false, true),
  ('white_label', 'White Label', 'White Label', 'Personalizacao de marca', 'Palette', 'advanced', NULL, 'advanced', 33, false, true)
ON CONFLICT (key) DO NOTHING;

DO $guard$
DECLARE
  v_total int;
BEGIN
  SELECT count(*) INTO v_total FROM public.feature_catalog;
  IF v_total < 35 THEN
    RAISE EXCEPTION 'GUARDA: feature_catalog ficou com % linhas, esperado ao menos 35', v_total;
  END IF;
END
$guard$;
