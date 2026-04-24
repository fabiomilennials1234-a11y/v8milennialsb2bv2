/**
 * ContextPanelAll — painel unificado single-scroll com todas as informações do lead.
 *
 * Consolida conteúdo que antes estava em 4 tabs (Info, Pipe, Tags, Histórico).
 * Usuário vê tudo de uma vez, sem precisar clicar em tabs.
 */
import { Link } from "react-router-dom";
import { Building2, ExternalLink, Flame, GitBranch, History, Loader2, User } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useLeadByPhone } from "@/hooks/useWhatsAppLeadIntegration";
import { useLeadAllPipelines } from "@/hooks/useLeadAllPipelines";
import { useLeadTimelineCompact } from "@/hooks/useLeadTimeline";
import { AITimeline } from "@/components/chat/takeover/AITimeline";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const SOURCE_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  instagram: "Instagram",
  site: "Site",
  landing_page: "Landing Page",
  remarketing: "Remarketing",
  indicacao: "Indicação",
  evento: "Evento",
  prospeccao_ativa: "Prospecção Ativa",
  cal: "Calendário",
  outro: "Outro",
};

const SOURCE_DOTS: Record<string, string> = {
  whatsapp: "hsl(142 71% 45%)",
  meta_ads: "hsl(262 62% 66%)",
  google_ads: "hsl(358 72% 60%)",
  instagram: "hsl(320 70% 65%)",
  site: "hsl(212 86% 64%)",
  landing_page: "hsl(200 86% 60%)",
  remarketing: "hsl(30 96% 58%)",
  indicacao: "hsl(152 65% 48%)",
  evento: "hsl(280 65% 68%)",
  prospeccao_ativa: "hsl(18 85% 60%)",
  cal: "hsl(212 86% 64%)",
  outro: "hsl(var(--muted-foreground))",
};

function getScoreTone(score: number) {
  if (score >= 80) return { label: "Quente", className: "text-[hsl(358_72%_54%)] bg-[hsl(358_72%_60%/0.10)] border-[hsl(358_72%_60%/0.3)]" };
  if (score >= 50) return { label: "Morno", className: "text-[hsl(30_96%_48%)] bg-[hsl(30_96%_58%/0.10)] border-[hsl(30_96%_58%/0.3)]" };
  if (score > 0)   return { label: "Frio",  className: "text-[hsl(212_86%_54%)] bg-[hsl(212_86%_64%/0.10)] border-[hsl(212_86%_64%/0.3)]" };
  return null;
}

export interface ContextPanelAllProps {
  leadId?: string;
  phoneNumber?: string;
  pushName?: string | null;
}

export function ContextPanelAll({ leadId, phoneNumber, pushName }: ContextPanelAllProps) {
  const { data: lead, isLoading: leadLoading } = useLeadByPhone(phoneNumber ?? null);
  const activeLeadId = lead?.id ?? leadId ?? null;
  const { data: pipelines = [] } = useLeadAllPipelines(activeLeadId);
  const { data: history = [] } = useLeadTimelineCompact(activeLeadId ?? undefined);

  if (!phoneNumber) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Selecione uma conversa para ver as informações do lead
        </p>
      </div>
    );
  }

  if (leadLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Carregando lead" />
      </div>
    );
  }

  const displayName = lead?.name || pushName || phoneNumber;
  const initials = displayName.slice(0, 2).toUpperCase();
  const sourceLabel = lead?.origin ? (SOURCE_LABELS[lead.origin] ?? lead.origin) : null;
  const sourceDot = lead?.origin ? (SOURCE_DOTS[lead.origin] ?? SOURCE_DOTS.outro) : null;
  const responsible = lead?.responsible as { name?: string } | null;
  const score = typeof lead?.qualification_score === "number" ? lead.qualification_score : 0;
  const scoreTone = getScoreTone(score);
  const leadTags = (lead?.lead_tags ?? []) as Array<{ tag: { id: string; name: string; color: string } }>;
  const activePipelines = pipelines.filter((p) =>
    p.type === "standard" ? !!p.pipeId : !!p.entryId,
  );
  const recentEvents = (history as Array<{ id: string; title?: string; description?: string; created_at?: string; source?: string }>).slice(0, 5);

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col">
        {/* Header */}
        <div className="px-4 py-4 border-b border-border/40 flex items-start gap-3">
          <Avatar className="h-12 w-12 shrink-0">
            <AvatarFallback className="bg-primary/15 text-primary font-semibold text-base">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-[15px] font-semibold leading-tight truncate text-foreground">
              {displayName}
            </span>
            {lead?.company && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground leading-tight mt-1">
                <Building2 className="w-3 h-3 opacity-70 shrink-0" />
                <span className="truncate">{lead.company}</span>
              </div>
            )}
            {score > 0 && scoreTone && (
              <div className="flex items-center gap-1.5 mt-2">
                <Badge variant="outline" className={cn("text-[10px] font-bold gap-1 h-5", scoreTone.className)}>
                  <Flame className="w-3 h-3" />
                  {score}
                </Badge>
                <span className="text-[11px] text-muted-foreground">{scoreTone.label}</span>
              </div>
            )}
          </div>
        </div>

        {/* Sem lead vinculado */}
        {!lead && (
          <div className="px-4 py-6 text-center border-b border-border/40">
            <p className="text-xs text-muted-foreground mb-1">
              Nenhum lead vinculado a
            </p>
            <p className="text-sm font-medium tabular-nums">{phoneNumber}</p>
          </div>
        )}

        {/* Quick meta — source + responsible */}
        {lead && (sourceLabel || responsible?.name) && (
          <div className="px-4 py-3 border-b border-border/40 space-y-2.5">
            {sourceLabel && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground/70">
                  Origem
                </span>
                <div className="inline-flex items-center gap-1.5 px-2 h-[22px] rounded-md bg-muted/60 border border-border/60 text-[11.5px] font-medium">
                  {sourceDot && (
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: sourceDot, boxShadow: `0 0 6px ${sourceDot}` }}
                    />
                  )}
                  {sourceLabel}
                </div>
              </div>
            )}
            {responsible?.name && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground/70">
                  Responsável
                </span>
                <div className="flex items-center gap-1.5 min-w-0">
                  <Avatar className="h-5 w-5 shrink-0">
                    <AvatarFallback className="text-[8px] bg-primary/15 text-primary font-bold">
                      {responsible.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-[11.5px] font-medium text-foreground truncate max-w-[120px]">
                    {responsible.name}
                  </span>
                </div>
              </div>
            )}
            {lead.email && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground/70">
                  E-mail
                </span>
                <span className="text-[11.5px] text-muted-foreground truncate max-w-[160px]" title={lead.email}>
                  {lead.email}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Tags */}
        {lead && (
          <div className="px-4 py-3 border-b border-border/40">
            <p className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground/70 mb-2">
              Tags
            </p>
            {leadTags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {leadTags.map((lt) => (
                  <Badge
                    key={lt.tag.id}
                    variant="outline"
                    className="text-[11px] h-5 px-1.5"
                    style={{
                      backgroundColor: `${lt.tag.color}20`,
                      borderColor: `${lt.tag.color}40`,
                      color: lt.tag.color,
                    }}
                  >
                    {lt.tag.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-[11.5px] text-muted-foreground/60 italic">Nenhuma tag</p>
            )}
          </div>
        )}

        {/* Pipelines / Jornada */}
        {lead && (
          <div className="px-4 py-3 border-b border-border/40">
            <p className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground/70 mb-2 flex items-center gap-1.5">
              <GitBranch className="w-3 h-3" />
              Jornada
            </p>
            {activePipelines.length > 0 ? (
              <div className="space-y-1.5">
                {activePipelines.map((pipeline) => {
                  const key = pipeline.type === "standard" ? pipeline.pipeType : pipeline.pipelineId;
                  const label = pipeline.type === "standard" ? pipeline.label : pipeline.pipelineName;
                  const color = pipeline.type === "standard" ? pipeline.color : pipeline.pipelineColor;
                  const currentLabel =
                    pipeline.type === "standard"
                      ? pipeline.currentStageLabel
                      : pipeline.currentStageName;

                  return (
                    <div key={key} className="flex items-center gap-2 px-2.5 py-2 rounded-md border border-border/60 bg-muted/30">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-[11.5px] font-medium text-foreground truncate">{label}</span>
                        {currentLabel && (
                          <span className="text-[10.5px] text-muted-foreground truncate">
                            {currentLabel}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11.5px] text-muted-foreground/60 italic">Lead não está em nenhum funil</p>
            )}
          </div>
        )}

        {/* Histórico recente (compacto) */}
        {lead && recentEvents.length > 0 && (
          <div className="px-4 py-3 border-b border-border/40">
            <p className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground/70 mb-2 flex items-center gap-1.5">
              <History className="w-3 h-3" />
              Histórico recente
            </p>
            <div className="space-y-2">
              {recentEvents.map((event) => (
                <div key={event.id} className="flex gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 mt-1.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11.5px] leading-tight text-foreground">
                      {event.title || event.description || "Evento"}
                    </p>
                    {event.created_at && (
                      <p className="text-[10px] text-muted-foreground/70 tabular-nums mt-0.5">
                        {formatDistanceToNow(new Date(event.created_at), { addSuffix: true, locale: ptBR })}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI Timeline */}
        <AITimeline leadId={activeLeadId ?? undefined} />

        {/* CTA — Abrir ficha completa */}
        {activeLeadId && (
          <div className="px-4 py-3">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs gap-1.5"
            >
              <Link to={`/leads?selected=${activeLeadId}`}>
                <User className="w-3.5 h-3.5" />
                Abrir ficha completa
                <ExternalLink className="w-3 h-3 ml-auto opacity-60" />
              </Link>
            </Button>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
