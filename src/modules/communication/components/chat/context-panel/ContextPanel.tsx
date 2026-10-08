/**
 * ContextPanel — painel de contexto 3ª coluna do ChatShell.
 *
 * Layout em 3 abas:
 *   INFOS     — origem, responsável, email, tags, jornada, campos
 *               personalizados, copilot toggle, nota rápida, CTA ficha
 *   HISTÓRICO — timeline completa de ações do lead (lead_history)
 *   I.A       — mensagens e ações do agente (AITimeline)
 *
 * Header persistente acima das abas: avatar, nome, empresa — no bloco de ouro
 * do V5 (o "foco" da tela é o lead da conversa aberta).
 *
 * Score e temperatura ("Quente/Morno/Frio") SAÍRAM do header: o produto não usa
 * mais score de lead (CTO, 01/10) nem calor (03/09 — "fica só qualificação e
 * pré-qualificação"). As duas qualificações continuam na aba Infos.
 */
import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, Building2, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { FocusCard, FocusTile } from "@/components/ui/bento";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBRL } from "@/lib/format";
import { useLeadByPhone } from "@/modules/communication/hooks/useWhatsAppLeadIntegration";
import { useLeadById, useLeadsDeals } from "@/modules/leads";
import { LeadContactModal } from "@/modules/communication/components/chat/LeadContactModal";
import { negocioEmDestaque } from "@/modules/communication/lib/negocioEmDestaque";
import { ContextPanelTabInfo } from "./ContextPanelTabInfo";
import { ContextPanelTabHistory } from "./ContextPanelTabHistory";
import { ContextPanelTabAI } from "./ContextPanelTabAI";
import { telefoneParaExibicao } from "@/modules/communication/lib/identificadorOculto";
import { nomeDoPainelDeContexto } from "@/modules/communication/lib/nomeDaConversa";

export interface ContextPanelProps {
  leadId?: string;
  phoneNumber?: string;
  pushName?: string | null;
  /**
   * O nome que o cabeçalho da conversa já resolveu (flag `chat_nome_do_lead`).
   * Ausente = comportamento de sempre.
   */
  nomeDaConversa?: string | null;
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

export function ContextPanel({
  leadId,
  phoneNumber,
  pushName,
  nomeDaConversa,
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
  const [fichaAberta, setFichaAberta] = useState(false);

  // O Negócio do bloco de ouro (CTO, P8a): a MESMA leitura da ficha do lead
  // (`useLeadsDeals`), só leitura. Hook antes dos retornos antecipados.
  const idsDoLead = useMemo(() => (activeLeadId ? [activeLeadId] : []), [activeLeadId]);
  const { data: negociosPorLead } = useLeadsDeals(idsDoLead);
  const destaque = activeLeadId ? negocioEmDestaque(negociosPorLead?.[activeLeadId]) : null;

  if (!phoneNumber && !leadId) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {placeholder ?? "Selecione uma conversa para ver as informações do lead"}
          </p>
        </div>
      </div>
    );
  }

  if (leadLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-full items-center justify-center">
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
    nomeDoPainelDeContexto({
      leadName: lead?.name,
      nomeDaConversa,
      pushName,
      telefoneExibicao: telefoneParaExibicao(phoneNumber),
    });
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="flex h-full flex-col">
      {/* Header persistente — bloco de ouro com quem é o interlocutor e, quando
          existe, o Negócio dele (etapa + valor, só leitura). Score, anel e
          temperatura NÃO entram (o produto tirou). */}
      <FocusCard className="m-3 mb-0 shrink-0 gap-3 p-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-11 w-11 shrink-0">
            <AvatarFallback className="bg-primary-foreground/10 text-base font-bold text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[11px] font-bold text-primary-foreground/70">
              {lead ? "Lead" : "Contato sem lead"}
            </span>
            <span className="truncate text-[1.1rem] font-extrabold leading-tight tracking-[-0.02em]">
              {displayName}
            </span>
            {lead?.company && (
              <div className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold leading-tight text-primary-foreground/75">
                <Building2 className="h-3 w-3 shrink-0" />
                <span className="truncate">{lead.company}</span>
              </div>
            )}
          </div>
          {phoneNumber && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setFichaAberta(true)}
                  aria-label={lead ? "Abrir ficha do lead" : "Criar ou vincular lead"}
                  className="grid h-9 w-9 shrink-0 place-items-center self-start rounded-full bg-primary-foreground/10 text-primary-foreground transition-colors hover:bg-primary-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/40"
                >
                  <ArrowUpRight className="h-4 w-4" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">{lead ? "Abrir ficha do lead" : "Criar ou vincular lead"}</TooltipContent>
            </Tooltip>
          )}
        </div>

        {destaque && (
          <FocusTile className="flex items-end justify-between gap-3 px-3.5 py-3" data-testid="negocio-do-lead">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold text-primary-foreground/70">
                Negócio · {destaque.negocio.stageName}
              </p>
              <p className="text-[1.3rem] font-extrabold leading-tight tracking-[-0.03em] tabular-nums">
                {destaque.negocio.value > 0 ? (
                  formatBRL(destaque.negocio.value)
                ) : (
                  <span className="text-[13px] font-bold text-primary-foreground/60">Sem valor</span>
                )}
              </p>
            </div>
            <p className="min-w-0 max-w-[50%] truncate text-right text-[11px] font-semibold text-primary-foreground/65" title={destaque.negocio.funnelName}>
              {destaque.negocio.funnelName}
              {destaque.outrosAbertos > 0 && (
                <span className="block text-primary-foreground/55">
                  +{destaque.outrosAbertos} {destaque.outrosAbertos === 1 ? "aberto" : "abertos"}
                </span>
              )}
            </p>
          </FocusTile>
        )}
      </FocusCard>

      {phoneNumber && (
        <LeadContactModal
          isOpen={fichaAberta}
          onClose={() => setFichaAberta(false)}
          phoneNumber={phoneNumber}
          pushName={pushName ?? undefined}
        />
      )}

      {identitySlot}

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as ContextPanelTab)}
        className="flex flex-col flex-1 min-h-0"
      >
        <TabsList variant="segmented" className="mx-3 mt-3 flex shrink-0">
          <TabsTrigger value="info" className="flex-1">
            Infos
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-1">
            Histórico
          </TabsTrigger>
          <TabsTrigger value="ai" className="flex-1">
            I.A
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="info"
          className="mt-2 min-h-0 flex-1 focus-visible:ring-0 focus-visible:ring-offset-0"
        >
          <ContextPanelTabInfo
            lead={lead ?? null}
            activeLeadId={activeLeadId}
            phoneNumber={phoneNumber}
          />
        </TabsContent>

        <TabsContent
          value="history"
          className="mt-2 min-h-0 flex-1 focus-visible:ring-0 focus-visible:ring-offset-0"
        >
          <ContextPanelTabHistory leadId={activeLeadId} />
        </TabsContent>

        <TabsContent
          value="ai"
          className="mt-2 min-h-0 flex-1 focus-visible:ring-0 focus-visible:ring-offset-0"
        >
          <ContextPanelTabAI leadId={activeLeadId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
