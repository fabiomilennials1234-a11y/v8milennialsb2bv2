---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/plans/2026-03-30-conversation-notes.md
---

# Conversation Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add internal conversation notes so users can record private observations within a chat without sending anything to the client.

**Architecture:** New `conversation_notes` table keyed by `lead_id` (since conversation identity is lead-based in both chat contexts). A shared `useConversationNotes` hook handles CRUD. A reusable `ConversationNotes` component is integrated into both `ConversationHistoryTab` (embedded chat) and `ChatWindow` (full-page chat) as a collapsible panel below the header/summary area.

**Tech Stack:** Supabase (Postgres), React, TanStack Query, shadcn/ui, Tailwind CSS.

---

## Architecture Decisions

### Why `lead_id` instead of `whatsapp_conversations.id`?

The `whatsapp_conversations` table only gets a row when a user archives/tags a conversation - it is NOT guaranteed to exist. Both chat contexts (`ChatWindow` and `EmbeddedChatWindow`) have reliable access to `lead_id`. Notes are about the conversation with a lead, which is the semantic unit users care about.

### Why a separate table instead of `leads.notes`?

`leads.notes` is a single TEXT field for general CRM notes. Conversation notes are structured (multiple entries, with author, timestamps, edit history). Different purpose, different lifecycle.

### UI placement

A collapsible panel between the header and messages area - consistent with how `ConversationHistoryTab` already handles the AI summary bar. The pattern is: collapsible section with toggle, content expands/collapses, doesn't block the chat.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20260831100000_conversation_notes.sql` | Table, indexes, RLS |
| Create | `src/hooks/useConversationNotes.ts` | CRUD hooks for conversation notes |
| Create | `src/components/chat/ConversationNotes.tsx` | Shared notes panel component |
| Modify | `src/components/leads/ConversationHistoryTab.tsx` | Add notes panel below AI summary |
| Modify | `src/components/chat/WhatsAppChat.tsx` | Add notes panel in ChatWindow |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260831100000_conversation_notes.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- =====================================================
-- Conversation Notes - notas internas por conversa/lead
-- =====================================================

create table if not exists public.conversation_notes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id         uuid not null references public.leads(id) on delete cascade,
  author_id       uuid not null references auth.users(id),
  content         text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Indexes
create index idx_conv_notes_org    on public.conversation_notes(organization_id);
create index idx_conv_notes_lead   on public.conversation_notes(lead_id);
create index idx_conv_notes_author on public.conversation_notes(author_id);
create index idx_conv_notes_created on public.conversation_notes(lead_id, created_at desc);

-- RLS
alter table public.conversation_notes enable row level security;

create policy "conv_notes_select" on public.conversation_notes
  for select using (
    organization_id in (
      select organization_id from public.team_members where user_id = auth.uid()
    )
  );

create policy "conv_notes_insert" on public.conversation_notes
  for insert with check (
    organization_id in (
      select organization_id from public.team_members where user_id = auth.uid()
    )
  );

create policy "conv_notes_update" on public.conversation_notes
  for update using (
    author_id = auth.uid()
  );

create policy "conv_notes_delete" on public.conversation_notes
  for delete using (
    author_id = auth.uid()
  );

-- Service role
create policy "conv_notes_service_role" on public.conversation_notes
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Updated_at trigger
create trigger conversation_notes_updated_at
  before update on public.conversation_notes
  for each row
  execute function public.update_workflows_updated_at();

comment on table public.conversation_notes is
  'Notas internas vinculadas a uma conversa/lead. Nunca enviadas ao cliente.';
```

- [ ] **Step 2: Verify the migration references exist**

Confirm that `public.update_workflows_updated_at()` trigger function exists (created in `20260722000000_create_workflow_tables.sql`). It simply sets `new.updated_at = now()` - generic enough to reuse.

If not available, create a generic one instead:

```sql
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
```

And use `execute function public.set_updated_at();` in the trigger.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260831100000_conversation_notes.sql
git commit -m "feat(db): add conversation_notes table with RLS"
```

---

### Task 2: CRUD Hook - useConversationNotes

**Files:**
- Create: `src/hooks/useConversationNotes.ts`

- [ ] **Step 1: Create the hook file**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";

export interface ConversationNote {
  id: string;
  organization_id: string;
  lead_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function useConversationNotes(leadId: string | undefined | null) {
  return useQuery({
    queryKey: ["conversation-notes", leadId],
    queryFn: async () => {
      if (!leadId) return [];

      const { data, error } = await supabase
        .from("conversation_notes")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as ConversationNote[];
    },
    enabled: !!leadId,
  });
}

export function useCreateConversationNote() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ leadId, content }: { leadId: string; content: string }) => {
      if (!organizationId || !user?.id) throw new Error("Sem organizacao ou usuario");

      const { data, error } = await supabase
        .from("conversation_notes")
        .insert({
          organization_id: organizationId,
          lead_id: leadId,
          author_id: user.id,
          content: content.trim(),
        } as any)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as ConversationNote;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["conversation-notes", variables.leadId] });
    },
  });
}

export function useUpdateConversationNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, leadId, content }: { id: string; leadId: string; content: string }) => {
      const { data, error } = await supabase
        .from("conversation_notes")
        .update({ content: content.trim() } as any)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as ConversationNote;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["conversation-notes", variables.leadId] });
    },
  });
}

export function useDeleteConversationNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, leadId }: { id: string; leadId: string }) => {
      const { error } = await supabase
        .from("conversation_notes")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["conversation-notes", variables.leadId] });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useConversationNotes.ts
git commit -m "feat(hooks): add useConversationNotes CRUD hooks"
```

---

### Task 3: Shared UI Component - ConversationNotes

**Files:**
- Create: `src/components/chat/ConversationNotes.tsx`

- [ ] **Step 1: Create the component**

This is a collapsible panel that shows existing notes and allows adding new ones. It must be visually distinct from messages - yellow/amber tint for "internal note" identity.

```tsx
import { useState } from "react";
import { StickyNote, ChevronDown, ChevronUp, Plus, Trash2, Pencil, X, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  useConversationNotes,
  useCreateConversationNote,
  useUpdateConversationNote,
  useDeleteConversationNote,
} from "@/hooks/useConversationNotes";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface ConversationNotesProps {
  leadId: string;
}

export default function ConversationNotes({ leadId }: ConversationNotesProps) {
  const [expanded, setExpanded] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");

  const { user } = useAuth();
  const { toast } = useToast();

  const { data: notes, isLoading } = useConversationNotes(leadId);
  const createNote = useCreateConversationNote();
  const updateNote = useUpdateConversationNote();
  const deleteNote = useDeleteConversationNote();

  const noteCount = notes?.length ?? 0;

  const handleCreate = async () => {
    if (!newNote.trim()) return;
    try {
      await createNote.mutateAsync({ leadId, content: newNote });
      setNewNote("");
      setShowInput(false);
    } catch {
      toast({ title: "Erro ao salvar nota", variant: "destructive" });
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editingContent.trim()) return;
    try {
      await updateNote.mutateAsync({ id, leadId, content: editingContent });
      setEditingId(null);
      setEditingContent("");
    } catch {
      toast({ title: "Erro ao atualizar nota", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteNote.mutateAsync({ id, leadId });
    } catch {
      toast({ title: "Erro ao excluir nota", variant: "destructive" });
    }
  };

  const startEditing = (id: string, content: string) => {
    setEditingId(id);
    setEditingContent(content);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingContent("");
  };

  return (
    <div className="shrink-0 border-b border-amber-200/60 bg-amber-50/30 dark:bg-amber-950/10 dark:border-amber-800/30">
      {/* Toggle header */}
      <div className="flex items-center justify-between px-4 py-2">
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <StickyNote className="w-3.5 h-3.5" />
          Notas internas
          {noteCount > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0">
              {noteCount}
            </Badge>
          )}
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-100/60 dark:hover:bg-amber-900/30"
          onClick={() => { setExpanded(true); setShowInput(true); }}
        >
          <Plus className="w-3 h-3 mr-1" />
          Nova nota
        </Button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2 max-h-[250px] overflow-y-auto">
          {/* Internal warning */}
          <p className="text-[10px] text-amber-600/70 dark:text-amber-500/60 flex items-center gap-1">
            <StickyNote className="w-2.5 h-2.5" />
            Visivel apenas para a equipe. Nunca enviado ao cliente.
          </p>

          {/* New note input */}
          {showInput && (
            <div className="space-y-2">
              <Textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Escreva uma nota interna sobre esta conversa..."
                className="text-sm min-h-[60px] max-h-[100px] bg-white dark:bg-background border-amber-200 dark:border-amber-800/40 focus-visible:ring-amber-400"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">Ctrl+Enter para salvar</span>
                <div className="flex gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => { setShowInput(false); setNewNote(""); }}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={handleCreate}
                    disabled={!newNote.trim() || createNote.isPending}
                  >
                    {createNote.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Salvar"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Notes list */}
          {isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
            </div>
          ) : noteCount === 0 && !showInput ? (
            <p className="text-xs text-muted-foreground text-center py-3">
              Nenhuma nota registrada nesta conversa.
            </p>
          ) : (
            notes?.map((note) => (
              <div
                key={note.id}
                className="bg-white dark:bg-background rounded-md border border-amber-200/60 dark:border-amber-800/30 p-2.5 text-sm group"
              >
                {editingId === note.id ? (
                  <div className="space-y-2">
                    <Textarea
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      className="text-sm min-h-[50px] max-h-[100px] border-amber-200 dark:border-amber-800/40"
                      autoFocus
                    />
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={cancelEditing}>
                        <X className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                        onClick={() => handleUpdate(note.id)}
                        disabled={updateNote.isPending}
                      >
                        {updateNote.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap break-words text-foreground">{note.content}</p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(note.created_at), { addSuffix: true, locale: ptBR })}
                        {note.updated_at !== note.created_at && " (editada)"}
                      </span>
                      {user?.id === note.author_id && (
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => startEditing(note.id, note.content)}
                          >
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(note.id)}
                            disabled={deleteNote.isPending}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

Key design decisions:
- Amber/yellow color scheme distinguishes notes from messages (blue/green) and AI summary (purple)
- "Visivel apenas para a equipe. Nunca enviado ao cliente." warning text
- Only the note author can edit/delete (enforced in DB via RLS + UI via `user.id === note.author_id`)
- Collapsible by default to not block chat flow
- Ctrl+Enter shortcut for fast note creation
- Timestamp shows relative time + "(editada)" indicator

- [ ] **Step 2: Commit**

```bash
git add src/components/chat/ConversationNotes.tsx
git commit -m "feat(ui): add ConversationNotes shared component"
```

---

### Task 4: Integrate into ConversationHistoryTab (Embedded Chat)

**Files:**
- Modify: `src/components/leads/ConversationHistoryTab.tsx`

- [ ] **Step 1: Add import**

After the existing imports (around line 26), add:

```typescript
import ConversationNotes from "@/components/chat/ConversationNotes";
```

- [ ] **Step 2: Add notes panel between AI summary and embedded chat**

Find the section at line 266-276:

```tsx
      </div>

      {/* Embedded WhatsApp chat - takes remaining space */}
      <div className="flex-1 min-h-0">
        <EmbeddedChatWindow
```

Insert the notes panel between the summary `</div>` and the embedded chat:

```tsx
      </div>

      {/* Internal notes panel */}
      <ConversationNotes leadId={leadId} />

      {/* Embedded WhatsApp chat - takes remaining space */}
      <div className="flex-1 min-h-0">
        <EmbeddedChatWindow
```

- [ ] **Step 3: Commit**

```bash
git add src/components/leads/ConversationHistoryTab.tsx
git commit -m "feat(chat): integrate notes panel into embedded chat tab"
```

---

### Task 5: Integrate into ChatWindow (Full-Page Chat)

**Files:**
- Modify: `src/components/chat/WhatsAppChat.tsx`

- [ ] **Step 1: Add import**

Find the imports section at the top of `WhatsAppChat.tsx`. Add near the other chat component imports:

```typescript
import ConversationNotes from "@/components/chat/ConversationNotes";
```

- [ ] **Step 2: Add notes panel in ChatWindow after scheduled messages banner**

Find the scheduled messages banner section (around line 1783-1791):

```tsx
      {/* Banner de mensagens agendadas */}
      {selectedContact && selectedContact.lead_id && (
        <ScheduledMessagesBanner
          leadId={selectedContact.lead_id}
          leadName={selectedContact.lead_name || selectedContact.push_name || selectedContact.phone_number}
          phoneNumber={selectedContact.phone_number}
          instanceId={instanceId}
        />
      )}
```

Insert the notes panel AFTER the closing `)}` of the ScheduledMessagesBanner block:

```tsx
      {/* Notas internas da conversa */}
      {leadId && (
        <ConversationNotes leadId={leadId} />
      )}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/WhatsAppChat.tsx
git commit -m "feat(chat): integrate notes panel into full-page chat"
```

---

### Task 6: Build Validation

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: Run production build**

```bash
npm run build
```

Expected: successful build.

- [ ] **Step 3: Fix any errors**

If TypeScript or build errors, fix them and commit.

---

### Task 7: Final Review

- [ ] **Step 1: Verify migration correctness**

Read `supabase/migrations/20260831100000_conversation_notes.sql` and confirm:
- Table references `organizations`, `leads`, `auth.users` - all exist
- RLS policies cover SELECT (org members), INSERT (org members), UPDATE (author only), DELETE (author only), ALL (service_role)
- `updated_at` trigger function exists
- Indexes cover the main query pattern (lead_id + created_at DESC)

- [ ] **Step 2: Verify hook safety**

Read `src/hooks/useConversationNotes.ts` and confirm:
- All mutations check for `organizationId` and `user.id`
- `as any` cast is used for Supabase insert/update (typed client may not have the new table)
- Query invalidation uses correct key `["conversation-notes", leadId]`

- [ ] **Step 3: Verify component safety**

Read `src/components/chat/ConversationNotes.tsx` and confirm:
- Component returns content (never null) - it always renders the header bar
- Edit/delete buttons only shown for note author
- `autoFocus` on textarea doesn't steal focus on mount (only when `showInput` is toggled)
- No message-send functions are called - only `conversation_notes` table operations

- [ ] **Step 4: Verify integrations don't break existing functionality**

Read both modified files and confirm:
- `ConversationHistoryTab`: AI summary bar + EmbeddedChatWindow still render correctly, notes panel is between them
- `WhatsAppChat/ChatWindow`: Message sending, AI toggle, scheduled messages all untouched, notes panel only renders when `leadId` is available

---

## Permissions Model

| Action | Who Can Do It | Enforced By |
|--------|---------------|-------------|
| View notes | All org members | RLS: `organization_id IN (SELECT ... FROM team_members)` |
| Create note | All org members | RLS: same as view |
| Edit note | Note author only | RLS: `author_id = auth.uid()` + UI: `user.id === note.author_id` |
| Delete note | Note author only | RLS: `author_id = auth.uid()` + UI: `user.id === note.author_id` |

## Edge Cases Handled

1. **No lead linked**: Notes panel only renders when `leadId` is available. In `ChatWindow`, contacts without a lead don't show the notes panel.
2. **No prior conversation record**: Notes are tied to `lead_id`, not `whatsapp_conversations`. No dependency on conversation metadata existing.
3. **Multiple phone numbers per lead**: Notes are per-lead, shared across all phone numbers. This is the correct semantic - it's about the business relationship, not the channel.
4. **Concurrent edits**: Supabase handles optimistic locking via `updated_at`. React Query invalidation ensures fresh data after mutations.

## Residual Risks

1. **No author name displayed**: The current implementation shows relative timestamps but not the author's name. This is fine for single-user scenarios but in multi-agent teams, adding author display would be a valuable follow-up.
2. **No pagination**: Notes are fetched all at once (ordered by created_at DESC). For conversations with 100+ notes, pagination would be needed - but this is an unlikely scenario for internal notes.


## Links relacionados

- [[Chat WhatsApp]]
- [[Copilot]]

- [[Visao Geral]]

- [[Gestao de Time]]

- [[Mensagens Agendadas]]

- [[Permissoes Sistema]]

- [[Workflow Builder]]

- [[WhatsApp Evolution]]

- [[00 - INDEX]]
