# Stage Auto-Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando lead entra em uma stage com `checklist_template_id` configurado, o sistema cria automaticamente um checklist no lead copiando os items do template, garantido por trigger DB.

**Architecture:** Single source of truth via trigger DB em `pipeline_entries` e `custom_pipe_entries`. Idempotência por unique index `(lead_id, source_template_id)`. UI nos modais de gerenciamento de stages (fixos + custom).

**Tech Stack:** PostgreSQL trigger (PL/pgSQL, SECURITY DEFINER), React + TanStack Query + shadcn/ui, Supabase Management API para apply, Vitest integration tests.

**Spec:** `docs/superpowers/specs/2026-05-21-stage-auto-checklist-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/migrations/<ts>_stage_auto_checklist.sql` | Schema + trigger + publication | Create |
| `src/integrations/supabase/types.ts` | Generated types | Regen |
| `src/hooks/usePipelineStages.ts` | Hook for fixed pipeline stages CRUD | Modify (add `checklist_template_id`) |
| `src/hooks/useCustomPipelines.ts` | Hook for custom pipeline stages CRUD | Modify (add `checklist_template_id`) |
| `src/components/pipelines/ManagePipelineStagesModal.tsx` | Fixed pipes stage editor UI | Modify (add Select) |
| `src/components/custom-pipelines/CustomPipeSettingsDialog.tsx` | Custom pipes stage editor UI | Modify (add Select) |
| `tests/integration/stage-auto-checklist.test.ts` | End-to-end trigger behavior | Create |
| `Obsidian/.../06 — Features/Vendas/Checklists.md` | Feature doc | Update or create |

---

## Task 1: Write migration with schema, trigger, publication

**Files:**
- Create: `supabase/migrations/20260521120000_stage_auto_checklist.sql`

- [ ] **Step 1: Create migration file with full SQL**

```sql
-- 20260521120000_stage_auto_checklist.sql
-- Auto-apply checklist template when lead enters a stage configured with one.

-- 1. Stage points to template (1:1)
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS checklist_template_id uuid
  REFERENCES public.checklists(id) ON DELETE SET NULL;

ALTER TABLE public.custom_pipeline_stages
  ADD COLUMN IF NOT EXISTS checklist_template_id uuid
  REFERENCES public.checklists(id) ON DELETE SET NULL;

-- 2. Checklist tracks origin template (for idempotence + audit)
ALTER TABLE public.checklists
  ADD COLUMN IF NOT EXISTS source_template_id uuid
  REFERENCES public.checklists(id) ON DELETE SET NULL;

-- 3. Idempotence: 1 checklist per (lead, template)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_checklists_lead_source
  ON public.checklists(lead_id, source_template_id)
  WHERE source_template_id IS NOT NULL AND lead_id IS NOT NULL;

-- 4. Trigger function
CREATE OR REPLACE FUNCTION public.apply_stage_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template_id uuid;
  v_stage_org_id uuid;
  v_new_checklist_id uuid;
BEGIN
  -- No-op if UPDATE didn't actually change the stage column
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'pipeline_entries' AND NEW.stage_key IS NOT DISTINCT FROM OLD.stage_key THEN
      RETURN NEW;
    ELSIF TG_TABLE_NAME = 'custom_pipe_entries' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Lookup template + org for destination stage
  IF TG_TABLE_NAME = 'pipeline_entries' THEN
    -- pipeline_entries.stage_key is text; pipeline_type lives on entry? Check entry columns.
    -- Entry has no pipeline_type column — pipeline_type is derived from pipeline_id.
    -- pipeline_stages keys by (organization_id, pipeline_type, stage_key).
    -- We need pipeline_type via pipelines table OR via entry.pipeline_id lookup.
    -- Schema check: pipeline_entries has pipeline_id (uuid). pipelines table maps id → pipeline_type? 
    -- Simpler: pipeline_stages doesn't have pipeline_id — only (org, pipeline_type, stage_key).
    -- For fixed pipes the pipeline_type is encoded somewhere. Check on impl: 
    -- if pipeline_entries.pipeline_id maps to pipelines.pipeline_type (text), use that.
    SELECT ps.checklist_template_id, ps.organization_id
      INTO v_template_id, v_stage_org_id
    FROM public.pipeline_stages ps
    JOIN public.pipelines p ON p.id = NEW.pipeline_id
    WHERE ps.organization_id = NEW.organization_id
      AND ps.pipeline_type = p.pipeline_type
      AND ps.stage_key = NEW.stage_key
      AND ps.is_active = true
    LIMIT 1;
  ELSIF TG_TABLE_NAME = 'custom_pipe_entries' THEN
    SELECT cps.checklist_template_id, cps.organization_id
      INTO v_template_id, v_stage_org_id
    FROM public.custom_pipeline_stages cps
    WHERE cps.id = NEW.stage_id
    LIMIT 1;
  END IF;

  -- No template → no-op
  IF v_template_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Cross-org safety
  IF v_stage_org_id IS NULL OR v_stage_org_id <> NEW.organization_id THEN
    RETURN NEW;
  END IF;

  -- No lead_id → can't apply (defensive; should not happen for fixed pipes)
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Insert checklist from template, idempotent via unique index
  INSERT INTO public.checklists (
    organization_id, lead_id, source_template_id, title, description, created_by
  )
  SELECT t.organization_id, NEW.lead_id, t.id, t.title, t.description, NULL
  FROM public.checklists t
  WHERE t.id = v_template_id
    AND t.lead_id IS NULL
    AND t.organization_id = NEW.organization_id
  ON CONFLICT (lead_id, source_template_id)
    WHERE source_template_id IS NOT NULL AND lead_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_new_checklist_id;

  -- Copy items only if a new checklist was actually inserted
  IF v_new_checklist_id IS NOT NULL THEN
    INSERT INTO public.checklist_items (checklist_id, title, position)
    SELECT v_new_checklist_id, ci.title, ci.position
    FROM public.checklist_items ci
    WHERE ci.checklist_id = v_template_id
    ORDER BY ci.position;
  END IF;

  RETURN NEW;
END;
$$;

-- 5. Triggers
DROP TRIGGER IF EXISTS trg_apply_stage_checklist_pipeline ON public.pipeline_entries;
CREATE TRIGGER trg_apply_stage_checklist_pipeline
  AFTER INSERT OR UPDATE OF stage_key ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION public.apply_stage_checklist();

DROP TRIGGER IF EXISTS trg_apply_stage_checklist_custom ON public.custom_pipe_entries;
CREATE TRIGGER trg_apply_stage_checklist_custom
  AFTER INSERT OR UPDATE OF stage_id ON public.custom_pipe_entries
  FOR EACH ROW EXECUTE FUNCTION public.apply_stage_checklist();

-- 6. Realtime publication: enable checklists + checklist_items so UI sees auto-created items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'checklists'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.checklists;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'checklist_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.checklist_items;
  END IF;
END $$;
```

- [ ] **Step 2: Verify pipeline_entries → pipeline_type lookup path**

Before applying, verify `public.pipelines` table maps `id → pipeline_type`. Run via Management API:

```bash
curl -sS -X POST 'https://api.supabase.com/v1/projects/bcfadphgsibjzivtbjvc/database/query' \
  -H 'Authorization: Bearer <sbp_token>' \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: supabase-cli/2.x' \
  -d '{"query":"SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='pipelines' ORDER BY ordinal_position;"}'
```

Expected: column `pipeline_type text` exists on `pipelines`. If not, replace JOIN in trigger with the actual mapping mechanism (likely a column on `pipelines` or directly via `pipeline_entries.pipeline_type` if such denorm exists).

If `pipelines` table doesn't have `pipeline_type`, fallback: add `pipeline_type` to `pipeline_entries` via separate denorm migration first. **Stop and re-plan if discovery contradicts the JOIN assumption.**

- [ ] **Step 3: Apply migration in DEV**

```bash
curl -sS -X POST 'https://api.supabase.com/v1/projects/bcfadphgsibjzivtbjvc/database/query' \
  -H 'Authorization: Bearer <sbp_token>' \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: supabase-cli/2.x' \
  --data-binary @<(jq -Rs '{query: .}' < supabase/migrations/20260521120000_stage_auto_checklist.sql)
```

Expected: 200 OK, response `[]`.

- [ ] **Step 4: Register migration as applied (so CLI sees it as applied)**

```bash
curl -sS -X POST 'https://api.supabase.com/v1/projects/bcfadphgsibjzivtbjvc/database/query' \
  -H 'Authorization: Bearer <sbp_token>' \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: supabase-cli/2.x' \
  -d '{"query":"INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('\''20260521120000'\'', '\''stage_auto_checklist'\'', ARRAY[]::text[]) ON CONFLICT (version) DO NOTHING;"}'
```

- [ ] **Step 5: Verify schema**

```bash
curl -sS -X POST 'https://api.supabase.com/v1/projects/bcfadphgsibjzivtbjvc/database/query' \
  -H 'Authorization: Bearer <sbp_token>' \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: supabase-cli/2.x' \
  -d '{"query":"SELECT tgname FROM pg_trigger WHERE tgrelid IN ('public.pipeline_entries'::regclass, 'public.custom_pipe_entries'::regclass) AND tgname LIKE 'trg_apply_stage_checklist%';"}'
```

Expected: 2 rows.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260521120000_stage_auto_checklist.sql
git commit -m "feat(migrations): stage auto-checklist schema + trigger + realtime publication

Adds checklist_template_id to pipeline_stages and custom_pipeline_stages,
source_template_id + unique index to checklists, and a SECURITY DEFINER
trigger that copies a template into a per-lead checklist when the lead
enters a stage with a template configured. Enables realtime publication
on checklists + checklist_items so newly-created checklists appear in
the lead modal without manual refresh.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Regenerate Supabase types

**Files:**
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Run regen against DEV**

```bash
supabase gen types typescript --project-id bcfadphgsibjzivtbjvc > src/integrations/supabase/types.ts
```

- [ ] **Step 2: Verify new columns present**

```bash
grep -E "checklist_template_id|source_template_id" src/integrations/supabase/types.ts | head -10
```

Expected: matches in `pipeline_stages`, `custom_pipeline_stages`, `checklists`.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (or only pre-existing ones unrelated).

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore(types): regen after stage_auto_checklist migration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extend `usePipelineStages` hook

**Files:**
- Modify: `src/hooks/usePipelineStages.ts`

- [ ] **Step 1: Read current shape of `PipelineStage` interface + `useUpdatePipelineStage` mutation**

```bash
grep -n "checklist_template_id\|interface PipelineStage\|useUpdatePipelineStage" src/hooks/usePipelineStages.ts
```

- [ ] **Step 2: Add field to interface**

In `src/hooks/usePipelineStages.ts`, find:

```ts
export interface PipelineStage {
  id: string;
  organization_id: string;
  pipeline_type: PipelineType;
  stage_key: string;
  name: string;
  color: string | null;
  position: number;
  is_active: boolean;
  is_final_positive: boolean;
  is_final_negative: boolean;
  auto_move_min_days: number | null;
  auto_move_max_days: number | null;
  target_pipe_type: string | null;
  target_stage_key: string | null;
  created_at: string;
  updated_at: string;
}
```

Add `checklist_template_id: string | null;` before `created_at`.

- [ ] **Step 3: Ensure `useUpdatePipelineStage` passes through the new field**

If the update hook currently spreads input into `.update(...)`, no change needed — TS will accept the new key. If it picks specific fields explicitly, add `checklist_template_id` to the pick list. Verify by reading the mutation body.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit src/hooks/usePipelineStages.ts 2>&1 | head -10
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePipelineStages.ts
git commit -m "feat(usePipelineStages): expose checklist_template_id on stage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Extend `useCustomPipelines` hook

**Files:**
- Modify: `src/hooks/useCustomPipelines.ts`

- [ ] **Step 1: Locate stage type + mutation**

```bash
grep -n "CustomPipelineStage\|useUpdateCustomPipelineStage\|checklist_template_id" src/hooks/useCustomPipelines.ts
```

- [ ] **Step 2: Add `checklist_template_id: string | null` to the stage interface**

(Same shape as Task 3 step 2, on whichever interface represents `custom_pipeline_stages` rows in this hook.)

- [ ] **Step 3: Verify update mutation passes the field through**

Same check as Task 3 step 3.

- [ ] **Step 4: Type-check + commit**

```bash
npx tsc --noEmit 2>&1 | grep useCustomPipelines | head -5
git add src/hooks/useCustomPipelines.ts
git commit -m "feat(useCustomPipelines): expose checklist_template_id on stage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: UI — `ManagePipelineStagesModal` (fixed pipes)

**Files:**
- Modify: `src/components/pipelines/ManagePipelineStagesModal.tsx`

- [ ] **Step 1: Add import for templates hook**

At top of file, add:

```tsx
import { useChecklistTemplates } from "@/hooks/useChecklistTemplates";
```

- [ ] **Step 2: Inside the modal component, before render, fetch templates**

```tsx
const { data: templates = [] } = useChecklistTemplates();
```

- [ ] **Step 3: Inside the per-stage editor row, add the Select**

Find the existing stage row (where color/name/SLA fields render). Add this block, sized to match the surrounding inputs:

```tsx
<div className="flex items-center gap-2 text-xs">
  <Label className="text-muted-foreground shrink-0">Auto checklist:</Label>
  <Select
    value={stage.checklist_template_id ?? "__none__"}
    onValueChange={(v) =>
      updateStageMutation.mutate({
        id: stage.id,
        checklist_template_id: v === "__none__" ? null : v,
      })
    }
  >
    <SelectTrigger className="h-7 text-xs flex-1">
      <SelectValue placeholder="Sem checklist automático" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="__none__">Sem checklist</SelectItem>
      {templates.map((t) => (
        <SelectItem key={t.id} value={t.id}>
          {t.title}{" "}
          <span className="text-muted-foreground">({t.total_items})</span>
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

Replace `updateStageMutation` with the actual mutation name in this file (likely `useUpdatePipelineStage()` result). Replace `stage` with the actual loop variable name.

- [ ] **Step 4: Visual check**

```bash
npm run dev
# Open http://localhost:8080, navigate to a pipeline (whatsapp), open "Gerenciar Etapas".
# Verify select renders on each stage row, lists templates, persists on change.
```

- [ ] **Step 5: Type-check + lint**

```bash
npx tsc --noEmit 2>&1 | grep ManagePipelineStagesModal | head -5
npx eslint src/components/pipelines/ManagePipelineStagesModal.tsx | tail -10
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/pipelines/ManagePipelineStagesModal.tsx
git commit -m "feat(ui): stage auto-checklist selector in ManagePipelineStagesModal

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: UI — `CustomPipeSettingsDialog` (custom pipes)

**Files:**
- Modify: `src/components/custom-pipelines/CustomPipeSettingsDialog.tsx`

- [ ] **Step 1: Locate the per-stage editor block (analogous to Task 5)**

```bash
grep -n "stage\.\|stages\.map\|StageRow" src/components/custom-pipelines/CustomPipeSettingsDialog.tsx | head -20
```

- [ ] **Step 2: Add the same Select block from Task 5 step 3**

Use the same JSX, swapping the mutation reference for the custom-pipeline equivalent (likely `useUpdateCustomPipelineStage()` from `useCustomPipelines`).

- [ ] **Step 3: Visual check**

```bash
# In dev server, open a custom pipeline's settings dialog.
# Verify select on each stage, persists on change.
```

- [ ] **Step 4: Type-check + lint + commit**

```bash
npx tsc --noEmit 2>&1 | grep CustomPipeSettingsDialog | head -5
npx eslint src/components/custom-pipelines/CustomPipeSettingsDialog.tsx | tail -10
git add src/components/custom-pipelines/CustomPipeSettingsDialog.tsx
git commit -m "feat(ui): stage auto-checklist selector in CustomPipeSettingsDialog

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Integration test — trigger behavior

**Files:**
- Create: `tests/integration/stage-auto-checklist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/stage-auto-checklist.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_LOCAL_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE = process.env.SUPABASE_LOCAL_SERVICE_ROLE!;

let admin: SupabaseClient;
let orgId: string;
let leadId: string;
let templateId: string;
let stageRowId: string;

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Org
  const { data: org } = await admin.from("organizations").insert({ name: "test-stage-checklist" }).select("id").single();
  orgId = org!.id;

  // Lead
  const { data: lead } = await admin.from("leads").insert({ organization_id: orgId, name: "Test Lead" }).select("id").single();
  leadId = lead!.id;

  // Template checklist (lead_id null) + items
  const { data: t } = await admin.from("checklists").insert({
    organization_id: orgId, title: "Onboarding template",
  }).select("id").single();
  templateId = t!.id;
  await admin.from("checklist_items").insert([
    { checklist_id: templateId, title: "Item A", position: 0 },
    { checklist_id: templateId, title: "Item B", position: 1 },
    { checklist_id: templateId, title: "Item C", position: 2 },
  ]);

  // Stage row that points to template
  const { data: stage } = await admin.from("pipeline_stages").insert({
    organization_id: orgId,
    pipeline_type: "whatsapp",
    stage_key: "auto_test_stage",
    name: "Auto Test Stage",
    position: 99,
    is_active: true,
    checklist_template_id: templateId,
  }).select("id").single();
  stageRowId = stage!.id;
});

afterAll(async () => {
  await admin.from("organizations").delete().eq("id", orgId);
});

describe("stage auto-checklist trigger", () => {
  it("creates a checklist with copied items when lead enters configured stage", async () => {
    // Find a whatsapp pipeline row for this org or create one
    const { data: pipe } = await admin.from("pipelines")
      .upsert({ organization_id: orgId, pipeline_type: "whatsapp", name: "whatsapp" }, { onConflict: "organization_id,pipeline_type" })
      .select("id").single();

    // INSERT a pipeline_entries row -> trigger fires
    await admin.from("pipeline_entries").insert({
      organization_id: orgId,
      pipeline_id: pipe!.id,
      lead_id: leadId,
      stage_key: "auto_test_stage",
    });

    const { data: checklists } = await admin.from("checklists")
      .select("id, title, source_template_id")
      .eq("lead_id", leadId);

    expect(checklists).toHaveLength(1);
    expect(checklists![0].source_template_id).toBe(templateId);
    expect(checklists![0].title).toBe("Onboarding template");

    const { data: items } = await admin.from("checklist_items")
      .select("title, position")
      .eq("checklist_id", checklists![0].id)
      .order("position");

    expect(items).toHaveLength(3);
    expect(items!.map(i => i.title)).toEqual(["Item A", "Item B", "Item C"]);
  });

  it("is idempotent: re-INSERT same stage does not create duplicate checklist", async () => {
    const { data: pipe } = await admin.from("pipelines")
      .select("id").eq("organization_id", orgId).eq("pipeline_type", "whatsapp").single();

    await admin.from("pipeline_entries").upsert({
      organization_id: orgId,
      pipeline_id: pipe!.id,
      lead_id: leadId,
      stage_key: "auto_test_stage",
    }, { onConflict: "organization_id,pipeline_id,lead_id" });

    const { data: checklists } = await admin.from("checklists")
      .select("id").eq("lead_id", leadId).eq("source_template_id", templateId);

    expect(checklists).toHaveLength(1);
  });

  it("no-op when stage has no template", async () => {
    const { data: stage } = await admin.from("pipeline_stages").insert({
      organization_id: orgId,
      pipeline_type: "whatsapp",
      stage_key: "stage_no_tpl",
      name: "No Template",
      position: 100,
      is_active: true,
      checklist_template_id: null,
    }).select("id").single();

    const { data: pipe } = await admin.from("pipelines")
      .select("id").eq("organization_id", orgId).eq("pipeline_type", "whatsapp").single();

    await admin.from("pipeline_entries").update({ stage_key: "stage_no_tpl" })
      .eq("lead_id", leadId).eq("pipeline_id", pipe!.id);

    const { data: checklists } = await admin.from("checklists")
      .select("id").eq("lead_id", leadId);

    expect(checklists).toHaveLength(1); // still just the original one
    await admin.from("pipeline_stages").delete().eq("id", stage!.id);
  });

  it("cross-org safety: template + stage from org A, entry with org B fails to create", async () => {
    const { data: orgB } = await admin.from("organizations").insert({ name: "test-stage-checklist-B" }).select("id").single();
    const { data: leadB } = await admin.from("leads").insert({ organization_id: orgB!.id, name: "Lead B" }).select("id").single();

    const { data: pipeB } = await admin.from("pipelines").upsert({
      organization_id: orgB!.id, pipeline_type: "whatsapp", name: "whatsapp"
    }, { onConflict: "organization_id,pipeline_type" }).select("id").single();

    // Try to use stage key from org A in org B - should not find the stage at all
    await admin.from("pipeline_entries").insert({
      organization_id: orgB!.id,
      pipeline_id: pipeB!.id,
      lead_id: leadB!.id,
      stage_key: "auto_test_stage",
    });

    const { data: checklistsB } = await admin.from("checklists")
      .select("id").eq("lead_id", leadB!.id);

    expect(checklistsB).toHaveLength(0);
    await admin.from("organizations").delete().eq("id", orgB!.id);
  });
});
```

- [ ] **Step 2: Start local Supabase**

```bash
supabase start
```

Expected: outputs local URL + service_role key. Export them:

```bash
export SUPABASE_LOCAL_URL=$(supabase status -o json | jq -r .API_URL)
export SUPABASE_LOCAL_SERVICE_ROLE=$(supabase status -o json | jq -r .SERVICE_ROLE_KEY)
```

- [ ] **Step 3: Apply migration locally**

Per memory `project_dev_baseline_divergent.md`, `db push --include-all` may blast unwanted migrations on baseline divergence. Apply this single file directly via psql:

```bash
psql "$(supabase status -o json | jq -r .DB_URL)" -f supabase/migrations/20260521120000_stage_auto_checklist.sql
```

Expected: `ALTER TABLE`, `CREATE INDEX`, `CREATE FUNCTION`, `CREATE TRIGGER`, `ALTER PUBLICATION` succeed.

- [ ] **Step 4: Run integration test**

```bash
npx vitest run tests/integration/stage-auto-checklist.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/stage-auto-checklist.test.ts
git commit -m "test(integration): stage auto-checklist trigger behavior

Covers happy path (create + items copied), idempotence on re-enter,
no-op when stage has no template, and cross-org safety.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Documentation + PR

- [ ] **Step 1: Update Obsidian vault**

Add to `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/Vendas/Checklists.md` (create if not exists):

```markdown
## Auto-aplicar por stage

Cada stage (em `pipeline_stages` ou `custom_pipeline_stages`) tem um campo opcional `checklist_template_id` apontando para um template (= `checklists` com `lead_id IS NULL`).

Quando um lead entra em uma stage configurada:
- Trigger `apply_stage_checklist()` em `pipeline_entries` / `custom_pipe_entries` cria automaticamente uma cópia do template no lead.
- Idempotente: re-entrar na mesma stage não duplica (unique index em `(lead_id, source_template_id)`).
- Cross-org seguro: trigger valida que stage.org = entry.org.

Configurado via UI em "Gerenciar Etapas" (pipes fixos) e nas configurações de stage do custom pipeline.

Para casos com condicionais (ex: "aplicar só se tag = X"), continuar usando workflow `stage_changed → apply_checklist`.
```

- [ ] **Step 2: Update schema reference**

Add to `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/03 — Reference/Schema.md`:

```markdown
### pipeline_stages / custom_pipeline_stages — `checklist_template_id`

Aponta para `checklists.id` de um template. Stage com valor não-nulo dispara auto-aplicação ao entrar lead.

### checklists — `source_template_id`

Quando preenchido, indica que o checklist veio de auto-aplicação por stage. Unique parcial `(lead_id, source_template_id)` garante idempotência.
```

- [ ] **Step 3: Commit docs**

```bash
git add "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/Vendas/Checklists.md" "Obsidian/Segundo Cerebro/Claude Code — Torque CRM/03 — Reference/Schema.md"
git commit -m "docs(obsidian): stage auto-checklist feature + schema reference

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Push branch + open PR**

```bash
git push -u origin feat/stage-auto-checklist
gh pr create --base main --title "feat(checklists): auto-apply template when lead enters configured stage" --body "$(cat <<'EOF'
## Summary
- New: stage-level `checklist_template_id` on `pipeline_stages` and `custom_pipeline_stages`.
- New: `apply_stage_checklist()` DB trigger on `pipeline_entries` and `custom_pipe_entries` — auto-creates a per-lead checklist (copying items) when the lead enters a stage with a template configured.
- Idempotent via unique partial index `(lead_id, source_template_id)`.
- UI: dropdown "Auto checklist" per stage in `ManagePipelineStagesModal` and `CustomPipeSettingsDialog`.
- Realtime publication enabled for `checklists` + `checklist_items` so the lead modal sees new auto-checklists without manual refresh.

## Spec
docs/superpowers/specs/2026-05-21-stage-auto-checklist-design.md

## Test plan
- [x] Integration test: trigger fires, items copied in order, idempotent on re-enter, no-op without template, cross-org safe.
- [ ] Manual (dev): configure template on a whatsapp stage, drag lead to that stage in kanban, verify checklist appears in lead modal.
- [ ] Manual (dev): re-drag same lead through stage → still 1 checklist.
- [ ] Manual (dev): apply via workflow `move_stage` action → trigger also fires (unified path proof).
- [ ] Manual (dev): membro (non-admin) drags lead → checklist still created (trigger is SECURITY DEFINER).

## Rollout
1. Apply migration in DEV via Management API (Task 1).
2. UAT in dev.
3. CTO approves prod apply.
4. Apply migration in prod.
5. Verify realtime publication includes `checklists` + `checklist_items` in prod.

## Rollback
DROP TRIGGER + DROP FUNCTION + DROP COLUMNS + DROP INDEX. Checklists already auto-created persist (non-destructive).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Acceptance criteria (final check)

Before declaring done:

- [ ] Migration applied in DEV without error.
- [ ] All 4 integration tests pass locally.
- [ ] Manual UAT in dev: drag lead to configured stage → checklist appears.
- [ ] Manual UAT: re-drag same lead → still 1 checklist (idempotence).
- [ ] Manual UAT: drag lead to stage without template → no checklist created.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npx eslint` no new errors on touched files.
- [ ] PR opened, description matches above.

## Risk register

| Risk | Mitigation in plan |
|---|---|
| `pipelines.pipeline_type` assumption wrong | Task 1 Step 2 verifies before apply; stop-and-replan if absent. |
| `checklists` policies recurse in realtime | Already verified policies use `get_my_organization_ids()` (not inline `team_members`). Safe. |
| Trigger blocks move under heavy load | Trigger does 1 lookup + 1 insert + N item inserts; <10ms typical. Stress test deferred to UAT. |
| Realtime publication didn't include checklists before — adding it might surface latent RLS issues | Policies confirmed safe; if new symptoms appear, revert publication via `ALTER PUBLICATION supabase_realtime DROP TABLE`. |
| Frontend select doesn't render for some stages with stale type cache | Task 2 regen types step ensures fresh schema. |

## Out of scope (explicit)

- Conditional auto-apply (use workflow engine).
- Multi-template per stage.
- Retroactive apply to leads already in the stage.
- Auto-remove checklist when lead leaves stage.
- Telemetry/audit log beyond `created_at` + `source_template_id`.
- Permission gating beyond what `ManagePipelineStagesModal` already enforces.
