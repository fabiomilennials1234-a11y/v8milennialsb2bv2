import { memo } from "react";
import { Activity, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { InfoFieldRow } from "./InfoFieldRow";
import { LEAD_TRACKING_FIELDS } from "./info-field-config";
import { ORIGIN_COLORS } from "../../../leads/LeadCard";
import { useLeadOrigins } from "../../../../hooks/useLeadOrigins";
import { useUpdateLead } from "../../../../hooks/useLeads";
import { useLogLeadAction } from "../../../../hooks/useLogLeadAction";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface InfoBlockTrackingProps {
  lead: Record<string, unknown> & { id: string; created_at?: string | null };
}

/**
 * Editor inline de origem — mantém o badge de cor idêntico ao read-only anterior
 * (ORIGIN_COLORS de LeadCard = fonte de cor/label do badge, sem regressão visual)
 * e adiciona um Select (lista dinâmica via useLeadOrigins) para editar.
 */
function OriginEditRow({ leadId, origin }: { leadId: string; origin: string | null | undefined }) {
  const { origins } = useLeadOrigins();
  const updateLead = useUpdateLead();
  const logAction = useLogLeadAction();
  const qc = useQueryClient();

  const handleChange = async (value: string) => {
    if (value === origin) return;
    await updateLead.mutateAsync({ id: leadId, origin: value } as Parameters<typeof updateLead.mutateAsync>[0]);
    logAction({ leadId, action: "field_updated", description: `Campo "origin" atualizado` });
    qc.invalidateQueries({ queryKey: ["lead-detail", leadId] });
  };

  const color = origin ? ORIGIN_COLORS[origin] ?? ORIGIN_COLORS.outro : null;

  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-3 py-2 group">
      <div className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground/70 font-medium">
        <span>Origem</span>
      </div>
      <div className="min-w-0">
        <Select value={origin ?? undefined} onValueChange={handleChange}>
          <SelectTrigger
            aria-label="Origem"
            className="h-auto w-fit gap-1.5 border-transparent bg-transparent px-2 py-1 -mx-2 hover:border-border/40 hover:bg-muted/30 focus:ring-2 focus:ring-ring/40"
          >
            {color ? (
              <Badge
                variant="outline"
                className="text-[11px]"
                style={{ backgroundColor: color.bg, color: color.text, borderColor: `${color.text}40` }}
              >
                {color.label}
              </Badge>
            ) : (
              <span className="text-sm text-muted-foreground/40 italic">Definir origem</span>
            )}
          </SelectTrigger>
          <SelectContent>
            {origins.map((o) => (
              <SelectItem key={o.slug} value={o.slug}>
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: o.color }} />
                  {o.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export const InfoBlockTracking = memo(function InfoBlockTracking({ lead }: InfoBlockTrackingProps) {
  // Campos read-only (UTM / meta ids) — só aparecem quando preenchidos.
  const readonlyFields = LEAD_TRACKING_FIELDS.filter((f) => {
    if (f.type === "origin") return false; // origin tem editor dedicado
    const v = lead[f.key];
    return v !== null && v !== undefined && v !== "";
  });

  return (
    <section className="space-y-1">
      <h3 className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold pb-1">
        <Activity className="w-3 h-3" />
        Tracking
      </h3>
      <div className="divide-y divide-border/20">
        {lead.created_at && (
          <InfoFieldRow
            label="Criado em"
            value={format(new Date(lead.created_at), "dd MMM yyyy 'às' HH:mm", { locale: ptBR })}
            readOnly
            icon={<Calendar className="w-3 h-3" />}
          />
        )}
        {/* Origem — sempre editável (mesmo quando ainda não definida) */}
        <OriginEditRow leadId={lead.id} origin={lead.origin as string | null | undefined} />
        {readonlyFields.map((f) => {
          const raw = lead[f.key] as string;
          return (
            <InfoFieldRow
              key={f.key}
              label={f.label}
              value={raw}
              readOnly
              render={(v) => <span className="font-mono text-xs text-muted-foreground/80">{v}</span>}
            />
          );
        })}
      </div>
    </section>
  );
});
