# Workflow Campaign & Custom Pipeline Full Support

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make campaigns and custom pipelines first-class citizens in the workflow `stage_changed` trigger, so stage changes in campaigns fire workflows the same way standard pipes do.

**Architecture:** Add `campanha_id` to `trigger_config`, create a PG trigger on `campanha_leads` for stage changes that fires `stage_changed` via `fire_workflow_trigger()`, add campaigns to the TriggerPanel editor dropdown with dynamic stage loading, and add `useUpdateCampanhaLead` frontend call to `triggerStageChangedWorkflows`.

**Tech Stack:** PostgreSQL triggers, Supabase Edge Functions, React/TypeScript

**Root Causes:**
1. No PG trigger fires `stage_changed` when `campanha_leads.stage_id` changes
2. No frontend call to `triggerStageChangedWorkflows()` in `useUpdateCampanhaLead()`
3. Campaigns don't appear in the `StageChangedConfig` editor dropdown
4. No campaign stage loader in the editor
5. `trigger_config` has no `campanha_id` field

**Identification Model:**
| Source | Config field | Stage field | Stage format |
|--------|-------------|-------------|--------------|
| Standard pipe | `pipe_type` | `stages[]` / `to_stage` | stage_key string |
| Custom pipeline | `pipeline_id` | `stages[]` / `to_stage` | stage_key or UUID |
| Campaign | `campanha_id` | `stages[]` / `to_stage` | UUID (campanha_stages.id) |

---

## Task 1: Create PG trigger for campaign stage changes

**Files:**
- Create: `supabase/migrations/20260908100000_campaign_stage_changed_workflow_trigger.sql`

This fires `stage_changed` (not `campaign_completed`) whenever `stage_id` changes on `campanha_leads`, making campaigns visible to the same workflow matching logic.

- [ ] **Step 1: Write the migration**

```sql
-- =====================================================
-- Campaign stage_changed workflow trigger
-- Fires stage_changed when campanha_leads.stage_id changes
-- Uses fire_workflow_trigger() directly (same pattern as other campaign triggers)
-- =====================================================

CREATE OR REPLACE FUNCTION public.trigger_workflow_campaign_stage_changed()
RETURNS trigger AS $$
DECLARE
  v_org_id uuid;
  v_stage_name text;
  v_old_stage_name text;
BEGIN
  IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  SELECT organization_id INTO v_org_id FROM public.leads WHERE id = NEW.lead_id;

  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve stage names for context
  SELECT name INTO v_stage_name FROM public.campanha_stages WHERE id = NEW.stage_id;
  IF OLD.stage_id IS NOT NULL THEN
    SELECT name INTO v_old_stage_name FROM public.campanha_stages WHERE id = OLD.stage_id;
  END IF;

  PERFORM public.fire_workflow_trigger(
    v_org_id,
    'stage_changed',
    NEW.lead_id,
    jsonb_build_object(
      'trigger', 'stage_changed',
      'campanha_id', NEW.campanha_id::text,
      'from_stage', COALESCE(OLD.stage_id::text, ''),
      'to_stage', COALESCE(NEW.stage_id::text, ''),
      'stage_name', COALESCE(v_stage_name, ''),
      'from_stage_name', COALESCE(v_old_stage_name, '')
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_workflow_campaign_stage_changed ON public.campanha_leads;
CREATE TRIGGER trg_workflow_campaign_stage_changed
  AFTER UPDATE OF stage_id ON public.campanha_leads
  FOR EACH ROW
  WHEN (OLD.stage_id IS DISTINCT FROM NEW.stage_id)
  EXECUTE FUNCTION public.trigger_workflow_campaign_stage_changed();
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260908100000_campaign_stage_changed_workflow_trigger.sql
git commit -m "feat(workflows): add PG trigger for campaign stage_changed events"
```

---

## Task 2: Add campanha_id support to backend executor matching

**Files:**
- Modify: `supabase/functions/_shared/workflow-trigger.ts` (matchesTriggerConfig stage_changed case)

- [ ] **Step 1: Add campanha_id matching**

In `matchesTriggerConfig()`, the `stage_changed` case currently checks `pipe_type` and `pipeline_id`. Add `campanha_id`:

After the existing line:
```typescript
if (config.pipeline_id && context.pipeline_id && config.pipeline_id !== context.pipeline_id) return false;
```

Add:
```typescript
if (config.campanha_id && context.campanha_id && config.campanha_id !== context.campanha_id) return false;
```

This is backward-compatible: existing workflows without `campanha_id` in config will simply not check this field.

- [ ] **Step 2: Commit**

---

## Task 3: Add campaigns to TriggerPanel editor

**Files:**
- Modify: `src/components/automacoes/sidebar-panels/TriggerPanel.tsx` (StageChangedConfig)

- [ ] **Step 1: Import campaign hooks**

Add to imports:
```typescript
import { useCampanhas, useCampanhaStages } from "@/hooks/useCampanhas";
```

- [ ] **Step 2: Add campaign data loading to StageChangedConfig**

In the StageChangedConfig component, after the existing state extraction:

```typescript
const campanhaId = (cfg.campanha_id as string) || "";
const isCampaign = !!campanhaId;
```

Add hooks:
```typescript
const { data: campanhas } = useCampanhas();
const { data: campanhaStages } = useCampanhaStages(isCampaign ? campanhaId : undefined);
```

- [ ] **Step 3: Update stages array to include campaign stages**

Update the stages computation to handle campaigns:
```typescript
const stages = isCampaign
  ? (campanhaStages || []).map((s) => ({ key: s.id, name: s.name }))
  : isCustom
  ? (customStages || []).map((s) => ({ key: s.stage_key || s.id, name: s.name }))
  : isStandardPipe
  ? (standardStages || []).map((s) => ({
      key: "stage_key" in s ? s.stage_key : s.id,
      name: s.name,
    }))
  : [];
```

- [ ] **Step 4: Update handlePipeChange to handle campaigns**

```typescript
const handlePipeChange = (value: string) => {
  const isCustomPipe = customPipelines?.some((p) => p.id === value);
  const isCampanhaPipe = campanhas?.some((c) => c.id === value);
  if (isCampanhaPipe) {
    updateConfig({ pipe_type: "", pipeline_id: "", campanha_id: value, stages: [], from_stage: "", to_stage: "" });
  } else if (isCustomPipe) {
    updateConfig({ pipe_type: "", pipeline_id: value, campanha_id: "", stages: [], from_stage: "", to_stage: "" });
  } else {
    updateConfig({ pipe_type: value, pipeline_id: "", campanha_id: "", stages: [], from_stage: "", to_stage: "" });
  }
};
```

- [ ] **Step 5: Update currentPipeValue**

```typescript
const currentPipeValue = isCampaign ? campanhaId : isCustom ? pipelineId : pipeType || "__none__";
```

- [ ] **Step 6: Add campaigns group to Select dropdown**

After the custom pipelines SelectGroup, add:
```tsx
{campanhas && campanhas.length > 0 && (
  <SelectGroup>
    <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase">
      Campanhas
    </SelectLabel>
    {campanhas.map((c) => (
      <SelectItem key={c.id} value={c.id}>
        {c.name}
      </SelectItem>
    ))}
  </SelectGroup>
)}
```

- [ ] **Step 7: Commit**

---

## Task 4: Add triggerStageChangedWorkflows call to useUpdateCampanhaLead

**Files:**
- Modify: `src/hooks/useCampanhas.ts` (useUpdateCampanhaLead)

- [ ] **Step 1: Import triggerStageChangedWorkflows**

Add at top of file:
```typescript
import { triggerStageChangedWorkflows } from "@/lib/workflowTrigger";
```

- [ ] **Step 2: Add trigger call in onSettled**

In `useUpdateCampanhaLead`, after the mutation succeeds and `stage_id` changed, fire the trigger. Add to `onSettled`:

```typescript
onSettled: (data, error, variables) => {
  queryClient.invalidateQueries({ queryKey: ["campanha_leads", variables.campanha_id] });
  queryClient.invalidateQueries({ queryKey: ["campanha_members", variables.campanha_id] });

  // Fire workflow stage_changed trigger when stage changes
  if (data && variables.stage_id && data.lead_id) {
    const orgId = data.lead?.organization_id || data.organization_id;
    if (orgId) {
      triggerStageChangedWorkflows({
        organizationId: orgId,
        leadId: data.lead_id,
        campaignId: variables.campanha_id,
        toStage: variables.stage_id,
      }).catch(() => {}); // Non-blocking
    }
  }
},
```

Note: This is a belt-and-suspenders approach — the PG trigger (Task 1) fires server-side, and this frontend call provides redundancy. The executor's matching logic handles dedup via workflow_executions.

- [ ] **Step 3: Add campaignId param to triggerStageChangedWorkflows**

In `src/lib/workflowTrigger.ts`, add `campaignId` to the function signature and context:

```typescript
export async function triggerStageChangedWorkflows({
  organizationId,
  leadId,
  pipeType,
  pipelineId,
  campaignId,
  fromStage,
  toStage,
}: {
  organizationId: string;
  leadId: string;
  pipeType?: string;
  pipelineId?: string;
  campaignId?: string;
  fromStage?: string;
  toStage: string;
}) {
  // ...
  context: {
    trigger: "stage_changed",
    pipe_type: pipeType || null,
    pipeline_id: pipelineId || null,
    campanha_id: campaignId || null,
    from_stage: fromStage || null,
    to_stage: toStage,
  },
```

- [ ] **Step 4: Commit**

---

## Task 5: Add useStageWorkflows hook for campaigns

**Files:**
- Modify: `src/hooks/useStageWorkflows.ts`

- [ ] **Step 1: Add useCampaignStageWorkflows hook**

Following the exact pattern of `useCustomPipeStageWorkflows`:

```typescript
export function useCampaignStageWorkflows(
  campanhaId: string | undefined,
  stageId: string | undefined
) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["stage-workflows-campaign", organizationId, campanhaId, stageId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("workflows")
        .select("id, name, is_active, trigger_type, trigger_config")
        .eq("organization_id", organizationId)
        .eq("trigger_type", "stage_changed");
      if (error) throw error;
      const workflows = data as Workflow[];
      return workflows
        .filter((w) => {
          const cfg = w.trigger_config as TriggerConfigStageChanged;
          if (!cfg || cfg.campanha_id !== campanhaId) return false;
          if (cfg.stages && cfg.stages.length > 0) return cfg.stages.includes(stageId!);
          if (cfg.to_stage) return cfg.to_stage === stageId;
          return true;
        })
        .map((w) => ({ id: w.id, name: w.name, is_active: w.is_active }));
    },
    enabled: !!organizationId && !!campanhaId && !!stageId,
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 2: Add useCampaignWorkflowCounts hook**

Following the exact pattern of `useCustomPipeWorkflowCounts`:

```typescript
export function useCampaignWorkflowCounts(campanhaId: string | undefined) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["stage-workflow-counts-campaign", organizationId, campanhaId],
    queryFn: async () => {
      if (!organizationId) return {};
      const { data, error } = await supabase
        .from("workflows")
        .select("id, name, is_active, trigger_config")
        .eq("organization_id", organizationId)
        .eq("trigger_type", "stage_changed");
      if (error) throw error;
      const counts: Record<string, { total: number; active: number }> = {};
      for (const row of data as Workflow[]) {
        const cfg = row.trigger_config as TriggerConfigStageChanged;
        if (!cfg || cfg.campanha_id !== campanhaId) continue;
        const stages = cfg.stages && cfg.stages.length > 0
          ? cfg.stages
          : cfg.to_stage ? [cfg.to_stage] : null;
        if (stages) {
          for (const s of stages) {
            if (!counts[s]) counts[s] = { total: 0, active: 0 };
            counts[s].total++;
            if (row.is_active) counts[s].active++;
          }
        } else {
          if (!counts["__all__"]) counts["__all__"] = { total: 0, active: 0 };
          counts["__all__"].total++;
          if (row.is_active) counts["__all__"].active++;
        }
      }
      return counts;
    },
    enabled: !!organizationId && !!campanhaId,
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 3: Commit**

---

## Task 6: Type-check and build validation

- [ ] **Step 1: Run type-check**
Run: `npx tsc --noEmit`
Expected: 0 new errors

- [ ] **Step 2: Run production build**
Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 3: Final commit**
