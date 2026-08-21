import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Pencil,
  ArrowRight,
  FileWarning,
  CalendarDays,
  User,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatBRL,
  formatDateFull,
  maskCurrencyInput,
  parseCurrencyInput,
} from "@/lib/format";
import { ClientChipSelector } from "@/modules/carteira/components/client/ClientChipSelector";
import { ProductCombobox } from "@/modules/carteira/components/client/ProductCombobox";
import { OrderItemList } from "@/modules/carteira/components/client/OrderItemList";
import { useUpsellClients } from "@/modules/carteira/hooks/useUpsellClients";
import { useTeamMembers } from "@/modules/identity";
import { editOrderSchema, sumItems } from "@/modules/carteira/lib/order-schema";
import {
  toDateInput,
  withDatePreservingTime,
} from "@/modules/carteira/lib/order-date";
import {
  useUpdateOrder,
  type UpdateOrderPatch,
} from "@/modules/carteira/hooks/useUpdateOrder";
import type { OrderLineItem } from "@/modules/carteira/hooks/useQuickOrder";
import type { CarteiraOrderRow } from "@/modules/carteira/hooks/useCarteiraOrders";

interface EditOrderDialogProps {
  order: CarteiraOrderRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NONE = "none";

const sectionLabel =
  "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";


export function EditOrderDialog({
  order,
  open,
  onOpenChange,
}: EditOrderDialogProps) {
  const updateOrder = useUpdateOrder();
  const { data: clients = [] } = useUpsellClients();
  const { data: teamMembers = [] } = useTeamMembers();

  // Estado controlado (não RHF): `ProductCombobox`/`OrderItemList` — que a spec
  // manda reusar — expõem API controlada (items + onChangeItem + onRemoveItem),
  // que não compõe com `useFieldArray`. A validação Zod continua sendo a mesma
  // (`editOrderSchema`), que é o que espelha os CHECKs do banco.
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [items, setItems] = useState<OrderLineItem[]>([]);
  const [finalValue, setFinalValue] = useState("");
  const [productName, setProductName] = useState("");
  const [soldAt, setSoldAt] = useState("");
  const [closerId, setCloserId] = useState("");
  const [saleResponsibleId, setSaleResponsibleId] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Pedido nasceu com itens? Define o modo do dialog e não muda enquanto aberto
  // — um pedido `manual_total` (venda avulsa) não vira pedido com itens aqui.
  const hasItems = (order?.items?.length ?? 0) > 0;

  useEffect(() => {
    if (!open || !order) return;
    setClientId(order.client_id);
    setClientName(order.client_name);
    setItems(
      (order.items ?? []).map((i) => ({
        product_id: i.product_id ?? undefined,
        product_name: i.product_name,
        quantity: Number(i.quantity),
        unit_price: Number(i.unit_price),
        unit: i.unit ?? "un",
      })),
    );
    setFinalValue(maskCurrencyInput(String(Math.round(Number(order.sale_value) * 100))));
    setProductName(order.product_name);
    setSoldAt(toDateInput(order.sold_at));
    setCloserId(order.closer_id ?? "");
    setSaleResponsibleId(order.sale_responsible_id ?? "");
    setError(null);
  }, [open, order]);

  const itemsTotal = useMemo(() => sumItems(items), [items]);
  const manualValue = parseCurrencyInput(finalValue);
  const total = hasItems ? itemsTotal : manualValue;

  const previousClient = clients.find((c) => c.id === order?.client_id);
  const nextClient = clients.find((c) => c.id === clientId);
  const movingClient = !!order && clientId !== order.client_id;

  // O cliente de origem fica sem nenhum pedido? `order_count` já é a contagem
  // de pedidos APROVADOS (recalc_upsell_client_metrics filtra approval_status).
  const originGoesEmpty =
    movingClient && (previousClient?.order_count ?? 0) <= 1;

  const isDirty =
    !!order &&
    (clientId !== order.client_id ||
      productName !== order.product_name ||
      soldAt !== toDateInput(order.sold_at) ||
      (closerId || "") !== (order.closer_id ?? "") ||
      (saleResponsibleId || "") !== (order.sale_responsible_id ?? "") ||
      (hasItems
        ? JSON.stringify(items) !==
          JSON.stringify(
            (order.items ?? []).map((i) => ({
              product_id: i.product_id ?? undefined,
              product_name: i.product_name,
              quantity: Number(i.quantity),
              unit_price: Number(i.unit_price),
              unit: i.unit ?? "un",
            })),
          )
        : manualValue !== Number(order.sale_value)));

  if (!order) return null;

  function handleChangeItem(
    index: number,
    field: keyof OrderLineItem,
    value: string | number,
  ) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  }

  function handleRemoveItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit() {
    if (!order) return;
    setError(null);

    const parsed = editOrderSchema.safeParse({
      client_id: clientId,
      product_name: productName,
      sold_at: soldAt,
      sale_value: hasItems ? itemsTotal : manualValue,
      closer_id: closerId || null,
      sale_responsible_id: saleResponsibleId || null,
      items: hasItems ? items : [],
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Confira os campos.");
      return;
    }

    // Patch SÓ com o que mudou. Mandar campo intocado tem dois custos reais:
    //  1. `sold_at` seria reescrito em toda edição, movendo o instante UTC de
    //     pedidos cuja hora original cai perto da meia-noite;
    //  2. `product_name` sempre presente suprimiria o espelhamento a partir dos
    //     itens que a RPC faz quando a chave está ausente — trocar os itens
    //     deixaria a descrição velha.
    const patch: UpdateOrderPatch = {};
    if (clientId !== order.client_id) patch.client_id = clientId;
    if (productName.trim() !== order.product_name)
      patch.product_name = productName.trim();
    if (soldAt !== toDateInput(order.sold_at))
      patch.sold_at = withDatePreservingTime(order.sold_at, soldAt);
    if ((closerId || null) !== order.closer_id)
      patch.closer_id = closerId || null;
    if ((saleResponsibleId || null) !== order.sale_responsible_id)
      patch.sale_responsible_id = saleResponsibleId || null;
    // Com itens o total é derivado pela RPC; mandar sale_value seria ruído.
    if (!hasItems && manualValue !== Number(order.sale_value))
      patch.sale_value = manualValue;

    // `mutate`, não `await mutateAsync`: o erro já é tratado no `onError` do
    // hook (toast traduzido). Aguardar a promise aqui sem catch fazia todo erro
    // de negócio — `order_erp_linked` incluso — subir como unhandled rejection
    // e virar evento de exceção não capturada no Sentry.
    updateOrder.mutate(
      {
        orderId: order.id,
        patch,
        items: hasItems ? items : undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  const saveBtn = (
    <Button
      size="sm"
      onClick={handleSubmit}
      disabled={!isDirty || updateOrder.isPending}
    >
      {updateOrder.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
      {updateOrder.isPending ? "Salvando…" : "Salvar alterações"}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] gap-0 p-0 overflow-hidden flex flex-col max-h-[85vh]">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border/40 shrink-0">
          <DialogTitle className="flex items-center gap-2.5 text-base">
            <div className="p-1.5 rounded-lg bg-primary/12">
              <Pencil className="w-4 h-4 text-primary" />
            </div>
            Editar pedido
          </DialogTitle>
          <p className="text-xs text-muted-foreground pl-[38px]">
            {order.client_name} · {formatDateFull(order.sold_at)}
          </p>
        </DialogHeader>

        {/* Só o body rola — o dialog não estoura altura em 1366×768.
            Não há aviso de ERP aqui: pedido com vínculo ERP nunca abre este
            dialog (o botão Editar fica bloqueado na tabela, com o motivo). */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* §1 — Cliente */}
          <div className="space-y-2">
            <p className={sectionLabel}>Cliente</p>
            {/* `clientName` vem do pedido, não da lista: ClientChipSelector
                filtra `is_active` e um cliente inativo não seria encontrado. */}
            <ClientChipSelector
              clientId={clientId}
              clientName={clientName}
              onChange={(id, name) => {
                setClientId(id);
                setClientName(name);
              }}
            />

            {movingClient && (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3 motion-reduce:animate-none animate-[panel-down_0.25s_cubic-bezier(0.16,1,0.3,1)]">
                {/* Nomeia o que os números SÃO. A aritmética é sobre
                    `upsell_clients.lifetime_value` — métrica de carteira, não a
                    receita canônica do ADR-0017, que esta edição não corrige.
                    Ver limitação declarada na migration. */}
                <p className="text-[11px] text-muted-foreground mb-2">
                  Faturamento acumulado na carteira
                </p>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className={sectionLabel}>De</p>
                    <p className="text-[13px] text-foreground truncate">
                      {previousClient?.name ?? order.client_name}
                    </p>
                    <p className="text-[13px] tabular-nums text-muted-foreground">
                      {formatBRL(Number(previousClient?.lifetime_value ?? 0), 0)}
                      {" → "}
                      {formatBRL(
                        Number(previousClient?.lifetime_value ?? 0) -
                          Number(order.sale_value),
                        0,
                      )}
                    </p>
                    <p className="text-[13px] tabular-nums text-destructive">
                      −{formatBRL(Number(order.sale_value), 0)}
                    </p>
                  </div>

                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-5" />

                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className={sectionLabel}>Para</p>
                    <p className="text-[13px] text-foreground truncate">
                      {nextClient?.name ?? clientName}
                    </p>
                    <p className="text-[13px] tabular-nums text-muted-foreground">
                      {formatBRL(Number(nextClient?.lifetime_value ?? 0), 0)}
                      {" → "}
                      {formatBRL(
                        Number(nextClient?.lifetime_value ?? 0) + total,
                        0,
                      )}
                    </p>
                    <p className="text-[13px] tabular-nums text-emerald-600 dark:text-emerald-400">
                      +{formatBRL(total, 0)}
                    </p>
                  </div>
                </div>

                {originGoesEmpty && (
                  <p className="text-xs text-amber-500 mt-2 flex items-start gap-1.5">
                    <FileWarning className="w-3.5 h-3.5 shrink-0 mt-px" />
                    {previousClient?.name ?? order.client_name} fica sem pedidos
                    e sai das métricas de carteira
                  </p>
                )}
              </div>
            )}
          </div>

          {/* §2 — Itens (some em pedido `manual_total`) */}
          {hasItems && (
            <div className="space-y-2">
              <p className={sectionLabel}>Itens</p>
              <ProductCombobox
                onAdd={(product) =>
                  setItems((prev) => [
                    ...prev,
                    {
                      product_id: product.product_id,
                      product_name: product.product_name,
                      quantity: 1,
                      unit_price: product.unit_price,
                      unit: product.unit ?? "un",
                    },
                  ])
                }
              />
              <OrderItemList
                items={items}
                onChangeItem={handleChangeItem}
                onRemoveItem={handleRemoveItem}
              />
            </div>
          )}

          {/* §3 — Valor e data */}
          <div className="space-y-2">
            <p className={sectionLabel}>{hasItems ? "Descrição e data" : "Valor e data"}</p>

            {!hasItems && (
              <div className="space-y-1.5">
                <Label
                  htmlFor="edit-final-value"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Valor final da venda
                </Label>
                <div className="relative">
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-semibold tabular-nums",
                      manualValue > 0 ? "text-primary" : "text-muted-foreground/50",
                    )}
                  >
                    R$
                  </span>
                  <Input
                    id="edit-final-value"
                    inputMode="decimal"
                    autoFocus
                    value={finalValue}
                    onChange={(e) => setFinalValue(maskCurrencyInput(e.target.value))}
                    placeholder="0,00"
                    className={cn(
                      "h-12 pl-11 pr-3 text-right text-2xl font-bold tabular-nums tracking-tight border-border/60 focus-visible:border-primary/60",
                      manualValue > 0 ? "text-primary" : "text-foreground",
                    )}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label
                htmlFor="edit-product-name"
                className="text-xs font-medium text-muted-foreground"
              >
                Descrição do pedido
              </Label>
              <Textarea
                id="edit-product-name"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                rows={2}
                className="text-sm resize-none"
                placeholder="O que foi vendido"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Input
                type="date"
                aria-label="Data da venda"
                value={soldAt}
                onChange={(e) => setSoldAt(e.target.value)}
                className="h-7 w-[150px] text-xs border-transparent bg-transparent hover:bg-muted/40 focus:bg-muted/40"
              />
            </div>
          </div>

          {/* §4 — Responsáveis */}
          <div className="space-y-2">
            <p className={sectionLabel}>Responsáveis</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-1.5 min-w-0">
                <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Select
                  value={saleResponsibleId || NONE}
                  onValueChange={(v) => setSaleResponsibleId(v === NONE ? "" : v)}
                >
                  <SelectTrigger
                    aria-label="Responsável pela venda"
                    className="h-8 text-xs"
                  >
                    <SelectValue placeholder="Responsável pela venda" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem responsável</SelectItem>
                    {teamMembers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5 min-w-0">
                <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Select
                  value={closerId || NONE}
                  onValueChange={(v) => setCloserId(v === NONE ? "" : v)}
                >
                  <SelectTrigger aria-label="Closer" className="h-8 text-xs">
                    <SelectValue placeholder="Closer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Sem closer</SelectItem>
                    {teamMembers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* §5 — Observações: SOMENTE LEITURA. `notes` não está na whitelist de
              6 campos da RPC (`carteira_update_order` levanta
              invalid_patch_field) e a lista de campos editáveis foi travada
              pelo CTO. Mostrar o texto ajuda quem veio consertar um valor;
              deixá-lo editável mentiria. */}
          {order.notes && (
            <div className="space-y-1.5">
              <p className={sectionLabel}>Observações</p>
              <p className="text-[13px] text-muted-foreground rounded-lg bg-muted/40 px-3.5 py-2.5 whitespace-pre-wrap">
                {order.notes}
              </p>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-border/40 bg-muted/30">
          <div>
            <span
              className={cn(
                "text-xl font-bold tabular-nums tracking-tight",
                total > 0 ? "text-primary" : "text-muted-foreground/40",
              )}
            >
              {formatBRL(total, 2)}
            </span>
            {hasItems && items.length > 0 && (
              <span className="text-xs text-muted-foreground ml-2">
                {items.length} {items.length === 1 ? "item" : "itens"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={updateOrder.isPending}
            >
              Cancelar
            </Button>
            {/* Todo botão desabilitado aqui precisa dizer por quê. */}
            {!isDirty && !updateOrder.isPending ? (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      aria-label="Nenhuma alteração para salvar"
                      className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="pointer-events-none opacity-50">
                        {saveBtn}
                      </span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Nenhuma alteração para salvar
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              saveBtn
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
