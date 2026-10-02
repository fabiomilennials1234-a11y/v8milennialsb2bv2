import { useState } from "react";
import { Check, CheckCheck, CheckCircle2, Hourglass, Receipt, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FocusCard, FocusTile, InkRow, InkSplit, KpiRow, KpiTile } from "@/components/ui/bento";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { SOURCE_STYLES } from "./OrderApprovalCard";
import {
  usePendingOrders,
  useApproveOrder,
  useRejectOrder,
  useBulkApproveOrders,
  type PendingOrder,
} from "@/modules/carteira/hooks/useOrderApproval";

/**
 * Aprovações — fila em tinta + o pedido em foco no ouro (mockup V5).
 *
 * Mesmos dados (`usePendingOrders`) e as mesmas três ações de antes: Aprovar,
 * Rejeitar (com motivo opcional) e Aprovar todos. Só a forma mudou: em vez de
 * uma pilha de cartões, a fila à esquerda e a decisão à direita.
 */

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function sourceOf(order: PendingOrder) {
  return SOURCE_STYLES[order.source ?? ""] ?? SOURCE_STYLES.csv_import;
}

function whenLabel(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(d) || d < 0) return "";
  if (d === 0) return "hoje";
  if (d === 1) return "ontem";
  return `há ${d} dias`;
}

function RejectButton({ onReject, disabled }: { onReject: (comment?: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="flex-1 border-primary-foreground/20 bg-primary-foreground/[.07] text-primary-foreground shadow-none hover:-translate-y-0 hover:border-primary-foreground/30 hover:bg-primary-foreground/15 hover:text-primary-foreground"
          disabled={disabled}
        >
          <X />
          Rejeitar
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <Textarea
          placeholder="Motivo (opcional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          className="mb-2 text-xs"
        />
        <Button
          variant="destructive"
          size="sm"
          className="w-full"
          disabled={disabled}
          onClick={() => {
            onReject(comment || undefined);
            setComment("");
            setOpen(false);
          }}
        >
          Confirmar rejeição
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function CarteiraApprovals() {
  const { data: orders = [], isLoading } = usePendingOrders();
  const approveOrder = useApproveOrder();
  const rejectOrder = useRejectOrder();
  const bulkApprove = useBulkApproveOrders();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const totalValue = orders.reduce((s, o) => s + o.sale_value, 0);
  const totalStr = brl.format(totalValue);
  const focused = orders.find((o) => o.id === selectedId) ?? orders[0] ?? null;
  const busy = approveOrder.isPending || rejectOrder.isPending;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-card border border-card-border bg-card py-20 text-sm text-muted-foreground shadow-relevo" role="status">
        Carregando pedidos…
      </div>
    );
  }

  const kpis = (
    <KpiRow cols={2}>
      <KpiTile
        label="Pendentes"
        value={orders.length.toLocaleString("pt-BR")}
        icon={Hourglass}
        tone={orders.length > 0 ? "warn" : "good"}
        note={orders.length > 0 ? "esperando decisão" : "fila vazia"}
      />
      <KpiTile
        label="Valor em aprovação"
        value={totalStr}
        icon={Wallet}
        tone="gold"
        note="não conta como venda até aprovar"
      />
    </KpiRow>
  );

  if (orders.length === 0) {
    return (
      <div className="space-y-5">
        {kpis}
        <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-card-border bg-card py-20 shadow-relevo">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-success/10 text-success-strong">
            <CheckCircle2 className="h-6 w-6" />
          </span>
          <p className="text-sm font-bold text-foreground">Nenhum pedido pendente</p>
        </div>
      </div>
    );
  }

  const bulkAction = (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 rounded-full border border-white/10 bg-white/[.06] text-[12px] text-tinta-foreground hover:bg-white/10 hover:text-tinta-foreground"
          disabled={bulkApprove.isPending}
        >
          <CheckCheck />
          Aprovar todos ({orders.length})
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Aprovar todos os pedidos?</AlertDialogTitle>
          <AlertDialogDescription>
            {orders.length} pedidos ({totalStr}) serão aprovados e passarão a contar
            nas métricas da carteira. Esta ação não pode ser revertida.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => bulkApprove.mutate({ orderIds: orders.map((o) => o.id) })}>
            Aprovar todos
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <div className="space-y-5">
      {kpis}
      <InkSplit
        title="Fila de aprovação"
        count={`${orders.length} aguardando você`}
        actions={bulkAction}
        listClassName="max-h-[560px] overflow-y-auto"
        list={orders.map((order) => {
          const selected = focused?.id === order.id;
          return (
            <InkRow key={order.id} selected={selected} onClick={() => setSelectedId(order.id)}>
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-xl",
                  selected ? "bg-primary-foreground/10" : "bg-white/10 text-tinta-foreground",
                )}
              >
                <Receipt className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13px] font-bold">{order.product_name || order.client_name}</span>
                <span className={cn("block truncate text-[11px]", selected ? "text-primary-foreground/70" : "text-tinta-muted")}>
                  {[order.client_name, sourceOf(order).label, whenLabel(order.created_at)].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="shrink-0 text-[12.5px] font-extrabold tabular-nums">{brl.format(order.sale_value)}</span>
            </InkRow>
          );
        })}
        detail={
          focused && (
            <FocusCard className="min-h-[320px] gap-4 p-[18px]" aria-label={`Pedido de ${focused.client_name}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground px-2.5 py-1 text-[11px] font-bold text-primary">
                  <Hourglass className="size-3" aria-hidden />
                  Aguardando aprovação
                </span>
                <span className="rounded-full bg-primary-foreground/10 px-2.5 py-1 text-[11px] font-bold">{sourceOf(focused).label}</span>
              </div>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[1.5rem] font-extrabold leading-tight tracking-[-0.035em]">{focused.client_name}</p>
                  {focused.client_company && (
                    <p className="truncate text-[13px] font-semibold text-primary-foreground/70">{focused.client_company}</p>
                  )}
                </div>
                <p className="text-[2rem] font-extrabold leading-none tabular-nums tracking-[-0.04em]">{brl.format(focused.sale_value)}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <FocusTile className="px-3.5 py-3">
                  <p className="text-[11px] font-bold text-primary-foreground/70">Pedido</p>
                  <p className="truncate text-[14px] font-extrabold">{focused.product_name || "—"}</p>
                </FocusTile>
                <FocusTile className="px-3.5 py-3">
                  <p className="text-[11px] font-bold text-primary-foreground/70">Registrado</p>
                  <p className="text-[14px] font-extrabold tabular-nums">
                    {new Date(focused.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                    <span className="ml-1.5 text-[11px] font-semibold text-primary-foreground/70">{whenLabel(focused.created_at)}</span>
                  </p>
                </FocusTile>
              </div>
              {focused.items.length > 0 && (
                <FocusTile className="px-3.5 py-3">
                  <p className="mb-1.5 text-[11px] font-bold text-primary-foreground/70">Itens</p>
                  <ul className="space-y-1">
                    {focused.items.map((item) => (
                      <li key={item.id} className="flex items-baseline gap-2 text-[12.5px] font-semibold">
                        <span className="min-w-0 flex-1 truncate">{item.product_name}</span>
                        <span className="shrink-0 tabular-nums text-primary-foreground/70">×{item.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </FocusTile>
              )}
              <div className="mt-auto flex gap-2 border-t border-primary-foreground/15 pt-3.5">
                <Button
                  className="flex-1 border-transparent bg-white text-neutral-900 shadow-none hover:bg-white/90"
                  onClick={() => approveOrder.mutate({ orderId: focused.id })}
                  disabled={busy}
                >
                  <Check />
                  Aprovar
                </Button>
                <RejectButton
                  disabled={busy}
                  onReject={(comment) => rejectOrder.mutate({ orderId: focused.id, comment })}
                />
              </div>
            </FocusCard>
          )
        }
      />
    </div>
  );
}
