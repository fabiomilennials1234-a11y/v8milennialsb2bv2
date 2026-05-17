import { memo } from "react";
import { Activity, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InfoFieldRow } from "./InfoFieldRow";
import { LEAD_TRACKING_FIELDS } from "./info-field-config";
import { ORIGIN_COLORS } from "@/components/leads/LeadCard";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface InfoBlockTrackingProps {
  lead: Record<string, unknown> & { created_at?: string | null };
}

export const InfoBlockTracking = memo(function InfoBlockTracking({ lead }: InfoBlockTrackingProps) {
  const trackingFields = LEAD_TRACKING_FIELDS.filter((f) => {
    const v = lead[f.key];
    return v !== null && v !== undefined && v !== "";
  });

  if (trackingFields.length === 0 && !lead.created_at) return null;

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
        {trackingFields.map((f) => {
          const raw = lead[f.key] as string;
          if (f.key === "origin") {
            const color = ORIGIN_COLORS[raw] ?? ORIGIN_COLORS.outro;
            return (
              <InfoFieldRow
                key={f.key}
                label={f.label}
                value={raw}
                readOnly
                render={() => (
                  <Badge
                    variant="outline"
                    className="text-[11px]"
                    style={{
                      backgroundColor: color.bg,
                      color: color.text,
                      borderColor: `${color.text}40`,
                    }}
                  >
                    {color.label}
                  </Badge>
                )}
              />
            );
          }
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
