import { memo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ORIGIN_COLORS, type LeadCardData, type LeadCardVariant } from "@/modules/leads";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { KanbanColumn } from "@/components/kanban/DraggableKanbanBoard";

interface PipeTableViewProps {
  columns: KanbanColumn<LeadCardData>[];
  variant: LeadCardVariant;
  isLoading?: boolean;
  onRowClick?: (card: LeadCardData) => void;
  selectedIds?: Set<string>;
  onSelect?: (leadId: string, e: React.MouseEvent) => void;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
  }).format(value);
}

export const PipeTableView = memo(function PipeTableView({
  columns,
  variant,
  isLoading,
  onRowClick,
  selectedIds,
  onSelect,
}: PipeTableViewProps) {
  const allItems = columns.flatMap((col) =>
    col.items.map((item) => ({ ...item, _stageId: col.id, _stageTitle: col.title, _stageColor: col.color }))
  );

  const showValue = variant === "propostas" || variant === "whatsapp";
  const showDate = variant === "confirmacao" || variant === "propostas";

  if (isLoading) {
    return (
      <div className="border border-border rounded-lg overflow-hidden">
        <Table>
          <TableBody>
            {Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={7}>
                  <Skeleton className="h-10 w-full" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Lead</TableHead>
            <TableHead>Etapa</TableHead>
            <TableHead>Origem</TableHead>
            <TableHead>Responsavel</TableHead>
            {showValue && <TableHead>Valor</TableHead>}
            {showDate && <TableHead>Data</TableHead>}
            <TableHead>Criado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {allItems.length === 0 ? (
            <TableRow>
              <TableCell colSpan={showValue && showDate ? 7 : showValue || showDate ? 6 : 5} className="text-center py-8 text-muted-foreground">
                Nenhum item encontrado
              </TableCell>
            </TableRow>
          ) : (
            allItems.map((item) => {
              const origin = ORIGIN_COLORS[item.origin || "outro"] || ORIGIN_COLORS.outro;
              const isSelected = selectedIds?.has(item.leadId || "");

              return (
                <TableRow
                  key={item.id}
                  className={cn("cursor-pointer hover:bg-muted/50", isSelected && "bg-primary/5")}
                  onClick={() => onRowClick?.(item)}
                >
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{item.name}</p>
                      {item.company && (
                        <p className="text-xs text-muted-foreground">{item.company}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 h-[18px] font-medium"
                      style={{
                        backgroundColor: `${item._stageColor}15`,
                        color: item._stageColor,
                        borderColor: `${item._stageColor}40`,
                      }}
                    >
                      {item._stageTitle}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 h-[18px] font-medium"
                      style={{ backgroundColor: origin.bg, color: origin.text, borderColor: `${origin.text}30` }}
                    >
                      {origin.label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {item.responsible ? (
                      <span className="text-xs">{item.responsible}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  {showValue && (
                    <TableCell>
                      {item.value != null && item.value > 0 ? (
                        <span className="text-xs font-semibold text-emerald-500">
                          {formatCurrency(item.value)}
                        </span>
                      ) : item.faturamento ? (
                        <span className="text-xs text-muted-foreground">
                          {typeof item.faturamento === "number" ? formatCurrency(item.faturamento) : `R$ ${item.faturamento}`}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  )}
                  {showDate && (
                    <TableCell>
                      {item.dateLabel ? (
                        <span className="text-xs">{item.dateLabel}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    {item.createdAt && (
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: ptBR })}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
});
