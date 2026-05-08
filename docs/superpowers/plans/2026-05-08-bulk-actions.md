# Bulk Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-select + bulk actions (move stage, assign responsible, add/remove tag, delete) to Leads table and all Kanban pipe pages.

**Architecture:** A shared `useBulkSelection` hook manages selection state (Set-based, with shift-click range support). A floating `BulkActionBar` renders at screen bottom when ≥1 item selected. Backend RPCs handle batch operations atomically with org-scoped RLS. Each pipe page opts in by wrapping its content with the selection hook and rendering the bar.

**Tech Stack:** React 18, TypeScript, shadcn/ui (Checkbox, Dialog, AlertDialog, Select, Badge), @dnd-kit (coexists with selection), TanStack Query v5, Supabase RPC (plpgsql), Vitest.

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/hooks/useBulkSelection.ts` | Selection state: toggle, range-select (shift), select-all, clear. Returns `selectedIds`, `isSelected()`, `toggle()`, `toggleRange()`, `selectAll()`, `clearSelection()` |
| `src/components/bulk-actions/BulkActionBar.tsx` | Floating bar: count badge + Move / Assign / Tag / Delete buttons. Uses framer-motion for enter/exit |
| `src/components/bulk-actions/BulkMoveStageDialog.tsx` | Dialog: pick target pipeline + stage → calls batch RPC |
| `src/components/bulk-actions/BulkAssignDialog.tsx` | Dialog: pick pre_sale_responsible and/or sale_responsible → calls batch RPC |
| `src/components/bulk-actions/BulkTagDialog.tsx` | Dialog: pick tags to add or remove → calls batch RPC |
| `src/components/bulk-actions/BulkDeleteDialog.tsx` | AlertDialog: confirm count → calls batch delete |
| `src/hooks/useBulkActions.ts` | Mutations wrapping the 4 batch RPCs. Handles cache invalidation. |
| `supabase/migrations/20260931000000_bulk_action_rpcs.sql` | 4 RPC functions: `batch_move_stage`, `batch_assign_responsible`, `batch_update_tags`, `batch_delete_leads` |
| `tests/unit/bulk-selection.test.ts` | Unit tests for selection logic (toggle, range, select-all, clear) |
| `tests/unit/bulk-action-bar.test.tsx` | Render tests for BulkActionBar (visibility, count, button states) |

### Modified Files
| File | Change |
|------|--------|
| `src/pages/Leads.tsx` | Add Checkbox column, header select-all, wire `useBulkSelection`, render `BulkActionBar` |
| `src/components/kanban/KanbanCard.tsx` | Add optional Checkbox overlay (top-left), `isSelected` + `onToggle` props |
| `src/components/kanban/DraggableKanbanBoard.tsx` | Pass selection props through `renderCard`, add select-all per column |
| `src/pages/PipeWhatsapp.tsx` | Wire `useBulkSelection` + `BulkActionBar` |
| `src/pages/PipeConfirmacao.tsx` | Wire `useBulkSelection` + `BulkActionBar` |
| `src/pages/PipePropostas.tsx` | Wire `useBulkSelection` + `BulkActionBar` |
| `src/pages/CustomPipeline.tsx` | Wire `useBulkSelection` + `BulkActionBar` |

---

## Task 1: Selection Hook — `useBulkSelection`

**Files:**
- Create: `src/hooks/useBulkSelection.ts`
- Test: `tests/unit/bulk-selection.test.ts`

- [ ] **Step 1: Write failing tests for selection logic**

```typescript
// tests/unit/bulk-selection.test.ts
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useBulkSelection } from "@/hooks/useBulkSelection";

describe("useBulkSelection", () => {
  it("starts with empty selection", () => {
    const { result } = renderHook(() => useBulkSelection());
    expect(result.current.selectedIds).toEqual(new Set());
    expect(result.current.count).toBe(0);
    expect(result.current.hasSelection).toBe(false);
  });

  it("toggles single item", () => {
    const { result } = renderHook(() => useBulkSelection());
    act(() => result.current.toggle("a"));
    expect(result.current.selectedIds.has("a")).toBe(true);
    expect(result.current.count).toBe(1);
    act(() => result.current.toggle("a"));
    expect(result.current.selectedIds.has("a")).toBe(false);
    expect(result.current.count).toBe(0);
  });

  it("selects range with shift-click", () => {
    const { result } = renderHook(() => useBulkSelection());
    const orderedIds = ["a", "b", "c", "d", "e"];
    act(() => result.current.toggle("b"));
    act(() => result.current.toggleRange("d", orderedIds));
    expect(result.current.selectedIds).toEqual(new Set(["b", "c", "d"]));
  });

  it("selects all from provided list", () => {
    const { result } = renderHook(() => useBulkSelection());
    act(() => result.current.selectAll(["x", "y", "z"]));
    expect(result.current.count).toBe(3);
  });

  it("deselects all when selectAll called on fully selected list", () => {
    const { result } = renderHook(() => useBulkSelection());
    act(() => result.current.selectAll(["x", "y"]));
    act(() => result.current.selectAll(["x", "y"]));
    expect(result.current.count).toBe(0);
  });

  it("clears selection", () => {
    const { result } = renderHook(() => useBulkSelection());
    act(() => result.current.toggle("a"));
    act(() => result.current.toggle("b"));
    act(() => result.current.clearSelection());
    expect(result.current.count).toBe(0);
  });

  it("isSelected returns correct boolean", () => {
    const { result } = renderHook(() => useBulkSelection());
    act(() => result.current.toggle("a"));
    expect(result.current.isSelected("a")).toBe(true);
    expect(result.current.isSelected("b")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```bash
npm run test:unit -- tests/unit/bulk-selection.test.ts
```
Expected: FAIL — `Cannot find module '@/hooks/useBulkSelection'`

- [ ] **Step 3: Implement useBulkSelection**

```typescript
// src/hooks/useBulkSelection.ts
import { useCallback, useMemo, useState } from "react";

export function useBulkSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastToggled, setLastToggled] = useState<string | null>(null);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastToggled(id);
  }, []);

  const toggleRange = useCallback(
    (id: string, orderedIds: string[]) => {
      if (!lastToggled) {
        toggle(id);
        return;
      }
      const startIdx = orderedIds.indexOf(lastToggled);
      const endIdx = orderedIds.indexOf(id);
      if (startIdx === -1 || endIdx === -1) {
        toggle(id);
        return;
      }
      const [from, to] =
        startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) next.add(orderedIds[i]);
        return next;
      });
      setLastToggled(id);
    },
    [lastToggled, toggle]
  );

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(ids);
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastToggled(null);
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds]
  );

  const count = selectedIds.size;
  const hasSelection = count > 0;
  const selectedArray = useMemo(() => Array.from(selectedIds), [selectedIds]);

  return {
    selectedIds,
    selectedArray,
    count,
    hasSelection,
    toggle,
    toggleRange,
    selectAll,
    clearSelection,
    isSelected,
  };
}

export type BulkSelection = ReturnType<typeof useBulkSelection>;
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm run test:unit -- tests/unit/bulk-selection.test.ts
```
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useBulkSelection.ts tests/unit/bulk-selection.test.ts
git commit -m "feat(bulk): add useBulkSelection hook with shift-click range support"
```

---

## Task 2: Backend RPCs — Batch Operations

**Files:**
- Create: `supabase/migrations/20260931000000_bulk_action_rpcs.sql`

- [ ] **Step 1: Write migration with 4 batch RPC functions**

```sql
-- supabase/migrations/20260931000000_bulk_action_rpcs.sql
-- Batch RPCs for bulk actions on leads and pipeline entries.
-- All scoped to organization_id via get_user_organization_id().

BEGIN;

-- ============================================================================
-- 1. batch_move_stage
-- Moves multiple leads to a target stage within a specific pipe type.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.batch_move_stage(
  p_lead_ids      UUID[],
  p_pipe_type     TEXT,       -- 'whatsapp' | 'confirmacao' | 'propostas'
  p_target_stage  TEXT,       -- stage key
  p_pipeline_id   UUID DEFAULT NULL  -- for custom pipes only
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID := public.get_user_organization_id();
  v_updated INT := 0;
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization context';
  END IF;

  IF array_length(p_lead_ids, 1) > 500 THEN
    RAISE EXCEPTION 'Batch limit exceeded (max 500)';
  END IF;

  IF p_pipe_type = 'whatsapp' THEN
    UPDATE public.pipe_whatsapp
    SET status = p_target_stage, updated_at = NOW()
    WHERE lead_id = ANY(p_lead_ids)
      AND organization_id = v_org_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

  ELSIF p_pipe_type = 'confirmacao' THEN
    UPDATE public.pipe_confirmacao
    SET status = p_target_stage, updated_at = NOW()
    WHERE lead_id = ANY(p_lead_ids)
      AND organization_id = v_org_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

  ELSIF p_pipe_type = 'propostas' THEN
    UPDATE public.pipe_propostas
    SET status = p_target_stage, updated_at = NOW()
    WHERE lead_id = ANY(p_lead_ids)
      AND organization_id = v_org_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

  ELSIF p_pipe_type = 'custom' AND p_pipeline_id IS NOT NULL THEN
    UPDATE public.custom_pipe_entries
    SET stage_id = (
      SELECT id FROM public.custom_pipeline_stages
      WHERE pipeline_id = p_pipeline_id AND stage_key = p_target_stage
      LIMIT 1
    ), stage_changed_at = NOW(), updated_at = NOW()
    WHERE lead_id = ANY(p_lead_ids)
      AND organization_id = v_org_id
      AND pipeline_id = p_pipeline_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

  ELSE
    RAISE EXCEPTION 'Invalid pipe_type: %', p_pipe_type;
  END IF;

  RETURN jsonb_build_object('updated', v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION public.batch_move_stage(UUID[], TEXT, TEXT, UUID) TO authenticated;

-- ============================================================================
-- 2. batch_assign_responsible
-- Sets pre_sale_responsible_id and/or sale_responsible_id on leads.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.batch_assign_responsible(
  p_lead_ids                UUID[],
  p_pre_sale_responsible_id UUID DEFAULT NULL,
  p_sale_responsible_id     UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID := public.get_user_organization_id();
  v_updated INT := 0;
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization context';
  END IF;

  IF array_length(p_lead_ids, 1) > 500 THEN
    RAISE EXCEPTION 'Batch limit exceeded (max 500)';
  END IF;

  IF p_pre_sale_responsible_id IS NULL AND p_sale_responsible_id IS NULL THEN
    RAISE EXCEPTION 'At least one responsible must be provided';
  END IF;

  UPDATE public.leads
  SET
    pre_sale_responsible_id = COALESCE(p_pre_sale_responsible_id, pre_sale_responsible_id),
    sale_responsible_id     = COALESCE(p_sale_responsible_id, sale_responsible_id),
    sdr_id                  = COALESCE(p_pre_sale_responsible_id, sdr_id),
    responsible_id          = COALESCE(p_sale_responsible_id, responsible_id),
    updated_at              = NOW()
  WHERE id = ANY(p_lead_ids)
    AND organization_id = v_org_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('updated', v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION public.batch_assign_responsible(UUID[], UUID, UUID) TO authenticated;

-- ============================================================================
-- 3. batch_update_tags
-- Add or remove tags from multiple leads at once.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.batch_update_tags(
  p_lead_ids     UUID[],
  p_add_tag_ids  UUID[] DEFAULT '{}',
  p_remove_tag_ids UUID[] DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID := public.get_user_organization_id();
  v_added INT := 0;
  v_removed INT := 0;
  v_lead_id UUID;
  v_tag_id UUID;
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization context';
  END IF;

  IF array_length(p_lead_ids, 1) > 500 THEN
    RAISE EXCEPTION 'Batch limit exceeded (max 500)';
  END IF;

  -- Verify leads belong to org
  IF EXISTS (
    SELECT 1 FROM unnest(p_lead_ids) AS lid
    WHERE NOT EXISTS (
      SELECT 1 FROM public.leads WHERE id = lid AND organization_id = v_org_id
    )
  ) THEN
    RAISE EXCEPTION 'Some leads do not belong to your organization';
  END IF;

  -- Remove tags
  IF array_length(p_remove_tag_ids, 1) > 0 THEN
    DELETE FROM public.lead_tags
    WHERE lead_id = ANY(p_lead_ids)
      AND tag_id = ANY(p_remove_tag_ids);
    GET DIAGNOSTICS v_removed = ROW_COUNT;
  END IF;

  -- Add tags (ignore duplicates)
  IF array_length(p_add_tag_ids, 1) > 0 THEN
    INSERT INTO public.lead_tags (lead_id, tag_id)
    SELECT l.id, t.id
    FROM unnest(p_lead_ids) AS l(id)
    CROSS JOIN unnest(p_add_tag_ids) AS t(id)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_added = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('added', v_added, 'removed', v_removed);
END;
$$;

GRANT EXECUTE ON FUNCTION public.batch_update_tags(UUID[], UUID[], UUID[]) TO authenticated;

-- ============================================================================
-- 4. batch_delete_leads
-- Delete multiple leads and all their dependencies. Org-scoped.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.batch_delete_leads(
  p_lead_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID := public.get_user_organization_id();
  v_deleted INT := 0;
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization context';
  END IF;

  IF array_length(p_lead_ids, 1) > 500 THEN
    RAISE EXCEPTION 'Batch limit exceeded (max 500)';
  END IF;

  -- Dependencies (order matters)
  DELETE FROM public.lead_tags WHERE lead_id = ANY(p_lead_ids);
  DELETE FROM public.lead_history WHERE lead_id = ANY(p_lead_ids);
  DELETE FROM public.lead_scores WHERE lead_id = ANY(p_lead_ids);
  DELETE FROM public.lead_custom_field_values WHERE lead_id = ANY(p_lead_ids);
  DELETE FROM public.leads_reativacao WHERE lead_id = ANY(p_lead_ids);
  DELETE FROM public.follow_ups WHERE lead_id = ANY(p_lead_ids);
  DELETE FROM public.acoes_do_dia WHERE lead_id = ANY(p_lead_ids);
  DELETE FROM public.campanha_leads WHERE lead_id = ANY(p_lead_ids);
  DELETE FROM public.pipe_proposta_items WHERE proposta_id IN (
    SELECT id FROM public.pipe_propostas WHERE lead_id = ANY(p_lead_ids) AND organization_id = v_org_id
  );
  DELETE FROM public.pipe_whatsapp WHERE lead_id = ANY(p_lead_ids) AND organization_id = v_org_id;
  DELETE FROM public.pipe_confirmacao WHERE lead_id = ANY(p_lead_ids) AND organization_id = v_org_id;
  DELETE FROM public.pipe_propostas WHERE lead_id = ANY(p_lead_ids) AND organization_id = v_org_id;
  DELETE FROM public.custom_pipe_entries WHERE lead_id = ANY(p_lead_ids) AND organization_id = v_org_id;
  DELETE FROM public.conversations WHERE lead_id = ANY(p_lead_ids) AND organization_id = v_org_id;

  -- Delete leads themselves
  DELETE FROM public.leads
  WHERE id = ANY(p_lead_ids)
    AND organization_id = v_org_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.batch_delete_leads(UUID[]) TO authenticated;

COMMIT;
```

- [ ] **Step 2: Verify migration SQL is valid**

```bash
# Check syntax locally (optional — will be validated on push)
grep -c "CREATE OR REPLACE FUNCTION" supabase/migrations/20260931000000_bulk_action_rpcs.sql
```
Expected: `4`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260931000000_bulk_action_rpcs.sql
git commit -m "feat(db): add batch RPC functions for bulk lead actions"
```

---

## Task 3: Bulk Actions Hook — `useBulkActions`

**Files:**
- Create: `src/hooks/useBulkActions.ts`

- [ ] **Step 1: Implement useBulkActions with 4 mutations**

```typescript
// src/hooks/useBulkActions.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const INVALIDATION_KEYS = [
  "leads",
  "pipe-whatsapp",
  "pipe-confirmacao",
  "pipe-propostas",
  "custom-pipe-entries",
  "lead-tags",
  "follow-ups",
];

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    INVALIDATION_KEYS.forEach((key) =>
      qc.invalidateQueries({ queryKey: [key] })
    );
  };
}

export function useBulkMoveStage() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (params: {
      leadIds: string[];
      pipeType: "whatsapp" | "confirmacao" | "propostas" | "custom";
      targetStage: string;
      pipelineId?: string;
    }) => {
      const { data, error } = await supabase.rpc("batch_move_stage", {
        p_lead_ids: params.leadIds,
        p_pipe_type: params.pipeType,
        p_target_stage: params.targetStage,
        p_pipeline_id: params.pipelineId ?? null,
      });
      if (error) throw error;
      return data as { updated: number };
    },
    onSuccess: (data) => {
      invalidate();
      toast.success(`${data.updated} leads movidos`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useBulkAssignResponsible() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (params: {
      leadIds: string[];
      preSaleResponsibleId?: string;
      saleResponsibleId?: string;
    }) => {
      const { data, error } = await supabase.rpc("batch_assign_responsible", {
        p_lead_ids: params.leadIds,
        p_pre_sale_responsible_id: params.preSaleResponsibleId ?? null,
        p_sale_responsible_id: params.saleResponsibleId ?? null,
      });
      if (error) throw error;
      return data as { updated: number };
    },
    onSuccess: (data) => {
      invalidate();
      toast.success(`${data.updated} leads atualizados`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useBulkUpdateTags() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (params: {
      leadIds: string[];
      addTagIds?: string[];
      removeTagIds?: string[];
    }) => {
      const { data, error } = await supabase.rpc("batch_update_tags", {
        p_lead_ids: params.leadIds,
        p_add_tag_ids: params.addTagIds ?? [],
        p_remove_tag_ids: params.removeTagIds ?? [],
      });
      if (error) throw error;
      return data as { added: number; removed: number };
    },
    onSuccess: (data) => {
      invalidate();
      const parts = [];
      if (data.added > 0) parts.push(`${data.added} tags adicionadas`);
      if (data.removed > 0) parts.push(`${data.removed} tags removidas`);
      toast.success(parts.join(", ") || "Tags atualizadas");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useBulkDeleteLeads() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (leadIds: string[]) => {
      const { data, error } = await supabase.rpc("batch_delete_leads", {
        p_lead_ids: leadIds,
      });
      if (error) throw error;
      return data as { deleted: number };
    },
    onSuccess: (data) => {
      invalidate();
      toast.success(`${data.deleted} leads excluídos`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useBulkActions.ts
git commit -m "feat(bulk): add useBulkActions hook with 4 batch mutations"
```

---

## Task 4: BulkActionBar Component

**Files:**
- Create: `src/components/bulk-actions/BulkActionBar.tsx`
- Test: `tests/unit/bulk-action-bar.test.tsx`

- [ ] **Step 1: Write failing render test**

```typescript
// tests/unit/bulk-action-bar.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { BulkActionBar } from "@/components/bulk-actions/BulkActionBar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const qc = new QueryClient();
const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
);

describe("BulkActionBar", () => {
  it("renders nothing when count is 0", () => {
    const { container } = render(
      wrap(
        <BulkActionBar
          count={0}
          onClear={vi.fn()}
          onMoveStage={vi.fn()}
          onAssign={vi.fn()}
          onTag={vi.fn()}
          onDelete={vi.fn()}
        />
      )
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders count and action buttons when count > 0", () => {
    render(
      wrap(
        <BulkActionBar
          count={5}
          onClear={vi.fn()}
          onMoveStage={vi.fn()}
          onAssign={vi.fn()}
          onTag={vi.fn()}
          onDelete={vi.fn()}
        />
      )
    );
    expect(screen.getByText("5 selecionados")).toBeTruthy();
    expect(screen.getByText("Mover")).toBeTruthy();
    expect(screen.getByText("Atribuir")).toBeTruthy();
    expect(screen.getByText("Tags")).toBeTruthy();
    expect(screen.getByText("Excluir")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm run test:unit -- tests/unit/bulk-action-bar.test.tsx
```

- [ ] **Step 3: Implement BulkActionBar**

```typescript
// src/components/bulk-actions/BulkActionBar.tsx
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRightLeft, Tag, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface BulkActionBarProps {
  count: number;
  onClear: () => void;
  onMoveStage: () => void;
  onAssign: () => void;
  onTag: () => void;
  onDelete: () => void;
}

export function BulkActionBar({
  count,
  onClear,
  onMoveStage,
  onAssign,
  onTag,
  onDelete,
}: BulkActionBarProps) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 shadow-2xl"
        >
          <Badge variant="secondary" className="text-sm font-medium">
            {count} selecionados
          </Badge>

          <div className="mx-1 h-5 w-px bg-border" />

          <Button variant="ghost" size="sm" onClick={onMoveStage}>
            <ArrowRightLeft className="mr-1.5 h-4 w-4" />
            Mover
          </Button>

          <Button variant="ghost" size="sm" onClick={onAssign}>
            <UserPlus className="mr-1.5 h-4 w-4" />
            Atribuir
          </Button>

          <Button variant="ghost" size="sm" onClick={onTag}>
            <Tag className="mr-1.5 h-4 w-4" />
            Tags
          </Button>

          <div className="mx-1 h-5 w-px bg-border" />

          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Excluir
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 ml-1"
            onClick={onClear}
          >
            <X className="h-4 w-4" />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm run test:unit -- tests/unit/bulk-action-bar.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/bulk-actions/BulkActionBar.tsx tests/unit/bulk-action-bar.test.tsx
git commit -m "feat(bulk): add BulkActionBar floating component"
```

---

## Task 5: Bulk Action Dialogs

**Files:**
- Create: `src/components/bulk-actions/BulkMoveStageDialog.tsx`
- Create: `src/components/bulk-actions/BulkAssignDialog.tsx`
- Create: `src/components/bulk-actions/BulkTagDialog.tsx`
- Create: `src/components/bulk-actions/BulkDeleteDialog.tsx`

- [ ] **Step 1: BulkMoveStageDialog**

```typescript
// src/components/bulk-actions/BulkMoveStageDialog.tsx
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBulkMoveStage } from "@/hooks/useBulkActions";

interface Stage {
  id: string;
  stage_key: string;
  name: string;
  color: string | null;
}

interface BulkMoveStageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  pipeType: "whatsapp" | "confirmacao" | "propostas" | "custom";
  pipelineId?: string;
  stages: Stage[];
  onSuccess: () => void;
}

export function BulkMoveStageDialog({
  open,
  onOpenChange,
  leadIds,
  pipeType,
  pipelineId,
  stages,
  onSuccess,
}: BulkMoveStageDialogProps) {
  const [targetStage, setTargetStage] = useState("");
  const mutation = useBulkMoveStage();

  const handleSubmit = () => {
    if (!targetStage) return;
    mutation.mutate(
      { leadIds, pipeType, targetStage, pipelineId },
      {
        onSuccess: () => {
          onOpenChange(false);
          setTargetStage("");
          onSuccess();
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mover {leadIds.length} leads</DialogTitle>
        </DialogHeader>
        <Select value={targetStage} onValueChange={setTargetStage}>
          <SelectTrigger>
            <SelectValue placeholder="Selecionar stage..." />
          </SelectTrigger>
          <SelectContent>
            {stages.map((s) => (
              <SelectItem key={s.stage_key} value={s.stage_key}>
                <span className="flex items-center gap-2">
                  {s.color && (
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                  )}
                  {s.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!targetStage || mutation.isPending}
          >
            {mutation.isPending ? "Movendo..." : "Mover"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: BulkAssignDialog**

```typescript
// src/components/bulk-actions/BulkAssignDialog.tsx
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { useBulkAssignResponsible } from "@/hooks/useBulkActions";

interface BulkAssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  onSuccess: () => void;
}

export function BulkAssignDialog({
  open,
  onOpenChange,
  leadIds,
  onSuccess,
}: BulkAssignDialogProps) {
  const [preSaleId, setPreSaleId] = useState("");
  const [saleId, setSaleId] = useState("");
  const { data: members = [] } = useTeamMembers();
  const mutation = useBulkAssignResponsible();

  const activeMembers = members.filter((m: any) => m.is_active);

  const handleSubmit = () => {
    if (!preSaleId && !saleId) return;
    mutation.mutate(
      {
        leadIds,
        preSaleResponsibleId: preSaleId || undefined,
        saleResponsibleId: saleId || undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setPreSaleId("");
          setSaleId("");
          onSuccess();
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Atribuir {leadIds.length} leads</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-blue-400">Resp. Pré-Venda</Label>
            <Select value={preSaleId} onValueChange={setPreSaleId}>
              <SelectTrigger>
                <SelectValue placeholder="Manter atual..." />
              </SelectTrigger>
              <SelectContent>
                {activeMembers.map((m: any) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-emerald-400">Resp. Venda</Label>
            <Select value={saleId} onValueChange={setSaleId}>
              <SelectTrigger>
                <SelectValue placeholder="Manter atual..." />
              </SelectTrigger>
              <SelectContent>
                {activeMembers.map((m: any) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={(!preSaleId && !saleId) || mutation.isPending}
          >
            {mutation.isPending ? "Atribuindo..." : "Atribuir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: BulkTagDialog**

```typescript
// src/components/bulk-actions/BulkTagDialog.tsx
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTags } from "@/hooks/useTags";
import { useBulkUpdateTags } from "@/hooks/useBulkActions";
import { cn } from "@/lib/utils";

interface BulkTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  onSuccess: () => void;
}

export function BulkTagDialog({
  open,
  onOpenChange,
  leadIds,
  onSuccess,
}: BulkTagDialogProps) {
  const [addIds, setAddIds] = useState<Set<string>>(new Set());
  const [removeIds, setRemoveIds] = useState<Set<string>>(new Set());
  const { data: tags = [] } = useTags();
  const mutation = useBulkUpdateTags();

  const toggleTag = (
    id: string,
    set: Set<string>,
    setter: (s: Set<string>) => void
  ) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const handleSubmit = () => {
    if (addIds.size === 0 && removeIds.size === 0) return;
    mutation.mutate(
      {
        leadIds,
        addTagIds: Array.from(addIds),
        removeTagIds: Array.from(removeIds),
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setAddIds(new Set());
          setRemoveIds(new Set());
          onSuccess();
        },
      }
    );
  };

  const renderTagGrid = (
    selectedSet: Set<string>,
    toggle: (id: string) => void
  ) => (
    <div className="flex flex-wrap gap-2 pt-2">
      {tags.map((tag: any) => (
        <Badge
          key={tag.id}
          variant={selectedSet.has(tag.id) ? "default" : "outline"}
          className={cn(
            "cursor-pointer transition-colors",
            selectedSet.has(tag.id) && "ring-2 ring-primary"
          )}
          style={
            selectedSet.has(tag.id)
              ? { backgroundColor: tag.color, color: "#fff" }
              : {}
          }
          onClick={() => toggle(tag.id)}
        >
          {tag.color && (
            <span
              className="mr-1.5 h-2 w-2 rounded-full inline-block"
              style={{ backgroundColor: tag.color }}
            />
          )}
          {tag.name}
        </Badge>
      ))}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tags — {leadIds.length} leads</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="add">
          <TabsList className="w-full">
            <TabsTrigger value="add" className="flex-1">
              Adicionar
            </TabsTrigger>
            <TabsTrigger value="remove" className="flex-1">
              Remover
            </TabsTrigger>
          </TabsList>
          <TabsContent value="add">
            {renderTagGrid(addIds, (id) => toggleTag(id, addIds, setAddIds))}
          </TabsContent>
          <TabsContent value="remove">
            {renderTagGrid(removeIds, (id) =>
              toggleTag(id, removeIds, setRemoveIds)
            )}
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              (addIds.size === 0 && removeIds.size === 0) || mutation.isPending
            }
          >
            {mutation.isPending ? "Atualizando..." : "Aplicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: BulkDeleteDialog**

```typescript
// src/components/bulk-actions/BulkDeleteDialog.tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useBulkDeleteLeads } from "@/hooks/useBulkActions";

interface BulkDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  onSuccess: () => void;
}

export function BulkDeleteDialog({
  open,
  onOpenChange,
  leadIds,
  onSuccess,
}: BulkDeleteDialogProps) {
  const mutation = useBulkDeleteLeads();

  const handleDelete = () => {
    mutation.mutate(leadIds, {
      onSuccess: () => {
        onOpenChange(false);
        onSuccess();
      },
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Excluir {leadIds.length} leads?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Esta ação é irreversível. Todos os dados relacionados (pipes, tags,
            histórico, follow-ups, conversas) serão excluídos permanentemente.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleDelete}
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? "Excluindo..."
              : `Excluir ${leadIds.length} leads`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/bulk-actions/
git commit -m "feat(bulk): add move, assign, tag, and delete dialog components"
```

---

## Task 6: Integrate into Leads Table Page

**Files:**
- Modify: `src/pages/Leads.tsx`

- [ ] **Step 1: Add imports and selection hook at top of component**

Add these imports:
```typescript
import { Checkbox } from "@/components/ui/checkbox";
import { useBulkSelection } from "@/hooks/useBulkSelection";
import { BulkActionBar } from "@/components/bulk-actions/BulkActionBar";
import { BulkMoveStageDialog } from "@/components/bulk-actions/BulkMoveStageDialog";
import { BulkAssignDialog } from "@/components/bulk-actions/BulkAssignDialog";
import { BulkTagDialog } from "@/components/bulk-actions/BulkTagDialog";
import { BulkDeleteDialog } from "@/components/bulk-actions/BulkDeleteDialog";
import { usePipelineStages } from "@/hooks/usePipelineStages";
```

Inside the Leads component, add:
```typescript
const selection = useBulkSelection();
const [bulkDialog, setBulkDialog] = useState<"move" | "assign" | "tag" | "delete" | null>(null);
const { data: whatsappStages = [] } = usePipelineStages("whatsapp");

// Visible lead IDs for select-all
const visibleLeadIds = (leads || []).map((l: any) => l.id);

// Escape key clears selection
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === "Escape" && selection.hasSelection) {
      selection.clearSelection();
    }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, [selection]);
```

- [ ] **Step 2: Add checkbox column to table header**

In the `<TableHeader>` row, add as first `<TableHead>`:
```tsx
<TableHead className="w-10">
  <Checkbox
    checked={
      visibleLeadIds.length > 0 &&
      visibleLeadIds.every((id: string) => selection.isSelected(id))
    }
    onCheckedChange={() => selection.selectAll(visibleLeadIds)}
  />
</TableHead>
```

- [ ] **Step 3: Add checkbox to each table row**

In each `<TableRow>`, add as first `<TableCell>`:
```tsx
<TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
  <Checkbox
    checked={selection.isSelected(lead.id)}
    onCheckedChange={() => {
      if ((window.event as KeyboardEvent)?.shiftKey) {
        selection.toggleRange(lead.id, visibleLeadIds);
      } else {
        selection.toggle(lead.id);
      }
    }}
  />
</TableCell>
```

Add selected row highlight:
```tsx
<TableRow
  className={cn(
    "cursor-pointer",
    selection.isSelected(lead.id) && "bg-primary/5"
  )}
  // ... existing onClick
>
```

- [ ] **Step 4: Add BulkActionBar and dialogs to page JSX (before closing fragment)**

```tsx
<BulkActionBar
  count={selection.count}
  onClear={selection.clearSelection}
  onMoveStage={() => setBulkDialog("move")}
  onAssign={() => setBulkDialog("assign")}
  onTag={() => setBulkDialog("tag")}
  onDelete={() => setBulkDialog("delete")}
/>

<BulkMoveStageDialog
  open={bulkDialog === "move"}
  onOpenChange={(open) => !open && setBulkDialog(null)}
  leadIds={selection.selectedArray}
  pipeType="whatsapp"
  stages={whatsappStages}
  onSuccess={selection.clearSelection}
/>

<BulkAssignDialog
  open={bulkDialog === "assign"}
  onOpenChange={(open) => !open && setBulkDialog(null)}
  leadIds={selection.selectedArray}
  onSuccess={selection.clearSelection}
/>

<BulkTagDialog
  open={bulkDialog === "tag"}
  onOpenChange={(open) => !open && setBulkDialog(null)}
  leadIds={selection.selectedArray}
  onSuccess={selection.clearSelection}
/>

<BulkDeleteDialog
  open={bulkDialog === "delete"}
  onOpenChange={(open) => !open && setBulkDialog(null)}
  leadIds={selection.selectedArray}
  onSuccess={selection.clearSelection}
/>
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/Leads.tsx
git commit -m "feat(bulk): integrate bulk selection and actions into Leads table page"
```

---

## Task 7: Add Selection to KanbanCard

**Files:**
- Modify: `src/components/kanban/KanbanCard.tsx`

- [ ] **Step 1: Extend KanbanCard props**

Add to the `KanbanCardProps` interface:
```typescript
interface KanbanCardProps {
  lead: Lead;
  onClick?: () => void;
  selectable?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string, shiftKey: boolean) => void;
}
```

- [ ] **Step 2: Add Checkbox overlay to card**

Import `Checkbox` and add at the top of the card (inside the outer div, before tag bars):
```tsx
import { Checkbox } from "@/components/ui/checkbox";

// Inside the component, before existing content:
{selectable && (
  <div
    className={cn(
      "absolute top-2 left-2 z-10 transition-opacity",
      isSelected || "opacity-0 group-hover:opacity-100"
    )}
    onClick={(e) => e.stopPropagation()}
  >
    <Checkbox
      checked={isSelected}
      onCheckedChange={() =>
        onToggleSelect?.(lead.id || lead.leadId || "", e.shiftKey)
      }
    />
  </div>
)}
```

Add `group` and selected styling to the card's outer div className:
```tsx
className={cn(
  "group relative rounded-lg border bg-card p-3 ...",
  isSelected && "ring-2 ring-primary bg-primary/5"
)}
```

- [ ] **Step 3: When selectable and selected, clicking card body toggles selection instead of opening drawer**

Modify the card's `onClick`:
```tsx
onClick={() => {
  if (selectable && selection has items) {
    onToggleSelect?.(lead.id || lead.leadId || "", false);
  } else {
    onClick?.();
  }
}}
```

More precisely — wrap the existing `onClick` at the outer card div:
```tsx
onClick={(e) => {
  if (selectable && isSelected) {
    onToggleSelect?.(lead.id || lead.leadId || "", e.shiftKey);
    return;
  }
  onClick?.();
}}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/kanban/KanbanCard.tsx
git commit -m "feat(bulk): add selection checkbox overlay to KanbanCard"
```

---

## Task 8: Integrate Bulk Actions into Pipe Pages

**Files:**
- Modify: `src/pages/PipeWhatsapp.tsx`
- Modify: `src/pages/PipeConfirmacao.tsx`
- Modify: `src/pages/PipePropostas.tsx`
- Modify: `src/pages/CustomPipeline.tsx`

The pattern is identical for all 4 pages. For each page:

- [ ] **Step 1: Add imports and hook to PipeWhatsapp.tsx**

```typescript
import { useBulkSelection } from "@/hooks/useBulkSelection";
import { BulkActionBar } from "@/components/bulk-actions/BulkActionBar";
import { BulkMoveStageDialog } from "@/components/bulk-actions/BulkMoveStageDialog";
import { BulkAssignDialog } from "@/components/bulk-actions/BulkAssignDialog";
import { BulkTagDialog } from "@/components/bulk-actions/BulkTagDialog";
import { BulkDeleteDialog } from "@/components/bulk-actions/BulkDeleteDialog";
```

Inside the component:
```typescript
const selection = useBulkSelection();
const [bulkDialog, setBulkDialog] = useState<"move" | "assign" | "tag" | "delete" | null>(null);

// Escape clears selection
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === "Escape" && selection.hasSelection) selection.clearSelection();
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, [selection]);
```

- [ ] **Step 2: Pass selection props through renderCard in PipeWhatsapp.tsx**

In the `renderCard` function (or where `KanbanCard` is rendered), pass:
```tsx
renderCard={(item, isDragging) => (
  <KanbanCard
    lead={mapToKanbanLead(item)}
    onClick={() => openDrawer(item)}
    selectable
    isSelected={selection.isSelected(item.lead_id)}
    onToggleSelect={(id, shiftKey) => {
      const allIds = columns.flatMap((c) => c.items.map((i) => i.lead_id));
      if (shiftKey) selection.toggleRange(id, allIds);
      else selection.toggle(id);
    }}
  />
)}
```

- [ ] **Step 3: Add BulkActionBar + dialogs to PipeWhatsapp.tsx JSX**

```tsx
<BulkActionBar
  count={selection.count}
  onClear={selection.clearSelection}
  onMoveStage={() => setBulkDialog("move")}
  onAssign={() => setBulkDialog("assign")}
  onTag={() => setBulkDialog("tag")}
  onDelete={() => setBulkDialog("delete")}
/>

<BulkMoveStageDialog
  open={bulkDialog === "move"}
  onOpenChange={(open) => !open && setBulkDialog(null)}
  leadIds={selection.selectedArray}
  pipeType="whatsapp"
  stages={stages}
  onSuccess={selection.clearSelection}
/>

<BulkAssignDialog
  open={bulkDialog === "assign"}
  onOpenChange={(open) => !open && setBulkDialog(null)}
  leadIds={selection.selectedArray}
  onSuccess={selection.clearSelection}
/>

<BulkTagDialog
  open={bulkDialog === "tag"}
  onOpenChange={(open) => !open && setBulkDialog(null)}
  leadIds={selection.selectedArray}
  onSuccess={selection.clearSelection}
/>

<BulkDeleteDialog
  open={bulkDialog === "delete"}
  onOpenChange={(open) => !open && setBulkDialog(null)}
  leadIds={selection.selectedArray}
  onSuccess={selection.clearSelection}
/>
```

- [ ] **Step 4: Commit PipeWhatsapp**

```bash
git add src/pages/PipeWhatsapp.tsx
git commit -m "feat(bulk): integrate bulk actions into PipeWhatsapp kanban"
```

- [ ] **Step 5: Repeat steps 1-3 for PipeConfirmacao.tsx**

Same pattern. Only difference: `pipeType="confirmacao"` in BulkMoveStageDialog, and use confirmacao stages.

```bash
git add src/pages/PipeConfirmacao.tsx
git commit -m "feat(bulk): integrate bulk actions into PipeConfirmacao kanban"
```

- [ ] **Step 6: Repeat steps 1-3 for PipePropostas.tsx**

Same pattern. `pipeType="propostas"`, propostas stages.

```bash
git add src/pages/PipePropostas.tsx
git commit -m "feat(bulk): integrate bulk actions into PipePropostas kanban"
```

- [ ] **Step 7: Repeat steps 1-3 for CustomPipeline.tsx**

Same pattern. `pipeType="custom"`, pass `pipelineId={pipeline.id}`, use custom stages from `useCustomPipelineStages()`.

```bash
git add src/pages/CustomPipeline.tsx
git commit -m "feat(bulk): integrate bulk actions into CustomPipeline kanban"
```

---

## Task 9: Keyboard Shortcut — Escape to Clear

Already handled in Task 6 (Leads) and Task 8 (Pipes) via the `useEffect` keydown listener. No additional work needed — this task is complete by virtue of Tasks 6 and 8.

---

## Task 10: Build Verification and Final Test

**Files:** None (verification only)

- [ ] **Step 1: Run all unit tests**

```bash
npm run test:unit
```
Expected: All new tests pass. Pre-existing failures unchanged.

- [ ] **Step 2: Run build**

```bash
npm run build
```
Expected: Build succeeds with no new type errors.

- [ ] **Step 3: Run lint**

```bash
npm run lint 2>&1 | head -30
```
Expected: No new lint errors from our files.

- [ ] **Step 4: Manual verification checklist**

Start dev server (`npm run dev`) and verify:

1. **Leads page table:**
   - [ ] Checkbox column visible on left
   - [ ] Header checkbox toggles all visible leads
   - [ ] Click checkbox selects row (row highlights)
   - [ ] Shift+click selects range
   - [ ] BulkActionBar appears at bottom with count
   - [ ] Escape clears selection
   - [ ] "Mover" opens stage dialog → submit works
   - [ ] "Atribuir" opens assign dialog → pre_sale + sale dropdowns → submit works
   - [ ] "Tags" opens tag dialog → add/remove tabs → submit works
   - [ ] "Excluir" opens confirmation → confirm deletes → leads gone

2. **Pipe WhatsApp kanban:**
   - [ ] Checkbox appears on card hover (top-left)
   - [ ] Click checkbox selects card (ring highlight)
   - [ ] Drag still works via grip handle
   - [ ] BulkActionBar appears with count
   - [ ] All 4 actions work

3. **Pipe Confirmação kanban:** Same checks as WhatsApp
4. **Pipe Propostas kanban:** Same checks as WhatsApp
5. **Custom Pipeline kanban:** Same checks as WhatsApp

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(bulk): address issues found during manual testing"
```
