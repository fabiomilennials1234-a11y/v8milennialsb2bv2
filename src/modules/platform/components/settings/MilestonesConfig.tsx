import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useBadges, useCreateBadge, useDeleteBadge } from "@/modules/engagement/hooks/useBadges";
import { MILESTONE_ICONS, MILESTONE_ICON_OPTIONS } from "@/modules/analytics/components/dashboard-outbound/milestone-icons";

const CRITERIA_TYPES = [
  { value: "leads_recebidos", label: "Leads recebidos" },
  { value: "leads_respondidos", label: "Leads respondidos" },
  { value: "reunioes_agendadas", label: "Reuniões agendadas" },
  { value: "vendas_count", label: "Vendas fechadas" },
  { value: "faturamento_total", label: "Faturamento total (R$)" },
];

export function MilestonesConfig() {
  const { data: badges = [] } = useBadges();
  const createBadge = useCreateBadge();
  const deleteBadge = useDeleteBadge();

  const [name, setName] = useState("");
  const [icon, setIcon] = useState("target");
  const [criteriaType, setCriteriaType] = useState("leads_recebidos");
  const [criteriaValue, setCriteriaValue] = useState("");

  const milestones = badges.filter((b) => !b.is_system);

  const handleCreate = async () => {
    if (!name.trim() || !criteriaValue) {
      toast.error("Preencha nome e valor do marco");
      return;
    }
    try {
      await createBadge.mutateAsync({
        name: name.trim(),
        description: `Meta: ${criteriaValue} ${CRITERIA_TYPES.find((c) => c.value === criteriaType)?.label ?? ""}`,
        icon,
        criteria_type: criteriaType,
        criteria_value: Number(criteriaValue),
      });
      toast.success("Marco criado!");
      setName("");
      setCriteriaValue("");
    } catch (err: any) {
      toast.error("Erro ao criar marco", { description: err?.message });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBadge.mutateAsync(id);
      toast.success("Marco removido");
    } catch (err: any) {
      toast.error("Erro ao remover", { description: err?.message });
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Criar novo marco</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input placeholder="Nome do marco" value={name} onChange={(e) => setName(e.target.value)} />
            <Select value={icon} onValueChange={setIcon}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MILESTONE_ICON_OPTIONS.map((key) => {
                  const Icon = MILESTONE_ICONS[key];
                  return (
                    <SelectItem key={key} value={key}>
                      <div className="flex items-center gap-2"><Icon className="w-4 h-4" />{key}</div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Select value={criteriaType} onValueChange={setCriteriaType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CRITERIA_TYPES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="number" placeholder="Valor alvo" value={criteriaValue} onChange={(e) => setCriteriaValue(e.target.value)} />
          </div>
          <Button onClick={handleCreate} disabled={createBadge.isPending}>
            <Plus className="w-4 h-4 mr-2" />
            {createBadge.isPending ? "Criando..." : "Criar Marco"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Marcos configurados <span className="tabular-nums text-muted-foreground">({milestones.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {milestones.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum marco criado.</p>
          ) : (
            <div className="space-y-2">
              {milestones.map((m) => {
                const Icon = MILESTONE_ICONS[m.icon ?? "target"] ?? MILESTONE_ICONS.target;
                return (
                  <div key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary-soft-foreground">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="truncate text-sm font-semibold">{m.name}</p>
                        <p className="text-xs text-muted-foreground">{m.criteria_type}: {m.criteria_value}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(m.id)} aria-label={`Excluir marco ${m.name}`}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
