/**
 * Contexto do funil: Gestão de Propostas
 *
 * Multi-product editor, total value, commitment date, status selector,
 * notes, TinyERP integration (OrderStatus + ConfirmDialog), delete.
 */

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Calendar,
  Clock,
  DollarSign,
  Package,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ArrowRight,
  TrendingUp,
  Settings,
  FileText,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useUpdatePipeProposta, useDeletePipeProposta, type PipePropostasStatus, statusColumns } from "@/hooks/usePipePropostas";
import { useActiveProducts } from "@/hooks/useProducts";
import { usePipePropostaItems, useCreatePipePropostaItem, useUpdatePipePropostaItem, useDeletePipePropostaItem } from "@/hooks/usePipePropostaItems";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { useDeleteLead } from "@/hooks/useLeads";
import { useTinyErpStatus } from "@/hooks/useTinyErp";
import { TinyErpOrderStatus } from "@/components/proposals/TinyErpOrderStatus";
import { TinyErpConfirmOrderDialog } from "@/components/proposals/TinyErpConfirmOrderDialog";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

interface PropostasContextProps {
  lead: any;
  pipeData: any; // pipe_propostas row (with .lead nested)
  onSuccess?: () => void;
}

export function PropostasContext({ lead, pipeData: proposta, onSuccess }: PropostasContextProps) {
  const { data: tinyStatus } = useTinyErpStatus();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: products = [] } = useActiveProducts();
  const { data: itemsData = [], isLoading: itemsLoading } = usePipePropostaItems(proposta?.id);
  const updateProposta = useUpdatePipeProposta();
  const deleteProposta = useDeletePipeProposta();
  const deleteLead = useDeleteLead();
  const logAction = useLogLeadAction();
  const createItem = useCreatePipePropostaItem();
  const updateItem = useUpdatePipePropostaItem();
  const deleteItem = useDeletePipePropostaItem();

  const activeMembers = teamMembers.filter((m) => m.is_active);

  const [formData, setFormData] = useState({
    status: proposta?.status || "marcar_compromisso",
    contract_duration: proposta?.contract_duration || "",
    responsible_id: proposta?.responsible_id || proposta?.closer_id || "",
    commitment_date: proposta?.commitment_date ? format(new Date(proposta.commitment_date), "yyyy-MM-dd'T'HH:mm") : "",
    notes: proposta?.notes || "",
  });
  const [newNote, setNewNote] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [tinyConfirmOpen, setTinyConfirmOpen] = useState(false);

  const [localItems, setLocalItems] = useState<Array<{ id: string; product_id: string; sale_value: string; isNew?: boolean }>>([]);
  const [itemsInitialized, setItemsInitialized] = useState(false);

  // Reset on proposta change
  useEffect(() => {
    if (proposta) {
      setFormData({
        status: proposta.status || "marcar_compromisso",
        contract_duration: proposta.contract_duration || "",
        responsible_id: proposta.responsible_id || proposta.closer_id || "",
        commitment_date: proposta.commitment_date ? format(new Date(proposta.commitment_date), "yyyy-MM-dd'T'HH:mm") : "",
        notes: proposta.notes || "",
      });
      setItemsInitialized(false);
    }
  }, [proposta?.id]);

  useEffect(() => {
    if (itemsInitialized || itemsLoading) return;
    if (itemsData.length > 0) {
      setLocalItems(itemsData.map((item) => ({ id: item.id, product_id: item.product_id || "", sale_value: item.sale_value?.toString() || "" })));
    } else if (proposta?.product_id) {
      setLocalItems([{ id: "legacy", product_id: proposta.product_id || "", sale_value: proposta.sale_value?.toString() || "" }]);
    } else {
      setLocalItems([
        { id: crypto.randomUUID(), product_id: "", sale_value: "", isNew: true },
        { id: crypto.randomUUID(), product_id: "", sale_value: "", isNew: true },
      ]);
    }
    setItemsInitialized(true);
  }, [proposta?.id, itemsData, itemsLoading, itemsInitialized]);

  if (!proposta) return <p className="text-sm text-muted-foreground text-center py-8">Nenhuma proposta selecionada.</p>;

  const handleAddItem = () => {
    setLocalItems([...localItems, { id: crypto.randomUUID(), product_id: "", sale_value: "", isNew: true }]);
  };

  const handleRemoveItem = async (id: string, isNew?: boolean) => {
    if (localItems.length === 1) return;
    if (!isNew && id !== "legacy") {
      try {
        await deleteItem.mutateAsync({ id, propostaId: proposta.id });
      } catch {
        toast.error("Erro ao remover produto");
        return;
      }
    }
    setLocalItems(localItems.filter((i) => i.id !== id));
  };

  const handleItemChange = (id: string, field: "product_id" | "sale_value", value: string) => {
    setLocalItems(
      localItems.map((item) => {
        if (item.id !== id) return item;
        if (field === "product_id") {
          const sp = products.find((p) => p.id === value);
          return { ...item, product_id: value, sale_value: sp?.ticket?.toString() || item.sale_value };
        }
        return { ...item, [field]: value };
      })
    );
  };

  const totalValue = localItems.reduce((sum, i) => sum + (Number(i.sale_value) || 0), 0);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 }).format(v);

  const getStatusColor = (status: PipePropostasStatus) => {
    const col = statusColumns.find((c) => c.id === status);
    return col?.color || "#888";
  };

  const handleSubmit = async () => {
    if (!formData.responsible_id) { toast.error("Responsável é obrigatório"); return; }
    const validItems = localItems.filter((i) => i.product_id && i.sale_value);
    if (validItems.length === 0) { toast.error("Adicione pelo menos um produto"); return; }

    try {
      if (formData.status !== proposta.status) {
        const label = statusColumns.find((s) => s.id === formData.status)?.title;
        logAction({ leadId: proposta.lead_id, action: "proposal_status_changed", description: `Status alterado para "${label}"` });
      }
      if (formData.notes !== proposta.notes && formData.notes) logAction({ leadId: proposta.lead_id, action: "note_added", description: formData.notes });

      const tv = validItems.reduce((sum, i) => sum + Number(i.sale_value), 0);
      const productTypes = validItems.map((i) => products.find((p) => p.id === i.product_id)?.type).filter(Boolean);
      const hasOnlyMrr = productTypes.every((t) => t === "mrr");
      const hasOnlyProjeto = productTypes.every((t) => t === "projeto");
      const mainProductType = hasOnlyMrr ? "mrr" : hasOnlyProjeto ? "projeto" : null;

      for (const item of validItems) {
        if (item.isNew || item.id === "legacy") {
          const productName = products.find((p) => p.id === item.product_id)?.name || "Produto";
          logAction({ leadId: proposta.lead_id, action: "product_linked", description: `Produto "${productName}" vinculado` });
          await createItem.mutateAsync({ pipe_proposta_id: proposta.id, product_id: item.product_id, sale_value: Number(item.sale_value) });
        } else {
          await updateItem.mutateAsync({ id: item.id, product_id: item.product_id, sale_value: Number(item.sale_value) });
        }
      }

      const isNewSale = formData.status === "vendido" && proposta.status !== "vendido";
      const shouldShowTinyModal = isNewSale && tinyStatus?.connected;

      await updateProposta.mutateAsync({
        id: proposta.id,
        status: formData.status as PipePropostasStatus,
        product_type: mainProductType,
        product_id: validItems.length === 1 ? validItems[0].product_id : null,
        sale_value: tv,
        contract_duration: formData.contract_duration ? Number(formData.contract_duration) : null,
        responsible_id: formData.responsible_id,
        closer_id: formData.responsible_id,
        commitment_date: formData.commitment_date ? new Date(formData.commitment_date).toISOString() : null,
        notes: formData.notes || null,
        closed_at: ["vendido", "perdido"].includes(formData.status) ? new Date().toISOString() : null,
        skip_auto_push: shouldShowTinyModal,
      });

      if (shouldShowTinyModal) {
        toast.success("🎉 Venda fechada!");
        setTinyConfirmOpen(true);
        return;
      }

      toast.success(isNewSale ? "🎉 Venda fechada!" : "Proposta atualizada!");
      onSuccess?.();
    } catch {
      toast.error("Erro ao atualizar proposta");
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    setIsAddingNote(true);
    try {
      logAction({ leadId: proposta.lead_id, action: "note_added", description: newNote });
      const updatedNotes = formData.notes ? `${formData.notes}\n\n[${format(new Date(), "dd/MM/yyyy HH:mm")}] ${newNote}` : newNote;
      await updateProposta.mutateAsync({ id: proposta.id, notes: updatedNotes });
      setFormData({ ...formData, notes: updatedNotes });
      toast.success("Nota adicionada!");
      setNewNote("");
      onSuccess?.();
    } catch { toast.error("Erro ao adicionar nota"); }
    finally { setIsAddingNote(false); }
  };

  // Prepare items for TinyERP dialog
  const tinyItems = localItems
    .filter((i) => i.product_id && i.sale_value)
    .map((i) => ({
      product_name: products.find((p) => p.id === i.product_id)?.name || "Produto",
      sale_value: Number(i.sale_value),
    }));

  return (
    <div className="space-y-5">
      {/* Products */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-base font-semibold">Produtos</Label>
          <Button variant="outline" size="sm" onClick={handleAddItem} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Adicionar
          </Button>
        </div>

        {itemsLoading ? (
          <div className="flex items-center justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-2">
            {localItems.map((item) => (
              <motion.div key={item.id} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3 items-start p-3 border rounded-lg bg-muted/30">
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Produto</Label>
                    <Select value={item.product_id} onValueChange={(v) => handleItemChange(item.id, "product_id", v)}>
                      <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            <div className="flex items-center gap-2">
                              <Badge variant={p.type === "mrr" ? "default" : "secondary"} className="text-xs">{p.type === "mrr" ? "MRR" : "Projeto"}</Badge>
                              {p.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Valor (R$)</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input type="number" value={item.sale_value} onChange={(e) => handleItemChange(item.id, "sale_value", e.target.value)} placeholder="10000" className="pl-9" />
                    </div>
                  </div>
                </div>
                {localItems.length > 1 && (
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:text-destructive hover:bg-destructive/10 mt-5" onClick={() => handleRemoveItem(item.id, item.isNew)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </motion.div>
            ))}
          </div>
        )}

        {totalValue > 0 && (
          <div className="p-4 rounded-xl bg-gradient-to-br from-success/10 via-success/5 to-transparent border border-success/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Valor Total</p>
                <span className="text-2xl font-bold text-success">{formatCurrency(totalValue)}</span>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                {localItems.filter((i) => i.product_id && i.sale_value).length} produto(s)
              </div>
            </div>
          </div>
        )}
      </div>

      {/* TinyERP Status */}
      {proposta?.id && <TinyErpOrderStatus pipePropostaId={proposta.id} />}

      <Separator />

      {/* Commitment Date */}
      <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg bg-blue-500/20"><Calendar className="w-5 h-5 text-blue-500" /></div>
          <div>
            <Label className="text-base font-semibold">Data da Reunião</Label>
            <p className="text-xs text-muted-foreground">Quando será o compromisso</p>
          </div>
        </div>
        <Input
          type="datetime-local"
          value={formData.commitment_date}
          onChange={(e) => setFormData({ ...formData, commitment_date: e.target.value })}
          className="bg-background"
        />
        {formData.commitment_date && (
          <p className="text-sm text-blue-500 mt-2 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {format(new Date(formData.commitment_date), "EEEE, dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}
          </p>
        )}
      </div>

      {/* Status Grid */}
      <div className="space-y-2">
        <Label>Status da Proposta</Label>
        <div className="grid grid-cols-3 gap-2">
          {statusColumns.map((status) => (
            <button
              key={status.id}
              onClick={() => setFormData({ ...formData, status: status.id })}
              className={cn(
                "p-2.5 rounded-lg border-2 text-left transition-all hover:border-primary/50",
                formData.status === status.id ? "border-primary bg-primary/5" : "border-muted"
              )}
            >
              <div className="w-3 h-3 rounded-full mb-1.5" style={{ backgroundColor: status.color }} />
              <p className="text-xs font-medium">{status.title}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Config fields */}
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs">Responsável *</Label>
          <Select value={formData.responsible_id || "none"} onValueChange={(v) => setFormData({ ...formData, responsible_id: v === "none" ? "" : v })}>
            <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nenhum</SelectItem>
              {activeMembers.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Duração (meses)</Label>
          <div className="relative">
            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input type="number" value={formData.contract_duration} onChange={(e) => setFormData({ ...formData, contract_duration: e.target.value })} placeholder="12" className="pl-9" />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label className="text-xs">Observações</Label>
        <Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={3} />
      </div>

      {/* Quick note */}
      <div className="space-y-2 pt-3 border-t">
        <Label className="text-xs">Nota rápida</Label>
        <div className="flex gap-2">
          <Textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Adicionar nota..." rows={2} className="flex-1" />
          <Button onClick={handleAddNote} disabled={!newNote.trim() || isAddingNote} className="self-end">
            {isAddingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Save + Delete */}
      <div className="flex justify-between gap-2 pt-4 border-t border-border">
        <div className="flex gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                <Trash2 className="w-4 h-4 mr-1" />
                Excluir Proposta
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir proposta?</AlertDialogTitle>
                <AlertDialogDescription>O lead continuará no sistema.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    try {
                      logAction({ leadId: proposta.lead_id, action: "proposal_deleted", description: "Proposta removida" });
                      await deleteProposta.mutateAsync(proposta.id);
                      toast.success("Proposta excluída!");
                      onSuccess?.();
                    } catch { toast.error("Erro ao excluir"); }
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <Button onClick={handleSubmit} disabled={updateProposta.isPending}>
          {updateProposta.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Salvar Proposta
        </Button>
      </div>

      {/* TinyERP Confirm Dialog */}
      <TinyErpConfirmOrderDialog
        open={tinyConfirmOpen}
        onOpenChange={setTinyConfirmOpen}
        pipePropostaId={proposta.id}
        lead={lead}
        items={tinyItems}
        totalValue={totalValue}
        onSuccess={() => { onSuccess?.(); }}
      />
    </div>
  );
}
