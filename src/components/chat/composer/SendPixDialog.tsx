import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { sendPixButton } from "@/lib/whatsappApi";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: string;
  phoneNumber: string;
}

type PixKeyType = "cpf" | "cnpj" | "phone" | "email" | "random";

export function SendPixDialog({ open, onOpenChange, instanceId, phoneNumber }: Props) {
  const [pixkey, setPixkey] = useState("");
  const [pixkeyType, setPixkeyType] = useState<PixKeyType>("random");
  const [merchantName, setMerchantName] = useState("");
  const [amount, setAmount] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!pixkey.trim()) { toast.error("Chave Pix obrigatória"); return; }
    if (!merchantName.trim()) { toast.error("Nome do recebedor obrigatório"); return; }
    const numAmount = parseFloat(amount.replace(",", "."));
    if (!numAmount || numAmount <= 0) { toast.error("Valor inválido"); return; }
    setSending(true);
    try {
      await sendPixButton(instanceId, phoneNumber, pixkey.trim(), merchantName.trim(), numAmount, {
        pixkeyType,
        text: text.trim() || undefined,
      });
      toast.success("Botão Pix enviado");
      onOpenChange(false);
      setPixkey("");
      setMerchantName("");
      setAmount("");
      setText("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar Pix</DialogTitle>
          <DialogDescription>Envia botão de pagamento Pix para o contato.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Chave Pix</Label>
            <Input value={pixkey} onChange={(e) => setPixkey(e.target.value)} placeholder="CPF, CNPJ, email, telefone ou chave aleatória" />
          </div>

          <div className="space-y-2">
            <Label>Tipo da chave</Label>
            <Select value={pixkeyType} onValueChange={(v) => setPixkeyType(v as PixKeyType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cpf">CPF</SelectItem>
                <SelectItem value="cnpj">CNPJ</SelectItem>
                <SelectItem value="phone">Telefone</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="random">Chave aleatória</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Nome do recebedor</Label>
            <Input value={merchantName} onChange={(e) => setMerchantName(e.target.value)} placeholder="Nome que aparece no Pix" />
          </div>

          <div className="space-y-2">
            <Label>Valor (R$)</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100,00" inputMode="decimal" />
          </div>

          <div className="space-y-2">
            <Label>Mensagem (opcional)</Label>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Texto que acompanha o botão..." rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Enviar Pix
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
