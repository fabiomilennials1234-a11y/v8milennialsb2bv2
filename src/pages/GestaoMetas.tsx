import { useState } from "react";
import { motion } from "framer-motion";
import { Target, Plus, Edit2, Trash2, Save, Calendar, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
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
import { useGoals, useCreateGoal, useUpdateGoal, Goal } from "@/hooks/useGoals";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { useIsAdmin } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

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

interface GoalFormData {
  name: string;
  type: string;
  target_value: number;
  team_member_id: string | null;
  month: number;
  year: number;
}

const currentDate = new Date();

export default function GestaoMetas() {
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [deleteGoalId, setDeleteGoalId] = useState<string | null>(null);

  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const { data: goals = [], isLoading: goalsLoading } = useGoals(selectedMonth, selectedYear);
  const { data: teamMembers = [] } = useTeamMembers();
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();

  const [formData, setFormData] = useState<GoalFormData>({
    name: "",
    type: "faturamento",
    target_value: 0,
    team_member_id: null,
    month: selectedMonth,
    year: selectedYear,
  });

  const years = Array.from({ length: 5 }, (_, i) => currentDate.getFullYear() - 2 + i);

  const teamGoals = goals.filter(g => !g.team_member_id);
  const individualGoals = goals.filter(g => g.team_member_id);

  const handleOpenDialog = (goal?: Goal) => {
    if (goal) {
      setEditingGoal(goal);
      setFormData({
        name: goal.name,
        type: goal.type,
        target_value: goal.target_value,
        team_member_id: goal.team_member_id,
        month: goal.month,
        year: goal.year,
      });
    } else {
      setEditingGoal(null);
      setFormData({
        name: "",
        type: "faturamento",
        target_value: 0,
        team_member_id: null,
        month: selectedMonth,
        year: selectedYear,
      });
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const goalData = {
      name: formData.name || goalTypes.find(t => t.value === formData.type)?.label || "Meta",
      type: formData.type,
      target_value: formData.target_value,
      current_value: 0,
      team_member_id: formData.team_member_id || null,
      month: formData.month,
      year: formData.year,
    };

    try {
      if (editingGoal) {
        await updateGoal.mutateAsync({ id: editingGoal.id, ...goalData });
      } else {
        await createGoal.mutateAsync(goalData);
      }
      setIsDialogOpen(false);
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
    } catch (error: any) {
      toast.error("Erro ao excluir meta: " + error.message);
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

  const isLoading = goalsLoading || adminLoading;

  if (!isAdmin && !adminLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Target className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-semibold">Acesso Restrito</h2>
          <p className="text-muted-foreground">Apenas administradores podem gerenciar metas.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-bold flex items-center gap-2"
          >
            <Target className="w-6 h-6 text-primary" />
            Gestão de Metas
          </motion.h1>
          <p className="text-muted-foreground mt-1">
            Configure metas do time e individuais
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select 
            value={selectedMonth.toString()} 
            onValueChange={(v) => setSelectedMonth(Number(v))}
          >
            <SelectTrigger className="w-[140px]">
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
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map(year => (
                <SelectItem key={year} value={year.toString()}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => handleOpenDialog()} className="gradient-gold">
            <Plus className="w-4 h-4 mr-2" />
            Nova Meta
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4">
          {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <>
          {/* Team Goals */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4" />
                Metas do Time
              </CardTitle>
            </CardHeader>
            <CardContent>
              {teamGoals.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  Nenhuma meta do time configurada para {months[selectedMonth - 1]} {selectedYear}.
                </p>
              ) : (
                <div className="grid gap-3">
                  {teamGoals.map((goal) => {
                    const typeInfo = getGoalTypeInfo(goal.type);
                    return (
                      <div
                        key={goal.id}
                        className="flex items-center justify-between p-4 bg-muted/50 rounded-lg"
                      >
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
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleOpenDialog(goal)}
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteGoalId(goal.id)}
                            >
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
              {individualGoals.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  Nenhuma meta individual configurada para {months[selectedMonth - 1]} {selectedYear}.
                </p>
              ) : (
                <div className="grid gap-3">
                  {individualGoals.map((goal) => {
                    const typeInfo = getGoalTypeInfo(goal.type);
                    return (
                      <div
                        key={goal.id}
                        className="flex items-center justify-between p-4 bg-muted/50 rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-sm font-semibold text-primary">
                              {getMemberName(goal.team_member_id)
                                .split(" ")
                                .map((n) => n[0])
                                .join("")
                                .slice(0, 2)}
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
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleOpenDialog(goal)}
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteGoalId(goal.id)}
                            >
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
        </>
      )}

      {/* Goal Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingGoal ? "Editar Meta" : "Nova Meta"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="type">Tipo de Meta</Label>
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
              <Label htmlFor="name">Nome (opcional)</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={goalTypes.find(t => t.value === formData.type)?.label}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="target_value">Valor da Meta</Label>
              <Input
                id="target_value"
                type="number"
                value={formData.target_value}
                onChange={(e) => setFormData({ ...formData, target_value: Number(e.target.value) })}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="team_member_id">Membro do Time (opcional)</Label>
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
                    {years.map(year => (
                      <SelectItem key={year} value={year.toString()}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="gradient-gold">
                <Save className="w-4 h-4 mr-2" />
                {editingGoal ? "Salvar" : "Criar Meta"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteGoalId} onOpenChange={() => setDeleteGoalId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Meta</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir esta meta? Esta ação não pode ser desfeita.
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
    </div>
  );
}
