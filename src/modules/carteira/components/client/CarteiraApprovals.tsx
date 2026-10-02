import { CheckCheck, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { OrderApprovalCard } from "./OrderApprovalCard";
import {
  usePendingOrders,
  useApproveOrder,
  useRejectOrder,
  useBulkApproveOrders,
} from "@/modules/carteira/hooks/useOrderApproval";

export function CarteiraApprovals() {
  const { data: orders = [], isLoading } = usePendingOrders();
  const approveOrder = useApproveOrder();
  const rejectOrder = useRejectOrder();
  const bulkApprove = useBulkApproveOrders();

  const totalValue = orders.reduce((s, o) => s + o.sale_value, 0);
  const totalStr = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(totalValue);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-card border border-card-border bg-card py-20 text-sm text-muted-foreground shadow-relevo" role="status">
        Carregando pedidos…
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-card-border bg-card py-20 shadow-relevo">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-success/10 text-success">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <p className="text-sm font-bold text-foreground">Nenhum pedido pendente</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-foreground">
          <span className="font-bold tabular-nums">{orders.length} pedidos</span>
          {" pendentes — "}
          <span className="tabular-nums text-muted-foreground">{totalStr} total</span>
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="bg-success/10 text-success hover:bg-success/15 hover:text-success"
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
              <AlertDialogAction
                onClick={() =>
                  bulkApprove.mutate({ orderIds: orders.map((o) => o.id) })
                }
              >
                Aprovar todos
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Card list */}
      <div className="space-y-3">
        {orders.map((order) => (
          <OrderApprovalCard
            key={order.id}
            order={order}
            onApprove={(id) => approveOrder.mutate({ orderId: id })}
            onReject={(id, comment) => rejectOrder.mutate({ orderId: id, comment })}
            isApproving={approveOrder.isPending}
            isRejecting={rejectOrder.isPending}
          />
        ))}
      </div>
    </div>
  );
}
