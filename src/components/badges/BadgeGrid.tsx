import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import { BadgeCard } from "./BadgeCard";
import type { Badge, UserBadge } from "@/hooks/useBadges";

interface BadgeGridProps {
  badges: Badge[];
  userBadges: UserBadge[];
  progressMap?: Record<string, number>; // criteria_type → current value
}

export function BadgeGrid({ badges, userBadges, progressMap = {} }: BadgeGridProps) {
  const unlockedIds = new Set(userBadges.map((ub) => ub.badge_id));
  const unlockedCount = badges.filter((b) => unlockedIds.has(b.id)).length;
  const totalCount = badges.length;
  const progressPercent = totalCount > 0 ? (unlockedCount / totalCount) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Conquistas</h3>
          <span className="text-sm text-muted-foreground">
            ({unlockedCount}/{totalCount})
          </span>
        </div>
      </div>

      {/* Barra de progresso geral */}
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progressPercent}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="h-full bg-gradient-to-r from-primary to-primary/70 rounded-full"
        />
      </div>

      {/* Grid de badges */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {badges.map((badge, index) => (
          <motion.div
            key={badge.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <BadgeCard
              badge={badge}
              unlocked={unlockedIds.has(badge.id)}
              currentValue={progressMap[badge.criteria_type]}
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
