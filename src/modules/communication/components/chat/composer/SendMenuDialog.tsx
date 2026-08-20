/**
 * SendMenuDialog — o construtor de mensagem interativa, para os DOIS canais.
 *
 * ─── O QUE MUDOU, E POR QUÊ ─────────────────────────────────────────────────
 *
 * Ele nasceu falando só com a Uazapi: chamava a API dela, gravava a linha em
 * `whatsapp_messages` pelo NAVEGADOR e inventava um id com `Date.now()` quando o
 * provedor não devolvia um — o id sintético que derrota a idempotência, o mesmo
 * defeito que `notificame-inbound` documenta em letras garrafais.
 *
 * Agora ele só COLETA. Quem envia é o `enviador`, um OBJETO montado pelo shell —
 * nunca um hook por prop: hook por prop faz a ordem dos hooks mudar quando o pai
 * troca de canal, e o React aborta com "Rendered more hooks than during the
 * previous render". Já aconteceu neste chat.
 *
 * Os tipos oferecidos saem do enviador, e não de uma lista fixa: o canal oficial
 * tem botão de link (`cta`), a Uazapi não.
 */
import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { EnviadorDeMenu, TipoDeMenu } from "@/modules/communication/lib/menu-sender";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Quem envia. Objeto pronto, montado pelo shell. Ver `menu-sender.ts`. */
  enviador: EnviadorDeMenu;
}

const ROTULO_DO_TIPO: Record<TipoDeMenu, string> = {
  button: "Botões (máx 3)",
  list: "Lista (máx 10)",
  cta: "Botão com link",
};

const TETO_POR_TIPO: Record<TipoDeMenu, number> = { button: 3, list: 10, cta: 1 };

export function SendMenuDialog({ open, onOpenChange, enviador }: Props) {
  const [type, setType] = useState<TipoDeMenu>(enviador.tipos[0] ?? "button");
  const [text, setText] = useState("");
  const [choices, setChoices] = useState([{ title: "", description: "" }]);
  const [rotuloDaLista, setRotuloDaLista] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [sending, setSending] = useState(false);

  const maxChoices = TETO_POR_TIPO[type];

  const addChoice = () => {
    if (choices.length >= maxChoices) return;
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
    // A lista SÓ ABRE com o rótulo do botão. Sem ele a Meta recusa, e a recusa
    // chega ao vendedor como falha genérica.
    if (type === "list" && !rotuloDaLista.trim()) {
      toast.error("Escreva o texto do botão que abre a lista");
      return;
    }
    if (type === "cta" && !/^https?:\/\//i.test(ctaUrl.trim())) {
      toast.error("O botão de link precisa de um endereço começando com https://");
      return;
    }

    setSending(true);
    try {
      await enviador.enviar({
        tipo: type,
        texto: text.trim(),
        opcoes: valid.map((c) => ({
          title: c.title.trim(),
          ...(c.description.trim() ? { description: c.description.trim() } : {}),
        })),
        rotuloDaLista: rotuloDaLista.trim() || undefined,
        ctaUrl: ctaUrl.trim() || undefined,
      });

      toast.success("Menu enviado");
      onOpenChange(false);
      setText("");
      setRotuloDaLista("");
      setCtaUrl("");
      setChoices([{ title: "", description: "" }]);
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
          <DialogTitle>Menu Interativo</DialogTitle>
          <DialogDescription>
            Envie botões ou lista de opções para o contato.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={type} onValueChange={(v) => setType(v as TipoDeMenu)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {/* Os tipos vêm do CANAL, não de uma lista fixa: oferecer botão
                    de link onde ele não existe é um erro que só aparece depois
                    do envio, para o cliente. */}
                {enviador.tipos.map((t) => (
                  <SelectItem key={t} value={t}>{ROTULO_DO_TIPO[t]}</SelectItem>
                ))}
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

          {type === "list" && (
            <div className="space-y-2">
              <Label>Texto do botão que abre a lista</Label>
              <Input
                value={rotuloDaLista}
                onChange={(e) => setRotuloDaLista(e.target.value)}
                placeholder="Ver opções"
              />
            </div>
          )}

          {type === "cta" && (
            <div className="space-y-2">
              <Label>Endereço do botão</Label>
              <Input
                value={ctaUrl}
                onChange={(e) => setCtaUrl(e.target.value)}
                placeholder="https://sualoja.com.br/orcamento/4471"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>{type === "cta" ? "Texto do botão" : "Opções"}</Label>
            {choices.slice(0, maxChoices).map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1 space-y-1">
                  <Input
                    placeholder={type === "cta" ? "Abrir orçamento" : `Opção ${i + 1}`}
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
                {choices.length > 1 && type !== "cta" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => removeChoice(i)}
                  >
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
