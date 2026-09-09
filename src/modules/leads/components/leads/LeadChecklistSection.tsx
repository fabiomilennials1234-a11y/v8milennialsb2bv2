import { useState, memo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  useChecklistTemplates,
  useApplyChecklistTemplate,
} from "@/modules/engagement";
import { cn } from "@/lib/utils";
import type { ChecklistWithCounts } from "@/modules/engagement";

interface LeadChecklistItemsProps {
  checklistId: string;
}

const LeadChecklistItems = memo(function LeadChecklistItems({ checklistId }: LeadChecklistItemsProps) {
  const { data: items = [] } = useChecklistItems(checklistId);
  const toggleItem = useToggleChecklistItem();

  return (
    <div className="space-y-1 mt-2">
      {items.map((item) => (
        <label
          key={item.id}
          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 transition-colors cursor-pointer text-xs"
        >
          <input
            type="checkbox"
            checked={item.is_completed}
            onChange={() => toggleItem.mutate({ id: item.id, checklist_id: checklistId, is_completed: !item.is_completed })}
            className="rounded border-muted-foreground/40 text-primary focus:ring-primary/20"
          />
          <span className={cn("flex-1", item.is_completed && "line-through text-muted-foreground")}>
            {item.title}
          </span>
        </label>
      ))}
    </div>
  );
});

interface ChecklistRowProps {
  checklist: ChecklistWithCounts;
}

const ChecklistRow = memo(function ChecklistRow({ checklist }: ChecklistRowProps) {
  const [expanded, setExpanded] = useState(false);
  const progress = checklist.total_items > 0
    ? Math.round((checklist.completed_items / checklist.total_items) * 100)
    : 0;

  return (
    <div className="rounded-lg border border-border bg-card/50">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 p-2 text-left hover:bg-muted/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
        <span className="text-xs font-medium truncate flex-1">{checklist.title}</span>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {checklist.completed_items}/{checklist.total_items}
        </span>
      </button>
      <div className="px-2 pb-1">
        <Progress value={progress} className="h-1" />
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden px-2 pb-2"
          >
            <LeadChecklistItems checklistId={checklist.id} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

interface LeadChecklistSectionProps {
  leadId: string;
}

export const LeadChecklistSection = memo(function LeadChecklistSection({ leadId }: LeadChecklistSectionProps) {
  const { data: checklists = [], isLoading } = useLeadChecklists(leadId);
  const { data: templates = [] } = useChecklistTemplates();
  const applyTemplate = useApplyChecklistTemplate();

  if (isLoading) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
          <ClipboardList className="w-3.5 h-3.5" />
          Checklists
        </h3>
        {/* `modal`: este Popover vive dentro de um Dialog — o `LeadContactModal`
            do chat (`LeadContactModal.tsx:22`) —, cujo `react-remove-scroll`
            engole o `wheel` de tudo que sai por portal. Sem isto o
            `max-h-40 overflow-y-auto` da lista de templates (:136) não rola com
            a roda do mouse. Mesmo conserto das #1862/#1867. */}
        {templates.length > 0 && (
          <Popover modal>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                <Plus className="w-3 h-3" /> Aplicar Template
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="end">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Selecionar template</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={applyTemplate.isPending}
                    onClick={() => applyTemplate.mutate({ templateId: t.id, leadId })}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-accent transition-colors text-left"
                  >
                    <ClipboardList className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="truncate block">{t.title}</span>
                      <span className="text-[10px] text-muted-foreground">{t.total_items} itens</span>
                    </div>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {checklists.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum checklist vinculado</p>
      ) : (
        <div className="space-y-2">
          {checklists.map((cl) => (
            <ChecklistRow key={cl.id} checklist={cl} />
          ))}
        </div>
      )}
    </div>
  );
});
