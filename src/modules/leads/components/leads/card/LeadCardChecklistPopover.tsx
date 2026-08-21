import { memo, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, CheckSquare, ChevronDown, ChevronRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useChecklistItems,
  useToggleChecklistItem,
  useLeadChecklists,
} from "@/modules/engagement";
import type {
  ChecklistItem,
  ChecklistWithCounts,
} from "@/modules/engagement";
import type { LeadMetrics } from "@/modules/leads/hooks/useBatchedLeadMetrics";
import { cn } from "@/lib/utils";

/**
 * LeadCardChecklistPopover
 *
 * Badge `N/M` de checklists do LeadCard vira trigger de Popover (read + toggle).
 * Permite confirmar pontos SEM abrir o modal do lead.
 *
 * - Counter do badge vem dos props (origem: `useBatchedLeadMetrics`) — header
 *   renderiza com N/M imediato, zero salto durante o load da lista.
 * - Lista de checklists (lead-scoped) carrega lazy: query só dispara quando o
 *   popover abre (`enabled` atrelado ao `open`).
 * - Itens carregam via `useChecklistItems` (já assina realtime de
 *   `checklist_items`). O hook lead-scoped NÃO adiciona subscription redundante.
 * - Toggle é otimista (rollback + toast no hook). Além da invalidação de
 *   `["checklists"]` feita pelo hook, patcheamos `["lead-card-metrics"]` aqui
 *   pra o badge do card refletir o toggle no mesmo frame (sem esperar o
 *   debounce de 2s do realtime).
 *
 * Multi-tenancy: `useLeadChecklists` filtra por `organization_id`. RLS é o gate.
 */

interface LeadCardChecklistPopoverProps {
  leadId: string;
  completed: number;
  total: number;
  /**
   * Gatilho alternativo. Sem isto o gatilho é o badge `N/M` — que serve ao
   * card confortável, onde ele vive no rodapé de métricas.
   *
   * O card do funil (compacto, na anatomia DataCrazy) precisa que o gatilho
   * seja a LINHA de atividades inteira, com ícone e prosa. Só o conteúdo
   * muda: o `<button>`, o `stopPropagation` do dnd-kit e o do clique do card
   * continuam sendo deste componente, porque é onde o erro dói.
   */
  children?: ReactNode;
  /** Classe do gatilho quando `children` é usado. */
  triggerClassName?: string;
}

export const LeadCardChecklistPopover = memo(function LeadCardChecklistPopover({
  leadId,
  completed,
  total,
  children,
  triggerClassName,
}: LeadCardChecklistPopoverProps) {
  const [open, setOpen] = useState(false);
  const done = total > 0 && completed === total;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          // dnd-kit: não iniciar drag ao abrir o popover.
          onPointerDown={(e) => e.stopPropagation()}
          // Card root tem onClick → abre modal do lead. Sem isto, clicar no
          // badge abre o popover E o modal (click borbulha pro root). Cobre
          // mouse + ativação por teclado (Enter/Space disparam click).
          onClick={(e) => e.stopPropagation()}
          aria-label={`Checklists: ${completed} de ${total} itens concluídos`}
          className={cn(
            children
              ? cn("w-full min-w-0 text-left", triggerClassName)
              : cn(
                  "flex items-center gap-1 px-1 py-px rounded cursor-pointer select-none transition-colors duration-150",
                  "data-[state=open]:bg-muted/70 data-[state=open]:text-foreground",
                  done
                    ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                    : "text-foreground/70 hover:bg-muted/70 hover:text-foreground",
                ),
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1 focus-visible:ring-offset-card",
          )}
        >
          {children ?? (
            <>
              <CheckSquare className="w-3 h-3 shrink-0" />
              <span className="tabular-nums">
                {completed}/{total}
              </span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        className="w-64 max-h-[min(360px,60vh)] overflow-y-auto scrollbar-hide p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ChecklistPopoverBody
          leadId={leadId}
          completed={completed}
          total={total}
          open={open}
        />
      </PopoverContent>
    </Popover>
  );
});

interface ChecklistPopoverBodyProps {
  leadId: string;
  completed: number;
  total: number;
  open: boolean;
}

function ChecklistPopoverBody({
  leadId,
  completed,
  total,
  open,
}: ChecklistPopoverBodyProps) {
  const {
    data: checklists = [],
    isLoading,
    isError,
    refetch,
  } = useLeadChecklists(open ? leadId : null);

  const done = total > 0 && completed === total;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
  const single = checklists.length === 1;

  return (
    <div>
      {/* Header sticky com N/M dos props (zero salto durante load) */}
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-popover border-b border-border/40 px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex-1">
          Checklists
        </span>
        {done && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Tudo pronto
          </span>
        )}
        <div className="flex items-center gap-1.5 shrink-0">
          <Progress
            value={progress}
            className={cn(
              "h-px w-12 bg-muted/60",
              done && "[&>div]:bg-emerald-500",
            )}
          />
          <span
            className={cn(
              "text-[11px] tabular-nums",
              done ? "text-emerald-400" : "text-muted-foreground",
            )}
          >
            {completed}/{total}
          </span>
        </div>
      </div>

      <div className="p-1.5">
        {isLoading ? (
          <ChecklistSkeleton />
        ) : isError ? (
          <div className="flex flex-col items-center gap-1.5 py-4 text-center">
            <p className="text-[11px] text-muted-foreground">
              Não foi possível carregar
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="text-[11px] font-medium text-foreground/80 hover:text-foreground underline underline-offset-2"
            >
              Tentar de novo
            </button>
          </div>
        ) : checklists.length === 0 ? (
          /* Copy corrigida: o que está vazio aqui é a LISTA de checklists do
             lead, não os itens de um checklist. A frase antiga descrevia o
             outro estado vazio (o de dentro de um grupo, linha ~350). */
          <p className="px-2 py-3 text-[11px] text-muted-foreground text-center">
            Nenhum checklist neste lead
          </p>
        ) : single ? (
          <SingleChecklist checklist={checklists[0]} leadId={leadId} />
        ) : (
          <div className="space-y-0.5">
            {checklists.map((cl) => (
              <ChecklistGroup key={cl.id} checklist={cl} leadId={leadId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChecklistSkeleton() {
  const widths = ["70%", "85%", "55%", "78%"];
  return (
    <div className="space-y-1 px-2 py-1">
      {widths.map((w, i) => (
        <div
          key={i}
          className="h-5 rounded bg-muted/40 animate-pulse"
          style={{ width: w }}
        />
      ))}
    </div>
  );
}

interface SingleChecklistProps {
  checklist: ChecklistWithCounts;
  leadId: string;
}

function SingleChecklist({ checklist, leadId }: SingleChecklistProps) {
  return (
    <div>
      <p className="px-2 pt-1 pb-1.5 text-[10px] text-muted-foreground/70 truncate">
        {checklist.title}
      </p>
      <ChecklistItemsList checklistId={checklist.id} leadId={leadId} />
    </div>
  );
}

interface ChecklistGroupProps {
  checklist: ChecklistWithCounts;
  leadId: string;
}

function ChecklistGroup({ checklist, leadId }: ChecklistGroupProps) {
  const groupDone =
    checklist.total_items > 0 &&
    checklist.completed_items === checklist.total_items;
  // Checklist 100% num lead com 2+ abre COLAPSADO; demais expandidos por padrão.
  const [expanded, setExpanded] = useState(!groupDone);
  const reduceMotion = useReducedMotion();

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1 rounded-[5px] hover:bg-muted/50 text-left transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground/60 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground/60 shrink-0" />
        )}
        <span className="text-[11px] font-medium truncate flex-1">
          {checklist.title}
        </span>
        <span
          className={cn(
            "text-[10px] tabular-nums shrink-0",
            groupDone ? "text-emerald-400" : "text-muted-foreground",
          )}
        >
          {checklist.completed_items}/{checklist.total_items}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
            className="overflow-hidden"
          >
            <ChecklistItemsList checklistId={checklist.id} leadId={leadId} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface ChecklistItemsListProps {
  checklistId: string;
  leadId: string;
}

const ChecklistItemsList = memo(function ChecklistItemsList({
  checklistId,
  leadId,
}: ChecklistItemsListProps) {
  const { data: items = [] } = useChecklistItems(checklistId);
  const toggleItem = useToggleChecklistItem();
  const queryClient = useQueryClient();

  const handleToggle = (item: ChecklistItem) => {
    const next = !item.is_completed;
    // Patch imediato do badge do card (["lead-card-metrics", sortedIds...]):
    // prefixo-match cobre todas as variações de sortedIds em cache. O hook já
    // patcha ["checklists"] e faz rollback/toast no erro. Aqui só adiantamos o
    // badge — o realtime (debounce 2s) reconcilia o número final.
    const delta = next ? 1 : -1;
    queryClient.setQueriesData<Record<string, LeadMetrics>>(
      { queryKey: ["lead-card-metrics"] },
      (old) => {
        const m = old?.[leadId];
        if (!m) return old;
        return {
          ...old,
          [leadId]: {
            ...m,
            checklistsCompleted: Math.max(
              0,
              Math.min(m.checklistsTotal, m.checklistsCompleted + delta),
            ),
          },
        };
      },
    );

    toggleItem.mutate({
      id: item.id,
      checklist_id: checklistId,
      is_completed: next,
    });
  };

  return (
    <div className="space-y-px">
      {items.map((item) => (
        <label
          key={item.id}
          className="group flex items-center gap-2 px-2 py-1 rounded-[5px] hover:bg-muted/50 cursor-pointer transition-colors text-[11px] leading-snug"
        >
          <Checkbox
            checked={item.is_completed}
            onCheckedChange={() => handleToggle(item)}
            className="size-3.5 rounded-[4px] shrink-0 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500 data-[state=checked]:text-white"
          />
          <span
            className={cn(
              "flex-1 min-w-0 transition-all duration-150",
              item.is_completed
                ? "line-through text-muted-foreground/60"
                : "text-foreground/85 group-hover:text-foreground",
            )}
          >
            {item.title}
          </span>
        </label>
      ))}
      {items.length === 0 && (
        <p className="px-2 py-1.5 text-[11px] text-muted-foreground/70">
          Nenhum item neste checklist
        </p>
      )}
    </div>
  );
});
