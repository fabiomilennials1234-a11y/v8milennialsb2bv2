import { memo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PropertyGroup } from "./PropertyGroup";
import { LeadPurchaseStats } from "./LeadPurchaseStats";
import { InlineField } from "./InlineField";
import { LeadChecklistSection } from "../leads/LeadChecklistSection";
import { useResponsibleMembers } from "@/modules/identity";
import { useTags } from "@/modules/leads/hooks/useTags";
import { useUpdateLead } from "../../hooks/useLeads";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import {
  useLeadCustomFields,
  useLeadCustomFieldValues,
  useSaveCustomFieldValue,
} from "../../hooks/useLeadCustomFields";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface LeadDetailPropertiesProps {
  lead: any;
  pipelineData: any;
  onSuccess?: () => void;
}

export const LeadDetailProperties = memo(function LeadDetailProperties({
  lead,
  pipelineData,
  onSuccess,
}: LeadDetailPropertiesProps) {
  const queryClient = useQueryClient();
  const updateLead = useUpdateLead();
  const logAction = useLogLeadAction();
  const responsibleMembers = useResponsibleMembers();
  const { data: allTags = [] } = useTags();
  const { data: customFields = [] } = useLeadCustomFields();
  const { data: fieldValues = [] } = useLeadCustomFieldValues(lead.id);
  const saveFieldValue = useSaveCustomFieldValue();
  const [togglingTagId, setTogglingTagId] = useState<string | null>(null);

  const handleFieldSave = async (field: string, value: string) => {
    await updateLead.mutateAsync({ id: lead.id, [field]: value || null });
    logAction({
      leadId: lead.id,
      action: "field_updated",
      description: `Campo "${field}" atualizado`,
    });
    queryClient.invalidateQueries({ queryKey: ["lead-detail", lead.id] });
    onSuccess?.();
  };

  const handleResponsibleSave = async (field: string, newId: string | null) => {
    await updateLead.mutateAsync({ id: lead.id, [field]: newId });
    const name =
      responsibleMembers.find((m) => m.id === newId)?.name || "Nenhum";
    logAction({
      leadId: lead.id,
      action: "field_updated",
      description: `Responsável "${field}" alterado para "${name}"`,
    });
    queryClient.invalidateQueries({ queryKey: ["lead-detail", lead.id] });
    toast.success(`Responsável: "${name}"`);
    onSuccess?.();
  };

  const toggleTag = async (tagId: string) => {
    setTogglingTagId(tagId);
    try {
      const existing = lead.lead_tags?.find((lt: any) => lt.tag?.id === tagId);
      if (existing) {
        await supabase
          .from("lead_tags")
          .delete()
          .eq("lead_id", lead.id)
          .eq("tag_id", tagId);
      } else {
        await supabase
          .from("lead_tags")
          .insert({ lead_id: lead.id, tag_id: tagId });
      }
      queryClient.invalidateQueries({ queryKey: ["lead-detail"] });
    } catch {
      toast.error("Erro ao atualizar etiqueta");
    } finally {
      setTogglingTagId(null);
    }
  };

  const handleCustomFieldSave = async (fieldId: string, value: string) => {
    await saveFieldValue.mutateAsync({ leadId: lead.id, fieldId, value: value || null });
  };

  const ResponsibleSelect = ({
    field,
    label,
  }: {
    field: string;
    label: string;
  }) => {
    const currentValue = lead[field] || "none";
    return (
      <div className="flex items-center gap-2 py-[3px]">
        <span className="text-[10px] text-muted-foreground/40 min-w-[70px] shrink-0">
          {label}
        </span>
        <Select
          value={currentValue}
          onValueChange={(v) =>
            handleResponsibleSave(field, v === "none" ? null : v)
          }
        >
          <SelectTrigger className="h-6 text-[10px] border-transparent hover:border-border/50 bg-transparent px-1.5">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Nenhum</SelectItem>
            {responsibleMembers.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <div className="w-[220px] shrink-0 border-r border-border p-3 overflow-y-auto">
      <PropertyGroup label="Responsáveis">
        <ResponsibleSelect field="pre_sale_responsible_id" label="Pré-Venda" />
        <ResponsibleSelect field="sale_responsible_id" label="Venda" />
      </PropertyGroup>

      {/* Vem antes de "Detalhes" de propósito: quando existe histórico de compra,
          ele é o fato mais pesado sobre a pessoa. E some sozinho quando não há —
          em 97% dos leads este bloco não renderiza (ADR-0024 decisão 1). */}
      <LeadPurchaseStats leadId={lead.id} />

      <PropertyGroup label="Detalhes">
        <InlineField
          label="Origem"
          value={lead.origin || ""}
          onSave={(v) => handleFieldSave("origin", v)}
        />
        <InlineField
          label="Segmento"
          value={lead.segment || ""}
          onSave={(v) => handleFieldSave("segment", v)}
          placeholder="Adicionar..."
        />
        <InlineField
          label="Urgência"
          value={lead.urgency || ""}
          onSave={(v) => handleFieldSave("urgency", v)}
          placeholder="Adicionar..."
        />
        <InlineField
          label="Faturamento"
          value={lead.faturamento || ""}
          onSave={(v) => handleFieldSave("faturamento", v)}
          placeholder="R$ 0"
        />
        <InlineField
          label="Observações"
          value={lead.notes || ""}
          onSave={(v) => handleFieldSave("notes", v)}
          placeholder="Notas..."
          type="textarea"
        />
      </PropertyGroup>

      {customFields.length > 0 && (
        <PropertyGroup label="Campos Custom">
          {customFields.map((cf) => {
            const fv = fieldValues.find((v) => v.field_id === cf.id);
            return (
              <InlineField
                key={cf.id}
                label={cf.field_name}
                value={fv?.value || ""}
                onSave={(v) => handleCustomFieldSave(cf.id, v)}
                placeholder="—"
              />
            );
          })}
        </PropertyGroup>
      )}

      <PropertyGroup label="Etiquetas">
        <div className="flex flex-wrap gap-1 py-1">
          {lead.lead_tags?.map(
            (lt: any) =>
              lt.tag && (
                <Badge
                  key={lt.tag.id}
                  variant="outline"
                  className="text-[9px] cursor-pointer"
                  style={{
                    backgroundColor: `${lt.tag.color}20`,
                    color: lt.tag.color,
                    borderColor: `${lt.tag.color}30`,
                  }}
                  onClick={() => toggleTag(lt.tag.id)}
                >
                  {togglingTagId === lt.tag.id ? (
                    <Loader2 className="w-2 h-2 animate-spin" />
                  ) : (
                    lt.tag.name
                  )}
                </Badge>
              ),
          )}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="text-[9px] text-muted-foreground/40 hover:text-muted-foreground flex items-center gap-0.5 px-1 py-0.5 rounded border border-dashed border-border/30 hover:border-border"
              >
                <Plus className="w-2.5 h-2.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-2" align="start">
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {allTags.map((tag) => {
                  const isActive = lead.lead_tags?.some(
                    (lt: any) => lt.tag?.id === tag.id,
                  );
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={cn(
                        "w-full text-left text-xs px-2 py-1 rounded flex items-center gap-2 hover:bg-muted",
                        isActive && "bg-muted",
                      )}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: tag.color ?? undefined }}
                      />
                      {tag.name}
                      {togglingTagId === tag.id && (
                        <Loader2 className="w-3 h-3 animate-spin ml-auto" />
                      )}
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </PropertyGroup>

      <PropertyGroup label="Pipelines">
        <div className="text-[10px] space-y-1">
          {pipelineData?.whatsapp?.length > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground/40">Qualificação</span>
              <span className="text-emerald-400">
                {pipelineData.whatsapp[0]?.stage || "—"}
              </span>
            </div>
          )}
          {pipelineData?.confirmacao?.length > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground/40">Reuniões</span>
              <span className="text-blue-400">
                {pipelineData.confirmacao[0]?.status || "—"}
              </span>
            </div>
          )}
          {pipelineData?.propostas?.length > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground/40">Propostas</span>
              <span className="text-amber-400">
                {pipelineData.propostas[0]?.status || "—"}
              </span>
            </div>
          )}
          {pipelineData?.customEntries?.map((ce: any) => (
            <div key={ce.id} className="flex justify-between">
              <span className="text-muted-foreground/40">
                {ce.pipeline?.name}
              </span>
              <span className="text-purple-400">{ce.stage?.name || "—"}</span>
            </div>
          ))}
        </div>
      </PropertyGroup>

      <PropertyGroup label="Checklists" defaultCollapsed>
        <LeadChecklistSection leadId={lead.id} />
      </PropertyGroup>
    </div>
  );
});
