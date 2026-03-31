# Checklists — Design Spec

**Data:** 2026-03-27
**Status:** Aprovado
**Abordagem:** Dominio novo isolado (baixo acoplamento, zero risco de regressao)

---

## Objetivo

Implementar um sistema de checklist funcional, separado de `follow_ups` e `acoes_do_dia`, com UI consistente ao sistema existente, multi-tenant, e com permissoes proprias.

## Decisoes de Design

1. **Dominio novo** — tabelas `checklists` e `checklist_items` independentes, sem alterar tabelas existentes
2. **Navegacao** — item novo no sidebar principal com icone `ListChecks`
3. **Visualizacao** — lista de cards expandiveis com progresso inline (consistente com AcoesDoDia/FollowUpCard)
4. **Vinculo com lead** — campo `lead_id` opcional na criacao, sem exibicao na ficha do lead no MVP
5. **Permissoes** — novo recurso `checklists` no RESOURCE_KEYS, separado de `tarefas` (que pertence a follow-ups)

## Modelagem de Dados

### Tabela `checklists`

| Coluna | Tipo | Notas |
|--------|------|-------|
| `id` | UUID PK | `gen_random_uuid()` |
| `organization_id` | UUID FK -> `organizations` | NOT NULL, multi-tenant |
| `created_by` | UUID FK -> `team_members` | NOT NULL |
| `title` | TEXT | NOT NULL |
| `description` | TEXT | Opcional |
| `lead_id` | UUID FK -> `leads` | Opcional, ON DELETE SET NULL |
| `is_completed` | BOOLEAN | DEFAULT false, atualizado pelo frontend quando todos os itens forem concluidos |
| `created_at` | TIMESTAMPTZ | DEFAULT now() |
| `updated_at` | TIMESTAMPTZ | DEFAULT now(), trigger automatico |

### Tabela `checklist_items`

| Coluna | Tipo | Notas |
|--------|------|-------|
| `id` | UUID PK | `gen_random_uuid()` |
| `checklist_id` | UUID FK -> `checklists` | NOT NULL, ON DELETE CASCADE |
| `title` | TEXT | NOT NULL |
| `is_completed` | BOOLEAN | DEFAULT false |
| `position` | INTEGER | DEFAULT 0, ordenacao persistente |
| `completed_at` | TIMESTAMPTZ | Timestamp de conclusao |
| `created_at` | TIMESTAMPTZ | DEFAULT now() |
| `updated_at` | TIMESTAMPTZ | DEFAULT now(), trigger automatico |

### RLS

- Ambas as tabelas com RLS habilitado
- Policies baseadas em `organization_id` via `team_members`
- SELECT/INSERT/UPDATE/DELETE para membros da organizacao
- `checklist_items` herda acesso via join com `checklists.organization_id`

### Indices

- `checklists(organization_id)`
- `checklist_items(checklist_id, position)`

## Hook: `useChecklists.ts`

### Queries

- `useChecklists()` — lista checklists da organizacao com contagem de itens (total/concluidos)
- `useChecklistItems(checklistId)` — itens de um checklist, ordenados por `position`

### Mutations

- `useCreateChecklist()` — cria com title, description?, lead_id?
- `useUpdateChecklist()` — edita titulo/descricao
- `useDeleteChecklist()` — remove (cascade nos itens)
- `useCreateChecklistItem()` — adiciona item com position = proximo da sequencia
- `useUpdateChecklistItem()` — edita titulo
- `useToggleChecklistItem()` — alterna is_completed + completed_at
- `useDeleteChecklistItem()` — remove item
- `useReorderChecklistItems()` — atualiza position em batch

### Padroes

- `useOrganization()` para organizationId e isReady
- `useRealtimeSubscription` para ambas as tabelas
- Toast via `sonner`
- Query keys: `["checklists", organizationId]` e `["checklist_items", checklistId]`
- staleTime: 5 min, gcTime: 10 min

## Componentes de UI

### `ChecklistPage.tsx` (pagina em `/checklists`)

- Header com titulo + botao "Novo Checklist"
- Lista de ChecklistCards
- Estado vazio com ilustracao
- Loading state com spinner

### `ChecklistCard.tsx` (card expandivel)

- Titulo + barra de progresso (X/Y itens concluidos)
- Botao expandir/recolher
- Ao expandir: lista de ChecklistItemRow + input para novo item
- Acoes: editar titulo, deletar checklist
- Badge de lead vinculado (se houver)
- Framer Motion para animacoes (consistente com FollowUpCard)
- `memo()` para performance

### `ChecklistItemRow.tsx` (linha de item)

- Checkbox para toggle conclusao
- Texto com edicao inline (clique para editar)
- Botao remover (icone trash)
- Estilo riscado quando concluido
- Framer Motion para entrada/saida

### `CreateChecklistDialog.tsx` (modal de criacao)

- Campo titulo (obrigatorio)
- Campo descricao (opcional)
- Select de lead (opcional, busca na organizacao)
- Botoes cancelar/criar

## Integracao com Sistema Existente

### Sidebar (`Sidebar.tsx`)

- Novo item: `{ label: "Checklists", icon: ListChecks, path: "/checklists" }`
- Posicionado apos Follow-ups
- Mapeamento de permissao: `"/checklists": "checklists.view"`

### Rota (`App.tsx`)

- `/checklists` como rota protegida, seguindo padrao existente

### Permissoes (`useTeamMemberPermissions.ts`)

- Adicionar `"checklists"` ao `RESOURCE_KEYS`
- Label: `"Checklists"`
- Acoes suportadas: create, view, edit, delete

### Supabase Types (`types.ts`)

- Adicionar tipos para `checklists` e `checklist_items`

## Arquivos que SERAO Criados/Alterados

### Novos arquivos:

- `supabase/migrations/XXXXXXXX_create_checklists.sql`
- `src/hooks/useChecklists.ts`
- `src/pages/ChecklistPage.tsx`
- `src/components/checklists/ChecklistCard.tsx`
- `src/components/checklists/ChecklistItemRow.tsx`
- `src/components/checklists/CreateChecklistDialog.tsx`

### Arquivos alterados (minimo impacto):

- `src/App.tsx` — adicionar rota `/checklists`
- `src/components/layout/Sidebar.tsx` — adicionar item de navegacao + mapeamento de permissao
- `src/hooks/useTeamMemberPermissions.ts` — adicionar recurso `checklists`
- `src/integrations/supabase/types.ts` — adicionar tipos das novas tabelas

## Arquivos que NAO serao alterados

- `src/hooks/useFollowUps.ts`
- `src/hooks/useAcoesDoDia.ts`
- `src/components/followups/AcoesDoDia.tsx`
- `src/components/followups/FollowUpCard.tsx`
- `src/components/followups/ScheduleFollowUpModal.tsx`
- `src/pages/PipeFollowUps.tsx`
- `supabase/functions/process-followup-automations/index.ts`
- Nenhuma migration existente
- Nenhuma logica de notificacoes

## Restricoes

- Alteracoes de banco somente no ambiente develop
- Nenhuma alteracao em .env (somente .env.development se necessario)
- Relatorio de alteracoes de banco obrigatorio apos cada mudanca
- Zero refatoracao fora do escopo

## Evolucoes Futuras (fora do MVP)

- Exibir checklists na ficha do lead
- Templates de checklist reutilizaveis
- Atribuicao de itens individuais a membros
- Drag-and-drop para reordenacao de itens
- Integracao com automacoes (criar checklist automaticamente)
- Notificacoes de prazo
- Vinculo bidirecional com follow-ups e acoes_do_dia
