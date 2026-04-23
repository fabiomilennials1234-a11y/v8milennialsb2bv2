/**
 * MenuNodeConfig — editor para send_whatsapp_menu (Uazapi only).
 *
 * Fields:
 *  - menuType: button | list | poll | carousel
 *  - menuText: main prompt (TemplateTextarea com variáveis)
 *  - menuChoices[]: options array (up to 10)
 *  - menuFooter: optional footer text
 *  - menuSelectableCount: poll only
 */
import { useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import type { ActionNodeData } from "@/types/workflow";
import { TemplateTextarea } from "@/components/automacoes/TemplateTextarea";
import { MenuPreview } from "./MenuPreview";

interface Props {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}

const MAX_CHOICES = 10;

export function MenuNodeConfig({ data, onUpdate }: Props) {
  const type = data.menuType ?? "button";
  const choices = data.menuChoices ?? [""];

  useEffect(() => {
    if (!data.menuType) {
      onUpdate({ menuType: "button" });
    }
    if (!data.menuChoices || data.menuChoices.length === 0) {
      onUpdate({ menuChoices: [""] });
    }
  }, [data.menuType, data.menuChoices, onUpdate]);

  const setChoice = (idx: number, value: string) => {
    const next = [...choices];
    next[idx] = value;
    onUpdate({ menuChoices: next });
  };

  const addChoice = () => {
    if (choices.length >= MAX_CHOICES) return;
    onUpdate({ menuChoices: [...choices, ""] });
  };

  const removeChoice = (idx: number) => {
    if (choices.length <= 1) return;
    onUpdate({ menuChoices: choices.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Tipo de menu</Label>
        <Select
          value={type}
          onValueChange={(v) =>
            onUpdate({ menuType: v as ActionNodeData["menuType"] })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="button">Botões (até 3 opções)</SelectItem>
            <SelectItem value="list">Lista (até 10 opções)</SelectItem>
            <SelectItem value="poll">Enquete</SelectItem>
            <SelectItem value="carousel">Carrossel</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Recurso nativo Uazapi — instâncias Evolution não suportam.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Texto principal</Label>
        <TemplateTextarea
          value={data.menuText ?? ""}
          onChange={(v) => onUpdate({ menuText: v })}
          placeholder="Ex: Escolha a opção que melhor descreve você:"
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Opções ({choices.length}/{MAX_CHOICES})</Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addChoice}
            disabled={choices.length >= MAX_CHOICES}
          >
            <Plus className="h-3 w-3 mr-1" />
            Adicionar
          </Button>
        </div>
        <div className="space-y-2">
          {choices.map((choice, idx) => (
            <div key={idx} className="flex gap-2">
              <Input
                value={choice}
                onChange={(e) => setChoice(idx, e.target.value)}
                placeholder={`Opção ${idx + 1}`}
              />
              {choices.length > 1 && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => removeChoice(idx)}
                  aria-label={`Remover opção ${idx + 1}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Rodapé (opcional)</Label>
        <Input
          value={data.menuFooter ?? ""}
          onChange={(e) => onUpdate({ menuFooter: e.target.value })}
          placeholder="Ex: Responda com a opção escolhida"
        />
      </div>

      {type === "poll" && (
        <div className="space-y-2">
          <Label>Quantidade selecionável (poll)</Label>
          <Input
            type="number"
            min={1}
            max={choices.length}
            value={data.menuSelectableCount ?? 1}
            onChange={(e) =>
              onUpdate({ menuSelectableCount: Number(e.target.value) })
            }
          />
          <p className="text-xs text-muted-foreground">
            1 = escolha única. &gt;1 = múltipla escolha.
          </p>
        </div>
      )}

      <div className="space-y-2 pt-2 border-t">
        <Label className="text-xs text-muted-foreground">Preview</Label>
        <MenuPreview
          type={type}
          text={data.menuText ?? ""}
          choices={choices.filter((c) => c.trim().length > 0)}
          footer={data.menuFooter}
        />
      </div>
    </div>
  );
}
