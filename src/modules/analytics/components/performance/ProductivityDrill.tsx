import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowUpRight, Inbox } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useProductivityDrill,
  type ProductivityCountType,
} from "@/modules/analytics/hooks/useProductivityActivity";

const TITLES: Record<ProductivityCountType, string> = {
  novos_leads: "Novos leads",
  reunioes_marcadas: "Reuniões Marcadas",
  reunioes_realizadas: "Reuniões Realizadas",
  vendido: "Vendido",
};

const ACTION_LABEL: Record<ProductivityCountType, string> = {
  novos_leads: "Entrou em",
  reunioes_marcadas: "Marcada em",
  reunioes_realizadas: "Realizada em",
  vendido: "Vendido em",
};

interface ProductivityDrillProps {
  countType: ProductivityCountType | null;
  from: string;
  to: string;
  seller: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductivityDrill({
  countType,
  from,
  to,
  seller,
  open,
  onOpenChange,
}: ProductivityDrillProps) {
  const navigate = useNavigate();
  const { data: rows, isLoading } = useProductivityDrill(
    open ? countType : null,
    from,
    to,
    seller,
  );

  const title = countType ? TITLES[countType] : "";
  const actionLabel = countType ? ACTION_LABEL[countType] : "Data da ação";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border/60 px-6 py-5">
          <SheetTitle className="flex items-center gap-2 text-lg">
            {title}
            {rows && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                {rows.length}
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            Cada linha mostra a data exata da ação — contagem pela data-da-ação,
            não pela entrada do lead.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="divide-y divide-border/50">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="px-6 py-4">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="mt-2 h-3 w-28" />
                </div>
              ))
            ) : !rows || rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
                <Inbox className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Nenhum registro neste período.
                </p>
              </div>
            ) : (
              rows.map((row) => (
                <button
                  key={`${row.lead_id}-${row.action_at}`}
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    navigate(`/leads?lead=${row.lead_id}`);
                  }}
                  className={cn(
                    "group flex w-full items-center gap-3 px-6 py-4 text-left",
                    "transition-colors hover:bg-secondary/40",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {row.lead_name || "Sem nome"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.company || "—"}
                      {row.seller_name ? ` · ${row.seller_name}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-medium tabular-nums text-foreground/80">
                      {row.action_at
                        ? format(new Date(row.action_at), "dd MMM yyyy", {
                            locale: ptBR,
                          })
                        : "—"}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      {actionLabel.replace(" em", "")}
                      {row.action_at
                        ? ` · ${format(new Date(row.action_at), "HH:mm", { locale: ptBR })}`
                        : ""}
                    </p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-primary" />
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
