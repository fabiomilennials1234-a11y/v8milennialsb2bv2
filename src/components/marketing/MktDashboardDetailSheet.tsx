import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MktFunnelVisual } from "./MktFunnelVisual";
import type { MktFunnelData } from "@/hooks/useMktFunnel";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

interface MktDashboardDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  variant: "cal" | "cadastro";
  data: MktFunnelData | null;
}

export function MktDashboardDetailSheet({
  open,
  onOpenChange,
  title,
  description,
  variant,
  data,
}: MktDashboardDetailSheetProps) {
  if (!data) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Funil visual */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Funil</CardTitle>
            </CardHeader>
            <CardContent>
              <MktFunnelVisual data={data} variant={variant} />
            </CardContent>
          </Card>

          {/* Investimento */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Investimento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total investido</span>
                <span className="font-semibold">{formatCurrency(data.investimentoReais)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Leads */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Leads</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total de leads</span>
                <span className="font-semibold">{data.leadsCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Custo por lead</span>
                <span className="font-semibold">{formatCurrency(data.custoPorLead)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Agendaram vs só {variant === "cal" ? "quiz" : "cadastro"}</span>
                <span className="font-semibold">{data.pctAgendaramVsSóQuiz}</span>
              </div>
            </CardContent>
          </Card>

          {/* Agendamento */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Agendamento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Agendamentos</span>
                <span className="font-semibold">{data.agendamentosCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Comparecimentos</span>
                <span className="font-semibold">{data.comparecimentosCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Custo por agendamento</span>
                <span className="font-semibold">{formatCurrency(data.custoPorAgendamento)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Custo por comparecimento</span>
                <span className="font-semibold">{formatCurrency(data.custoPorComparecimento)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Só agendaram vs compareceram</span>
                <span className="font-semibold text-right max-w-[60%]">{data.pctCompareceramVsSóAgendaram}</span>
              </div>
            </CardContent>
          </Card>

          {/* Propostas e Vendas */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Propostas e Vendas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Propostas em aberto</span>
                <span className="font-semibold">{data.propostasAbertas}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Propostas fechadas</span>
                <span className="font-semibold">{data.propostasFechadas}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Vendas fechadas</span>
                <span className="font-semibold">{data.vendasCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Custo por venda</span>
                <span className="font-semibold">{formatCurrency(data.custoPorVenda)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Faturamento (só Cal) */}
          {variant === "cal" && data.byFaturamento && Object.keys(data.byFaturamento).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Leads por faturamento</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(data.byFaturamento).map(([faixa, count]) => (
                    <span
                      key={faixa}
                      className="rounded-md bg-muted px-2 py-1 text-xs"
                    >
                      {faixa || "—"}: {count}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
