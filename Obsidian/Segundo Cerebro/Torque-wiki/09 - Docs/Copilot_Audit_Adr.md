---
tags:
  - torque-crm
  - docs
  - reference
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/COPILOT_AUDIT_ADR.md
---

# ADR: Auditoria do Sistema Copilot (IAs Conversacionais)

**Data:** 2026-02-12  
**Status:** Aprovado  
**Escopo:** AgentEngine, Evolution Webhook, Outbound, Follow-ups, Campanhas, Prompts, Pipeline

---

## 1. Resumo Executivo

Auditoria completa do sistema de IAs conversacionais (Copilot) do v8milennialsb2b. Identificou **2 lacunas críticas**, várias melhorias de qualidade e oportunidades de otimização.

---

## 2. Mapeamento de Arquivos e Fluxos

### 2.1 Fluxo Inbound (Reativo)

```
WhatsApp → Evolution API → evolution-webhook
    → getOrCreateLead / associateMessagesToLead
    → triggerAgentMessage (agent-message Edge Function)
    → AgentEngine.processMessage()
    → OpenRouter LLM → Resposta
    → sendWhatsAppResponse (Evolution API)
```

**Arquivos principais:**
- `supabase/functions/evolution-webhook/index.ts` – Recebe mensagens, chama agent-message
- `supabase/functions/agent-message/agent-engine.ts` – Core conversacional
- `supabase/functions/agent-message/openrouter-client.ts` – Cliente LLM

### 2.2 Fluxo Outbound (Proativo – primeira mensagem)

```
lead-webhook (novo lead)
    → outbound-trigger (POST)
    → Verifica activation_triggers
    → Cria outbound_dispatch_log
    → Se delay=0: sendOutboundMessage imediatamente
    → Se delay>0: ⚠️ NUNCA ENVIA (lacuna crítica)
```

**Arquivos principais:**
- `supabase/functions/lead-webhook/index.ts` – Linhas 486-516 chamam outbound-trigger
- `supabase/functions/outbound-trigger/index.ts` – Dispara primeira mensagem

### 2.3 Regras de Follow-up (Copilot)

```
copilot_agent_followup_rules (tabela)
    → getNextSendTime (followupSchedule.ts)
    → ⚠️ NENHUM EXECUTOR (lacuna crítica)
```

**Arquivos principais:**
- `src/lib/copilot/followupSchedule.ts` – Lógica de horário comercial
- `src/hooks/useAgentFollowupRules.ts` – CRUD de regras
- `src/components/copilot/wizard-steps/FollowupRulesStep.tsx` – UI do wizard
- `src/components/copilot/AgentFollowupRulesTab.tsx` – Tab de configuração

**Nota:** `execution/typescript/business/create_follow_ups.ts` usa a tabela `follow_ups` (SDR/Açoes do Dia), **não** `copilot_agent_followup_rules`. São sistemas diferentes.

### 2.4 Integração com Campanhas

```
campanhas.agent_id → CampanhaAutomaticaPanel
    → Disparos via campaign_dispatch_batches / campaign_dispatch_log
```

**Arquivos principais:**
- `src/components/campanhas/CampanhaAutomaticaPanel.tsx`
- `src/components/campanhas/CreateCampanhaModal.tsx` – AgentSelectorStep
- `src/hooks/useCampaignTemplates.ts` – useDispatchLog, useDispatchStats

### 2.5 Prompts e Templates

```
copilot_agents.system_prompt (banco) OU buildDynamicPrompt (agent-engine)
    + template-prompts.ts (qualificador, SDR, followup, agendador, prospectador)
```

**Arquivos principais:**
- `src/lib/copilot/template-prompts.ts` – Metodologias e exemplos
- `agent-engine.ts` – buildDynamicPrompt (linhas 666-975)
- `src/hooks/useCopilotPromptBuilder.ts` – Gerador de prompt no quiz

---

## 3. Lacunas Identificadas

### 3.1 CRÍTICA: Disparos Outbound com delay > 0 nunca são enviados

**Problema:** Quando `outbound_config.delayMinutes > 0`, o outbound-trigger cria um registro em `outbound_dispatch_log` com `status='pending'` e `scheduled_at` no futuro. **Não existe nenhum job/cron que processe esses pendentes.**

**Impacto:** Leads que deveriam receber mensagem após 5, 15 ou 60 minutos nunca recebem.

**Solução:** ✅ **IMPLEMENTADO** - Edge Function `process-outbound-dispatches`:
1. Busca `outbound_dispatch_log` onde `status='pending'`, `agent_id IS NOT NULL` e `scheduled_at <= now()`
2. Para cada registro, usa `_shared/outbound-sender.ts` para enviar via Evolution API
3. Atualiza status para `sent` ou `failed`
4. **Próximo passo:** Configurar cron (ex.: a cada 5 min) - ver `supabase/functions/process-outbound-dispatches/README.md`

### 3.1.1 Security headers aplicados

Headers de segurança (OWASP) foram adicionados via `_shared/security-headers.ts` e aplicados em:
- `evolution-webhook`
- `agent-message`
- `outbound-trigger`
- `process-outbound-dispatches`
- `process-copilot-followups`

### 3.2 CRÍTICA: Regras de Follow-up do Copilot não são executadas

**Problema:** As regras em `copilot_agent_followup_rules` (no_response, scheduled, etc.) são configuráveis na UI, mas **nenhum processo as executa**. A função `getNextSendTime` existe mas nunca é chamada em produção.

**Impacto:** Follow-ups automáticos de reengajamento (ex.: 24h ou 72h sem resposta) nunca disparam.

**Solução:** ✅ **IMPLEMENTADO** - Edge Function `process-copilot-followups`:
1. Busca leads que qualificam para cada regra ativa (última mensagem + delay)
2. Aplica filtros (tags, origens, pipes, stages)
3. Usa `getNextSendTime` para horário comercial
4. Gera mensagem contextualizada (usando AgentEngine ou prompt direto)
5. Envia via Evolution API e registra execução

### 3.3 MÉDIA: Kanban Rules não usadas no AgentEngine

**Problema:** `copilot_agent_kanban_rules` define goal, behavior, allowed/forbidden actions por etapa. O AgentEngine usa apenas `determineNextState` baseado em tools e capabilities, **não** nas regras do Kanban.

**Impacto:** Comportamento por etapa pode ficar inconsistente com o configurado.

**Solução:** Em `buildDynamicPrompt` ou `processLLMResponse`, injetar as regras do Kanban para a etapa atual do lead.

### 3.4 BAIXA: conversation_context_summary pode não existir

**Problema:** O AgentEngine usa `conversation_context_summary` para contexto de follow-up. Se a tabela não existir em algumas instalaçoes, `loadConversationContext` pode falhar ou retornar contexto vazio.

**Solução:** Garantir migration que crie `conversation_context_summary` e tratamento de erro graceful.

---

## 4. Auditoria de Prompts

### 4.1 buildDynamicPrompt (agent-engine.ts)

**Pontos positivos:**
- Prioriza `system_prompt` do quiz quando existe
- Monta seçoes claras: identidade, personalidade, objetivo, contexto, FAQs, capabilities
- Injeta dados do lead e contexto da última conversa
- Instruçoes finais (transparência, ética, transferência humana)

**Pontos a melhorar:**
- Seção "CONTEXTO DA CONVERSA" duplicada (linhas 957–962 e 965–968)
- `conversation.context` pode ser vazio ou desatualizado
- Falta instrução explícita sobre quando NÃO responder (ex.: fora do horário)

### 4.2 template-prompts.ts

**Pontos positivos:**
- Metodologias bem definidas (BANT+, SPIN, AIDA, cadências)
- Anti-patterns claros
- Detecção de intenção e gatilhos de transferência
- Exemplos few-shot por template
- defaultFollowupRules coerentes com cada template

**Pontos a melhorar:**
- Exemplos em português poderiam ter mais variação de tom
- Falta template para "suporte" ou "pós-venda" se for caso de uso futuro

---

## 5. Validação de Regras de Follow-up

### 5.1 followupSchedule.ts

**Pontos positivos:**
- Respeita timezone
- Respeita horário comercial e dias da semana
- `getNextWindowStartUtc` avança até próximo dia permitido

**Pontos de atenção:**
- `trigger_delay_hours` negativo (scheduled antes do evento) – usado em agendador; verificar se a lógica de "evento" está implementada

### 5.2 FollowupRulesStep / AgentFollowupRulesTab

**Pontos positivos:**
- UI completa para CRUD de regras
- Filtros (tags, origens, pipes, stages)
- Estilos (direct, value, curiosity, breakup)

**Gap:** Nenhum componente chama a execução das regras.

---

## 6. Segurança e Headers

Conforme regra do projeto: *Always prioritize security headers when coding*.

**Status atual:**
- Edge Functions usam `corsHeaders` genéricos
- Nenhum header de segurança explícito (X-Content-Type-Options, X-Frame-Options, etc.) nas respostas das Edge Functions

**Recomendação:** Adicionar headers mínimos em respostas de webhooks/APIs:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` (ou SAMEORIGIN se necessário)

---

## 7. Decisoes e Próximos Passos

| Decisão | Alternativas | Razão |
|---------|--------------|-------|
| Criar `process-outbound-dispatches` | n8n, pg_cron | Edge Function é nativo ao Supabase, fácil de agendar |
| Criar `process-copilot-followups` | n8n, worker externo | Mesma razão; centraliza lógica no projeto |
| Documentar lacunas em ADR | - | Preservar conhecimento e facilitar onboarding |

---

## 8. Quick Wins (Prioridade Alta)

1. **Implementar process-outbound-dispatches** – Edge Function + cron para pendentes de outbound
2. **Implementar process-copilot-followups** – Edge Function + cron para regras de follow-up
3. **Adicionar security headers** nas respostas das Edge Functions prioritárias

---

## 9. Melhorias Médio Prazo

1. Integrar `copilot_agent_kanban_rules` no AgentEngine
2. Remover duplicação na seção de contexto do `buildDynamicPrompt`
3. Criar migration para `conversation_context_summary` se ausente
4. Adicionar testes unitários para `followupSchedule.getNextSendTime`

---

## 10. Referências

- `directives/business/follow_up_automation.md`
- `docs/COPILOT_PERMISSIONS.md`
- Postgres Best Practices (indexes em `outbound_dispatch_log`, `copilot_agent_followup_rules`)


## Links relacionados

- [[Onboarding]]

- [[Webhooks]]

- [[n8n Orquestracao]]

- [[Follow-ups]]

- [[Campanhas]]

- [[OpenRouter Setup]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
