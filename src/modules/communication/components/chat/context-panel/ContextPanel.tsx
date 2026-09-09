/**
 * ContextPanel — painel de contexto 3ª coluna do ChatShell.
 *
 * Layout em 3 abas:
 *   INFOS     — origem, responsável, email, tags, jornada, campos
 *               personalizados, copilot toggle, nota rápida, CTA ficha
 *   HISTÓRICO — timeline completa de ações do lead (lead_history)
 *   I.A       — mensagens e ações do agente (AITimeline)
 *
 * Header persistente acima das abas: avatar, nome, empresa, score.
 */
import { useState, type ReactNode } from "react";
import { Building2, Flame, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useLeadByPhone } from "@/modules/communication/hooks/useWhatsAppLeadIntegration";
import { useLeadById } from "@/modules/leads";
import { ContextPanelTabInfo } from "./ContextPanelTabInfo";
import { ContextPanelTabHistory } from "./ContextPanelTabHistory";
import { ContextPanelTabAI } from "./ContextPanelTabAI";
import { telefoneParaExibicao } from "@/modules/communication/lib/identificadorOculto";

export interface ContextPanelProps {
  leadId?: string;
  phoneNumber?: string;
  pushName?: string | null;
  onClose?: () => void;
  /**
   * O que dizer quando não há NEM telefone NEM lead para abrir o painel.
   *
   * O default ("selecione uma conversa") pressupõe que a ausência de telefone
   * significa ausência de conversa aberta — o que deixou de ser verdade com um
   * segundo canal no inbox. Hoje uma conversa de Instagram sem lead nem chega
   * aqui: quem ocupa a coluna nesse caso é o `SocialLeadLinkPanel`, que oferece
   * a ação em vez de descrever a ausência.
   */
  placeholder?: string;
  /**
   * Linha de identidade do canal, logo abaixo do header.
   *
   * Existe porque um lead vindo do Instagram precisa dizer, na própria ficha, de
   * qual conta ele veio e como desfazer o vínculo. No WhatsApp fica `undefined`
   * e o painel é byte a byte o de sempre.
   */
  identitySlot?: ReactNode;
}

export type ContextPanelTab = "info" | "history" | "ai";

function getScoreTone(score: number) {
  if (score >= 80)
    return {
      label: "Quente",
      className:
        "text-[hsl(358_72%_54%)] bg-[hsl(358_72%_60%/0.10)] border-[hsl(358_72%_60%/0.3)]",
    };
  if (score >= 50)
    return {
      label: "Morno",
      className:
        "text-[hsl(30_96%_48%)] bg-[hsl(30_96%_58%/0.10)] border-[hsl(30_96%_58%/0.3)]",
    };
  if (score > 0)
    return {
      label: "Frio",
      className:
        "text-[hsl(212_86%_54%)] bg-[hsl(212_86%_64%/0.10)] border-[hsl(212_86%_64%/0.3)]",
    };
  return null;
}

export function ContextPanel({
  leadId,
  phoneNumber,
  pushName,
  placeholder,
  identitySlot,
}: ContextPanelProps) {
  const [activeTab, setActiveTab] = useState<ContextPanelTab>("info");
  const { data: leadByPhone, isLoading: loadingByPhone } = useLeadByPhone(
    phoneNumber ?? null,
  );
  // Duas resoluções, jamais simultâneas: com telefone o caminho é o de sempre
  // (WhatsApp), e o hook por id fica DESABILITADO — nenhuma query a mais no
  // caminho quente de 30 orgs. Sem telefone, o id é a única identidade que
  // existe: é o caso de uma conversa de Instagram já vinculada a um lead.
  const { data: leadById, isLoading: loadingById } = useLeadById(
    phoneNumber ? null : leadId ?? null,
  );
  const lead = leadByPhone ?? leadById ?? null;
  const leadLoading = loadingByPhone || loadingById;
  const activeLeadId = lead?.id ?? leadId ?? null;

  if (!phoneNumber && !leadId) {
    return (
      <div className="flex flex-col h-full bg-background border-l border-border/60">
        <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {placeholder ?? "Selecione uma conversa para ver as informações do lead"}
          </p>
        </div>
      </div>
    );
  }

  if (leadLoading) {
    return (
      <div className="flex flex-col h-full bg-background border-l border-border/60">
        <div className="flex items-center justify-center h-full">
          <Loader2
            className="h-5 w-5 animate-spin text-muted-foreground"
            aria-label="Carregando lead"
          />
        </div>
      </div>
    );
  }

  // `phoneNumber` deixou de ser o último recurso garantido — uma conversa de
  // Instagram não tem nenhum. "Contato" é o fim da fila.
  // A queda para `phoneNumber` passa pelo mesmo filtro do resto do chat: LID e
  // canal viram rótulo, telefone segue igual. Ver `lib/identificadorOculto.ts`.
  const displayName =
    lead?.name || pushName || telefoneParaExibicao(phoneNumber) || "Contato";
  const initials = displayName.slice(0, 2).toUpperCase();
  const score =
    typeof lead?.qualification_score === "number" ? lead.qualification_score : 0;
  const scoreTone = getScoreTone(score);

  return (
    <div className="flex flex-col h-full bg-background border-l border-border/60">
      {/* Header persistente */}
      <div className="px-4 py-4 border-b border-border/40 flex items-start gap-3 shrink-0">
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
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-bold gap-1 h-5",
                  scoreTone.className,
                )}
              >
                <Flame className="w-3 h-3" />
                {score}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                {scoreTone.label}
              </span>
            </div>
          )}
        </div>
      </div>

      {identitySlot}

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as ContextPanelTab)}
        className="flex flex-col flex-1 min-h-0"
      >
        <TabsList className="w-full justify-start gap-5 px-4 pt-2 shrink-0 rounded-none bg-transparent">
          <TabsTrigger value="info" className="text-[11.5px] uppercase tracking-wider">
            Infos
          </TabsTrigger>
          <TabsTrigger value="history" className="text-[11.5px] uppercase tracking-wider">
            Histórico
          </TabsTrigger>
          <TabsTrigger value="ai" className="text-[11.5px] uppercase tracking-wider">
            I.A
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="info"
          className="flex-1 min-h-0 mt-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        >
          <ContextPanelTabInfo
            lead={lead ?? null}
            activeLeadId={activeLeadId}
            phoneNumber={phoneNumber}
          />
        </TabsContent>

        <TabsContent
          value="history"
          className="flex-1 min-h-0 mt-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        >
          <ContextPanelTabHistory leadId={activeLeadId} />
        </TabsContent>

        <TabsContent
          value="ai"
          className="flex-1 min-h-0 mt-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        >
          <ContextPanelTabAI leadId={activeLeadId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
