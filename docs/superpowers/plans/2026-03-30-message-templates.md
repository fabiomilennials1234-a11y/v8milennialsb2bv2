# Message Templates with Slash Commands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar sistema de mensagens template com comandos `/` no chat WhatsApp, permitindo que qualquer membro da org cadastre e use templates com variáveis dinâmicas de lead.

**Architecture:** Migration cria tabela `message_templates` com RLS por org. Hook CRUD com TanStack Query. Página de gestão standalone. Componente `SlashCommandPopover` intercepta `/` no input do chat e mostra autocomplete. Função pura resolve variáveis `{nome}` → valor do lead.

**Tech Stack:** React + TypeScript, Supabase (Postgres + RLS), TanStack Query, shadcn/ui, Tailwind CSS.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20260330200000_message_templates.sql` | Tabela, RLS, indexes, feature flag |
| Create | `src/lib/template-variables.ts` | Função pura `resolveVariables()` + constante `TEMPLATE_VARIABLES` |
| Create | `src/hooks/useMessageTemplates.ts` | CRUD hook: list, create, update, delete |
| Create | `src/pages/MessageTemplates.tsx` | Página de gestão (lista + modal de criação/edição) |
| Create | `src/components/chat/SlashCommandPopover.tsx` | Dropdown autocomplete para `/` commands no chat |
| Modify | `src/lib/feature-registry.ts` | Adicionar feature key `message_templates` |
| Modify | `src/components/layout/Sidebar.tsx:89-103` | Novo item "Templates" no navItems |
| Modify | `src/App.tsx` | Rota `/templates` |
| Modify | `src/components/chat/WhatsAppChat.tsx:1348,1448-1453,1922-1930` | Integrar SlashCommandPopover no input |

---

### Task 1: Database migration — message_templates table

**Files:**
- Create: `supabase/migrations/20260330200000_message_templates.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ================================================================
-- Migration: Message Templates
-- Tabela de templates de mensagem com slash commands por org.
-- Date: 2026-03-30
-- ================================================================

-- ============================================
-- 1. Tabela message_templates
-- ============================================

CREATE TABLE IF NOT EXISTS public.message_templates (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  command          TEXT        NOT NULL,
  display_name     TEXT        NOT NULL,
  body             TEXT        NOT NULL,
  created_by       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT message_templates_command_format
    CHECK (command ~ '^[a-z0-9][a-z0-9-]*$'),
  CONSTRAINT message_templates_unique_command
    UNIQUE (organization_id, command)
);

COMMENT ON TABLE public.message_templates IS 'Templates de mensagem com slash commands por organização';
COMMENT ON COLUMN public.message_templates.command IS 'Slug do comando sem / (ex: saudacao). Lowercase, números, hifens.';
COMMENT ON COLUMN public.message_templates.body IS 'Corpo da mensagem com variáveis {nome}, {empresa}, etc.';

CREATE INDEX IF NOT EXISTS idx_message_templates_org
  ON public.message_templates (organization_id);

-- ============================================
-- 2. RLS
-- ============================================

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

-- Membros da org podem ver todos os templates
CREATE POLICY "message_templates_select_org"
  ON public.message_templates FOR SELECT
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
    OR public.is_master_user()
  );

-- Membros da org podem criar templates
CREATE POLICY "message_templates_insert_org"
  ON public.message_templates FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
    OR public.is_master_user()
  );

-- Membros da org podem editar templates
CREATE POLICY "message_templates_update_org"
  ON public.message_templates FOR UPDATE
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
    OR public.is_master_user()
  );

-- Membros da org podem deletar templates
CREATE POLICY "message_templates_delete_org"
  ON public.message_templates FOR DELETE
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = auth.uid() AND tm.is_active = true
    )
    OR public.is_master_user()
  );

-- ============================================
-- 3. Feature flag
-- ============================================

INSERT INTO public.feature_flags (key, name, description, category, default_enabled)
VALUES (
  'message_templates',
  'Templates de Mensagem',
  'Templates de mensagem com slash commands no chat',
  'modules',
  false
)
ON CONFLICT (key) DO NOTHING;

-- Habilitar nos planos Torque 2.0 e V8
UPDATE public.subscription_plans
SET features = features || '{"message_templates": true}'::JSONB
WHERE name IN ('torque-2.0', 'torque-v8');

-- Manter desabilitado no Torque 1.0
UPDATE public.subscription_plans
SET features = features || '{"message_templates": false}'::JSONB
WHERE name = 'torque-1.0';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260330200000_message_templates.sql
git commit -m "feat(db): add message_templates table with RLS and feature flag"
```

---

### Task 2: Template variables resolver

**Files:**
- Create: `src/lib/template-variables.ts`

- [ ] **Step 1: Write the module**

```typescript
/**
 * template-variables.ts — resolve variáveis {nome}, {empresa}, etc.
 * em templates de mensagem usando dados do lead e atendente.
 */

export interface TemplateVariableMeta {
  name: string;
  description: string;
}

/** Variáveis disponíveis para uso nos templates (exibidas na UI como badges clicáveis) */
export const TEMPLATE_VARIABLES: TemplateVariableMeta[] = [
  { name: "{nome}", description: "Nome do lead" },
  { name: "{empresa}", description: "Empresa do lead" },
  { name: "{email}", description: "Email do lead" },
  { name: "{telefone}", description: "Telefone do lead" },
  { name: "{origem}", description: "Origem do lead" },
  { name: "{interesse}", description: "Campo de interesse" },
  { name: "{segmento}", description: "Segmento do lead" },
  { name: "{campanha}", description: "Nome da campanha" },
  { name: "{atendente}", description: "Nome do atendente" },
];

export interface LeadContext {
  name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  interest?: string | null;
  segment?: string | null;
  campaign_name?: string | null;
  custom_fields?: Record<string, string | null>;
}

export interface AttendantContext {
  name?: string | null;
}

/**
 * Resolve variáveis no body do template.
 * Variáveis sem valor são substituídas por string vazia.
 */
export function resolveVariables(
  body: string,
  lead: LeadContext,
  attendant: AttendantContext
): string {
  let result = body;

  const replacements: Record<string, string> = {
    "{nome}": lead.name ?? "",
    "{empresa}": lead.company ?? "",
    "{email}": lead.email ?? "",
    "{telefone}": lead.phone ?? "",
    "{origem}": lead.source ?? "",
    "{interesse}": lead.interest ?? "",
    "{segmento}": lead.segment ?? "",
    "{campanha}": lead.campaign_name ?? "",
    "{atendente}": attendant.name ?? "",
  };

  for (const [key, value] of Object.entries(replacements)) {
    result = result.replaceAll(key, value);
  }

  // Resolve custom fields: {campo:slug}
  if (lead.custom_fields) {
    result = result.replace(/\{campo:([a-z0-9_-]+)\}/g, (_, slug) => {
      return lead.custom_fields?.[slug] ?? "";
    });
  }

  // Remove any remaining unresolved {campo:xxx} patterns
  result = result.replace(/\{campo:[a-z0-9_-]+\}/g, "");

  return result.trim();
}

/** Dados fictícios para preview na UI de criação de templates */
export const PREVIEW_LEAD: LeadContext = {
  name: "João Silva",
  company: "Empresa XYZ",
  email: "joao@empresa.com",
  phone: "(48) 99999-0000",
  source: "Meta Ads",
  interest: "Plano Pro",
  segment: "Tecnologia",
  campaign_name: "Campanha Março",
  custom_fields: { cnpj: "12.345.678/0001-00" },
};

export const PREVIEW_ATTENDANT: AttendantContext = {
  name: "Maria Santos",
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/template-variables.ts
git commit -m "feat: add template variables resolver with lead/attendant context"
```

---

### Task 3: Feature registry + sidebar + route

**Files:**
- Modify: `src/lib/feature-registry.ts`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add feature key to feature-registry.ts**

In `src/lib/feature-registry.ts`, add `"message_templates"` to the `FeatureKey` type union (after `"funnels_template_reativacao"`):

```typescript
  | "message_templates"
```

Add to the `FEATURES` array (after the `carteira` entry, before the funnels_template entries):

```typescript
  { key: "message_templates", label: "Templates", description: "Modelos de mensagem com slash commands", icon: "FileText", category: "modules", sidebarPath: "/templates" },
```

Add to `SIDEBAR_FEATURE_MAP`:

```typescript
SIDEBAR_FEATURE_MAP["/templates"] = "message_templates";
```

- [ ] **Step 2: Add sidebar item in Sidebar.tsx**

In `src/components/layout/Sidebar.tsx`, add to the `navItems` array at line 102 (after "Automações"):

```typescript
  { label: "Templates", icon: FileText, path: "/templates" },
```

Add the import for `FileText` from lucide-react (it's likely already imported, check the imports at the top).

Add to `SIDEBAR_VIEW_PERMISSIONS` (around line 155):

```typescript
  "/templates": "message_templates.view",
```

- [ ] **Step 3: Add route in App.tsx**

Add the lazy import near the other page imports (around line 67):

```typescript
const MessageTemplates = lazy(() => lazyRetry(() => import("./pages/MessageTemplates")));
```

Add the route (after the automacoes routes, around line 560):

```tsx
      <Route
        path="/templates"
        element={
          <ProtectedRoute>
            <LayoutWrapper>
              <MessageTemplates />
            </LayoutWrapper>
          </ProtectedRoute>
        }
      />
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/feature-registry.ts src/components/layout/Sidebar.tsx src/App.tsx
git commit -m "feat: add templates route, sidebar item, and feature flag registration"
```

---

### Task 4: CRUD hook — useMessageTemplates

**Files:**
- Create: `src/hooks/useMessageTemplates.ts`

- [ ] **Step 1: Write the hook**

```typescript
/**
 * useMessageTemplates — CRUD hook para message_templates.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";

export interface MessageTemplate {
  id: string;
  organization_id: string;
  command: string;
  display_name: string;
  body: string;
  created_by: string;
  updated_at: string;
  created_at: string;
}

const QUERY_KEY = "message-templates";

export function useMessageTemplates() {
  const { organizationId } = useOrganization();

  return useQuery<MessageTemplate[]>({
    queryKey: [QUERY_KEY, organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("message_templates")
        .select("*")
        .eq("organization_id", organizationId)
        .order("command");
      if (error) throw error;
      return (data ?? []) as unknown as MessageTemplate[];
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useCreateMessageTemplate() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (payload: {
      command: string;
      display_name: string;
      body: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !organizationId) throw new Error("Não autenticado");

      const { error } = await supabase.from("message_templates").insert({
        organization_id: organizationId,
        command: payload.command.toLowerCase().trim(),
        display_name: payload.display_name.trim(),
        body: payload.body,
        created_by: user.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success("Template criado!");
    },
    onError: (error: any) => {
      if (error.message?.includes("unique") || error.code === "23505") {
        toast.error("Já existe um template com esse comando.");
      } else {
        toast.error(error.message || "Erro ao criar template");
      }
    },
  });
}

export function useUpdateMessageTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      id: string;
      command: string;
      display_name: string;
      body: string;
    }) => {
      const { error } = await supabase
        .from("message_templates")
        .update({
          command: payload.command.toLowerCase().trim(),
          display_name: payload.display_name.trim(),
          body: payload.body,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success("Template atualizado!");
    },
    onError: (error: any) => {
      if (error.message?.includes("unique") || error.code === "23505") {
        toast.error("Já existe um template com esse comando.");
      } else {
        toast.error(error.message || "Erro ao atualizar template");
      }
    },
  });
}

export function useDeleteMessageTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("message_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success("Template removido.");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao remover template");
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useMessageTemplates.ts
git commit -m "feat: add useMessageTemplates CRUD hook"
```

---

### Task 5: MessageTemplates page

**Files:**
- Create: `src/pages/MessageTemplates.tsx`

- [ ] **Step 1: Write the page**

This is a full page with:
- Header with title + "Novo Template" button
- Search input filtering by command and display_name
- Grid of template cards with edit/delete
- Modal for create/edit with command input (prefixed `/`), display_name, body textarea with variable badges, live preview

The page should follow the same patterns as other pages in the codebase (Equipe.tsx, Produtos.tsx):
- Use shadcn/ui components: `Button`, `Input`, `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter`, `Label`, `Textarea`, `Badge`
- Use lucide-react icons: `Plus`, `Search`, `Pencil`, `Trash2`, `FileText`, `Eye`
- Use the `useMessageTemplates`, `useCreateMessageTemplate`, `useUpdateMessageTemplate`, `useDeleteMessageTemplate` hooks
- Use `TEMPLATE_VARIABLES`, `resolveVariables`, `PREVIEW_LEAD`, `PREVIEW_ATTENDANT` from `@/lib/template-variables`
- Export as default for lazy loading

Key behaviors:
- Command input: prefixed with `/`, validates `^[a-z0-9][a-z0-9-]*$` on change, shows error if invalid
- Variable badges: clicking a badge inserts the variable at cursor position in the body textarea (use a ref to the textarea)
- Live preview: below the textarea, shows `resolveVariables(body, PREVIEW_LEAD, PREVIEW_ATTENDANT)` updating in real-time
- Empty state: "Nenhum template cadastrado" with call-to-action to create first one
- Delete confirmation: use `window.confirm()` for simplicity

The component should be around 250-350 lines. Use inline state management (useState for modal open, form fields, search query). No need for a form library — the form is simple enough.

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/MessageTemplates.tsx
git commit -m "feat: add MessageTemplates page with CRUD and variable preview"
```

---

### Task 6: SlashCommandPopover component

**Files:**
- Create: `src/components/chat/SlashCommandPopover.tsx`

- [ ] **Step 1: Write the component**

```tsx
/**
 * SlashCommandPopover — dropdown autocomplete para slash commands no chat.
 * Aparece quando o usuário digita "/" como primeiro caractere no input.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { MessageTemplate } from "@/hooks/useMessageTemplates";

interface SlashCommandPopoverProps {
  /** Texto atual do input (usado para filtrar comandos) */
  query: string;
  /** Lista de templates carregados */
  templates: MessageTemplate[];
  /** Chamado quando um template é selecionado */
  onSelect: (template: MessageTemplate) => void;
  /** Chamado quando o popover deve fechar (Esc ou sem resultados) */
  onClose: () => void;
}

export function SlashCommandPopover({
  query,
  templates,
  onSelect,
  onClose,
}: SlashCommandPopoverProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Filtrar templates pelo que o usuário digitou após "/"
  const search = query.startsWith("/") ? query.slice(1).toLowerCase() : "";
  const filtered = templates.filter(
    (t) =>
      t.command.startsWith(search) ||
      t.display_name.toLowerCase().includes(search)
  );

  // Reset index quando filtro muda
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  // Fechar se não tem resultados
  useEffect(() => {
    if (filtered.length === 0 && search.length > 0) {
      onClose();
    }
  }, [filtered.length, search, onClose]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, selectedIndex, onSelect, onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-lg border bg-popover shadow-lg z-50"
    >
      {filtered.slice(0, 8).map((template, i) => (
        <button
          key={template.id}
          type="button"
          className={`w-full text-left px-3 py-2.5 flex flex-col gap-0.5 transition-colors ${
            i === selectedIndex
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/50"
          }`}
          onMouseEnter={() => setSelectedIndex(i)}
          onClick={() => onSelect(template)}
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-primary">
              /{template.command}
            </span>
            <span className="text-sm text-muted-foreground">
              {template.display_name}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {template.body}
          </p>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/chat/SlashCommandPopover.tsx
git commit -m "feat: add SlashCommandPopover for chat autocomplete"
```

---

### Task 7: Integrate SlashCommandPopover into WhatsAppChat

**Files:**
- Modify: `src/components/chat/WhatsAppChat.tsx`

- [ ] **Step 1: Add imports**

At the top of the file, add:

```typescript
import { SlashCommandPopover } from "@/components/chat/SlashCommandPopover";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { resolveVariables } from "@/lib/template-variables";
import type { LeadContext, AttendantContext } from "@/lib/template-variables";
```

- [ ] **Step 2: Add hook call and state**

Inside the `WhatsAppChatContent` component (the inner component that receives `leadId`, `selectedContact`, etc.), near line 1348 where `newMessage` state is, add:

```typescript
const [showSlashPopover, setShowSlashPopover] = useState(false);
const { data: templates } = useMessageTemplates();
```

- [ ] **Step 3: Modify setNewMessage to detect slash**

Replace the `onChange` handler of the Input (line 1926):

```tsx
onChange={(e) => {
  const val = e.target.value;
  setNewMessage(val);
  setShowSlashPopover(val.startsWith("/") && val.length > 0);
}}
```

- [ ] **Step 4: Add slash command selection handler**

Add this function near `handleSend` (around line 1446):

```typescript
const handleSlashSelect = (template: MessageTemplate) => {
  // Build lead context from selectedContact / available lead data
  const leadCtx: LeadContext = {
    name: selectedContact?.lead_name ?? selectedContact?.push_name ?? undefined,
    phone: phoneNumber ?? undefined,
  };
  // Attendant context — get from auth or team_member
  const attendantCtx: AttendantContext = {
    name: undefined, // Will be set if we have team_member data
  };
  const resolved = resolveVariables(template.body, leadCtx, attendantCtx);
  setNewMessage(resolved);
  setShowSlashPopover(false);
};
```

Note: The lead context here uses what's available from `selectedContact`. For a richer context (company, email, segment, etc.), the implementer should check if there's a lead query in scope. The `selectedContact` only has `lead_name` and `phone_number`. If `leadId` is available, the implementer can fetch the full lead record. Check the existing code for any `useLead(leadId)` hook or similar and use it to populate all fields. If none exists, use what's available from `selectedContact`.

- [ ] **Step 5: Modify handleKeyDown to defer to popover**

Replace `handleKeyDown` (lines 1448-1453):

```typescript
const handleKeyDown = (e: React.KeyboardEvent) => {
  // When slash popover is open, let it handle Enter/Escape/Arrows
  if (showSlashPopover) return;

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
};
```

- [ ] **Step 6: Render SlashCommandPopover above the input**

Find the input area wrapper div (around line 1905-1910, the div that contains the image button, input, and send button). Make the wrapper `relative` if it isn't already, then add the popover inside it, before the Input:

```tsx
{/* Slash command autocomplete */}
{showSlashPopover && templates && (
  <SlashCommandPopover
    query={newMessage}
    templates={templates}
    onSelect={handleSlashSelect}
    onClose={() => setShowSlashPopover(false)}
  />
)}
```

The popover uses `absolute bottom-full` positioning, so it appears above the input naturally.

- [ ] **Step 7: Verify build**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

- [ ] **Step 8: Commit**

```bash
git add src/components/chat/WhatsAppChat.tsx
git commit -m "feat(chat): integrate slash command autocomplete into WhatsApp chat"
```

---

### Task 8: Deploy migration and verify

- [ ] **Step 1: Apply migration to DEV**

```bash
npx supabase link --project-ref bcfadphgsibjzivtbjvc
npx supabase db query --linked -f supabase/migrations/20260330200000_message_templates.sql
```

- [ ] **Step 2: Verify table and feature flag exist**

```bash
npx supabase db query --linked "SELECT table_name FROM information_schema.tables WHERE table_name = 'message_templates';"
npx supabase db query --linked "SELECT key, name FROM feature_flags WHERE key = 'message_templates';"
npx supabase db query --linked "SELECT name, features->>'message_templates' AS msg_templates FROM subscription_plans WHERE is_active = true;"
```

Expected: table exists, feature flag exists, torque-2.0 and torque-v8 have `true`, torque-1.0 has `false`.

- [ ] **Step 3: Apply migration to PROD**

```bash
npx supabase link --project-ref jsjsmuncfkbsbzqzqhfq
npx supabase db query --linked -f supabase/migrations/20260330200000_message_templates.sql
```

- [ ] **Step 4: Re-link to DEV**

```bash
npx supabase link --project-ref bcfadphgsibjzivtbjvc
```

- [ ] **Step 5: Verify full build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 6: Commit any fixes**

```bash
git add -A && git commit -m "fix: resolve build issues from message templates implementation"
```

---

## Dependency Graph

```
Task 1 (DB migration) — independent
Task 2 (template-variables.ts) — independent
Task 3 (feature registry + sidebar + route) — needs Task 5 for the page import
Task 4 (useMessageTemplates hook) — independent
Task 5 (MessageTemplates page) — needs Task 2 + Task 4
Task 6 (SlashCommandPopover) — needs Task 4 (type import)
Task 7 (WhatsAppChat integration) — needs Task 2 + Task 4 + Task 6
Task 8 (Deploy) — needs all above
```

Execution order: Tasks 1, 2, 4 can run first (independent). Then 6, then 5, then 3 + 7, then 8.
