/**
 * ContextPanelInfo — painel de informações do lead na 3ª coluna do ChatShell.
 *
 * C32: lead info (nome, empresa, stage, tags, responsible) + AITimeline expansível.
 *
 * Estrutura:
 *   Header: avatar + nome + empresa + qualification_score
 *   Lead meta: source chip + score + responsible
 *   AITimeline: seção expansível no bottom
 */
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useLeadByPhone } from "@/hooks/useWhatsAppLeadIntegration";
import { AITimeline } from "@/components/chat/takeover/AITimeline";
import { Loader2 } from "lucide-react";

// ─── Props ─────────────────────────────────────────────────────────────────────

export interface ContextPanelInfoProps {
  leadId?: string;
  phoneNumber?: string;
  pushName?: string | null;
}

// ─── Source labels ──────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  whatsapp:    "WhatsApp",
  meta_ads:    "Meta Ads",
  google_ads:  "Google Ads",
  site:        "Site",
  remarketing: "Remarketing",
  cal:         "Calendário",
  outro:       "Outro",
};

// ─── Componente ────────────────────────────────────────────────────────────────

export function ContextPanelInfo({ leadId, phoneNumber, pushName }: ContextPanelInfoProps) {
  const { data: lead, isLoading } = useLeadByPhone(phoneNumber ?? null);

  // Se não tem phone, não tem como buscar o lead
  if (!phoneNumber) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Selecione uma conversa para ver as informações do lead
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Carregando lead..." />
      </div>
    );
  }

  const displayName = lead?.name || pushName || phoneNumber;
  const initials = displayName.slice(0, 2).toUpperCase();
  const sourceLabel = lead?.origin ? (SOURCE_LABELS[lead.origin] ?? lead.origin) : null;
  const responsible = lead?.responsible as { name?: string } | null;
  const activLeadId = lead?.id ?? leadId;

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col">
        {/* ── Header: avatar + nome + empresa ─── */}
        <div className="px-4 py-4 border-b border-border/40 flex items-start gap-3">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarFallback className="bg-primary/15 text-primary font-medium text-sm">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-semibold leading-tight truncate text-foreground">
              {displayName}
            </span>
            {lead?.company && (
              <span className="text-xs text-muted-foreground leading-tight truncate mt-0.5">
                {lead.company}
              </span>
            )}
            {lead?.qualification_score != null && (
              <span className="text-[11px] text-muted-foreground/70 mt-1 tabular-nums">
                Score: {lead.qualification_score}
              </span>
            )}
          </div>
        </div>

        {/* ── Lead meta: source chip + responsible ─── */}
        {lead && (
          <div className="px-4 py-3 border-b border-border/40 flex flex-wrap items-center gap-2">
            {sourceLabel && (
              <span className="text-[11px] bg-muted/60 rounded px-2 py-0.5 text-muted-foreground">
                {sourceLabel}
              </span>
            )}
            {lead.email && (
              <span className="text-[11px] text-muted-foreground truncate max-w-[140px]">
                {lead.email}
              </span>
            )}
            {responsible?.name && (
              <div className="flex items-center gap-1.5 ml-auto">
                <Avatar className="h-5 w-5 shrink-0">
                  <AvatarFallback className="text-[8px] bg-muted/60">
                    {responsible.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[11px] text-muted-foreground truncate max-w-[80px]">
                  {responsible.name}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Tags ─── */}
        {lead?.lead_tags && (lead.lead_tags as Array<{ tag: { id: string; name: string; color: string } }>).length > 0 && (
          <div className="px-4 py-3 border-b border-border/40 flex flex-wrap gap-1">
            {(lead.lead_tags as Array<{ tag: { id: string; name: string; color: string } }>).map((lt) => (
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
        )}

        {/* ── Sem lead: indicação ─── */}
        {!lead && !isLoading && (
          <div className="px-4 py-4 text-xs text-muted-foreground text-center border-b border-border/40">
            Nenhum lead vinculado a {phoneNumber}
          </div>
        )}

        {/* ── AITimeline expansível ─── */}
        <AITimeline leadId={activLeadId} />
      </div>
    </ScrollArea>
  );
}
