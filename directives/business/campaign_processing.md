# Processamento de Campanha

## Objetivo
Processar leads de uma campanha, aplicar regras de atribuição de SDRs, atualizar métricas da campanha e criar histórico de ações.

## Entradas
- campaign_id: string - ID da campanha (obrigatório)
- leads: object[] - Array de leads a processar (obrigatório)
- assignment_rules: object - Regras de atribuição de SDRs (obrigatório)
- tenant_id: string - ID da organização (obrigatório)
- user_id: string - ID do usuário que está executando (obrigatório)

## Ferramentas
- `execution/typescript/business/process_campaign.ts` - Script de processamento de campanha

## Saídas
- leads_processed: number - Número de leads processados
- leads_assigned: number - Número de leads com SDR atribuído
- campaign_metrics: object - Métricas atualizadas da campanha
- errors: string[] - Lista de erros encontrados durante processamento

## Edge Cases
- Campanha não encontrada: Retornar erro
- Leads vazios: Retornar sucesso com contadores zerados
- SDRs indisponíveis: Distribuir entre SDRs disponíveis ou deixar sem atribuição
- Lead já atribuído: Respeitar atribuição existente ou sobrescrever conforme regra
- Tenant sem subscription: Bloquear execução
- Regras de atribuição conflitantes: Aplicar primeira regra válida
- Lead duplicado na campanha: Ignorar ou atualizar conforme configuração

## Instância WhatsApp por campanha
- Campanhas **semi_automatica** e **automatica** podem ter `whatsapp_instance_id` (FK `whatsapp_instances`). Definido na criação/edição da campanha (opcional).
- **semi-automatic-dispatch**: ao processar batch, usa `campanha.whatsapp_instance_id` se preenchido; caso contrário, primeira instância ativa da organização (`status = 'open'` ou `'connected'`).
- **campaign-rule-dispatch** (regras de envio por etapa): cada linha de `scheduled_campaign_messages` guarda `whatsapp_instance_id` no momento do agendamento (snapshot da campanha). O worker usa essa instância ou fallback para primeira instância ativa da org.

## Regras de envio por etapa (sequência de mensagens)
- **campanha_dispatch_rules**: por campanha, regras com `trigger_type` = `lead_created` (ao adicionar lead) ou `lead_moved_to_stage` (ao mover para etapa; exige `campanha_stage_id`).
- **campanha_dispatch_rule_steps**: por regra, sequência de passos (template + `delay_minutes` + `position`). Pelo menos um step por regra.
- **Gatilhos (PL/pgSQL)**:
  - **INSERT** em `campanha_leads`: para cada regra ativa com `trigger_type = 'lead_created'`, gera N linhas em `scheduled_campaign_messages` (uma por step; `scheduled_at` = NOW + soma dos delays anteriores).
  - **UPDATE** de `stage_id` em `campanha_leads`: para regras com `trigger_type = 'lead_moved_to_stage'` e `campanha_stage_id = NEW.stage_id`, mesma lógica. Idempotência: não insere se já existir mensagem (agendada ou enviada) para o mesmo `(campanha_lead_id, rule_id)`.
- **Worker** (Edge Function `campaign-rule-dispatch`): consulta `scheduled_campaign_messages` com `status = 'scheduled'` e `scheduled_at <= NOW()`; envia via Evolution API (texto/áudio, substituição de variáveis); atualiza status e `outbound_dispatch_log`; respeita rate limit por organização/instância.
- UI: na tela de detalhe da campanha, seção "Regras de envio por etapa" (CRUD de regras e passos; templates vinculados à campanha; etapas da campanha para gatilho "movido para etapa").
- **RLS e permissões:** SELECT em `campanha_dispatch_rules` e `campanha_dispatch_rule_steps` permitido para `authenticated` da mesma organização (via campanha). INSERT, UPDATE e DELETE exigem `public.is_user_admin()` — apenas administradores podem criar/editar/remover regras. Usuários não admin (ex.: "Chefe de Equipe" sem role admin) recebem 403; a UI exibe mensagem: "Sem permissão para criar regras de envio. Apenas administradores podem criar regras."

## Checklist: envio automático por cron (regras por etapa)
Para que as mensagens agendadas sejam processadas automaticamente a cada minuto:
- Migrations aplicadas: `20260301000000_campanhas_whatsapp_instance_and_dispatch_rules.sql`, `20260301010000_campanha_leads_dispatch_rules_trigger.sql`, `20260310000000_campaign_rule_dispatch_cron.sql`.
- Execute o script `supabase/scripts/setup_campaign_rule_dispatch_cron.sql` no SQL Editor, substituindo `PROJECT_REF` e `cron_secret` pelos valores do seu projeto.
- Em `cron_config`: `campaign_rule_dispatch_url` = `https://<PROJECT_REF>.supabase.co/functions/v1/campaign-rule-dispatch`; `cron_secret` igual ao valor definido em Edge Function Secrets como `CRON_SECRET`.
- Secrets da Edge Function: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`; opcional `CRON_SECRET` para proteger chamadas do cron.
- Extensões pg_cron e pg_net habilitadas no projeto (Supabase Dashboard → Database → Extensions).
- **Disparo manual:** Na UI, seção "Regras de envio por etapa", botão "Processar fila agora" (requer usuário admin). A função aceita `x-cron-secret` (cron) ou JWT de admin (UI).

## Alternativas sem pg_cron (Free Tier ou extensões indisponíveis)
Se pg_cron ou pg_net não estiverem disponíveis, use um cron externo para chamar a Edge Function a cada minuto:
- **n8n:** Schedule Trigger (`*/1 * * * *`) + HTTP Request (POST com header `x-cron-secret`)
- **GitHub Actions:** Workflow com `schedule: '* * * * *'` e step que faz POST na URL da função
- **Vercel Cron:** Se o app estiver na Vercel, criar rota API protegida que invoca a função
- Instruções detalhadas em `supabase/functions/campaign-rule-dispatch/README.md`

## Edição de regras na UI
- Cada regra exibe botão de editar (ícone lápis) e excluir.
- Ao editar: modal com gatilho, etapa (quando aplicável) e sequência de passos (template + delay).
- Salvando: atualiza a regra, remove passos antigos e cria os novos (idempotente).

## Aprendizados
(Atualizado automaticamente pelo sistema)
