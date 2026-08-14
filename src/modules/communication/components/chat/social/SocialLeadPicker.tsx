/**
 * SocialLeadPicker — escolhe um lead JÁ existente para vincular à conversa.
 *
 * BUSCA SERVER-SIDE, E ISSO É O PONTO DO COMPONENTE. O padrão vizinho
 * (`CreateOpportunityModal`) carrega uma página de leads e filtra no cliente;
 * com 40.485 leads em produção e página de 50, o lead da página 800 lê como
 * "não existe" — e a saída natural do vendedor é criar um segundo lead para a
 * mesma pessoa. `useLeads({ searchQuery })` empurra o recorte para o Postgres:
 * nome, empresa, e-mail, telefone e `normalized_phone` quando o termo tem
 * dígitos.
 */
import { useState } from "react";
import { Loader2, Search, User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/shared/hooks/useDebounce";
import { useLeads } from "@/modules/leads";

export interface SocialLeadPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sugestão inicial de busca — o nome que o Instagram informou. */
  initialQuery?: string;
  onPick: (leadId: string) => void;
  isSubmitting?: boolean;
  /** Lead sendo confirmado — mantém o feedback na linha clicada. */
  pendingLeadId?: string | null;
}

function leadSubtitle(lead: {
  company?: string | null;
  phone?: string | null;
  email?: string | null;
}): string {
  const parts = [lead.company, lead.phone || lead.email].filter(Boolean) as string[];
  return parts.length ? parts.join(" · ") : "Sem empresa e sem telefone";
}

export function SocialLeadPicker({
  open,
  onOpenChange,
  initialQuery,
  onPick,
  isSubmitting = false,
  pendingLeadId = null,
}: SocialLeadPickerProps) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const debouncedQuery = useDebounce(query, 300);

  const { data: leads = [], isFetching } = useLeads({
    page: 0,
    searchQuery: debouncedQuery.trim() || undefined,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Vincular a lead existente</DialogTitle>
          <DialogDescription>
            A conversa do Instagram passa a fazer parte da ficha desse lead —
            inclusive as mensagens que já chegaram.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, empresa, e-mail ou telefone"
            className="pl-9"
          />
        </div>

        <ScrollArea className="h-[320px] -mx-1 px-1">
          {isFetching && leads.length === 0 ? (
            <div className="flex items-center justify-center h-[280px]">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[280px] gap-1.5 text-center px-6">
              <p className="text-sm text-muted-foreground">
                {debouncedQuery.trim()
                  ? "Nenhum lead encontrado para essa busca."
                  : "Comece a digitar para encontrar o lead."}
              </p>
              <p className="text-xs text-muted-foreground/70">
                Se a pessoa ainda não está no CRM, crie o lead pela conversa.
              </p>
            </div>
          ) : (
            <div className="flex flex-col py-1">
              {leads.map((lead) => {
                const isPending = isSubmitting && pendingLeadId === lead.id;
                return (
                  <button
                    key={lead.id}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => onPick(lead.id)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                      "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSubmitting && !isPending && "opacity-50",
                    )}
                  >
                    <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      {isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <User className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {lead.name || "Sem nome"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {leadSubtitle(lead)}
                      </p>
                    </div>
                    {lead.origin && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 shrink-0">
                        {lead.origin}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
