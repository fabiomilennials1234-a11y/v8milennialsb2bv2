import { memo } from "react";
import { Building2, Phone, Clock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { LeadAvatar } from "./LeadAvatar";
import { useLeadAge } from "../../hooks/useLeadAge";
import { toast } from "sonner";
import type { QualificationTier } from "../types";
import { erpLabel } from "@/shared/format/erp-code";

interface LeadIdentityBlockProps {
  lead: {
    name?: string | null;
    /** Código do cliente no ERP — prefixa o título, nunca a inicial do avatar. */
    erp_code?: string | null;
    company?: string | null;
    phone?: string | null;
    avatar_url?: string | null;
    created_at?: string | null;
    pre_qualification_tier?: QualificationTier | null;
    qualification_tier?: QualificationTier | null;
  };
}

function formatPhoneBR(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

export const LeadIdentityBlock = memo(function LeadIdentityBlock({ lead }: LeadIdentityBlockProps) {
  const age = useLeadAge(lead.created_at);
  const phoneFormatted = formatPhoneBR(lead.phone);

  const copyPhone = async () => {
    if (!lead.phone) return;
    try {
      await navigator.clipboard.writeText(lead.phone);
      toast.success("Telefone copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  return (
    <div className="flex items-center gap-4 min-w-0 flex-1">
      <LeadAvatar
        avatarUrl={lead.avatar_url}
        name={lead.name}
        size={56}
        preQualTier={lead.pre_qualification_tier ?? null}
        qualTier={lead.qualification_tier ?? null}
      />
      <div className="min-w-0 flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight truncate" title={erpLabel(lead)}>
          {lead.erp_code && (
            <span className="font-normal text-muted-foreground">{lead.erp_code} - </span>
          )}
          {lead.name || "Sem nome"}
        </h2>
        {lead.company && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground min-w-0">
            <Building2 className="w-3.5 h-3.5 shrink-0 opacity-60" />
            <span className="truncate">{lead.company}</span>
          </div>
        )}
        {phoneFormatted && (
          <button
            type="button"
            onClick={copyPhone}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/80 font-mono hover:text-foreground transition-colors w-fit"
            title="Clique para copiar"
          >
            <Phone className="w-3 h-3 shrink-0 opacity-60" />
            <span>{phoneFormatted}</span>
          </button>
        )}
        {lead.created_at && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 w-fit">
                  <Clock className="w-3 h-3 shrink-0" />
                  <span>{age.relative}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Criado em {age.absolute}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  );
});
