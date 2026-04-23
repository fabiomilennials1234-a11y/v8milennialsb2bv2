/**
 * PixButtonNodeConfig — editor para send_whatsapp_pix_button (Uazapi only).
 *
 * Fields:
 *  - pixkey: chave PIX
 *  - pixkeyType: cpf | cnpj | email | phone | random
 *  - pixAmount: valor em BRL (decimal, ex: 49.90)
 *  - pixMerchantName: nome do recebedor
 *  - pixText: texto acompanhante opcional
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ActionNodeData } from "@/types/workflow";
import { TemplateTextarea } from "@/components/automacoes/TemplateTextarea";

interface Props {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}

export function PixButtonNodeConfig({ data, onUpdate }: Props) {
  return (
    <div className="space-y-4">
      <div className="rounded-md bg-amber-500/5 border border-amber-500/30 p-2">
        <p className="text-xs text-amber-900 dark:text-amber-200">
          Recurso nativo Uazapi. Lead recebe botão "Pagar" no WhatsApp com
          chave PIX pré-preenchida.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Tipo de chave PIX</Label>
        <Select
          value={data.pixkeyType ?? "cpf"}
          onValueChange={(v) =>
            onUpdate({
              pixkeyType: v as ActionNodeData["pixkeyType"],
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cpf">CPF</SelectItem>
            <SelectItem value="cnpj">CNPJ</SelectItem>
            <SelectItem value="email">E-mail</SelectItem>
            <SelectItem value="phone">Telefone</SelectItem>
            <SelectItem value="random">Chave aleatória</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Chave PIX</Label>
        <Input
          value={data.pixkey ?? ""}
          onChange={(e) => onUpdate({ pixkey: e.target.value })}
          placeholder={
            data.pixkeyType === "cpf"
              ? "000.000.000-00"
              : data.pixkeyType === "cnpj"
              ? "00.000.000/0000-00"
              : data.pixkeyType === "email"
              ? "pagamentos@loja.com"
              : data.pixkeyType === "phone"
              ? "+5511999999999"
              : "00000000-0000-0000-0000-000000000000"
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Valor (BRL)</Label>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            value={data.pixAmount ?? ""}
            onChange={(e) => onUpdate({ pixAmount: Number(e.target.value) })}
            placeholder="49.90"
          />
        </div>
        <div className="space-y-2">
          <Label>Nome recebedor</Label>
          <Input
            value={data.pixMerchantName ?? ""}
            onChange={(e) => onUpdate({ pixMerchantName: e.target.value })}
            placeholder="Loja ACME"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Texto acompanhante (opcional)</Label>
        <TemplateTextarea
          value={data.pixText ?? ""}
          onChange={(v) => onUpdate({ pixText: v })}
          placeholder="Olá {{nome}}! Segue o link de pagamento da sua proposta."
          rows={2}
        />
      </div>

      <div className="text-xs text-muted-foreground pt-2 border-t">
        Valor será cobrado via PIX direto. Se precisar integração Asaas
        (geração dinâmica de cobrança), use o botão "Cobrar PIX" no
        pipe_propostas detail.
      </div>
    </div>
  );
}
