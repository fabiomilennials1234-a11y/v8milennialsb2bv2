import { useMemo } from "react";
import {
  Building2,
  Globe,
  Phone,
  Mail,
  MapPin,
  Users,
  ExternalLink,
  DollarSign,
  Loader2,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCompany, useCompanyContacts } from "@/hooks/useCompanies";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface CompanyDetailDrawerProps {
  companyId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(value: number | null | undefined) {
  if (!value) return "R$ 0";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
  }).format(value);
}

function healthColor(score: number | null | undefined) {
  if (!score) return { text: "text-muted-foreground", bg: "bg-muted" };
  if (score >= 70) return { text: "text-emerald-500", bg: "bg-emerald-500" };
  if (score >= 40) return { text: "text-amber-500", bg: "bg-amber-500" };
  return { text: "text-red-500", bg: "bg-red-500" };
}

function initials(name: string | undefined) {
  return (name || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// ── Component ────────────────────────────────────────────────────────────────

export function CompanyDetailDrawer({
  companyId,
  open,
  onOpenChange,
}: CompanyDetailDrawerProps) {
  const { data: company, isLoading } = useCompany(open ? companyId : undefined);
  const { data: contacts = [] } = useCompanyContacts(open ? companyId : undefined);
  const hc = useMemo(() => healthColor(company?.health_score), [company?.health_score]);

  if (!open) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg p-0 flex flex-col">
        {isLoading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !company ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Empresa nao encontrada.</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <SheetHeader className="p-6 pb-4 border-b border-border shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Building2 className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <SheetTitle className="text-lg font-bold truncate">
                    {company.name}
                  </SheetTitle>
                  <SheetDescription className="text-sm text-muted-foreground truncate">
                    {company.industry || "Sem segmento"}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            {/* Tabs */}
            <Tabs defaultValue="detalhes" className="flex-1 flex flex-col min-h-0">
              <div className="px-6 pt-3 shrink-0">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
                  <TabsTrigger value="contatos">Contatos</TabsTrigger>
                  <TabsTrigger value="atividades">Atividades</TabsTrigger>
                </TabsList>
              </div>

              <ScrollArea className="flex-1 min-h-0">
                {/* Tab 1: Detalhes */}
                <TabsContent value="detalhes" className="p-6 pt-4 m-0 space-y-6">
                  {/* Info grid */}
                  <div className="space-y-3">
                    {company.website && (
                      <InfoRow
                        icon={Globe}
                        label="Website"
                        value={
                          <a
                            href={company.website.startsWith("http") ? company.website : `https://${company.website}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1 truncate"
                          >
                            {company.website.replace(/^https?:\/\//, "")}
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        }
                      />
                    )}
                    {company.phone && <InfoRow icon={Phone} label="Telefone" value={company.phone} />}
                    {company.email && <InfoRow icon={Mail} label="Email" value={company.email} />}
                    {company.size_range && <InfoRow icon={Users} label="Porte" value={company.size_range} />}
                    {company.revenue_range && <InfoRow icon={DollarSign} label="Faturamento" value={company.revenue_range} />}
                    {(company.address || company.city || company.state) && (
                      <InfoRow
                        icon={MapPin}
                        label="Endereco"
                        value={[company.address, company.city, company.state].filter(Boolean).join(", ")}
                      />
                    )}
                  </div>

                  {/* Health score */}
                  {company.health_score != null && (
                    <div className="space-y-2">
                      <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                        Health Score
                      </h3>
                      <div className="flex items-center gap-3">
                        <div className="relative flex-1 h-2 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={cn("h-full transition-all rounded-full", hc.bg)}
                            style={{ width: `${company.health_score}%` }}
                          />
                        </div>
                        <span className={cn("text-sm font-semibold tabular-nums", hc.text)}>
                          {company.health_score}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  {company.notes && (
                    <div className="space-y-2">
                      <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                        Observacoes
                      </h3>
                      <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                        {company.notes}
                      </p>
                    </div>
                  )}

                </TabsContent>

                {/* Tab 2: Contatos */}
                <TabsContent value="contatos" className="p-6 pt-4 m-0">
                  {contacts.length === 0 ? (
                    <div className="text-center py-12">
                      <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">
                        Nenhum contato vinculado.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {contacts.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border/50"
                        >
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                            <span className="text-xs font-bold text-primary">
                              {initials(c.name)}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <p className="text-sm font-medium truncate">{c.name}</p>
                            {c.job_title && (
                              <p className="text-xs text-muted-foreground truncate">
                                {c.job_title}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                              {c.email && (
                                <span className="inline-flex items-center gap-1">
                                  <Mail className="w-3 h-3" />
                                  {c.email}
                                </span>
                              )}
                              {c.phone && (
                                <span className="inline-flex items-center gap-1">
                                  <Phone className="w-3 h-3" />
                                  {c.phone}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Tab 3: Atividades */}
                <TabsContent value="atividades" className="p-6 pt-4 m-0">
                  <div className="text-center py-12">
                    <Loader2 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      Timeline de atividades sera integrada com ActivityTimeline.
                    </p>
                  </div>
                </TabsContent>
              </ScrollArea>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── InfoRow helper ───────────────────────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm font-medium truncate">{value}</div>
      </div>
    </div>
  );
}
