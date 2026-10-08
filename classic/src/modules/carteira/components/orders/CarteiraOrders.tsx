import { useEffect, useMemo, useState } from "react";
import { formatBRL } from "@/lib/format";
import { useIdentity } from "@/modules/identity";
import {
  useCarteiraOrders,
  type CarteiraOrderRow,
} from "@/modules/carteira/hooks/useCarteiraOrders";
import { OrdersTable } from "./OrdersTable";
import { EditOrderDialog } from "./EditOrderDialog";

interface CarteiraOrdersProps {
  /** Busca compartilhada com o resto da Carteira (input do header). */
  searchQuery?: string;
}

// Mesmo tamanho de página de CarteiraClientTable:57. Medido: 534 pedidos
// aprovados na base inteira, maior org com 296 — sem paginação, 246 pedidos
// dessa org ficariam invisíveis.
const PAGE_SIZE = 50;

export function CarteiraOrders({ searchQuery = "" }: CarteiraOrdersProps) {
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
    <div className="space-y-4">
      {/* Resumo — espelha CarteiraApprovals.tsx:56-60. */}
      {!isLoading && total > 0 && (
        <p className="text-sm text-foreground">
          <span className="font-semibold">
            {total} {total === 1 ? "pedido" : "pedidos"}
          </span>
          {` — ${formatBRL(pageValue, 0)} em vendas`}
          {totalPages > 1 && (
            <span className="text-muted-foreground"> (nesta página)</span>
          )}
        </p>
      )}

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

      <EditOrderDialog
        order={editing}
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </div>
  );
}
