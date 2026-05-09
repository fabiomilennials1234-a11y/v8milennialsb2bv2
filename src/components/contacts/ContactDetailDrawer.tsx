import { useState } from "react";
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
  X,
  Sparkles,
  MessageSquare,
  Send,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useContact } from "@/hooks/useContacts";
import { useCompany } from "@/hooks/useCompanies";
import { ActivityTimeline } from "@/components/activities/ActivityTimeline";
import { EmailComposer } from "@/components/email/EmailComposer";
import { SmsSendDialog } from "@/components/sms/SmsSendDialog";
import { AiEmailWriter } from "@/components/ai/AiEmailWriter";
import { useEnrichmentRequests, useRequestEnrichment } from "@/hooks/useEnrichment";
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

// ── Component ─────────────────────────────────────────────────────────

export function ContactDetailDrawer({
  contactId,
  open,
  onOpenChange,
}: ContactDetailDrawerProps) {
  const { data: contact, isLoading } = useContact(contactId);
  const { data: company } = useCompany(contact?.company_id ?? undefined);
  const { data: enrichments = [] } = useEnrichmentRequests({ contactId });
  const requestEnrichment = useRequestEnrichment();
  const [emailComposerOpen, setEmailComposerOpen] = useState(false);
  const [smsDialogOpen, setSmsDialogOpen] = useState(false);
  const [emailWriterOpen, setEmailWriterOpen] = useState(false);

  const latestEnrichment = enrichments[0] ?? null;
  const enrichmentResult = latestEnrichment?.status === "completed" ? latestEnrichment.result : null;

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

            {/* ── Action buttons ─────────────────── */}
            <div className="px-6 pt-3 flex items-center gap-2 shrink-0">
              {contact.email && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setEmailComposerOpen(true)}
                >
                  <Mail className="w-3.5 h-3.5" />
                  Enviar email
                </Button>
              )}
              {contact.phone && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setSmsDialogOpen(true)}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Enviar SMS
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setEmailWriterOpen(true)}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Email com IA
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => requestEnrichment.mutate({ contactId })}
                disabled={requestEnrichment.isPending || latestEnrichment?.status === "pending" || latestEnrichment?.status === "processing"}
              >
                {requestEnrichment.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                Enriquecer
              </Button>
            </div>

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

              </TabsContent>

              {/* ── Tab 2: Atividades ──────────── */}
              <TabsContent value="atividades" className="flex-1 overflow-y-auto p-6 pt-4 m-0">
                <ActivityTimeline contactId={contactId} showCreateForm />
              </TabsContent>
            </Tabs>

            {/* ── Inline Email Composer ─────────── */}
            {emailComposerOpen && contact.email && (
              <div className="px-6 pb-4">
                <EmailComposer
                  defaultTo={contact.email}
                  contactId={contactId}
                  compact
                  onClose={() => setEmailComposerOpen(false)}
                  onSent={() => setEmailComposerOpen(false)}
                />
              </div>
            )}

            {/* ── Enrichment Results ───────────── */}
            {enrichmentResult && (
              <div className="px-6 pb-4">
                <Separator className="mb-4" />
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Dados Enriquecidos
                </h3>
                <div className="space-y-2">
                  {enrichmentResult.headline && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                      <Briefcase className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-sm">{enrichmentResult.headline}</span>
                    </div>
                  )}
                  {enrichmentResult.location && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                      <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-sm">{enrichmentResult.location}</span>
                    </div>
                  )}
                  {enrichmentResult.summary && (
                    <div className="p-3 rounded-lg bg-muted">
                      <p className="text-sm text-muted-foreground">{enrichmentResult.summary}</p>
                    </div>
                  )}
                  {enrichmentResult.linkedin_url && (
                    <a
                      href={enrichmentResult.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-lg bg-muted hover:bg-muted/80 transition-colors group"
                    >
                      <Linkedin className="w-4 h-4 text-[#0A66C2] shrink-0" />
                      <span className="text-sm truncate flex-1">LinkedIn</span>
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {latestEnrichment && (latestEnrichment.status === "pending" || latestEnrichment.status === "processing") && (
              <div className="px-6 pb-4">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border border-dashed">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Enriquecimento em andamento...
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </SheetContent>

      {/* ── SMS Dialog ──────────────────────── */}
      {contact?.phone && (
        <SmsSendDialog
          open={smsDialogOpen}
          onOpenChange={setSmsDialogOpen}
          leadName={contact?.name}
          phoneNumber={contact.phone}
        />
      )}

      <AiEmailWriter
        open={emailWriterOpen}
        onOpenChange={setEmailWriterOpen}
        leadName={contact?.name}
      />
    </Sheet>
  );
}
