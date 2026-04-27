# Design: Shadow Leads — Copilot atendendo contatos sem lead

**Data:** 2026-02-15
**Status:** Aprovado
**Autor:** Brainstorming colaborativo

---

## Resumo

Implementar sistema de "shadow leads" para que copilots possam atender números desconhecidos (sem lead criado) automaticamente. Shadow leads são invisíveis nos pipes/kanbans até serem promovidos — por qualificação do copilot ou criação manual pelo usuário.

---

## Motivação

- Leads não são mais criados automaticamente ao receber mensagens (decisão de design para evitar spam/ruído)
- Copilots precisam de um `lead_id` para funcionar (conversations, histórico, contexto)
- Em alguns casos, o copilot precisa atender números novos e criar o lead apenas após qualificar

---

## Understanding Summary

- **O que:** Shadow leads — leads invisíveis criados automaticamente pelo copilot
- **Por que:** Permitir que copilots atendam números novos sem poluir os pipes
- **Para quem:** Copilots do tipo qualificador/SDR que recebem contatos novos
- **Restrição:** Configurável por copilot (nem todos devem atender desconhecidos)
- **Não-objetivo:** Não muda o fluxo de leads que já existem; não muda o botão manual "Criar Lead"

---

## Premissas

1. Shadow leads usam a mesma tabela `leads` com flag `is_shadow = true`
2. Toda infra existente (conversations, agent-engine, FAQs) funciona normalmente com shadow leads
3. Shadow leads NÃO aparecem nos kanbans/pipes
4. Shadow leads APARECEM no chat (mensagens já são visíveis)
5. Cada copilot tem sua própria configuração de `attend_unknown_contacts`
6. Cleanup de shadows antigos não é escopo do MVP

---

## Design

### 1. Banco de Dados

#### Migração: `is_shadow` na tabela `leads`

```sql
ALTER TABLE leads ADD COLUMN is_shadow BOOLEAN DEFAULT false;

CREATE INDEX idx_leads_not_shadow
  ON leads (organization_id) WHERE is_shadow = false;

COMMENT ON COLUMN leads.is_shadow IS
  'Shadow lead: criado automaticamente pelo copilot, invisível nos pipes até ser promovido';
```

#### Migração: `attend_unknown_contacts` na tabela `copilot_agents`

```sql
ALTER TABLE copilot_agents
  ADD COLUMN attend_unknown_contacts BOOLEAN DEFAULT false;

COMMENT ON COLUMN copilot_agents.attend_unknown_contacts IS
  'Se true, copilot cria shadow lead e atende números que ainda não são leads';
```

### 2. Fluxo: evolution-webhook

```
Mensagem de número novo chega
    ↓
1. Salva em whatsapp_messages
2. associateMessageToExistingLead() → busca lead existente
3. NÃO encontrou lead?
   ↓
   Verifica: copilot da instância tem attend_unknown_contacts = true?
   ↓ SIM                              ↓ NÃO
   getOrCreateLead(isShadow=true)      Mensagem fica orphan (como hoje)
   Copilot responde via agent-message   Copilot não responde
```

**Alterações em `getOrCreateLead()` (`_shared/lead-service.ts`):**
- Novo parâmetro opcional `isShadow?: boolean`
- Quando cria lead com `isShadow = true`: seta `is_shadow = true`, `origin = 'shadow_copilot'`
- NÃO insere em nenhum pipe

### 3. Promoção do Shadow Lead (agent-engine)

#### Qualificação (onQualify)

```
1. conversation.state = 'QUALIFIED'
2. Se lead.is_shadow = true → promoveShadowLead()
   - UPDATE leads SET is_shadow = false
   - Insere no pipe usando onQualify.moveToPipe + onQualify.moveToStage
   - Se moveToPipe = null → pipe_whatsapp
   - Se moveToPipe = 'confirmacao' → pipe_confirmacao
   - Se moveToPipe = 'propostas' → pipe_propostas
3. Executa resto do onQualify (tags, notify, message)
```

#### Desqualificação (onDisqualify)

```
1. conversation.state = 'DISQUALIFIED'
2. Se lead.is_shadow = true → promoveShadowLead()
   - UPDATE leads SET is_shadow = false
   - Insere no pipe usando onDisqualify.moveToStage (ex: "esfriou", "perdido")
3. Executa resto do onDisqualify (tags, notify, message)
```

#### Ghosting (sem resposta)

- Nenhuma ação automática — shadow lead continua invisível
- Futuro: cleanup job para deletar shadows com +30 dias sem atividade

#### Função centralizada

```typescript
async function promoveShadowLead(
  supabase: SupabaseClient,
  leadId: string,
  destination: { pipe?: string; stage: string },
  organizationId: string
) {
  // 1. Remove flag shadow
  await supabase
    .from('leads')
    .update({ is_shadow: false })
    .eq('id', leadId);

  // 2. Insere no pipe correto
  const pipeTable = destination.pipe === 'confirmacao'
    ? 'pipe_confirmacao'
    : destination.pipe === 'propostas'
    ? 'pipe_propostas'
    : 'pipe_whatsapp';

  await supabase.from(pipeTable).insert({
    lead_id: leadId,
    organization_id: organizationId,
    status: destination.stage,
  });
}
```

### 4. Frontend

#### 4A — Wizard: novo toggle

Novo campo no wizard de criação do copilot:

```
☐ Atender contatos sem lead

Quando ativado, o copilot responde automaticamente a números
que ainda não são leads no sistema. O lead será criado quando
o copilot qualificar ou desqualificar o contato.
```

- Salva como `attend_unknown_contacts` no `copilot_agents`
- Defaults por template:
  - qualificador → `true`
  - sdr → `true`
  - agendador → `false`
  - followup → `false`
  - prospectador → `true`

#### 4B — Kanbans: filtro de shadow

Hooks que alimentam os kanbans adicionam filtro:

- `useLeadsForPipeWhatsApp()` → `WHERE leads.is_shadow = false`
- `useLeadsForPipeConfirmacao()` → idem
- `useLeadsForPipePropostas()` → idem
- Listagem geral de leads → idem

#### 4C — Chat: sem mudanças

Chat continua mostrando todas as mensagens. Shadow leads aparecem normalmente.

#### 4D — Botão "Criar Lead" no chat

Ajuste no `useCreateLeadFromWhatsApp()`:
- Se já existe shadow lead para esse telefone → promove (`is_shadow = false` + insere no pipe)
- Se não existe lead nenhum → cria normalmente (como hoje)

---

## Edge Cases

| Cenário | Comportamento |
|---------|--------------|
| Número novo, copilot com `attend_unknown = false` | Mensagem fica orphan, copilot ignora |
| Número novo, copilot com `attend_unknown = true` | Cria shadow lead, copilot responde |
| Shadow lead manda msg novamente | Reutiliza mesmo shadow lead |
| Usuário clica "Criar Lead" em shadow lead | Promove para real + insere no pipe |
| Copilot qualifica shadow lead | Promove via `onQualify` |
| Copilot desqualifica shadow lead | Promove com status perdido via `onDisqualify` |
| Lead real já existe para o telefone | Fluxo idêntico ao atual |
| Copilot desativado na instância | Sem copilot, sem shadow |
| Shadow lead sem atividade 30+ dias | Futuro: cleanup job |

---

## Decision Log

| Decisão | Alternativas Consideradas | Motivo da Escolha |
|---------|--------------------------|-------------------|
| `is_shadow` boolean na tabela `leads` | Enum `lead_status`, tabela separada `shadow_contacts` | Menor impacto; toda infra já funciona com lead_id |
| Config por copilot (`attend_unknown_contacts`) | Config global na org, config por instância | Cada copilot tem propósito diferente; mais granular |
| Shadow promovido no `onQualify`/`onDisqualify` | Evento separado, webhook externo | Reutiliza config que já existe no wizard |
| Ghosting = continua shadow | Auto-deletar, auto-promover | Menor risco; cleanup futuro é trivial |
| Chat mostra shadows normalmente | Esconder shadows no chat | Mensagens já aparecem, seria confuso esconder |

---

## Arquivos Impactados

| Arquivo | Mudança |
|---------|---------|
| Nova migração SQL | `is_shadow` em leads, `attend_unknown_contacts` em copilot_agents |
| `supabase/functions/evolution-webhook/index.ts` | Lógica de criação shadow antes de chamar agent-message |
| `supabase/functions/_shared/lead-service.ts` | `getOrCreateLead()` aceita `isShadow` param |
| `supabase/functions/agent-message/agent-engine.ts` | `promoveShadowLead()` no fluxo de qualify/disqualify |
| `src/hooks/useWhatsAppLeadIntegration.ts` | "Criar Lead" detecta shadow existente e promove |
| Hooks dos kanbans (3 pipes) | `WHERE is_shadow = false` |
| Wizard: novo campo no step | Toggle `attend_unknown_contacts` |
| Template configs (5 arquivos) | Default sugerido por tipo de copilot |
