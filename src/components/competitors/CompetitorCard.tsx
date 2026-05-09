/**
 * CompetitorCard — card displaying competitor info with win rate.
 */

import {
  Globe,
  TrendingUp,
  TrendingDown,
  Swords,
  Edit2,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Competitor } from "@/hooks/useCompetitors";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────

interface CompetitorCardProps {
  competitor: Competitor;
  onEdit: (competitor: Competitor) => void;
  winRate?: number;
}

// ── Component ─────────────────────────────────────────────────

export function CompetitorCard({ competitor, onEdit, winRate }: CompetitorCardProps) {
  const displayWinRate = winRate ?? competitor.win_rate_vs;
  const hasWinRate = displayWinRate != null;
  const isWinning = hasWinRate && displayWinRate > 50;

  return (
    <Card className="hover:border-primary/30 transition-colors group">
      <CardContent className="pt-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Swords className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{competitor.name}</p>
              {competitor.aliases.length > 0 && (
                <p className="text-[10px] text-muted-foreground truncate">
                  aka {competitor.aliases.join(", ")}
                </p>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onEdit(competitor)}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* Win rate */}
        {hasWinRate && (
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/50">
            {isWinning ? (
              <TrendingUp className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-500 shrink-0" />
            )}
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">Win rate</span>
                <span className={cn("text-sm font-bold", isWinning ? "text-emerald-500" : "text-red-500")}>
                  {Math.round(displayWinRate!)}%
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", isWinning ? "bg-emerald-500" : "bg-red-500")}
                  style={{ width: `${Math.min(displayWinRate!, 100)}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Encounters */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{competitor.total_encounters} encontro{competitor.total_encounters !== 1 ? "s" : ""}</span>
          <span>{competitor.total_wins} vitoria{competitor.total_wins !== 1 ? "s" : ""}</span>
        </div>

        {/* Strengths / Weaknesses preview */}
        <div className="flex flex-wrap gap-1">
          {competitor.strengths.slice(0, 2).map((s, i) => (
            <Badge key={`s-${i}`} variant="outline" className="text-[10px] bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
              + {s}
            </Badge>
          ))}
          {competitor.weaknesses.slice(0, 2).map((w, i) => (
            <Badge key={`w-${i}`} variant="outline" className="text-[10px] bg-red-500/5 text-red-600 dark:text-red-400 border-red-500/20">
              - {w}
            </Badge>
          ))}
        </div>

        {/* Website link */}
        {competitor.website && (
          <a
            href={competitor.website}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <Globe className="w-3 h-3" />
            <span className="truncate">{competitor.website.replace(/^https?:\/\//, "")}</span>
            <ExternalLink className="w-3 h-3 shrink-0" />
          </a>
        )}

        {/* Battlecard preview */}
        {competitor.battlecard_md && (
          <div className="text-[10px] text-muted-foreground line-clamp-2 italic border-l-2 border-primary/20 pl-2">
            {competitor.battlecard_md.slice(0, 120)}...
          </div>
        )}
      </CardContent>
    </Card>
  );
}
