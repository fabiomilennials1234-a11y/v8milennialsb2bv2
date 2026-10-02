/**
 * Modal de detalhe do cliente de carteira — VIVO: usado por UpsellBaseList.
 * (Tag @deprecated removida em 2026-07-02 — estava incorreta.)
 */
import { useState } from "react";
import {
  User, Building2, Mail, Phone, Calendar, DollarSign, Package,
  ShoppingCart, Clock, UserPlus, UserCheck, ArrowRight, Edit2,
  FileText, CheckCircle, CheckSquare, XCircle, CalendarX, TrendingUp,
  Trash2, ListTodo, Bot, Zap, History, Loader2
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUpsellClient, useUpdateUpsellClient, useDeleteUpsellClient } from "@/modules/carteira/hooks/useUpsellClients";
import { useUpsellOrdersByClient } from "@/modules/carteira/hooks/useUpsellOrders";
import { useLeadHistory } from "@/modules/leads";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { erpLabel } from "@/shared/format/erp-code";

interface ClientDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string | undefined;
  onQuickSale?: () => void;
}

const potencialConfig: Record<string, { class: string; label: string }> = {
  baixo: { class: "bg-muted text-muted-foreground", label: "Baixo" },
  medio: { class: "bg-primary-soft text-primary-soft-foreground", label: "Médio" },
  alto: { class: "bg-success/10 text-success", label: "Alto" },
  estrategico: { class: "bg-insights/10 text-insights", label: "Estratégico" },
};

// ── Timeline config (same pattern as LeadDetailModal) ──

const ACTION_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  lead_created: { icon: <UserPlus className="w-3.5 h-3.5" />, label: "Lead criado", color: "bg-insights/10 text-insights" },
  stage_changed: { icon: <ArrowRight className="w-3.5 h-3.5" />, label: "Etapa alterada", color: "bg-warning/15 text-warning-strong" },
  sdr_assigned: { icon: <UserCheck className="w-3.5 h-3.5" />, label: "Responsável atribuído", color: "bg-success/10 text-success" },
  closer_assigned: { icon: <UserCheck className="w-3.5 h-3.5" />, label: "Responsável atribuído", color: "bg-success/10 text-success" },
  responsible_assigned: { icon: <UserCheck className="w-3.5 h-3.5" />, label: "Responsável atribuído", color: "bg-success/10 text-success" },
  field_updated: { icon: <Edit2 className="w-3.5 h-3.5" />, label: "Campo atualizado", color: "bg-muted text-muted-foreground" },
  note_added: { icon: <FileText className="w-3.5 h-3.5" />, label: "Nota adicionada", color: "bg-muted text-muted-foreground" },
  meeting_scheduled: { icon: <Calendar className="w-3.5 h-3.5" />, label: "Reunião agendada", color: "bg-insights/10 text-insights" },
  meeting_attended: { icon: <CheckCircle className="w-3.5 h-3.5" />, label: "Compareceu", color: "bg-success/10 text-success" },
  meeting_missed: { icon: <XCircle className="w-3.5 h-3.5" />, label: "Não compareceu", color: "bg-destructive/10 text-destructive" },
  meeting_deleted: { icon: <CalendarX className="w-3.5 h-3.5" />, label: "Reunião removida", color: "bg-destructive/10 text-destructive" },
  proposal_created: { icon: <DollarSign className="w-3.5 h-3.5" />, label: "Proposta criada", color: "bg-primary-soft text-primary-soft-foreground" },
  proposal_status_changed: { icon: <TrendingUp className="w-3.5 h-3.5" />, label: "Status da proposta", color: "bg-warning/15 text-warning-strong" },
  proposal_deleted: { icon: <Trash2 className="w-3.5 h-3.5" />, label: "Proposta removida", color: "bg-destructive/10 text-destructive" },
  product_linked: { icon: <Package className="w-3.5 h-3.5" />, label: "Produto vinculado", color: "bg-primary-soft text-primary-soft-foreground" },
  followup_created: { icon: <ListTodo className="w-3.5 h-3.5" />, label: "Tarefa criada", color: "bg-insights/10 text-insights" },
  followup_completed: { icon: <CheckSquare className="w-3.5 h-3.5" />, label: "Tarefa concluída", color: "bg-success/10 text-success" },
  ai_toggled: { icon: <Bot className="w-3.5 h-3.5" />, label: "IA", color: "bg-primary/20 text-primary" },
  copilot_interaction: { icon: <Bot className="w-3.5 h-3.5" />, label: "Copilot atendeu", color: "bg-primary/20 text-primary" },
};

const FALLBACK_CONFIG = { icon: <Clock className="w-3.5 h-3.5" />, label: "", color: "bg-muted text-muted-foreground" };

function TimelineItem({
  action,
  description,
  date,
  isLast,
}: {
  action: string;
  description?: string;
  date: string;
  isLast?: boolean;
}) {
  const config = ACTION_CONFIG[action] || FALLBACK_CONFIG;
  const displayLabel = config.label || action;

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", config.color)}>
          {config.icon}
        </div>
        {!isLast && <div className="w-px flex-1 bg-border mt-2" />}
      </div>
      <div className="flex-1 pb-6">
        <p className="font-medium text-sm">{displayLabel}</p>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {formatDistanceToNow(new Date(date), { addSuffix: true, locale: ptBR })}
        </p>
      </div>
    </div>
  );
}

export function ClientDetailModal({ open, onOpenChange, clientId, onQuickSale }: ClientDetailModalProps) {
  const { data: client } = useUpsellClient(clientId);
  const { data: orders = [] } = useUpsellOrdersByClient(clientId);
  const { data: history = [], isLoading: historyLoading } = useLeadHistory(client?.lead_id);
  const updateClient = useUpdateUpsellClient();
  const deleteClient = useDeleteUpsellClient();
  const [tab, setTab] = useState("dados");
  const [historyLimit, setHistoryLimit] = useState(50);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (!client) return null;

  const toggleActive = async () => {
    try {
      const updates: any = {
        id: client.id,
        is_active: !client.is_active,
      };
      if (!client.is_active) {
        updates.reactivated_at = new Date().toISOString();
        updates.churned_at = null;
      } else {
        updates.churned_at = new Date().toISOString();
      }
      await updateClient.mutateAsync(updates);
      toast.success(client.is_active ? "Cliente marcado como inativo" : "Cliente reativado");
    } catch {
      toast.error("Erro ao atualizar status");
    }
  };

  const handlePotencialChange = async (potencial: string) => {
    try {
      await updateClient.mutateAsync({ id: client.id, potencial: potencial as any });
      toast.success("Potencial atualizado");
    } catch {
      toast.error("Erro ao atualizar potencial");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteClient.mutateAsync(client.id);
      toast.success("Cliente excluído permanentemente");
      onOpenChange(false);
    } catch {
      toast.error("Erro ao excluir cliente");
    } finally {
      setShowDeleteConfirm(false);
    }
  };

  const totalVendas = orders.reduce((sum, o) => sum + Number(o.sale_value || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="rounded-[10px] bg-primary-soft p-1.5 text-primary-soft-foreground">
              <User className="h-4 w-4" />
            </div>
            {erpLabel(client)}
            {!client.is_active && (
              <Badge className="text-[10px] border-0 bg-destructive/10 text-destructive">Inativo</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList variant="segmented" className="self-start">
            <TabsTrigger value="dados">Dados</TabsTrigger>
            <TabsTrigger value="pedidos">Pedidos ({orders.length})</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>

          <TabsContent value="dados" className="overflow-y-auto flex-1 mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-start gap-2">
                <div className="p-1 rounded bg-muted mt-0.5">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Empresa</p>
                  <p className="font-medium">{client.company || "-"}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="p-1 rounded bg-muted mt-0.5">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Email</p>
                  <p className="font-medium">{client.email || "-"}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="p-1 rounded bg-muted mt-0.5">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Telefone</p>
                  <p className="font-medium">{client.phone || "-"}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="p-1 rounded bg-muted mt-0.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Primeira Venda</p>
                  <p className="font-medium">{new Date(client.first_sale_at).toLocaleDateString("pt-BR")}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="mt-0.5 rounded-md bg-success/10 p-1">
                  <DollarSign className="h-3.5 w-3.5 text-success" />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Total Vendas</p>
                  <p className="font-bold tabular-nums text-success">
                    {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(totalVendas)}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">Potencial</p>
                <Select value={client.potencial} onValueChange={handlePotencialChange}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baixo">Baixo</SelectItem>
                    <SelectItem value="medio">Médio</SelectItem>
                    <SelectItem value="alto">Alto</SelectItem>
                    <SelectItem value="estrategico">Estratégico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-2 pt-4 border-t border-border">
              <Button size="sm" onClick={onQuickSale} className="gap-1.5">
                <ShoppingCart className="h-3.5 w-3.5" />
                Registrar Venda
              </Button>
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
          </TabsContent>

          <TabsContent value="pedidos" className="overflow-y-auto flex-1 mt-4">
            {orders.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum pedido</p>
            ) : (
              <div className="space-y-2">
                {orders.map((o) => (
                  <div key={o.id} className="rounded-xl border border-border/70 bg-card p-3 text-sm">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <div className="rounded-md bg-success/10 p-1">
                          <ShoppingCart className="h-3 w-3 text-success" />
                        </div>
                        <span className="font-medium">{o.product_name}</span>
                      </div>
                      <span className="font-semibold tabular-nums text-success">
                        R$ {Number(o.sale_value).toLocaleString("pt-BR")}
                      </span>
                    </div>
                    <div className="flex justify-between items-center mt-1 ml-7 text-xs text-muted-foreground">
                      <span>{new Date(o.sold_at).toLocaleDateString("pt-BR")}</span>
                      <div className="flex items-center gap-2">
                        <Badge className={`text-[10px] border-0 ${o.origin === "upsell" ? "bg-primary-soft text-primary-soft-foreground" : "bg-insights/10 text-insights"}`}>
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
          </TabsContent>

          <TabsContent value="historico" className="overflow-y-auto flex-1 mt-4">
            {historyLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : history && history.length > 0 ? (
              <div className="space-y-0">
                {history.slice(0, historyLimit).map((item, index) => (
                  <TimelineItem
                    key={item.id}
                    action={item.action}
                    description={item.description || undefined}
                    date={item.created_at}
                    isLast={index === Math.min(history.length, historyLimit) - 1}
                  />
                ))}
                {history.length > historyLimit && (
                  <button
                    onClick={() => setHistoryLimit((prev) => prev + 50)}
                    className="w-full py-2 text-center text-sm font-semibold text-primary-soft-foreground hover:underline"
                  >
                    Carregar mais ({history.length - historyLimit} restantes)
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <History className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  Nenhum histórico registrado para este cliente.
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Cliente</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir permanentemente o cliente "{erpLabel(client)}"?
              Todos os pedidos e dados associados serão removidos. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir Permanentemente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
