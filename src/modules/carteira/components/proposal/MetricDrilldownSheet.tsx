import { useState, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MetricType, DrilldownRow } from "@/modules/carteira/hooks/useMetricDrilldown";

const METRIC_TITLES: Record<MetricType, string> = {
  pipeline_ativo: "Pipeline Ativo",
  vendas_total: "Vendas Total",
  rec_vendida: "Rec. Vendida",
  projetos_vendidos: "Projetos Vendidos",
  taxa_conversao: "Taxa de Conversão",
};

const STATUS_COLORS: Record<string, string> = {
  vendido: "bg-green-500/20 text-green-400 border-green-500/30",
  perdido: "bg-red-500/20 text-red-400 border-red-500/30",
  proposta_enviada: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  compromisso_marcado: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  marcar_compromisso: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  esfriou: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  futuro: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  reativar: "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  vendido: "Vendido",
  perdido: "Perdido",
  proposta_enviada: "Proposta Enviada",
  compromisso_marcado: "R2 Marcada",
  marcar_compromisso: "Marcar R2",
  esfriou: "Esfriou",
  futuro: "Futuro",
  reativar: "Reativar",
};

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  mrr: "MRR",
  projeto: "Projeto",
  unitario: "Unitário",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatCurrency(value: number | null): string {
  if (value == null) return "R$ 0";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

interface MetricDrilldownSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectItem: (leadId: string) => void;
  metricType: MetricType;
  displayValue: string;
  displayCount: number;
  periodLabel: string;
  data: DrilldownRow[];
  isLoading: boolean;
}

export function MetricDrilldownSheet({
  isOpen,
  onClose,
  onSelectItem,
  metricType,
  displayValue,
  displayCount,
  periodLabel,
  data,
  isLoading,
}: MetricDrilldownSheetProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const term = search.toLowerCase();
    return data.filter(
      (r) =>
        r.lead?.name?.toLowerCase().includes(term) ||
        r.lead?.company?.toLowerCase().includes(term)
    );
  }, [data, search]);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[480px] flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/50">
          <SheetTitle className="text-lg font-semibold">
            {METRIC_TITLES[metricType]}
          </SheetTitle>
          <p className="text-2xl font-bold text-primary">{displayValue}</p>
          <p className="text-sm text-muted-foreground">
            {displayCount} propostas · {periodLabel}
          </p>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar lead ou empresa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Carregando...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <span>Nenhuma proposta encontrada</span>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {filtered.map((row) => (
                <div
                  key={row.id}
                  onClick={() => onSelectItem(row.lead_id)}
                  className="px-6 py-3 hover:bg-accent/50 cursor-pointer transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">
                        {row.lead?.name ?? "Sem nome"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {row.lead?.company ?? "—"}
                      </p>
                    </div>
                    <p className="text-sm font-semibold whitespace-nowrap">
                      {formatCurrency(row.sale_value)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] px-1.5 py-0",
                        STATUS_COLORS[row.status] ?? "bg-muted text-muted-foreground"
                      )}
                    >
                      {STATUS_LABELS[row.status] ?? row.status}
                    </Badge>
                    {row.product_type && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {PRODUCT_TYPE_LABELS[row.product_type] ?? row.product_type}
                      </Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {formatDate(row.closed_at ?? row.created_at)}
                    </span>
                    {row.responsible?.name && (
                      <span className="text-[10px] text-muted-foreground">
                        · {row.responsible.name}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
