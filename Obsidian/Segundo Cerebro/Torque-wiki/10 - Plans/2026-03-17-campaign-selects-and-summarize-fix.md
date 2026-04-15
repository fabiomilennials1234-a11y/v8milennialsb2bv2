---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/plans/2026-03-17-campaign-selects-and-summarize-fix.md
---

# Campaign Selects + Summarize Conversation Fix - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace text inputs with dynamic selects for campaign actions/triggers, and fix the broken "Resumir Conversa I.A." action.

**Architecture:** Three reusable selector components (campaign, stage, template) consumed by ActionPanel and TriggerPanel. Backend fixes for parameter naming, database constraint, and AI variable resolution via DB query in resolveVariables.

**Tech Stack:** React, TanStack Query, Supabase (Edge Functions, PostgreSQL), shadcn/ui Select

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/components/automacoes/sidebar-panels/CampaignSelectorField.tsx` | Reusable campaign select dropdown |
| `src/components/automacoes/sidebar-panels/CampaignStageSelectorField.tsx` | Reusable campaign stage select (cascaded) |
| `src/components/automacoes/sidebar-panels/CampaignTemplateSelectorField.tsx` | Reusable campaign template select (cascaded) |
| `supabase/migrations/20260317000000_fix_conversation_summaries_unique.sql` | Add UNIQUE constraint on lead_id |
| `scripts/test-summarize-conversation.sh` | End-to-end test for summarize-conversation |

### Modified Files
| File | Changes |
|------|---------|
| `src/types/workflow.ts` | Add `campaignTemplateName` to `ActionNodeData`, add AI variables to `WORKFLOW_VARIABLES` |
| `src/components/automacoes/sidebar-panels/ActionPanel.tsx` | Replace 6 campaign `<Input>` blocks with selector components |
| `src/components/automacoes/sidebar-panels/TriggerPanel.tsx` | Replace 2 campaign `<Input>` blocks with CampaignSelectorField |
| `supabase/functions/_shared/workflow-action-handler.ts` | Fix snake_case params, parse response JSON, add AI variable resolution |

---

## Task 1: Add `campaignTemplateName` to types + AI variables

**Files:**
- Modify: `src/types/workflow.ts:278` (ActionNodeData) and `src/types/workflow.ts:679` (WORKFLOW_VARIABLES)

- [ ] **Step 1: Add `campaignTemplateName` to `ActionNodeData`**

In `src/types/workflow.ts`, after line 278 (`campaignTemplateId?: string;`), add:

```ts
  campaignTemplateName?: string;
```

- [ ] **Step 2: Add AI variables to `WORKFLOW_VARIABLES`**

In `src/types/workflow.ts`, after line 703 (the `campanha_estagio` entry), add:

```ts
  // I.A.
  { key: "{{ai_resumo}}",        label: "Resumo da conversa (I.A.)",       category: "I.A." },
  { key: "{{ai_sentimento}}",    label: "Sentimento (positive/neutral/negative)", category: "I.A." },
  { key: "{{ai_temperatura}}",   label: "Temperatura do lead (cold/warm/hot)",    category: "I.A." },
  { key: "{{ai_proxima_acao}}",  label: "Próxima ação sugerida (I.A.)",    category: "I.A." },
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors related to workflow.ts

- [ ] **Step 4: Commit**

```bash
git add src/types/workflow.ts
git commit -m "feat: add campaignTemplateName to ActionNodeData + AI workflow variables"
```

---

## Task 2: Create `CampaignSelectorField` component

**Files:**
- Create: `src/components/automacoes/sidebar-panels/CampaignSelectorField.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/automacoes/sidebar-panels/CampaignSelectorField.tsx`:

```tsx
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCampanhas } from "@/hooks/useCampanhas";

interface CampaignSelectorFieldProps {
  campaignId: string;
  onSelect: (id: string, name: string) => void;
  label?: string;
  optional?: boolean;
}

export function CampaignSelectorField({
  campaignId,
  onSelect,
  label = "Campanha",
  optional = false,
}: CampaignSelectorFieldProps) {
  const { data: campanhas, isLoading, isError } = useCampanhas();

  const activeCampanhas = (campanhas ?? []).filter((c) => c.is_active);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label>{label}{optional ? " (opcional)" : ""}</Label>
        <p className="text-xs text-muted-foreground">Carregando campanhas...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <p className="text-xs text-destructive">Erro ao carregar campanhas.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label>{label}{optional ? " (opcional)" : ""}</Label>
      {activeCampanhas.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma campanha ativa encontrada.
        </p>
      ) : (
        <Select
          value={campaignId || ""}
          onValueChange={(v) => {
            const selected = activeCampanhas.find((c) => c.id === v);
            onSelect(v, selected?.name || "");
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={optional ? "Qualquer campanha" : "Selecione a campanha"} />
          </SelectTrigger>
          <SelectContent>
            {optional && (
              <SelectItem value="__any__">Qualquer campanha</SelectItem>
            )}
            {activeCampanhas.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/components/automacoes/sidebar-panels/CampaignSelectorField.tsx
git commit -m "feat: create CampaignSelectorField component"
```

---

## Task 3: Create `CampaignStageSelectorField` component

**Files:**
- Create: `src/components/automacoes/sidebar-panels/CampaignStageSelectorField.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/automacoes/sidebar-panels/CampaignStageSelectorField.tsx`:

```tsx
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCampanhaStages } from "@/hooks/useCampanhas";

interface CampaignStageSelectorFieldProps {
  campanhaId: string;
  stageId: string;
  onSelect: (id: string, name: string) => void;
}

export function CampaignStageSelectorField({
  campanhaId,
  stageId,
  onSelect,
}: CampaignStageSelectorFieldProps) {
  const { data: stages, isLoading } = useCampanhaStages(campanhaId || undefined);

  if (!campanhaId) return null;

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label>Estágio da Campanha</Label>
        <p className="text-xs text-muted-foreground">Carregando estágios...</p>
      </div>
    );
  }

  const stageList = stages ?? [];

  return (
    <div className="space-y-2">
      <Label>Estágio da Campanha</Label>
      {stageList.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum estágio encontrado nesta campanha.
        </p>
      ) : (
        <Select
          value={stageId || ""}
          onValueChange={(v) => {
            const selected = stageList.find((s) => s.id === v);
            onSelect(v, selected?.name || "");
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione o estágio" />
          </SelectTrigger>
          <SelectContent>
            {stageList.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: s.color || "#888" }}
                  />
                  {s.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/components/automacoes/sidebar-panels/CampaignStageSelectorField.tsx
git commit -m "feat: create CampaignStageSelectorField component"
```

---

## Task 4: Create `CampaignTemplateSelectorField` component

**Files:**
- Create: `src/components/automacoes/sidebar-panels/CampaignTemplateSelectorField.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/automacoes/sidebar-panels/CampaignTemplateSelectorField.tsx`:

```tsx
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCampanhaTemplates } from "@/hooks/useCampaignTemplates";

const TYPE_LABELS: Record<string, string> = {
  text: "Texto",
  audio: "Áudio",
  image: "Imagem",
  document: "Documento",
};

interface CampaignTemplateSelectorFieldProps {
  campanhaId: string;
  templateId: string;
  onSelect: (id: string, name: string) => void;
}

export function CampaignTemplateSelectorField({
  campanhaId,
  templateId,
  onSelect,
}: CampaignTemplateSelectorFieldProps) {
  const { data: campanhaTemplates, isLoading } = useCampanhaTemplates(campanhaId || undefined);

  if (!campanhaId) return null;

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label>Template da Campanha</Label>
        <p className="text-xs text-muted-foreground">Carregando templates...</p>
      </div>
    );
  }

  const templates = (campanhaTemplates ?? []).filter((ct) => ct.template);

  return (
    <div className="space-y-2">
      <Label>Template da Campanha</Label>
      {templates.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum template vinculado a esta campanha.
        </p>
      ) : (
        <Select
          value={templateId || ""}
          onValueChange={(v) => {
            const selected = templates.find((ct) => ct.template!.id === v);
            onSelect(v, selected?.template?.name || "");
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione o template" />
          </SelectTrigger>
          <SelectContent>
            {templates.map((ct) => (
              <SelectItem key={ct.template!.id} value={ct.template!.id}>
                <span className="flex items-center gap-2">
                  {ct.template!.name}
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    {TYPE_LABELS[ct.template!.message_type || "text"] || "Texto"}
                  </Badge>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/components/automacoes/sidebar-panels/CampaignTemplateSelectorField.tsx
git commit -m "feat: create CampaignTemplateSelectorField component"
```

---

## Task 5: Replace campaign inputs in `ActionPanel.tsx`

**Files:**
- Modify: `src/components/automacoes/sidebar-panels/ActionPanel.tsx:377-477`

- [ ] **Step 1: Add imports**

At the top of `ActionPanel.tsx`, add these imports after the existing imports (around line 36):

```ts
import { CampaignSelectorField } from "./CampaignSelectorField";
import { CampaignStageSelectorField } from "./CampaignStageSelectorField";
import { CampaignTemplateSelectorField } from "./CampaignTemplateSelectorField";
```

- [ ] **Step 2: Replace `add_to_campaign` block (lines 377-396)**

Replace the entire `{at === "add_to_campaign" && (...)}` block with:

```tsx
      {at === "add_to_campaign" && (
        <CampaignSelectorField
          campaignId={data.campaignId || ""}
          onSelect={(id, name) => onUpdate({ campaignId: id, campaignName: name })}
        />
      )}
```

- [ ] **Step 3: Replace `remove_from_campaign` block (lines 398-407)**

Replace the entire `{at === "remove_from_campaign" && (...)}` block with:

```tsx
      {at === "remove_from_campaign" && (
        <CampaignSelectorField
          campaignId={data.campaignId || ""}
          onSelect={(id, name) => onUpdate({ campaignId: id, campaignName: name })}
        />
      )}
```

- [ ] **Step 4: Replace `move_campaign_stage` block (lines 409-428)**

Replace the entire `{at === "move_campaign_stage" && (...)}` block with:

```tsx
      {at === "move_campaign_stage" && (
        <>
          <CampaignSelectorField
            campaignId={data.campaignId || ""}
            onSelect={(id, name) =>
              onUpdate({
                campaignId: id,
                campaignName: name,
                campaignStageId: "",
                campaignStageName: "",
              })
            }
          />
          <CampaignStageSelectorField
            campanhaId={data.campaignId || ""}
            stageId={data.campaignStageId || ""}
            onSelect={(id, name) =>
              onUpdate({ campaignStageId: id, campaignStageName: name })
            }
          />
        </>
      )}
```

- [ ] **Step 5: Replace `send_campaign_message` block (lines 430-449)**

Replace the entire `{at === "send_campaign_message" && (...)}` block with:

```tsx
      {at === "send_campaign_message" && (
        <>
          <CampaignSelectorField
            campaignId={data.campaignId || ""}
            onSelect={(id, name) =>
              onUpdate({
                campaignId: id,
                campaignName: name,
                campaignTemplateId: "",
                campaignTemplateName: "",
              })
            }
          />
          <CampaignTemplateSelectorField
            campanhaId={data.campaignId || ""}
            templateId={data.campaignTemplateId || ""}
            onSelect={(id, name) =>
              onUpdate({ campaignTemplateId: id, campaignTemplateName: name })
            }
          />
        </>
      )}
```

- [ ] **Step 6: Replace `pause_campaign_sequence` block (lines 451-463)**

Replace with:

```tsx
      {at === "pause_campaign_sequence" && (
        <>
          <CampaignSelectorField
            campaignId={data.campaignId || ""}
            onSelect={(id, name) => onUpdate({ campaignId: id, campaignName: name })}
          />
          <p className="text-xs text-muted-foreground">
            Cancela todas as mensagens agendadas do lead nesta campanha.
          </p>
        </>
      )}
```

- [ ] **Step 7: Replace `resume_campaign_sequence` block (lines 465-477)**

Replace with:

```tsx
      {at === "resume_campaign_sequence" && (
        <>
          <CampaignSelectorField
            campaignId={data.campaignId || ""}
            onSelect={(id, name) => onUpdate({ campaignId: id, campaignName: name })}
          />
          <p className="text-xs text-muted-foreground">
            Reagenda as mensagens canceladas do lead nesta campanha.
          </p>
        </>
      )}
```

- [ ] **Step 8: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 9: Commit**

```bash
git add src/components/automacoes/sidebar-panels/ActionPanel.tsx
git commit -m "feat: replace campaign text inputs with dynamic selects in ActionPanel"
```

---

## Task 6: Replace campaign inputs in `TriggerPanel.tsx`

**Files:**
- Modify: `src/components/automacoes/sidebar-panels/TriggerPanel.tsx:333-382`

- [ ] **Step 1: Add import**

At the top of `TriggerPanel.tsx`, add after the existing imports (around line 16):

```ts
import { CampaignSelectorField } from "./CampaignSelectorField";
```

- [ ] **Step 2: Replace `campaign_status_changed` block (lines 333-359)**

Replace the `<Input>` for `campaign_id` (lines 336-341) with CampaignSelectorField. The full block becomes:

```tsx
      {data.triggerType === "campaign_status_changed" && (
        <>
          <CampaignSelectorField
            campaignId={(cfg.campaign_id as string) || ""}
            onSelect={(id) => updateConfig({ campaign_id: id || "" })}
            optional
          />
          <div className="space-y-2">
            <Label>Novo status</Label>
            <Select
              value={(cfg.new_status as string) || "__any__"}
              onValueChange={(v) => updateConfig({ new_status: v === "__any__" ? "" : v })}
            >
              <SelectTrigger><SelectValue placeholder="Qualquer" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Qualquer</SelectItem>
                <SelectItem value="active">Ativada</SelectItem>
                <SelectItem value="paused">Pausada</SelectItem>
                <SelectItem value="completed">Encerrada</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}
```

- [ ] **Step 3: Replace grouped campaign triggers block (lines 361-382)**

Replace the `<Input>` for `campaign_id` (lines 367-372) with CampaignSelectorField. The full block becomes:

```tsx
      {["lead_added_to_campaign", "lead_removed_from_campaign",
        "campaign_lead_replied", "campaign_lead_no_reply", "campaign_completed",
      ].includes(data.triggerType) && (
        <>
          <CampaignSelectorField
            campaignId={(cfg.campaign_id as string) || ""}
            onSelect={(id) => updateConfig({ campaign_id: id || "" })}
            optional
          />
          <p className="text-xs text-muted-foreground">
            {data.triggerType === "lead_added_to_campaign" && "Dispara quando um lead é adicionado à campanha."}
            {data.triggerType === "lead_removed_from_campaign" && "Dispara quando um lead é removido da campanha."}
            {data.triggerType === "campaign_lead_replied" && "Dispara quando o lead responde uma mensagem da campanha."}
            {data.triggerType === "campaign_lead_no_reply" && "Dispara quando o timeout de espera de resposta expira sem resposta."}
            {data.triggerType === "campaign_completed" && "Dispara quando o lead chega no último estágio da campanha."}
          </p>
        </>
      )}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add src/components/automacoes/sidebar-panels/TriggerPanel.tsx
git commit -m "feat: replace campaign text inputs with dynamic selects in TriggerPanel"
```

---

## Task 7: Fix `handleInvokeEdgeFunction` parameter mismatch + parse response

**Files:**
- Modify: `supabase/functions/_shared/workflow-action-handler.ts:1172-1187`

- [ ] **Step 1: Fix the function**

Replace lines 1172-1187 of `workflow-action-handler.ts` (the entire `handleInvokeEdgeFunction` function) with:

```ts
async function handleInvokeEdgeFunction(ctx: ActionContext, functionName: string): Promise<ActionResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  const res = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      lead_id: ctx.leadId,
    }),
  });

  if (!res.ok) return { success: false, error: `${functionName} failed: ${await res.text()}` };

  let data: Record<string, unknown> | undefined;
  try {
    data = await res.json();
  } catch {
    // response may not be JSON
  }

  return { success: true, message: `${functionName} completed`, data };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/workflow-action-handler.ts
git commit -m "fix: send snake_case params in handleInvokeEdgeFunction + parse response JSON"
```

---

## Task 8: Add AI variable resolution in `resolveVariables`

**Files:**
- Modify: `supabase/functions/_shared/workflow-action-handler.ts:163-175` (after campaign variables block)

- [ ] **Step 1: Add AI variable resolution**

In `workflow-action-handler.ts`, after the campaign variables block (after line 175, the closing `}` of the `campanha_nome`/`campanha_estagio` block), add:

```ts
  // AI variables: {{ai_resumo}}, {{ai_sentimento}}, {{ai_temperatura}}, {{ai_proxima_acao}}
  if (template.includes("{{ai_")) {
    const { data: aiSummary } = await supabase
      .from("conversation_summaries")
      .select("summary, sentiment, lead_temperature, next_action")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (aiSummary) {
      vars.ai_resumo = (aiSummary as any).summary || "";
      vars.ai_sentimento = (aiSummary as any).sentiment || "";
      vars.ai_temperatura = (aiSummary as any).lead_temperature || "";
      vars.ai_proxima_acao = (aiSummary as any).next_action || "";
    }
  }
```

Also, after this new block, add a second pass to replace the new vars (they were added to `vars` after the first `replaceAll` loop). Add before the `// Custom fields` comment:

```ts
  // Second pass for late-bound vars (campaign + AI)
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, val);
  }
```

**Important:** Remove the existing `for` loop at lines 159-161 that does the first replacement, and move it BEFORE the campaign variables block. Actually, looking at the code more carefully, the existing loop at lines 159-161 already runs before the campaign block, but the campaign variables are added to `vars` AFTER the loop. So the campaign variables never actually get replaced! This is an existing bug. The fix is to add the second pass shown above, which will handle both campaign and AI variables.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/workflow-action-handler.ts
git commit -m "feat: add AI variable resolution in resolveVariables + fix campaign vars replacement"
```

---

## Task 9: Add UNIQUE constraint migration

**Files:**
- Create: `supabase/migrations/20260317000000_fix_conversation_summaries_unique.sql`

- [ ] **Step 1: Create the migration**

Create `supabase/migrations/20260317000000_fix_conversation_summaries_unique.sql`:

```sql
-- Fix: conversation_summaries needs UNIQUE constraint on lead_id
-- for the upsert in summarize-conversation edge function to work.

-- Remove duplicates keeping the most recent per lead
DELETE FROM conversation_summaries
WHERE id NOT IN (
  SELECT DISTINCT ON (lead_id) id
  FROM conversation_summaries
  ORDER BY lead_id, updated_at DESC
);

-- Add UNIQUE constraint
CREATE UNIQUE INDEX IF NOT EXISTS
  idx_conversation_summaries_lead_unique
  ON conversation_summaries(lead_id);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260317000000_fix_conversation_summaries_unique.sql
git commit -m "fix: add UNIQUE constraint on conversation_summaries.lead_id for upsert"
```

---

## Task 10: Create end-to-end test for summarize-conversation

**Files:**
- Create: `scripts/test-summarize-conversation.sh`

- [ ] **Step 1: Create the test script**

Create `scripts/test-summarize-conversation.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────
SUPABASE_URL="${SUPABASE_URL:?Set SUPABASE_URL}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY}"
AUTH="Authorization: Bearer $SERVICE_KEY"
CT="Content-Type: application/json"

PASS=0
FAIL=0
LEAD_ID=""
ORG_ID=""

cleanup() {
  echo ""
  echo "🧹 Cleaning up test data..."
  if [[ -n "$LEAD_ID" ]]; then
    curl -sf -X DELETE "$SUPABASE_URL/rest/v1/conversation_summaries?lead_id=eq.$LEAD_ID" \
      -H "$AUTH" -H "apikey: $SERVICE_KEY" || true
    curl -sf -X DELETE "$SUPABASE_URL/rest/v1/whatsapp_messages?phone_number=eq.5511999990000" \
      -H "$AUTH" -H "apikey: $SERVICE_KEY" || true
    curl -sf -X DELETE "$SUPABASE_URL/rest/v1/leads?id=eq.$LEAD_ID" \
      -H "$AUTH" -H "apikey: $SERVICE_KEY" || true
  fi
  echo ""
  echo "═══════════════════════════════════════════"
  echo "  Results: $PASS passed, $FAIL failed"
  echo "═══════════════════════════════════════════"
  if [[ $FAIL -gt 0 ]]; then exit 1; fi
}
trap cleanup EXIT

assert_ok() {
  local desc="$1" val="$2"
  if [[ -n "$val" && "$val" != "null" ]]; then
    echo "  ✅ $desc"
    ((PASS++))
  else
    echo "  ❌ $desc (got: '$val')"
    ((FAIL++))
  fi
}

# ─── Step 1: Get an org ID ────────────────────────────────────────────────────
echo "📋 Step 1: Getting organization ID..."
ORG_ID=$(curl -sf "$SUPABASE_URL/rest/v1/organizations?select=id&limit=1" \
  -H "$AUTH" -H "apikey: $SERVICE_KEY" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
echo "  org_id=$ORG_ID"

# ─── Step 2: Create fake lead ────────────────────────────────────────────────
echo "📋 Step 2: Creating fake lead..."
LEAD_ID=$(curl -sf -X POST "$SUPABASE_URL/rest/v1/leads" \
  -H "$AUTH" -H "apikey: $SERVICE_KEY" -H "$CT" -H "Prefer: return=representation" \
  -d "{
    \"name\": \"__TEST_SUMMARIZE__\",
    \"phone\": \"5511999990000\",
    \"organization_id\": \"$ORG_ID\",
    \"origin\": \"test\"
  }" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
echo "  lead_id=$LEAD_ID"

# ─── Step 3: Insert fake WhatsApp messages ───────────────────────────────────
echo "📋 Step 3: Inserting fake messages..."
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
for i in 1 2 3 4 5; do
  MSG_CONTENT=""
  DIRECTION="incoming"
  case $i in
    1) MSG_CONTENT="Oi, vi o anúncio de vocês e tenho interesse no plano empresarial" ;;
    2) MSG_CONTENT="Claro! Temos planos a partir de R\$299/mês. Qual o tamanho da sua empresa?"; DIRECTION="outgoing" ;;
    3) MSG_CONTENT="Somos 15 pessoas, mas o preço está um pouco acima do nosso orçamento" ;;
    4) MSG_CONTENT="Entendo! Para 15 pessoas temos um desconto especial. Posso agendar uma demonstração?"; DIRECTION="outgoing" ;;
    5) MSG_CONTENT="Sim, pode ser na quinta-feira à tarde" ;;
  esac

  curl -sf -X POST "$SUPABASE_URL/rest/v1/whatsapp_messages" \
    -H "$AUTH" -H "apikey: $SERVICE_KEY" -H "$CT" \
    -d "{
      \"organization_id\": \"$ORG_ID\",
      \"instance_id\": \"00000000-0000-0000-0000-000000000000\",
      \"message_id\": \"test_summ_$i\",
      \"remote_jid\": \"5511999990000@s.whatsapp.net\",
      \"phone_number\": \"5511999990000\",
      \"direction\": \"$DIRECTION\",
      \"message_type\": \"conversation\",
      \"content\": \"$MSG_CONTENT\",
      \"timestamp\": \"$NOW\",
      \"status\": \"received\"
    }" > /dev/null
done
echo "  5 messages inserted"

# ─── Step 4: Call edge function ───────────────────────────────────────────────
echo "📋 Step 4: Calling summarize-conversation edge function..."
RESPONSE=$(curl -sf -X POST "$SUPABASE_URL/functions/v1/summarize-conversation" \
  -H "$AUTH" -H "$CT" \
  -d "{\"lead_id\": \"$LEAD_ID\", \"force_regenerate\": true}")

echo "  Response received"

# ─── Step 5: Validate response ───────────────────────────────────────────────
echo "📋 Step 5: Validating response fields..."
SUMMARY=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('summary',''))" 2>/dev/null || echo "")
SENTIMENT=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('sentiment',''))" 2>/dev/null || echo "")
TEMPERATURE=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('lead_temperature',''))" 2>/dev/null || echo "")
NEXT_ACTION=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('next_action',''))" 2>/dev/null || echo "")

assert_ok "summary is not empty" "$SUMMARY"
assert_ok "sentiment is set" "$SENTIMENT"
assert_ok "lead_temperature is set" "$TEMPERATURE"
assert_ok "next_action is set" "$NEXT_ACTION"

# ─── Step 6: Verify DB record ────────────────────────────────────────────────
echo "📋 Step 6: Checking conversation_summaries table..."
DB_RECORD=$(curl -sf "$SUPABASE_URL/rest/v1/conversation_summaries?lead_id=eq.$LEAD_ID&select=id,summary,sentiment" \
  -H "$AUTH" -H "apikey: $SERVICE_KEY")
DB_ID=$(echo "$DB_RECORD" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null || echo "")
assert_ok "record saved in conversation_summaries" "$DB_ID"

echo ""
echo "✅ Summarize conversation test complete!"
```

- [ ] **Step 2: Make executable**

Run: `chmod +x scripts/test-summarize-conversation.sh`

- [ ] **Step 3: Run the test**

Run: `bash scripts/test-summarize-conversation.sh`
Expected: All assertions pass (5 passed, 0 failed). If OPENROUTER_API_KEY is not set on the Supabase instance, the edge function will return an error - this confirms the function is reachable and validates input correctly.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-summarize-conversation.sh
git commit -m "test: add end-to-end test for summarize-conversation edge function"
```

---

## Task 11: Final verification

- [ ] **Step 1: Verify TypeScript compiles cleanly**

Run: `npx tsc --noEmit --pretty 2>&1 | head -50`
Expected: No errors

- [ ] **Step 2: Verify dev server starts**

Run: `npm run dev` (check it starts without errors, then Ctrl+C)

- [ ] **Step 3: Final commit with all changes**

If any uncommitted changes remain:
```bash
git add -A
git commit -m "chore: final cleanup for campaign selects + summarize conversation fix"
```


## Links relacionados

- [[Regras de Pipe]]

- [[Visao Geral]]

- [[Mensagens Agendadas]]

- [[Campanhas]]

- [[Workflow Builder]]

- [[OpenRouter Setup]]

- [[WhatsApp Evolution]]

- [[00 - INDEX]]
