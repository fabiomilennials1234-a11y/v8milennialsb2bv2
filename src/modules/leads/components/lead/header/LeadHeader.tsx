/**
 * LeadHeader — cabeçalho do painel de lead com avatar, nome, telefone e badge de status.
 *
 * C38: extraído de LeadDetailContent para modularização.
 * Usado quando showHeader=true (LeadContactModal).
 */
import { User, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface LeadHeaderProps {
  name: string;
  phoneNumber: string;
  hasLead: boolean;
}

export function LeadHeader({ name, phoneNumber, hasLead }: LeadHeaderProps) {
  return (
    <div className="pb-4 border-b border-border/60 mb-4 px-6 pt-6">
      <div className="flex items-center gap-2">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <User className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{name}</span>
            {hasLead && (
              <Badge variant="secondary" className="text-xs shrink-0">
                Lead
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
            <Phone className="w-3 h-3 shrink-0" />
            {phoneNumber}
          </p>
        </div>
      </div>
    </div>
  );
}
