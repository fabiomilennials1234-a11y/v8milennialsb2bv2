import { useState } from "react";
import { Phone, Plus, X, MessageSquare, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { PlaygroundData } from "./types";

interface PlaygroundHandoffNotifyProps {
  data: PlaygroundData;
  onChange: (updates: Partial<PlaygroundData>) => void;
}

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

const TEMPLATE_PREVIEW = `🚨 *Transferência de Lead*

*Lead:* João Silva — Empresa ABC
*Telefone:* 5511977777777
*Prioridade:* ALTA — Pedido estimado R$15k

*Resumo da conversa:*
Cliente pediu cotação de 500 unidades do produto X. Mencionou urgência para entrega até sexta.

*Motivo da transferência:*
Lead pediu falar com humano para negociar prazo.

👉 Acesse o sistema para atender.`;

export function PlaygroundHandoffNotify({ data, onChange }: PlaygroundHandoffNotifyProps) {
  const [newPhone, setNewPhone] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const isTransferEnabled = data.tools.TRANSFERIR_HUMANO?.enabled ?? false;

  if (!isTransferEnabled) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Phone className="w-10 h-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">
          Ative a ferramenta <span className="font-medium text-foreground">Transferir para Humano</span> na aba Ferramentas para configurar notificações.
        </p>
      </div>
    );
  }

  const phones = data.handoffNotifyPhones;
  const hasPhones = phones.length > 0;

  const addPhone = () => {
    const digits = newPhone.replace(/\D/g, "");
    if (!isValidPhone(digits)) return;
    const alreadyExists = phones.some((p) => p.phone.replace(/\D/g, "") === digits);
    if (alreadyExists) return;

    onChange({
      handoffNotifyPhones: [
        ...phones,
        { phone: digits, label: newLabel.trim() || "" },
      ],
    });
    setNewPhone("");
    setNewLabel("");
  };

  const removePhone = (index: number) => {
    onChange({
      handoffNotifyPhones: phones.filter((_, i) => i !== index),
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Phone className="w-4 h-4" />
          Notificação WhatsApp na Transferência
        </h3>
        <p className="text-xs text-muted-foreground">
          Quando a IA transferir para humano, envia resumo da conversa via WhatsApp para os números abaixo.
        </p>
      </div>

      {/* Status badge */}
      <div>
        <Badge variant={hasPhones ? "default" : "secondary"} className="text-[10px]">
          {hasPhones ? `Ativo — ${phones.length} número(s)` : "Inativo — adicione números para ativar"}
        </Badge>
      </div>

      {/* Phone list */}
      {phones.length > 0 && (
        <div className="space-y-2">
          {phones.map((entry, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2"
            >
              <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm font-mono">{entry.phone}</span>
              {entry.label && (
                <span className="text-xs text-muted-foreground">— {entry.label}</span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={() => removePhone(i)}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add phone */}
      <div className="flex gap-2">
        <Input
          placeholder="5511999999999"
          value={newPhone}
          onChange={(e) => setNewPhone(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addPhone()}
          className="font-mono text-sm flex-1"
        />
        <Input
          placeholder="Label (ex: Gerente)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addPhone()}
          className="text-sm w-40"
        />
        <Button
          variant="outline"
          size="icon"
          onClick={addPhone}
          disabled={!isValidPhone(newPhone.replace(/\D/g, ""))}
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {/* Instructions */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <label className="text-sm font-medium">Instruções de roteamento</label>
        </div>
        <Textarea
          placeholder='Ex: "Notifique todos. Se pedido > R$5k, marque como PRIORIDADE ALTA." ou "Notifique 5511999... (gerente) apenas quando urgente. Notifique 5511888... (SDR) sempre."'
          value={data.handoffNotifyInstructions}
          onChange={(e) => onChange({ handoffNotifyInstructions: e.target.value })}
          rows={3}
          className="text-sm resize-none"
        />
        <p className="text-[11px] text-muted-foreground">
          A IA usa estas instruções para decidir quem notificar e como classificar prioridade. Linguagem natural.
        </p>
      </div>

      {/* Template preview */}
      <div className="space-y-2">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setShowPreview(!showPreview)}
        >
          <Eye className="w-3.5 h-3.5" />
          {showPreview ? "Ocultar preview" : "Ver preview da mensagem"}
        </Button>
        {showPreview && (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">
              Formato da mensagem (exemplo)
            </p>
            <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed text-foreground/80">
              {TEMPLATE_PREVIEW}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
