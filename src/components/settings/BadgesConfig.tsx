/**
 * Componente de configuração de badges para AGENCY em orgs OUTBOUND.
 * Permite criar, visualizar e deletar badges customizados.
 * Badges do sistema (is_system=true) são exibidos mas não podem ser deletados.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Plus,
  Trash2,
  Trophy,
  Flame,
  Target,
  Star,
  Zap,
  Award,
  Crown,
  Shield,
  MoreHorizontal,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBadges, useCreateBadge, useDeleteBadge } from "@/hooks/useBadges";
import { toast } from "sonner";

const ICON_OPTIONS: { value: string; label: string; icon: React.ReactNode }[] = [
  { value: "flame", label: "Chama", icon: <Flame className="w-4 h-4" /> },
  { value: "target", label: "Alvo", icon: <Target className="w-4 h-4" /> },
  { value: "trophy", label: "Troféu", icon: <Trophy className="w-4 h-4" /> },
  { value: "star", label: "Estrela", icon: <Star className="w-4 h-4" /> },
  { value: "zap", label: "Raio", icon: <Zap className="w-4 h-4" /> },
  { value: "award", label: "Medalha", icon: <Award className="w-4 h-4" /> },
  { value: "crown", label: "Coroa", icon: <Crown className="w-4 h-4" /> },
  { value: "shield", label: "Escudo", icon: <Shield className="w-4 h-4" /> },
];

const CRITERIA_OPTIONS: { value: string; label: string }[] = [
  { value: "leads_quentes", label: "Leads Quentes (agendamentos)" },
  { value: "vendas_count", label: "Quantidade de Vendas" },
  { value: "faturamento_total", label: "Faturamento Total (R$)" },
  { value: "vendas_recorrentes", label: "Vendas Recorrentes" },
];

const ICON_MAP: Record<string, React.ElementType> = {
  flame: Flame,
  target: Target,
  trophy: Trophy,
  star: Star,
  zap: Zap,
  award: Award,
  crown: Crown,
  shield: Shield,
};

export function BadgesConfig() {
  const { data: badges = [], isLoading } = useBadges();
  const createBadge = useCreateBadge();
  const deleteBadge = useDeleteBadge();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteBadgeId, setDeleteBadgeId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    icon: "trophy",
    criteria_type: "vendas_count",
    criteria_value: 10,
  });

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    if (formData.criteria_value <= 0) {
      toast.error("O valor da meta deve ser maior que zero");
      return;
    }

    try {
      await createBadge.mutateAsync({
        name: formData.name,
        description: formData.description || undefined,
        icon: formData.icon,
        criteria_type: formData.criteria_type,
        criteria_value: formData.criteria_value,
      });
      toast.success("Badge criado!");
      setIsDialogOpen(false);
      setFormData({
        name: "",
        description: "",
        icon: "trophy",
        criteria_type: "vendas_count",
        criteria_value: 10,
      });
    } catch (error) {
      toast.error("Erro ao criar badge");
      console.error(error);
    }
  };

  const handleDelete = async () => {
    if (!deleteBadgeId) return;
    try {
      await deleteBadge.mutateAsync(deleteBadgeId);
      toast.success("Badge removido!");
      setDeleteBadgeId(null);
    } catch (error) {
      toast.error("Erro ao remover badge");
      console.error(error);
    }
  };

  const systemBadges = badges.filter((b) => b.is_system);
  const customBadges = badges.filter((b) => !b.is_system);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Badges / Conquistas</h3>
          <p className="text-sm text-muted-foreground">
            Gerencie as conquistas que os clientes podem desbloquear
          </p>
        </div>
        <Button onClick={() => setIsDialogOpen(true)} size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          Novo Badge
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          {/* Badges do Sistema */}
          {systemBadges.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  Badges do Sistema
                </h4>
                <Badge variant="outline" className="text-xs">
                  <Lock className="w-3 h-3 mr-1" />
                  Fixos
                </Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {systemBadges.map((badge) => {
                  const IconComp = ICON_MAP[badge.icon || "trophy"] || Trophy;
                  return (
                    <motion.div
                      key={badge.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex items-center justify-between p-4 rounded-lg border border-border bg-card"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <IconComp className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{badge.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {CRITERIA_OPTIONS.find((c) => c.value === badge.criteria_type)?.label ||
                              badge.criteria_type}{" "}
                            ≥ {badge.criteria_value}
                          </p>
                        </div>
                      </div>
                      <Lock className="w-4 h-4 text-muted-foreground" />
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Badges Customizados */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">
              Badges Customizados
            </h4>
            {customBadges.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
                Nenhum badge customizado. Clique em "Novo Badge" para criar.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {customBadges.map((badge) => {
                  const IconComp = ICON_MAP[badge.icon || "trophy"] || Trophy;
                  return (
                    <motion.div
                      key={badge.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex items-center justify-between p-4 rounded-lg border border-border bg-card hover:border-primary/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <IconComp className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{badge.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {CRITERIA_OPTIONS.find((c) => c.value === badge.criteria_type)?.label ||
                              badge.criteria_type}{" "}
                            ≥ {badge.criteria_value}
                          </p>
                          {badge.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {badge.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleteBadgeId(badge.id)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Remover
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Create Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Badge</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="badge-name">Nome</Label>
              <Input
                id="badge-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Ex: Mestre das Vendas"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="badge-description">Descrição (opcional)</Label>
              <Input
                id="badge-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Ex: Fechar 50 vendas em um mês"
              />
            </div>
            <div className="grid gap-2">
              <Label>Ícone</Label>
              <div className="flex flex-wrap gap-2">
                {ICON_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, icon: opt.value })}
                    className={`w-10 h-10 rounded-lg border-2 flex items-center justify-center transition-all ${
                      formData.icon === opt.value
                        ? "border-primary bg-primary/10 scale-110"
                        : "border-border hover:scale-105"
                    }`}
                    title={opt.label}
                  >
                    {opt.icon}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Critério</Label>
              <Select
                value={formData.criteria_type}
                onValueChange={(v) => setFormData({ ...formData, criteria_type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRITERIA_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="badge-value">Meta (valor mínimo para desbloquear)</Label>
              <Input
                id="badge-value"
                type="number"
                min={1}
                value={formData.criteria_value}
                onChange={(e) =>
                  setFormData({ ...formData, criteria_value: Number(e.target.value) || 1 })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={createBadge.isPending}>
              {createBadge.isPending ? "Criando..." : "Criar Badge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteBadgeId} onOpenChange={() => setDeleteBadgeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Badge?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O badge será removido e todos os clientes que o
              desbloquearam perderão a conquista.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
