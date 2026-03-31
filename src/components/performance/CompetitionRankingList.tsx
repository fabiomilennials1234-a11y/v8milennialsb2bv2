import { memo } from "react";
import { motion } from "framer-motion";
import { Flame } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";

interface RankedUser {
  id: string;
  name: string;
  value: number;
  position: number;
  avatarUrl?: string;
  goalProgress: number;
}

interface CompetitionRankingListProps {
  users: RankedUser[];
  currentUserId?: string;
  metricType: "sales" | "meetings";
}

const fmt = (v: number) => v >= 1000 ? `R$ ${(v / 1000).toFixed(0)}K` : `R$ ${Math.round(v).toLocaleString("pt-BR")}`;

function CompetitionRankingListBase({ users, currentUserId, metricType }: CompetitionRankingListProps) {
  if (users.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {users.map((user, i) => {
        const isMe = user.id === currentUserId;
        const barColor = user.goalProgress >= 80 ? "bg-success" : user.goalProgress >= 40 ? "bg-primary" : "bg-destructive";
        const textColor = user.goalProgress >= 80 ? "text-success" : user.goalProgress >= 40 ? "text-primary" : "text-destructive";

        return (
          <motion.div
            key={user.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06 }}
            className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors ${
              isMe
                ? "bg-primary/5 border border-primary/20"
                : "bg-card/50 border border-border/20 hover:bg-card/80"
            }`}
          >
            {/* Position */}
            <span className="text-sm font-bold text-muted-foreground w-7 text-center">
              {user.position}º
            </span>

            {/* Avatar */}
            <UserAvatar
              name={user.name}
              avatarUrl={user.avatarUrl}
              size="sm"
              fallbackClassName="bg-muted text-muted-foreground"
            />

            {/* Name */}
            <span className={`flex-1 text-sm truncate ${isMe ? "font-semibold" : "font-medium"}`}>
              {user.name}
              {isMe && <span className="text-xs text-primary ml-1">(você)</span>}
            </span>

            {/* Value */}
            <span className="text-sm font-bold text-foreground min-w-[60px] text-right">
              {metricType === "sales" ? fmt(user.value) : `${user.value}`}
            </span>

            {/* Progress bar */}
            <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(user.goalProgress, 100)}%` }}
                transition={{ duration: 0.6, delay: 0.3 + i * 0.06 }}
                className={`h-full rounded-full ${barColor}`}
              />
            </div>

            {/* Percentage */}
            <span className={`text-xs font-bold w-9 text-right ${textColor}`}>
              {user.goalProgress}%
            </span>

            {/* Flame */}
            {user.goalProgress >= 80 && (
              <motion.div
                animate={{ scale: [1, 1.15, 1] }}
                transition={{ repeat: Infinity, duration: 1.2 }}
              >
                <Flame className="w-4 h-4 text-orange-400" />
              </motion.div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

export const CompetitionRankingList = memo(CompetitionRankingListBase);
