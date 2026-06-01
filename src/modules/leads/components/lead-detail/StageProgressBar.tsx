import { cn } from "@/lib/utils";

interface StageProgressBarProps {
  stages: { id: string; name: string }[];
  currentStageId: string | null;
}

export function StageProgressBar({ stages, currentStageId }: StageProgressBarProps) {
  if (stages.length === 0) return null;

  const currentIndex = stages.findIndex((s) => s.id === currentStageId);

  return (
    <div className="flex gap-[2px] mt-1.5" title={stages[currentIndex]?.name}>
      {stages.map((stage, i) => (
        <div
          key={stage.id}
          className={cn(
            "flex-1 h-[3px] rounded-full transition-colors",
            i < currentIndex
              ? "bg-emerald-500"
              : i === currentIndex
              ? "bg-amber-500"
              : "bg-muted-foreground/10"
          )}
        />
      ))}
    </div>
  );
}
