import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Badge, UserBadge } from "@/modules/engagement/hooks/useBadges";
import { MILESTONE_ICONS } from "./milestone-icons";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  badges: Badge[];
  userBadges: UserBadge[];
}

export function BadgeGrid({ badges, userBadges }: Props) {
  const unlockedMap = new Map(userBadges.map((ub) => [ub.badge_id, ub.unlocked_at]));

  if (badges.length === 0) return null;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Badges</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {badges.map((badge) => {
            const unlocked = unlockedMap.has(badge.id);
            const unlockedAt = unlockedMap.get(badge.id);
            const IconComp = MILESTONE_ICONS[badge.icon ?? "target"] ?? MILESTONE_ICONS.target;
            return (
              <div
                key={badge.id}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-center transition-all ${
                  unlocked ? "bg-primary/5 border-primary/30" : "opacity-40 grayscale"
                }`}
                title={unlocked && unlockedAt ? `Conquistado em ${format(new Date(unlockedAt), "dd/MM/yyyy", { locale: ptBR })}` : "Ainda não conquistado"}
              >
                <IconComp className={`w-8 h-8 ${unlocked ? "text-primary" : "text-muted-foreground"}`} />
                <p className="text-xs font-medium leading-tight">{badge.name}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
