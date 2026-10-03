/**
 * Contracts — tipo base de item arrastável no Kanban.
 *
 * Movido de `pipelines/components/kanban/DraggableKanbanBoard` para contracts
 * para que `LeadCard` (em `leads`) consuma sem import direto de `pipelines`.
 * `DraggableKanbanBoard` re-exporta este tipo (API pública inalterada).
 */
export interface DraggableItem {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
