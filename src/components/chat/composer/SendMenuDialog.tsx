import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import { sendMenu } from "@/lib/whatsappApi";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: string;
  phoneNumber: string;
}

export function SendMenuDialog({ open, onOpenChange, instanceId, phoneNumber }: Props) {
  const [type, setType] = useState<"list" | "button">("button");
  const [text, setText] = useState("");
  const [choices, setChoices] = useState([{ title: "", description: "" }]);
  const [sending, setSending] = useState(false);

  const addChoice = () => {
    if (choices.length >= (type === "button" ? 3 : 10)) return;
    setChoices([...choices, { title: "", description: "" }]);
  };

  const removeChoice = (idx: number) => {
    setChoices(choices.filter((_, i) => i !== idx));
  };

  const updateChoice = (idx: number, field: "title" | "description", value: string) => {
    setChoices(choices.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  };

  const handleSend = async () => {
    if (!text.trim()) { toast.error("Texto obrigatório"); return; }
    const valid = choices.filter((c) => c.title.trim());
    if (valid.length === 0) { toast.error("Pelo menos 1 opção"); return; }
    setSending(true);
    try {
      await sendMenu(instanceId, phoneNumber, type, text.trim(), valid);
      toast.success("Menu enviado");
      onOpenChange(false);
      setText("");
      setChoices([{ title: "", description: "" }]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const maxChoices = type === "button" ? 3 : 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Menu Interativo</DialogTitle>
          <DialogDescription>Envie botões ou lista de opções para o contato.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={type} onValueChange={(v) => setType(v as "list" | "button")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="button">Botões (máx 3)</SelectItem>
                <SelectItem value="list">Lista (máx 10)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Mensagem</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Texto que acompanha o menu..."
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Opções</Label>
            {choices.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1 space-y-1">
                  <Input
                    placeholder={`Opção ${i + 1}`}
                    value={c.title}
                    onChange={(e) => updateChoice(i, "title", e.target.value)}
                  />
                  {type === "list" && (
                    <Input
                      placeholder="Descrição (opcional)"
                      value={c.description}
                      onChange={(e) => updateChoice(i, "description", e.target.value)}
                      className="text-xs"
                    />
                  )}
                </div>
                {choices.length > 1 && (
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => removeChoice(i)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
            {choices.length < maxChoices && (
              <Button variant="outline" size="sm" onClick={addChoice} className="w-full">
                <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar opção
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Enviar Menu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
