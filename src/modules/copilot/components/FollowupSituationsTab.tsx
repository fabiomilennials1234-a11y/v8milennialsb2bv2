/**
 * Follow-up Situations config (ADR-0006).
 *
 * The Org enables/disables each of the seven Torque-curated Situations and tunes
 * the basics. Which stages trigger each Situation is decided automatically by
 * the AI Stage Classifier — not configured here.
 *
 * NOTE: first functional pass — pending design review against the world-class
 * bar and a frontend render/QA verification.
 */

import { useMemo, useState } from "react";
import { Loader2, ChevronDown, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  useFollowupSituationConfig,
  useUpsertFollowupSituationConfig,
  type FollowupSituationConfig,
  type SituationId,
} from "@/modules/copilot/hooks/useFollowupSituationConfig";

type Archetype = "Qualificador" | "Vendedor" | "Carteira";

interface SituationMeta {
  id: SituationId;
  label: string;
  description: string;
  archetype: Archetype;
}

const SITUATIONS: SituationMeta[] = [
  { id: "new_lead_no_reply", label: "Lead novo sem resposta", description: "Abordei um lead novo e ele nunca respondeu.", archetype: "Qualificador" },
  { id: "qualified_no_meeting", label: "Qualificou, não agendou", description: "Lead qualificado que ainda não marcou a conversa.", archetype: "Qualificador" },
  { id: "cold_reengage", label: "Re-engajamento frio", description: "Lead que conversou e esfriou, parado na nutrição.", archetype: "Qualificador" },
  { id: "meeting_reminder", label: "Lembrete de reunião", description: "Lembra da reunião marcada (só lembra, não confirma).", archetype: "Vendedor" },
  { id: "no_show_rebook", label: "Não compareceu → remarcar", description: "Lead que faltou na reunião e pode remarcar.", archetype: "Vendedor" },
  { id: "proposal_no_reply", label: "Proposta sem resposta", description: "Proposta enviada e o lead sumiu.", archetype: "Vendedor" },
  { id: "dormant_winback", label: "Cliente dormindo → win-back", description: "Cliente da carteira que parou de comprar.", archetype: "Carteira" },
];

const ARCHETYPES: Archetype[] = ["Qualificador", "Vendedor", "Carteira"];

function SituationCard({
  meta,
  config,
}: {
  meta: SituationMeta;
  config: FollowupSituationConfig | undefined;
}) {
  const upsert = useUpsertFollowupSituationConfig();
  const [open, setOpen] = useState(false);

  const isActive = config?.is_active ?? false;
  const delayHours = config?.delay_hours ?? 24;
  const touchCount = config?.touch_count ?? null;
  const spacingHours = config?.spacing_hours ?? null;
  const hasStages = (config?.trigger_stage_keys?.length ?? 0) > 0;

  const patch = (p: Parameters<typeof upsert.mutate>[0]) => upsert.mutate(p);

  return (
    <Card className={cn("transition-opacity", !isActive && "opacity-60")}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Switch
                checked={isActive}
                onCheckedChange={(checked) => patch({ situationId: meta.id, is_active: checked })}
              />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{meta.label}</span>
                  {!hasStages && (
                    <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/50">
                      <Sparkles className="w-3 h-3 mr-1" /> aguardando classificação
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{meta.description}</p>
              </div>
            </div>
            <CollapsibleTrigger className="text-muted-foreground hover:text-foreground">
              <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="pt-4">
            <div className="grid grid-cols-3 gap-3 pl-12">
              <div className="space-y-1.5">
                <Label className="text-xs">Espera inicial (h)</Label>
                <Input
                  type="number"
                  min={0}
                  defaultValue={delayHours}
                  onBlur={(e) => patch({ situationId: meta.id, delay_hours: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Nº de toques</Label>
                <Input
                  type="number"
                  min={1}
                  max={6}
                  placeholder="padrão"
                  defaultValue={touchCount ?? undefined}
                  onBlur={(e) => patch({ situationId: meta.id, touch_count: e.target.value ? parseInt(e.target.value) : null })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Espaçamento (h)</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="padrão"
                  defaultValue={spacingHours ?? undefined}
                  onBlur={(e) => patch({ situationId: meta.id, spacing_hours: e.target.value ? parseInt(e.target.value) : null })}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 pl-12">
              As etapas que disparam esta situação são definidas automaticamente pela IA a partir do seu funil.
            </p>
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
}

export function FollowupSituationsTab() {
  const { data: configs = [], isLoading } = useFollowupSituationConfig();

  const byId = useMemo(() => {
    const m = new Map<SituationId, FollowupSituationConfig>();
    for (const c of configs) m.set(c.situation_id, c);
    return m;
  }, [configs]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando situações...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Follow-up automático</h3>
        <p className="text-sm text-muted-foreground">
          Ligue as situações em que a IA deve reativar leads. Cadência e mensagens já vêm prontas — você só ajusta o básico.
        </p>
      </div>

      {ARCHETYPES.map((arch) => (
        <div key={arch} className="space-y-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{arch}</span>
          {SITUATIONS.filter((s) => s.archetype === arch).map((meta) => (
            <SituationCard key={meta.id} meta={meta} config={byId.get(meta.id)} />
          ))}
        </div>
      ))}
    </div>
  );
}
