import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Trophy, Target, Gift, Medal, Award, TrendingUp, Zap, Star, Crown, 
  Flame, Calendar, Users, Plus, Edit2, Trash2, CheckCircle, Lock, Sparkles
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { TopThreePodium } from "@/components/gamification/LeaderboardCard";
import { ProgressRing, MiniProgressRing } from "@/components/gamification/ProgressRing";
import { AchievementBadge, BadgeType } from "@/components/gamification/AchievementBadge";
import { CelebrationEffect } from "@/components/gamification/CelebrationEffect";
import { useTeamGoals, useIndividualGoals, useGoals, useCreateGoal, useUpdateGoal, Goal } from "@/hooks/useGoals";
import { useAwards, useCreateAward, useUpdateAward, useDeleteAward, Award as AwardType } from "@/hooks/useAwards";
import { useDashboardMetrics, useRankingData } from "@/hooks/useDashboardMetrics";
import { useTeamMembers, type TeamMember } from "@/hooks/useTeamMembers";
import { useUserRole, useIsAdmin } from "@/hooks/useUserRole";
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
  role: "Closer" | "SDR";
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
function RankingCard({ user, showValue = true }: { user: RankingUser; showValue?: boolean }) {
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

        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
          isTop3 ? "bg-white/20 border-2 " + styles.border : "bg-accent"
        }`}>
          <span className={`text-lg font-semibold ${isTop3 ? "text-foreground" : "text-accent-foreground"}`}>
            {user.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
          </span>
        </div>

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
                    {member.name} ({member.role === "closer" ? "Closer" : "SDR"})
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
                placeholder="Ex: Closer do Mês"
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

  // Hooks
  const { isAdmin } = useIsAdmin();
  const { data: teamGoals, isLoading: goalsLoading } = useTeamGoals(selectedMonth, selectedYear);
  const { data: individualGoals, isLoading: individualLoading } = useIndividualGoals(selectedMonth, selectedYear);
  const { data: allGoals = [] } = useGoals(selectedMonth, selectedYear);
  const { data: metrics, isLoading: metricsLoading } = useDashboardMetrics(selectedMonth, selectedYear);
  const { data: rankingData, isLoading: rankingLoading } = useRankingData(selectedMonth, selectedYear);
  const { data: awards, isLoading: awardsLoading } = useAwards(selectedMonth, selectedYear);
  const { data: teamMembers = [] } = useTeamMembers();
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const createAward = useCreateAward();
  const updateAward = useUpdateAward();
  const deleteAward = useDeleteAward();

  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
  const expectedProgress = (dayOfMonth / daysInMonth) * 100;

  // Calculated data
  const closers: RankingUser[] = rankingData?.closerRanking || [];
  const sdrs: RankingUser[] = rankingData?.sdrRanking || [];
  const podiumUsers = closers.slice(0, 3).map(c => ({
    id: c.id,
    name: c.name,
    value: c.value,
    position: c.position,
    goalProgress: c.goalProgress,
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

  const isLoading = goalsLoading || metricsLoading || rankingLoading || awardsLoading || individualLoading;

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
    if (!deleteGoalId) return;
    try {
      const { error } = await supabase.from("goals").delete().eq("id", deleteGoalId);
      if (error) throw error;
      toast.success("Meta excluída com sucesso!");
      setDeleteGoalId(null);
    } catch (error: unknown) {
      toast.error("Erro ao excluir meta: " + error.message);
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
            className="text-2xl font-bold flex items-center gap-3"
          >
            <Trophy className="w-7 h-7 text-primary" />
            Performance & Metas
          </motion.h1>
          <p className="text-muted-foreground mt-1">
            Ranking, metas e premiações do time
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
      <Tabs defaultValue="ranking" className="space-y-6">
        <TabsList className="grid w-full max-w-lg grid-cols-4">
          <TabsTrigger value="ranking" className="flex items-center gap-1.5">
            <Trophy className="w-4 h-4" />
            <span className="hidden sm:inline">Ranking</span>
          </TabsTrigger>
          <TabsTrigger value="metas" className="flex items-center gap-1.5">
            <Target className="w-4 h-4" />
            <span className="hidden sm:inline">Metas</span>
          </TabsTrigger>
          <TabsTrigger value="premiacoes" className="flex items-center gap-1.5">
            <Gift className="w-4 h-4" />
            <span className="hidden sm:inline">Prêmios</span>
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="gestao" className="flex items-center gap-1.5">
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">Gestão</span>
            </TabsTrigger>
          )}
        </TabsList>

        {/* ========== RANKING TAB ========== */}
        <TabsContent value="ranking" className="space-y-6">
          {/* Podium */}
          {isLoading ? (
            <Skeleton className="h-[280px] rounded-2xl" />
          ) : closers.length >= 3 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gradient-to-br from-accent to-accent/80 rounded-2xl p-6 text-accent-foreground relative overflow-hidden"
            >
              <div className="absolute inset-0 opacity-10">
                <div className="absolute top-10 left-10 w-32 h-32 bg-primary rounded-full blur-3xl" />
                <div className="absolute bottom-10 right-10 w-40 h-40 bg-primary rounded-full blur-3xl" />
              </div>
              <div className="relative">
                <div className="text-center mb-4">
                  <h2 className="text-lg font-medium opacity-80">🏆 Top Vendedores do Mês</h2>
                </div>
                <TopThreePodium users={podiumUsers} />
              </div>
            </motion.div>
          ) : closers[0] ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gradient-to-br from-accent to-accent/80 rounded-2xl p-8 text-accent-foreground text-center"
            >
              <h2 className="text-lg font-medium opacity-80">Líder do Mês</h2>
              <div className="flex items-center justify-center gap-3 mt-2">
                <Zap className="w-6 h-6 text-primary" />
                <span className="text-3xl font-bold">{closers[0].name}</span>
                <Zap className="w-6 h-6 text-primary" />
              </div>
              <p className="text-4xl font-bold text-primary mt-2">
                R$ {closers[0].value.toLocaleString("pt-BR")}
              </p>
            </motion.div>
          ) : null}

          {/* Rankings Lists */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Closers */}
            <Card className="glass-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Ranking Closers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {isLoading ? (
                  Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-20" />)
                ) : closers.length > 0 ? (
                  closers.map((user) => (
                    <RankingCard key={user.id} user={user} />
                  ))
                ) : (
                  <p className="text-muted-foreground text-center py-8">Nenhum closer com vendas.</p>
                )}
              </CardContent>
            </Card>

            {/* SDRs */}
            <Card className="glass-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-chart-5" />
                  Ranking SDRs
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {isLoading ? (
                  Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-20" />)
                ) : sdrs.length > 0 ? (
                  sdrs.map((user) => (
                    <RankingCard key={user.id} user={user} showValue={false} />
                  ))
                ) : (
                  <p className="text-muted-foreground text-center py-8">Nenhum SDR com reuniões.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ========== METAS TAB ========== */}
        <TabsContent value="metas" className="space-y-6">
          {/* Badges */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card rounded-xl border border-border p-6"
          >
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Star className="w-5 h-5 text-primary fill-primary" />
              Suas Conquistas
            </h2>
            <div className="flex items-center gap-6 overflow-x-auto pb-2">
              {badgeAchievements.map((achievement, index) => (
                <motion.div
                  key={achievement.type}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <AchievementBadge
                    type={achievement.type}
                    title={achievement.title}
                    earned={achievement.earned}
                    size="md"
                  />
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Progress Rings */}
          {isLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
              {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
              {faturamentoGoal && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-card rounded-xl border border-border p-6 flex flex-col items-center"
                >
                  <ProgressRing
                    progress={faturamentoProgress}
                    icon={Target}
                    label="Faturamento"
                    value={`R$ ${(currentFaturamento / 1000).toFixed(0)}K`}
                    color={faturamentoProgress >= 100 ? "success" : "primary"}
                    size={140}
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Meta: R$ {(faturamentoGoal.target_value / 1000).toFixed(0)}K
                  </p>
                </motion.div>
              )}
              
              {clientesGoal && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="bg-card rounded-xl border border-border p-6 flex flex-col items-center"
                >
                  <ProgressRing
                    progress={clientesProgress}
                    icon={Users}
                    label="Novos Clientes"
                    value={currentClientes.toString()}
                    color={clientesProgress >= 100 ? "success" : "primary"}
                    size={140}
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Meta: {clientesGoal.target_value} clientes
                  </p>
                </motion.div>
              )}
              
              {reunioesGoal && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="bg-card rounded-xl border border-border p-6 flex flex-col items-center"
                >
                  <ProgressRing
                    progress={reunioesProgress}
                    icon={Calendar}
                    label="Reuniões"
                    value={currentReunioes.toString()}
                    color={reunioesProgress >= 100 ? "success" : "warning"}
                    size={140}
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Meta: {reunioesGoal.target_value} reuniões
                  </p>
                </motion.div>
              )}
              
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="bg-card rounded-xl border border-border p-6 flex flex-col items-center"
              >
                <ProgressRing
                  progress={expectedProgress}
                  icon={TrendingUp}
                  label="Progresso do Mês"
                  color={faturamentoDiff >= 0 ? "success" : "destructive"}
                  size={140}
                />
                <p className={`text-xs mt-2 font-medium ${faturamentoDiff >= 0 ? "text-success" : "text-destructive"}`}>
                  {faturamentoDiff >= 0 ? "+" : ""}{faturamentoDiff.toFixed(0)}% vs esperado
                </p>
              </motion.div>
            </div>
          )}

          {/* Individual Goals */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Closers Goals */}
            <Card className="glass-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-primary" />
                  Metas Closers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {individualLoading ? (
                  Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-20" />)
                ) : individualGoals?.closerGoals && individualGoals.closerGoals.length > 0 ? (
                  individualGoals.closerGoals
                    .sort((a, b) => b.percentage - a.percentage)
                    .map((vendedor, index) => {
                      const position = index + 1;
                      const PositionIcon = getPositionIcon(position);
                      const isTop3 = position <= 3;
                      
                      return (
                        <motion.div 
                          key={vendedor.id} 
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.05 }}
                          className={`flex items-center gap-4 p-3 rounded-xl border transition-all ${
                            isTop3 
                              ? `bg-gradient-to-r ${getPositionStyle(position)} bg-opacity-10 border-opacity-50` 
                              : "bg-muted/30 border-transparent"
                          }`}
                        >
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                            isTop3 ? `bg-gradient-to-br ${getPositionStyle(position)}` : "bg-muted"
                          }`}>
                            {PositionIcon ? (
                              <PositionIcon className={`w-5 h-5 ${isTop3 ? "text-white" : "text-muted-foreground"}`} />
                            ) : (
                              <span className="text-sm font-bold text-muted-foreground">{position}</span>
                            )}
                          </div>
                          <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center">
                            <span className="text-sm font-semibold text-accent-foreground">
                              {vendedor.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium truncate">{vendedor.name}</span>
                              <span className={`text-sm font-bold ${
                                vendedor.percentage >= 100 ? "text-success" : "text-muted-foreground"
                              }`}>
                                {vendedor.percentage}%
                              </span>
                            </div>
                            <div className="progress-bar">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(vendedor.percentage, 100)}%` }}
                                transition={{ duration: 0.6, delay: index * 0.1 }}
                                className={`progress-fill ${
                                  vendedor.percentage >= 100 ? "bg-success" : "gradient-gold"
                                }`}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              R$ {vendedor.current.toLocaleString("pt-BR")} / R$ {vendedor.goal.toLocaleString("pt-BR")}
                            </p>
                          </div>
                          {vendedor.percentage >= 80 && (
                            <div className="flex items-center gap-1 px-2 py-1 bg-orange-500/10 rounded-full">
                              <Flame className="w-4 h-4 text-orange-500" />
                            </div>
                          )}
                        </motion.div>
                      );
                    })
                ) : (
                  <p className="text-muted-foreground text-center py-4">Nenhuma meta individual para closers.</p>
                )}
              </CardContent>
            </Card>

            {/* SDRs Goals */}
            <Card className="glass-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-chart-5" />
                  Metas SDRs
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {individualLoading ? (
                  Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-20" />)
                ) : individualGoals?.sdrGoals && individualGoals.sdrGoals.length > 0 ? (
                  individualGoals.sdrGoals
                    .sort((a, b) => b.percentage - a.percentage)
                    .map((sdr, index) => {
                      const position = index + 1;
                      const PositionIcon = getPositionIcon(position);
                      const isTop3 = position <= 3;
                      
                      return (
                        <motion.div 
                          key={sdr.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.05 }}
                          className={`flex items-center gap-4 p-3 rounded-xl border transition-all ${
                            isTop3 
                              ? `bg-gradient-to-r ${getPositionStyle(position)} bg-opacity-10 border-opacity-50` 
                              : "bg-muted/30 border-transparent"
                          }`}
                        >
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                            isTop3 ? `bg-gradient-to-br ${getPositionStyle(position)}` : "bg-muted"
                          }`}>
                            {PositionIcon ? (
                              <PositionIcon className={`w-5 h-5 ${isTop3 ? "text-white" : "text-muted-foreground"}`} />
                            ) : (
                              <span className="text-sm font-bold text-muted-foreground">{position}</span>
                            )}
                          </div>
                          <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center">
                            <span className="text-sm font-semibold text-accent-foreground">
                              {sdr.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium truncate">{sdr.name}</span>
                              <span className={`text-sm font-bold ${
                                sdr.percentage >= 100 ? "text-success" : "text-muted-foreground"
                              }`}>
                                {sdr.percentage}%
                              </span>
                            </div>
                            <div className="progress-bar">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(sdr.percentage, 100)}%` }}
                                transition={{ duration: 0.6, delay: index * 0.1 }}
                                className={`progress-fill ${
                                  sdr.percentage >= 100 ? "bg-success" : "gradient-gold"
                                }`}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {sdr.current} / {sdr.goal} reuniões
                            </p>
                          </div>
                          {sdr.percentage >= 80 && (
                            <div className="flex items-center gap-1 px-2 py-1 bg-orange-500/10 rounded-full">
                              <Flame className="w-4 h-4 text-orange-500" />
                            </div>
                          )}
                        </motion.div>
                      );
                    })
                ) : (
                  <p className="text-muted-foreground text-center py-4">Nenhuma meta individual para SDRs.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ========== PREMIACOES TAB ========== */}
        <TabsContent value="premiacoes" className="space-y-6">
          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card p-6"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-success/10">
                  <Trophy className="w-6 h-6 text-success" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{achievements.filter(a => a.isUnlocked).length}</p>
                  <p className="text-sm text-muted-foreground">Conquistas Desbloqueadas</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="glass-card p-6"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-primary/10">
                  <Target className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{achievements.length - achievements.filter(a => a.isUnlocked).length}</p>
                  <p className="text-sm text-muted-foreground">Em Progresso</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass-card p-6"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-chart-5/10">
                  <Flame className="w-6 h-6 text-chart-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {achievements.length > 0 
                      ? Math.round((achievements.filter(a => a.isUnlocked).length / achievements.length) * 100) 
                      : 0}%
                  </p>
                  <p className="text-sm text-muted-foreground">Taxa de Conquista</p>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Admin add button */}
          {isAdmin && (
            <div className="flex justify-end">
              <Button onClick={() => { setEditingAward(null); setAwardDialogOpen(true); }}>
                <Plus className="w-4 h-4 mr-2" />
                Nova Premiação
              </Button>
            </div>
          )}

          {/* Achievements Grid */}
          {awardsLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-[140px] rounded-xl" />)}
            </div>
          ) : achievements.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <AnimatePresence mode="popLayout">
                {achievements.map((achievement, index) => (
                  <div key={achievement.award.id} className="relative">
                    <AchievementCard achievement={achievement} index={index} />
                    {isAdmin && (
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => { setEditingAward(achievement.award); setAwardDialogOpen(true); }}
                        >
                          <Edit2 className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => handleDeleteAward(achievement.award.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div className="text-center py-12 bg-muted/30 rounded-xl">
              <Gift className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-semibold">Nenhuma premiação configurada</h3>
              <p className="text-muted-foreground text-sm mt-1">
                {isAdmin ? "Clique em 'Nova Premiação' para criar." : "Aguarde o admin configurar as premiações."}
              </p>
            </div>
          )}
        </TabsContent>

        {/* ========== GESTÃO TAB (Admin only) ========== */}
        {isAdmin && (
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
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <span className="text-sm font-semibold text-primary">
                                {getMemberName(goal.team_member_id).split(" ").map((n) => n[0]).join("").slice(0, 2)}
                              </span>
                            </div>
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
    </div>
  );
}
