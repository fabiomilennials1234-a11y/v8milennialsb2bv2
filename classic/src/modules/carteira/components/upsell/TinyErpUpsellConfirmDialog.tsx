/**
 * Modal de confirmação para envio de venda upsell ao TinyERP.
 *
 * Exibido após registrar uma nova venda na carteira quando TinyERP está conectado.
 * Verifica se o contato já existe no Tiny antes de cadastrar.
 */

import { useState } from "react";
import { Loader2, Send, User, MapPin } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface ClientData {
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
}

interface TinyErpUpsellConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  upsellOrderId: string;
  client: ClientData | null;
  productName: string;
  saleValue: number;
  onComplete: () => void;
}

export function TinyErpUpsellConfirmDialog({
  open,
  onOpenChange,
  upsellOrderId,
  client,
  productName,
  saleValue,
  onComplete,
}: TinyErpUpsellConfirmDialogProps) {
  const queryClient = useQueryClient();
  const [isPushing, setIsPushing] = useState(false);

  const [clientData, setClientData] = useState({
    nome: client?.name || "",
    cpf_cnpj: "",
    email: client?.email || "",
    fone: client?.phone || "",
    endereco: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
    cep: "",
  });

  const handleConfirm = async () => {
    if (!clientData.nome.trim()) {
      toast.error("Nome do cliente é obrigatório");
      return;
    }

    setIsPushing(true);

    try {
      const { data, error } = await supabase.functions.invoke("tinyerp-push-upsell-order", {
        body: {
          upsell_order_id: upsellOrderId,
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
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const desc = data?.contact_found
        ? "Contato já existia no TinyERP"
        : "Contato cadastrado no TinyERP";

      toast.success("Pedido enviado para o TinyERP!", {
        description: data?.tiny_order_number
          ? `Pedido #${data.tiny_order_number} — ${desc}`
          : desc,
      });

      queryClient.invalidateQueries({ queryKey: ["tinyerp-order-mapping"] });
      queryClient.invalidateQueries({ queryKey: ["tinyerp-sync-logs"] });

      onOpenChange(false);
      onComplete();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error("Erro ao enviar pedido", { description: msg });
    } finally {
      setIsPushing(false);
    }
  };

  const handleSkip = () => {
    onOpenChange(false);
    onComplete();
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
          Confirme os dados do cliente. Se o contato já existir no TinyERP, apenas o pedido será criado.
        </p>

        {/* Order summary */}
        <div className="bg-muted/40 rounded-lg p-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Resumo da venda</p>
          <div className="flex justify-between text-sm">
            <span className="truncate mr-2">{productName}</span>
            <span className="font-medium shrink-0">
              {saleValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </span>
          </div>
          <Separator className="my-1" />
          <div className="flex justify-between text-sm font-semibold">
            <span>Total</span>
            <span className="text-green-500">
              {saleValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
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
