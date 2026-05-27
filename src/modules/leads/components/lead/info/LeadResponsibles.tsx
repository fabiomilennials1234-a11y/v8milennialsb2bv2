/**
 * LeadResponsibles — exibe SDR, Closer e Responsável do lead (read-only).
 *
 * Criado na Onda 3.1, C2. Exibição informativa; edição permanece em /leads.
 */

import { User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

interface Responsible {
  id: string;
  name: string;
}

interface LeadResponsiblesProps {
  responsible?: Responsible | null;
  sdr?: Responsible | null;
  closer?: Responsible | null;
}

export function LeadResponsibles({ responsible, sdr, closer }: LeadResponsiblesProps) {
  const hasAny = responsible || sdr || closer;

  if (!hasAny) return null;

  return (
    <div className="space-y-2">
      <Label>Responsáveis</Label>
      <div className="flex flex-wrap gap-2">
        {responsible && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Responsável:</span>
            <Badge variant="secondary" className="text-xs">
              <User className="w-3 h-3 mr-1" />
              {responsible.name}
            </Badge>
          </div>
        )}
        {sdr && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">SDR:</span>
            <Badge variant="secondary" className="text-xs">
              <User className="w-3 h-3 mr-1" />
              {sdr.name}
            </Badge>
          </div>
        )}
        {closer && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Closer:</span>
            <Badge variant="secondary" className="text-xs">
              <User className="w-3 h-3 mr-1" />
              {closer.name}
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}
