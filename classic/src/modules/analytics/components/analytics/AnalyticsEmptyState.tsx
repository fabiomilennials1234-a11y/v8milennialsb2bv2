import { BarChart3 } from "lucide-react";

interface AnalyticsEmptyStateProps {
  message: string;
  detail?: string;
}

export function AnalyticsEmptyState({ message, detail }: AnalyticsEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <BarChart3 className="h-8 w-8 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-muted-foreground">{message}</p>
      {detail && <p className="text-xs text-muted-foreground/60 mt-1">{detail}</p>}
    </div>
  );
}
