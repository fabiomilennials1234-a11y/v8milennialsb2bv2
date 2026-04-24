/**
 * LeadCustomFields — exibe e edita os campos personalizados de um lead.
 *
 * Onda 3.1, C24.
 * Props: { leadId: string }
 * Edição inline: click to edit por campo, save via useSaveCustomFieldValue (upsert).
 * Field types: text | number | date | select | boolean
 * Empty state: org sem campos → link para configurações.
 * Loading: skeleton 3 linhas.
 */

import { useState, useCallback, useId } from "react";
import { Type, Hash, Calendar, List, ToggleLeft, ExternalLink, Check, X, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useLeadCustomFields,
  useLeadCustomFieldValues,
  useSaveCustomFieldValue,
  type CustomField,
} from "@/hooks/useLeadCustomFields";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadCustomFieldsProps {
  leadId: string;
}

// ─── Field icon map ───────────────────────────────────────────────────────────

const FIELD_ICON: Record<CustomField["field_type"], typeof Type> = {
  text: Type,
  number: Hash,
  date: Calendar,
  select: List,
  boolean: ToggleLeft,
};

// ─── Single editable field ────────────────────────────────────────────────────

interface FieldRowProps {
  field: CustomField;
  currentValue: string | null;
  leadId: string;
}

function FieldRow({ field, currentValue, leadId }: FieldRowProps) {
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(currentValue ?? "");
  const saveField = useSaveCustomFieldValue();

  const Icon = FIELD_ICON[field.field_type] ?? Type;

  const handleEdit = useCallback(() => {
    setDraft(currentValue ?? "");
    setEditing(true);
  }, [currentValue]);

  const handleCancel = useCallback(() => {
    setDraft(currentValue ?? "");
    setEditing(false);
  }, [currentValue]);

  const handleSave = useCallback(async () => {
    try {
      await saveField.mutateAsync({
        leadId,
        fieldId: field.id,
        value: draft === "" ? null : draft,
      });
      setEditing(false);
    } catch {
      toast.error("Erro ao salvar campo");
    }
  }, [saveField, leadId, field.id, draft]);

  // Boolean: toggle direto, sem modo edição separado
  if (field.field_type === "boolean") {
    const checked = currentValue === "true";
    return (
      <div className="flex items-center justify-between py-1.5">
        <Label
          htmlFor={uid}
          className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none"
        >
          <Icon className="w-3 h-3 shrink-0" />
          {field.field_name}
          {field.is_required && <span className="text-destructive">*</span>}
        </Label>
        <Switch
          id={uid}
          checked={checked}
          disabled={saveField.isPending}
          onCheckedChange={(val) => {
            saveField.mutate(
              { leadId, fieldId: field.id, value: String(val) },
              {
                onError: () => toast.error("Erro ao salvar campo"),
              }
            );
          }}
        />
      </div>
    );
  }

  // Read mode display
  const displayValue = (): string => {
    if (!currentValue) return "—";
    if (field.field_type === "date") {
      try {
        return new Intl.DateTimeFormat("pt-BR").format(new Date(currentValue));
      } catch {
        return currentValue;
      }
    }
    return currentValue;
  };

  return (
    <div className="space-y-1">
      <Label
        htmlFor={uid}
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Icon className="w-3 h-3 shrink-0" />
        {field.field_name}
        {field.is_required && <span className="text-destructive">*</span>}
      </Label>

      {editing ? (
        <div className="flex items-center gap-1.5">
          <div className="flex-1">
            <FieldInput
              uid={uid}
              field={field}
              value={draft}
              onChange={setDraft}
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={handleSave}
            disabled={saveField.isPending}
            aria-label="Salvar"
          >
            {saveField.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={handleCancel}
            disabled={saveField.isPending}
            aria-label="Cancelar"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        <button
          id={uid}
          type="button"
          onClick={handleEdit}
          className={cn(
            "w-full text-left h-8 px-2 rounded-md border border-transparent",
            "text-sm font-tabular-nums",
            "hover:border-border hover:bg-muted/40 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            !currentValue && "text-muted-foreground/50 italic"
          )}
        >
          {field.field_type === "url" && currentValue ? (
            <a
              href={currentValue}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-primary underline underline-offset-2"
            >
              {currentValue.length > 30
                ? currentValue.slice(0, 30) + "…"
                : currentValue}
              <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          ) : (
            displayValue()
          )}
        </button>
      )}
    </div>
  );
}

// ─── Field input by type ──────────────────────────────────────────────────────

interface FieldInputProps {
  uid: string;
  field: CustomField;
  value: string;
  onChange: (v: string) => void;
}

function FieldInput({ uid, field, value, onChange }: FieldInputProps) {
  if (field.field_type === "select") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={uid} className="h-8 text-sm">
          <SelectValue placeholder="Selecione..." />
        </SelectTrigger>
        <SelectContent>
          {(field.field_options ?? []).map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.field_type === "number") {
    return (
      <Input
        id={uid}
        type="number"
        className="h-8 text-sm font-mono tabular-nums"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        autoFocus
      />
    );
  }

  if (field.field_type === "date") {
    return (
      <Input
        id={uid}
        type="date"
        className="h-8 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus
      />
    );
  }

  // text (default)
  return (
    <Input
      id={uid}
      type="text"
      className="h-8 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={`Digite ${field.field_name.toLowerCase()}...`}
      autoFocus
    />
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function CustomFieldsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Carregando campos personalizados">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function CustomFieldsEmpty() {
  return (
    <div className="flex flex-col items-start gap-1.5 py-1">
      <p className="text-xs text-muted-foreground">
        Nenhum campo configurado para esta organização.
      </p>
      <Link
        to="/configuracoes"
        className="flex items-center gap-1 text-xs text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
      >
        Configurar campos personalizados
        <ExternalLink className="w-3 h-3" />
      </Link>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LeadCustomFields({ leadId }: LeadCustomFieldsProps) {
  const { data: fields = [], isLoading: loadingFields } = useLeadCustomFields();
  const { data: values = [], isLoading: loadingValues } = useLeadCustomFieldValues(leadId);

  const isLoading = loadingFields || loadingValues;

  const getValueForField = useCallback(
    (fieldId: string): string | null => {
      const entry = values.find((v) => v.field_id === fieldId);
      return entry?.value ?? null;
    },
    [values]
  );

  if (isLoading) return <CustomFieldsSkeleton />;

  if (fields.length === 0) return <CustomFieldsEmpty />;

  return (
    <div className="space-y-3">
      {fields.map((field) => (
        <FieldRow
          key={field.id}
          field={field}
          currentValue={getValueForField(field.id)}
          leadId={leadId}
        />
      ))}
    </div>
  );
}
