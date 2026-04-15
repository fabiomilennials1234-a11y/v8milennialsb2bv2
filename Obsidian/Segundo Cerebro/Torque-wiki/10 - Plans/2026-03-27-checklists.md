---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/plans/2026-03-27-checklists.md
---

# Checklists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone checklist system to Torque CRM - new DB tables, hooks, UI components, sidebar entry, and routing - without touching follow-ups or acoes_do_dia.

**Architecture:** Two new Supabase tables (`checklists`, `checklist_items`) with RLS. One React Query hook file (`useChecklists.ts`) for all CRUD. Four new UI components under `src/components/checklists/`. One new page. Minimal edits to Sidebar, App.tsx, permissions, and Supabase types.

**Tech Stack:** Supabase (Postgres + RLS), React Query, React, shadcn/ui, Framer Motion, Lucide icons, Sonner toasts, TypeScript.

---

## File Structure

### New files:
- `supabase/migrations/20260327000000_create_checklists.sql` - DB tables, RLS, indexes, triggers
- `src/hooks/useChecklists.ts` - queries + mutations for checklists and items
- `src/pages/ChecklistPage.tsx` - main page at `/checklists`
- `src/components/checklists/ChecklistCard.tsx` - expandable card with progress
- `src/components/checklists/ChecklistItemRow.tsx` - single item row with checkbox
- `src/components/checklists/CreateChecklistDialog.tsx` - creation modal

### Modified files:
- `src/integrations/supabase/types.ts` - add `checklists` and `checklist_items` table types
- `src/hooks/useTeamMemberPermissions.ts` - add `"checklists"` to RESOURCE_KEYS and RESOURCE_LABELS
- `src/components/layout/Sidebar.tsx` - add nav item + permission mapping
- `src/App.tsx` - add lazy import + route

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260327000000_create_checklists.sql`

**IMPORTANT:** This migration must ONLY be applied to the develop database. After applying, generate a change report.

- [ ] **Step 1: Create the migration file**

```sql
-- Checklists: standalone task-list system (does NOT touch follow_ups or acoes_do_dia)
CREATE TABLE public.checklists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.team_members(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.checklist_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  checklist_id UUID NOT NULL REFERENCES public.checklists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Checklists visible to org members"
ON public.checklists FOR SELECT
USING (
  organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Org members can insert checklists"
ON public.checklists FOR INSERT
WITH CHECK (
  organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Org members can update checklists"
ON public.checklists FOR UPDATE
USING (
  organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Org members can delete checklists"
ON public.checklists FOR DELETE
USING (
  organization_id IN (
    SELECT tm.organization_id FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Checklist items visible via parent checklist"
ON public.checklist_items FOR SELECT
USING (
  checklist_id IN (
    SELECT c.id FROM public.checklists c
    JOIN public.team_members tm ON tm.organization_id = c.organization_id
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Org members can insert checklist items"
ON public.checklist_items FOR INSERT
WITH CHECK (
  checklist_id IN (
    SELECT c.id FROM public.checklists c
    JOIN public.team_members tm ON tm.organization_id = c.organization_id
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Org members can update checklist items"
ON public.checklist_items FOR UPDATE
USING (
  checklist_id IN (
    SELECT c.id FROM public.checklists c
    JOIN public.team_members tm ON tm.organization_id = c.organization_id
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Org members can delete checklist items"
ON public.checklist_items FOR DELETE
USING (
  checklist_id IN (
    SELECT c.id FROM public.checklists c
    JOIN public.team_members tm ON tm.organization_id = c.organization_id
    WHERE tm.user_id = auth.uid()
  )
);

-- Indexes
CREATE INDEX idx_checklists_organization_id ON public.checklists(organization_id);
CREATE INDEX idx_checklist_items_checklist_position ON public.checklist_items(checklist_id, position);

-- Triggers for updated_at
CREATE TRIGGER update_checklists_updated_at
BEFORE UPDATE ON public.checklists
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_checklist_items_updated_at
BEFORE UPDATE ON public.checklist_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

- [ ] **Step 2: Apply the migration to the develop database**

Run: `npx supabase db push --linked` (ensure `.env.development` is active and pointing to develop)

If using Supabase Dashboard directly, run the SQL in the SQL Editor against the **develop** project only.

- [ ] **Step 3: Generate DB change report**

Output a report listing:
- Tables created: `checklists`, `checklist_items`
- RLS policies created: 8 total (4 per table: SELECT, INSERT, UPDATE, DELETE)
- Indexes created: `idx_checklists_organization_id`, `idx_checklist_items_checklist_position`
- Triggers created: `update_checklists_updated_at`, `update_checklist_items_updated_at`
- Tables NOT touched: `follow_ups`, `follow_up_automations`, `acoes_do_dia`, `leads`, `team_members`, `organizations`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260327000000_create_checklists.sql
git commit -m "feat(checklists): add checklists and checklist_items tables with RLS"
```

---

### Task 2: Supabase Types

**Files:**
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Add `checklist_items` table types**

Add this inside `public.Tables` (alphabetical order - after `campaigns` entries, before `comissoes` or wherever `ch` falls alphabetically):

```typescript
      checklist_items: {
        Row: {
          id: string
          checklist_id: string
          title: string
          is_completed: boolean
          position: number
          completed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          checklist_id: string
          title: string
          is_completed?: boolean
          position?: number
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          checklist_id?: string
          title?: string
          is_completed?: boolean
          position?: number
          completed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 2: Add `checklists` table types**

Add this right after the `checklist_items` entry:

```typescript
      checklists: {
        Row: {
          id: string
          organization_id: string
          created_by: string
          title: string
          description: string | null
          lead_id: string | null
          is_completed: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          created_by: string
          title: string
          description?: string | null
          lead_id?: string | null
          is_completed?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          created_by?: string
          title?: string
          description?: string | null
          lead_id?: string | null
          is_completed?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklists_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No new errors related to checklists.

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "feat(checklists): add Supabase types for checklists and checklist_items"
```

---

### Task 3: Permissions

**Files:**
- Modify: `src/hooks/useTeamMemberPermissions.ts`

- [ ] **Step 1: Add `checklists` to RESOURCE_KEYS**

In `src/hooks/useTeamMemberPermissions.ts`, find line 9-19:

```typescript
export const RESOURCE_KEYS = [
  "leads",
  "contatos",
  "empresas",
  "tarefas",
  "produtos",
  "pipe_whatsapp",
  "pipe_confirmacao",
  "pipe_propostas",
  "campanhas",
] as const;
```

Replace with:

```typescript
export const RESOURCE_KEYS = [
  "leads",
  "contatos",
  "empresas",
  "tarefas",
  "produtos",
  "pipe_whatsapp",
  "pipe_confirmacao",
  "pipe_propostas",
  "campanhas",
  "checklists",
] as const;
```

- [ ] **Step 2: Add label for `checklists`**

In `RESOURCE_LABELS` (line 29-39), find:

```typescript
  campanhas: "Campanhas",
};
```

Replace with:

```typescript
  campanhas: "Campanhas",
  checklists: "Checklists",
};
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No errors - the `ResourceKey` type automatically derives from RESOURCE_KEYS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useTeamMemberPermissions.ts
git commit -m "feat(checklists): add checklists resource to permissions matrix"
```

---

### Task 4: Hook - useChecklists

**Files:**
- Create: `src/hooks/useChecklists.ts`

- [ ] **Step 1: Create the hook file**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { useRealtimeSubscription } from "./useRealtimeSubscription";
import { toast } from "sonner";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type Checklist = Tables<"checklists">;
export type ChecklistInsert = TablesInsert<"checklists">;
export type ChecklistUpdate = TablesUpdate<"checklists">;
export type ChecklistItem = Tables<"checklist_items">;
export type ChecklistItemInsert = TablesInsert<"checklist_items">;
export type ChecklistItemUpdate = TablesUpdate<"checklist_items">;

export interface ChecklistWithCounts extends Checklist {
  total_items: number;
  completed_items: number;
  lead?: { id: string; name: string } | null;
}

// ─── Queries ─────────────────────────────────────────────

export function useChecklists() {
  const { organizationId, isReady } = useOrganization();
  useRealtimeSubscription("checklists", ["checklists"]);

  return useQuery({
    queryKey: ["checklists", organizationId],
    queryFn: async (): Promise<ChecklistWithCounts[]> => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from("checklists")
        .select(`*, lead:leads(id, name), checklist_items(id, is_completed)`)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data ?? []).map((c: any) => {
        const items = c.checklist_items ?? [];
        return {
          ...c,
          checklist_items: undefined,
          total_items: items.length,
          completed_items: items.filter((i: any) => i.is_completed).length,
          lead: c.lead ?? null,
        };
      });
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useChecklistItems(checklistId: string | null) {
  useRealtimeSubscription("checklist_items", ["checklist_items"]);

  return useQuery({
    queryKey: ["checklist_items", checklistId],
    queryFn: async (): Promise<ChecklistItem[]> => {
      if (!checklistId) return [];

      const { data, error } = await supabase
        .from("checklist_items")
        .select("*")
        .eq("checklist_id", checklistId)
        .order("position", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!checklistId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

// ─── Checklist Mutations ─────────────────────────────────

export function useCreateChecklist() {
  const queryClient = useQueryClient();
  const { organizationId, teamMemberId } = useOrganization();

  return useMutation({
    mutationFn: async (input: { title: string; description?: string; lead_id?: string }) => {
      if (!organizationId || !teamMemberId) throw new Error("Organização não disponível");

      const { data, error } = await supabase
        .from("checklists")
        .insert({
          organization_id: organizationId,
          created_by: teamMemberId,
          title: input.title,
          description: input.description ?? null,
          lead_id: input.lead_id ?? null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
      toast.success("Checklist criado!");
    },
    onError: (error) => {
      toast.error("Erro ao criar checklist", { description: error.message });
    },
  });
}

export function useUpdateChecklist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; title?: string; description?: string; is_completed?: boolean }) => {
      const { data, error } = await supabase
        .from("checklists")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
    },
    onError: (error) => {
      toast.error("Erro ao atualizar checklist", { description: error.message });
    },
  });
}

export function useDeleteChecklist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("checklists").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
      toast.success("Checklist removido");
    },
    onError: (error) => {
      toast.error("Erro ao remover checklist", { description: error.message });
    },
  });
}

// ─── Item Mutations ──────────────────────────────────────

export function useCreateChecklistItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { checklist_id: string; title: string; position: number }) => {
      const { data, error } = await supabase
        .from("checklist_items")
        .insert({
          checklist_id: input.checklist_id,
          title: input.title,
          position: input.position,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist_items"] });
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
    },
    onError: (error) => {
      toast.error("Erro ao adicionar item", { description: error.message });
    },
  });
}

export function useToggleChecklistItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, is_completed }: { id: string; is_completed: boolean }) => {
      const { data, error } = await supabase
        .from("checklist_items")
        .update({
          is_completed,
          completed_at: is_completed ? new Date().toISOString() : null,
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist_items"] });
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
    },
    onError: (error) => {
      toast.error("Erro ao atualizar item", { description: error.message });
    },
  });
}

export function useUpdateChecklistItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const { data, error } = await supabase
        .from("checklist_items")
        .update({ title })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist_items"] });
    },
    onError: (error) => {
      toast.error("Erro ao editar item", { description: error.message });
    },
  });
}

export function useDeleteChecklistItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("checklist_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist_items"] });
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
    },
    onError: (error) => {
      toast.error("Erro ao remover item", { description: error.message });
    },
  });
}

export function useReorderChecklistItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (items: { id: string; position: number }[]) => {
      const updates = items.map(({ id, position }) =>
        supabase.from("checklist_items").update({ position }).eq("id", id)
      );
      const results = await Promise.all(updates);
      const firstError = results.find((r) => r.error);
      if (firstError?.error) throw firstError.error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist_items"] });
    },
    onError: (error) => {
      toast.error("Erro ao reordenar itens", { description: error.message });
    },
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useChecklists.ts
git commit -m "feat(checklists): add useChecklists hook with all CRUD mutations"
```

---

### Task 5: Component - ChecklistItemRow

**Files:**
- Create: `src/components/checklists/ChecklistItemRow.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { memo, useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChecklistItem } from "@/hooks/useChecklists";

interface ChecklistItemRowProps {
  item: ChecklistItem;
  onToggle: (id: string, completed: boolean) => void;
  onUpdate: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export const ChecklistItemRow = memo(function ChecklistItemRow({
  item,
  onToggle,
  onUpdate,
  onDelete,
}: ChecklistItemRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== item.title) {
      onUpdate(item.id, trimmed);
    } else {
      setEditTitle(item.title);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") {
      setEditTitle(item.title);
      setIsEditing(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100 }}
      className="flex items-center gap-3 py-2 px-1 group"
    >
      <Checkbox
        checked={item.is_completed}
        onCheckedChange={(checked) => onToggle(item.id, !!checked)}
        className="flex-shrink-0"
      />

      {isEditing ? (
        <Input
          ref={inputRef}
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className="h-8 text-sm flex-1"
        />
      ) : (
        <span
          onClick={() => setIsEditing(true)}
          className={cn(
            "flex-1 text-sm cursor-pointer hover:text-primary transition-colors",
            item.is_completed && "line-through text-muted-foreground"
          )}
        >
          {item.title}
        </span>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(item.id);
        }}
      >
        <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
      </Button>
    </motion.div>
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/checklists/ChecklistItemRow.tsx
git commit -m "feat(checklists): add ChecklistItemRow component"
```

---

### Task 6: Component - ChecklistCard

**Files:**
- Create: `src/components/checklists/ChecklistCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, Plus, Trash2, Pencil, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { ChecklistItemRow } from "./ChecklistItemRow";
import {
  useChecklistItems,
  useCreateChecklistItem,
  useToggleChecklistItem,
  useUpdateChecklistItem,
  useDeleteChecklistItem,
  useUpdateChecklist,
  useDeleteChecklist,
  type ChecklistWithCounts,
} from "@/hooks/useChecklists";

interface ChecklistCardProps {
  checklist: ChecklistWithCounts;
}

export const ChecklistCard = memo(function ChecklistCard({ checklist }: ChecklistCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(checklist.title);

  const { data: items = [] } = useChecklistItems(expanded ? checklist.id : null);
  const createItem = useCreateChecklistItem();
  const toggleItem = useToggleChecklistItem();
  const updateItem = useUpdateChecklistItem();
  const deleteItem = useDeleteChecklistItem();
  const updateChecklist = useUpdateChecklist();
  const deleteChecklist = useDeleteChecklist();

  const progress = checklist.total_items > 0
    ? Math.round((checklist.completed_items / checklist.total_items) * 100)
    : 0;

  const handleAddItem = () => {
    const trimmed = newItemTitle.trim();
    if (!trimmed) return;
    createItem.mutate({
      checklist_id: checklist.id,
      title: trimmed,
      position: items.length,
    });
    setNewItemTitle("");
  };

  const handleAddItemKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAddItem();
  };

  const handleSaveTitle = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== checklist.title) {
      updateChecklist.mutate({ id: checklist.id, title: trimmed });
    } else {
      setEditTitle(checklist.title);
    }
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSaveTitle();
    if (e.key === "Escape") {
      setEditTitle(checklist.title);
      setIsEditingTitle(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-card overflow-hidden"
    >
      {/* Header */}
      <div
        className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {isEditingTitle ? (
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={handleSaveTitle}
                  onKeyDown={handleTitleKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  className="h-7 text-sm font-semibold"
                  autoFocus
                />
              ) : (
                <h3 className="font-semibold text-sm truncate">{checklist.title}</h3>
              )}

              {checklist.lead && (
                <Badge variant="outline" className="text-xs gap-1 flex-shrink-0">
                  <Building2 className="w-3 h-3" />
                  {checklist.lead.name}
                </Badge>
              )}
            </div>

            {checklist.description && !expanded && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{checklist.description}</p>
            )}

            <div className="flex items-center gap-3 mt-2">
              <Progress value={progress} className="h-1.5 flex-1" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {checklist.completed_items}/{checklist.total_items}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setIsEditingTitle(true)}
            >
              <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => deleteChecklist.mutate(checklist.id)}
            >
              <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
            </Button>
          </div>
        </div>
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-border pt-3">
              {checklist.description && (
                <p className="text-xs text-muted-foreground mb-3">{checklist.description}</p>
              )}

              {/* Items list */}
              <div className="space-y-0.5">
                <AnimatePresence mode="popLayout">
                  {items.map((item) => (
                    <ChecklistItemRow
                      key={item.id}
                      item={item}
                      onToggle={(id, completed) => toggleItem.mutate({ id, is_completed: completed })}
                      onUpdate={(id, title) => updateItem.mutate({ id, title })}
                      onDelete={(id) => deleteItem.mutate(id)}
                    />
                  ))}
                </AnimatePresence>
              </div>

              {/* Add item input */}
              <div className="flex items-center gap-2 mt-3">
                <Plus className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <Input
                  placeholder="Adicionar item..."
                  value={newItemTitle}
                  onChange={(e) => setNewItemTitle(e.target.value)}
                  onKeyDown={handleAddItemKeyDown}
                  className="h-8 text-sm"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleAddItem}
                  disabled={!newItemTitle.trim()}
                  className="h-8 px-3"
                >
                  Adicionar
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/checklists/ChecklistCard.tsx
git commit -m "feat(checklists): add ChecklistCard component with expand/collapse and progress"
```

---

### Task 7: Component - CreateChecklistDialog

**Files:**
- Create: `src/components/checklists/CreateChecklistDialog.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateChecklist } from "@/hooks/useChecklists";
import { useLeads } from "@/hooks/useLeads";

export function CreateChecklistDialog() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [leadId, setLeadId] = useState<string>("");

  const createChecklist = useCreateChecklist();
  const { data: leadsData } = useLeads(0);
  const leads = leadsData ?? [];

  const handleCreate = () => {
    const trimmed = title.trim();
    if (!trimmed) return;

    createChecklist.mutate(
      {
        title: trimmed,
        description: description.trim() || undefined,
        lead_id: leadId || undefined,
      },
      {
        onSuccess: () => {
          setTitle("");
          setDescription("");
          setLeadId("");
          setOpen(false);
        },
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && title.trim()) {
      e.preventDefault();
      handleCreate();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          Novo Checklist
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo Checklist</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="checklist-title">Título *</Label>
            <Input
              id="checklist-title"
              placeholder="Nome do checklist"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="checklist-desc">Descrição</Label>
            <Textarea
              id="checklist-desc"
              placeholder="Descrição opcional..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Lead (opcional)</Label>
            <Select value={leadId} onValueChange={setLeadId}>
              <SelectTrigger>
                <SelectValue placeholder="Nenhum lead vinculado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Nenhum</SelectItem>
                {leads.map((lead: any) => (
                  <SelectItem key={lead.id} value={lead.id}>
                    {lead.name}{lead.company ? ` - ${lead.company}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!title.trim() || createChecklist.isPending}
            >
              {createChecklist.isPending ? "Criando..." : "Criar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/checklists/CreateChecklistDialog.tsx
git commit -m "feat(checklists): add CreateChecklistDialog component"
```

---

### Task 8: Page - ChecklistPage

**Files:**
- Create: `src/pages/ChecklistPage.tsx`

- [ ] **Step 1: Create the page component**

```tsx
import { motion, AnimatePresence } from "framer-motion";
import { ListChecks } from "lucide-react";
import { useChecklists } from "@/hooks/useChecklists";
import { ChecklistCard } from "@/components/checklists/ChecklistCard";
import { CreateChecklistDialog } from "@/components/checklists/CreateChecklistDialog";

export default function ChecklistPage() {
  const { data: checklists = [], isLoading } = useChecklists();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Checklists</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Organize suas tarefas em listas de verificação
          </p>
        </div>
        <CreateChecklistDialog />
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground mt-2">Carregando checklists...</p>
        </div>
      ) : checklists.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-16"
        >
          <ListChecks className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-muted-foreground">Nenhum checklist ainda</h3>
          <p className="text-sm text-muted-foreground/70 mt-1">
            Crie seu primeiro checklist para organizar suas tarefas
          </p>
        </motion.div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {checklists.map((checklist) => (
              <ChecklistCard key={checklist.id} checklist={checklist} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/ChecklistPage.tsx
git commit -m "feat(checklists): add ChecklistPage with list view"
```

---

### Task 9: Routing and Navigation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add lazy import to App.tsx**

In `src/App.tsx`, after line 63 (the `Automacoes` imports), add:

```typescript
const ChecklistPage = lazy(() => lazyRetry(() => import("./pages/ChecklistPage")));
```

- [ ] **Step 2: Add route to App.tsx**

In `src/App.tsx`, after the `/follow-ups` route block (after line 296), add:

```tsx
      <Route
        path="/checklists"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <PermissionProtectedRoute featureKey="checklists.view">
                <ChecklistPage />
              </PermissionProtectedRoute>
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
```

- [ ] **Step 3: Add ListChecks import to Sidebar.tsx**

In `src/components/layout/Sidebar.tsx`, add `ListChecks` to the lucide-react import (line 3-39). Find:

```typescript
  Gift,
} from "lucide-react";
```

Replace with:

```typescript
  Gift,
  ListChecks,
} from "lucide-react";
```

- [ ] **Step 4: Add nav item to Sidebar.tsx**

In `src/components/layout/Sidebar.tsx`, find the `navItems` array (line 82-96). After the "Revisão" entry (line 90):

```typescript
  { label: "Revisão", icon: Wrench, path: "/follow-ups" },
```

Add:

```typescript
  { label: "Checklists", icon: ListChecks, path: "/checklists" },
```

- [ ] **Step 5: Add permission mapping to Sidebar.tsx**

In `SIDEBAR_VIEW_PERMISSIONS` (line 134-152), find:

```typescript
  "/follow-ups": "followups.view",
```

After that line, add:

```typescript
  "/checklists": "checklists.view",
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(checklists): add /checklists route and sidebar navigation"
```

---

### Task 10: Verification and Lint

**Files:** None (validation only)

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`

Expected: No new errors.

- [ ] **Step 2: Run linter**

Run: `npx eslint src/hooks/useChecklists.ts src/pages/ChecklistPage.tsx src/components/checklists/ --ext .ts,.tsx`

Fix any issues found.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 4: Verify follow-ups and acoes_do_dia are untouched**

Run: `git diff src/hooks/useFollowUps.ts src/hooks/useAcoesDoDia.ts src/components/followups/ src/pages/PipeFollowUps.tsx`

Expected: Empty output - no changes to these files.

- [ ] **Step 5: Generate final DB change report**

Document:
- **Tables created:** `checklists`, `checklist_items` (develop only)
- **RLS policies:** 8 policies (4 per table)
- **Indexes:** `idx_checklists_organization_id`, `idx_checklist_items_checklist_position`
- **Triggers:** `update_checklists_updated_at`, `update_checklist_items_updated_at`
- **Files created:** 6 new files
- **Files modified:** 4 existing files (App.tsx, Sidebar.tsx, useTeamMemberPermissions.ts, types.ts)
- **Files NOT modified:** useFollowUps.ts, useAcoesDoDia.ts, AcoesDoDia.tsx, FollowUpCard.tsx, ScheduleFollowUpModal.tsx, PipeFollowUps.tsx, process-followup-automations


## Links relacionados

- [[Configuracoes]]

- [[Produtos]]

- [[Visao Geral]]

- [[Gestao de Time]]

- [[Comissoes]]

- [[Permissoes Sistema]]

- [[Dashboard]]

- [[Follow-ups]]

- [[Campanhas]]

- [[Pipe Propostas]]

- [[Pipe Confirmacao]]

- [[Pipe WhatsApp]]

- [[WhatsApp Evolution]]

- [[00 - INDEX]]
