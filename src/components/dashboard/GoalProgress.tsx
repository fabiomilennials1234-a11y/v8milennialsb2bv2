import { motion } from "framer-motion";
import { Target } from "lucide-react";

interface GoalProgressProps {
  title: string;
  current: number;
  goal: number;
  unit?: string;
  showPercentage?: boolean;
}

export function GoalProgress({
  title,
  current,
  goal,
  unit = "",
  showPercentage = true,
}: GoalProgressProps) {
  const percentage = Math.min((current / goal) * 100, 100);
  const isCompleted = percentage >= 100;

  const getProgressColor = () => {
    if (isCompleted) return "bg-success";
    if (percentage >= 70) return "gradient-gold";
    if (percentage >= 40) return "bg-primary";
    return "bg-warning";
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">{title}</span>
        </div>
        <div className="text-right">
          <span className="text-sm font-semibold">
            {unit}
            {current.toLocaleString("pt-BR")}
          </span>
          <span className="text-sm text-muted-foreground">
            {" "}
            / {unit}
            {goal.toLocaleString("pt-BR")}
          </span>
          {showPercentage && (
            <span
              className={`ml-2 text-xs font-semibold ${
                isCompleted ? "text-success" : "text-muted-foreground"
              }`}
            >
              ({percentage.toFixed(0)}%)
            </span>
          )}
        </div>
      </div>
      <div className="progress-bar">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className={`progress-fill ${getProgressColor()}`}
        />
      </div>
    </div>
  );
}
