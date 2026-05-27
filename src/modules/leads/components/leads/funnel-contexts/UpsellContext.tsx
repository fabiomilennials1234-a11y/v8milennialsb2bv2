/**
 * Contexto do funil: Upsell (Client + Campanha)
 *
 * For upsell_client: potencial select, active toggle, orders list, quick sale, delete
 * For upsell_campanha: lighter version with campaign-specific data
 */

import { useState } from "react";
import {
  DollarSign,
  ShoppingCart,
  Calendar,
  Trash2,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useUpsellClient, useUpdateUpsellClient, useDeleteUpsellClient } from "@/hooks/useUpsellClients";
import { useUpsellOrdersByClient } from "@/hooks/useUpsellOrders";
import { toast } from "sonner";

interface UpsellContextProps {
  lead: any;
  pipeData: any; // upsell_client row
  onSuccess?: () => void;
  onQuickSale?: () => void;
}

const potencialConfig: Record<string, { class: string; label: string }> = {
  baixo: { class: "bg-muted text-muted-foreground", label: "Baixo" },
  medio: { class: "bg-primary/10 text-primary", label: "Médio" },
  alto: { class: "bg-green-500/10 text-green-600", label: "Alto" },
  estrategico: { class: "bg-purple-500/10 text-purple-600", label: "Estratégico" },
};

export function UpsellClientContext({ lead, pipeData: client, onSuccess, onQuickSale }: UpsellContextProps) {
  const { data: orders = [] } = useUpsellOrdersByClient(client?.id);
  const updateClient = useUpdateUpsellClient();
  const deleteClient = useDeleteUpsellClient();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (!client) return <p className="text-sm text-muted-foreground text-center py-8">Nenhum cliente selecionado.</p>;

  const totalVendas = orders.reduce((sum, o) => sum + Number(o.sale_value || 0), 0);

  const toggleActive = async () => {
    try {
      const updates: any = { id: client.id, is_active: !client.is_active };
      if (!client.is_active) { updates.reactivated_at = new Date().toISOString(); updates.churned_at = null; }
      else { updates.churned_at = new Date().toISOString(); }
      await updateClient.mutateAsync(updates);
      toast.success(client.is_active ? "Cliente marcado como inativo" : "Cliente reativado");
      onSuccess?.();
    } catch { toast.error("Erro ao atualizar status"); }
  };

  const handlePotencialChange = async (potencial: string) => {
    try {
      await updateClient.mutateAsync({ id: client.id, potencial: potencial as any });
      toast.success("Potencial atualizado");
      onSuccess?.();
    } catch { toast.error("Erro ao atualizar potencial"); }
  };

  const handleDelete = async () => {
    try {
      await deleteClient.mutateAsync(client.id);
      toast.success("Cliente excluído");
      setShowDeleteConfirm(false);
      onSuccess?.();
    } catch { toast.error("Erro ao excluir"); }
  };

  return (
    <div className="space-y-6">
      {/* Status + Potencial */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground font-medium">Status</p>
          <Badge className={client.is_active ? "bg-success/10 text-success border-0" : "bg-destructive/10 text-destructive border-0"}>
            {client.is_active ? "Ativo" : "Inativo"}
          </Badge>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground font-medium">Potencial</p>
          <Select value={client.potencial} onValueChange={handlePotencialChange}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="baixo">Baixo</SelectItem>
              <SelectItem value="medio">Médio</SelectItem>
              <SelectItem value="alto">Alto</SelectItem>
              <SelectItem value="estrategico">Estratégico</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Total Sales */}
      <div className="p-4 rounded-xl bg-gradient-to-br from-success/10 via-success/5 to-transparent border border-success/20">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-success/20"><DollarSign className="w-5 h-5 text-success" /></div>
          <div>
            <p className="text-sm text-muted-foreground">Total Vendas</p>
            <p className="text-xl font-bold text-success">
              {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(totalVendas)}
            </p>
          </div>
          <div className="ml-auto text-right text-sm text-muted-foreground">
            {orders.length} pedido(s)
          </div>
        </div>
      </div>

      {/* Orders list */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Pedidos</h3>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum pedido</p>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <div key={o.id} className="p-3 rounded-lg border border-border bg-card text-sm">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded bg-green-500/10"><ShoppingCart className="h-3 w-3 text-green-600" /></div>
                    <span className="font-medium">{o.product_name}</span>
                  </div>
                  <span className="text-green-600 font-semibold">R$ {Number(o.sale_value).toLocaleString("pt-BR")}</span>
                </div>
                <div className="flex justify-between items-center mt-1 ml-7 text-xs text-muted-foreground">
                  <span>{new Date(o.sold_at).toLocaleDateString("pt-BR")}</span>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[10px] border-0 ${o.origin === "upsell" ? "bg-primary/10 text-primary" : "bg-blue-500/10 text-blue-600"}`}>
                      {o.origin === "upsell" ? "Upsell" : "New Business"}
                    </Badge>
                    <Badge className="text-[10px] border-0 bg-muted text-muted-foreground">{o.product_type}</Badge>
                  </div>
                </div>
                {o.notes && <p className="text-xs text-muted-foreground mt-1 ml-7">{o.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-4 border-t border-border">
        {onQuickSale && (
          <Button size="sm" onClick={onQuickSale} className="gap-1.5">
            <ShoppingCart className="h-3.5 w-3.5" />
            Registrar Venda
          </Button>
        )}
        <Button size="sm" variant={client.is_active ? "destructive" : "outline"} onClick={toggleActive}>
          {client.is_active ? "Marcar Inativo" : "Reativar"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
          onClick={() => setShowDeleteConfirm(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Excluir
        </Button>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Cliente</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir permanentemente "{client.name}"? Todos os pedidos serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir Permanentemente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
