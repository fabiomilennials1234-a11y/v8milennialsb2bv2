import { motion } from "framer-motion";
import { 
  User, 
  TrendingUp, 
  Calendar, 
  DollarSign, 
  Star,
  MoreHorizontal,
  Edit2,
  Trash2,
  Mail,
  Phone,
  Trophy,
  Target,
  Flame
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { MiniProgressRing } from "@/components/gamification/ProgressRing";
import { cn } from "@/lib/utils";

interface TeamMemberCardProps {
  member: {
    id: string;
    name: string;
    role: string;
    is_active: boolean;
    ote_base?: number | null;
    ote_bonus?: number | null;
    commission_mrr_percent?: number | null;
    commission_projeto_percent?: number | null;
    user_id?: string | null;
  };
  stats?: {
    sales: number;
    meetings: number;
    goalProgress: number;
    ranking?: number;
  };
  isAdmin?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  index?: number;
}

const roleConfig = {
  sdr: {
    label: "SDR",
    color: "bg-chart-5/10 text-chart-5 border-chart-5/20",
    icon: Calendar,
  },
  closer: {
    label: "Closer",
    color: "bg-primary/10 text-primary border-primary/20",
    icon: DollarSign,
  },
  admin: {
    label: "Admin",
    color: "bg-success/10 text-success border-success/20",
    icon: Star,
  },
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
  }).format(value);
}

export function TeamMemberCard({
  member,
  stats,
  isAdmin,
  onEdit,
  onDelete,
  index = 0,
}: TeamMemberCardProps) {
  const config = roleConfig[member.role as keyof typeof roleConfig] || roleConfig.sdr;
  const Icon = config.icon;
  const initials = member.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const totalOTE = (Number(member.ote_base) || 0) + (Number(member.ote_bonus) || 0);
  const goalProgress = stats?.goalProgress || 0;
  const isTopPerformer = stats?.ranking && stats.ranking <= 3;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ y: -4 }}
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card p-5 transition-all",
        isTopPerformer && "border-primary/50 shadow-lg shadow-primary/10",
        !member.is_active && "opacity-60"
      )}
    >
      {/* Top performer badge */}
      {isTopPerformer && (
        <div className="absolute top-0 right-0">
          <div className="bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-bl-xl">
            #{stats?.ranking}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div
            className={cn(
              "w-14 h-14 rounded-xl flex items-center justify-center text-lg font-bold",
              member.is_active
                ? "bg-gradient-to-br from-primary to-primary/80 text-primary-foreground"
                : "bg-muted text-muted-foreground"
            )}
          >
            {initials}
          </div>

          {/* Info */}
          <div>
            <h3 className="font-semibold text-base flex items-center gap-2">
              {member.name}
              {goalProgress >= 100 && (
                <Trophy className="w-4 h-4 text-primary" />
              )}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className={config.color}>
                <Icon className="w-3 h-3 mr-1" />
                {config.label}
              </Badge>
              {!member.is_active && (
                <Badge variant="outline" className="bg-muted text-muted-foreground">
                  Inativo
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Edit2 className="w-4 h-4 mr-2" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                <Trash2 className="w-4 h-4 mr-2" />
                Remover
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <p className="text-lg font-bold text-foreground">
              {member.role === "closer" ? formatCurrency(stats.sales) : stats.meetings}
            </p>
            <p className="text-xs text-muted-foreground">
              {member.role === "closer" ? "Vendas" : "Reuniões"}
            </p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <p className="text-lg font-bold text-foreground">{goalProgress}%</p>
            <p className="text-xs text-muted-foreground">Meta</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <p className="text-lg font-bold text-foreground">
              {formatCurrency(totalOTE)}
            </p>
            <p className="text-xs text-muted-foreground">OTE</p>
          </div>
        </div>
      )}

      {/* Goal Progress Bar */}
      {stats && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <Target className="w-3 h-3" />
              Progresso da Meta
            </span>
            <span
              className={cn(
                "font-medium",
                goalProgress >= 100 ? "text-success" : "text-foreground"
              )}
            >
              {goalProgress}%
            </span>
          </div>
          <Progress
            value={Math.min(goalProgress, 100)}
            className="h-2"
          />
          {goalProgress >= 80 && goalProgress < 100 && (
            <div className="flex items-center gap-1 text-xs text-orange-500">
              <Flame className="w-3 h-3" />
              <span>Quase lá!</span>
            </div>
          )}
        </div>
      )}

      {/* Commission Info */}
      <div className="mt-4 pt-4 border-t border-border">
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <p className="text-muted-foreground">Comissão MRR</p>
            <p className="font-medium">{member.commission_mrr_percent || 0}%</p>
          </div>
          <div>
            <p className="text-muted-foreground">Comissão Projeto</p>
            <p className="font-medium">{member.commission_projeto_percent || 0}%</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
