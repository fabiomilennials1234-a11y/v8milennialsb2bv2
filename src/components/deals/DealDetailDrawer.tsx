import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Handshake,
  Clock,
  CheckCircle2,
  XCircle,
  Building2,
  User,
  Mail,
  Phone,
  Calendar,
  TrendingUp,
  DollarSign,
  FileText,
  Users,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDeal, useDealContacts } from "@/hooks/useDeals";
import { useCompany } from "@/hooks/useCompanies";
import { supabase } from "@/integrations/supabase/client";
import { ActivityTimeline } from "@/components/activities/ActivityTimeline";
import { DealInsightsCard } from "@/components/deals/DealInsightsCard";
import { DealItemsEditor } from "@/components/deals/DealItemsEditor";
import { QuoteBuilder } from "@/components/deals/QuoteBuilder";

// ── Types ─────────────────────────────────────────────────────────────

interface DealDetailDrawerProps {
  dealId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ContactDetail {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  decision_maker: "Decisor",
  influencer: "Influenciador",
  champion: "Campeao",
  user: "Usuario",
  blocker: "Bloqueador",
  participant: "Participante",
  contact: "Contato",
};

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

// ── Component ─────────────────────────────────────────────────────────

export function DealDetailDrawer({ dealId, open, onOpenChange }: DealDetailDrawerProps) {
  const { data: deal, isLoading: dealLoading } = useDeal(dealId);
  const { data: dealContacts } = useDealContacts(dealId);
  const { data: company } = useCompany(deal?.company_id ?? undefined);

  const contactIds = useMemo(
    () => dealContacts?.map((dc) => dc.contact_id) ?? [],
    [dealContacts],
  );

  const { data: contactDetails } = useQuery({
    queryKey: ["deal_contact_details", dealId],
    queryFn: async () => {
      if (!contactIds.length) return [] as ContactDetail[];
      const { data } = await (supabase.from as any)("contacts")
        .select("id, name, email, phone, job_title")
        .in("id", contactIds);
      return (data ?? []) as ContactDetail[];
    },
    enabled: contactIds.length > 0,
  });

  const contactMap = useMemo(() => {
    const map = new Map<string, ContactDetail>();
    contactDetails?.forEach((c) => map.set(c.id, c));
    return map;
  }, [contactDetails]);

  // ── Status derivation ───────────────────────────────────────────────

  const status = deal?.won === true
    ? { label: "Ganho", icon: CheckCircle2, variant: "default" as const, className: "bg-emerald-600/20 text-emerald-400 border-emerald-600/30" }
    : deal?.won === false
      ? { label: "Perdido", icon: XCircle, variant: "default" as const, className: "bg-red-600/20 text-red-400 border-red-600/30" }
      : { label: "Aberto", icon: Clock, variant: "outline" as const, className: "border-muted-foreground/30 text-muted-foreground" };

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg p-0 flex flex-col">
        {dealLoading || !deal ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <>
            {/* Header */}
            <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/50">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Handshake className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-xl font-semibold truncate">
                    {deal.title}
                  </SheetTitle>
                  <SheetDescription className="flex items-center gap-2 mt-1">
                    <Badge variant={status.variant} className={status.className}>
                      <status.icon className="h-3 w-3 mr-1" />
                      {status.label}
                    </Badge>
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            {/* Tabs */}
            <Tabs defaultValue="detalhes" className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="mx-6 mt-3 w-auto justify-start bg-muted/50 flex-wrap">
                <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
                <TabsTrigger value="itens">Itens</TabsTrigger>
                <TabsTrigger value="propostas">Propostas</TabsTrigger>
                <TabsTrigger value="insights">Insights</TabsTrigger>
                <TabsTrigger value="atividades">Atividades</TabsTrigger>
              </TabsList>

              {/* Tab: Detalhes */}
              <TabsContent value="detalhes" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-full">
                  <div className="px-6 py-4 space-y-5">
                    {/* Key metrics */}
                    <div className="grid grid-cols-3 gap-3">
                      <MetricCard
                        icon={DollarSign}
                        label="Valor"
                        value={deal.value != null ? formatBRL(deal.value) : "--"}
                      />
                      <MetricCard
                        icon={TrendingUp}
                        label="Probabilidade"
                        value={deal.probability != null ? `${deal.probability}%` : "--"}
                      />
                      <MetricCard
                        icon={Calendar}
                        label="Fechamento"
                        value={deal.expected_close_date ? formatDate(deal.expected_close_date) : "--"}
                      />
                    </div>

                    <Separator />

                    {/* Info rows */}
                    <div className="space-y-3">
                      {company && (
                        <InfoRow icon={Building2} label="Empresa" value={company.name} />
                      )}
                      {deal.owner_id && (
                        <InfoRow icon={User} label="Responsavel" value={deal.owner_id} />
                      )}
                      {deal.won === false && deal.loss_reason && (
                        <InfoRow icon={XCircle} label="Motivo da perda" value={deal.loss_reason} />
                      )}
                      {deal.closed_at && (
                        <InfoRow icon={Calendar} label="Fechado em" value={formatDate(deal.closed_at)} />
                      )}
                    </div>

                    {/* Notes */}
                    {deal.notes && (
                      <>
                        <Separator />
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                            <FileText className="h-4 w-4" />
                            Notas
                          </div>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">
                            {deal.notes}
                          </p>
                        </div>
                      </>
                    )}

                    {/* Contacts */}
                    <Separator />
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Users className="h-4 w-4" />
                        Contatos ({dealContacts?.length ?? 0})
                      </div>

                      {!dealContacts?.length ? (
                        <p className="text-sm text-muted-foreground/60">Nenhum contato vinculado.</p>
                      ) : (
                        <div className="space-y-2">
                          {dealContacts.map((dc) => {
                            const detail = contactMap.get(dc.contact_id);
                            return (
                              <div
                                key={dc.id}
                                className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-1"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-medium">
                                    {detail?.name ?? dc.contact_id}
                                  </span>
                                  <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                                    {ROLE_LABELS[dc.role] ?? dc.role}
                                  </Badge>
                                </div>
                                {detail?.job_title && (
                                  <p className="text-xs text-muted-foreground">{detail.job_title}</p>
                                )}
                                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                  {detail?.email && (
                                    <span className="flex items-center gap-1">
                                      <Mail className="h-3 w-3" />
                                      {detail.email}
                                    </span>
                                  )}
                                  {detail?.phone && (
                                    <span className="flex items-center gap-1">
                                      <Phone className="h-3 w-3" />
                                      {detail.phone}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* Tab: Itens */}
              <TabsContent value="itens" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-full">
                  <div className="px-6 py-4">
                    {dealId && <DealItemsEditor dealId={dealId} />}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* Tab: Propostas */}
              <TabsContent value="propostas" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-full">
                  <div className="px-6 py-4">
                    {dealId && (
                      <QuoteBuilder dealId={dealId} dealTitle={deal.title} />
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* Tab: Insights */}
              <TabsContent value="insights" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-full">
                  <div className="px-6 py-4">
                    <DealInsightsCard dealId={dealId ?? null} />
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* Tab: Atividades */}
              <TabsContent value="atividades" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-full">
                  <div className="px-6 py-4">
                    {dealId && <ActivityTimeline dealId={dealId} showCreateForm />}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-center space-y-1">
      <Icon className="h-4 w-4 mx-auto text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold truncate">{value}</p>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-sm text-muted-foreground w-32 shrink-0">{label}</span>
      <span className="text-sm font-medium truncate">{value}</span>
    </div>
  );
}
