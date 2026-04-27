/**
 * LeadTabProducts — stub: produtos vinculados ao lead (gerenciamento via /leads).
 *
 * Criado na Onda 3.1, C10. Write completo planejado para Onda 3.2.
 */

import { Package, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LeadTabProductsProps {
  leadId: string;
}

export function LeadTabProducts({ leadId }: LeadTabProductsProps) {
  return (
    <div className="space-y-4">
      <div className="text-center py-6">
        <Package className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">
          Produtos e propostas disponíveis em /leads.
        </p>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => window.open(`/leads?id=${leadId}`, "_blank")}
      >
        <ExternalLink className="w-4 h-4 mr-2" />
        Ver produtos em /leads
      </Button>
    </div>
  );
}
