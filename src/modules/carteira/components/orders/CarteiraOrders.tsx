import { useEffect, useMemo, useState, type ElementType } from "react";
import { ArrowRight, CheckCircle2, Hourglass, Search, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FocusCard, FocusTile, InkPanel } from "@/components/ui/bento";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { usePendingOrders, useOrderStatusCounts } from "@/modules/carteira/hooks/useOrderApproval";
import { useIdentity } from "@/modules/identity";
import {
  useCarteiraOrders,
  type CarteiraOrderRow,
} from "@/modules/carteira/hooks/useCarteiraOrders";
import { OrdersTable } from "./OrdersTable";
import { EditOrderDialog } from "./EditOrderDialog";

interface CarteiraOrdersProps {
  /** Busca compartilhada com o resto da Carteira. */
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  /** "Revisar fila" — leva para a aba Aprovações. */
  onReviewQueue?: () => void;
}

/** Uma etapa da esteira, sobre a tinta. */
function StageTile({
  step,
  icon: Icon,
  title,
  hint,
  count,
  value,
  tone,
}: {
  step: string;
  icon: ElementType;
  title: string;
  hint: string;
  count: number | undefined;
  value?: string;
  tone: "warn" | "good" | "bad";
}) {
  return (
    <div className="flex min-h-[148px] min-w-0 flex-col rounded-2xl border border-white/10 bg-white/[.05] p-3.5">
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "grid size-8 place-items-center rounded-[10px]",
            tone === "warn" ? "bg-warning/20 text-warning" : tone === "good" ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="text-[11px] font-semibold tabular-nums text-tinta-muted">{step}</span>
      </div>
      <p className="mt-3 text-[13px] font-bold text-tinta-foreground">{title}</p>
      <p className="text-[11px] text-tinta-muted">{hint}</p>
      <div className="mt-auto flex items-end justify-between gap-2 pt-3">
        <span className="text-[1.9rem] font-extrabold leading-none tabular-nums tracking-[-0.04em] text-tinta-foreground">
          {count == null ? "·" : count.toLocaleString("pt-BR")}
        </span>
        {value && <span className="text-[12px] font-bold tabular-nums text-tinta-foreground">{value}</span>}
      </div>
    </div>
  );
}

// Mesmo tamanho de página de CarteiraClientTable:57. Medido: 534 pedidos
// aprovados na base inteira, maior org com 296 — sem paginação, 246 pedidos
// dessa org ficariam invisíveis.
const PAGE_SIZE = 50;

export function CarteiraOrders({ searchQuery = "", onSearchChange, onReviewQueue }: CarteiraOrdersProps) {
  const { data: statusCounts } = useOrderStatusCounts();
  const { data: pendingOrders = [] } = usePendingOrders();
  const pendingValue = useMemo(
    () => pendingOrders.reduce((sum, o) => sum + Number(o.sale_value || 0), 0),
    [pendingOrders],
  );
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<CarteiraOrderRow | null>(null);
  const [lastSearch, setLastSearch] = useState(searchQuery);

  // Editar = admin + membro (pertencer à org basta). O gate real é do banco:
  // carteira_update_order faz assert_org_member e recusa pedido com vínculo ERP.
  const { isReady } = useIdentity();
  const canMutate = isReady;

  // Trocar a busca volta pra primeira página — DURANTE o render, não num
  // `useEffect`. Com efeito, o reset só roda depois do commit, e a primeira
  // leitura após digitar sairia com o offset velho: página não-primeira de um
  // conjunto que encolheu volta vazia, `total_count` fica indefinido, a barra
  // de paginação some e o usuário trava numa tela morta sem botão de voltar.
  // Este é o padrão documentado do React para ajustar estado quando a entrada
  // muda — o re-render acontece antes de qualquer efeito ou request.
  if (searchQuery !== lastSearch) {
    setLastSearch(searchQuery);
    setPage(1);
  }
  const effectivePage = searchQuery === lastSearch ? page : 1;

  const { data: orders = [], isLoading } = useCarteiraOrders({
    search: searchQuery,
    limit: PAGE_SIZE,
    offset: (effectivePage - 1) * PAGE_SIZE,
  });

  // Rede de segurança: página não-primeira que voltou vazia (pedido excluído
  // por outro usuário, filtro que encolheu o conjunto) devolve o usuário pro
  // começo em vez de deixá-lo numa tela morta.
  useEffect(() => {
    if (!isLoading && orders.length === 0 && page > 1) setPage(1);
  }, [isLoading, orders.length, page]);

  const total = orders[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (effectivePage - 1) * PAGE_SIZE + 1;
  const to = Math.min(effectivePage * PAGE_SIZE, total);

  const pageValue = useMemo(
    () => orders.reduce((sum, o) => sum + Number(o.sale_value), 0),
    [orders],
  );

  return (
    <div className="space-y-5">
      {/* Esteira — os 3 estados REAIS do pedido (decisão do líder): pendente →
          aprovado | recusado. Sem "faturado/entregue": o produto não conhece. */}
      <InkPanel title="Esteira de pedidos" count="3 estados">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)]">
          <StageTile
            step="1/3"
            icon={Hourglass}
            title="Aguardando aprovação"
            hint="não conta como venda até aprovar"
            count={statusCounts?.pending}
            value={pendingValue > 0 ? formatBRL(pendingValue, 0) : undefined}
            tone="warn"
          />
          <StageTile
            step="2/3"
            icon={CheckCircle2}
            title="Aprovado"
            hint="é venda — entra na carteira"
            count={statusCounts?.approved}
            tone="good"
          />
          <StageTile
            step="3/3"
            icon={XCircle}
            title="Recusado"
            hint="fora da receita"
            count={statusCounts?.rejected}
            tone="bad"
          />
          <FocusCard className="justify-between gap-3 p-[18px]">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground px-2.5 py-1 text-[11px] font-bold text-primary">
                <Hourglass className="size-3" aria-hidden />
                Fila de aprovação
              </span>
              <p className="mt-3 text-[2.2rem] font-extrabold leading-none tabular-nums tracking-[-0.04em]">
                {(statusCounts?.pending ?? pendingOrders.length).toLocaleString("pt-BR")}
                <span className="ml-1.5 text-sm font-bold tracking-normal">
                  {(statusCounts?.pending ?? pendingOrders.length) === 1 ? "pedido" : "pedidos"}
                </span>
              </p>
              <p className="mt-1 text-[13px] font-semibold text-primary-foreground/75">
                {pendingValue > 0 ? `${formatBRL(pendingValue, 0)} esperando decisão` : "Nada esperando decisão agora"}
              </p>
            </div>
            <FocusTile className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs font-semibold">
              <span>Aprovados viram venda e atualizam a carteira</span>
            </FocusTile>
            {onReviewQueue && (
              <Button
                className="w-full border-transparent bg-white text-neutral-900 shadow-none hover:bg-white/90"
                onClick={onReviewQueue}
                disabled={(statusCounts?.pending ?? pendingOrders.length) === 0}
              >
                Revisar fila
                <ArrowRight />
              </Button>
            )}
          </FocusCard>
        </div>
      </InkPanel>

      {/* Tabela dos aprovados — título + busca no cabeçalho do cartão. */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold tracking-tight">Pedidos aprovados</h2>
            {!isLoading && total > 0 && (
              <p className="text-[13px] text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">
                  {total} {total === 1 ? "pedido" : "pedidos"}
                </span>
                {` — ${formatBRL(pageValue, 0)} em vendas`}
                {totalPages > 1 && " (nesta página)"}
              </p>
            )}
          </div>
          {onSearchChange && (
            <div className="relative w-full sm:w-[260px]">
              <Search className="absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                aria-label="Buscar pedidos"
                placeholder="Buscar cliente, produto…"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="h-[38px] rounded-full pl-9 text-[13px] shadow-relevo"
              />
            </div>
          )}
        </div>

        <OrdersTable
          orders={orders}
          isLoading={isLoading}
          onEdit={setEditing}
          canMutate={canMutate}
          hasSearch={searchQuery.trim().length > 0}
          page={effectivePage}
          totalPages={totalPages}
          total={total}
          from={from}
          to={to}
          onPageChange={setPage}
        />
      </div>

      <EditOrderDialog
        order={editing}
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </div>
  );
}
