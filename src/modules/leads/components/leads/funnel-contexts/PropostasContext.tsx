/**
 * Contexto do funil: Gestão de Propostas
 *
 * Multi-product editor, total value, commitment date, status selector,
 * notes, TinyERP integration (OrderStatus + ConfirmDialog), delete.
 */

const LOSS_REASONS = [
  { value: "sem_budget", label: "Sem budget" },
  { value: "concorrencia", label: "Concorrência" },
  { value: "timing", label: "Timing errado" },
  { value: "follow_up_fraco", label: "Follow-up fraco" },
  { value: "produto_nao_adequado", label: "Produto não adequado" },
  { value: "outro", label: "Outro" },
];

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
import { ProductCombobox } from "@/modules/carteira/components/proposal/ProductCombobox";
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
import { type PipePropostasStatus, propostasStatusColumns as statusColumns } from "@/contracts/pipe";
import { usePipeOps } from "../../../pipe-ops";
import { useActiveProducts } from "@/modules/carteira/hooks/useProducts";
import { useTeamMembers } from "@/modules/identity";
import { useLogLeadAction } from "../../../hooks/useLogLeadAction";
import { useDeleteLead } from "../../../hooks/useLeads";
import { useTinyErpStatus } from "@/modules/carteira/hooks/useTinyErp";
import { TinyErpOrderStatus } from "@/modules/carteira/components/proposal/TinyErpOrderStatus";
import { TinyErpConfirmOrderDialog } from "@/modules/carteira/components/proposal/TinyErpConfirmOrderDialog";
import { useCadastroExternoEnabled } from "@/modules/marketing/hooks/useCadastroExterno";
import { CadastroExternoConfirmDialog } from "@/modules/carteira/components/proposal/CadastroExternoConfirmDialog";
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
  const cadastroExternoEnabled = useCadastroExternoEnabled();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: products = [] } = useActiveProducts();
  const {
    usePipePropostaItems,
    useUpdatePipeProposta,
    useDeletePipeProposta,
    useCreatePipePropostaItem,
    useUpdatePipePropostaItem,
    useDeletePipePropostaItem,
  } = usePipeOps();
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
    loss_reason: proposta?.loss_reason || "",
    contract_duration: proposta?.contract_duration || "",
    responsible_id: proposta?.responsible_id || proposta?.closer_id || "",
    commitment_date: proposta?.commitment_date ? format(new Date(proposta.commitment_date), "yyyy-MM-dd'T'HH:mm") : "",
    notes: proposta?.notes || "",
  });
  const [newNote, setNewNote] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [tinyConfirmOpen, setTinyConfirmOpen] = useState(false);
  const [cadastroExternoOpen, setCadastroExternoOpen] = useState(false);

  const [localItems, setLocalItems] = useState<Array<{ id: string; product_id: string; quantity: number; unit_price: string; isNew?: boolean }>>([]);
  const [itemsInitialized, setItemsInitialized] = useState(false);

  // Reset on proposta change
  useEffect(() => {
    if (proposta) {
      setFormData({
        status: proposta.status || "marcar_compromisso",
        loss_reason: proposta.loss_reason || "",
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
      setLocalItems(itemsData.map((item) => ({ id: item.id, product_id: item.product_id || "", quantity: item.quantity ?? 1, unit_price: item.unit_price?.toString() || item.sale_value?.toString() || "" })));
    } else if (proposta?.product_id) {
      setLocalItems([{ id: "legacy", product_id: proposta.product_id || "", quantity: 1, unit_price: proposta.sale_value?.toString() || "" }]);
    } else {
      setLocalItems([
        { id: crypto.randomUUID(), product_id: "", quantity: 1, unit_price: "", isNew: true },
        { id: crypto.randomUUID(), product_id: "", quantity: 1, unit_price: "", isNew: true },
      ]);
    }
    setItemsInitialized(true);
  }, [proposta?.id, itemsData, itemsLoading, itemsInitialized]);

  if (!proposta) return <p className="text-sm text-muted-foreground text-center py-8">Nenhuma proposta selecionada.</p>;

  const handleAddItem = () => {
    setLocalItems([...localItems, { id: crypto.randomUUID(), product_id: "", quantity: 1, unit_price: "", isNew: true }]);
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

  const handleProductSelect = (itemId: string, productId: string) => {
    setLocalItems(
      localItems.map((item) => {
        if (item.id !== itemId) return item;
        const sp = products.find((p) => p.id === productId);
        return { ...item, product_id: productId, unit_price: sp?.ticket?.toString() || item.unit_price };
      })
    );
  };

  const handleItemFieldChange = (itemId: string, field: "quantity" | "unit_price", value: string) => {
    setLocalItems(
      localItems.map((item) => {
        if (item.id !== itemId) return item;
        if (field === "quantity") {
          const qty = Math.max(1, parseInt(value) || 1);
          return { ...item, quantity: qty };
        }
        return { ...item, unit_price: value };
      })
    );
  };

  const totalValue = localItems.reduce((sum, i) => sum + (i.quantity * (Number(i.unit_price) || 0)), 0);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 }).format(v);

  const getStatusColor = (status: PipePropostasStatus) => {
    const col = statusColumns.find((c) => c.id === status);
    return col?.color || "#888";
  };

  const handleSubmit = async () => {
    if (!formData.responsible_id) { toast.error("Responsável é obrigatório"); return; }
    const itemsProductNoValue = localItems.filter((i) => i.product_id && !i.unit_price);
    if (itemsProductNoValue.length > 0) { toast.error("Informe o valor para todos os produtos selecionados"); return; }
    const itemsWithProduct = localItems.filter((i) => i.product_id && i.unit_price);
    const itemsValueOnly = localItems.filter((i) => !i.product_id && i.unit_price);
    const allValuedItems = [...itemsWithProduct, ...itemsValueOnly];
    if (allValuedItems.length === 0) { toast.error("Informe o valor da proposta"); return; }

    try {
      if (formData.status !== proposta.status) {
        const label = statusColumns.find((s) => s.id === formData.status)?.title;
        logAction({ leadId: proposta.lead_id, action: "proposal_status_changed", description: `Status alterado para "${label}"` });
      }
      if (formData.notes !== proposta.notes && formData.notes) logAction({ leadId: proposta.lead_id, action: "note_added", description: formData.notes });

      const tv = allValuedItems.reduce((sum, i) => sum + (i.quantity * Number(i.unit_price)), 0);
      const productTypes = itemsWithProduct.map((i) => products.find((p) => p.id === i.product_id)?.type).filter(Boolean);
      const hasOnlyMrr = productTypes.length > 0 && productTypes.every((t) => t === "mrr");
      const hasOnlyProjeto = productTypes.length > 0 && productTypes.every((t) => t === "projeto");
      const mainProductType = hasOnlyMrr ? "mrr" : hasOnlyProjeto ? "projeto" : null;

      for (const item of itemsWithProduct) {
        if (item.isNew || item.id === "legacy") {
          const productName = products.find((p) => p.id === item.product_id)?.name || "Produto";
          logAction({ leadId: proposta.lead_id, action: "product_linked", description: `Produto "${productName}" vinculado` });
          await createItem.mutateAsync({ pipe_proposta_id: proposta.id, product_id: item.product_id, quantity: item.quantity, unit_price: Number(item.unit_price), sale_value: item.quantity * Number(item.unit_price) });
        } else {
          await updateItem.mutateAsync({ id: item.id, product_id: item.product_id, quantity: item.quantity, unit_price: Number(item.unit_price), sale_value: item.quantity * Number(item.unit_price) });
        }
      }

      // Delete persisted DB items that lost their product (converted to value-only)
      const keptDbIds = new Set(itemsWithProduct.filter((i) => !i.isNew && i.id !== "legacy").map((i) => i.id));
      for (const dbItem of itemsData) {
        if (!keptDbIds.has(dbItem.id)) {
          await deleteItem.mutateAsync({ id: dbItem.id, propostaId: proposta.id });
        }
      }

      const isNewSale = formData.status === "vendido" && proposta.status !== "vendido";
      const shouldShowTinyModal = isNewSale && tinyStatus?.connected;
      const shouldShowCadastroModal = isNewSale && cadastroExternoEnabled;

      await updateProposta.mutateAsync({
        id: proposta.id,
        status: formData.status as PipePropostasStatus,
        product_type: mainProductType,
        product_id: itemsWithProduct.length === 1 ? itemsWithProduct[0].product_id : null,
        sale_value: tv,
        contract_duration: formData.contract_duration ? Number(formData.contract_duration) : null,
        responsible_id: formData.responsible_id,
        closer_id: formData.responsible_id,
        commitment_date: formData.commitment_date ? new Date(formData.commitment_date).toISOString() : null,
        notes: formData.notes || null,
        closed_at: ["vendido", "perdido"].includes(formData.status) ? new Date().toISOString() : null,
        loss_reason: formData.status === "perdido" ? (formData.loss_reason || null) : null,
        skip_auto_push: shouldShowTinyModal,
      });

      if (shouldShowTinyModal) {
        toast.success("🎉 Venda fechada!");
        setTinyConfirmOpen(true);
        return;
      }

      if (shouldShowCadastroModal) {
        toast.success("🎉 Venda fechada!");
        setCadastroExternoOpen(true);
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
    .filter((i) => i.product_id && i.unit_price)
    .map((i) => ({
      product_name: products.find((p) => p.id === i.product_id)?.name || "Produto",
      sale_value: i.quantity * (Number(i.unit_price) || 0),
      quantity: i.quantity,
      unit_price: Number(i.unit_price) || 0,
    }));

  return (
    <div className="space-y-5">
      {/* Products */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-base font-semibold">Produtos / Valores</Label>
          <Button variant="outline" size="sm" onClick={handleAddItem} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Adicionar
          </Button>
        </div>

        {itemsLoading ? (
          <div className="flex items-center justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-2">
            {localItems.map((item) => {
              const lineTotal = item.quantity * (Number(item.unit_price) || 0);
              return (
                <motion.div key={item.id} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-3 border rounded-lg bg-muted/30 space-y-3">
                  <div className="flex gap-3 items-start">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs text-muted-foreground">Produto (opcional)</Label>
                      <ProductCombobox
                        products={products}
                        value={item.product_id}
                        onSelect={(v) => handleProductSelect(item.id, v)}
                      />
                    </div>
                    {localItems.length > 1 && (
                      <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive hover:text-destructive hover:bg-destructive/10 mt-5" onClick={() => handleRemoveItem(item.id, item.isNew)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Qtd.</Label>
                      <Input type="number" min={1} value={item.quantity} onChange={(e) => handleItemFieldChange(item.id, "quantity", e.target.value)} className="text-center" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Preço unit. (R$)</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input type="number" min={0} step="0.01" value={item.unit_price} onChange={(e) => handleItemFieldChange(item.id, "unit_price", e.target.value)} placeholder="0" className="pl-9" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Total</Label>
                      <div className="h-10 flex items-center px-3 rounded-md border bg-muted/50 text-sm font-medium">
                        {lineTotal > 0 ? formatCurrency(lineTotal) : "—"}
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
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
                {localItems.filter((i) => i.unit_price).length} item(ns)
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
              onClick={() => setFormData({ ...formData, status: status.id, loss_reason: status.id !== "perdido" ? "" : formData.loss_reason })}
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

        {/* Loss reason — shown when status is "perdido" */}
        {formData.status === "perdido" && (
          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Motivo da perda</Label>
            <Select
              value={formData.loss_reason || ""}
              onValueChange={(v) => setFormData({ ...formData, loss_reason: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecionar motivo (opcional)" />
              </SelectTrigger>
              <SelectContent>
                {LOSS_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
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

      {/* Cadastro Externo Confirm Dialog */}
      <CadastroExternoConfirmDialog
        open={cadastroExternoOpen}
        onOpenChange={setCadastroExternoOpen}
        pipePropostaId={proposta.id}
        lead={lead}
        items={tinyItems}
        totalValue={totalValue}
        contractDuration={formData.contract_duration ? Number(formData.contract_duration) : null}
        proposalNotes={formData.notes || null}
        onSuccess={() => { onSuccess?.(); }}
      />
    </div>
  );
}
