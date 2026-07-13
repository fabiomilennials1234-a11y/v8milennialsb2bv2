/**
 * LeadSource — exibe a origem e detalhe de origem do lead (read-only).
 *
 * Criado na Onda 3.1, C3.
 */

import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useLeadOrigins } from "../../../hooks/useLeadOrigins";

interface LeadSourceProps {
  origin?: string | null;
  originDetail?: string | null;
}

export function LeadSource({ origin, originDetail }: LeadSourceProps) {
  const { labelOf } = useLeadOrigins();
  if (!origin) return null;

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Origem</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="text-xs">
          {labelOf(origin)}
        </Badge>
        {originDetail && (
          <span className="text-xs text-muted-foreground">{originDetail}</span>
        )}
      </div>
    </div>
  );
}
