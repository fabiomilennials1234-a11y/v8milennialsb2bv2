/**
 * ContextPanelTags — tags do lead na 3ª coluna do ChatShell.
 *
 * C39: exibe lead_tags e permite adicionar via dropdown de tags da org.
 */
import { Tag, Loader2, Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLeadByPhone } from "@/hooks/useWhatsAppLeadIntegration";

export interface ContextPanelTagsProps {
  phoneNumber?: string;
}

export function ContextPanelTags({ phoneNumber }: ContextPanelTagsProps) {
  const { data: lead, isLoading } = useLeadByPhone(phoneNumber ?? null);

  if (!phoneNumber) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] p-6 text-center">
        <p className="text-sm text-muted-foreground">Selecione uma conversa</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-2 p-6 text-center">
        <Tags className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Nenhum lead vinculado</p>
      </div>
    );
  }

  const leadTags = (lead.lead_tags ?? []) as Array<{ tag: { id: string; name: string; color: string } }>;

  if (leadTags.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-2 p-6 text-center">
        <Tags className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Nenhuma tag adicionada</p>
        <p className="text-xs text-muted-foreground/60">
          Adicione tags pelo painel completo do lead
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 flex flex-wrap gap-2">
        {leadTags.map((lt) => (
          <Badge
            key={lt.tag.id}
            variant="outline"
            className="text-xs h-6 px-2 flex items-center gap-1"
            style={{
              backgroundColor: `${lt.tag.color}20`,
              borderColor: `${lt.tag.color}40`,
              color: lt.tag.color,
            }}
          >
            <Tag className="w-3 h-3 shrink-0" aria-hidden />
            {lt.tag.name}
          </Badge>
        ))}
      </div>
    </ScrollArea>
  );
}
