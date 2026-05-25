import { memo, useState } from "react";
import {
  ChevronDown, ChevronRight, Plus, ClipboardCheck, Loader2, Trash2, MoreHorizontal,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useChecklistItems,
  useCreateChecklist,
  useDeleteChecklist,
  useCreateChecklistItem,
  useToggleChecklistItem,
  useDeleteChecklistItem,
  type ChecklistWithCounts,
} from "@/hooks/useChecklists";
import { useOrganization } from "@/hooks/useOrganization";
import { cn } from "@/lib/utils";

/**
 * Aba compacta de checklists do lead. Vai acima de Histórico & Comentários
 * na coluna de atividade do modal.
 *
 * Comportamento:
 *  - Vazia → mostra só um CTA fino "+ Adicionar checklist"
 *  - Com checklists → expansível, mostra progress + itens; altura cresce
 *    naturalmente com a lista
 */

function useLeadChecklists(leadId: string | null) {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ["checklists", "lead", leadId],
    queryFn: async (): Promise<ChecklistWithCounts[]> => {
      if (!leadId || !organizationId) return [];
      const { data, error } = await supabase
        .from("checklists")
        .select("*, checklist_items(id, is_completed)")
        .eq("organization_id", organizationId)
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((c: any) => {
        const items = c.checklist_items ?? [];
        return {
          ...c,
          checklist_items: undefined,
          total_items: items.length,
          completed_items: items.filter((i: any) => i.is_completed).length,
        } as ChecklistWithCounts;
      });
    },
    enabled: !!leadId && !!organizationId,
    staleTime: 30_000,
  });
}

interface LeadModalChecklistProps {
  leadId: string;
}

export const LeadModalChecklist = memo(function LeadModalChecklist({ leadId }: LeadModalChecklistProps) {
  const { data: checklists = [], isLoading } = useLeadChecklists(leadId);
  const createChecklist = useCreateChecklist();
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const totalItems    = checklists.reduce((s, c) => s + c.total_items, 0);
  const completedItems = checklists.reduce((s, c) => s + c.completed_items, 0);
  const allDone = totalItems > 0 && completedItems === totalItems;

  const handleCreateChecklist = async () => {
    const title = newTitle.trim();
    if (!title) {
      setCreating(false);
      return;
    }
    try {
      const created = await createChecklist.mutateAsync({ title, lead_id: leadId });
      setNewTitle("");
      setCreating(false);
      if (created?.id) setExpanded((e) => ({ ...e, [created.id]: true }));
    } catch {
      // toast já tratado no hook
    }
  };

  return (
    <section className="border border-border/40 rounded-xl bg-card/30 overflow-hidden">
      {/* Header da aba */}
      <header className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
          <ClipboardCheck className="w-3.5 h-3.5" />
          <span>Checklist</span>
          {totalItems > 0 && (
            <span
              className={cn(
                "ml-1 px-1.5 py-0.5 rounded-full text-[10px] normal-case tracking-normal font-medium",
                allDone
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-muted/60 text-foreground/70",
              )}
            >
              {completedItems}/{totalItems}
            </span>
          )}
        </div>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="w-3 h-3" />
            Novo
          </button>
        )}
      </header>

      {/* Progress bar fino */}
      {totalItems > 0 && (
        <div className="h-0.5 bg-muted/40">
          <div
            className={cn("h-full transition-all", allDone ? "bg-emerald-500" : "bg-primary")}
            style={{ width: `${(completedItems / totalItems) * 100}%` }}
          />
        </div>
      )}

      {/* Form criar novo */}
      {creating && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-border/30">
          <Input
            value={newTitle}
            autoFocus
            placeholder="Título do checklist..."
            className="h-7 text-xs"
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateChecklist();
              if (e.key === "Escape") { setCreating(false); setNewTitle(""); }
            }}
            onBlur={handleCreateChecklist}
          />
        </div>
      )}

      {/* Empty state */}
      {!creating && !isLoading && checklists.length === 0 && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="w-full px-3 py-2 text-[11px] text-muted-foreground/60 hover:text-foreground hover:bg-muted/30 transition-colors text-left flex items-center gap-1.5 border-t border-border/30"
        >
          <Plus className="w-3 h-3" />
          Adicionar checklist
        </button>
      )}

      {/* Lista de checklists */}
      {checklists.length > 0 && (
        <ul className="divide-y divide-border/30 border-t border-border/30">
          {checklists.map((c) => (
            <ChecklistRow
              key={c.id}
              checklist={c}
              isExpanded={expanded[c.id] ?? c.total_items === 0}
              onToggleExpanded={() => setExpanded((e) => ({ ...e, [c.id]: !(e[c.id] ?? c.total_items === 0) }))}
            />
          ))}
        </ul>
      )}
    </section>
  );
});

// ─── Item row ────────────────────────────────────────────

function ChecklistRow({
  checklist, isExpanded, onToggleExpanded,
}: {
  checklist: ChecklistWithCounts;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}) {
  const { data: items = [] } = useChecklistItems(checklist.id);
  const toggleItem = useToggleChecklistItem();
  const createItem = useCreateChecklistItem();
  const deleteItem = useDeleteChecklistItem();
  const deleteChecklist = useDeleteChecklist();
  const [addingItem, setAddingItem] = useState(false);
  const [itemTitle, setItemTitle] = useState("");

  const done = checklist.completed_items === checklist.total_items && checklist.total_items > 0;

  const handleAddItem = async () => {
    const title = itemTitle.trim();
    if (!title) {
      setAddingItem(false);
      return;
    }
    try {
      await createItem.mutateAsync({
        checklist_id: checklist.id,
        title,
        position: items.length,
      });
      setItemTitle("");
    } catch {
      // hook toast
    }
  };

  const handleDeleteChecklist = async () => {
    if (!window.confirm(`Remover checklist "${checklist.title}"?`)) return;
    await deleteChecklist.mutateAsync(checklist.id);
  };

  return (
    <li>
      <div className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-muted/20 transition-colors">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="text-muted-foreground/60 hover:text-foreground transition-colors"
          aria-label={isExpanded ? "Colapsar" : "Expandir"}
        >
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <span
          className={cn(
            "flex-1 text-xs font-medium truncate",
            done && "line-through text-muted-foreground/60",
          )}
        >
          {checklist.title}
        </span>
        <span className="text-[10px] text-muted-foreground/60 font-mono tabular-nums">
          {checklist.completed_items}/{checklist.total_items}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground/40 hover:text-foreground p-0.5 rounded transition-colors"
              aria-label="Opções"
            >
              <MoreHorizontal className="w-3 h-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setAddingItem(true)}>
              <Plus className="w-3.5 h-3.5 mr-2" /> Adicionar item
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDeleteChecklist} className="text-destructive focus:text-destructive">
              <Trash2 className="w-3.5 h-3.5 mr-2" /> Remover checklist
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isExpanded && (
        <div className="pl-7 pr-3 pb-1.5">
          <ul className="space-y-px">
            {items.map((item) => (
              <li
                key={item.id}
                className="group flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-muted/20"
              >
                <button
                  type="button"
                  onClick={() =>
                    toggleItem.mutate({ id: item.id, checklist_id: checklist.id, is_completed: !item.is_completed })
                  }
                  className="shrink-0 flex items-center justify-center w-6 h-6 cursor-pointer"
                  aria-pressed={item.is_completed}
                >
                  <span
                    className={cn(
                      "w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors",
                      item.is_completed
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : "border-muted-foreground/30 hover:border-primary",
                    )}
                  >
                    {item.is_completed && <span className="text-[8px] leading-none font-bold">✓</span>}
                  </span>
                </button>
                <span
                  className={cn(
                    "flex-1 text-[11px] truncate",
                    item.is_completed && "line-through text-muted-foreground/60",
                  )}
                >
                  {item.title}
                </span>
                <button
                  type="button"
                  onClick={() => deleteItem.mutate(item.id)}
                  className="text-muted-foreground/30 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                  aria-label="Remover item"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
          {addingItem ? (
            <Input
              autoFocus
              value={itemTitle}
              placeholder="Novo item..."
              className="h-6 text-[11px] mt-1"
              onChange={(e) => setItemTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddItem();
                if (e.key === "Escape") { setAddingItem(false); setItemTitle(""); }
              }}
              onBlur={handleAddItem}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingItem(true)}
              className="w-full mt-1 px-1 py-1 text-[10px] text-muted-foreground/50 hover:text-foreground hover:bg-muted/20 rounded transition-colors text-left flex items-center gap-1"
            >
              {createItem.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Plus className="w-3 h-3" />
              )}
              Adicionar item
            </button>
          )}
        </div>
      )}
    </li>
  );
}
