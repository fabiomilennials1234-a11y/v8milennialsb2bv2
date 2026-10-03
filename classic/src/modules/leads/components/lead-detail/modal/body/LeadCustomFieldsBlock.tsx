import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  useLeadCustomFields,
  useLeadCustomFieldValues,
  useSaveCustomFieldValue,
  type CustomField,
} from "../../../../hooks/useLeadCustomFields";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { cn } from "@/lib/utils";

const DEFAULT_VISIBLE = 5;
const DEBOUNCE_MS = 1500;

interface LeadCustomFieldsBlockProps {
  leadId: string;
  editable: boolean;
}

/**
 * Renders the org's custom fields for a lead in the info column.
 *
 * Hidden entirely when no fields are configured for the org. Up to 5 fields
 * visible by default; "Mostrar tudo" expands. Text/number inputs debounce-
 * save (1.5s); select/date/boolean save on change. Log Tier 2
 * `field_updated` with `metadata.custom_field_id`.
 */
export const LeadCustomFieldsBlock = memo(function LeadCustomFieldsBlock({
  leadId,
  editable,
}: LeadCustomFieldsBlockProps) {
  const { data: fields = [], isLoading: fieldsLoading } = useLeadCustomFields();
  const { data: values = [] } = useLeadCustomFieldValues(leadId);
  const saveValue = useSaveCustomFieldValue();
  const logAction = useLogLeadAction();

  const [expanded, setExpanded] = useState(false);

  const valueByFieldId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const v of values) map.set(v.field_id, v.value);
    return map;
  }, [values]);

  if (fieldsLoading) return null;
  if (fields.length === 0) return null;

  const sorted = [...fields].sort((a, b) => a.display_order - b.display_order);
  const hasOverflow = sorted.length > DEFAULT_VISIBLE;
  const visibleFields =
    !hasOverflow || expanded ? sorted : sorted.slice(0, DEFAULT_VISIBLE);

  const handlePersist = async (field: CustomField, value: string | null) => {
    try {
      await saveValue.mutateAsync({ leadId, fieldId: field.id, value });
      logAction({
        leadId,
        action: "field_updated",
        description: `Campo personalizado "${field.field_name}" atualizado`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar campo";
      toast.error(msg);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold">
          Campos personalizados
        </h3>
        {hasOverflow && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs gap-1"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <>
                <ChevronUp className="w-3 h-3" />
                Mostrar menos
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" />
                Mostrar tudo
              </>
            )}
          </Button>
        )}
      </div>
      <div className="h-px bg-border/30" aria-hidden />
      <div className="space-y-2">
        {visibleFields.map((field) => (
          <CustomFieldRow
            key={field.id}
            field={field}
            value={valueByFieldId.get(field.id) ?? ""}
            editable={editable}
            onPersist={handlePersist}
          />
        ))}
      </div>
    </div>
  );
});

// ─── Row ────────────────────────────────────────────────────────────

interface CustomFieldRowProps {
  field: CustomField;
  value: string;
  editable: boolean;
  onPersist: (field: CustomField, value: string | null) => Promise<void>;
}

function CustomFieldRow({ field, value, editable, onPersist }: CustomFieldRowProps) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset when remote value changes from outside this row (after save).
  useEffect(() => {
    setLocal(value);
  }, [value]);

  // Clean up timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const scheduleDebouncedSave = (next: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void onPersist(field, next === "" ? null : next);
    }, DEBOUNCE_MS);
  };

  const saveImmediately = (next: string | null) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    void onPersist(field, next);
  };

  // Read-only renderer.
  if (!editable) {
    const display = value || "—";
    return (
      <div className="grid grid-cols-[140px_1fr] gap-3 items-center">
        <span className="text-xs text-muted-foreground truncate" title={field.field_name}>
          {field.field_name}
        </span>
        <span className="text-sm">{display}</span>
      </div>
    );
  }

  const inputId = `cf-${field.id}`;

  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 items-center">
      <Label
        htmlFor={inputId}
        className="text-xs text-muted-foreground truncate"
        title={field.field_name}
      >
        {field.field_name}
      </Label>

      {field.field_type === "text" && (
        <Input
          id={inputId}
          value={local}
          onChange={(e) => {
            setLocal(e.target.value);
            scheduleDebouncedSave(e.target.value);
          }}
          className="h-8 text-sm"
        />
      )}

      {field.field_type === "number" && (
        <Input
          id={inputId}
          type="number"
          value={local}
          onChange={(e) => {
            setLocal(e.target.value);
            scheduleDebouncedSave(e.target.value);
          }}
          className="h-8 text-sm"
        />
      )}

      {field.field_type === "date" && (
        <Input
          id={inputId}
          type="date"
          value={local}
          onChange={(e) => {
            setLocal(e.target.value);
            saveImmediately(e.target.value || null);
          }}
          className="h-8 text-sm"
        />
      )}

      {field.field_type === "select" && (
        <Select
          value={local || undefined}
          onValueChange={(v) => {
            setLocal(v);
            saveImmediately(v);
          }}
        >
          <SelectTrigger className={cn("h-8 text-sm")} id={inputId}>
            <SelectValue placeholder="Selecionar" />
          </SelectTrigger>
          <SelectContent>
            {(field.field_options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {field.field_type === "boolean" && (
        <div>
          <Switch
            id={inputId}
            checked={local === "true"}
            onCheckedChange={(v) => {
              const next = v ? "true" : "false";
              setLocal(next);
              saveImmediately(next);
            }}
          />
        </div>
      )}
    </div>
  );
}
