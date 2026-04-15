---
tags:
  - torque-crm
  - docs
  - design
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/specs/2026-03-17-campaign-selects-and-summarize-fix-design.md
---

# Design: Selects Dinâmicos de Campanha + Fix Resumir Conversa I.A.

**Data:** 2026-03-17
**Status:** Aprovado

---

## Contexto

O editor visual de workflows tem açoes e triggers de campanha que usam `<Input>` (texto livre com UUID) onde deveriam usar `<Select>` dinâmicos carregados do banco. Além disso, a ação "Resumir Conversa I.A." tem um bug crítico que impede seu funcionamento.

---

## Parte 1: Selects Dinâmicos de Campanha

### Hooks existentes (não precisam ser criados)

- `useCampanhas()` - retorna campanhas da organização (`src/hooks/useCampanhas.ts`)
- `useCampanhaStages(campanhaId)` - retorna estágios de uma campanha, ordenados por position (`src/hooks/useCampanhas.ts` linha 314)
- `useCampanhaTemplates(campanhaId)` - retorna templates vinculados a uma campanha (`src/hooks/useCampaignTemplates.ts` linha 382). Retorna `CampanhaTemplate[]` com join aninhado: acessar `item.template.name` e `item.template.message_type` para nome e tipo.

### Novos componentes

Criar 3 componentes em `src/components/automacoes/sidebar-panels/`. Seguem o padrão do `TagSelectorField` (definido inline no ActionPanel.tsx linha 779), mas como arquivos separados para reutilização no TriggerPanel.

#### `CampaignSelectorField.tsx`

- Importa `useCampanhas()`
- Props: `campaignId: string`, `onSelect: (id: string, name: string) => void`
- Filtra campanhas ativas (`is_active: true`)
- Mostra: loading state, empty state ("Nenhuma campanha encontrada"), select com nome
- Padrão visual: segue `TagSelectorField` existente

#### `CampaignStageSelectorField.tsx`

- Importa `useCampanhaStages(campanhaId)`
- Props: `campanhaId: string`, `stageId: string`, `onSelect: (id: string, name: string) => void`
- Só renderiza se `campanhaId` estiver preenchido (cascateado)
- Ordena por `position`, mostra bolinha colorida + nome (padrão `MoveStageFields`)

#### `CampaignTemplateSelectorField.tsx`

- Importa `useCampanhaTemplates(campanhaId)`
- Props: `campanhaId: string`, `templateId: string`, `onSelect: (id: string, name: string) => void`
- Só renderiza se `campanhaId` estiver preenchido (cascateado)
- Acessa dados via `item.template.name` e `item.template.message_type` (join aninhado)
- Mostra nome + badge com tipo (texto/audio/imagem/documento)
- Empty state: "Nenhum template vinculado a esta campanha"

### Mapeamento de uso

| Ação / Trigger | CampaignSelector | StageSelector | TemplateSelector |
|---|:-:|:-:|:-:|
| `add_to_campaign` | sim | - | - |
| `remove_from_campaign` | sim | - | - |
| `move_campaign_stage` | sim | sim | - |
| `send_campaign_message` | sim | - | sim |
| `pause_campaign_sequence` | sim | - | - |
| `resume_campaign_sequence` | sim | - | - |
| `campaign_status_changed` (TriggerPanel, bloco separado linha 333) | sim | - | - |
| 5 triggers de campanha (TriggerPanel, bloco agrupado linha 362) | sim | - | - |

**Nota:** No TriggerPanel, `campaign_status_changed` está em um bloco de código separado dos outros 5 triggers. Ambos os blocos precisam ser modificados.

### Dados salvos no node

Mantém o padrão existente de salvar ID + nome legível:

```ts
{ campaignId: "uuid", campaignName: "Nome da Campanha" }
{ campaignStageId: "uuid", campaignStageName: "Qualificado" }
{ campaignTemplateId: "uuid", campaignTemplateName: "Boas-vindas" }
```

### Cascade-clear: limpar seleçoes dependentes

Ao trocar a campanha selecionada, os campos dependentes devem ser limpos:
- Trocar `campaignId` → limpar `campaignStageId`/`campaignStageName` e `campaignTemplateId`/`campaignTemplateName`
- Isso evita IDs órfãos apontando para estágios/templates de outra campanha

### Arquivos modificados

- `src/components/automacoes/sidebar-panels/ActionPanel.tsx` - substituir 6 blocos de `<Input>` pelos novos componentes
- `src/components/automacoes/sidebar-panels/TriggerPanel.tsx` - substituir `<Input>` de `campaign_id` por `CampaignSelectorField` nos dois blocos (linha 333 e linha 362)
- `src/types/workflow.ts` - adicionar `campaignTemplateName?: string` em `ActionNodeData`

---

## Parte 2: Fix + Melhoria do Resumir Conversa I.A.

### Bug 1: Mismatch de parâmetros (CRÍTICO)

**Arquivo:** `supabase/functions/_shared/workflow-action-handler.ts` - função `handleInvokeEdgeFunction` (linha 1179)

**Problema:** Envia `{ organizationId, leadId }` (camelCase), edge function espera `{ lead_id }` (snake_case). Resultado: sempre retorna 400 "lead_id is required".

**Fix:** Alterar o body para:
```ts
body: JSON.stringify({
  lead_id: ctx.leadId,
})
```

**Nota:** `organization_id` não precisa ser enviado - a edge function obtém do registro do lead no banco.

### Bug 2: Upsert sem UNIQUE constraint

**Arquivo:** Nova migration `supabase/migrations/20260317000000_fix_conversation_summaries_unique.sql`

**Problema:** A edge function faz `.upsert({...}, { onConflict: 'lead_id' })` mas não existe UNIQUE constraint na tabela `conversation_summaries`.

**Fix:**
```sql
-- Limpar duplicatas mantendo o mais recente (seguro para empates em updated_at)
DELETE FROM conversation_summaries
WHERE id NOT IN (
  SELECT DISTINCT ON (lead_id) id
  FROM conversation_summaries
  ORDER BY lead_id, updated_at DESC
);

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_conversation_summaries_lead_unique
  ON conversation_summaries(lead_id);
```

### Melhoria: Expor dados da sumarização via variáveis de template

**Estratégia:** Ao invés de propagar dados via contexto de execução (que exigiria mudar a assinatura de `resolveVariables` e todos os call sites), as variáveis de IA serão resolvidas consultando a tabela `conversation_summaries` diretamente. Isso é mais robusto pois:
- Funciona mesmo após pausas no workflow (ex: nó `wait_response`)
- Não exige alterar a assinatura de `resolveVariables`
- Os dados já estão persistidos pela edge function

**Implementação em `resolveVariables`:**

Quando o template contém `{{ai_*}}`, fazer query em `conversation_summaries` pelo `lead_id`:
```ts
if (template.includes("{{ai_")) {
  const { data: summary } = await supabase
    .from("conversation_summaries")
    .select("summary, sentiment, lead_temperature, next_action")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (summary) {
    vars.ai_resumo = summary.summary || "";
    vars.ai_sentimento = summary.sentiment || "";
    vars.ai_temperatura = summary.lead_temperature || "";
    vars.ai_proxima_acao = summary.next_action || "";
  }
}
```

**Alterar `handleInvokeEdgeFunction`** para:
1. Parsear o response JSON: `const responseJson = await res.json()`
2. Retornar os dados: `return { success: true, message: "...", data: responseJson }`

### Novas variáveis de template

Adicionar em `WORKFLOW_VARIABLES` (`src/types/workflow.ts`):
- `{{ai_resumo}}` - texto do resumo da conversa
- `{{ai_sentimento}}` - positive/neutral/negative
- `{{ai_temperatura}}` - cold/warm/hot
- `{{ai_proxima_acao}}` - próxima ação sugerida pela IA

### Arquivos modificados

- `supabase/functions/_shared/workflow-action-handler.ts` - fix payload snake_case + parsear response JSON + resolver variáveis `{{ai_*}}`
- `src/types/workflow.ts` - adicionar `campaignTemplateName` em `ActionNodeData` + variáveis de IA em `WORKFLOW_VARIABLES`

### Teste end-to-end

**Arquivo:** `scripts/test-summarize-conversation.sh`

1. Insere lead fake + mensagens WhatsApp fake via Supabase service role
2. Chama edge function `summarize-conversation` diretamente via curl
3. Valida que resposta contém campos: `summary`, `sentiment`, `lead_temperature`
4. Valida que registro existe em `conversation_summaries`
5. Limpa dados fake

---

## Arquivos novos

- `src/components/automacoes/sidebar-panels/CampaignSelectorField.tsx`
- `src/components/automacoes/sidebar-panels/CampaignStageSelectorField.tsx`
- `src/components/automacoes/sidebar-panels/CampaignTemplateSelectorField.tsx`
- `supabase/migrations/20260317000000_fix_conversation_summaries_unique.sql`
- `scripts/test-summarize-conversation.sh`

## Arquivos modificados

- `src/components/automacoes/sidebar-panels/ActionPanel.tsx`
- `src/components/automacoes/sidebar-panels/TriggerPanel.tsx`
- `supabase/functions/_shared/workflow-action-handler.ts`
- `src/types/workflow.ts`


## Links relacionados

- [[Regras de Pipe]]

- [[MOC - Arquitetura]]

- [[Campanhas]]

- [[Workflow Builder]]

- [[WhatsApp Evolution]]

- [[00 - INDEX]]
