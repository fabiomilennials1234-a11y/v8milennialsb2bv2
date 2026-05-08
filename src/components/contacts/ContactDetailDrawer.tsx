import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  User,
  Phone,
  Mail,
  Briefcase,
  Building2,
  Linkedin,
  ExternalLink,
  Loader2,
  Calendar,
  DollarSign,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useContact, useContactDeals } from "@/hooks/useContacts";
import { useCompany } from "@/hooks/useCompanies";
import { ActivityTimeline } from "@/components/activities/ActivityTimeline";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────

interface ContactDetailDrawerProps {
  contactId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────

const initials = (name: string | undefined) =>
  (name || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const fmtBRL = (value: number | null | undefined) => {
  if (!value && value !== 0) return "R$ 0";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
  }).format(value);
};

const DEAL_STATUS_MAP: Record<string, { label: string; className: string }> = {
  open: { label: "Aberto", className: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  won: { label: "Ganho", className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  lost: { label: "Perdido", className: "bg-red-500/10 text-red-500 border-red-500/20" },
};

// ── Component ─────────────────────────────────────────────────────────

export function ContactDetailDrawer({
  contactId,
  open,
  onOpenChange,
}: ContactDetailDrawerProps) {
  const { data: contact, isLoading } = useContact(contactId);
  const { data: deals = [] } = useContactDeals(contactId);
  const { data: company } = useCompany(contact?.company_id ?? undefined);

  if (!open) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg p-0 flex flex-col">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !contact ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Contato nao encontrado.</p>
          </div>
        ) : (
          <>
            {/* ── Header ─────────────────────────── */}
            <SheetHeader className="p-6 pb-4 border-b border-border shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-xl font-bold text-primary">
                    {initials(contact.name)}
                  </span>
                </div>
                <div className="min-w-0">
                  <SheetTitle className="text-xl font-bold truncate">
                    {contact.name}
                  </SheetTitle>
                  {contact.job_title && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <Briefcase className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{contact.job_title}</span>
                    </p>
                  )}
                </div>
              </div>
            </SheetHeader>

            {/* ── Tabs ───────────────────────────── */}
            <Tabs defaultValue="detalhes" className="flex-1 flex flex-col min-h-0">
              <div className="px-6 pt-3 shrink-0">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
                  <TabsTrigger value="atividades">Atividades</TabsTrigger>
                </TabsList>
              </div>

              {/* ── Tab 1: Detalhes ────────────── */}
              <TabsContent value="detalhes" className="flex-1 overflow-y-auto p-6 pt-4 m-0 space-y-6">
                {/* Info cards */}
                <div className="space-y-3">
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="flex items-center gap-3 p-3 rounded-lg bg-muted hover:bg-muted/80 transition-colors group"
                    >
                      <Mail className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                      <span className="text-sm truncate">{contact.email}</span>
                    </a>
                  )}

                  {contact.phone && (
                    <a
                      href={`tel:${contact.phone.replace(/\D/g, "")}`}
                      className="flex items-center gap-3 p-3 rounded-lg bg-muted hover:bg-muted/80 transition-colors group"
                    >
                      <Phone className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                      <span className="text-sm">{contact.phone}</span>
                    </a>
                  )}

                  {contact.linkedin_url && (
                    <a
                      href={contact.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-lg bg-muted hover:bg-muted/80 transition-colors group"
                    >
                      <Linkedin className="w-4 h-4 text-muted-foreground group-hover:text-[#0A66C2] transition-colors shrink-0" />
                      <span className="text-sm truncate flex-1">LinkedIn</span>
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    </a>
                  )}

                  {company && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                      <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate">{company.name}</span>
                    </div>
                  )}

                  {contact.source && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                      <User className="w-4 h-4 text-muted-foreground shrink-0" />
                      <Badge variant="outline" className="text-xs">
                        {contact.source}
                      </Badge>
                    </div>
                  )}

                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                    <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-muted-foreground">
                      Criado{" "}
                      {formatDistanceToNow(new Date(contact.created_at), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </span>
                  </div>
                </div>

                {/* Deals */}
                <Separator />
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
                    Negocios ({deals.length})
                  </h3>

                  {deals.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">
                      Nenhum negocio vinculado.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {deals.map((deal: any) => {
                        const status = DEAL_STATUS_MAP[deal.status] ?? DEAL_STATUS_MAP.open;
                        return (
                          <div
                            key={deal.id}
                            className="flex items-center gap-3 p-3 rounded-lg bg-muted"
                          >
                            <DollarSign className="w-4 h-4 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {deal.title || "Sem titulo"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {fmtBRL(deal.value)}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className={cn("text-xs shrink-0", status.className)}
                            >
                              {status.label}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* ── Tab 2: Atividades ──────────── */}
              <TabsContent value="atividades" className="flex-1 overflow-y-auto p-6 pt-4 m-0">
                <ActivityTimeline contactId={contactId} showCreateForm />
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
