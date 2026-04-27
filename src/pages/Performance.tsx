import { useState, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import {
  Trophy, Target, Gift, Medal, Award, TrendingUp, Star, Crown,
  Flame, Calendar, Users, Plus, Edit2, Trash2, CheckCircle, Lock, Sparkles
} from "lucide-react";
import { useActiveCompetition, useCompetitionParticipants, useCompetitionPrizes, type Competition } from "@/hooks/useCompetitions";
import { CompetitionPodiumV2 } from "@/components/performance/CompetitionPodiumV2";
import { CompetitionRankingListV2 } from "@/components/performance/CompetitionRankingListV2";
import { CreateCompetitionModal } from "@/components/performance/CreateCompetitionModal";
import { useRankingTransitions } from "@/hooks/useRankingTransitions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useAvatarMap } from "@/hooks/useAvatarMap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProgressRing, MiniProgressRing } from "@/components/gamification/ProgressRing";
import { AchievementBadge, BadgeType } from "@/components/gamification/AchievementBadge";
import { CelebrationEffect } from "@/components/gamification/CelebrationEffect";
import { useTeamGoals, useGoals, useCreateGoal, useUpdateGoal, Goal } from "@/hooks/useGoals";
import { useAwards, useCreateAward, useUpdateAward, useDeleteAward, Award as AwardType } from "@/hooks/useAwards";
import { useDashboardMetrics, useRankingData } from "@/hooks/useDashboardMetrics";
import { useTeamMembers, isVirtualTeamMember, type TeamMember } from "@/hooks/useTeamMembers";
import { filterVisibleRanking } from "@/lib/visible-ranking";
import { useUserRole, useFeaturePermission } from "@/hooks/useUserRole";
import { useOrganization } from "@/hooks/useOrganization";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import badgeIcon from "@/assets/badge-icon.png";

// ============ CONSTANTS ============
const months = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const goalTypes = [
  { value: "faturamento", label: "Faturamento", icon: "💰" },
  { value: "clientes", label: "Novos Clientes", icon: "👥" },
  { value: "reunioes", label: "Reuniões", icon: "📅" },
  { value: "conversao", label: "Taxa de Conversão", icon: "📈" },
  { value: "vendas", label: "Vendas (Individual)", icon: "🎯" },
];

const awardTypeLabels: Record<string, { label: string; icon: typeof Trophy; color: string }> = {
  meta_mensal: { label: "Meta Mensal", icon: Target, color: "text-primary" },
  campeonato: { label: "Campeonato", icon: Trophy, color: "text-chart-5" },
  bonus: { label: "Bônus", icon: Star, color: "text-success" },
  especial: { label: "Especial", icon: Gift, color: "text-chart-4" },
};

const positionStyles = {
  1: { icon: Crown, color: "text-yellow-500", bg: "bg-gradient-to-br from-yellow-400 to-amber-500", border: "border-yellow-400" },
  2: { icon: Medal, color: "text-slate-400", bg: "bg-gradient-to-br from-slate-300 to-slate-400", border: "border-slate-400" },
  3: { icon: Award, color: "text-amber-600", bg: "bg-gradient-to-br from-amber-600 to-amber-700", border: "border-amber-600" },
};

// ============ INTERFACES ============
interface RankingUser {
  id: string;
  name: string;
  role: string;
  value: number;
  conversions?: number;
  meetings?: number;
  goalProgress: number;
  position: number;
}

interface GoalFormData {
  name: string;
  type: string;
  target_value: number;
  team_member_id: string | null;
  month: number;
  year: number;
}

interface AchievementProgress {
  award: AwardType;
  currentValue: number;
  progress: number;
  isUnlocked: boolean;
}

// ============ HELPER FUNCTIONS ============
function getPositionIcon(position: number) {
  if (position === 1) return Crown;
  if (position === 2) return Award;
  if (position === 3) return Trophy;
  return null;
}

function getPositionStyle(position: number) {
  if (position === 1) return "from-yellow-400 to-amber-500 border-yellow-400";
  if (position === 2) return "from-slate-300 to-slate-400 border-slate-400";
  if (position === 3) return "from-amber-600 to-amber-700 border-amber-600";
  return "from-muted to-muted border-border";
}

// ============ SUB-COMPONENTS ============

// Ranking Card Component
function RankingCard({ user, showValue = true, avatarUrl }: { user: RankingUser; showValue?: boolean; avatarUrl?: string }) {
  const isTop3 = user.position <= 3;
  const styles = positionStyles[user.position as keyof typeof positionStyles];
  const Icon = styles?.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: user.position * 0.05 }}
      whileHover={{ scale: 1.01, x: 4 }}
      className={`relative overflow-hidden rounded-xl border p-4 transition-all ${
        user.position === 1 
          ? "bg-gradient-to-r from-yellow-400/10 to-transparent border-yellow-400/50 shadow-lg shadow-yellow-400/10" 
          : isTop3 
          ? `bg-gradient-to-r from-${user.position === 2 ? 'slate' : 'amber'}-400/5 to-transparent ${styles.border}/30` 
          : "bg-card border-border hover:border-primary/30"
      }`}
    >
      {user.position === 1 && (
        <motion.div
          className="absolute inset-0 -translate-x-full"
          animate={{ translateX: ["100%", "-100%"] }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear", repeatDelay: 2 }}
          style={{
            background: "linear-gradient(90deg, transparent, rgba(245, 197, 24, 0.1), transparent)",
          }}
        />
      )}

      <div className="relative flex items-center gap-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
          isTop3 ? styles.bg : "bg-muted"
        }`}>
          {Icon ? (
            <Icon className="w-6 h-6 text-white" />
          ) : (
            <span className="text-lg font-bold text-muted-foreground">
              {user.position}º
            </span>
          )}
        </div>

        <UserAvatar
          name={user.name}
          avatarUrl={avatarUrl}
          size="lg"
          className={isTop3 ? "border-2 " + styles.border : ""}
          fallbackClassName={isTop3 ? "bg-white/20 text-foreground" : "bg-accent text-accent-foreground"}
        />

        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{user.name}</h3>
            {user.goalProgress >= 100 && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="flex items-center gap-1 px-2 py-0.5 bg-success/10 rounded-full"
              >
                <Star className="w-3 h-3 text-success fill-success" />
                <span className="text-xs font-medium text-success">Meta!</span>
              </motion.div>
            )}
            {user.goalProgress >= 80 && user.goalProgress < 100 && (
              <div className="flex items-center gap-1 px-2 py-0.5 bg-orange-500/10 rounded-full">
                <Flame className="w-3 h-3 text-orange-500" />
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{user.role}</p>
        </div>

        <div className="text-right">
          {showValue ? (
            <>
              <p className="text-xl font-bold">R$ {user.value.toLocaleString("pt-BR")}</p>
              <p className="text-sm text-muted-foreground">
                {user.conversions || 0} vendas
              </p>
            </>
          ) : (
            <>
              <p className="text-xl font-bold">{user.meetings || 0}</p>
              <p className="text-sm text-muted-foreground">reuniões</p>
            </>
          )}
        </div>

        <MiniProgressRing 
          progress={user.goalProgress} 
          color={user.goalProgress >= 100 ? "success" : "primary"} 
        />
      </div>
    </motion.div>
  );
}

// Achievement Card Component
function AchievementCard({ achievement, index }: { achievement: AchievementProgress; index: number }) {
  const typeConfig = awardTypeLabels[achievement.award.type] || awardTypeLabels.especial;
  const Icon = typeConfig.icon;
  const [showCelebration, setShowCelebration] = useState(false);

  const handleClick = () => {
    if (achievement.isUnlocked) {
      setShowCelebration(true);
    }
  };

  return (
    <>
      <CelebrationEffect show={showCelebration} onComplete={() => setShowCelebration(false)} />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: index * 0.1 }}
        onClick={handleClick}
        className={cn(
          "relative overflow-hidden rounded-xl border p-4 cursor-pointer transition-all duration-300",
          achievement.isUnlocked
            ? "bg-gradient-to-br from-primary/10 via-background to-chart-5/10 border-primary/30 hover:shadow-lg hover:shadow-primary/10"
            : "bg-card border-border hover:border-muted-foreground/30"
        )}
      >
        {achievement.isUnlocked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-chart-5/5"
          />
        )}

        <div className="relative z-10 flex items-start gap-3">
          <div className="relative">
            <ProgressRing
              progress={Math.min(achievement.progress, 100)}
              size={56}
              strokeWidth={5}
              color={achievement.isUnlocked ? "success" : "primary"}
            >
              <div
                className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center transition-all",
                  achievement.isUnlocked
                    ? "bg-success/20"
                    : "bg-muted"
                )}
              >
                {achievement.isUnlocked ? (
                  <CheckCircle className="w-5 h-5 text-success" />
                ) : (
                  <Icon className={cn("w-5 h-5", typeConfig.color)} />
                )}
              </div>
            </ProgressRing>
            {achievement.isUnlocked && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -top-1 -right-1"
              >
                <Sparkles className="w-4 h-4 text-chart-5" />
              </motion.div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium text-sm truncate">{achievement.award.name}</h3>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] shrink-0",
                  achievement.isUnlocked ? "bg-success/10 text-success border-success/30" : ""
                )}
              >
                {achievement.isUnlocked ? "✓" : `${Math.round(achievement.progress)}%`}
              </Badge>
            </div>

            <Progress
              value={Math.min(achievement.progress, 100)}
              className="h-1.5"
            />

            {achievement.award.prize_value && (
              <div className="flex items-center gap-1 mt-2">
                <Gift className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  R$ {achievement.award.prize_value.toLocaleString("pt-BR")}
                </span>
              </div>
            )}
          </div>

          {!achievement.isUnlocked && achievement.progress < 50 && (
            <Lock className="w-4 h-4 opacity-20" />
          )}
        </div>
      </motion.div>
    </>
  );
}

// Goal Management Dialog
function GoalFormDialog({
  open,
  onOpenChange,
  goal,
  teamMembers,
  selectedMonth,
  selectedYear,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal?: Goal | null;
  teamMembers: TeamMember[];
  selectedMonth: number;
  selectedYear: number;
  onSave: (data: GoalFormData) => void;
}) {
  const [formData, setFormData] = useState<GoalFormData>({
    name: goal?.name || "",
    type: goal?.type || "faturamento",
    target_value: goal?.target_value || 0,
    team_member_id: goal?.team_member_id || null,
    month: goal?.month || selectedMonth,
    year: goal?.year || selectedYear,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{goal ? "Editar Meta" : "Nova Meta"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label>Tipo de Meta</Label>
            <Select
              value={formData.type}
              onValueChange={(value) => setFormData({ ...formData, type: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {goalTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.icon} {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Nome (opcional)</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder={goalTypes.find(t => t.value === formData.type)?.label}
            />
          </div>

          <div className="grid gap-2">
            <Label>Valor da Meta</Label>
            <Input
              type="number"
              value={formData.target_value}
              onChange={(e) => setFormData({ ...formData, target_value: Number(e.target.value) })}
              required
            />
          </div>

          <div className="grid gap-2">
            <Label>Membro do Time</Label>
            <Select
              value={formData.team_member_id || "team"}
              onValueChange={(value) => setFormData({ 
                ...formData, 
                team_member_id: value === "team" ? null : value 
              })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Meta do time" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="team">🏢 Meta do Time</SelectItem>
                {teamMembers.filter(m => m.is_active).map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name} ({(member as any).job_title || member.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Mês</Label>
              <Select
                value={formData.month.toString()}
                onValueChange={(v) => setFormData({ ...formData, month: Number(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((month, index) => (
                    <SelectItem key={index} value={(index + 1).toString()}>
                      {month}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Ano</Label>
              <Select
                value={formData.year.toString()}
                onValueChange={(v) => setFormData({ ...formData, year: Number(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[2024, 2025, 2026, 2027].map(year => (
                    <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit">Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Award Form Dialog
function AwardFormDialog({
  open,
  onOpenChange,
  award,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  award?: AwardType | null;
  onSave: (data: Omit<AwardType, "id" | "created_at">) => void;
}) {
  const [formData, setFormData] = useState({
    name: award?.name || "",
    type: award?.type || "meta_mensal",
    description: award?.description || "",
    threshold: award?.threshold || 0,
    prize_description: award?.prize_description || "",
    prize_value: award?.prize_value || 0,
    is_active: award?.is_active ?? true,
    month: award?.month || null,
    year: award?.year || null,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      threshold: Number(formData.threshold),
      prize_value: Number(formData.prize_value) || null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{award ? "Editar Premiação" : "Nova Premiação"}</DialogTitle>
          <DialogDescription>
            Configure os detalhes da premiação para o time.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Nome da Premiação</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Ex: Vendedor do Mês"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label>Tipo</Label>
              <Select
                value={formData.type}
                onValueChange={(value) => setFormData({ ...formData, type: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="meta_mensal">Meta Mensal</SelectItem>
                  <SelectItem value="campeonato">Campeonato</SelectItem>
                  <SelectItem value="bonus">Bônus</SelectItem>
                  <SelectItem value="especial">Especial</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Descrição</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Descreva a premiação..."
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Meta/Threshold</Label>
                <Input
                  type="number"
                  value={formData.threshold}
                  onChange={(e) => setFormData({ ...formData, threshold: Number(e.target.value) })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label>Valor do Prêmio (R$)</Label>
                <Input
                  type="number"
                  value={formData.prize_value}
                  onChange={(e) => setFormData({ ...formData, prize_value: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Descrição do Prêmio</Label>
              <Textarea
                value={formData.prize_description}
                onChange={(e) => setFormData({ ...formData, prize_description: e.target.value })}
                placeholder="Ex: Viagem para Fernando de Noronha..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit">Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============ COMPETITION INLINE COMPONENTS ============

function CompetitionHeader({
  competition,
  participantCount,
}: {
  competition: Competition;
  participantCount: number;
}) {
  const daysLeft = Math.max(0, Math.ceil((new Date(competition.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

  return (
    <div className="rounded-xl bg-gradient-to-r from-primary/10 to-primary/5 border border-border p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🏆</span>
            <h2 className="text-xl font-extrabold bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
              {competition.name}
            </h2>
            <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px] font-bold uppercase">
              {competition.status === "active" ? "Ativo" : competition.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {competition.metric_type === "sales" ? "Vendas" : "Reuniões"} · {competition.criteria === "absolute_value" ? "Valor absoluto" : "% da meta"}
          </p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-2xl font-extrabold text-yellow-400">{daysLeft}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Dias restantes</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-extrabold text-purple-400">{participantCount}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Competidores</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyCompetitionState({ onCreateClick, onSeedClick, isSeeding }: { onCreateClick: () => void; onSeedClick?: () => void; isSeeding?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-16 text-center"
    >
      <motion.div
        animate={{ rotate: [0, -10, 10, -10, 0], scale: [1, 1.1, 1] }}
        transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
      >
        <Trophy className="w-16 h-16 text-muted-foreground/30" />
      </motion.div>
      <h3 className="text-lg font-bold mt-4">Nenhuma competição ativa</h3>
      <p className="text-sm text-muted-foreground mt-2 max-w-md">
        Crie uma competição para engajar seu time com ranking, metas e prêmios em tempo real.
      </p>
      <div className="flex gap-3 mt-6">
        <Button onClick={onCreateClick} className="gap-2">
          <Plus className="w-4 h-4" />
          Criar Competição
        </Button>
        {onSeedClick && (
          <Button onClick={onSeedClick} variant="outline" className="gap-2" disabled={isSeeding}>
            <Sparkles className="w-4 h-4" />
            {isSeeding ? "Criando..." : "Criar Competição Demo"}
          </Button>
        )}
      </div>
    </motion.div>
  );
}

// ============ MAIN COMPONENT ============
export default function Performance() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [awardDialogOpen, setAwardDialogOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [editingAward, setEditingAward] = useState<AwardType | null>(null);
  const [deleteGoalId, setDeleteGoalId] = useState<string | null>(null);
  const [showCreateCompetition, setShowCreateCompetition] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const queryClient = useQueryClient();

  // Hooks
  const { allowed: canManageGoals } = useFeaturePermission('performance.manage_goals');
  const { allowed: canManageAwards } = useFeaturePermission('performance.manage_awards');
  const { organizationId } = useOrganization();
  const { data: teamGoals, isLoading: goalsLoading } = useTeamGoals(selectedMonth, selectedYear);
  const { data: allGoals = [] } = useGoals(selectedMonth, selectedYear);
  const { data: metrics, isLoading: metricsLoading } = useDashboardMetrics(selectedMonth, selectedYear);
  const avatarMap = useAvatarMap();
  const { data: rankingData, isLoading: rankingLoading } = useRankingData(selectedMonth, selectedYear);
  const { data: awards, isLoading: awardsLoading } = useAwards(selectedMonth, selectedYear);
  const { data: teamMembers = [] } = useTeamMembers();
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const createAward = useCreateAward();
  const updateAward = useUpdateAward();
  const deleteAward = useDeleteAward();

  // Competition hooks
  const activeCompetition = useActiveCompetition(selectedMonth, selectedYear);
  const { data: participants = [] } = useCompetitionParticipants(activeCompetition?.id ?? null);
  const { data: prizes = [] } = useCompetitionPrizes(activeCompetition?.id ?? null);

  const participantIds = useMemo(() => new Set(participants.map(p => p.team_member_id)), [participants]);

  // Total de participantes visíveis da organização (exclui masters e virtuais).
  // Calculado após teamMembers para aproveitar a mesma fonte de verdade (org_visible_members).

  // Seed demo competition (temporary — remove after testing)
  const handleSeedCompetition = useCallback(async () => {
    if (!organizationId) return;
    setIsSeeding(true);
    try {
      // Get all active sales members
      const salesMembers = teamMembers.filter(m => m.metric_type === "sales" && m.is_active);
      const meetingsMembers = teamMembers.filter(m => m.metric_type === "meetings" && m.is_active);
      const allActive = [...salesMembers, ...meetingsMembers];

      if (allActive.length === 0) {
        toast.error("Nenhum membro ativo encontrado para criar competição demo");
        setIsSeeding(false);
        return;
      }

      // Create competition
      const { data: comp, error: compError } = await supabase
        .from("competitions")
        .insert({
          organization_id: organizationId,
          name: `Competição de Vendas — ${months[selectedMonth - 1]} ${selectedYear}`,
          description: "Competição demo criada automaticamente",
          criteria: "absolute_value" as const,
          metric_type: "sales" as const,
          month: selectedMonth,
          year: selectedYear,
          start_date: new Date(selectedYear, selectedMonth - 1, 1).toISOString(),
          end_date: new Date(selectedYear, selectedMonth, 0).toISOString(),
          status: "active" as const,
        })
        .select()
        .single();

      if (compError) throw compError;

      try {
        // Add participants (sales members, or all if no sales members)
        const membersToAdd = salesMembers.length > 0 ? salesMembers : allActive;
        const { error: partError } = await supabase
          .from("competition_participants")
          .insert(membersToAdd.map(m => ({
            competition_id: comp.id,
            team_member_id: m.id,
          })));

        if (partError) throw partError;

        // Add prizes
        const { error: prizeError } = await supabase
          .from("competition_prizes")
          .insert([
            { competition_id: comp.id, position: 1, prize_name: "iPhone 15", prize_icon: "🏆", prize_value: 5000 },
            { competition_id: comp.id, position: 2, prize_name: "Fone Bluetooth", prize_icon: "🎧", prize_value: 300 },
            { competition_id: comp.id, position: 3, prize_name: "Vale iFood", prize_icon: "🎁", prize_value: 150 },
          ]);

        if (prizeError) throw prizeError;
      } catch (innerError) {
        // Rollback: delete orphaned competition
        await supabase.from("competitions").delete().eq("id", comp.id);
        throw innerError;
      }

      toast.success("Competição demo criada com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["competitions"] });
      queryClient.invalidateQueries({ queryKey: ["competition-participants"] });
      queryClient.invalidateQueries({ queryKey: ["competition-prizes"] });
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar competição demo");
    } finally {
      setIsSeeding(false);
    }
  }, [organizationId, teamMembers, selectedMonth, selectedYear, queryClient]);

  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
  const expectedProgress = (dayOfMonth / daysInMonth) * 100;

  // Conjunto de ids realmente visíveis da organização.
  // useTeamMembers() consulta `org_visible_members`, que já exclui masters.
  // Qualquer ranking vindo da RPC é filtrado aqui para garantir consistência no frontend.
  const visibleMemberIds = useMemo(
    () => new Set(teamMembers.map((m) => m.id)),
    [teamMembers]
  );

  // Calculated data — somente membros visíveis da organização
  const closers: RankingUser[] = useMemo(
    () => filterVisibleRanking(rankingData?.salesRanking, visibleMemberIds),
    [rankingData, visibleMemberIds]
  );
  const sdrs: RankingUser[] = useMemo(
    () => filterVisibleRanking(rankingData?.meetingsRanking, visibleMemberIds),
    [rankingData, visibleMemberIds]
  );

  const visibleParticipantsCount = useMemo(
    () =>
      participants.filter(
        (p) => visibleMemberIds.has(p.team_member_id) && !isVirtualTeamMember(p.team_member_id)
      ).length,
    [participants, visibleMemberIds]
  );

  // Metas cards: dados públicos da organização via RPC (SECURITY DEFINER) — todos veem metas e vendas de todos
  const closerGoals = useMemo(() =>
    closers.map((c) => ({
      id: c.id,
      name: c.name ?? "",
      role: "Vendas" as const,
      current: c.value,
      goal: c.goal ?? 0,
      percentage: c.goalProgress,
    })),
    [closers]
  );
  const sdrGoals = useMemo(() =>
    sdrs.map((s) => ({
      id: s.id,
      name: s.name ?? "",
      role: "Reuniões" as const,
      current: s.meetings ?? 0,
      goal: s.goal ?? 0,
      percentage: s.goalProgress,
    })),
    [sdrs]
  );

  const podiumUsers = closers.slice(0, 3).map(c => ({
    id: c.id,
    name: c.name,
    value: c.value,
    position: c.position,
    goalProgress: c.goalProgress,
    avatarUrl: avatarMap.get(c.id),
  }));

  // Competition ranking data
  const competitionRanking = useMemo(() => {
    if (!activeCompetition || participants.length === 0) return [];

    const source = activeCompetition.metric_type === "sales"
      ? (rankingData?.salesRanking ?? [])
      : (rankingData?.meetingsRanking ?? []);

    // Build a map of ranking data by member id
    const rankMap = new Map(source.map(u => [u.id, u]));

    // Apenas participantes que pertencem aos membros visíveis da organização
    // (exclui masters, virtuais e qualquer participante órfão).
    const visibleParticipants = participants
      .filter((p) => visibleMemberIds.has(p.team_member_id))
      .filter((p) => !isVirtualTeamMember(p.team_member_id));

    // Build ranking for ALL participants, even those with 0 activity
    // Participants without ranking data get value=0
    const participantMembers = visibleParticipants.map(p => {
      const member = teamMembers.find(m => m.id === p.team_member_id);
      const rank = rankMap.get(p.team_member_id);
      return {
        id: p.team_member_id,
        name: rank?.name ?? member?.name ?? "Sem nome",
        role: rank?.role ?? "Vendas",
        value: rank?.value ?? 0,
        conversions: rank?.conversions ?? 0,
        meetings: rank?.meetings ?? 0,
        goalProgress: rank?.goalProgress ?? 0,
        goal: rank?.goal ?? 0,
        position: 0, // will be set below
        avatarUrl: avatarMap.get(p.team_member_id),
      };
    });

    // Sort by value descending and assign positions
    return participantMembers
      .filter((u) => u.role !== "master")
      .sort((a, b) => b.value - a.value)
      .map((u, i) => ({ ...u, position: i + 1 }));
  }, [activeCompetition, rankingData, participants, teamMembers, avatarMap, visibleMemberIds]);

  // Ranking transitions (replay animation of position changes)
  const rankingTransitions = useRankingTransitions(
    activeCompetition?.id ?? null,
    competitionRanking.map(u => ({ id: u.id, position: u.position })),
    2500,
  );

  const compPodiumUsers = competitionRanking.slice(0, 3);
  const restUsers = competitionRanking.slice(3);

  const podiumPrizes = prizes.map(p => ({
    position: p.position,
    prize_name: p.prize_name,
    prize_icon: p.prize_icon,
    prize_value: p.prize_value,
  }));

  // Goals calculations
  const faturamentoGoal = teamGoals?.find((g) => g.type === "faturamento");
  const clientesGoal = teamGoals?.find((g) => g.type === "clientes");
  const reunioesGoal = teamGoals?.find((g) => g.type === "reunioes");

  const currentFaturamento = metrics?.vendaTotal || 0;
  const currentClientes = metrics?.novosClientes || 0;
  const currentReunioes = metrics?.reunioesComparecidas || 0;

  const faturamentoProgress = faturamentoGoal 
    ? (currentFaturamento / faturamentoGoal.target_value) * 100 
    : 0;
  const clientesProgress = clientesGoal 
    ? (currentClientes / clientesGoal.target_value) * 100 
    : 0;
  const reunioesProgress = reunioesGoal 
    ? (currentReunioes / reunioesGoal.target_value) * 100 
    : 0;

  const expectedFaturamento = faturamentoGoal 
    ? (faturamentoGoal.target_value * expectedProgress) / 100 
    : 0;
  const faturamentoDiff = expectedFaturamento > 0 
    ? ((currentFaturamento - expectedFaturamento) / expectedFaturamento) * 100 
    : 0;

  // Achievements
  const achievements: AchievementProgress[] = useMemo(() => {
    if (!awards) return [];
    return awards.map((award) => {
      let currentValue = 0;
      if (award.type === "meta_mensal") {
        currentValue = metrics?.vendaTotal || 0;
      } else if (award.type === "campeonato") {
        currentValue = metrics?.novosClientes || 0;
      } else if (award.type === "bonus") {
        currentValue = metrics?.reunioesComparecidas || 0;
      } else {
        currentValue = metrics?.totalLeads || 0;
      }
      const progress = award.threshold > 0 ? (currentValue / award.threshold) * 100 : 0;
      return { award, currentValue, progress, isUnlocked: progress >= 100 };
    }).sort((a, b) => {
      if (a.isUnlocked && !b.isUnlocked) return -1;
      if (!a.isUnlocked && b.isUnlocked) return 1;
      return b.progress - a.progress;
    });
  }, [awards, metrics]);

  // Badges based on progress
  const badgeAchievements: Array<{ type: BadgeType; title: string; earned: boolean }> = [
    { type: "first_sale", title: "Primeira Venda", earned: currentClientes >= 1 },
    { type: "bronze", title: "Bronze", earned: faturamentoProgress >= 50 },
    { type: "silver", title: "Prata", earned: faturamentoProgress >= 75 },
    { type: "gold", title: "Ouro", earned: faturamentoProgress >= 100 },
    { type: "overachiever", title: "Superação", earned: faturamentoProgress >= 120 },
  ];

  const teamGoalsFiltered = allGoals.filter(g => !g.team_member_id);
  const individualGoalsFiltered = allGoals.filter(g => g.team_member_id);

  const isLoading = goalsLoading || metricsLoading || rankingLoading || awardsLoading;

  // Handlers
  const handleSaveGoal = async (data: GoalFormData) => {
    const goalData = {
      name: data.name || goalTypes.find(t => t.value === data.type)?.label || "Meta",
      type: data.type,
      target_value: data.target_value,
      current_value: 0,
      team_member_id: data.team_member_id || null,
      month: data.month,
      year: data.year,
    };
    try {
      if (editingGoal) {
        await updateGoal.mutateAsync({ id: editingGoal.id, ...goalData });
      } else {
        await createGoal.mutateAsync(goalData);
      }
      setEditingGoal(null);
    } catch (error) {
      console.error("Error saving goal:", error);
    }
  };

  const handleDeleteGoal = async () => {
    if (!deleteGoalId || !organizationId) return;
    try {
      const { error } = await supabase
        .from("goals")
        .delete()
        .eq("id", deleteGoalId)
        .eq("organization_id", organizationId);
      if (error) throw error;
      toast.success("Meta excluída com sucesso!");
      setDeleteGoalId(null);
    } catch (error: unknown) {
      toast.error("Erro ao excluir meta: " + (error as Error).message);
    }
  };

  const handleSaveAward = (data: Omit<AwardType, "id" | "created_at">) => {
    if (editingAward) {
      updateAward.mutate({ id: editingAward.id, ...data });
    } else {
      createAward.mutate(data);
    }
    setEditingAward(null);
  };

  const handleDeleteAward = (id: string) => {
    if (confirm("Tem certeza que deseja excluir esta premiação?")) {
      deleteAward.mutate(id);
    }
  };

  const getMemberName = (memberId: string | null) => {
    if (!memberId) return "Time";
    return teamMembers.find(m => m.id === memberId)?.name || "Desconhecido";
  };

  const getGoalTypeInfo = (type: string) => {
    return goalTypes.find(t => t.value === type) || { label: type, icon: "🎯" };
  };

  const formatValue = (type: string, value: number) => {
    if (type === "faturamento" || type === "vendas") {
      return `R$ ${value.toLocaleString("pt-BR")}`;
    }
    if (type === "conversao") return `${value}%`;
    return value.toString();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-bold"
          >
            Ranking de Vendas
          </motion.h1>
          <p className="text-muted-foreground mt-1">
            Acompanhe a competição do time
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select 
            value={selectedMonth.toString()} 
            onValueChange={(v) => setSelectedMonth(Number(v))}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((month, index) => (
                <SelectItem key={index} value={(index + 1).toString()}>
                  {month}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select 
            value={selectedYear.toString()} 
            onValueChange={(v) => setSelectedYear(Number(v))}
          >
            <SelectTrigger className="w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[2024, 2025, 2026, 2027].map(year => (
                <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <img src={badgeIcon} alt="" className="w-10 h-10 opacity-80" />
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="ranking_vendas" className="space-y-6">
        <TabsList className="grid w-full max-w-lg grid-cols-2">
          <TabsTrigger value="ranking_vendas" className="flex items-center gap-1.5">
            <Trophy className="w-4 h-4" />
            <span className="hidden sm:inline">Ranking de Vendas</span>
          </TabsTrigger>
          {canManageGoals && (
            <TabsTrigger value="gestao" className="flex items-center gap-1.5">
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">Gestão</span>
            </TabsTrigger>
          )}
        </TabsList>

        {/* ========== RANKING VENDAS TAB ========== */}
        <TabsContent value="ranking_vendas" className="space-y-6">
          {activeCompetition ? (
            <>
              <CompetitionHeader
                competition={activeCompetition}
                participantCount={visibleParticipantsCount}
              />
              <CompetitionPodiumV2
                users={compPodiumUsers}
                prizes={podiumPrizes}
                metricType={activeCompetition.metric_type}
                getChange={rankingTransitions.getChange}
                isAnimatingTransitions={rankingTransitions.isAnimating}
                previousRanking={rankingTransitions.previousRanking}
              />
              {restUsers.length > 0 && (
                <CompetitionRankingListV2
                  users={restUsers}
                  metricType={activeCompetition.metric_type}
                  getChange={rankingTransitions.getChange}
                  isAnimatingTransitions={rankingTransitions.isAnimating}
                />
              )}
            </>
          ) : (
            <>
              <EmptyCompetitionState
                onCreateClick={() => setShowCreateCompetition(true)}
                onSeedClick={handleSeedCompetition}
                isSeeding={isSeeding}
              />
              {/* Fallback: simple ranking without competition */}
              {rankingData && (rankingData.salesRanking.length > 0 || rankingData.meetingsRanking.length > 0) && (
                <div className="space-y-6 opacity-60">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Ranking Simples</h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Closers */}
                    <Card className="glass-card">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-primary" />
                          Ranking Vendas
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {closers.length > 0 ? (
                          closers.map((user) => (
                            <RankingCard key={user.id} user={user} avatarUrl={avatarMap.get(user.id)} />
                          ))
                        ) : (
                          <p className="text-muted-foreground text-center py-8">Nenhum membro de vendas com faturamento.</p>
                        )}
                      </CardContent>
                    </Card>

                    {/* SDRs */}
                    <Card className="glass-card">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-chart-5" />
                          Ranking Reuniões
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {sdrs.length > 0 ? (
                          sdrs.map((user) => (
                            <RankingCard key={user.id} user={user} showValue={false} avatarUrl={avatarMap.get(user.id)} />
                          ))
                        ) : (
                          <p className="text-muted-foreground text-center py-8">Nenhum membro de reuniões com dados.</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ========== GESTÃO TAB (Admin only) ========== */}
        {canManageGoals && (
          <TabsContent value="gestao" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Target className="w-5 h-5 text-primary" />
                Gestão de Metas
              </h2>
              <Button onClick={() => { setEditingGoal(null); setGoalDialogOpen(true); }} className="gradient-gold">
                <Plus className="w-4 h-4 mr-2" />
                Nova Meta
              </Button>
            </div>

            {/* Team Goals */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Metas do Time
                </CardTitle>
              </CardHeader>
              <CardContent>
                {teamGoalsFiltered.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    Nenhuma meta do time configurada para {months[selectedMonth - 1]} {selectedYear}.
                  </p>
                ) : (
                  <div className="grid gap-3">
                    {teamGoalsFiltered.map((goal) => {
                      const typeInfo = getGoalTypeInfo(goal.type);
                      return (
                        <div key={goal.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">{typeInfo.icon}</span>
                            <div>
                              <p className="font-medium">{goal.name || typeInfo.label}</p>
                              <Badge variant="outline" className="mt-1">{typeInfo.label}</Badge>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className="text-lg font-bold text-primary">
                                {formatValue(goal.type, goal.target_value)}
                              </p>
                              <p className="text-xs text-muted-foreground">Meta</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" onClick={() => { setEditingGoal(goal); setGoalDialogOpen(true); }}>
                                <Edit2 className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => setDeleteGoalId(goal.id)}>
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Individual Goals */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  Metas Individuais
                </CardTitle>
              </CardHeader>
              <CardContent>
                {individualGoalsFiltered.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    Nenhuma meta individual configurada para {months[selectedMonth - 1]} {selectedYear}.
                  </p>
                ) : (
                  <div className="grid gap-3">
                    {individualGoalsFiltered.map((goal) => {
                      const typeInfo = getGoalTypeInfo(goal.type);
                      return (
                        <div key={goal.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <UserAvatar
                              name={getMemberName(goal.team_member_id)}
                              avatarUrl={avatarMap.get(goal.team_member_id)}
                              size="md"
                              fallbackClassName="bg-primary/10 text-primary"
                            />
                            <div>
                              <p className="font-medium">{getMemberName(goal.team_member_id)}</p>
                              <Badge variant="outline" className="mt-1">{typeInfo.label}</Badge>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className="text-lg font-bold text-primary">
                                {formatValue(goal.type, goal.target_value)}
                              </p>
                              <p className="text-xs text-muted-foreground">Meta</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" onClick={() => { setEditingGoal(goal); setGoalDialogOpen(true); }}>
                                <Edit2 className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => setDeleteGoalId(goal.id)}>
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Competition Management */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Trophy className="w-5 h-5 text-yellow-500" />
                Competição do Mês
              </h2>
              {!activeCompetition && (
                <Button onClick={() => setShowCreateCompetition(true)} variant="outline" className="gap-2">
                  <Plus className="w-4 h-4" />
                  Criar Competição
                </Button>
              )}
            </div>

            {activeCompetition ? (
              <Card className="glass-card">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      🏆 {activeCompetition.name}
                      <Badge variant="outline" className="bg-green-500/20 text-green-600 border-green-500/30 text-[10px] font-bold uppercase ml-2">
                        Ativo
                      </Badge>
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Competition Info */}
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="p-3 rounded-lg bg-muted/50">
                      <p className="text-muted-foreground text-xs">Tipo</p>
                      <p className="font-semibold">{activeCompetition.metric_type === "sales" ? "Vendas" : "Reuniões"}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50">
                      <p className="text-muted-foreground text-xs">Critério</p>
                      <p className="font-semibold">{activeCompetition.criteria === "absolute_value" ? "Valor absoluto" : "% da meta"}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50">
                      <p className="text-muted-foreground text-xs">Participantes</p>
                      <p className="font-semibold">{visibleParticipantsCount} vendedores</p>
                    </div>
                  </div>

                  {/* Prizes */}
                  <div>
                    <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <Gift className="w-4 h-4" />
                      Prêmios por Colocação
                    </p>
                    <div className="space-y-2">
                      {prizes.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhum prêmio configurado.</p>
                      ) : (
                        prizes.sort((a, b) => a.position - b.position).map((prize) => (
                          <div key={prize.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                            <div className="flex items-center gap-3">
                              <span className="text-lg">{prize.prize_icon}</span>
                              <div>
                                <p className="text-sm font-semibold">{prize.position}º Lugar — {prize.prize_name}</p>
                                {prize.prize_description && (
                                  <p className="text-xs text-muted-foreground">{prize.prize_description}</p>
                                )}
                              </div>
                            </div>
                            {prize.prize_value != null && (
                              <span className="text-sm font-bold text-primary">
                                R$ {prize.prize_value.toLocaleString("pt-BR")}
                              </span>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Participants list */}
                  <div>
                    <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Participantes
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {participants
                        .filter((p) => visibleMemberIds.has(p.team_member_id) && !isVirtualTeamMember(p.team_member_id))
                        .map((p) => {
                          const member = teamMembers.find(m => m.id === p.team_member_id);
                          return (
                            <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50">
                              <UserAvatar name={member?.name || "?"} avatarUrl={avatarMap.get(p.team_member_id)} size="xs" />
                              <span className="text-sm">{member?.name || "Desconhecido"}</span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="glass-card">
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Trophy className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Nenhuma competição ativa para {months[selectedMonth - 1]} {selectedYear}.</p>
                  <p className="text-xs mt-1">Crie uma competição para motivar o time.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* Dialogs */}
      <GoalFormDialog
        open={goalDialogOpen}
        onOpenChange={setGoalDialogOpen}
        goal={editingGoal}
        teamMembers={teamMembers}
        selectedMonth={selectedMonth}
        selectedYear={selectedYear}
        onSave={handleSaveGoal}
      />

      <AwardFormDialog
        open={awardDialogOpen}
        onOpenChange={setAwardDialogOpen}
        award={editingAward}
        onSave={handleSaveAward}
      />

      <AlertDialog open={!!deleteGoalId} onOpenChange={() => setDeleteGoalId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir meta?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteGoal}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CreateCompetitionModal
        open={showCreateCompetition}
        onOpenChange={setShowCreateCompetition}
      />
    </div>
  );
}
