/**
 * LeadTabTags — stub: gerenciamento de tags (edição via /leads).
 *
 * Criado na Onda 3.1, C10. Write completo planejado para Onda 3.2.
 */

import { Tag, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface LeadTag {
  tag: {
    id: string;
    name: string;
    color: string;
  };
}

interface LeadTabTagsProps {
  leadId: string;
  leadTags?: LeadTag[];
}

export function LeadTabTags({ leadId, leadTags = [] }: LeadTabTagsProps) {
  return (
    <div className="space-y-4">
      {leadTags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {leadTags.map((lt) => (
            <Badge
              key={lt.tag.id}
              variant="outline"
              style={{
                backgroundColor: `${lt.tag.color}20`,
                borderColor: `${lt.tag.color}40`,
                color: lt.tag.color,
              }}
            >
              <Tag className="w-3 h-3 mr-1" />
              {lt.tag.name}
            </Badge>
          ))}
        </div>
      ) : (
        <div className="text-center py-6">
          <Tag className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">Nenhuma tag atribuída.</p>
        </div>
      )}

      <div className="pt-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => window.open(`/leads?id=${leadId}`, "_blank")}
        >
          <ExternalLink className="w-4 h-4 mr-2" />
          Editar tags em /leads
        </Button>
      </div>
    </div>
  );
}
