import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCampanhas } from "@/modules/campaigns/hooks/useCampanhas";

interface CampaignSelectorFieldProps {
  campaignId: string;
  onSelect: (id: string, name: string) => void;
  label?: string;
  optional?: boolean;
}

export function CampaignSelectorField({
  campaignId,
  onSelect,
  label = "Campanha",
  optional = false,
}: CampaignSelectorFieldProps) {
  const { data: campanhas, isLoading, isError } = useCampanhas();

  const activeCampanhas = (campanhas ?? []).filter((c) => c.is_active);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label>{label}{optional ? " (opcional)" : ""}</Label>
        <p className="text-xs text-muted-foreground">Carregando campanhas...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <p className="text-xs text-destructive">Erro ao carregar campanhas.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label>{label}{optional ? " (opcional)" : ""}</Label>
      {activeCampanhas.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma campanha ativa encontrada.
        </p>
      ) : (
        <Select
          value={campaignId || ""}
          onValueChange={(v) => {
            const selected = activeCampanhas.find((c) => c.id === v);
            onSelect(v, selected?.name || "");
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={optional ? "Qualquer campanha" : "Selecione a campanha"} />
          </SelectTrigger>
          <SelectContent>
            {optional && (
              <SelectItem value="__any__">Qualquer campanha</SelectItem>
            )}
            {activeCampanhas.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
