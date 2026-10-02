/**
 * WorkflowPalette — a paleta fixa de blocos à esquerda do canvas (mockup
 * "Automações · Editor").
 *
 * Mesmos grupos e mesmo filtro do menu "Adicionar Nó" (`visibleNodeGroups`):
 * o JavaScript continua oculto, "Pergunta com botões" segue a flag. Clicar num
 * bloco chama o MESMO handler do menu — nada de arrastar, nada de caminho novo.
 */
import { useState } from "react";
import { Plus } from "lucide-react";
import { NODE_COLORS, type WorkflowNodeType } from "@/types/workflow";
import { PillSearch } from "@/shared/components/PillSearch";
import { cn } from "@/lib/utils";
import { visibleNodeGroups } from "./WorkflowToolbar";

export function WorkflowPalette({
  onAddNode,
  hiddenNodeTypes = [],
  questionButtonsEnabled = false,
  className,
}: {
  onAddNode: (type: WorkflowNodeType) => void;
  hiddenNodeTypes?: WorkflowNodeType[];
  questionButtonsEnabled?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const groups = visibleNodeGroups(hiddenNodeTypes, questionButtonsEnabled)
    .map((g) => ({ ...g, options: g.options.filter((o) => !q || o.label.toLowerCase().includes(q)) }))
    .filter((g) => g.options.length > 0);

  return (
    <aside
      aria-label="Blocos do workflow"
      className={cn("flex min-h-0 flex-col rounded-card border border-card-border bg-card shadow-relevo", className)}
    >
      <div className="space-y-2.5 px-4 pb-3 pt-4">
        <p className="flex items-baseline justify-between gap-2">
          <span className="text-[15px] font-extrabold tracking-[-0.02em] text-foreground">Blocos</span>
          <span className="text-[11px] text-muted-foreground">clique para adicionar</span>
        </p>
        <PillSearch value={query} onValueChange={setQuery} placeholder="Buscar bloco" aria-label="Buscar bloco" />
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2.5 pb-4">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-1.5 pb-1 text-[10.5px] font-bold uppercase tracking-[.08em] text-muted-foreground">{group.label}</p>
            <ul className="space-y-0.5">
              {group.options.map((opt) => (
                <li key={opt.type}>
                  <button
                    type="button"
                    onClick={() => onAddNode(opt.type)}
                    className="group flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left text-[13px] font-semibold text-foreground/90 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className={cn(
                        "grid h-7 w-7 shrink-0 place-items-center rounded-[9px] [&_svg]:h-3.5 [&_svg]:w-3.5",
                        NODE_COLORS[opt.type].chip,
                      )}
                    >
                      <opt.icon />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {groups.length === 0 && <p className="px-1.5 text-xs text-muted-foreground">Nenhum bloco com esse nome.</p>}
      </div>
    </aside>
  );
}
