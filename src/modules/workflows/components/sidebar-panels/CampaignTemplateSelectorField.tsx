import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCampanhaTemplates } from "@/modules/campaigns/hooks/useCampaignTemplates";

const TYPE_LABELS: Record<string, string> = {
  text: "Texto",
  audio: "Áudio",
  image: "Imagem",
  document: "Documento",
};

interface CampaignTemplateSelectorFieldProps {
  campanhaId: string;
  templateId: string;
  onSelect: (id: string, name: string) => void;
}

export function CampaignTemplateSelectorField({
  campanhaId,
  templateId,
  onSelect,
}: CampaignTemplateSelectorFieldProps) {
  const { data: campanhaTemplates, isLoading } = useCampanhaTemplates(campanhaId || undefined);

  if (!campanhaId) return null;

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label>Template da Campanha</Label>
        <p className="text-xs text-muted-foreground">Carregando templates...</p>
      </div>
    );
  }

  const templates = (campanhaTemplates ?? []).filter((ct) => ct.template);

  return (
    <div className="space-y-2">
      <Label>Template da Campanha</Label>
      {templates.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum template vinculado a esta campanha.
        </p>
      ) : (
        <Select
          value={templateId || ""}
          onValueChange={(v) => {
            const selected = templates.find((ct) => ct.template!.id === v);
            onSelect(v, selected?.template?.name || "");
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione o template" />
          </SelectTrigger>
          <SelectContent>
            {templates.map((ct) => (
              <SelectItem key={ct.template!.id} value={ct.template!.id}>
                <span className="flex items-center gap-2">
                  {ct.template!.name}
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    {TYPE_LABELS[ct.template!.message_type || "text"] || "Texto"}
                  </Badge>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
