-- ============================================================================
-- Catalogo de feature_permissions: convergir qualquer ambiente com producao.
--
-- CAUSA RAIZ: `supabase db reset` aplica todas as migrations do repositorio e
-- produz 11 chaves. Producao tem 81. Nenhuma migration do repositorio criava as
-- outras 70 -- foram inseridas em prod fora do ledger. Ambiente novo (dev, CI,
-- maquina de dev) nasce sem 86% do catalogo, e todo teste que exercita
-- permissao valida um comportamento que nao existe em producao.
--
-- Divergencias medidas em 2026-08-17 entre as 11 chaves comuns aos dois lados:
--   leads.view_all     default_value  prod=true  local=false
--   leads.delete       default_value  prod=true  local=false
--   team.view          is_admin_only  prod=false local=true
--   workflows.create   is_admin_only  prod=false local=true
--   workflows.edit     is_admin_only  prod=false local=true
--
-- `leads.view_all` e a mais grave: has_feature_permission() devolve
-- COALESCE(override_do_membro, default_value), entao o default decide o
-- comportamento de todo membro sem override.
--
-- IDEMPOTENTE E CORRETIVA: ON CONFLICT DO UPDATE, nao DO NOTHING. A seed atual
-- usa DO NOTHING, que e justamente por que a divergencia sobreviveu.
--
-- Em producao esta migration e NO-OP por construcao: os valores abaixo foram
-- lidos de producao (jsjsmuncfkbsbzqzqhfq) em 2026-08-17.
-- ============================================================================

INSERT INTO public.feature_permissions
  (key, module, name, description, is_admin_only, default_value, sort_order)
VALUES
  ('agenda.view', 'Agenda', 'Ver agenda', 'Acessa o calendário', false, true, 10),
  ('campaigns.view', 'Campanhas', 'Ver campanhas', 'Acessa a página de campanhas', false, true, 10),
  ('commissions.view', 'Comissões', 'Ver comissões', 'Acessa a página de comissões', false, true, 10),
  ('copilot.view', 'Copilot', 'Ver agentes IA', 'Acessa a página do Copilot', false, true, 10),
  ('followups.view', 'Follow-ups', 'Ver follow-ups', 'Acessa a página de revisão e follow-ups', false, true, 10),
  ('leads.view', 'Leads', 'Ver leads', 'Acessa a página de leads e visualiza a lista', false, true, 10),
  ('marketing.view', 'Marketing', 'Ver marketing', 'Acessa a página de analytics de marketing', false, true, 10),
  ('performance.view', 'Performance', 'Ver pódio', 'Acessa a página de performance e ranking', false, true, 10),
  ('pipeline.view', 'Pipeline', 'Ver funis', 'Acessa os funis de qualificação, confirmação e propostas', false, true, 10),
  ('products.view', 'Produtos', 'Ver produtos', 'Acessa o catálogo de produtos', false, true, 10),
  ('settings.view', 'Configurações', 'Ver configurações', 'Acessa a página de configurações', false, true, 10),
  ('team.view', 'Equipe', 'Ver equipe', 'Acessa a página de gestão de equipe', false, true, 10),
  ('upsell.view', 'Carteira', 'Ver carteira', 'Acessa a gestão de carteira de clientes', false, true, 10),
  ('voip.call.start', 'Chamadas', 'Ligar para leads', 'Permite iniciar chamada de voz pelo WhatsApp para leads sob sua responsabilidade.', false, true, 10),
  ('whatsapp.view', 'WhatsApp', 'Ver chat', 'Acessa o chat do WhatsApp', false, true, 10),
  ('workflows.view', 'Automações', 'Ver automações', 'Acessa a página de automações', false, true, 10),
  ('agenda.create', 'Agenda', 'Criar evento', 'Cria eventos e reuniões no calendário', false, true, 20),
  ('campaigns.create', 'Campanhas', 'Criar campanha', 'Cria novas campanhas', false, true, 20),
  ('commissions.view_all', 'Comissões', 'Ver comissões de todos', 'Vê comissões de todos os membros. Se desabilitado, vê apenas as próprias', false, true, 20),
  ('copilot.create', 'Copilot', 'Criar agente IA', 'Cria novos agentes de IA', false, true, 20),
  ('followups.delete', 'Follow-ups', 'Excluir follow-up', 'Remove follow-ups permanentemente', false, true, 20),
  ('leads.create', 'Leads', 'Criar lead', 'Cria novos leads manualmente', false, true, 20),
  ('marketing.configure', 'Marketing', 'Configurar investimentos', 'Define investimentos por origem de lead', false, true, 20),
  ('performance.manage_goals', 'Performance', 'Gerenciar metas', 'Cria e edita metas da equipe', false, true, 20),
  ('pipeline.move_cards', 'Pipeline', 'Mover cards', 'Arrasta cards entre estágios nos funis', false, true, 20),
  ('products.create', 'Produtos', 'Criar produto', 'Adiciona novos produtos ao catálogo', false, true, 20),
  ('settings.tags', 'Configurações', 'Gerenciar tags', 'Cria, edita e exclui tags do sistema', false, true, 20),
  ('team.create_member', 'Equipe', 'Criar membro', 'Adiciona novos usuários à organização', false, true, 20),
  ('upsell.create', 'Carteira', 'Criar cliente', 'Adiciona novos clientes à carteira', false, true, 20),
  ('voip.call.answer', 'Chamadas', 'Atender chamadas', 'Permite atender chamadas de voz recebidas no número da organização.', false, true, 20),
  ('whatsapp.send_messages', 'WhatsApp', 'Enviar mensagens', 'Envia mensagens de texto, áudio e imagem', false, true, 20),
  ('workflows.create', 'Automações', 'Criar automação', 'Cria novos workflows de automação', false, true, 20),
  ('agenda.edit', 'Agenda', 'Editar evento', 'Edita eventos existentes', false, true, 30),
  ('campaigns.edit', 'Campanhas', 'Editar campanha', 'Edita configurações e estágios de campanhas', false, true, 30),
  ('copilot.edit', 'Copilot', 'Editar agente IA', 'Configura e edita agentes existentes', false, true, 30),
  ('followups.bulk_archive', 'Follow-ups', 'Arquivar em lote', 'Arquiva múltiplos follow-ups de uma vez', false, true, 30),
  ('leads.edit', 'Leads', 'Editar lead', 'Edita informações de leads existentes', false, true, 30),
  ('performance.manage_awards', 'Performance', 'Gerenciar premiações', 'Cria e edita premiações e badges', false, true, 30),
  ('pipeline.delete_cards', 'Pipeline', 'Excluir cards', 'Remove cards dos funis', false, true, 30),
  ('products.edit', 'Produtos', 'Editar produto', 'Edita produtos existentes', false, true, 30),
  ('settings.integrations', 'Configurações', 'Gerenciar integrações', 'Configura Meta, Google Calendar, TinyERP e webhooks', false, true, 30),
  ('team.edit_member', 'Equipe', 'Editar membro', 'Edita dados e configurações de membros', false, true, 30),
  ('upsell.move', 'Carteira', 'Mover clientes', 'Move clientes entre estágios da carteira', false, true, 30),
  ('voip.call.dial_manual', 'Chamadas', 'Discar número avulso', 'Permite discar um número digitado à mão, sem lead vinculado. Sem lead não há fronteira de visibilidade nem trilha no histórico.', false, false, 30),
  ('whatsapp.create_lead', 'WhatsApp', 'Criar lead pelo chat', 'Cria um novo lead a partir de uma conversa', false, true, 30),
  ('workflows.edit', 'Automações', 'Editar automação', 'Edita workflows existentes', false, true, 30),
  ('agenda.delete', 'Agenda', 'Excluir evento', 'Remove eventos do calendário', false, true, 40),
  ('campaigns.delete', 'Campanhas', 'Excluir campanha', 'Exclui campanhas permanentemente', false, true, 40),
  ('copilot.delete', 'Copilot', 'Excluir agente IA', 'Exclui agentes permanentemente', false, true, 40),
  ('followups.configure', 'Follow-ups', 'Configurar automações', 'Define regras de automação de follow-up', false, true, 40),
  ('leads.delete', 'Leads', 'Excluir lead', 'Exclui leads permanentemente', false, true, 40),
  ('pipeline.delete_all_stage', 'Pipeline', 'Excluir todos de um estágio', 'Limpa todos os cards de um estágio de uma vez. Ação irreversível', false, true, 40),
  ('products.delete', 'Produtos', 'Excluir produto', 'Remove produtos do catálogo', false, true, 40),
  ('settings.notifications', 'Configurações', 'Preferências de notificação', 'Configura preferências pessoais de notificação', false, true, 40),
  ('team.delete_member', 'Equipe', 'Excluir membro', 'Remove membros da organização', false, true, 40),
  ('voip.session.manage', 'Chamadas', 'Gerenciar número de chamadas', 'Parear, adotar e desconectar o número usado para chamadas de voz.', true, false, 40),
  ('whatsapp.manage_tags', 'WhatsApp', 'Gerenciar tags na conversa', 'Adiciona e remove tags em conversas', false, true, 40),
  ('workflows.toggle', 'Automações', 'Ativar/desativar automação', 'Liga e desliga workflows', false, true, 40),
  ('campaigns.import_leads', 'Campanhas', 'Importar leads na campanha', 'Adiciona leads em lote a uma campanha', false, true, 50),
  ('copilot.toggle', 'Copilot', 'Ativar/desativar agente', 'Liga e desliga agentes de IA', false, true, 50),
  ('leads.import', 'Leads', 'Importar leads', 'Faz upload de CSV/Excel para importar leads em lote', false, true, 50),
  ('pipeline.configure', 'Pipeline', 'Configurar funis', 'Altera configurações, estágios e regras dos funis', false, true, 50),
  ('products.import', 'Produtos', 'Importar produtos', 'Importa produtos em lote via arquivo', false, true, 50),
  ('team.manage_permissions', 'Equipe', 'Gerenciar permissões', 'Configura permissões individuais de cada membro', false, true, 50),
  ('whatsapp.toggle_copilot', 'WhatsApp', 'Ativar/desativar Copilot', 'Liga e desliga a IA em conversas individuais', false, true, 50),
  ('workflows.delete', 'Automações', 'Excluir automação', 'Exclui workflows permanentemente', false, true, 50),
  ('campaigns.send_messages', 'Campanhas', 'Disparar mensagens', 'Envia mensagens em massa pela campanha', false, true, 60),
  ('copilot.view_metrics', 'Copilot', 'Ver métricas LLM', 'Visualiza métricas de uso e custo da IA', false, true, 60),
  ('leads.export', 'Leads', 'Exportar leads', 'Exporta leads para CSV/Excel', false, true, 60),
  ('pipeline.custom_create', 'Pipeline', 'Criar funis customizados', 'Cria novos funis personalizados', false, true, 60),
  ('whatsapp.archive', 'WhatsApp', 'Arquivar conversas', 'Arquiva e desarquiva conversas', false, true, 60),
  ('campaigns.manage_stages', 'Campanhas', 'Gerenciar estágios', 'Cria, edita e exclui estágios da campanha', false, true, 70),
  ('leads.view_all', 'Leads', 'Ver leads de todos', 'Vê leads atribuídos a outros membros. Se desabilitado, vê apenas os próprios', false, true, 70),
  ('pipeline.custom_delete', 'Pipeline', 'Excluir funis customizados', 'Exclui funis personalizados inteiros', false, true, 70),
  ('whatsapp.delete', 'WhatsApp', 'Excluir conversas', 'Exclui conversas permanentemente', false, true, 70),
  ('leads.view_unassigned', 'Leads', 'Ver leads sem responsável', 'Vê leads que não estão atribuídos a nenhum membro', false, true, 71),
  ('leads.view_subordinates', 'Leads', 'Ver leads da equipe', 'Vê leads atribuídos a outros membros da mesma organização', false, true, 72),
  ('leads.view_general_info', 'Leads', 'Ver informações gerais', 'Vê informações gerais de leads de outros responsáveis', false, true, 73),
  ('whatsapp.manage_instances', 'WhatsApp', 'Gerenciar instâncias', 'Conecta, desconecta e configura instâncias do WhatsApp', false, true, 80),
  ('leads.reassign', 'Leads', 'Atribuir respons�veis', 'Permite alterar os respons�veis (pr�-venda / venda) de um lead.', false, true, 100),
  ('leads.remove_from_pipe', 'Leads', 'Remover de pipe', 'Permite remover um lead de um funil.', false, true, 101)
ON CONFLICT (key) DO UPDATE SET
  module        = EXCLUDED.module,
  name          = EXCLUDED.name,
  description   = EXCLUDED.description,
  is_admin_only = EXCLUDED.is_admin_only,
  default_value = EXCLUDED.default_value,
  sort_order    = EXCLUDED.sort_order;

COMMENT ON TABLE public.feature_permissions IS
  'Catalogo GLOBAL de permissoes (sem organization_id). default_value vale para todo membro sem override em member_feature_permissions. Mantido em paridade com producao pela migration 20270818120000 -- ao adicionar chave nova, adicione ali tambem, senao ambiente novo nasce sem ela.';
