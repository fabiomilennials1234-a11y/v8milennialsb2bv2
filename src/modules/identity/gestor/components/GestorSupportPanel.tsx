/**
 * Painel de suporte da Área do Gestor (ADR-0021 §9).
 *
 * O Gestor de Portfólio abre e acompanha Chamados de dentro do hub `/gestor`,
 * reutilizando as peças do painel padrão (`NewTicketForm`, `TicketThread`,
 * `StatusDot`) — sem duplicar UI. O que muda em relação ao painel do cliente:
 *
 *   • Ancoragem explícita: um <Select> de orgs vinculadas escolhe a org do
 *     Chamado. O frontend nunca inventa org fora dos vínculos (a lista de
 *     opções É a whitelist; o hook e o trigger reforçam).
 *   • Marcador de autor-gestor: `useCreateGestorSupportTicket` grava
 *     `author_gestor_id`, e o staff da Torque vê o selo "Gestor".
 *   • Sem org selecionada no hub: lista e criação são explícitas na org, não
 *     dependem de `useOrganization`. Só ao ABRIR um thread ativamos a org do
 *     chamado no contexto — é o que `TicketThread` (peça reutilizada) espera.
 */

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Building2, ChevronRight, LifeBuoy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  NewTicketForm,
  StatusDot,
  TicketThread,
  STATUS_LABELS,
  type TicketDraft,
} from "@/modules/platform";
import { buildSupportContext } from "@/core/observability/support-context";
import { getSessionId } from "@/core/trace/request-trace";
import { useAuth } from "../../auth/contexts/AuthContext";
import { useOrgSwitcher } from "../../org-team/hooks/useOrgSwitcher";
import { setSelectedOrgId } from "../../org-team/hooks/useCurrentTeamMember";
import {
  useCreateGestorSupportTicket,
  useGestorSupportTickets,
  type GestorSupportTicket,
} from "../hooks/useGestorSupport";

type View = "list" | "compose" | "thread";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GestorSupportPanel({ open, onOpenChange }: Props) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { orgs } = useOrgSwitcher();
  const create = useCreateGestorSupportTicket();

  const [view, setView] = useState<View>("list");
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [anchorOrgId, setAnchorOrgId] = useState<string>("");

  const boundOrgIds = orgs.map((o) => o.id);

  // Âncora padrão = primeira org vinculada. O Gestor pode trocar no formulário.
  useEffect(() => {
    if (!anchorOrgId && orgs.length > 0) setAnchorOrgId(orgs[0].id);
  }, [orgs, anchorOrgId]);

  const backToList = () => {
    setActiveTicketId(null);
    setView("list");
  };

  // Abrir um thread ativa a org do chamado no contexto — TicketThread,
  // useSupportTicket e o envio de resposta (reutilizados) leem a org do
  // `useOrganization`.
  const openThread = async (ticketId: string, organizationId: string) => {
    setSelectedOrgId(organizationId);
    await queryClient.invalidateQueries({ queryKey: ["team_members"] });
    queryClient.invalidateQueries({ queryKey: ["organization-type"] });
    setActiveTicketId(ticketId);
    setView("thread");
  };

  const captureContext = (organizationId: string) =>
    buildSupportContext({
      pathname: location.pathname,
      search: location.search,
      appVersion: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev",
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      organizationId,
      userId: user?.id ?? null,
      role: "gestor",
      sessionId: getSessionId(),
    });

  const submitTicket = async (draft: TicketDraft) => {
    const ticket = await create.mutateAsync({
      draft,
      organizationId: anchorOrgId,
      boundOrgIds,
      supportContext: { ...captureContext(anchorOrgId) },
    });
    return { id: ticket.id };
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[440px]">
        {view === "compose" ? (
          <>
            <SheetHeader className="border-b border-border/50 px-6 pb-4 pt-6 text-left">
              <SheetTitle className="text-base font-semibold">Abrir chamado</SheetTitle>
              <SheetDescription className="text-xs">
                Escolha a organização e conte o que houve. O suporte da Torque responde por aqui.
              </SheetDescription>
            </SheetHeader>
            <NewTicketForm
              onCreated={(id) => void openThread(id, anchorOrgId)}
              onCancel={backToList}
              submit={submitTicket}
              submitDisabled={!anchorOrgId}
              isSubmitting={create.isPending}
              beforeFields={
                <OrgAnchorField
                  orgs={orgs}
                  value={anchorOrgId}
                  onChange={setAnchorOrgId}
                />
              }
            />
          </>
        ) : view === "thread" && activeTicketId ? (
          <>
            <SheetHeader className="sr-only">
              <SheetTitle>Chamado</SheetTitle>
            </SheetHeader>
            <TicketThread ticketId={activeTicketId} onBack={backToList} />
          </>
        ) : (
          <GestorTicketList
            onSelect={(t) => void openThread(t.id, t.organization_id)}
            onNew={() => setView("compose")}
            canCompose={orgs.length > 0}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function OrgAnchorField({
  orgs,
  value,
  onChange,
}: {
  orgs: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <fieldset className="space-y-2.5">
      <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Organização
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Escolha a organização" />
        </SelectTrigger>
        <SelectContent>
          {orgs.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        O chamado fica ancorado a esta organização vinculada.
      </p>
    </fieldset>
  );
}

function GestorTicketList({
  onSelect,
  onNew,
  canCompose,
}: {
  onSelect: (ticket: GestorSupportTicket) => void;
  onNew: () => void;
  canCompose: boolean;
}) {
  const { data: tickets = [], isLoading } = useGestorSupportTickets();

  return (
    <>
      <SheetHeader className="border-b border-border/50 px-6 pb-4 pt-6 text-left">
        <SheetTitle className="text-base font-semibold">Suporte</SheetTitle>
        <SheetDescription className="text-xs">
          Chamados das suas organizações vinculadas. Abra e acompanhe por aqui.
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : tickets.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-border/40">
            {tickets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onSelect(t)}
                  className="flex w-full items-center gap-3 px-6 py-3.5 text-left transition-colors hover:bg-muted/40"
                >
                  <StatusDot status={t.status} className="mt-1.5 self-start" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-snug text-foreground">
                      {t.title}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {t.organization?.name && (
                        <>
                          <Building2 className="h-3 w-3" aria-hidden />
                          <span className="truncate">{t.organization.name}</span>
                          <span aria-hidden>·</span>
                        </>
                      )}
                      {STATUS_LABELS[t.status]}
                      <span aria-hidden>·</span>
                      {formatDistanceToNow(new Date(t.created_at), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border/50 bg-muted/20 px-6 py-4">
        {!canCompose && (
          <p className="mb-2.5 text-xs text-muted-foreground">
            Vincule ao menos uma organização para abrir um chamado.
          </p>
        )}
        <Button onClick={onNew} disabled={!canCompose} className="w-full gap-2">
          <LifeBuoy className="h-4 w-4" aria-hidden />
          Abrir chamado
        </Button>
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 py-16 text-center">
      <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl border border-border/60 bg-muted/30">
        <LifeBuoy className="h-4 w-4 text-muted-foreground" aria-hidden />
      </div>
      <p className="text-sm font-medium text-foreground">Nenhum chamado por aqui</p>
      <p className="max-w-[28ch] text-xs leading-relaxed text-muted-foreground">
        Abra um chamado quando precisar de ajuda com uma das organizações que você gere.
      </p>
    </div>
  );
}
