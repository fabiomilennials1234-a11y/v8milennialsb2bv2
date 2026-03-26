/**
 * Modal de confirmação para cadastro de cliente no sistema externo.
 *
 * Exibido quando o usuário marca uma proposta como "vendido" e a feature
 * external_cadastro está habilitada para a org. Permite preencher/confirmar
 * dados do cliente antes de enviar ao Sistema Millennials.
 */

import { useState, useEffect } from "react";
import { Loader2, UserPlus, Building2, DollarSign, Package } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  useCadastroExternoPush,
  type CadastroExternoPushPayload,
} from "@/hooks/useCadastroExterno";

// ─── Product slug mapping ───────────────────────────────────────

const PRODUCT_SLUG_MAP: Record<string, string> = {
  "millennials growth": "millennials-growth",
  "millennials outbound": "millennials-outbound",
  "millennials paddock": "millennials-paddock",
  "torque crm": "torque-crm",
  "millennials hunting": "millennials-hunting",
};

const ALL_PRODUCTS = [
  { slug: "millennials-growth", label: "Millennials Growth" },
  { slug: "millennials-outbound", label: "Millennials Outbound" },
  { slug: "millennials-paddock", label: "Millennials Paddock" },
  { slug: "torque-crm", label: "Torque CRM" },
  { slug: "millennials-hunting", label: "Millennials Hunting" },
];

function nameToSlug(name: string): string | null {
  const normalized = name.trim().toLowerCase();
  if (PRODUCT_SLUG_MAP[normalized]) return PRODUCT_SLUG_MAP[normalized];
  for (const [key, slug] of Object.entries(PRODUCT_SLUG_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) return slug;
  }
  return null;
}

// ─── Types ──────────────────────────────────────────────────────

interface LeadData {
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  segment?: string;
  notes?: string;
}

interface CadastroExternoConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipePropostaId: string;
  lead: LeadData | null;
  items: Array<{ product_name: string; sale_value: number }>;
  totalValue: number;
  contractDuration: number | null;
  proposalNotes: string | null;
  onSuccess: () => void;
}

// ─── Component ──────────────────────────────────────────────────

export function CadastroExternoConfirmDialog({
  open,
  onOpenChange,
  pipePropostaId,
  lead,
  items,
  totalValue,
  contractDuration,
  proposalNotes,
  onSuccess,
}: CadastroExternoConfirmDialogProps) {
  const pushMutation = useCadastroExternoPush();

  // ── Client identification ──
  const [nomeCliente, setNomeCliente] = useState("");
  const [razaoSocial, setRazaoSocial] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [cpf, setCpf] = useState("");
  const [nicho, setNicho] = useState("");

  // ── Details ──
  const [observacoesGestor, setObservacoesGestor] = useState("");

  // ── Financial ──
  const [investimentoPrevisto, setInvestimentoPrevisto] = useState("");
  const [comissaoVendas, setComissaoVendas] = useState("0");
  const [duracaoContrato, setDuracaoContrato] = useState("");
  const [diaVencimento, setDiaVencimento] = useState("10");
  const [dataEntrada, setDataEntrada] = useState("");

  // ── Products ──
  const [selectedProducts, setSelectedProducts] = useState<Record<string, boolean>>({});
  const [productValues, setProductValues] = useState<Record<string, string>>({});

  // Reset form when dialog opens
  useEffect(() => {
    if (!open) return;

    setNomeCliente(lead?.name || "");
    setRazaoSocial(lead?.company || "");
    setCnpj("");
    setCpf("");
    setNicho(lead?.segment || "");
    setObservacoesGestor(proposalNotes || "");
    setInvestimentoPrevisto(totalValue > 0 ? totalValue.toString() : "");
    setComissaoVendas("0");
    setDuracaoContrato(contractDuration ? contractDuration.toString() : "");
    setDiaVencimento("10");
    setDataEntrada(new Date().toISOString().split("T")[0]);

    // Pre-select products from proposal items
    const prods: Record<string, boolean> = {};
    const vals: Record<string, string> = {};
    for (const item of items) {
      const slug = nameToSlug(item.product_name);
      if (slug) {
        prods[slug] = true;
        vals[slug] = item.sale_value.toString();
      }
    }
    setSelectedProducts(prods);
    setProductValues(vals);
  }, [open, lead, items, totalValue, contractDuration, proposalNotes]);

  const handleConfirm = async () => {
    // Validation
    if (!nomeCliente.trim()) { toast.error("Nome do cliente é obrigatório"); return; }
    if (!razaoSocial.trim()) { toast.error("Razão social é obrigatória"); return; }
    if (!cnpj.trim()) { toast.error("CNPJ é obrigatório"); return; }
    if (!nicho.trim()) { toast.error("Nicho é obrigatório"); return; }
    if (!observacoesGestor.trim()) { toast.error("Observações para o gestor é obrigatório"); return; }
    if (!investimentoPrevisto || Number(investimentoPrevisto) <= 0) { toast.error("Investimento previsto deve ser maior que 0"); return; }
    if (!duracaoContrato || Number(duracaoContrato) <= 0) { toast.error("Duração do contrato é obrigatória"); return; }
    if (!dataEntrada) { toast.error("Data de entrada é obrigatória"); return; }

    // Build product arrays
    const produtosSelecionados = Object.entries(selectedProducts)
      .filter(([, checked]) => checked)
      .map(([slug]) => slug);

    const valoresProdutos: Record<string, number> = {};
    for (const slug of produtosSelecionados) {
      const val = Number(productValues[slug]);
      if (!val || val <= 0) {
        const label = ALL_PRODUCTS.find((p) => p.slug === slug)?.label || slug;
        toast.error(`Informe o valor do produto "${label}"`);
        return;
      }
      valoresProdutos[slug] = val;
    }

    const payload: CadastroExternoPushPayload = {
      pipe_proposta_id: pipePropostaId,
      nome_cliente: nomeCliente.trim(),
      razao_social: razaoSocial.trim(),
      cnpj: cnpj.trim(),
      cpf: cpf.trim() || undefined,
      nicho: nicho.trim(),
      observacoes_gestor: observacoesGestor.trim(),
      investimento_previsto: Number(investimentoPrevisto),
      comissao_vendas_percent: Number(comissaoVendas),
      data_entrada: dataEntrada,
      duracao_contrato_meses: Number(duracaoContrato),
      dia_vencimento: Number(diaVencimento),
      produtos_contratados: produtosSelecionados,
      valores_produtos: valoresProdutos,
    };

    try {
      await pushMutation.mutateAsync(payload);
      onOpenChange(false);
      onSuccess();
    } catch {
      // Error toast is handled by the mutation's onError
    }
  };

  const handleSkip = () => {
    onOpenChange(false);
    onSuccess();
  };

  const isPushing = pushMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !isPushing) onOpenChange(false);
      }}
    >
      <DialogContent className="max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-green-600" />
            Cadastrar Cliente no Sistema
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground -mt-2">
          Confirme os dados do cliente antes de cadastrar no sistema externo.
        </p>

        {/* ── Order summary ── */}
        <div className="bg-muted/40 rounded-lg p-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Resumo da venda
          </p>
          {items.map((item, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span className="truncate mr-2">{item.product_name}</span>
              <span className="font-medium shrink-0">
                {item.sale_value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </span>
            </div>
          ))}
          <Separator className="my-1" />
          <div className="flex justify-between text-sm font-semibold">
            <span>Total</span>
            <span className="text-green-600">
              {totalValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </span>
          </div>
        </div>

        {/* ── Client identification ── */}
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5" /> Identificação do cliente
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Nome do Cliente *</Label>
              <Input
                value={nomeCliente}
                onChange={(e) => setNomeCliente(e.target.value)}
                placeholder="Nome fantasia ou apelido"
                maxLength={100}
              />
            </div>
            <div>
              <Label className="text-xs">Razão Social *</Label>
              <Input
                value={razaoSocial}
                onChange={(e) => setRazaoSocial(e.target.value)}
                placeholder="Razão social da empresa"
                maxLength={255}
              />
            </div>
            <div>
              <Label className="text-xs">CNPJ *</Label>
              <Input
                value={cnpj}
                onChange={(e) => setCnpj(e.target.value)}
                placeholder="00.000.000/0000-00"
              />
            </div>
            <div>
              <Label className="text-xs">CPF</Label>
              <Input
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                placeholder="000.000.000-00"
              />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Nicho *</Label>
              <Input
                value={nicho}
                onChange={(e) => setNicho(e.target.value)}
                placeholder="Ex: Restaurante, E-commerce, Clínica..."
                maxLength={100}
              />
            </div>
          </div>
        </div>

        {/* ── Observações ── */}
        <div className="space-y-3">
          <Label className="text-xs">O que o gestor precisa saber sobre esse cliente? *</Label>
          <Textarea
            value={observacoesGestor}
            onChange={(e) => setObservacoesGestor(e.target.value)}
            placeholder="Detalhes importantes, histórico, observações relevantes..."
            maxLength={1000}
            rows={3}
          />
          <p className="text-xs text-muted-foreground">{observacoesGestor.length}/1000 caracteres</p>
        </div>

        {/* ── Financial ── */}
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5" /> Financeiro
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Investimento Previsto (R$) *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={investimentoPrevisto}
                onChange={(e) => setInvestimentoPrevisto(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div>
              <Label className="text-xs">% Comissão Vendas *</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={comissaoVendas}
                onChange={(e) => setComissaoVendas(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <Label className="text-xs">Data de Entrada *</Label>
              <Input
                type="date"
                value={dataEntrada}
                onChange={(e) => setDataEntrada(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Duração do Contrato (meses) *</Label>
              <Input
                type="number"
                min="1"
                value={duracaoContrato}
                onChange={(e) => setDuracaoContrato(e.target.value)}
                placeholder="12"
              />
            </div>
            <div>
              <Label className="text-xs">Dia de Vencimento *</Label>
              <Select value={diaVencimento} onValueChange={setDiaVencimento}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 5, 10, 15, 20, 25].map((d) => (
                    <SelectItem key={d} value={d.toString()}>
                      Dia {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* ── Products ── */}
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5" /> Produtos Contratados
          </p>
          <div className="space-y-2">
            {ALL_PRODUCTS.map((product) => (
              <div key={product.slug} className="flex items-center gap-3">
                <Checkbox
                  id={product.slug}
                  checked={selectedProducts[product.slug] || false}
                  onCheckedChange={(checked) =>
                    setSelectedProducts((prev) => ({ ...prev, [product.slug]: !!checked }))
                  }
                />
                <Label htmlFor={product.slug} className="text-sm flex-1 cursor-pointer">
                  {product.label}
                </Label>
                {selectedProducts[product.slug] && (
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-32"
                    value={productValues[product.slug] || ""}
                    onChange={(e) =>
                      setProductValues((prev) => ({ ...prev, [product.slug]: e.target.value }))
                    }
                    placeholder="R$ 0,00"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={handleSkip} disabled={isPushing}>
            Pular (não cadastrar)
          </Button>
          <Button className="flex-1" onClick={handleConfirm} disabled={isPushing}>
            {isPushing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Cadastrando...
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4 mr-2" />
                Cadastrar Cliente
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
