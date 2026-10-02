import { useState, useMemo, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import {
  Trophy, Target, Gift, TrendingUp, Star,
  Users, Plus, Edit2, Trash2, CheckCircle, Lock, Sparkles,
  CircleDollarSign, CalendarPlus, Handshake, Building2, Tv, type LucideIcon,
} from "lucide-react";
import { useActiveCompetition, useCompetitionParticipants, useCompetitionPrizes, useEndCompetition } from "@/modules/engagement/hooks/useCompetitions";
import { CompetitionPodiumV2 } from "@/modules/analytics/components/performance/CompetitionPodiumV2";
import {
  AlternadorVisao,
  ClassificacaoCompleta,
  MetasDoTime,
  MetasIndividuais,
  PodioHero,
  VidroCompeticao,
  VidroSemCompeticao,
  type LinhaClassificacao,
  type MetaComRealizado,
  type PessoaComMetas,
  type VisaoRanking,
} from "@/modules/analytics/components/performance/RankingV5";
import { CreateCompetitionModal } from "@/modules/analytics/components/performance/CreateCompetitionModal";
import { useRankingTransitions } from "@/modules/engagement/hooks/useRankingTransitions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useAvatarMap } from "@/modules/identity/hooks/useAvatarMap";
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
import { ProgressRing } from "@/modules/engagement/components/gamification/ProgressRing";
import { AchievementBadge, BadgeType } from "@/modules/engagement/components/gamification/AchievementBadge";
import { CelebrationEffect } from "@/modules/engagement/components/gamification/CelebrationEffect";
import { useTeamGoals, useGoals, useCreateGoal, useUpdateGoal, Goal } from "@/modules/engagement/hooks/useGoals";
import { useAwards, useCreateAward, useUpdateAward, useDeleteAward, Award as AwardType } from "@/modules/engagement/hooks/useAwards";
import type { RankingSourceEntry } from "@/modules/analytics/hooks/useDashboardMetrics";
import { useDashboardMetrics, useRankingData } from "@/modules/analytics/hooks/useDashboardMetrics";
import { MovimentacoesPanel } from "@/modules/analytics/components/performance/MovimentacoesPanel";
import { useTeamMembers, isVirtualTeamMember, type TeamMember } from "@/modules/identity";
import { filterVisibleRanking } from "@/lib/visible-ranking";
import { useUserRole, useFeaturePermission } from "@/modules/identity";
import { useOrganization } from "@/modules/identity";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { resolveMeetingGoals } from "@/modules/engagement/lib/goal-progress";
import { IconChip, KpiTile, ValueUnit } from "@/components/ui/bento";
import { Link } from "react-router-dom";

// ============ CONSTANTS ============
const months = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

// V5: o ícone do tipo de meta era emoji; virou ícone lucide (mesmo papel).
const goalTypes: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "faturamento", label: "Faturamento", icon: CircleDollarSign },
  { value: "clientes", label: "Novos Clientes", icon: Users },
  { value: "reunioes_marcadas", label: "Reuniões Marcadas", icon: CalendarPlus },
  { value: "reunioes_realizadas", label: "Reuniões Realizadas", icon: Handshake },
  { value: "conversao", label: "Taxa de Conversão", icon: TrendingUp },
  { value: "vendas", label: "Vendas (Individual)", icon: Target },
];

const awardTypeLabels: Record<string, { label: string; icon: typeof Trophy; color: string }> = {
  meta_mensal: { label: "Meta Mensal", icon: Target, color: "text-primary" },
  campeonato: { label: "Campeonato", icon: Trophy, color: "text-insights" },
  bonus: { label: "Bônus", icon: Star, color: "text-success" },
  especial: { label: "Especial", icon: Gift, color: "text-warning-strong" },
};

// ============ INTERFACES ============

interface RankingUser {
  id: string;
  name: string;
  role: string;
  value: number;
  goal?: number;
  conversions?: number;
  meetings?: number;
  meetingsBooked?: number;
  goalBooked?: number;
  goalBookedProgress?: number;
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

// ============ SUB-COMPONENTS ============

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
          "relative overflow-hidden rounded-2xl border p-4 cursor-pointer transition-all duration-300",
          achievement.isUnlocked
            ? "bg-primary-soft/60 border-primary/30 hover:shadow-relevo-alto"
            : "bg-card border-card-border shadow-relevo hover:border-foreground/20"
        )}
      >
        {achievement.isUnlocked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-primary/5"
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
                <Sparkles className="w-4 h-4 text-primary-soft-foreground" />
              </motion.div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-sm truncate">{achievement.award.name}</h3>
              <Badge
                variant={achievement.isUnlocked ? "success" : "soft"}
                className="text-[10px] shrink-0 tabular-nums"
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
                <span className="text-xs tabular-nums text-muted-foreground">
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
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal?: Goal | null;
  teamMembers: TeamMember[];
  selectedMonth: number;
  selectedYear: number;
  onSave: (data: GoalFormData) => void;
  /** V5: excluir mora dentro do diálogo de edição (saiu do cartão da meta). */
  onDelete?: (id: string) => void;
}) {
  const [formData, setFormData] = useState<GoalFormData>({
    name: goal?.name || "",
    type: goal?.type || "faturamento",
    target_value: goal?.target_value || 0,
    team_member_id: goal?.team_member_id || null,
    month: goal?.month || selectedMonth,
    year: goal?.year || selectedYear,
  });

  // O dialog fica sempre montado, então o initializer do useState só roda uma vez
  // (com goal=null). Ao abrir para editar uma meta existente, é preciso resincronizar
  // o form com o goal recebido — senão os campos ficam zerados e o Salvar reseta a meta.
  useEffect(() => {
    if (!open) return;
    setFormData({
      name: goal?.name || "",
      type: goal?.type || "faturamento",
      target_value: goal?.target_value || 0,
      team_member_id: goal?.team_member_id || null,
      month: goal?.month || selectedMonth,
      year: goal?.year || selectedYear,
    });
  }, [open, goal, selectedMonth, selectedYear]);

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
                {goalTypes.map(({ value, label, icon: TypeIcon }) => (
                  <SelectItem key={value} value={value}>
                    <TypeIcon className="mr-2 inline h-4 w-4 align-[-3px] text-muted-foreground" aria-hidden />
                    {label}
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
                <SelectItem value="team">
                  <Building2 className="mr-2 inline h-4 w-4 align-[-3px] text-muted-foreground" aria-hidden />
                  Meta do Time
                </SelectItem>
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
            {goal && onDelete && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto"
                onClick={() => { onOpenChange(false); onDelete(goal.id); }}
              >
                <Trash2 />
                Excluir meta
              </Button>
            )}
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
  const [editingCompetition, setEditingCompetition] = useState(false);
  const [cancelCompetitionOpen, setCancelCompetitionOpen] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [aba, setAba] = useState("ranking_vendas");
  const [visao, setVisao] = useState<VisaoRanking>("venda");
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
  const endCompetition = useEndCompetition();

  const handleCancelCompetition = useCallback(async () => {
    if (!activeCompetition) return;
    try {
      await endCompetition.mutateAsync(activeCompetition.id);
      toast.success("Competição cancelada.");
    } catch (err: any) {
      toast.error("Erro ao cancelar competição: " + (err?.message || ""));
    } finally {
      setCancelCompetitionOpen(false);
    }
  }, [activeCompetition, endCompetition]);

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
  // `name` vem nullable do banco e `RankingUser` exige string porque é o que a
  // UI renderiza. O fallback é resolvido AQUI, na fronteira — não afrouxando o
  // tipo da UI nem fingindo que o banco garante nome.
  const toRankingUsers = (entries: RankingSourceEntry[]): RankingUser[] =>
    entries.map((u) => ({ ...u, name: u.name ?? "Sem nome" }));

  const closers: RankingUser[] = useMemo(
    () => toRankingUsers(filterVisibleRanking(rankingData?.salesRanking, visibleMemberIds)),
    [rankingData, visibleMemberIds]
  );
  const sdrs: RankingUser[] = useMemo(
    () => toRankingUsers(filterVisibleRanking(rankingData?.meetingsRanking, visibleMemberIds)),
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

    // salesRanking e meetingsRanking têm shapes diferentes (um traz
    // `conversions`, outro `meetings`/`meetingsBooked`). Sem um tipo comum, o
    // ternário produz união e ler qualquer campo exclusivo quebra. Este é o
    // superset estrutural: os campos divergentes entram opcionais, e os
    // dois shapes são atribuíveis a ele sem cast.
    const source: RankingSourceEntry[] = activeCompetition.metric_type === "sales"
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

  const podiumPrizes = prizes.map(p => ({
    position: p.position,
    prize_name: p.prize_name,
    prize_icon: p.prize_icon,
    prize_value: p.prize_value,
  }));

  // Goals calculations
  const faturamentoGoal = teamGoals?.find((g) => g.type === "faturamento");
  const clientesGoal = teamGoals?.find((g) => g.type === "clientes");
  // Metas de reunião: tipos novos (marcadas/realizadas) + legado 'reunioes' = realizadas (ADR-0007)
  const meetingGoals = resolveMeetingGoals(teamGoals ?? [], {
    reunioesMarcadas: metrics?.reunioesMarcadas || 0,
    reunioesComparecidas: metrics?.reunioesComparecidas || 0,
  });
  const currentFaturamento = metrics?.vendaTotal || 0;
  const currentClientes = metrics?.novosClientes || 0;

  const faturamentoProgress = faturamentoGoal 
    ? (currentFaturamento / faturamentoGoal.target_value) * 100 
    : 0;
  const clientesProgress = clientesGoal 
    ? (currentClientes / clientesGoal.target_value) * 100 
    : 0;
  const reunioesProgress = meetingGoals.realizadas?.progress ?? 0;
  const reunioesMarcadasProgress = meetingGoals.marcadas?.progress ?? 0;
  void reunioesProgress; void reunioesMarcadasProgress; // exibição detalhada: issue #753 fase UI

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
    return goalTypes.find(t => t.value === type) || { value: type, label: type, icon: Target };
  };

  const formatValue = (type: string, value: number) => {
    if (type === "faturamento" || type === "vendas") {
      return `R$ ${value.toLocaleString("pt-BR")}`;
    }
    if (type === "conversao") return `${value}%`;
    return value.toString();
  };

  // ── V5: pódio + competição numa tinta, classificação completa, metas com anel ──
  const mesLabel = months[selectedMonth - 1].toLowerCase();
  // Cargo da pessoa (job_title). O `role` do RPC às vezes é a função do enum
  // ("admin", "member") — isso não é cargo e não vai para a tela.
  const subDe = (id: string, role?: string | null) =>
    teamMembers.find((m) => m.id === id)?.job_title?.trim() ||
    (role && !["admin", "member", "master", "Vendas"].includes(role) ? role : undefined);

  const rankingVisao: RankingUser[] = visao === "venda" ? closers : sdrs;
  const metricaVisao: "sales" | "meetings" = visao === "venda" ? "sales" : "meetings";
  const valorVisao = (u: RankingUser) => (visao === "venda" ? u.value : (u.meetings ?? u.value));

  const podioMetric: "sales" | "meetings" = activeCompetition ? activeCompetition.metric_type : metricaVisao;
  const podioUsuarios = activeCompetition
    ? compPodiumUsers.map((u) => ({
        id: u.id,
        name: u.name,
        value: u.value,
        goalProgress: u.goalProgress,
        position: u.position,
        avatarUrl: u.avatarUrl,
        sub: subDe(u.id, u.role),
        count: u.conversions,
      }))
    : rankingVisao.slice(0, 3).map((u) => ({
        id: u.id,
        name: u.name,
        value: valorVisao(u),
        goalProgress: u.goalProgress,
        position: u.position,
        avatarUrl: avatarMap.get(u.id),
        sub: subDe(u.id, u.role),
        count: u.conversions,
      }));

  const linhasClassificacao: LinhaClassificacao[] = activeCompetition
    ? competitionRanking.map((u) => ({
        id: u.id,
        name: u.name,
        sub: subDe(u.id, u.role),
        avatarUrl: u.avatarUrl,
        position: u.position,
        value: podioMetric === "sales" ? u.value : u.meetings || u.value,
        conversions: u.conversions,
        goal: u.goal,
        goalProgress: u.goalProgress,
        delta: rankingTransitions.getChange(u.id)?.delta,
      }))
    : rankingVisao.map((u) => ({
        id: u.id,
        name: u.name,
        sub: subDe(u.id, u.role),
        avatarUrl: avatarMap.get(u.id),
        position: u.position,
        value: valorVisao(u),
        conversions: u.conversions,
        meetingsBooked: u.meetingsBooked,
        goal: (u as RankingUser & { goal?: number }).goal,
        goalProgress: u.goalProgress,
      }));

  const faltaFaturamento = faturamentoGoal ? Math.max(faturamentoGoal.target_value - currentFaturamento, 0) : 0;
  const metaDoTimeTile = (
    <KpiTile
      className="h-full"
      label="Meta do time"
      icon={Target}
      tone="gold"
      value={
        faturamentoGoal ? (
          <>
            {Math.round(faturamentoProgress)}
            <ValueUnit>%</ValueUnit>
          </>
        ) : (
          "—"
        )
      }
      note={
        faturamentoGoal
          ? faltaFaturamento > 0
            ? `faltam R$ ${Math.round(faltaFaturamento).toLocaleString("pt-BR")}`
            : "meta de faturamento batida"
          : "meta de faturamento não configurada"
      }
    >
      {faturamentoGoal && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(faturamentoProgress, 100)}%` }} />
        </div>
      )}
    </KpiTile>
  );

  // Gestão — realizado do mês por tipo de meta (os mesmos números de antes).
  const realizadoDoTipo = (type: string): number | null => {
    if (type === "faturamento") return currentFaturamento;
    if (type === "clientes") return currentClientes;
    if (type === "reunioes_marcadas") return metrics?.reunioesMarcadas ?? 0;
    if (type === "reunioes_realizadas" || type === "reunioes") return metrics?.reunioesComparecidas ?? 0;
    if (type === "conversao") return metrics?.taxaConversao ?? 0;
    return null;
  };
  const metasDoTime: MetaComRealizado[] = teamGoalsFiltered.map((goal) => ({
    goal,
    rotulo: getGoalTypeInfo(goal.type).label,
    realizado: realizadoDoTipo(goal.type),
    formatar: (v: number) =>
      goal.type === "faturamento" || goal.type === "vendas"
        ? v >= 1000
          ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
          : `R$ ${Math.round(v).toLocaleString("pt-BR")}`
        : goal.type === "conversao"
          ? `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
          : Math.round(v).toLocaleString("pt-BR"),
  }));

  const rankingPorPessoa = new Map<string, RankingUser>([...closers, ...sdrs].map((u) => [u.id, u]));
  const pessoasComMetas: PessoaComMetas[] = Array.from(
    individualGoalsFiltered.reduce((acc, g) => {
      const id = g.team_member_id as string;
      acc.set(id, [...(acc.get(id) ?? []), g]);
      return acc;
    }, new Map<string, Goal[]>()),
  )
    .map(([id, goals]) => {
      const r = rankingPorPessoa.get(id);
      const vendas = r ? closers.some((c) => c.id === id) : false;
      return {
        id,
        name: getMemberName(id),
        sub: subDe(id, r?.role),
        avatarUrl: avatarMap.get(id),
        progresso: r?.goal ? r.goalProgress : null,
        realizadoTexto: r
          ? vendas
            ? `R$ ${Math.round(r.value).toLocaleString("pt-BR")}`
            : `${r.meetings ?? r.value} reuniões`
          : undefined,
        metas: goals.map((goal) => ({
          goal,
          rotulo: getGoalTypeInfo(goal.type).label,
          alvo: formatValue(goal.type, goal.target_value),
        })),
      };
    })
    .sort((a, b) => (b.progresso ?? -1) - (a.progresso ?? -1));

  return (
    <>
      {/* V5: a página inteira mora dentro do <Tabs> — Radix só exige que a lista
          (no cabeçalho) e os conteúdos estejam sob o mesmo Root. Mesmos values. */}
      <Tabs value={aba} onValueChange={setAba} className="space-y-5">
        <PageHeader
          title="Ranking de Vendas"
          subtitle="Acompanhe a competição do time"
          actions={
            <>
              <Select 
                value={selectedMonth.toString()} 
                onValueChange={(v) => setSelectedMonth(Number(v))}
              >
                <SelectTrigger className="w-[130px]" aria-label="Mês">
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
                <SelectTrigger className="w-[90px]" aria-label="Ano">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[2024, 2025, 2026, 2027].map(year => (
                    <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {aba === "gestao" ? (
                <Button onClick={() => { setEditingGoal(null); setGoalDialogOpen(true); }}>
                  <Plus />
                  Nova Meta
                </Button>
              ) : (
                <Button variant="ink" asChild>
                  <Link to="/tv">
                    <Tv />
                    Modo TV
                  </Link>
                </Button>
              )}
            </>
          }
          tabs={
            // Com uma aba só (sem permissão de gestão) a pílula repetiria o
            // título; ela só aparece quando há para onde navegar.
            canManageGoals ? (
              <TabsList variant="pill" aria-label="Seções do ranking">
                <TabsTrigger value="ranking_vendas">
                  <Trophy className="h-3.5 w-3.5" />
                  Ranking de Vendas
                </TabsTrigger>
                <TabsTrigger value="gestao">
                  <Users className="h-3.5 w-3.5" />
                  Gestão
                </TabsTrigger>
              </TabsList>
            ) : undefined
          }
        />

        {/* ========== RANKING VENDAS TAB ========== */}
        <TabsContent value="ranking_vendas" className="mt-0 space-y-5">
          {/* Movimentações do mês do cabeçalho — conta por data de movimentação
              (evento no ledger), não por criação do lead. Antes tinha seletor
              próprio e aparecia também na aba Gestão. */}
          <MovimentacoesPanel
            mesAno={{ month: selectedMonth, year: selectedYear, label: mesLabel }}
            extra={metaDoTimeTile}
          />

          <PodioHero
            titulo={`Pódio de ${mesLabel}`}
            count={
              activeCompetition
                ? `${activeCompetition.metric_type === "sales" ? "Venda" : "Reuniões"} · competição`
                : visao === "venda"
                  ? "Venda · valor fechado"
                  : "Pré-venda · reuniões realizadas"
            }
            actions={!activeCompetition ? <AlternadorVisao value={visao} onChange={setVisao} naTinta /> : undefined}
            podio={
              podioUsuarios.length > 0 ? (
                <CompetitionPodiumV2
                  users={podioUsuarios}
                  prizes={activeCompetition ? podiumPrizes : []}
                  metricType={podioMetric}
                  getChange={activeCompetition ? rankingTransitions.getChange : undefined}
                  isAnimatingTransitions={activeCompetition ? rankingTransitions.isAnimating : false}
                  previousRanking={activeCompetition ? rankingTransitions.previousRanking : null}
                />
              ) : (
                <p className="py-12 text-center text-[13px] text-tinta-muted">
                  {isLoading ? "Carregando o ranking…" : "Ninguém pontuou neste mês ainda."}
                </p>
              )
            }
            lateral={
              activeCompetition ? (
                <VidroCompeticao
                  competition={activeCompetition}
                  participantes={visibleParticipantsCount}
                  premios={podiumPrizes}
                  top3={competitionRanking.slice(0, 3).map((u) => ({ id: u.id, name: u.name, value: u.value }))}
                />
              ) : (
                <VidroSemCompeticao
                  onCriar={() => setShowCreateCompetition(true)}
                  onDemo={handleSeedCompetition}
                  criandoDemo={isSeeding}
                />
              )
            }
          />

          <ClassificacaoCompleta
            linhas={linhasClassificacao}
            metrica={podioMetric}
            subtitulo={
              activeCompetition
                ? `${activeCompetition.name} · ${months[selectedMonth - 1]} ${selectedYear}`
                : `${visao === "venda" ? "Venda · valor fechado no mês" : "Pré-venda · reuniões no mês"} · ${months[selectedMonth - 1]} ${selectedYear}`
            }
            alternador={!activeCompetition ? <AlternadorVisao value={visao} onChange={setVisao} /> : undefined}
            mostrarPosicao={!!activeCompetition}
          />
        </TabsContent>

        {/* ========== GESTÃO TAB (Admin only) ========== */}
        {canManageGoals && (
          <TabsContent value="gestao" className="mt-0 space-y-5">
            <div>
              <h2 className="text-[17px] font-bold tracking-[-0.02em]">Gestão de Metas</h2>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                Metas de {mesLabel} de {selectedYear} · apenas administradores editam · valem para o ranking e as comissões
              </p>
            </div>

            <section className="space-y-2.5">
              <p className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
                Metas do time
                <span className="normal-case tracking-normal">
                  {teamGoalsFiltered.length} {teamGoalsFiltered.length === 1 ? "meta ativa" : "metas ativas"}
                </span>
              </p>
              {teamGoalsFiltered.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-[13px] text-muted-foreground">
                    Nenhuma meta do time configurada para {months[selectedMonth - 1]} {selectedYear}.
                  </CardContent>
                </Card>
              ) : (
                <MetasDoTime
                  metas={metasDoTime}
                  onEditar={(g) => { setEditingGoal(g); setGoalDialogOpen(true); }}
                />
              )}
            </section>

            <MetasIndividuais
              pessoas={pessoasComMetas}
              onNova={() => { setEditingGoal(null); setGoalDialogOpen(true); }}
              onEditar={(g) => { setEditingGoal(g); setGoalDialogOpen(true); }}
              onExcluir={(id) => setDeleteGoalId(id)}
            />

            {/* Competition Management */}
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start gap-3 space-y-0 pb-3">
                <div className="min-w-[12rem] flex-1">
                  <CardTitle className="flex items-center gap-2 text-[15px] tracking-[-0.02em]">
                    <IconChip icon={Trophy} tone="gold" />
                    Competição do Mês
                  </CardTitle>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">Aparece no Ranking, no Comando e no Modo TV</p>
                </div>
                {activeCompetition ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditingCompetition(true)}>
                      <Edit2 />
                      Editar
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setCancelCompetitionOpen(true)}>
                      <Trash2 />
                      Cancelar competição
                    </Button>
                  </div>
                ) : (
                  <Button onClick={() => setShowCreateCompetition(true)} variant="ink" size="sm">
                    <Plus />
                    Criar Competição
                  </Button>
                )}
              </CardHeader>
              {activeCompetition ? (
                <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[1.2rem] font-extrabold tracking-[-0.03em]">{activeCompetition.name}</span>
                      <Badge variant="success" className="text-[10px] font-bold uppercase tracking-[.06em]">Ativo</Badge>
                    </div>
                    <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                      <div className="rounded-2xl bg-sunken p-3">
                        <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Tipo</p>
                        <p className="mt-0.5 font-semibold">{activeCompetition.metric_type === "sales" ? "Vendas" : "Reuniões"}</p>
                      </div>
                      <div className="rounded-2xl bg-sunken p-3">
                        <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Critério</p>
                        <p className="mt-0.5 font-semibold">{activeCompetition.criteria === "absolute_value" ? "Valor absoluto" : "% da meta"}</p>
                      </div>
                      <div className="rounded-2xl bg-sunken p-3">
                        <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Participantes</p>
                        <p className="mt-0.5 font-semibold tabular-nums">{visibleParticipantsCount} vendedores</p>
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
                        <Users className="h-3.5 w-3.5" />
                        Participantes
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {participants
                          .filter((p) => visibleMemberIds.has(p.team_member_id) && !isVirtualTeamMember(p.team_member_id))
                          .map((p) => {
                            const member = teamMembers.find(m => m.id === p.team_member_id);
                            return (
                              <div key={p.id} className="flex items-center gap-2 rounded-full bg-muted py-1 pl-1 pr-3">
                                <UserAvatar name={member?.name || "?"} avatarUrl={avatarMap.get(p.team_member_id)} size="xs" />
                                <span className="text-sm font-medium">{member?.name || "Desconhecido"}</span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
                      <Gift className="h-3.5 w-3.5" />
                      Prêmios por Colocação
                    </p>
                    <div className="space-y-2">
                      {prizes.length === 0 ? (
                        <p className="text-[13px] text-muted-foreground">Nenhum prêmio configurado.</p>
                      ) : (
                        [...prizes].sort((a, b) => a.position - b.position).map((prize) => (
                          <div key={prize.id} className="flex items-center justify-between gap-3 rounded-2xl bg-sunken p-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="text-lg">{prize.prize_icon}</span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{prize.position}º Lugar — {prize.prize_name}</p>
                                {prize.prize_description && (
                                  <p className="text-xs text-muted-foreground">{prize.prize_description}</p>
                                )}
                              </div>
                            </div>
                            {prize.prize_value != null && (
                              <span className="shrink-0 text-sm font-extrabold tabular-nums">
                                R$ {prize.prize_value.toLocaleString("pt-BR")}
                              </span>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </CardContent>
              ) : (
                <CardContent className="flex flex-col items-center py-8 text-center">
                  <span className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
                    <Trophy className="h-5 w-5" />
                  </span>
                  <p className="text-sm font-semibold">Nenhuma competição ativa para {months[selectedMonth - 1]} {selectedYear}.</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">Crie uma competição para motivar o time.</p>
                </CardContent>
              )}
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
        onDelete={(id) => setDeleteGoalId(id)}
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
            <AlertDialogAction
              onClick={handleDeleteGoal}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cancelCompetitionOpen} onOpenChange={setCancelCompetitionOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar competição?</AlertDialogTitle>
            <AlertDialogDescription>
              A competição "{activeCompetition?.name}" será encerrada sem vencedor e sairá do ranking.
              Os prêmios não serão distribuídos. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelCompetition}
              disabled={endCompetition.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancelar competição
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Criação de competição */}
      <CreateCompetitionModal
        open={showCreateCompetition}
        onOpenChange={setShowCreateCompetition}
      />

      {/* Edição da competição ativa */}
      <CreateCompetitionModal
        open={editingCompetition}
        onOpenChange={setEditingCompetition}
        competition={editingCompetition ? activeCompetition : null}
        existingParticipants={participants.map((p) => p.team_member_id)}
        existingPrizes={prizes.map((p) => ({
          position: p.position,
          prize_name: p.prize_name,
          prize_value: p.prize_value,
          prize_icon: p.prize_icon,
        }))}
      />
    </>
  );
}
