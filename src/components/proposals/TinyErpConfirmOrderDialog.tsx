/**
 * Modal de confirmação para envio de pedido ao TinyERP.
 *
 * Exibido quando o usuário marca uma proposta como "vendido" e o TinyERP está conectado.
 * Permite preencher/confirmar dados do cliente antes de enviar.
 */

import { useState } from "react";
import { Loader2, Send, User, MapPin, Truck, CreditCard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface LeadData {
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  segment?: string;
  faturamento?: number;
}

interface TinyErpConfirmOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipePropostaId: string;
  lead: LeadData | null;
  items: Array<{ product_name: string; sale_value: number }>;
  totalValue: number;
  onSuccess: () => void;
}

export function TinyErpConfirmOrderDialog({
  open,
  onOpenChange,
  pipePropostaId,
  lead,
  items,
  totalValue,
  onSuccess,
}: TinyErpConfirmOrderDialogProps) {
  const queryClient = useQueryClient();
  const [isPushing, setIsPushing] = useState(false);

  // Client fields — pre-filled from lead, editable
  const [clientData, setClientData] = useState({
    nome: lead?.name || "",
    empresa: lead?.company || "",
    cpf_cnpj: "",
    email: lead?.email || "",
    fone: lead?.phone || "",
    endereco: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
    cep: "",
  });

  // Freight fields
  const [freteData, setFreteData] = useState({
    valor_frete: "",
    frete_por_conta: "R",
    nome_transportador: "",
    forma_envio: "",
  });

  // Payment fields
  const [condicaoPagamento, setCondicaoPagamento] = useState("avista");
  const [meioPagamento, setMeioPagamento] = useState("pix");

  // Reset form when dialog opens with new data
  const resetForm = () => {
    setClientData({
      nome: lead?.name || "",
      empresa: lead?.company || "",
      cpf_cnpj: "",
      email: lead?.email || "",
      fone: lead?.phone || "",
      endereco: "",
      numero: "",
      complemento: "",
      bairro: "",
      cidade: "",
      uf: "",
      cep: "",
    });
    setFreteData({ valor_frete: "", frete_por_conta: "R", nome_transportador: "", forma_envio: "" });
    setCondicaoPagamento("avista");
    setMeioPagamento("pix");
  };

  const handleConfirm = async () => {
    if (!clientData.nome.trim()) {
      toast.error("Nome do cliente é obrigatório");
      return;
    }

    setIsPushing(true);

    try {
      // Build parcelas based on payment condition
      const valorFrete = parseFloat(freteData.valor_frete) || 0;
      const totalComFrete = totalValue + valorFrete;
      const parcelasConfig: Record<string, number[]> = {
        avista: [0],
        "30dias": [30],
        "30_60": [30, 60],
        "30_60_90": [30, 60, 90],
      };
      const diasParcelas = parcelasConfig[condicaoPagamento] || [0];
      const valorParcela = totalComFrete / diasParcelas.length;
      const parcelas = diasParcelas.map((dias) => ({
        dias,
        valor: Math.round(valorParcela * 100) / 100,
      }));

      const { data, error } = await supabase.functions.invoke("tinyerp-push-order", {
        body: {
          pipe_proposta_id: pipePropostaId,
          client_override: {
            nome: clientData.nome.trim(),
            cpf_cnpj: clientData.cpf_cnpj.trim(),
            email: clientData.email.trim(),
            fone: clientData.fone.trim(),
            endereco: [clientData.endereco, clientData.numero, clientData.complemento]
              .filter(Boolean)
              .join(", "),
            bairro: clientData.bairro.trim(),
            cidade: clientData.cidade.trim(),
            uf: clientData.uf.trim(),
            cep: clientData.cep.replace(/\D/g, ""),
          },
          frete: {
            valor_frete: valorFrete,
            frete_por_conta: freteData.frete_por_conta,
            nome_transportador: freteData.nome_transportador.trim() || undefined,
            forma_envio: freteData.forma_envio.trim() || undefined,
          },
          parcelas,
          meio_pagamento: meioPagamento,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success("Pedido enviado para o TinyERP!", {
        description: data?.tiny_order_number ? `Pedido #${data.tiny_order_number}` : undefined,
      });

      queryClient.invalidateQueries({ queryKey: ["tinyerp-order-mapping"] });
      queryClient.invalidateQueries({ queryKey: ["tinyerp-sync-logs"] });

      onOpenChange(false);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error("Erro ao enviar pedido", { description: msg });
    } finally {
      setIsPushing(false);
    }
  };

  const handleSkip = () => {
    onOpenChange(false);
    onSuccess();
  };

  const updateField = (field: string, value: string) => {
    setClientData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !isPushing) {
          onOpenChange(false);
        }
      }}
    >
      <DialogContent className="max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="w-5 h-5 text-blue-500" />
            Enviar pedido ao TinyERP
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground -mt-2">
          Confirme os dados do cliente antes de enviar o pedido. Campos em branco serão ignorados.
        </p>

        {/* Order summary */}
        <div className="bg-muted/40 rounded-lg p-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Resumo do pedido</p>
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
            <span className="text-green-500">
              {totalValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </span>
          </div>
        </div>

        {/* Client data form */}
        <div className="space-y-4">
          {/* Identity */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" /> Dados do cliente
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Nome *</Label>
                <Input
                  value={clientData.nome}
                  onChange={(e) => updateField("nome", e.target.value)}
                  placeholder="Nome do cliente"
                />
              </div>
              <div>
                <Label className="text-xs">CPF/CNPJ</Label>
                <Input
                  value={clientData.cpf_cnpj}
                  onChange={(e) => updateField("cpf_cnpj", e.target.value)}
                  placeholder="000.000.000-00"
                />
              </div>
              <div>
                <Label className="text-xs">Telefone</Label>
                <Input
                  value={clientData.fone}
                  onChange={(e) => updateField("fone", e.target.value)}
                  placeholder="(00) 00000-0000"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Email</Label>
                <Input
                  value={clientData.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  placeholder="email@empresa.com"
                />
              </div>
            </div>
          </div>

          {/* Address */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" /> Endereço (opcional)
            </p>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-8">
                <Label className="text-xs">Endereço</Label>
                <Input
                  value={clientData.endereco}
                  onChange={(e) => updateField("endereco", e.target.value)}
                  placeholder="Rua, Avenida..."
                />
              </div>
              <div className="col-span-4">
                <Label className="text-xs">Número</Label>
                <Input
                  value={clientData.numero}
                  onChange={(e) => updateField("numero", e.target.value)}
                  placeholder="123"
                />
              </div>
              <div className="col-span-6">
                <Label className="text-xs">Complemento</Label>
                <Input
                  value={clientData.complemento}
                  onChange={(e) => updateField("complemento", e.target.value)}
                  placeholder="Sala, Andar..."
                />
              </div>
              <div className="col-span-6">
                <Label className="text-xs">Bairro</Label>
                <Input
                  value={clientData.bairro}
                  onChange={(e) => updateField("bairro", e.target.value)}
                  placeholder="Bairro"
                />
              </div>
              <div className="col-span-5">
                <Label className="text-xs">Cidade</Label>
                <Input
                  value={clientData.cidade}
                  onChange={(e) => updateField("cidade", e.target.value)}
                  placeholder="Cidade"
                />
              </div>
              <div className="col-span-3">
                <Label className="text-xs">UF</Label>
                <Input
                  value={clientData.uf}
                  onChange={(e) => updateField("uf", e.target.value.toUpperCase().slice(0, 2))}
                  placeholder="SP"
                  maxLength={2}
                />
              </div>
              <div className="col-span-4">
                <Label className="text-xs">CEP</Label>
                <Input
                  value={clientData.cep}
                  onChange={(e) => updateField("cep", e.target.value)}
                  placeholder="00000-000"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Freight & Payment */}
        <div className="space-y-4">
          {/* Freight */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Truck className="w-3.5 h-3.5" /> Frete (opcional)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Valor do frete (R$)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={freteData.valor_frete}
                  onChange={(e) => setFreteData((p) => ({ ...p, valor_frete: e.target.value }))}
                  placeholder="0,00"
                />
              </div>
              <div>
                <Label className="text-xs">Frete por conta</Label>
                <Select
                  value={freteData.frete_por_conta}
                  onValueChange={(v) => setFreteData((p) => ({ ...p, frete_por_conta: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="R">Remetente</SelectItem>
                    <SelectItem value="D">Destinatário</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Transportadora</Label>
                <Input
                  value={freteData.nome_transportador}
                  onChange={(e) => setFreteData((p) => ({ ...p, nome_transportador: e.target.value }))}
                  placeholder="Nome da transportadora"
                />
              </div>
              <div>
                <Label className="text-xs">Forma de envio</Label>
                <Input
                  value={freteData.forma_envio}
                  onChange={(e) => setFreteData((p) => ({ ...p, forma_envio: e.target.value }))}
                  placeholder="Correios PAC, Sedex..."
                />
              </div>
            </div>
          </div>

          {/* Payment */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" /> Pagamento
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Condição de pagamento</Label>
                <Select value={condicaoPagamento} onValueChange={setCondicaoPagamento}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="avista">À vista</SelectItem>
                    <SelectItem value="30dias">30 dias</SelectItem>
                    <SelectItem value="30_60">30/60 dias</SelectItem>
                    <SelectItem value="30_60_90">30/60/90 dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Meio de pagamento</Label>
                <Select value={meioPagamento} onValueChange={setMeioPagamento}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dinheiro">Dinheiro</SelectItem>
                    <SelectItem value="boleto">Boleto</SelectItem>
                    <SelectItem value="cartao_credito">Cartão de crédito</SelectItem>
                    <SelectItem value="cartao_debito">Cartão de débito</SelectItem>
                    <SelectItem value="pix">PIX</SelectItem>
                    <SelectItem value="transferencia">Transferência</SelectItem>
                    <SelectItem value="outros">Outros</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleSkip}
            disabled={isPushing}
          >
            Pular (não enviar)
          </Button>
          <Button
            className="flex-1"
            onClick={handleConfirm}
            disabled={isPushing}
          >
            {isPushing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Confirmar e Enviar
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
