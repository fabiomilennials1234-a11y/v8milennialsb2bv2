import { CheckCircle2 } from "lucide-react";
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
} from "@/hooks/useOrderApproval";

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
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
        Carregando pedidos…
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <CheckCircle2 className="w-10 h-10 text-emerald-500/60" />
        <p className="text-sm text-muted-foreground">Nenhum pedido pendente</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-foreground">
          <span className="font-semibold">{orders.length} pedidos</span>
          {" pendentes — "}
          <span className="text-muted-foreground">{totalStr} total</span>
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
              disabled={bulkApprove.isPending}
            >
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
