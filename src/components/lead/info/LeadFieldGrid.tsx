/**
 * LeadFieldGrid — grid unificada de campos padrão + personalizados de um lead.
 *
 * Onda 3.1, C27.
 *
 * Campos padrão (nome, empresa, email, telefone, origem, segmento, interest, campanha)
 * e campos personalizados aparecem juntos em grid 2-col (desktop) / 1-col (mobile).
 * Campos personalizados recebem badge Sparkles sutil no label.
 * Edição inline: click-to-edit por campo, save via onBlur ou botão ✓.
 * Tipo de input adaptado por field_type: text | number | date | select | boolean | url.
 *
 * Props: { leadId, lead, onLeadUpdate }
 */

import { useState, useCallback, useId, memo } from "react";
import {
  User,
  Building2,
  Mail,
  Phone,
  Globe,
  Type,
  Hash,
  Calendar,
  List,
  ToggleLeft,
  ExternalLink,
  Check,
  X,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  useLeadCustomFields,
  useLeadCustomFieldValues,
  useSaveCustomFieldValue,
  type CustomField,
} from "@/hooks/useLeadCustomFields";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface LeadStandardData {
  name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  segment?: string | null;
  interest?: string | null;
}

export interface LeadFieldGridProps {
  leadId: string;
  lead: LeadStandardData;
  /** Called when a standard field is saved. Caller updates optimistically or refetches. */
  onLeadUpdate?: (field: keyof LeadStandardData, value: string) => void;
}

// ─── Standard field definitions ────────────────────────────────────────────────

interface StandardFieldDef {
  key: keyof LeadStandardData;
  label: string;
  Icon: typeof User;
  inputType?: "text" | "email" | "tel" | "url";
  placeholder?: string;
}

const STANDARD_FIELDS: StandardFieldDef[] = [
  { key: "name",     label: "Nome",     Icon: User,      inputType: "text",  placeholder: "Nome do lead" },
  { key: "company",  label: "Empresa",  Icon: Building2, inputType: "text",  placeholder: "Empresa" },
  { key: "email",    label: "Email",    Icon: Mail,      inputType: "email", placeholder: "email@empresa.com" },
  { key: "phone",    label: "Telefone", Icon: Phone,     inputType: "tel",   placeholder: "+55 11 9..." },
  { key: "segment",  label: "Segmento", Icon: Globe,     inputType: "text",  placeholder: "Ex: Distribuidora" },
  { key: "interest", label: "Interesse",Icon: Type,      inputType: "text",  placeholder: "Ex: Plano Profissional" },
];

// ─── Custom field icon map ──────────────────────────────────────────────────────

const CUSTOM_FIELD_ICON: Record<CustomField["field_type"], typeof Type> = {
  text:    Type,
  number:  Hash,
  date:    Calendar,
  select:  List,
  boolean: ToggleLeft,
};

// ─── FieldInput (shared for both standard and custom) ──────────────────────────

interface FieldInputProps {
  uid: string;
  inputType?: "text" | "email" | "tel" | "url" | "number" | "date";
  fieldType?: CustomField["field_type"];
  options?: string[];
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}

function FieldInput({ uid, inputType = "text", fieldType, options, value, placeholder, onChange }: FieldInputProps) {
  if (fieldType === "select") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={uid} className="h-8 text-sm">
          <SelectValue placeholder="Selecione..." />
        </SelectTrigger>
        <SelectContent>
          {(options ?? []).map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const resolvedType = fieldType === "number" ? "number"
    : fieldType === "date" ? "date"
    : inputType;

  return (
    <Input
      id={uid}
      type={resolvedType}
      className={cn("h-8 text-sm", (fieldType === "number") && "font-mono tabular-nums")}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      autoFocus
    />
  );
}

// ─── StandardFieldRow ──────────────────────────────────────────────────────────

interface StandardFieldRowProps {
  def: StandardFieldDef;
  currentValue: string;
  onSave: (key: keyof LeadStandardData, value: string) => void;
}

const StandardFieldRow = memo(function StandardFieldRow({ def, currentValue, onSave }: StandardFieldRowProps) {
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentValue);
  const [saving, setSaving] = useState(false);

  const { Icon } = def;

  const handleEdit = useCallback(() => {
    setDraft(currentValue);
    setEditing(true);
  }, [currentValue]);

  const handleCancel = useCallback(() => {
    setDraft(currentValue);
    setEditing(false);
  }, [currentValue]);

  const handleSave = useCallback(async () => {
    if (draft === currentValue) { setEditing(false); return; }
    setSaving(true);
    try {
      await Promise.resolve(onSave(def.key, draft));
      setEditing(false);
    } catch {
      toast.error(`Erro ao salvar ${def.label.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  }, [draft, currentValue, onSave, def.key, def.label]);

  const handleBlur = useCallback(() => {
    handleSave();
  }, [handleSave]);

  const displayValue = currentValue || "—";

  return (
    <div className="space-y-1">
      <Label htmlFor={uid} className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="w-3 h-3 shrink-0" />
        {def.label}
      </Label>

      {editing ? (
        <div className="flex items-center gap-1.5">
          <div className="flex-1">
            <FieldInput
              uid={uid}
              inputType={def.inputType}
              value={draft}
              placeholder={def.placeholder}
              onChange={setDraft}
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={handleSave}
            disabled={saving}
            aria-label="Salvar"
            onBlur={handleBlur}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={handleCancel}
            disabled={saving}
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
            "text-sm",
            "hover:border-border hover:bg-muted/40 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            !currentValue && "text-muted-foreground/50 italic"
          )}
        >
          {def.inputType === "tel" && currentValue
            ? <span className="font-mono tabular-nums">{displayValue}</span>
            : displayValue
          }
        </button>
      )}
    </div>
  );
});

// ─── CustomFieldRow ────────────────────────────────────────────────────────────

interface CustomFieldRowProps {
  field: CustomField;
  currentValue: string | null;
  leadId: string;
}

const CustomFieldRow = memo(function CustomFieldRow({ field, currentValue, leadId }: CustomFieldRowProps) {
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(currentValue ?? "");
  const saveField = useSaveCustomFieldValue();

  const Icon = CUSTOM_FIELD_ICON[field.field_type] ?? Type;

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

  // Boolean: toggle inline
  if (field.field_type === "boolean") {
    const checked = currentValue === "true";
    return (
      <div className="flex items-center justify-between py-1.5 col-span-1">
        <Label
          htmlFor={uid}
          className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none"
        >
          <Sparkles className="w-2.5 h-2.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
          <Icon className="w-3 h-3 shrink-0" />
          {field.field_name}
          {field.is_required && <span className="text-destructive">*</span>}
        </Label>
        <Switch
          id={uid}
          checked={checked}
          disabled={saveField.isPending}
          onCheckedChange={(val) =>
            saveField.mutate(
              { leadId, fieldId: field.id, value: String(val) },
              { onError: () => toast.error("Erro ao salvar campo") }
            )
          }
        />
      </div>
    );
  }

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
        {/* Sparkles badge: sutil, 10px, muted */}
        <Sparkles className="w-2.5 h-2.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
        <Icon className="w-3 h-3 shrink-0" />
        {field.field_name}
        {field.is_required && <span className="text-destructive">*</span>}
      </Label>

      {editing ? (
        <div className="flex items-center gap-1.5">
          <div className="flex-1">
            <FieldInput
              uid={uid}
              fieldType={field.field_type}
              options={field.field_options ?? []}
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
            {saveField.isPending
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Check className="w-3.5 h-3.5" />
            }
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
            "text-sm",
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
              {currentValue.length > 30 ? currentValue.slice(0, 30) + "…" : currentValue}
              <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          ) : (
            displayValue()
          )}
        </button>
      )}
    </div>
  );
});

// ─── Loading skeleton ──────────────────────────────────────────────────────────

function FieldGridSkeleton() {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3"
      aria-busy="true"
      aria-label="Carregando campos do lead"
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export const LeadFieldGrid = memo(function LeadFieldGrid({
  leadId,
  lead,
  onLeadUpdate,
}: LeadFieldGridProps) {
  const { data: customFields = [], isLoading: loadingFields } = useLeadCustomFields();
  const { data: customValues = [], isLoading: loadingValues } = useLeadCustomFieldValues(leadId);

  const isLoading = loadingFields || loadingValues;

  const getCustomValue = useCallback(
    (fieldId: string): string | null => {
      const entry = customValues.find((v) => v.field_id === fieldId);
      return entry?.value ?? null;
    },
    [customValues]
  );

  const handleStandardSave = useCallback(
    (key: keyof LeadStandardData, value: string) => {
      onLeadUpdate?.(key, value);
    },
    [onLeadUpdate]
  );

  if (isLoading) return <FieldGridSkeleton />;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
      {/* Standard fields first */}
      {STANDARD_FIELDS.map((def) => (
        <StandardFieldRow
          key={def.key}
          def={def}
          currentValue={(lead[def.key] as string | null | undefined) ?? ""}
          onSave={handleStandardSave}
        />
      ))}

      {/* Custom fields — sorted by display_order (already from query), then name */}
      {customFields.map((field) => (
        <CustomFieldRow
          key={field.id}
          field={field}
          currentValue={getCustomValue(field.id)}
          leadId={leadId}
        />
      ))}
    </div>
  );
});
