/**
 * ContextPanelTabInfo — aba INFOS do ContextPanel.
 *
 * Conteúdo:
 *   - Quick meta (Origem, Responsável, E-mail)
 *   - Tags
 *   - Jornada (pipelines ativos)
 *   - Campos personalizados (inline edit)
 *   - Copilot toggle
 *   - Nota rápida
 *   - CTA ficha completa
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Bot,
  ExternalLink,
  GitBranch,
  Loader2,
  SlidersHorizontal,
  StickyNote,
  User,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useLeadAllPipelines } from "@/hooks/useLeadAllPipelines";
import { useLeadAiStatus, useToggleLeadAI } from "@/hooks/useLeads";
import { LeadCustomFields } from "@/components/lead/info/LeadCustomFields";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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

type LeadLike = {
  id?: string;
  email?: string | null;
  origin?: string | null;
  organization_id?: string | null;
  responsible?: { name?: string } | null;
  lead_tags?: Array<{ tag: { id: string; name: string; color: string } }>;
};

export interface ContextPanelTabInfoProps {
  lead: LeadLike | null | undefined;
  activeLeadId: string | null;
  phoneNumber?: string;
}

export function ContextPanelTabInfo({
  lead,
  activeLeadId,
  phoneNumber,
}: ContextPanelTabInfoProps) {
  const qc = useQueryClient();
  const { data: pipelines = [] } = useLeadAllPipelines(activeLeadId);
  const { data: aiStatus } = useLeadAiStatus(activeLeadId ?? undefined);
  const toggleAiMutation = useToggleLeadAI();

  const [noteValue, setNoteValue] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const sourceLabel = lead?.origin ? (SOURCE_LABELS[lead.origin] ?? lead.origin) : null;
  const sourceDot = lead?.origin ? (SOURCE_DOTS[lead.origin] ?? SOURCE_DOTS.outro) : null;
  const responsible = lead?.responsible ?? null;
  const leadTags = (lead?.lead_tags ?? []) as Array<{ tag: { id: string; name: string; color: string } }>;
  const activePipelines = pipelines.filter((p) =>
    p.type === "standard" ? !!p.pipeId : !!p.entryId,
  );
  const aiDisabled = aiStatus?.ai_disabled ?? false;

  const handleSaveNote = async () => {
    if (!activeLeadId || !noteValue.trim()) return;
    setSavingNote(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: member } = user
        ? await supabase.from("team_members").select("name").eq("user_id", user.id).maybeSingle()
        : { data: null };
      const userName = member?.name || user?.email?.split("@")[0] || "Usuário";

      const { error } = await supabase.from("lead_history").insert({
        lead_id: activeLeadId,
        action: "note_added",
        description: `${userName}: ${noteValue.trim()}`,
        created_by: user?.id || null,
        organization_id: lead?.organization_id || null,
      });
      if (error) throw error;

      qc.invalidateQueries({ queryKey: ["lead-timeline", activeLeadId] });
      qc.invalidateQueries({ queryKey: ["lead-history", activeLeadId] });
      qc.invalidateQueries({ queryKey: ["lead-history-compact", activeLeadId] });
      toast.success("Nota adicionada");
      setNoteValue("");
    } catch (err: any) {
      toast.error(err?.message || "Erro ao salvar nota");
    } finally {
      setSavingNote(false);
    }
  };

  if (!lead && phoneNumber) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-xs text-muted-foreground mb-1">Nenhum lead vinculado a</p>
        <p className="text-sm font-medium tabular-nums">{phoneNumber}</p>
      </div>
    );
  }

  if (!lead) return null;

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col">
        {/* Quick meta */}
        {(sourceLabel || responsible?.name || lead.email) && (
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
                <span
                  className="text-[11.5px] text-muted-foreground truncate max-w-[160px]"
                  title={lead.email}
                >
                  {lead.email}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Tags */}
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

        {/* Jornada */}
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
                  <div
                    key={key}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-md border border-border/60 bg-muted/30"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-[11.5px] font-medium text-foreground truncate">
                        {label}
                      </span>
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
            <p className="text-[11.5px] text-muted-foreground/60 italic">
              Lead não está em nenhum funil
            </p>
          )}
        </div>

        {/* Campos personalizados */}
        {activeLeadId && (
          <div className="px-4 py-3 border-b border-border/40">
            <p className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground/70 mb-2 flex items-center gap-1.5">
              <SlidersHorizontal className="w-3 h-3" />
              Campos personalizados
            </p>
            <LeadCustomFields leadId={activeLeadId} />
          </div>
        )}

        {/* Copilot toggle */}
        {activeLeadId && (
          <div className="px-4 py-3 border-b border-border/40">
            <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <Bot className="w-4 h-4 text-primary shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="text-[12px] font-semibold leading-tight">
                    {aiDisabled ? "Copilot desativado" : "Copilot ativo"}
                  </span>
                  <span className="text-[10.5px] text-muted-foreground leading-tight">
                    {aiDisabled ? "IA não responderá este lead" : "Respondendo automaticamente"}
                  </span>
                </div>
              </div>
              <Switch
                checked={!aiDisabled}
                onCheckedChange={(checked) =>
                  toggleAiMutation.mutate({ leadId: activeLeadId, disabled: !checked })
                }
                disabled={toggleAiMutation.isPending}
                aria-label="Ativar ou desativar Copilot"
              />
            </div>
          </div>
        )}

        {/* Nota rápida */}
        {activeLeadId && (
          <div className="px-4 py-3 border-b border-border/40">
            <p className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground/70 mb-2 flex items-center gap-1.5">
              <StickyNote className="w-3 h-3" />
              Nota rápida
            </p>
            <Textarea
              value={noteValue}
              onChange={(e) => setNoteValue(e.target.value)}
              placeholder="Escreva uma nota sobre o lead..."
              rows={3}
              className="text-[12.5px] resize-none"
            />
            <Button
              size="sm"
              variant="outline"
              className="w-full mt-2 h-7 text-[11.5px]"
              disabled={!noteValue.trim() || savingNote}
              onClick={handleSaveNote}
            >
              {savingNote ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
              Salvar nota
            </Button>
          </div>
        )}

        {/* CTA ficha completa */}
        {activeLeadId && (
          <div className="px-4 py-3">
            <Button asChild variant="outline" size="sm" className="w-full h-8 text-xs gap-1.5">
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
