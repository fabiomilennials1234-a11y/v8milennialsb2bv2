# Copilot – Export completo para outro sistema

Este documento reúne **prompts**, **quiz (wizard)** e **permissões** do Copilot para você replicar em outro sistema. Use como referência para colar/adaptar.

---

## 1. PERMISSÕES

### 1.1 Regras de negócio (texto)

| Ação | Quem pode | Onde |
|------|-----------|------|
| **Criar** copilot | Admin ou Closer (com assinatura ativa para a organização) | Menu Copilot → Novo Copilot |
| **Vincular** copilot a número/WhatsApp | Apenas Admin | Configurações → WhatsApp ou Copilot → Configurações do agente |
| **Ativar/desativar** IA na conversa (por lead) | Qualquer vendedor (SDR/Closer) que possa **ver e editar** aquele lead | Cabeçalho do chat, painel do lead, card no kanban |

- **Criar/editar/deletar** copilots, FAQs, regras Kanban, regras de follow-up: **Admin e Closer** (via `user_roles.role IN ('admin','closer')`).
- **Vincular** copilot a instância WhatsApp: apenas **Admin** (definido na UI, não na RLS).
- **Ligar/desligar** IA por conversa: quem pode **atualizar** o lead (RLS de leads) pode alterar o toggle “IA Copilot” naquele lead.

### 1.2 Políticas RLS (SQL – Supabase/Postgres)

Função auxiliar:

```sql
CREATE OR REPLACE FUNCTION public.is_admin_or_closer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('admin', 'closer')
  );
$$;
```

**copilot_agents** – INSERT/UPDATE/DELETE apenas para usuários da organização que sejam admin ou closer:

```sql
-- INSERT
CREATE POLICY "Admins and closers can insert agents"
  ON public.copilot_agents FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND public.is_admin_or_closer()
  );

-- UPDATE
CREATE POLICY "Admins and closers can update agents from their organization"
  ON public.copilot_agents FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND public.is_admin_or_closer()
  );

-- DELETE
CREATE POLICY "Admins and closers can delete agents from their organization"
  ON public.copilot_agents FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND public.is_admin_or_closer()
  );
```

**copilot_agent_faqs** e **copilot_agent_kanban_rules**: mesma lógica – apenas quem é admin ou closer e o agente pertence à organização do usuário (via `agent_id IN (SELECT id FROM copilot_agents WHERE organization_id IN (...))`).

---

## 2. QUIZ (WIZARD) – Estrutura completa

O “quiz” é um wizard de **18 etapas**. A ordem e os nomes são:

| # | Título       | Conteúdo principal |
|---|--------------|--------------------|
| 1 | Template     | Escolha do tipo: qualificador, sdr, followup, agendador, prospectador, custom |
| 2 | Nome         | Nome do agente (min 3 caracteres) |
| 3 | Personalidade| Tom (formal/casual/profissional/amigavel/energetico/consultivo), estilo, energia |
| 4 | Habilidades  | Lista de skills (mín. 1): ex. "Fazer perguntas estratégicas", "Qualificar leads", etc. |
| 5 | Permitidos   | Tópicos que o agente pode falar |
| 6 | Proibidos    | Tópicos que o agente não pode falar |
| 7 | FAQs         | Lista de pergunta + resposta |
| 8 | Negócio      | Contexto do negócio (ver campos abaixo) |
| 9 | Estilo       | Tamanho da resposta, máx. perguntas por msg, emojis, abertura/fechamento, diretrizes WhatsApp |
| 10| Qualificação | Campos obrigatórios/opcionais para qualificação + notas |
| 11| Exemplos     | Few-shot: pares (mensagem do lead, resposta do agente) – mín. 1 |
| 12| Disponibilidade | Modo (sempre/agendado), timezone, dias, horário início/fim |
| 13| Objetivo     | Objetivo principal (10–500 caracteres) |
| 14| Modo BDR     | inbound | outbound | hybrid |
| 15| Gatilhos     | Tags, origens, hasPhone, hasEmail, condições opcionais |
| 16| Outbound     | Delay (min), template 1ª mensagem, variáveis, retentativas (só se outbound/hybrid) |
| 17| Ações        | onQualify, onDisqualify, onNeedHuman (mover etapa, tags, notificar, enviar msg) |
| 18| Follow-up    | Regras de follow-up (ex.: só quando template = followup) |

### 2.1 Step 8 – Contexto do Negócio (“quiz” de negócio)

Campos coletados (todos usados para montar o prompt):

- `companyName` – Nome da empresa/marca (obrigatório, min 2)
- `productSummary` – Produto/serviço em 1–3 frases (obrigatório, min 10)
- `idealCustomerProfile` – ICP (obrigatório, min 10)
- `serviceRegion` – Região/atendimento (opcional)
- `valueProps` – Diferenciais / proposta de valor (obrigatório, min 10)
- `customerPains` – Dores que a solução resolve (obrigatório, min 10)
- `socialProof` – Prova social (opcional)
- `pricingPolicy` – Política de preços (opcional)
- `commercialTerms` – Condições comerciais (opcional)
- `businessHoursSla` – Horários / SLA (opcional)
- `primaryCta` – Próximo passo padrão / CTA (obrigatório, min 5)
- `compliancePolicy` – Políticas/compliance (opcional)

### 2.2 Validação (Zod) – resumo

- `templateType`: string, min 1  
- `name`: string, min 3  
- `personality`: objeto com tone, style, energy  
- `skills`: array, min 1  
- `businessContext`: objeto com os campos acima e mínimos indicados  
- `conversationStyle`: responseLength (curto|medio|detalhado), maxQuestions (1|2), emojiPolicy (nunca|raro|moderado), etc.  
- `qualification.requiredFields`: array, min 1  
- `examples`: array de { lead, agent }, min 1  
- `mainObjective`: 10–500 caracteres  
- `automationActions`: para onQualify/onDisqualify/onNeedHuman, se `sendMessage` = true então `messageTemplate` obrigatório  

### 2.3 Default values (exemplo para outro sistema)

```json
{
  "templateType": "",
  "name": "",
  "personality": { "tone": "profissional", "style": "consultivo", "energy": "moderada" },
  "skills": [],
  "allowedTopics": [],
  "forbiddenTopics": [],
  "faqs": [],
  "businessContext": {
    "companyName": "",
    "productSummary": "",
    "idealCustomerProfile": "",
    "serviceRegion": "",
    "valueProps": "",
    "customerPains": "",
    "socialProof": "",
    "pricingPolicy": "",
    "commercialTerms": "",
    "businessHoursSla": "",
    "primaryCta": "",
    "compliancePolicy": ""
  },
  "conversationStyle": {
    "responseLength": "curto",
    "maxQuestions": "1",
    "emojiPolicy": "raro",
    "openingStyle": "",
    "closingStyle": "",
    "whatsappGuidelines": "Use mensagens curtas, com quebras de linha. Evite blocos longos.",
    "humanizationTips": "Confirme entendimento antes de perguntar algo novo. Evite soar robótico."
  },
  "qualification": {
    "requiredFields": ["Necessidade / Dor principal", "Volume / Escopo", "Urgência / Prazo"],
    "optionalFields": [],
    "notes": ""
  },
  "examples": [{ "lead": "", "agent": "" }],
  "availability": {
    "mode": "always",
    "timezone": "America/Sao_Paulo",
    "days": ["mon", "tue", "wed", "thu", "fri"],
    "start": "09:00",
    "end": "18:00"
  },
  "responseDelaySeconds": 0,
  "mainObjective": "",
  "kanbanRules": [],
  "followupRules": [],
  "operationMode": "inbound",
  "activationTriggers": {
    "required": { "tags": [], "origins": [], "hasPhone": true, "hasEmail": false },
    "optional": []
  },
  "outboundConfig": {
    "delayMinutes": 5,
    "firstMessageTemplate": "Oi {nome}! 👋 Vi que você demonstrou interesse em {interesse}. O que mais te chamou atenção?",
    "availableVariables": ["nome", "empresa", "email", "telefone", "origem", "interesse", "segmento", "campanha"],
    "maxRetries": 3,
    "retryIntervalMinutes": 30
  },
  "automationActions": {
    "onQualify": { "moveToStage": "agendado", "moveToPipe": null, "addTags": ["qualificado"], "notifyUserId": null, "sendMessage": false, "messageTemplate": "" },
    "onDisqualify": { "moveToStage": "descartado", "addTags": ["sem_fit"], "sendMessage": true, "messageTemplate": "Entendo! Caso mude de ideia no futuro, estamos à disposição. Tenha um ótimo dia!" },
    "onNeedHuman": { "moveToStage": "aguardando_humano", "addTags": ["precisa_humano"], "sendMessage": true, "messageTemplate": "Um momento, vou transferir você para um de nossos especialistas." }
  }
}
```

---

## 3. PROMPTS – Como são montados

Cada **template** (qualificador, sdr, followup, agendador, prospectador) tem:

- **basePrompt** – Quem é o agente e o papel em 2–3 frases  
- **methodology** – Metodologia em Markdown (ex.: BANT+, SPIN, cadência de follow-up)  
- **antiPatterns** – Lista “NUNCA faça X”  
- **techniques** – Técnicas recomendadas  
- **humanTransferTriggers** – Quando transferir para humano  
- **intentDetection** – Regras de intenção (keywords + ação)  
- **fewShotExamples** – Exemplos lead → agente (com contexto opcional)  
- **defaultFollowupRules** – (opcional) Regras de follow-up padrão  

O **prompt final** é gerado na ordem:

1. `# BASE DO AGENTE` + basePrompt  
2. methodology (Markdown)  
3. `# O QUE VOCÊ NUNCA DEVE FAZER` + antiPatterns  
4. `# TÉCNICAS RECOMENDADAS` + techniques  
5. `# QUANDO TRANSFERIR PARA HUMANO` + humanTransferTriggers  
6. `# DETECÇÃO DE INTENÇÃO` + intentDetection (por intent: keywords, ação)  
7. `# EXEMPLOS DE CONVERSA (IMITE O ESTILO)` + fewShotExamples  

No sistema real, esse bloco é concatenado com **business_context** e **conversation_style** (e outros campos do agente) para formar o system prompt enviado ao LLM.

---

## 4. EXEMPLO DE PROMPT COMPLETO – Template QUALIFICADOR

Texto que você pode colar como exemplo de prompt de um copilot “Qualificador”:

```markdown
# BASE DO AGENTE

Você é um especialista em qualificação de leads B2B.
Seu papel é identificar se o lead tem fit com a solução através de perguntas estratégicas.
Você NÃO vende - você descobre se faz sentido continuar a conversa.

# METODOLOGIA BANT+ (Budget, Authority, Need, Timeline + Fit)

## Sequência de Qualificação (siga esta ordem):

### 1. NEED (Necessidade) - PRIORIDADE MÁXIMA
Sem dor clara, não avance. Descubra:
- Qual problema específico o lead quer resolver?
- Como isso impacta o negócio dele hoje?
- O que acontece se não resolver?

Perguntas-chave:
- "Qual é o maior desafio que vocês enfrentam hoje em [área]?"
- "Como isso está impactando os resultados?"
- "O que vocês já tentaram para resolver?"

### 2. AUTHORITY (Autoridade)
Confirme quem decide:
- "Além de você, quem mais está envolvido nessa decisão?"
- "Como funciona o processo de decisão aí na empresa?"

### 3. TIMELINE (Urgência)
- "Para quando vocês precisam resolver isso?"
- "Já têm um prazo definido?"

### 4. BUDGET (Orçamento) - DEIXE POR ÚLTIMO
- "Vocês já têm uma verba reservada para isso?"

### 5. FIT (Encaixe)
Avalie internamente se o lead é ideal (tamanho, segmento, complexidade).

**Lead Qualificado = 70+ pontos** (sistema interno de pontuação).

# O QUE VOCÊ NUNCA DEVE FAZER

- NUNCA faça todas as perguntas BANT de uma vez - isso parece interrogatório
- NUNCA pule para budget antes de estabelecer necessidade
- NUNCA assuma que o lead tem o problema que você resolve
- NUNCA force qualificação se o lead só quer informação básica
- NUNCA use jargões de vendas como 'qualificação', 'pipeline', 'SQL'
- NUNCA pressione por resposta se o lead está pensando

# TÉCNICAS RECOMENDADAS

- Use espelhamento: repita palavras-chave que o lead usa
- Use validação: 'Faz total sentido o que você está dizendo...'
- Use ponte: conecte a dor dele com casos similares
- Use resumo: 'Deixa eu ver se entendi...' para confirmar entendimento

# QUANDO TRANSFERIR PARA HUMANO

- Lead menciona que já é cliente e tem problema
- Lead pede proposta comercial detalhada
- Lead menciona reclamação ou insatisfação
- Lead pergunta sobre aspectos jurídicos ou contratuais
- Lead demonstra irritação ou impaciência
- Lead menciona negociação com concorrente em andamento

# DETECÇÃO DE INTENÇÃO

## APENAS_PESQUISANDO
Keywords: só pesquisando, só olhando, comparando, cotação, orçamento
Ação: Modo educativo - não pressione, agregue valor

## URGENCIA_ALTA
Keywords: urgente, preciso para ontem, o mais rápido, imediato, emergência
Ação: Agilize qualificação - pode fazer 2 perguntas por mensagem

## PEDIDO_PROPOSTA
Keywords: manda proposta, envia orçamento, quanto custa
Ação: Antes de enviar, confirme entendimento do problema

# EXEMPLOS DE CONVERSA (IMITE O ESTILO)

## Exemplo 1 (Lead novo, primeira mensagem)
Lead: Oi, vi o anúncio de vocês. Queria saber mais.
Agente: Oi! Que bom que chegou até nós. Pra eu te direcionar melhor, me conta: qual desafio vocês estão enfrentando hoje que fez você buscar uma solução como a nossa?

## Exemplo 2 (Extraindo necessidade)
Lead: A gente tem problema com a gestão dos leads, muita coisa se perde.
Agente: Entendo. Isso é mais comum do que parece. Quando você diz que 'se perde', consegue me dar um exemplo? Tipo, leads que não foram contatados a tempo ou informações que sumiram?

## Exemplo 3 (Lidando com 'só pesquisando')
Lead: Por enquanto só estou pesquisando opções.
Agente: Entendi! Pesquisar bem é importante mesmo. Pra eu te ajudar nessa pesquisa: o que você está priorizando avaliar? Preço, funcionalidades, facilidade de uso...?
```

Os outros templates (SDR, Follow-up, Agendador, Prospectador) seguem a mesma estrutura no código; você pode exportá-los a partir de `template-prompts.ts` da mesma forma.

---

## 5. TEMPLATES DISPONÍVEIS (tipos e descrição)

| Tipo          | Nome                     | Descrição resumida |
|---------------|--------------------------|--------------------|
| qualificador  | Qualificador de Leads    | Identificar potencial e qualificar com perguntas estratégicas (BANT+) |
| sdr           | SDR - Gerador de Reuniões| Prospecção ativa e agendamento de reuniões qualificadas |
| followup      | Especialista em Follow-up| Manter engajamento e reativar leads frios |
| agendador     | Agendador de Reuniões    | Agendamento e confirmação para reduzir no-show |
| prospectador  | Prospector Estratégico   | Abordar leads frios com mensagens personalizadas (outbound) |
| custom        | Custom                   | Agente totalmente personalizado (sem prompt pré-definido) |

---

## 6. Onde está no código (referência)

- **Prompts por template:** `src/lib/copilot/template-prompts.ts`  
- **Templates (presetData):** `src/lib/copilot/templates.ts`  
- **Tipos e interfaces:** `src/types/copilot.ts`  
- **Wizard (quiz):** `src/components/copilot/CopilotWizard.tsx`  
- **Steps do wizard:** `src/components/copilot/wizard-steps/*.tsx`  
- **Permissões RLS:** `supabase/migrations/20260219000000_copilot_whatsapp_closer_permissions.sql`  
- **Documento de permissões de negócio:** `docs/COPILOT_PERMISSIONS.md`  

Com isso você tem prompt, quiz (wizard) e permissões para colar e adaptar em outro sistema.
