import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gift, Trophy, Star, Plus, Trash2, Edit2, Target, Award, Flame, Crown, Sparkles, Lock, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAwards, useCreateAward, useUpdateAward, useDeleteAward, Award as AwardType } from "@/hooks/useAwards";
import { useUserRole } from "@/hooks/useUserRole";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import { ProgressRing } from "@/components/gamification/ProgressRing";
import { CelebrationEffect } from "@/components/gamification/CelebrationEffect";
import { cn } from "@/lib/utils";

const awardTypeLabels: Record<string, { label: string; icon: typeof Trophy; color: string }> = {
  meta_mensal: { label: "Meta Mensal", icon: Target, color: "text-primary" },
  campeonato: { label: "Campeonato", icon: Trophy, color: "text-chart-5" },
  bonus: { label: "Bônus", icon: Star, color: "text-success" },
  especial: { label: "Especial", icon: Gift, color: "text-chart-4" },
};

interface AchievementProgress {
  award: AwardType;
  currentValue: number;
  progress: number;
  isUnlocked: boolean;
}

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
          "relative overflow-hidden rounded-2xl border p-6 cursor-pointer transition-all duration-300",
          achievement.isUnlocked
            ? "bg-gradient-to-br from-primary/10 via-background to-chart-5/10 border-primary/30 hover:shadow-lg hover:shadow-primary/10"
            : "bg-card border-border hover:border-muted-foreground/30"
        )}
      >
        {/* Background glow for unlocked */}
        {achievement.isUnlocked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-chart-5/5"
          />
        )}

        <div className="relative z-10 flex items-start gap-4">
          {/* Progress Ring */}
          <div className="relative">
            <ProgressRing
              progress={Math.min(achievement.progress, 100)}
              size={70}
              strokeWidth={6}
              color={achievement.isUnlocked ? "success" : "primary"}
            >
              <div
                className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center transition-all",
                  achievement.isUnlocked
                    ? "bg-success/20"
                    : "bg-muted"
                )}
              >
                {achievement.isUnlocked ? (
                  <CheckCircle className="w-6 h-6 text-success" />
                ) : (
                  <Icon className={cn("w-6 h-6", typeConfig.color)} />
                )}
              </div>
            </ProgressRing>
            {achievement.isUnlocked && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -top-1 -right-1"
              >
                <Sparkles className="w-5 h-5 text-chart-5" />
              </motion.div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-base truncate">{achievement.award.name}</h3>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs shrink-0",
                  achievement.isUnlocked ? "bg-success/10 text-success border-success/30" : ""
                )}
              >
                {achievement.isUnlocked ? "Conquistado!" : typeConfig.label}
              </Badge>
            </div>

            {achievement.award.description && (
              <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                {achievement.award.description}
              </p>
            )}

            {/* Progress bar */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {achievement.award.type === "meta_mensal"
                    ? `R$ ${achievement.currentValue.toLocaleString("pt-BR")} / R$ ${achievement.award.threshold.toLocaleString("pt-BR")}`
                    : `${achievement.currentValue} / ${achievement.award.threshold}`}
                </span>
                <span className="font-medium">{Math.round(achievement.progress)}%</span>
              </div>
              <Progress
                value={Math.min(achievement.progress, 100)}
                className="h-2"
              />
            </div>

            {/* Prize */}
            {achievement.award.prize_value && (
              <div className="flex items-center gap-2 mt-3">
                <div className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5",
                  achievement.isUnlocked
                    ? "bg-success/20 text-success"
                    : "bg-muted text-muted-foreground"
                )}>
                  <Gift className="w-3.5 h-3.5" />
                  R$ {achievement.award.prize_value.toLocaleString("pt-BR")}
                </div>
                {achievement.award.prize_description && (
                  <span className="text-xs text-muted-foreground truncate">
                    {achievement.award.prize_description}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Lock icon for locked achievements */}
          {!achievement.isUnlocked && achievement.progress < 50 && (
            <div className="absolute top-4 right-4 opacity-20">
              <Lock className="w-6 h-6" />
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}

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
              <Label htmlFor="name">Nome da Premiação</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Ex: Closer do Mês"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="type">Tipo</Label>
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
              <Label htmlFor="description">Descrição</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Descreva a premiação..."
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="threshold">Meta/Threshold</Label>
                <Input
                  id="threshold"
                  type="number"
                  value={formData.threshold}
                  onChange={(e) => setFormData({ ...formData, threshold: Number(e.target.value) })}
                  placeholder="0"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="prize_value">Valor do Prêmio (R$)</Label>
                <Input
                  id="prize_value"
                  type="number"
                  value={formData.prize_value}
                  onChange={(e) => setFormData({ ...formData, prize_value: Number(e.target.value) })}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="prize_description">Descrição do Prêmio</Label>
              <Textarea
                id="prize_description"
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

export default function Premiacoes() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAward, setEditingAward] = useState<AwardType | null>(null);

  const now = new Date();
  const { data: awards, isLoading } = useAwards(now.getMonth() + 1, now.getFullYear());
  const { data: userRole } = useUserRole();
  const { data: metrics } = useDashboardMetrics(now.getMonth() + 1, now.getFullYear());
  const createAward = useCreateAward();
  const updateAward = useUpdateAward();
  const deleteAward = useDeleteAward();

  const isAdmin = userRole?.role === "admin";

  // Calculate achievement progress
  const achievements: AchievementProgress[] = useMemo(() => {
    if (!awards) return [];

    return awards.map((award) => {
      let currentValue = 0;
      
      // Calculate current value based on award type
      if (award.type === "meta_mensal") {
        currentValue = metrics?.vendaTotal || 0;
      } else if (award.type === "campeonato") {
        currentValue = metrics?.novosClientes || 0;
      } else if (award.type === "bonus") {
        currentValue = metrics?.reunioesComparecidas || 0;
      } else {
        currentValue = metrics?.totalLeads || 0;
      }

      const progress = award.threshold > 0 
        ? (currentValue / award.threshold) * 100 
        : 0;

      return {
        award,
        currentValue,
        progress,
        isUnlocked: progress >= 100,
      };
    }).sort((a, b) => {
      // Sort: unlocked first, then by progress
      if (a.isUnlocked && !b.isUnlocked) return -1;
      if (!a.isUnlocked && b.isUnlocked) return 1;
      return b.progress - a.progress;
    });
  }, [awards, metrics]);

  const unlockedCount = achievements.filter(a => a.isUnlocked).length;
  const totalCount = achievements.length;

  const handleSave = (data: Omit<AwardType, "id" | "created_at">) => {
    if (editingAward) {
      updateAward.mutate({ id: editingAward.id, ...data });
    } else {
      createAward.mutate(data);
    }
    setEditingAward(null);
  };

  const handleEdit = (award: AwardType) => {
    setEditingAward(award);
    setDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("Tem certeza que deseja excluir esta premiação?")) {
      deleteAward.mutate(id);
    }
  };

  const handleNewAward = () => {
    setEditingAward(null);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-bold flex items-center gap-2"
          >
            <Gift className="w-6 h-6 text-primary" />
            Premiações
          </motion.h1>
          <p className="text-muted-foreground mt-1">
            Conquiste premiações e desbloqueie recompensas
          </p>
        </div>
        {isAdmin && (
          <Button onClick={handleNewAward} className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Nova Premiação
          </Button>
        )}
      </div>

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
              <p className="text-2xl font-bold">{unlockedCount}</p>
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
              <p className="text-2xl font-bold">{totalCount - unlockedCount}</p>
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
                {totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0}%
              </p>
              <p className="text-sm text-muted-foreground">Taxa de Conquista</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Achievements Grid */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array(4).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-[180px] rounded-xl" />
          ))}
        </div>
      ) : achievements.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          <AnimatePresence mode="popLayout">
            {achievements.map((achievement, index) => (
              <AchievementCard
                key={achievement.award.id}
                achievement={achievement}
                index={index}
              />
            ))}
          </AnimatePresence>

          {/* Admin edit/delete buttons */}
          {isAdmin && (
            <div className="md:col-span-2 space-y-2">
              <p className="text-sm text-muted-foreground mb-3">
                Gerenciar Premiações (Admin)
              </p>
              <div className="flex flex-wrap gap-2">
                {awards?.map((award) => (
                  <div key={award.id} className="flex items-center gap-1 bg-muted rounded-lg px-3 py-1.5">
                    <span className="text-sm">{award.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleEdit(award)}
                    >
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive"
                      onClick={() => handleDelete(award.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-muted/50 rounded-xl p-12 text-center"
        >
          <Gift className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">Nenhuma premiação configurada</h3>
          <p className="text-muted-foreground mb-4">
            Crie premiações para motivar e engajar o time.
          </p>
          {isAdmin && (
            <Button onClick={handleNewAward}>
              <Plus className="w-4 h-4 mr-2" />
              Criar Primeira Premiação
            </Button>
          )}
        </motion.div>
      )}

      {/* Form Dialog */}
      <AwardFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        award={editingAward}
        onSave={handleSave}
      />
    </div>
  );
}