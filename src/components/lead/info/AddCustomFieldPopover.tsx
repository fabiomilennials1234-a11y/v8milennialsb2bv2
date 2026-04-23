/**
 * AddCustomFieldPopover — botão + popover para criar novo campo personalizado inline.
 *
 * Onda 3.1, C28.
 *
 * Trigger: "+ Adicionar campo" no fim do LeadFieldGrid.
 * Form: label (required), type (select), options (se type=select), required (switch).
 * Submit → useCreateCustomField → toast → invalidate → popover fecha.
 * A11y: aria-label, focus trap (Radix Popover), close on Esc.
 * prefers-reduced-motion: sem animação de entrada quando motion reduzido.
 */

import { useState, useCallback, useId } from "react";
import { Plus, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateCustomField } from "@/hooks/useLeadCustomFields";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────────────────────

type FieldType = "text" | "number" | "date" | "select" | "boolean" | "url";

interface FormState {
  label: string;
  type: FieldType;
  options: string;
  required: boolean;
}

const INITIAL_FORM: FormState = {
  label: "",
  type: "text",
  options: "",
  required: false,
};

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: "text",    label: "Texto" },
  { value: "number",  label: "Número" },
  { value: "date",    label: "Data" },
  { value: "select",  label: "Seleção" },
  { value: "boolean", label: "Sim / Não" },
  { value: "url",     label: "URL" },
];

// ─── Component ──────────────────────────────────────────────────────────────────

export function AddCustomFieldPopover() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [labelError, setLabelError] = useState("");

  const labelId = useId();
  const typeId = useId();
  const optionsId = useId();
  const requiredId = useId();

  const createField = useCreateCustomField();

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setForm(INITIAL_FORM);
      setLabelError("");
    }
  }, []);

  const handleFieldChange = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === "label") setLabelError("");
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmed = form.label.trim();
    if (!trimmed) {
      setLabelError("Nome do campo é obrigatório");
      return;
    }

    const options = form.type === "select"
      ? form.options.split("\n").map((o) => o.trim()).filter(Boolean)
      : undefined;

    try {
      await createField.mutateAsync({
        field_name: trimmed,
        field_type: form.type,
        field_options: options,
        is_required: form.required,
      });
      toast.success("Campo criado com sucesso");
      handleOpenChange(false);
    } catch {
      toast.error("Erro ao criar campo personalizado");
    }
  }, [form, createField, handleOpenChange]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "w-full justify-start gap-1.5 text-xs text-muted-foreground",
            "hover:text-foreground hover:bg-muted/40 h-8 mt-2",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          )}
          aria-label="Adicionar campo personalizado"
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <Plus className="w-3.5 h-3.5 shrink-0" />
          Adicionar campo
          <ChevronDown
            className={cn(
              "w-3 h-3 ml-auto shrink-0 transition-transform duration-150",
              "motion-reduce:transition-none",
              open && "rotate-180"
            )}
            aria-hidden="true"
          />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-72 p-4"
        side="top"
        align="start"
        aria-label="Novo campo personalizado"
      >
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Novo campo</p>
            <p className="text-xs text-muted-foreground">
              Visível para toda a organização.
            </p>
          </div>

          {/* Label */}
          <div className="space-y-1.5">
            <Label htmlFor={labelId} className="text-xs">
              Nome do campo <span className="text-destructive">*</span>
            </Label>
            <Input
              id={labelId}
              value={form.label}
              onChange={(e) => handleFieldChange("label", e.target.value)}
              placeholder="Ex: Orçamento, Website..."
              className={cn("h-8 text-sm", labelError && "border-destructive focus-visible:ring-destructive")}
              autoFocus
              maxLength={80}
            />
            {labelError && (
              <p className="text-[11px] text-destructive" role="alert">{labelError}</p>
            )}
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <Label htmlFor={typeId} className="text-xs">Tipo</Label>
            <Select
              value={form.type}
              onValueChange={(v) => handleFieldChange("type", v as FieldType)}
            >
              <SelectTrigger id={typeId} className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-sm">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Options — only visible when type=select */}
          {form.type === "select" && (
            <div className="space-y-1.5">
              <Label htmlFor={optionsId} className="text-xs">
                Opções <span className="text-muted-foreground">(uma por linha)</span>
              </Label>
              <Textarea
                id={optionsId}
                value={form.options}
                onChange={(e) => handleFieldChange("options", e.target.value)}
                placeholder={"Opção A\nOpção B\nOpção C"}
                className="text-sm resize-none min-h-[80px]"
                rows={4}
              />
            </div>
          )}

          {/* Required */}
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={requiredId} className="text-xs cursor-pointer select-none">
              Obrigatório
            </Label>
            <Switch
              id={requiredId}
              checked={form.required}
              onCheckedChange={(v) => handleFieldChange("required", v)}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="flex-1 h-8 text-xs"
              onClick={() => handleOpenChange(false)}
              disabled={createField.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              className="flex-1 h-8 text-xs"
              disabled={createField.isPending}
            >
              {createField.isPending ? "Criando..." : "Criar campo"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
