# Revisão — Redesign Completo

**Data:** 2026-03-29
**Status:** Aprovado
**Rota:** `/follow-ups`

## Resumo

Reformulação completa da página Revisão como um checklist unificado de tarefas. Mescla follow-ups e mensagens agendadas numa interface tipo Todoist — compacta, com tabs para filtrar, ações contextuais ao completar, e sugestões inteligentes. Reativa a aba Revisão na navegação.

## Requisitos

### Funcional

1. Três tabs: "Tudo" (merged) | "Mensagens" (scheduled_user_messages) | "Follow-ups" (follow_ups)
2. Lista plana ordenada cronologicamente por data/hora — sem agrupamento por seções
3. Cada item é uma linha compacta: checkbox + título + badge tipo + lead + data + prioridade
4. Click no item expande inline: descrição, ações rápidas (WhatsApp, Editar, Cancelar)
5. Ao completar follow-up: banner inline "Enviar mensagem?" com [Agendar] [Pular]
6. Ao completar mensagem agendada: cancela silenciosamente (status → cancelled)
7. Seção "Concluídos" colapsável no final da lista
8. Sugestões inteligentes no topo da tab "Tudo" (leads sem ação, follow-ups vencidos, leads quentes)
9. Busca por título/lead name
10. Filtro por responsável (admin vê todos, membro vê o próprio)
11. Toggle "Mostrar concluídos"
12. Reativar aba Revisão no Sidebar e TopNavigation

### Não-funcional

- Layout single-column sem sidebar (AcoesDoDia removida da página, hooks mantidos)
- Consistente com design system: underline tabs, stat-card-label, rounded-lg cards
- Framer Motion para expand/collapse e completion animations
- Permissões existentes mantidas: `followups.view`, `followups.delete`

---

## Data Model

### Union type: `RevisionTask`

```typescript
type RevisionTask = {
  id: string;
  type: "follow-up" | "scheduled-message";
  title: string;
  leadName: string;
  leadCompany?: string;
  leadPhone?: string;
  leadId: string;
  scheduledAt: Date;
  priority?: "low" | "normal" | "high" | "urgent";
  isCompleted: boolean;
  completedAt?: Date;
  // Follow-up specific
  description?: string;
  assignedTo?: string;
  assignedToName?: string;
  sourcePipe?: string;
  isAutomated?: boolean;
  // Scheduled message specific
  messageContent?: string;
  mediaUrl?: string;
  mediaType?: string;
  status?: "scheduled" | "sending" | "sent" | "failed" | "cancelled";
};
```

### Novo hook: `useMyScheduledMessages()`

```typescript
// Busca todas scheduled_user_messages criadas pelo membro logado
// Para admins com filtro "todos": busca todas da organização
export function useMyScheduledMessages(filters?: {
  showCompleted?: boolean;
  assignedTo?: string; // created_by filter
}) {
  // SELECT * FROM scheduled_user_messages
  // WHERE created_by = current_member.id (ou org filter para admin)
  // AND status IN ('scheduled', 'cancelled' se showCompleted)
  // ORDER BY scheduled_at ASC
}
```

### Merge logic na página

```typescript
const allTasks: RevisionTask[] = useMemo(() => {
  const followUpTasks = followUps.map(fu => ({
    id: fu.id,
    type: "follow-up" as const,
    title: fu.title,
    leadName: fu.lead?.name || "Sem nome",
    leadCompany: fu.lead?.company,
    leadPhone: fu.lead?.phone,
    leadId: fu.lead_id,
    scheduledAt: new Date(fu.due_date),
    priority: fu.priority,
    isCompleted: !!fu.completed_at,
    completedAt: fu.completed_at ? new Date(fu.completed_at) : undefined,
    description: fu.description,
    assignedTo: fu.assigned_to,
    assignedToName: fu.team_member?.name,
    sourcePipe: fu.source_pipe,
    isAutomated: fu.is_automated,
  }));

  const messageTasks = scheduledMessages.map(sm => ({
    id: sm.id,
    type: "scheduled-message" as const,
    title: sm.message_content?.slice(0, 60) || `[${sm.media_type || "mídia"}]`,
    leadName: sm.lead_name || "Sem nome",
    leadPhone: sm.phone_number,
    leadId: sm.lead_id,
    scheduledAt: new Date(sm.scheduled_at),
    isCompleted: sm.status === "sent" || sm.status === "cancelled",
    completedAt: sm.sent_at ? new Date(sm.sent_at) : undefined,
    messageContent: sm.message_content,
    mediaUrl: sm.media_url,
    mediaType: sm.media_type,
    status: sm.status,
  }));

  return [...followUpTasks, ...messageTasks]
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}, [followUps, scheduledMessages]);
```

---

## Componentes

### Página: `src/pages/Revisao.tsx`

Nova página substituindo `PipeFollowUps` na rota `/follow-ups`.

**Layout:**
```
Header (título + subtítulo)
Sugestões colapsáveis (tab "Tudo" apenas)
Tabs: [Tudo] [Mensagens] [Follow-ups]    🔍 Buscar   [Responsável ▾]  [☐ Concluídos]
Lista de RevisionItem
Separador "Concluídos (N)"
Lista de RevisionItem (concluídos)
```

**Hooks usados:**
- `useFollowUps()` — existente
- `useMyScheduledMessages()` — novo
- `useCompleteFollowUp()` — existente
- `useCancelScheduledMessage()` — existente
- `useDailyPriorities()` — existente (sugestões)
- `useTeamMembers()` — existente
- `useCurrentTeamMember()` — existente
- `useUserRole()` — existente

### Componente: `src/components/revisao/RevisionItem.tsx`

Item compacto do checklist.

**Props:** `{ task: RevisionTask; onComplete: () => void; onExpand: () => void; isExpanded: boolean }`

**Layout compacto (uma linha):**
```
[☐] Título do item truncado              [Mensagem]
    Lead Name · Empresa        29/03 14:00      [●]
```

- Checkbox: shadcn `Checkbox`
- Título: `text-sm font-medium truncate`
- Badge tipo: `Mensagem` (bg-blue-500/10 text-blue-600 border-blue-500/20) ou `Follow-up` (bg-amber-500/10 text-amber-600 border-amber-500/20)
- Lead info: `text-[12px] text-muted-foreground/60`
- Data: `text-[12px] tabular-nums` — `text-destructive` se atrasado
- Dot prioridade: `w-2 h-2 rounded-full` — red (urgent), orange (high), nada (normal/low)
- Hover: `bg-muted/30 transition-colors`
- Item inteiro clicável para expand
- `py-3` vertical spacing, sem border entre items

### Componente: `src/components/revisao/RevisionItemExpanded.tsx`

Conteúdo expandido inline (dentro do AnimatePresence).

**Para follow-up:**
- Descrição completa
- Responsável atribuído
- Source pipe badge
- Botões: [WhatsApp] [Editar] [Arquivar] [Excluir]

**Para mensagem agendada:**
- Preview completo da mensagem
- Preview de mídia (thumbnail se imagem, filename se doc)
- Status (scheduled/sent/failed)
- Botões: [Editar] [Cancelar]

### Componente: `src/components/revisao/CompletionBanner.tsx`

Banner inline que aparece ao completar um follow-up.

```
┌────────────────────────────────────────────────┐
│ ✅ Concluído · Enviar mensagem para o lead?    │
│                          [Agendar]  [Pular]    │
└────────────────────────────────────────────────┘
```

- Aparece logo abaixo do item concluído
- `bg-success/5 border border-success/20 rounded-lg px-4 py-2.5`
- "Agendar" abre `ScheduleMessageModal`
- "Pular" fecha o banner e move item para concluídos
- Auto-dismiss em 5 segundos se ignorar
- Só aparece para follow-ups, não para mensagens

### Componente: `src/components/revisao/SuggestionsSection.tsx`

Seção colapsável no topo da tab "Tudo".

```
💡 Sugestões (3)                              [▾]
  ● Lead sem contato há 5 dias: João Silva     [+]
  ● Follow-up vencido: Maria Souza             [+]
  ● Lead quente: Pedro Lima (score 9)          [+]
```

- `bg-primary/5 border border-primary/20 rounded-lg`
- Dados de `useDailyPriorities()`
- [+] cria follow-up via `ScheduleFollowUpModal` ou mensagem via `ScheduleMessageModal`
- Colapsável com estado em localStorage
- Ícone `Lightbulb` de lucide

---

## Navegação

### Reativar aba Revisão

**Sidebar.tsx** — descomentar:
```typescript
{ label: "Revisão", icon: Wrench, path: "/follow-ups" },
```

**TopNavigation.tsx** — descomentar em `primaryNavItems`, `moreNavItems`, e `allNavItems`:
```typescript
{ label: "Revisão", icon: Wrench, path: "/follow-ups" },
```

### Rota App.tsx

Trocar o componente na rota:
```typescript
// Antes: <PipeFollowUps />
// Depois:
<Revisao />
```

`PipeFollowUps.tsx` mantido no repositório como referência mas não referenciado.

---

## Hooks

### `useMyScheduledMessages()`

```typescript
export function useMyScheduledMessages(filters?: {
  showCompleted?: boolean;
  assignedTo?: string;
}) {
  const { organizationId } = useOrganization();
  const { data: member } = useCurrentTeamMember();

  return useQuery({
    queryKey: ["scheduled-messages", "my", organizationId, filters],
    queryFn: async () => {
      if (!organizationId || !member) return [];

      let query = supabase
        .from("scheduled_user_messages")
        .select("*, lead:leads(name, company, phone)")
        .eq("organization_id", organizationId)
        .order("scheduled_at", { ascending: true });

      // Filter by creator (admin can see all via assignedTo="all")
      if (filters?.assignedTo && filters.assignedTo !== "all") {
        query = query.eq("created_by", filters.assignedTo);
      } else if (!filters?.assignedTo) {
        query = query.eq("created_by", member.id);
      }

      // Status filter
      if (filters?.showCompleted) {
        query = query.in("status", ["scheduled", "sent", "cancelled", "failed"]);
      } else {
        query = query.eq("status", "scheduled");
      }

      const { data, error } = await query;
      if (error) return [];
      return data;
    },
    enabled: !!organizationId && !!member,
    retry: false,
    staleTime: 30_000,
  });
}
```

---

## Arquivos

### Criar:
| Arquivo | Responsabilidade |
|---------|-----------------|
| `src/pages/Revisao.tsx` | Página principal com tabs, filtros, merge de dados |
| `src/components/revisao/RevisionItem.tsx` | Item compacto do checklist |
| `src/components/revisao/RevisionItemExpanded.tsx` | Conteúdo expandido com ações |
| `src/components/revisao/CompletionBanner.tsx` | Banner "Enviar mensagem?" pós-completar |
| `src/components/revisao/SuggestionsSection.tsx` | Sugestões inteligentes colapsáveis |

### Modificar:
| Arquivo | Mudança |
|---------|---------|
| `src/hooks/useScheduledMessages.ts` | Adicionar `useMyScheduledMessages()` |
| `src/components/layout/Sidebar.tsx` | Descomentar aba Revisão |
| `src/components/layout/TopNavigation.tsx` | Descomentar aba Revisão |
| `src/App.tsx` | Trocar componente da rota `/follow-ups` |

### Manter (não deletar):
| Arquivo | Razão |
|---------|-------|
| `src/pages/PipeFollowUps.tsx` | Referência, pode voltar |
| `src/components/followups/*` | Hooks e modais reutilizados |

---

## Fora de escopo

- AutomationSettings (admin configura automações) — acessível via botão na página, modal existente mantido
- Drag-and-drop para reordenar tasks
- Agendamento recorrente
- Notificações push para tasks vencidas
- Integração com calendário externo
