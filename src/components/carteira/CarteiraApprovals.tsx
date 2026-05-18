import { useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
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
import { formatBRL } from "@/lib/format";

const PAGE_SIZE = 20;

export function CarteiraApprovals() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = usePendingOrders(page, PAGE_SIZE);
  const approveOrder = useApproveOrder();
  const rejectOrder = useRejectOrder();
  const bulkApprove = useBulkApproveOrders();

  const orders = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalValue = data?.total_value ?? 0;
  const totalPages = data?.total_pages ?? 1;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
        Carregando pedidos…
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <CheckCircle2 className="w-10 h-10 text-emerald-500/60" />
        <p className="text-sm text-muted-foreground">Nenhum pedido pendente</p>
      </div>
    );
  }

  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-foreground">
          <span className="font-semibold">{total} pedidos</span>
          {" pendentes — "}
          <span className="text-muted-foreground">{formatBRL(totalValue)} total</span>
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
              disabled={bulkApprove.isPending}
            >
              Aprovar todos ({total})
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Aprovar todos os pedidos?</AlertDialogTitle>
              <AlertDialogDescription>
                {total} pedidos ({formatBRL(totalValue)}) serão aprovados e passarão a contar
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
          />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-[13px] text-muted-foreground tabular-nums">
            Mostrando {from}–{to} de {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => p - 1)}
              disabled={page <= 1}
              className="h-7 px-2 text-[13px] gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Anterior
            </Button>
            <span className="text-[13px] text-muted-foreground tabular-nums">
              {page} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages}
              className="h-7 px-2 text-[13px] gap-1"
            >
              Próxima
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
