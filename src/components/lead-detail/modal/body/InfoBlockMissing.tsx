import { memo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, AlertCircle, Plus } from "lucide-react";
import { InfoFieldRow } from "./InfoFieldRow";
import { LEAD_INFO_FIELDS } from "./info-field-config";
import { useUpdateLead } from "@/hooks/useLeads";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { useQueryClient } from "@tanstack/react-query";
import { useLeadCustomFields, useLeadCustomFieldValues, useSaveCustomFieldValue } from "@/hooks/useLeadCustomFields";

interface InfoBlockMissingProps {
  lead: Record<string, unknown> & { id: string };
}

const VISIBLE_BEFORE_EXPAND = 3;

export const InfoBlockMissing = memo(function InfoBlockMissing({ lead }: InfoBlockMissingProps) {
  const updateLead = useUpdateLead();
  const logAction = useLogLeadAction();
  const qc = useQueryClient();
  const { data: customFields = [] } = useLeadCustomFields();
  const { data: customValues = [] } = useLeadCustomFieldValues(lead.id);
  const saveCustom = useSaveCustomFieldValue();
  const [expanded, setExpanded] = useState(false);

  const handleSave = async (field: string, value: string) => {
    await updateLead.mutateAsync({ id: lead.id, [field]: value || null } as Parameters<typeof updateLead.mutateAsync>[0]);
    logAction({ leadId: lead.id, action: "field_updated", description: `Campo "${field}" preenchido` });
    qc.invalidateQueries({ queryKey: ["lead-detail", lead.id] });
  };

  const handleCustomSave = async (fieldId: string, value: string) => {
    await saveCustom.mutateAsync({ leadId: lead.id, fieldId, value: value || null });
  };

  const missingBase = LEAD_INFO_FIELDS.filter((f) => {
    const v = lead[f.key];
    return v === null || v === undefined || v === "";
  });

  const missingCustom = customFields.filter((cf) => {
    const v = customValues.find((cv) => cv.field_id === cf.id);
    return !v?.value;
  });

  const all = [
    ...missingBase.map((f) => ({ kind: "base" as const, field: f })),
    ...missingCustom.map((cf) => ({ kind: "custom" as const, cf })),
  ];

  if (all.length === 0) {
    return (
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold pb-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
          Lead completo
        </h3>
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-emerald-500/5 border border-emerald-500/20">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="text-xs text-emerald-300/90">Todas as informações preenchidas.</span>
        </div>
      </section>
    );
  }

  const visible = expanded ? all : all.slice(0, VISIBLE_BEFORE_EXPAND);
  const hidden = all.length - visible.length;

  return (
    <section className="space-y-1">
      <h3 className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold pb-1">
        <AlertCircle className="w-3 h-3 text-amber-500" />
        Faltam informações ({all.length})
      </h3>
      <div className="divide-y divide-border/20">
        {visible.map((item) => {
          if (item.kind === "base") {
            const f = item.field;
            return (
              <InfoFieldRow
                key={f.key}
                label={f.label}
                value=""
                placeholder={
                  <span className="inline-flex items-center gap-1 text-muted-foreground/60">
                    <Plus className="w-3 h-3" /> adicionar {f.label.toLowerCase()}
                  </span>
                }
                onSave={(v) => handleSave(f.key, v)}
                type={f.type === "textarea" ? "textarea" : "text"}
              />
            );
          }
          return (
            <InfoFieldRow
              key={item.cf.id}
              label={item.cf.field_name}
              value=""
              placeholder={`+ adicionar ${item.cf.field_name.toLowerCase()}`}
              onSave={(v) => handleCustomSave(item.cf.id, v)}
            />
          );
        })}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 font-medium pt-2"
        >
          <ChevronDown className="w-3 h-3" /> Mostrar mais ({hidden})
        </button>
      )}
      {expanded && all.length > VISIBLE_BEFORE_EXPAND && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground font-medium pt-2"
        >
          <ChevronUp className="w-3 h-3" /> Mostrar menos
        </button>
      )}
    </section>
  );
});
