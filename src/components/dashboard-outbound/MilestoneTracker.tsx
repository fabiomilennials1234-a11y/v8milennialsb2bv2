import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Badge, UserBadge } from "@/modules/engagement/hooks/useBadges";
import { MILESTONE_ICONS } from "./milestone-icons";

interface Props {
  badges: Badge[];
  userBadges: UserBadge[];
}

export function MilestoneTracker({ badges, userBadges }: Props) {
  const unlockedIds = new Set(userBadges.map((ub) => ub.badge_id));
  const milestones = badges.filter((b) => b.criteria_type && b.criteria_value > 0);

  if (milestones.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Marcos do Mês</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhum marco configurado ainda.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Marcos do Mês</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {milestones.map((m) => {
          const achieved = unlockedIds.has(m.id);
          const IconComp = MILESTONE_ICONS[m.icon ?? "target"] ?? MILESTONE_ICONS.target;
          return (
            <div
              key={m.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                achieved ? "bg-primary/10 border-primary/30" : "bg-muted/30 border-border"
              }`}
            >
              <IconComp className={`w-5 h-5 ${achieved ? "text-primary" : "text-muted-foreground"}`} />
              <div className="flex-1">
                <p className={`text-sm font-medium ${achieved ? "text-primary" : ""}`}>{m.name}</p>
                {m.description && <p className="text-xs text-muted-foreground">{m.description}</p>}
              </div>
              {achieved ? (
                <CheckCircle2 className="w-5 h-5 text-primary" />
              ) : (
                <Circle className="w-5 h-5 text-muted-foreground/40" />
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
