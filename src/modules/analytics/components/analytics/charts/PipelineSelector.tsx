import { Button } from "@/components/ui/button";
import { type PipelineSelectorType } from "@/modules/analytics/hooks/useAnalyticsPipesFunis";
import { useAnalyticsPipelineOptions } from "@/modules/analytics/hooks/useAnalyticsPipelineOptions";

interface Props {
  selected: PipelineSelectorType;
  onChange: (value: PipelineSelectorType) => void;
}

/**
 * Seletor de funil da seção Pipeline (SCRUM-631): lista os funis REAIS e
 * ativos da org (custom incluído) no lugar da lista fixa de 3 slugs de
 * sistema. Valor = pipeline_id; null = "Todos".
 */
export function PipelineSelector({ selected, onChange }: Props) {
  const { options } = useAnalyticsPipelineOptions();

  const pills: { label: string; value: PipelineSelectorType }[] = [
    { label: "Todos", value: null },
    ...options.map((opt) => ({ label: opt.name, value: opt.id as PipelineSelectorType })),
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {pills.map((opt) => {
        const isActive = selected === opt.value;
        return (
          <Button
            key={String(opt.value)}
            variant={isActive ? "default" : "outline"}
            size="sm"
            onClick={() => onChange(opt.value)}
            className={
              isActive
                ? "rounded-full px-4 text-xs font-medium"
                : "rounded-full px-4 text-xs font-medium text-muted-foreground"
            }
          >
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
}
