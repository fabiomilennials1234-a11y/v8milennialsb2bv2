import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCampanhaStages } from "@/hooks/useCampanhas";

interface CampaignStageSelectorFieldProps {
  campanhaId: string;
  stageId: string;
  onSelect: (id: string, name: string) => void;
}

export function CampaignStageSelectorField({
  campanhaId,
  stageId,
  onSelect,
}: CampaignStageSelectorFieldProps) {
  const { data: stages, isLoading } = useCampanhaStages(campanhaId || undefined);

  if (!campanhaId) return null;

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label>Estágio da Campanha</Label>
        <p className="text-xs text-muted-foreground">Carregando estágios...</p>
      </div>
    );
  }

  const stageList = stages ?? [];

  return (
    <div className="space-y-2">
      <Label>Estágio da Campanha</Label>
      {stageList.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum estágio encontrado nesta campanha.
        </p>
      ) : (
        <Select
          value={stageId || ""}
          onValueChange={(v) => {
            const selected = stageList.find((s) => s.id === v);
            onSelect(v, selected?.name || "");
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione o estágio" />
          </SelectTrigger>
          <SelectContent>
            {stageList.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: s.color || "#888" }}
                  />
                  {s.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
