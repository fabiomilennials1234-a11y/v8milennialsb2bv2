import { useState } from "react";
import { motion } from "framer-motion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useUpsellClients } from "@/modules/carteira/hooks/useUpsellClients";
import { useUpsellOrders } from "@/modules/carteira/hooks/useUpsellOrders";
import { ClientDetailModal } from "./ClientDetailModal";
import { NewOrderModal } from "@/modules/carteira/components/client/NewOrderModal";
import { erpLabel } from "@/shared/format/erp-code";

interface UpsellBaseListProps {
  searchQuery: string;
  filterPotencial: string;
  filterActive: string;
}

const potencialConfig: Record<string, { class: string; label: string }> = {
  baixo: { class: "bg-muted text-muted-foreground", label: "Baixo" },
  medio: { class: "bg-primary/10 text-primary", label: "Medio" },
  alto: { class: "bg-green-500/10 text-green-600", label: "Alto" },
  estrategico: { class: "bg-purple-500/10 text-purple-600", label: "Estrategico" },
};

export function UpsellBaseList({ searchQuery, filterPotencial, filterActive }: UpsellBaseListProps) {
  const { data: clients = [] } = useUpsellClients();
  const { data: orders = [] } = useUpsellOrders();

  const [detailClientId, setDetailClientId] = useState<string>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [quickSaleClientId, setQuickSaleClientId] = useState<string>();
  const [quickSaleClientName, setQuickSaleClientName] = useState("");
  const [quickSaleOpen, setQuickSaleOpen] = useState(false);

  const vendasPorCliente: Record<string, number> = {};
  for (const order of orders) {
    vendasPorCliente[order.client_id] = (vendasPorCliente[order.client_id] || 0) + Number(order.sale_value || 0);
  }

  const filteredClients = clients.filter((c) => {
    if (searchQuery && !c.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !(c.company || "").toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterPotencial !== "all" && c.potencial !== filterPotencial) return false;
    if (filterActive === "active" && !c.is_active) return false;
    if (filterActive === "inactive" && c.is_active) return false;
    return true;
  });

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="border border-border rounded-lg"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Potencial</TableHead>
              <TableHead className="text-right">Vendas Total</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredClients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  Nenhum cliente encontrado
                </TableCell>
              </TableRow>
            ) : (
              filteredClients.map((client, i) => {
                const config = potencialConfig[client.potencial] || potencialConfig.medio;
                return (
                  <motion.tr
                    key={client.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className="cursor-pointer hover:bg-muted/50 border-b border-border"
                    onClick={() => { setDetailClientId(client.id); setDetailOpen(true); }}
                  >
                    <TableCell className="font-medium">{erpLabel(client)}</TableCell>
                    <TableCell className="text-muted-foreground">{client.company || "-"}</TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] border-0 ${config.class}`}>
                        {config.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-green-600">
                      R$ {(vendasPorCliente[client.id] || 0).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {(client.closer as any)?.name || "-"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{client.tipo_cliente_tempo}</TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] border-0 ${client.is_active ? "bg-green-500/10 text-green-600" : "bg-destructive/10 text-destructive"}`}>
                        {client.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                  </motion.tr>
                );
              })
            )}
          </TableBody>
        </Table>
      </motion.div>

      <ClientDetailModal
        open={detailOpen}
        onOpenChange={setDetailOpen}
        clientId={detailClientId}
        onQuickSale={() => {
          if (detailClientId) {
            const client = clients.find((c) => c.id === detailClientId);
            if (client) {
              setDetailOpen(false);
              setQuickSaleClientId(client.id);
              setQuickSaleClientName(client.name);
              setQuickSaleOpen(true);
            }
          }
        }}
      />

      {quickSaleClientId && (
        <NewOrderModal
          open={quickSaleOpen}
          onOpenChange={setQuickSaleOpen}
          clientId={quickSaleClientId}
          clientName={quickSaleClientName}
        />
      )}
    </>
  );
}
