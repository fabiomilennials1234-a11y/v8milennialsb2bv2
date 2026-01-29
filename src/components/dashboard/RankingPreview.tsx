import { motion } from "framer-motion";
import { Trophy, Medal, Award } from "lucide-react";

interface RankingUser {
  id: string;
  name: string;
  avatar?: string;
  value: number;
  position: number;
}

interface RankingPreviewProps {
  title: string;
  users: RankingUser[];
  valuePrefix?: string;
  valueSuffix?: string;
}

const positionIcons = {
  1: Trophy,
  2: Medal,
  3: Award,
};

const positionColors = {
  1: "text-primary",
  2: "text-muted-foreground",
  3: "text-warning",
};

export function RankingPreview({
  title,
  users,
  valuePrefix = "R$ ",
  valueSuffix = "",
}: RankingPreviewProps) {
  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">{title}</h3>
        <Trophy className="w-5 h-5 text-primary" />
      </div>

      <div className="space-y-3">
        {users.map((user, index) => {
          const Icon =
            positionIcons[user.position as keyof typeof positionIcons];
          const colorClass =
            positionColors[user.position as keyof typeof positionColors] ||
            "text-muted-foreground";

          return (
            <motion.div
              key={user.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: index * 0.1 }}
              className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                user.position === 1
                  ? "bg-primary/5 border border-primary/20"
                  : "hover:bg-muted/50"
              }`}
            >
              <div className="w-8 h-8 flex items-center justify-center">
                {Icon ? (
                  <Icon className={`w-5 h-5 ${colorClass}`} />
                ) : (
                  <span className="text-sm font-bold text-muted-foreground">
                    {user.position}º
                  </span>
                )}
              </div>

              <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-semibold text-accent-foreground">
                  {user.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)}
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.name}</p>
              </div>

              <div className="text-right">
                <p className="text-sm font-bold">
                  {valuePrefix}
                  {user.value.toLocaleString("pt-BR")}
                  {valueSuffix}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
