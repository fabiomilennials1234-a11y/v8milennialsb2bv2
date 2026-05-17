import { memo, useState } from "react";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InfoFieldRow } from "./InfoFieldRow";
import { LEAD_INFO_FIELDS } from "./info-field-config";
import { useUpdateLead } from "@/hooks/useLeads";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { useQueryClient } from "@tanstack/react-query";
import { useLeadCustomFields, useLeadCustomFieldValues, useSaveCustomFieldValue } from "@/hooks/useLeadCustomFields";
import { Tag as TagIcon } from "lucide-react";
import { formatFaturamento } from "@/lib/format/faturamento";

interface InfoBlockFilledProps {
  lead: Record<string, unknown> & { id: string; lead_tags?: Array<{ tag?: { id: string; name: string; color: string | null } }> };
}

const VISIBLE_BEFORE_EXPAND = 5;

function formatBRL(v: string): string {
  return formatFaturamento(v);
}

export const InfoBlockFilled = memo(function InfoBlockFilled({ lead }: InfoBlockFilledProps) {
  const updateLead = useUpdateLead();
  const logAction = useLogLeadAction();
  const qc = useQueryClient();
  const { data: customFields = [] } = useLeadCustomFields();
  const { data: customValues = [] } = useLeadCustomFieldValues(lead.id);
  const saveCustom = useSaveCustomFieldValue();
  const [expanded, setExpanded] = useState(false);

  const handleSave = async (field: string, value: string) => {
    await updateLead.mutateAsync({ id: lead.id, [field]: value || null } as Parameters<typeof updateLead.mutateAsync>[0]);
    logAction({ leadId: lead.id, action: "field_updated", description: `Campo "${field}" atualizado` });
    qc.invalidateQueries({ queryKey: ["lead-detail", lead.id] });
  };

  const handleCustomSave = async (fieldId: string, value: string) => {
    await saveCustom.mutateAsync({ leadId: lead.id, fieldId, value: value || null });
  };

  const filledBase = LEAD_INFO_FIELDS.filter((f) => {
    const v = lead[f.key];
    return v !== null && v !== undefined && v !== "";
  });

  const filledCustom = customFields
    .map((cf) => {
      const v = customValues.find((cv) => cv.field_id === cf.id);
      return v?.value ? { cf, value: v.value } : null;
    })
    .filter(Boolean) as Array<{ cf: typeof customFields[number]; value: string }>;

  const allFilled = [
    ...filledBase.map((f) => ({ kind: "base" as const, field: f })),
    ...filledCustom.map((c) => ({ kind: "custom" as const, cf: c.cf, value: c.value })),
  ];

  const visible = expanded ? allFilled : allFilled.slice(0, VISIBLE_BEFORE_EXPAND);
  const hidden = allFilled.length - visible.length;
  const tags = lead.lead_tags?.filter((lt) => lt.tag) ?? [];

  if (allFilled.length === 0 && tags.length === 0) return null;

  return (
    <section className="space-y-1">
      <h3 className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold pb-1">
        <FileText className="w-3 h-3" />
        Informações do lead
      </h3>
      <div className="divide-y divide-border/20">
        {visible.map((item) => {
          if (item.kind === "base") {
            const f = item.field;
            const raw = lead[f.key] as string | null | undefined;
            return (
              <InfoFieldRow
                key={f.key}
                label={f.label}
                value={raw}
                onSave={(v) => handleSave(f.key, v)}
                type={f.type === "textarea" ? "textarea" : "text"}
                render={f.type === "currency" ? (v) => <span>{formatBRL(v)}</span> : undefined}
              />
            );
          }
          return (
            <InfoFieldRow
              key={item.cf.id}
              label={item.cf.field_name}
              value={item.value}
              onSave={(v) => handleCustomSave(item.cf.id, v)}
            />
          );
        })}
      </div>

      {tags.length > 0 && (
        <div className="pt-3 pl-[120px] -ml-3 flex flex-wrap items-center gap-1.5">
          <TagIcon className="w-3 h-3 text-muted-foreground/60" />
          {tags.map((lt) =>
            lt.tag ? (
              <Badge
                key={lt.tag.id}
                variant="outline"
                className="text-[10px] font-medium"
                style={{
                  backgroundColor: `${lt.tag.color}20`,
                  color: lt.tag.color ?? undefined,
                  borderColor: `${lt.tag.color}40`,
                }}
              >
                {lt.tag.name}
              </Badge>
            ) : null
          )}
        </div>
      )}

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 font-medium pt-2"
        >
          <ChevronDown className="w-3 h-3" /> Mostrar mais ({hidden})
        </button>
      )}
      {expanded && allFilled.length > VISIBLE_BEFORE_EXPAND && (
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
