/**
 * CompetitorMentions — recent mentions detected in conversations.
 * Consumes useCompetitorMentions.
 */

import { motion } from "framer-motion";
import { MessageSquare, Calendar, Quote } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompetitorMentions, type CompetitorMention } from "@/hooks/useCompetitors";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

// ── Types ─────────────────────────────────────────────────────

interface CompetitorMentionsProps {
  competitorId: string | null;
  competitorName?: string;
}

// ── Component ─────────────────────────────────────────────────

export function CompetitorMentions({ competitorId, competitorName }: CompetitorMentionsProps) {
  const { data: mentions = [], isLoading } = useCompetitorMentions(competitorId);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Quote className="w-4 h-4 text-primary" />
            Mencoes recentes
            {competitorName && (
              <Badge variant="outline" className="text-xs font-normal ml-1">
                {competitorName}
              </Badge>
            )}
          </span>
          <Badge variant="outline" className="text-xs font-normal">
            {mentions.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {mentions.length === 0 ? (
          <div className="text-center py-6">
            <MessageSquare className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Nenhuma mencao detectada.
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {mentions.map((mention, idx) => (
              <motion.div
                key={mention.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                className="p-3 rounded-lg bg-muted/50 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {mention.matched_keyword}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {formatDistanceToNow(new Date(mention.detected_at), {
                      addSuffix: true,
                      locale: ptBR,
                    })}
                  </span>
                </div>
                {mention.snippet && (
                  <p className="text-xs text-muted-foreground italic line-clamp-2">
                    &ldquo;{mention.snippet}&rdquo;
                  </p>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
