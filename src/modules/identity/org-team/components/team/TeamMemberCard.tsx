import { motion } from "framer-motion";
import {
  Calendar,
  DollarSign,
  Star,
  MoreHorizontal,
  Edit2,
  Trash2,
  Trophy,
  Target,
  Flame
} from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { UserAvatar } from "@/components/ui/user-avatar";
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
  avatarUrl?: string;
  onEdit?: () => void;
  onDelete?: () => void;
  index?: number;
}

// V5: o papel vira tom de Badge — admin em ouro suave (igual à tabela da
// Equipe), membro neutro, SDR/Closer informativos.
const roleConfig: Record<string, { label: string; variant: BadgeProps["variant"]; icon: typeof Calendar }> = {
  sdr: {
    label: "Vendedor",
    variant: "info",
    icon: Calendar,
  },
  closer: {
    label: "Vendedor",
    variant: "info",
    icon: DollarSign,
  },
  member: {
    label: "Membro",
    variant: "soft",
    icon: Calendar,
  },
  admin: {
    label: "Admin",
    variant: "gold",
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
  avatarUrl,
  onEdit,
  onDelete,
  index = 0,
}: TeamMemberCardProps) {
  const config = roleConfig[member.role] || roleConfig.sdr;
  const Icon = config.icon;

  const totalOTE = (Number(member.ote_base) || 0) + (Number(member.ote_bonus) || 0);
  const goalProgress = stats?.goalProgress || 0;
  const isTopPerformer = stats?.ranking && stats.ranking <= 3;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ y: -2 }}
      className={cn(
        "relative overflow-hidden rounded-card border border-card-border bg-card p-5 text-card-foreground shadow-relevo transition-shadow hover:shadow-relevo-alto",
        isTopPerformer && "border-primary/50",
        !member.is_active && "opacity-60"
      )}
    >
      {/* Top performer badge */}
      {isTopPerformer && (
        <div className="absolute top-0 right-0">
          <div className="rounded-bl-xl bg-primary px-3 py-1 text-xs font-bold tabular-nums text-primary-foreground">
            #{stats?.ranking}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <UserAvatar
            name={member.name}
            avatarUrl={avatarUrl}
            size="lg"
            className="h-14 w-14 rounded-xl"
            fallbackClassName={cn(
              "rounded-xl font-bold",
              member.is_active
                ? "bg-primary-soft text-primary-soft-foreground"
                : "bg-muted text-muted-foreground"
            )}
          />

          {/* Info */}
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold tracking-tight">
              {member.name}
              {goalProgress >= 100 && (
                <Trophy className="w-4 h-4 text-primary" />
              )}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={config.variant}>
                <Icon className="w-3 h-3 mr-1" />
                {config.label}
              </Badge>
              {!member.is_active && (
                <Badge variant="soft" className="text-muted-foreground">
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
          <div className="rounded-xl bg-sunken p-2 text-center">
            <p className="text-lg font-extrabold tabular-nums tracking-[-0.04em] text-foreground">
              {(member as any).metric_type === "sales" ? formatCurrency(stats.sales) : stats.meetings}
            </p>
            <p className="text-xs text-muted-foreground">
              {(member as any).metric_type === "sales" ? "Vendas" : "Reuniões"}
            </p>
          </div>
          <div className="rounded-xl bg-sunken p-2 text-center">
            <p className="text-lg font-extrabold tabular-nums tracking-[-0.04em] text-foreground">{goalProgress}%</p>
            <p className="text-xs text-muted-foreground">Meta</p>
          </div>
          <div className="rounded-xl bg-sunken p-2 text-center">
            <p className="text-lg font-extrabold tabular-nums tracking-[-0.04em] text-foreground">
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
              Progresso da meta
            </span>
            <span
              className={cn(
                "font-semibold tabular-nums",
                goalProgress >= 100 ? "text-success-strong" : "text-foreground"
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
            <div className="flex items-center gap-1 text-xs text-warning-strong">
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
            <p className="text-muted-foreground">Comissão rec.</p>
            <p className="font-semibold tabular-nums">{member.commission_mrr_percent || 0}%</p>
          </div>
          <div>
            <p className="text-muted-foreground">Comissão projeto</p>
            <p className="font-semibold tabular-nums">{member.commission_projeto_percent || 0}%</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
