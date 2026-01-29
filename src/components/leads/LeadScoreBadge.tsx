import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, Sparkles, RefreshCw } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useCalculateLeadScore } from "@/hooks/useLeadScore";
import { toast } from "sonner";

interface LeadScoreBadgeProps {
  score: number | null;
  predictedConversion?: number;
  factors?: Record<string, string>;
  recommendedAction?: string | null;
  leadId?: string;
  size?: "sm" | "md" | "lg";
  showDetails?: boolean;
  className?: string;
}

export function LeadScoreBadge({
  score,
  predictedConversion,
  factors,
  recommendedAction,
  leadId,
  size = "md",
  showDetails = false,
  className,
}: LeadScoreBadgeProps) {
  const calculateScore = useCalculateLeadScore();

  if (score === null || score === undefined) {
    if (!leadId) return null;
    
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-6 w-6 rounded-full bg-muted/50",
              className
            )}
            onClick={(e) => {
              e.stopPropagation();
              calculateScore.mutate(leadId, {
                onSuccess: () => toast.success("Score calculado!"),
                onError: () => toast.error("Erro ao calcular score"),
              });
            }}
            disabled={calculateScore.isPending}
          >
            {calculateScore.isPending ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3 text-muted-foreground" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Calcular Score com IA</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-success bg-success/10 border-success/20";
    if (score >= 60) return "text-primary bg-primary/10 border-primary/20";
    if (score >= 40) return "text-warning bg-warning/10 border-warning/20";
    return "text-destructive bg-destructive/10 border-destructive/20";
  };

  const getScoreIcon = (score: number) => {
    if (score >= 70) return <TrendingUp className="h-3 w-3" />;
    if (score >= 40) return <Minus className="h-3 w-3" />;
    return <TrendingDown className="h-3 w-3" />;
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return "Excelente";
    if (score >= 60) return "Bom";
    if (score >= 40) return "Médio";
    return "Baixo";
  };

  const sizeClasses = {
    sm: "h-5 px-1.5 text-xs gap-0.5",
    md: "h-6 px-2 text-xs gap-1",
    lg: "h-7 px-2.5 text-sm gap-1.5",
  };

  const badge = (
    <div
      className={cn(
        "inline-flex items-center rounded-full border font-medium",
        getScoreColor(score),
        sizeClasses[size],
        className
      )}
    >
      {getScoreIcon(score)}
      <span>{score}</span>
    </div>
  );

  if (!showDetails) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium">Score: {score}/100</span>
              <span className={cn("text-xs", getScoreColor(score).split(" ")[0])}>
                {getScoreLabel(score)}
              </span>
            </div>
            {predictedConversion !== undefined && (
              <p className="text-xs text-muted-foreground">
                Chance de conversão: {predictedConversion}%
              </p>
            )}
            {recommendedAction && (
              <p className="text-xs border-t pt-2 mt-2">
                <span className="font-medium">Ação: </span>
                {recommendedAction}
              </p>
            )}
            {factors && Object.keys(factors).length > 0 && (
              <div className="border-t pt-2 mt-2 space-y-1">
                <p className="text-xs font-medium">Fatores:</p>
                {Object.entries(factors).slice(0, 4).map(([key, value]) => (
                  <p key={key} className="text-xs text-muted-foreground">
                    • {key}: {value}
                  </p>
                ))}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  // Detailed view
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {badge}
          <span className="text-sm text-muted-foreground">
            {getScoreLabel(score)}
          </span>
        </div>
        {predictedConversion !== undefined && (
          <span className="text-sm">
            <span className="text-muted-foreground">Conversão: </span>
            <span className="font-medium">{predictedConversion}%</span>
          </span>
        )}
      </div>

      {recommendedAction && (
        <div className="p-2 rounded-lg bg-primary/5 border border-primary/10">
          <p className="text-xs font-medium text-primary mb-1">Próxima ação recomendada:</p>
          <p className="text-sm">{recommendedAction}</p>
        </div>
      )}

      {factors && Object.keys(factors).length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Fatores de análise:</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(factors).map(([key, value]) => (
              <span
                key={key}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs"
              >
                <span className="font-medium">{key}:</span>
                <span className="text-muted-foreground">{value}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {leadId && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            calculateScore.mutate(leadId, {
              onSuccess: () => toast.success("Score recalculado!"),
              onError: () => toast.error("Erro ao recalcular score"),
            });
          }}
          disabled={calculateScore.isPending}
        >
          {calculateScore.isPending ? (
            <>
              <RefreshCw className="h-3 w-3 mr-2 animate-spin" />
              Calculando...
            </>
          ) : (
            <>
              <RefreshCw className="h-3 w-3 mr-2" />
              Recalcular Score
            </>
          )}
        </Button>
      )}
    </div>
  );
}
