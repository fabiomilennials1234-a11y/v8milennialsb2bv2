import { Button } from "@/components/ui/button";
import { type PipelineSelectorType } from "@/modules/analytics/hooks/useAnalyticsPipesFunis";

interface PipelineSelectorOption {
  label: string;
  value: PipelineSelectorType;
}

const OPTIONS: PipelineSelectorOption[] = [
  { label: "Todos", value: null },
  { label: "Qualificação", value: "whatsapp" },
  { label: "Confirmação", value: "confirmacao" },
  { label: "Propostas", value: "propostas" },
];

interface Props {
  selected: PipelineSelectorType;
  onChange: (value: PipelineSelectorType) => void;
}

export function PipelineSelector({ selected, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {OPTIONS.map((opt) => {
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
