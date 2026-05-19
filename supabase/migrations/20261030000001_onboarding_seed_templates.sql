-- Seed initial pipeline + automation templates for onboarding

-- ══════════════════════════════════════════════════════════════════════════════
-- Pipeline Templates
-- ══════════════════════════════════════════════════════════════════════════════

-- Default fallback: matches everything (priority 0)
INSERT INTO public.onboarding_pipeline_templates (name, description, icon, color, default_pipelines_config, custom_pipelines, match_criteria, priority)
VALUES (
  'Padrão Vendas',
  'Pipeline padrão para qualquer operação de vendas',
  'TrendingUp',
  '#7dc4e4',
  '{"pipe_whatsapp": {"visible": true}, "pipe_confirmacao": {"visible": false}, "pipe_propostas": {"visible": true}}'::jsonb,
  '[{
    "name": "Vendas",
    "icon": "TrendingUp",
    "color": "#7dc4e4",
    "stages": [
      {"name": "Novo Lead", "color": "#7dc4e4", "position": 0, "is_final_positive": false, "is_final_negative": false},
      {"name": "Em Contato", "color": "#f6c177", "position": 1, "is_final_positive": false, "is_final_negative": false},
      {"name": "Negociação", "color": "#ca9ee6", "position": 2, "is_final_positive": false, "is_final_negative": false},
      {"name": "Vendido", "color": "#a6d189", "position": 3, "is_final_positive": true, "is_final_negative": false},
      {"name": "Perdido", "color": "#e78284", "position": 4, "is_final_positive": false, "is_final_negative": true}
    ]
  }]'::jsonb,
  '{}'::jsonb,
  0
);

-- WhatsApp direct sales
INSERT INTO public.onboarding_pipeline_templates (name, description, icon, color, default_pipelines_config, custom_pipelines, match_criteria, priority)
VALUES (
  'Vendas WhatsApp Direto',
  'Operação de vendas rápidas via WhatsApp',
  'MessageSquare',
  '#a6d189',
  '{"pipe_whatsapp": {"visible": true, "label": "Oportunidades WhatsApp"}, "pipe_confirmacao": {"visible": false}, "pipe_propostas": {"visible": false}}'::jsonb,
  '[{
    "name": "Vendas WhatsApp",
    "icon": "MessageSquare",
    "color": "#a6d189",
    "stages": [
      {"name": "Novo Lead", "color": "#7dc4e4", "position": 0, "is_final_positive": false, "is_final_negative": false},
      {"name": "Abordado", "color": "#f6c177", "position": 1, "is_final_positive": false, "is_final_negative": false},
      {"name": "Respondeu", "color": "#ca9ee6", "position": 2, "is_final_positive": false, "is_final_negative": false},
      {"name": "Vendido", "color": "#a6d189", "position": 3, "is_final_positive": true, "is_final_negative": false},
      {"name": "Perdido", "color": "#e78284", "position": 4, "is_final_positive": false, "is_final_negative": true}
    ]
  }]'::jsonb,
  '{"perfil.sells": ["produto", "ambos"]}'::jsonb,
  10
);

-- B2B Consultive (SDR + Closer)
INSERT INTO public.onboarding_pipeline_templates (name, description, icon, color, default_pipelines_config, custom_pipelines, match_criteria, priority)
VALUES (
  'Vendas Consultivas B2B',
  'SDR qualifica, Closer fecha. Reuniões e propostas.',
  'Users',
  '#ca9ee6',
  '{"pipe_whatsapp": {"visible": true, "label": "Qualificação"}, "pipe_confirmacao": {"visible": true, "label": "Reuniões"}, "pipe_propostas": {"visible": true, "label": "Propostas"}}'::jsonb,
  '[{
    "name": "Qualificação SDR",
    "icon": "UserCheck",
    "color": "#7dc4e4",
    "stages": [
      {"name": "Novo Lead", "color": "#7dc4e4", "position": 0, "is_final_positive": false, "is_final_negative": false},
      {"name": "Contatado", "color": "#f6c177", "position": 1, "is_final_positive": false, "is_final_negative": false},
      {"name": "Qualificado", "color": "#a6d189", "position": 2, "is_final_positive": true, "is_final_negative": false},
      {"name": "Descartado", "color": "#e78284", "position": 3, "is_final_positive": false, "is_final_negative": true}
    ]
  }, {
    "name": "Fechamento",
    "icon": "Target",
    "color": "#ca9ee6",
    "stages": [
      {"name": "Reunião Marcada", "color": "#7dc4e4", "position": 0, "is_final_positive": false, "is_final_negative": false},
      {"name": "Proposta Enviada", "color": "#f6c177", "position": 1, "is_final_positive": false, "is_final_negative": false},
      {"name": "Negociação", "color": "#ca9ee6", "position": 2, "is_final_positive": false, "is_final_negative": false},
      {"name": "Vendido", "color": "#a6d189", "position": 3, "is_final_positive": true, "is_final_negative": false},
      {"name": "Perdido", "color": "#e78284", "position": 4, "is_final_positive": false, "is_final_negative": true}
    ]
  }]'::jsonb,
  '{"estrutura.has_sdr": ["true"], "processo.schedules_meeting": ["true"]}'::jsonb,
  20
);

-- ══════════════════════════════════════════════════════════════════════════════
-- Automation Templates
-- ══════════════════════════════════════════════════════════════════════════════

-- Boas-vindas (universal)
INSERT INTO public.onboarding_automation_templates (name, description, type, icon, trigger_type, trigger_config, workflow_definition, customizable_fields, match_criteria)
VALUES (
  'Boas-vindas Novo Lead',
  'Envia mensagem automática quando um novo lead entra no pipeline',
  'boas_vindas',
  '👋',
  'lead_created',
  '{}'::jsonb,
  '{
    "nodes": [
      {"id": "trigger_1", "type": "trigger", "position": {"x": 250, "y": 50}, "data": {"trigger_type": "lead_created"}},
      {"id": "delay_1", "type": "delay", "position": {"x": 250, "y": 180}, "data": {"amount": 30, "unit": "seconds"}},
      {"id": "action_1", "type": "action", "position": {"x": 250, "y": 310}, "data": {"action_type": "send_whatsapp", "message": "Olá {{nome}}! Recebemos seu contato e vamos te atender em breve. Enquanto isso, posso te ajudar com algo?"}}
    ],
    "edges": [
      {"id": "e1", "source": "trigger_1", "target": "delay_1"},
      {"id": "e2", "source": "delay_1", "target": "action_1"}
    ]
  }'::jsonb,
  '[{"field_path": "nodes[2].data.message", "label": "Mensagem de boas-vindas", "type": "textarea", "default_value": "Olá {{nome}}! Recebemos seu contato e vamos te atender em breve. Enquanto isso, posso te ajudar com algo?", "placeholder": "Digite a mensagem que novos leads receberão..."}]'::jsonb,
  NULL
);

-- Follow-up inatividade (universal)
INSERT INTO public.onboarding_automation_templates (name, description, type, icon, trigger_type, trigger_config, workflow_definition, customizable_fields, match_criteria)
VALUES (
  'Follow-up 24h',
  'Reengaja lead que não respondeu em 24 horas',
  'follow_up',
  '🔄',
  'lead_no_reply',
  '{"timeout_hours": 24}'::jsonb,
  '{
    "nodes": [
      {"id": "trigger_1", "type": "trigger", "position": {"x": 250, "y": 50}, "data": {"trigger_type": "lead_no_reply", "timeout_hours": 24}},
      {"id": "action_1", "type": "action", "position": {"x": 250, "y": 180}, "data": {"action_type": "send_whatsapp", "message": "Oi {{nome}}, tudo bem? Vi que ainda não conseguimos conversar. Posso te ajudar com alguma dúvida?"}}
    ],
    "edges": [
      {"id": "e1", "source": "trigger_1", "target": "action_1"}
    ]
  }'::jsonb,
  '[{"field_path": "nodes[1].data.message", "label": "Mensagem de follow-up", "type": "textarea", "default_value": "Oi {{nome}}, tudo bem? Vi que ainda não conseguimos conversar. Posso te ajudar com alguma dúvida?", "placeholder": "Digite a mensagem de reengajamento..."}]'::jsonb,
  NULL
);

-- Confirmação reunião (match: schedules_meeting = true)
INSERT INTO public.onboarding_automation_templates (name, description, type, icon, trigger_type, trigger_config, workflow_definition, customizable_fields, match_criteria)
VALUES (
  'Confirmação de Reunião',
  'Confirma presença D-5, D-3 e D-1 antes da reunião',
  'confirmacao_reuniao',
  '📅',
  'meeting_confirmed',
  '{}'::jsonb,
  '{
    "nodes": [
      {"id": "trigger_1", "type": "trigger", "position": {"x": 250, "y": 50}, "data": {"trigger_type": "meeting_confirmed"}},
      {"id": "delay_d5", "type": "delay", "position": {"x": 250, "y": 180}, "data": {"amount": 5, "unit": "days_before_meeting"}},
      {"id": "action_d5", "type": "action", "position": {"x": 250, "y": 310}, "data": {"action_type": "send_whatsapp", "message": "Olá {{nome}}! Confirmando sua reunião para {{data_reuniao}}. Posso confirmar sua presença?"}},
      {"id": "delay_d3", "type": "delay", "position": {"x": 250, "y": 440}, "data": {"amount": 3, "unit": "days_before_meeting"}},
      {"id": "action_d3", "type": "action", "position": {"x": 250, "y": 570}, "data": {"action_type": "send_whatsapp", "message": "Oi {{nome}}, sua reunião é em 3 dias ({{data_reuniao}}). Está tudo confirmado?"}},
      {"id": "delay_d1", "type": "delay", "position": {"x": 250, "y": 700}, "data": {"amount": 1, "unit": "days_before_meeting"}},
      {"id": "action_d1", "type": "action", "position": {"x": 250, "y": 830}, "data": {"action_type": "send_whatsapp", "message": "{{nome}}, sua reunião é amanhã! Confirma presença?"}}
    ],
    "edges": [
      {"id": "e1", "source": "trigger_1", "target": "delay_d5"},
      {"id": "e2", "source": "delay_d5", "target": "action_d5"},
      {"id": "e3", "source": "action_d5", "target": "delay_d3"},
      {"id": "e4", "source": "delay_d3", "target": "action_d3"},
      {"id": "e5", "source": "action_d3", "target": "delay_d1"},
      {"id": "e6", "source": "delay_d1", "target": "action_d1"}
    ]
  }'::jsonb,
  '[
    {"field_path": "nodes[2].data.message", "label": "Mensagem D-5", "type": "textarea", "default_value": "Olá {{nome}}! Confirmando sua reunião para {{data_reuniao}}. Posso confirmar sua presença?", "placeholder": "Mensagem 5 dias antes..."},
    {"field_path": "nodes[4].data.message", "label": "Mensagem D-3", "type": "textarea", "default_value": "Oi {{nome}}, sua reunião é em 3 dias ({{data_reuniao}}). Está tudo confirmado?", "placeholder": "Mensagem 3 dias antes..."},
    {"field_path": "nodes[6].data.message", "label": "Mensagem D-1", "type": "textarea", "default_value": "{{nome}}, sua reunião é amanhã! Confirma presença?", "placeholder": "Mensagem 1 dia antes..."}
  ]'::jsonb,
  '{"processo.schedules_meeting": ["true"]}'::jsonb
);
