# Saved Views / Smart Filters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users save, load, share, and manage named filter combinations across Leads and all pipe pages, with URL sync.

**Architecture:** New `saved_views` table stores filter state JSON per entity type. A reusable `SavedViewsDropdown` component sits next to each page's filter button. When a view is selected, its stored filters overwrite the page's `usePersistedState` filter state. URL param `?view=<id>` deep-links to a specific view. System default views are seeded per entity type with a `__me__` placeholder for the current user's responsible filter.

**Tech Stack:** Supabase (Postgres + RLS), React 18, TanStack Query v5, react-router-dom v6 (`useSearchParams`), shadcn/ui (Popover, Command, Dialog), usePersistedState hook (existing)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260932000000_saved_views.sql` | Table, RLS, indexes, system defaults seed |
| `src/types/saved-views.ts` | TypeScript types for saved views |
| `src/hooks/useSavedViews.ts` | CRUD hook (list, create, update, delete) with TanStack Query |
| `src/components/saved-views/SavedViewsDropdown.tsx` | Reusable dropdown component (Popover + Command list) |
| `src/components/saved-views/SaveViewDialog.tsx` | Create/edit dialog |
| `tests/unit/saved-views.test.ts` | Unit tests for filter serialization helpers |
| `src/pages/Leads.tsx` | Integrate SavedViewsDropdown |
| `src/pages/PipeWhatsapp.tsx` | Integrate SavedViewsDropdown |
| `src/pages/PipeConfirmacao.tsx` | Integrate SavedViewsDropdown |
| `src/pages/PipePropostas.tsx` | Integrate SavedViewsDropdown |
| `src/components/custom-pipelines/CustomPipelineKanban.tsx` | Integrate SavedViewsDropdown |

---

### Task 1: Database Migration — saved_views table + RLS + system defaults

**Files:**
- Create: `supabase/migrations/20260932000000_saved_views.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- Saved Views — named filter presets per entity/page
-- ============================================================

BEGIN;

-- ── Table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  is_shared BOOLEAN NOT NULL DEFAULT false,
  is_system BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.saved_views IS 'Named filter presets for leads/pipe pages';
COMMENT ON COLUMN public.saved_views.entity_type IS 'Target page: leads, whatsapp, confirmacao, propostas, custom:<pipeline_id>';
COMMENT ON COLUMN public.saved_views.filters IS 'JSON blob matching the page filter state shape. __me__ placeholder = current user team_member_id';
COMMENT ON COLUMN public.saved_views.is_system IS 'System-seeded defaults, not deletable by users';

-- ── Indexes ───────────────────────────────────────────────
CREATE INDEX idx_saved_views_org_entity
  ON public.saved_views (organization_id, entity_type);

CREATE INDEX idx_saved_views_owner
  ON public.saved_views (owner_id);

-- ── RLS ───────────────────────────────────────────────────
ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;

-- Read: own views + shared views in same org
CREATE POLICY saved_views_select ON public.saved_views
  FOR SELECT USING (
    organization_id = public.get_user_organization_id()
    AND (owner_id = auth.uid() OR is_shared = true)
  );

-- Insert: own org only
CREATE POLICY saved_views_insert ON public.saved_views
  FOR INSERT WITH CHECK (
    organization_id = public.get_user_organization_id()
    AND owner_id = auth.uid()
  );

-- Update: own views only
CREATE POLICY saved_views_update ON public.saved_views
  FOR UPDATE USING (
    organization_id = public.get_user_organization_id()
    AND owner_id = auth.uid()
  );

-- Delete: own non-system views only
CREATE POLICY saved_views_delete ON public.saved_views
  FOR DELETE USING (
    organization_id = public.get_user_organization_id()
    AND owner_id = auth.uid()
    AND is_system = false
  );

-- ── Grants ────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_views TO authenticated;

-- ── Updated_at trigger ────────────────────────────────────
CREATE TRIGGER set_saved_views_updated_at
  BEFORE UPDATE ON public.saved_views
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

COMMIT;
```

- [ ] **Step 2: Verify migration syntax locally**

Run: `npx supabase db diff --local 2>&1 | head -20`
Expected: No errors (or clean diff output)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260932000000_saved_views.sql
git commit -m "feat(db): add saved_views table with RLS"
```

---

### Task 2: TypeScript Types

**Files:**
- Create: `src/types/saved-views.ts`

- [ ] **Step 1: Create types file**

```typescript
export interface SavedView {
  id: string;
  organization_id: string;
  owner_id: string;
  name: string;
  entity_type: string;
  filters: Record<string, unknown>;
  is_shared: boolean;
  is_system: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface SavedViewInsert {
  name: string;
  entity_type: string;
  filters: Record<string, unknown>;
  is_shared?: boolean;
  position?: number;
}

export interface SavedViewUpdate {
  name?: string;
  filters?: Record<string, unknown>;
  is_shared?: boolean;
  position?: number;
}

export const ME_PLACEHOLDER = "__me__";

export function resolveFilters<T extends Record<string, unknown>>(
  filters: T,
  currentUserId: string | null
): T {
  const resolved = { ...filters };
  for (const [key, value] of Object.entries(resolved)) {
    if (value === ME_PLACEHOLDER && currentUserId) {
      (resolved as Record<string, unknown>)[key] = currentUserId;
    }
  }
  return resolved;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/saved-views.ts
git commit -m "feat(views): add SavedView types and resolveFilters helper"
```

---

### Task 3: useSavedViews Hook — CRUD with TanStack Query

**Files:**
- Create: `src/hooks/useSavedViews.ts`
- Test: `tests/unit/saved-views.test.ts`

- [ ] **Step 1: Write tests for resolveFilters**

```typescript
import { describe, it, expect } from "vitest";
import { resolveFilters, ME_PLACEHOLDER } from "@/types/saved-views";

describe("resolveFilters", () => {
  it("replaces __me__ placeholder with current user ID", () => {
    const filters = { filterResponsible: ME_PLACEHOLDER, filterOrigin: "all" };
    const resolved = resolveFilters(filters, "user-123");
    expect(resolved.filterResponsible).toBe("user-123");
    expect(resolved.filterOrigin).toBe("all");
  });

  it("leaves filters unchanged when no placeholder", () => {
    const filters = { filterOrigin: "meta_ads", filterTags: ["tag-1"] };
    const resolved = resolveFilters(filters, "user-123");
    expect(resolved).toEqual(filters);
  });

  it("leaves __me__ unchanged when currentUserId is null", () => {
    const filters = { filterResponsible: ME_PLACEHOLDER };
    const resolved = resolveFilters(filters, null);
    expect(resolved.filterResponsible).toBe(ME_PLACEHOLDER);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/saved-views.test.ts`
Expected: PASS (resolveFilters already implemented in types file)

- [ ] **Step 3: Write the hook**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import type { SavedView, SavedViewInsert, SavedViewUpdate } from "@/types/saved-views";

export function useSavedViews(entityType: string) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["saved_views", organizationId, entityType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_views" as any)
        .select("*")
        .eq("entity_type", entityType)
        .order("is_system", { ascending: false })
        .order("position", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as SavedView[];
    },
    enabled: !!organizationId && !!entityType,
  });
}

export function useCreateSavedView() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (input: SavedViewInsert) => {
      const { data, error } = await supabase
        .from("saved_views" as any)
        .insert({
          ...input,
          organization_id: organizationId,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as SavedView;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["saved_views", organizationId, variables.entity_type],
      });
    },
  });
}

export function useUpdateSavedView() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({
      id,
      entityType,
      ...updates
    }: SavedViewUpdate & { id: string; entityType: string }) => {
      const { data, error } = await supabase
        .from("saved_views" as any)
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as SavedView;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["saved_views", organizationId, variables.entityType],
      });
    },
  });
}

export function useDeleteSavedView() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({
      id,
      entityType,
    }: {
      id: string;
      entityType: string;
    }) => {
      const { error } = await supabase
        .from("saved_views" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["saved_views", organizationId, variables.entityType],
      });
    },
  });
}
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSavedViews.ts tests/unit/saved-views.test.ts
git commit -m "feat(views): add useSavedViews CRUD hook + resolveFilters tests"
```

---

### Task 4: SaveViewDialog Component

**Files:**
- Create: `src/components/saved-views/SaveViewDialog.tsx`

- [ ] **Step 1: Create the dialog**

```tsx
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCreateSavedView, useUpdateSavedView } from "@/hooks/useSavedViews";
import type { SavedView } from "@/types/saved-views";
import { toast } from "sonner";

interface SaveViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: string;
  currentFilters: Record<string, unknown>;
  editingView?: SavedView | null;
}

export function SaveViewDialog({
  open,
  onOpenChange,
  entityType,
  currentFilters,
  editingView,
}: SaveViewDialogProps) {
  const [name, setName] = useState("");
  const [isShared, setIsShared] = useState(false);
  const createView = useCreateSavedView();
  const updateView = useUpdateSavedView();

  useEffect(() => {
    if (open && editingView) {
      setName(editingView.name);
      setIsShared(editingView.is_shared);
    } else if (open) {
      setName("");
      setIsShared(false);
    }
  }, [open, editingView]);

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      if (editingView) {
        await updateView.mutateAsync({
          id: editingView.id,
          entityType,
          name: name.trim(),
          filters: currentFilters,
          is_shared: isShared,
        });
        toast.success("View atualizada");
      } else {
        await createView.mutateAsync({
          name: name.trim(),
          entity_type: entityType,
          filters: currentFilters,
          is_shared: isShared,
        });
        toast.success("View criada");
      }
      onOpenChange(false);
    } catch {
      toast.error("Erro ao salvar view");
    }
  };

  const isPending = createView.isPending || updateView.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>
            {editingView ? "Editar View" : "Salvar View"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="view-name">Nome</Label>
            <Input
              id="view-name"
              placeholder="Ex: Meus leads quentes"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) handleSave();
              }}
              autoFocus
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="view-shared">Compartilhar com time</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Todos da organização poderão ver esta view
              </p>
            </div>
            <Switch
              id="view-shared"
              checked={isShared}
              onCheckedChange={setIsShared}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || isPending}>
            {isPending ? "Salvando..." : editingView ? "Atualizar" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/saved-views/SaveViewDialog.tsx
git commit -m "feat(views): add SaveViewDialog create/edit component"
```

---

### Task 5: SavedViewsDropdown Component

**Files:**
- Create: `src/components/saved-views/SavedViewsDropdown.tsx`

- [ ] **Step 1: Create the dropdown**

This is the main reusable component. It sits next to the filter button in each page. Uses Popover + a simple list (no Command needed for small lists).

```tsx
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bookmark, ChevronDown, MoreHorizontal, Pencil, Trash2, Share2, Plus, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useSavedViews, useDeleteSavedView } from "@/hooks/useSavedViews";
import { useOrganization } from "@/hooks/useOrganization";
import { resolveFilters } from "@/types/saved-views";
import { SaveViewDialog } from "./SaveViewDialog";
import type { SavedView } from "@/types/saved-views";
import { toast } from "sonner";

interface SavedViewsDropdownProps<T extends Record<string, unknown>> {
  entityType: string;
  currentFilters: T;
  defaultFilters: T;
  onApplyFilters: (filters: T) => void;
  activeViewId: string | null;
  onActiveViewChange: (viewId: string | null) => void;
}

export function SavedViewsDropdown<T extends Record<string, unknown>>({
  entityType,
  currentFilters,
  defaultFilters,
  onApplyFilters,
  activeViewId,
  onActiveViewChange,
}: SavedViewsDropdownProps<T>) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [editingView, setEditingView] = useState<SavedView | null>(null);

  const { data: views = [] } = useSavedViews(entityType);
  const deleteView = useDeleteSavedView();
  const { teamMemberId } = useOrganization();

  const activeView = activeViewId
    ? views.find((v) => v.id === activeViewId) ?? null
    : null;

  const filtersChanged =
    JSON.stringify(currentFilters) !== JSON.stringify(defaultFilters);

  const handleSelectView = (view: SavedView) => {
    const resolved = resolveFilters(
      view.filters as T,
      teamMemberId ?? null
    );
    const merged = { ...defaultFilters, ...resolved };
    onApplyFilters(merged);
    onActiveViewChange(view.id);
    setPopoverOpen(false);
  };

  const handleClearView = () => {
    onApplyFilters(defaultFilters);
    onActiveViewChange(null);
    setPopoverOpen(false);
  };

  const handleDelete = async (view: SavedView) => {
    try {
      await deleteView.mutateAsync({ id: view.id, entityType });
      if (activeViewId === view.id) {
        onApplyFilters(defaultFilters);
        onActiveViewChange(null);
      }
      toast.success("View excluída");
    } catch {
      toast.error("Erro ao excluir view");
    }
  };

  const handleEdit = (view: SavedView) => {
    setEditingView(view);
    setSaveDialogOpen(true);
    setPopoverOpen(false);
  };

  const systemViews = views.filter((v) => v.is_system);
  const userViews = views.filter((v) => !v.is_system);

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "gap-1.5",
              activeView && "border-primary/50 bg-primary/5 text-primary"
            )}
          >
            <Bookmark className="w-4 h-4" />
            {activeView ? activeView.name : "Views"}
            <ChevronDown className="w-3 h-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          {/* Save current filters */}
          {filtersChanged && !activeView && (
            <>
              <div className="p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 text-primary"
                  onClick={() => {
                    setSaveDialogOpen(true);
                    setPopoverOpen(false);
                  }}
                >
                  <Plus className="w-4 h-4" />
                  Salvar filtros atuais como view
                </Button>
              </div>
              <Separator />
            </>
          )}

          {/* Active view indicator */}
          {activeView && (
            <>
              <div className="p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 text-muted-foreground"
                  onClick={handleClearView}
                >
                  <Eye className="w-4 h-4" />
                  Limpar view ativa
                </Button>
              </div>
              <Separator />
            </>
          )}

          {/* System views */}
          {systemViews.length > 0 && (
            <div className="p-1">
              <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Padrão
              </p>
              {systemViews.map((view) => (
                <ViewItem
                  key={view.id}
                  view={view}
                  isActive={activeViewId === view.id}
                  onSelect={handleSelectView}
                  onEdit={null}
                  onDelete={null}
                />
              ))}
            </div>
          )}

          {/* User views */}
          {userViews.length > 0 && (
            <>
              {systemViews.length > 0 && <Separator />}
              <div className="p-1">
                <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Minhas Views
                </p>
                {userViews.map((view) => (
                  <ViewItem
                    key={view.id}
                    view={view}
                    isActive={activeViewId === view.id}
                    onSelect={handleSelectView}
                    onEdit={() => handleEdit(view)}
                    onDelete={() => handleDelete(view)}
                  />
                ))}
              </div>
            </>
          )}

          {views.length === 0 && !filtersChanged && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Nenhuma view salva.
              <br />
              Aplique filtros e salve como view.
            </div>
          )}

          {/* Create new */}
          <Separator />
          <div className="p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => {
                setSaveDialogOpen(true);
                setPopoverOpen(false);
              }}
            >
              <Plus className="w-4 h-4" />
              Nova view
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <SaveViewDialog
        open={saveDialogOpen}
        onOpenChange={(open) => {
          setSaveDialogOpen(open);
          if (!open) setEditingView(null);
        }}
        entityType={entityType}
        currentFilters={currentFilters}
        editingView={editingView}
      />
    </>
  );
}

function ViewItem({
  view,
  isActive,
  onSelect,
  onEdit,
  onDelete,
}: {
  view: SavedView;
  isActive: boolean;
  onSelect: (view: SavedView) => void;
  onEdit: (() => void) | null;
  onDelete: (() => void) | null;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors group",
        "hover:bg-muted/50",
        isActive && "bg-primary/10 text-primary"
      )}
      onClick={() => onSelect(view)}
    >
      <Bookmark
        className={cn(
          "w-3.5 h-3.5 shrink-0",
          isActive ? "text-primary" : "text-muted-foreground"
        )}
      />
      <span className="text-sm flex-1 truncate">{view.name}</span>
      {view.is_shared && (
        <Share2 className="w-3 h-3 text-muted-foreground shrink-0" />
      )}
      {(onEdit || onDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger
            asChild
            onClick={(e) => e.stopPropagation()}
          >
            <button className="p-0.5 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity">
              <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            {onEdit && (
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="w-3.5 h-3.5 mr-2" />
                Editar
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                Excluir
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/saved-views/SavedViewsDropdown.tsx
git commit -m "feat(views): add SavedViewsDropdown reusable component"
```

---

### Task 6: Integrate into Leads.tsx

**Files:**
- Modify: `src/pages/Leads.tsx`

The Leads page currently has simple filter state: `{ searchQuery, filterOrigin, filterRating }`. We need to:
1. Add SavedViewsDropdown import
2. Add `activeViewId` state (not persisted — derived from URL or ephemeral)
3. Add `useSearchParams` for URL sync
4. Place dropdown next to filters

- [ ] **Step 1: Add imports**

At the top of the file, add:
```typescript
import { useSearchParams } from "react-router-dom";
import { SavedViewsDropdown } from "@/components/saved-views/SavedViewsDropdown";
```

- [ ] **Step 2: Add URL sync state**

Inside the component function, after the `usePersistedState` call (line ~187-190):

```typescript
const [searchParams, setSearchParams] = useSearchParams();
const [activeViewId, setActiveViewId] = useState<string | null>(
  searchParams.get("view")
);

const handleActiveViewChange = useCallback((viewId: string | null) => {
  setActiveViewId(viewId);
  setSearchParams((prev) => {
    if (viewId) {
      prev.set("view", viewId);
    } else {
      prev.delete("view");
    }
    return prev;
  }, { replace: true });
}, [setSearchParams]);
```

- [ ] **Step 3: Add dropdown to the toolbar**

Find the filter area in Leads.tsx. The Leads page has its own filter UI (not KanbanFilterPanel). Look for the search Input and filter Selects. Add the SavedViewsDropdown next to them.

The exact location depends on the page layout. In Leads.tsx, find the row with the search Input and filter controls, and add after the last filter:

```tsx
<SavedViewsDropdown
  entityType="leads"
  currentFilters={filterState}
  defaultFilters={DEFAULT_LEADS_FILTERS}
  onApplyFilters={(filters) => setFilterState(filters)}
  activeViewId={activeViewId}
  onActiveViewChange={handleActiveViewChange}
/>
```

Note: `setFilterState` comes from `usePersistedState` — it accepts the new filter object. The `onApplyFilters` callback replaces the entire filter state with the view's saved filters (merged with defaults).

- [ ] **Step 4: Run type check and build**

Run: `npx tsc --noEmit && npm run build 2>&1 | tail -5`
Expected: No errors, build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/pages/Leads.tsx
git commit -m "feat(views): integrate SavedViewsDropdown into Leads page"
```

---

### Task 7: Integrate into PipeWhatsapp.tsx

**Files:**
- Modify: `src/pages/PipeWhatsapp.tsx`

PipeWhatsapp has filter state: `{ searchTerm, filterResponsible, filterOrigin, filterTags, filterScheduled }`.

- [ ] **Step 1: Add imports**

```typescript
import { useSearchParams } from "react-router-dom";
import { SavedViewsDropdown } from "@/components/saved-views/SavedViewsDropdown";
```

- [ ] **Step 2: Add URL sync state**

After the `usePersistedState` call (line ~88-93):

```typescript
const [searchParams, setSearchParams] = useSearchParams();
const [activeViewId, setActiveViewId] = useState<string | null>(
  searchParams.get("view")
);

const handleActiveViewChange = useCallback((viewId: string | null) => {
  setActiveViewId(viewId);
  setSearchParams((prev) => {
    if (viewId) {
      prev.set("view", viewId);
    } else {
      prev.delete("view");
    }
    return prev;
  }, { replace: true });
}, [setSearchParams]);
```

- [ ] **Step 3: Add dropdown to the filter toolbar**

Find the filter bar (line ~458-476). Add SavedViewsDropdown next to KanbanFilterPanel:

```tsx
<div className="flex items-center gap-3">
  <div className="relative flex-1 max-w-sm">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
    <Input
      placeholder="Buscar lead, empresa, telefone..."
      value={searchTerm}
      onChange={(e) => setSearchTerm(e.target.value)}
      className="pl-9"
    />
  </div>
  <SavedViewsDropdown
    entityType="whatsapp"
    currentFilters={filterState}
    defaultFilters={DEFAULT_WHATSAPP_FILTERS}
    onApplyFilters={(filters) => setFilterState(filters)}
    activeViewId={activeViewId}
    onActiveViewChange={handleActiveViewChange}
  />
  <KanbanFilterPanel
    sections={filterSections}
    onClearAll={handleClearAllFilters}
  />
</div>
```

The `DEFAULT_WHATSAPP_FILTERS` constant is defined near the top of the file (line ~71-77).

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/pages/PipeWhatsapp.tsx
git commit -m "feat(views): integrate SavedViewsDropdown into PipeWhatsapp"
```

---

### Task 8: Integrate into PipeConfirmacao.tsx

**Files:**
- Modify: `src/pages/PipeConfirmacao.tsx`

PipeConfirmacao has extended filter state with `viewMode`, `membroDefaultApplied`, and time-based filters.

- [ ] **Step 1: Add imports**

```typescript
import { useSearchParams } from "react-router-dom";
import { SavedViewsDropdown } from "@/components/saved-views/SavedViewsDropdown";
```

- [ ] **Step 2: Add URL sync state**

Same pattern as Tasks 6-7. Add after the `usePersistedState` call:

```typescript
const [searchParams, setSearchParams] = useSearchParams();
const [activeViewId, setActiveViewId] = useState<string | null>(
  searchParams.get("view")
);

const handleActiveViewChange = useCallback((viewId: string | null) => {
  setActiveViewId(viewId);
  setSearchParams((prev) => {
    if (viewId) {
      prev.set("view", viewId);
    } else {
      prev.delete("view");
    }
    return prev;
  }, { replace: true });
}, [setSearchParams]);
```

- [ ] **Step 3: Add dropdown to the filter toolbar**

Find the filter bar in PipeConfirmacao. Locate the search Input + KanbanFilterPanel section. Add SavedViewsDropdown between search and KanbanFilterPanel:

```tsx
<SavedViewsDropdown
  entityType="confirmacao"
  currentFilters={filterState}
  defaultFilters={DEFAULT_CONFIRMACAO_FILTERS}
  onApplyFilters={(filters) => setFilterState(filters)}
  activeViewId={activeViewId}
  onActiveViewChange={handleActiveViewChange}
/>
```

The `DEFAULT_CONFIRMACAO_FILTERS` constant name — find the actual name by searching for the default state object defined near the type definition (around line ~151-167).

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/pages/PipeConfirmacao.tsx
git commit -m "feat(views): integrate SavedViewsDropdown into PipeConfirmacao"
```

---

### Task 9: Integrate into PipePropostas.tsx

**Files:**
- Modify: `src/pages/PipePropostas.tsx`

Same pattern as previous tasks.

- [ ] **Step 1: Add imports**

```typescript
import { useSearchParams } from "react-router-dom";
import { SavedViewsDropdown } from "@/components/saved-views/SavedViewsDropdown";
```

- [ ] **Step 2: Add URL sync state**

Same pattern — after the `usePersistedState` call:

```typescript
const [searchParams, setSearchParams] = useSearchParams();
const [activeViewId, setActiveViewId] = useState<string | null>(
  searchParams.get("view")
);

const handleActiveViewChange = useCallback((viewId: string | null) => {
  setActiveViewId(viewId);
  setSearchParams((prev) => {
    if (viewId) {
      prev.set("view", viewId);
    } else {
      prev.delete("view");
    }
    return prev;
  }, { replace: true });
}, [setSearchParams]);
```

- [ ] **Step 3: Add dropdown to filter toolbar**

Find the filter bar section. Add between search and KanbanFilterPanel:

```tsx
<SavedViewsDropdown
  entityType="propostas"
  currentFilters={filterState}
  defaultFilters={DEFAULT_PROPOSTAS_FILTERS}
  onApplyFilters={(filters) => setFilterState(filters)}
  activeViewId={activeViewId}
  onActiveViewChange={handleActiveViewChange}
/>
```

Find the actual default filters constant name — likely `DEFAULT_PROPOSTAS_FILTERS` (around line ~132-145).

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/pages/PipePropostas.tsx
git commit -m "feat(views): integrate SavedViewsDropdown into PipePropostas"
```

---

### Task 10: Integrate into CustomPipeline

**Files:**
- Modify: `src/components/custom-pipelines/CustomPipelineKanban.tsx`
- Modify: `src/pages/CustomPipeline.tsx`

Custom pipelines have dynamic entity types (`custom:<pipeline_id>`). The filter state lives in CustomPipelineKanban which only has a `searchQuery` prop — it doesn't use `usePersistedState` or `KanbanFilterPanel`.

For custom pipelines, the integration is lighter: add SavedViewsDropdown to `CustomPipeline.tsx` (the parent page that has the search input) rather than the Kanban sub-component.

- [ ] **Step 1: Add imports to CustomPipeline.tsx**

```typescript
import { useSearchParams } from "react-router-dom";
import { useState, useCallback } from "react";
import { SavedViewsDropdown } from "@/components/saved-views/SavedViewsDropdown";
```

- [ ] **Step 2: Add filter state**

CustomPipeline.tsx currently only has `searchQuery` (useState). Wrap it in a filter state object for compatibility with SavedViewsDropdown:

```typescript
const [searchParams, setSearchParams] = useSearchParams();
const [activeViewId, setActiveViewId] = useState<string | null>(
  searchParams.get("view")
);

const customEntityType = pipeline ? `custom:${pipeline.id}` : "";

const currentFilters = useMemo(
  () => ({ searchQuery }),
  [searchQuery]
);
const defaultFilters = { searchQuery: "" };

const handleActiveViewChange = useCallback((viewId: string | null) => {
  setActiveViewId(viewId);
  setSearchParams((prev) => {
    if (viewId) {
      prev.set("view", viewId);
    } else {
      prev.delete("view");
    }
    return prev;
  }, { replace: true });
}, [setSearchParams]);

const handleApplyFilters = useCallback((filters: typeof defaultFilters) => {
  setSearchQuery(filters.searchQuery || "");
}, []);
```

- [ ] **Step 3: Add dropdown to toolbar**

Find the toolbar area in CustomPipeline.tsx where the search Input is. Add after it:

```tsx
{pipeline && (
  <SavedViewsDropdown
    entityType={customEntityType}
    currentFilters={currentFilters}
    defaultFilters={defaultFilters}
    onApplyFilters={handleApplyFilters}
    activeViewId={activeViewId}
    onActiveViewChange={handleActiveViewChange}
  />
)}
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/pages/CustomPipeline.tsx
git commit -m "feat(views): integrate SavedViewsDropdown into CustomPipeline"
```

---

### Task 11: URL Deep-Link — Load View on Page Mount

**Files:**
- Modify: `src/pages/Leads.tsx`
- Modify: `src/pages/PipeWhatsapp.tsx`
- Modify: `src/pages/PipeConfirmacao.tsx`
- Modify: `src/pages/PipePropostas.tsx`
- Modify: `src/pages/CustomPipeline.tsx`

When a page loads with `?view=<id>` in the URL, it should fetch and apply that view's filters.

- [ ] **Step 1: Create a shared hook for view-on-mount logic**

Create `src/hooks/useApplyViewFromUrl.ts`:

```typescript
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useSavedViews } from "./useSavedViews";
import { useOrganization } from "./useOrganization";
import { resolveFilters } from "@/types/saved-views";

export function useApplyViewFromUrl<T extends Record<string, unknown>>(
  entityType: string,
  defaultFilters: T,
  onApplyFilters: (filters: T) => void,
  onActiveViewChange: (viewId: string | null) => void
) {
  const [searchParams] = useSearchParams();
  const { teamMemberId } = useOrganization();
  const { data: views } = useSavedViews(entityType);
  const appliedRef = useRef(false);

  useEffect(() => {
    if (appliedRef.current || !views) return;
    const viewId = searchParams.get("view");
    if (!viewId) return;

    const view = views.find((v) => v.id === viewId);
    if (!view) return;

    appliedRef.current = true;
    const resolved = resolveFilters(
      view.filters as T,
      teamMemberId ?? null
    );
    onApplyFilters({ ...defaultFilters, ...resolved });
    onActiveViewChange(viewId);
  }, [views, searchParams, teamMemberId, defaultFilters, onApplyFilters, onActiveViewChange]);
}
```

- [ ] **Step 2: Wire into each page**

In each page (Leads.tsx, PipeWhatsapp.tsx, PipeConfirmacao.tsx, PipePropostas.tsx, CustomPipeline.tsx), after the SavedViewsDropdown-related state, add:

```typescript
useApplyViewFromUrl(
  entityType, // "leads" | "whatsapp" | "confirmacao" | "propostas" | customEntityType
  DEFAULT_FILTERS, // the page's default filter constant
  (filters) => setFilterState(filters), // or handleApplyFilters for CustomPipeline
  handleActiveViewChange
);
```

- [ ] **Step 3: Run type check and build**

Run: `npx tsc --noEmit && npm run build 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useApplyViewFromUrl.ts src/pages/Leads.tsx src/pages/PipeWhatsapp.tsx src/pages/PipeConfirmacao.tsx src/pages/PipePropostas.tsx src/pages/CustomPipeline.tsx
git commit -m "feat(views): add URL deep-link — auto-apply view from ?view= param"
```

---

### Task 12: Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run unit tests**

Run: `npx vitest run tests/unit/saved-views.test.ts`
Expected: All tests pass

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run production build**

Run: `npm run build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 4: Run full test suite**

Run: `npm run test:unit 2>&1 | tail -10`
Expected: All tests pass

- [ ] **Step 5: Manual verification checklist**

1. Open Leads page → Views dropdown shows "Views" button next to filters
2. Apply some filters → Views dropdown shows "Salvar filtros atuais como view"
3. Save a view → Toast "View criada" → View appears in dropdown
4. Click the saved view → Filters applied, dropdown shows view name
5. Click "Limpar view ativa" → Filters reset to defaults
6. Edit a view → Name/sharing updated
7. Delete a view → Removed from list
8. Navigate to `/leads?view=<id>` → View auto-applied on page load
9. Repeat steps 1-8 for PipeWhatsapp, PipeConfirmacao, PipePropostas
10. Open a custom pipeline → Views dropdown works with custom entity type
11. Share a view → Login as different user in same org → Shared view visible
12. Views are org-scoped → Different org cannot see the view
