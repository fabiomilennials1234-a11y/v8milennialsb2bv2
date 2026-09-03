import { memo, useState, useEffect } from "react";
import {
  DollarSign,
  Lock,
  Loader2,
  Save,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  type PipePropostasStatus,
  propostasStatusColumns as statusColumns,
} from "@/contracts/pipe";
import type { Tables } from "@/integrations/supabase/types";
import { usePipeOps } from "../../../pipe-ops";
import { useNomeDoPipeDeSistema } from "../../../hooks/useNomeDoPipeDeSistema";
import { useActiveProducts } from "@/modules/carteira/hooks/useProducts";
import { useTinyErpStatus } from "@/modules/carteira/hooks/useTinyErp";
import { useCadastroExternoEnabled } from "@/modules/marketing/hooks/useCadastroExterno";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";

type PipeProposta = Tables<"pipe_propostas">;
import { ProductCombobox } from "@/modules/carteira/components/proposal/ProductCombobox";
import { TinyErpConfirmOrderDialog } from "@/modules/carteira/components/proposal/TinyErpConfirmOrderDialog";
import { CadastroExternoConfirmDialog } from "@/modules/carteira/components/proposal/CadastroExternoConfirmDialog";
import { cn } from "@/lib/utils";

/**
 * Cross-pipe field block for "Orçamento" (pipe_propostas).
 *
 * States:
 *   - empty:    lead not in pipe_propostas → CTA "Adicionar à Propostas"
 *   - editable: items editor + status grid + Salvar + side-effect flows
 *               (TinyERP / Cadastro Externo on "vendido", loss reason on "perdido")
 *   - locked:   read-only with lock indicator + currency total + status badge
 */
interface BudgetFieldBlockProps {
  leadId: string;
  organizationId: string;
  pipeData: PipeProposta | null;
  locked: boolean;
  onSuccess?: () => void;
  /**
   * When `true`, render without the outer rounded card wrapper. Used by
   * the CrossPipePanel's ActionPanel, which already provides the card
   * chrome. Default `false` keeps backward compatibility.
   */
  bare?: boolean;
}

type LocalItem = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: string;
  isNew?: boolean;
};

const formatCurrency = (v: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
  }).format(v);

export const BudgetFieldBlock = memo(function BudgetFieldBlock({
  leadId,
  pipeData,
  locked,
  onSuccess,
  bare = false,
}: BudgetFieldBlockProps) {
  const {
    useCreatePipeProposta,
    useUpdatePipeProposta,
    useCreatePipePropostaItem,
    useUpdatePipePropostaItem,
    useDeletePipePropostaItem,
    usePipePropostaItems,
    useLossReasons,
  } = usePipeOps();
  // Nome como a ORG o vê (SCRUM-641) — nada de "Propostas" cravado.
  const nomeDoPipe = useNomeDoPipeDeSistema();
  const nomePropostas = nomeDoPipe("propostas");
  const createPipe = useCreatePipeProposta();
  const updateProposta = useUpdatePipeProposta();
  const createItem = useCreatePipePropostaItem();
  const updateItem = useUpdatePipePropostaItem();
  const deleteItem = useDeletePipePropostaItem();
  const logAction = useLogLeadAction();

  const { data: products = [] } = useActiveProducts();
  const { data: itemsData = [], isLoading: itemsLoading } = usePipePropostaItems(pipeData?.id);
  const { data: tinyStatus } = useTinyErpStatus();
  const cadastroExternoEnabled = useCadastroExternoEnabled();
  const { data: lossReasons = [] } = useLossReasons();

  const [statusLocal, setStatusLocal] = useState<PipePropostasStatus>(
    pipeData?.status ?? "marcar_compromisso",
  );
  const [lossReason, setLossReason] = useState<string>(pipeData?.loss_reason ?? "");
  const [localItems, setLocalItems] = useState<LocalItem[]>([]);
  const [itemsInitialized, setItemsInitialized] = useState(false);
  const [tinyOpen, setTinyOpen] = useState(false);
  const [cadastroOpen, setCadastroOpen] = useState(false);

  // Reset on entry change
  useEffect(() => {
    if (!pipeData) return;
    setStatusLocal((pipeData.status as PipePropostasStatus) ?? "marcar_compromisso");
    setLossReason(pipeData.loss_reason ?? "");
    setItemsInitialized(false);
  }, [pipeData?.id]);

  useEffect(() => {
    if (itemsInitialized || itemsLoading || !pipeData) return;
    if (itemsData.length > 0) {
      setLocalItems(
        itemsData.map((it) => ({
          id: it.id,
          product_id: it.product_id || "",
          quantity: it.quantity ?? 1,
          unit_price: it.unit_price?.toString() || it.sale_value?.toString() || "",
        })),
      );
    } else if (pipeData.product_id) {
      setLocalItems([
        {
          id: "legacy",
          product_id: pipeData.product_id,
          quantity: 1,
          unit_price: pipeData.sale_value?.toString() || "",
        },
      ]);
    } else {
      setLocalItems([
        { id: crypto.randomUUID(), product_id: "", quantity: 1, unit_price: "", isNew: true },
      ]);
    }
    setItemsInitialized(true);
  }, [pipeData, itemsData, itemsLoading, itemsInitialized]);

  // ─── State: empty ──────────────────────────────────────────────────
  if (!pipeData) {
    const handleAdd = async () => {
      try {
        await createPipe.mutateAsync({
          lead_id: leadId,
          status: "marcar_compromisso",
        });
        logAction({
          leadId,
          action: "pipe_added",
          description: `Lead adicionado ao funil "${nomePropostas}"`,
        });
        toast.success(`Lead adicionado a ${nomePropostas}`);
        onSuccess?.();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : `Erro ao adicionar a ${nomePropostas}`;
        toast.error(msg);
      }
    };

    return (
      <div className="rounded-xl border border-dashed border-border/40 bg-muted/20 p-4 text-center space-y-3">
        <DollarSign className="w-6 h-6 mx-auto text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">Sem proposta</p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAdd}
          disabled={createPipe.isPending}
          className="gap-1.5"
        >
          {createPipe.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          Adicionar a {nomePropostas}
        </Button>
      </div>
    );
  }

  const currentStatusMeta = statusColumns.find((s) => s.id === pipeData.status);
  const totalValueDb = pipeData.sale_value ?? 0;

  // ─── State: locked ─────────────────────────────────────────────────
  if (locked) {
    return (
      <div
        className={cn(
          bare ? "space-y-2 relative" : "rounded-xl border border-border/40 bg-card p-4 space-y-2 relative",
        )}
      >
        <div
          aria-label="Somente leitura — sem permissão para editar"
          className="absolute top-3 right-3 text-muted-foreground/50"
        >
          <Lock className="w-3.5 h-3.5" />
        </div>
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Orçamento</span>
        </div>
        <p className="text-2xl font-bold text-success">{formatCurrency(totalValueDb)}</p>
        {currentStatusMeta && (
          <Badge
            variant="outline"
            style={{
              backgroundColor: `${currentStatusMeta.color}15`,
              borderColor: `${currentStatusMeta.color}40`,
              color: currentStatusMeta.color,
            }}
          >
            {currentStatusMeta.title}
          </Badge>
        )}
      </div>
    );
  }

  // ─── State: editable ───────────────────────────────────────────────

  const handleAddItem = () =>
    setLocalItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), product_id: "", quantity: 1, unit_price: "", isNew: true },
    ]);

  const handleRemoveItem = async (id: string, isNew?: boolean) => {
    if (localItems.length === 1) return;
    if (!isNew && id !== "legacy") {
      try {
        await deleteItem.mutateAsync({ id, propostaId: pipeData.id });
      } catch {
        toast.error("Erro ao remover produto");
        return;
      }
    }
    setLocalItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleProductSelect = (itemId: string, productId: string) => {
    setLocalItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const sp = products.find((p) => p.id === productId);
        return {
          ...it,
          product_id: productId,
          unit_price: sp?.ticket?.toString() ?? it.unit_price,
        };
      }),
    );
  };

  const handleItemFieldChange = (
    itemId: string,
    field: "quantity" | "unit_price",
    value: string,
  ) => {
    setLocalItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        if (field === "quantity") {
          const qty = Math.max(1, parseInt(value, 10) || 1);
          return { ...it, quantity: qty };
        }
        return { ...it, unit_price: value };
      }),
    );
  };

  const totalValue = localItems.reduce(
    (sum, it) => sum + it.quantity * (Number(it.unit_price) || 0),
    0,
  );

  const handleSave = async () => {
    const itemsWithProduct = localItems.filter((i) => i.product_id && i.unit_price);
    const itemsValueOnly = localItems.filter((i) => !i.product_id && i.unit_price);
    const allValuedItems = [...itemsWithProduct, ...itemsValueOnly];

    if (allValuedItems.length === 0) {
      toast.error("Informe o valor da proposta");
      return;
    }
    if (statusLocal === "perdido" && !lossReason) {
      toast.error("Selecione o motivo da perda");
      return;
    }

    try {
      const tv = allValuedItems.reduce(
        (sum, i) => sum + i.quantity * Number(i.unit_price),
        0,
      );
      const productTypes = itemsWithProduct
        .map((i) => products.find((p) => p.id === i.product_id)?.type)
        .filter(Boolean) as Array<"mrr" | "projeto">;
      const hasOnlyMrr = productTypes.length > 0 && productTypes.every((t) => t === "mrr");
      const hasOnlyProjeto = productTypes.length > 0 && productTypes.every((t) => t === "projeto");
      const mainProductType = hasOnlyMrr ? "mrr" : hasOnlyProjeto ? "projeto" : null;

      // Persist items
      for (const item of itemsWithProduct) {
        if (item.isNew || item.id === "legacy") {
          await createItem.mutateAsync({
            pipe_proposta_id: pipeData.id,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: Number(item.unit_price),
            sale_value: item.quantity * Number(item.unit_price),
          });
        } else {
          await updateItem.mutateAsync({
            id: item.id,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: Number(item.unit_price),
            sale_value: item.quantity * Number(item.unit_price),
          });
        }
      }
      // Clean DB items that lost product (converted to value-only)
      const keptIds = new Set(
        itemsWithProduct.filter((i) => !i.isNew && i.id !== "legacy").map((i) => i.id),
      );
      for (const dbItem of itemsData) {
        if (!keptIds.has(dbItem.id)) {
          await deleteItem.mutateAsync({ id: dbItem.id, propostaId: pipeData.id });
        }
      }

      const isNewSale = statusLocal === "vendido" && pipeData.status !== "vendido";
      const shouldShowTiny = isNewSale && tinyStatus?.connected;
      const shouldShowCadastro = isNewSale && cadastroExternoEnabled;

      await updateProposta.mutateAsync({
        id: pipeData.id,
        status: statusLocal as PipePropostasStatus,
        product_type: mainProductType,
        product_id: itemsWithProduct.length === 1 ? itemsWithProduct[0].product_id : null,
        sale_value: tv,
        notes: pipeData.notes ?? null,
        closed_at: ["vendido", "perdido"].includes(statusLocal) ? new Date().toISOString() : null,
        loss_reason: statusLocal === "perdido" ? lossReason || null : null,
        skip_auto_push: shouldShowTiny,
      } as any);

      if (statusLocal !== pipeData.status) {
        logAction({
          leadId,
          action: "proposal_status_changed",
          description: `Status alterado para "${
            statusColumns.find((s) => s.id === statusLocal)?.title ?? statusLocal
          }"`,
        });
      } else {
        logAction({
          leadId,
          action: "field_updated",
          description: "Orçamento atualizado via modal do lead",
        });
      }

      if (shouldShowTiny) {
        toast.success("🎉 Venda fechada!");
        setTinyOpen(true);
        return;
      }
      if (shouldShowCadastro) {
        toast.success("🎉 Venda fechada!");
        setCadastroOpen(true);
        return;
      }

      toast.success(isNewSale ? "🎉 Venda fechada!" : "Proposta atualizada");
      onSuccess?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar proposta";
      toast.error(msg);
    }
  };

  const tinyItems = localItems
    .filter((i) => i.product_id && i.unit_price)
    .map((i) => ({
      product_name: products.find((p) => p.id === i.product_id)?.name ?? "Produto",
      sale_value: i.quantity * (Number(i.unit_price) || 0),
      quantity: i.quantity,
      unit_price: Number(i.unit_price) || 0,
    }));

  return (
    <div className={cn(bare ? "space-y-3" : "rounded-xl border border-border/40 bg-card p-4 space-y-3")}>
      <div className="flex items-center gap-2">
        <DollarSign className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Orçamento</span>
      </div>

      {/* Items */}
      <div className="space-y-2">
        {itemsLoading ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          localItems.map((item) => {
            const lineTotal = item.quantity * (Number(item.unit_price) || 0);
            return (
              <div key={item.id} className="p-2.5 border rounded bg-muted/20 space-y-2">
                <div className="flex gap-2 items-start">
                  <div className="flex-1 space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Produto</Label>
                    <ProductCombobox
                      products={products}
                      value={item.product_id}
                      onSelect={(v) => handleProductSelect(item.id, v)}
                    />
                  </div>
                  {localItems.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:bg-destructive/10 mt-4"
                      onClick={() => handleRemoveItem(item.id, item.isNew)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Qtd.</Label>
                    <Input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => handleItemFieldChange(item.id, "quantity", e.target.value)}
                      className="text-center"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Preço unit. (R$)</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.unit_price}
                      onChange={(e) => handleItemFieldChange(item.id, "unit_price", e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Total</Label>
                    <div className="h-10 flex items-center px-2 rounded border bg-muted/50 text-sm font-medium">
                      {lineTotal > 0 ? formatCurrency(lineTotal) : "—"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <Button variant="outline" size="sm" onClick={handleAddItem} className="gap-1.5 w-full">
          <Plus className="w-3.5 h-3.5" />
          Adicionar produto
        </Button>
      </div>

      {/* Total */}
      <div className="p-3 rounded bg-gradient-to-br from-success/10 to-transparent border border-success/20">
        <Label className="text-xs text-muted-foreground">Valor Total</Label>
        <p className="text-2xl font-bold text-success">{formatCurrency(totalValue)}</p>
      </div>

      {/* Status grid */}
      <div className="space-y-1.5">
        <Label className="text-xs">Status</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {statusColumns.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setStatusLocal(s.id);
                if (s.id !== "perdido") setLossReason("");
              }}
              className={cn(
                "p-1.5 rounded border text-[11px] text-left transition-all",
                statusLocal === s.id
                  ? "border-primary bg-primary/5"
                  : "border-muted hover:border-primary/40",
              )}
            >
              <div className="w-2 h-2 rounded-full mb-1" style={{ backgroundColor: s.color }} />
              <span className="truncate block">{s.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Loss reason */}
      {statusLocal === "perdido" && (
        <div className="space-y-1">
          <Label className="text-xs">Motivo da perda</Label>
          <Select value={lossReason} onValueChange={setLossReason}>
            <SelectTrigger>
              <SelectValue placeholder="Selecionar motivo" />
            </SelectTrigger>
            <SelectContent>
              {lossReasons.map((r: { id: string; label: string }) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Save */}
      <div className="flex justify-end pt-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={updateProposta.isPending}
          className="gap-1.5"
        >
          {updateProposta.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          Salvar Proposta
        </Button>
      </div>

      <TinyErpConfirmOrderDialog
        open={tinyOpen}
        onOpenChange={setTinyOpen}
        pipePropostaId={pipeData.id}
        lead={{ id: leadId } as any}
        items={tinyItems}
        totalValue={totalValue}
        onSuccess={() => {
          onSuccess?.();
          setTinyOpen(false);
        }}
      />

      <CadastroExternoConfirmDialog
        open={cadastroOpen}
        onOpenChange={setCadastroOpen}
        pipePropostaId={pipeData.id}
        lead={{ id: leadId } as any}
        items={tinyItems}
        totalValue={totalValue}
        contractDuration={pipeData.contract_duration ? Number(pipeData.contract_duration) : null}
        proposalNotes={pipeData.notes ?? null}
        onSuccess={() => {
          onSuccess?.();
          setCadastroOpen(false);
        }}
      />
    </div>
  );
});
