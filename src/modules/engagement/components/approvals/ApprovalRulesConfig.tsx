import { useState } from "react";
import { Plus, Shield, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useApprovalRules, ApprovalRule } from "@/modules/engagement/hooks/useApprovals";
import { useOrganization } from "@/modules/identity";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface ConditionRow {
  field: string;
  operator: string;
  value: string;
}

const CONDITION_FIELDS = [
  { value: "sale_value", label: "Valor da venda" },
  { value: "discount_percent", label: "Desconto (%)" },
  { value: "quote_total", label: "Total da proposta" },
];

const OPERATORS = [
  { value: "greater_than", label: "Maior que" },
  { value: "less_than", label: "Menor que" },
  { value: "greater_or_equal", label: "Maior ou igual" },
  { value: "equals", label: "Igual a" },
];

export function ApprovalRulesConfig() {
  const { data: rules = [], isLoading } = useApprovalRules();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    entity_type: "lead" as string,
    conditions: [{ field: "sale_value", operator: "greater_than", value: "" }] as ConditionRow[],
    auto_reject_hours: "",
  });

  function resetForm() {
    setForm({
      name: "",
      entity_type: "lead",
      conditions: [{ field: "sale_value", operator: "greater_than", value: "" }],
      auto_reject_hours: "",
    });
  }

  function addCondition() {
    setForm({
      ...form,
      conditions: [...form.conditions, { field: "sale_value", operator: "greater_than", value: "" }],
    });
  }

  function removeCondition(index: number) {
    setForm({ ...form, conditions: form.conditions.filter((_, i) => i !== index) });
  }

  function updateCondition(index: number, updates: Partial<ConditionRow>) {
    setForm({
      ...form,
      conditions: form.conditions.map((c, i) => (i === index ? { ...c, ...updates } : c)),
    });
  }

  async function handleCreate() {
    if (!form.name.trim()) {
      toast.error("Nome obrigatorio");
      return;
    }
    if (!organizationId) return;

    setSaving(true);
    try {
      const { error } = await (supabase.from as any)("approval_rules").insert({
        organization_id: organizationId,
        name: form.name,
        entity_type: form.entity_type,
        conditions: form.conditions,
        approvers: [],
        auto_reject_hours: form.auto_reject_hours ? parseInt(form.auto_reject_hours) : null,
      });
      if (error) throw error;
      toast.success("Regra criada");
      queryClient.invalidateQueries({ queryKey: ["approval-rules"] });
      setDialogOpen(false);
      resetForm();
    } catch (err: any) {
      toast.error(err?.message ?? "Erro ao criar regra");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(rule: ApprovalRule) {
    const { error } = await (supabase.from as any)("approval_rules")
      .update({ is_active: !rule.is_active })
      .eq("id", rule.id);
    if (error) {
      toast.error("Erro ao alterar status");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["approval-rules"] });
  }

  async function handleDelete(id: string) {
    const { error } = await (supabase.from as any)("approval_rules").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao remover regra");
      return;
    }
    toast.success("Regra removida");
    queryClient.invalidateQueries({ queryKey: ["approval-rules"] });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Regras de aprovacao
          </h3>
          <p className="text-sm text-muted-foreground">
            Defina quando negocios ou propostas precisam de aprovacao
          </p>
        </div>
        <Button size="sm" onClick={() => { resetForm(); setDialogOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" /> Nova regra
        </Button>
      </div>

      {rules.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Shield className="h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma regra configurada</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <Card key={rule.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm">{rule.name}</CardTitle>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {rule.entity_type}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={rule.is_active} onCheckedChange={() => handleToggle(rule)} />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(rule.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-2">
                  {(rule.conditions as ConditionRow[]).map((c, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {CONDITION_FIELDS.find((f) => f.value === c.field)?.label ?? c.field}{" "}
                      {OPERATORS.find((o) => o.value === c.operator)?.label ?? c.operator}{" "}
                      {c.value}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova regra de aprovacao</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex: Desconto acima de 20%"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Tipo de entidade</Label>
              <Select
                value={form.entity_type}
                onValueChange={(v) => setForm({ ...form, entity_type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="quote">Proposta</SelectItem>
                  <SelectItem value="discount">Desconto</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Condicoes</Label>
              {form.conditions.map((c, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Select
                    value={c.field}
                    onValueChange={(v) => updateCondition(i, { field: v })}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITION_FIELDS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={c.operator}
                    onValueChange={(v) => updateCondition(i, { operator: v })}
                  >
                    <SelectTrigger className="w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    value={c.value}
                    onChange={(e) => updateCondition(i, { value: e.target.value })}
                    className="w-24"
                    placeholder="Valor"
                  />
                  {form.conditions.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => removeCondition(i)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={addCondition} className="text-xs">
                <Plus className="mr-1 h-3 w-3" /> Adicionar condicao
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Auto-rejeitar apos (horas, opcional)</Label>
              <Input
                type="number"
                min={1}
                value={form.auto_reject_hours}
                onChange={(e) => setForm({ ...form, auto_reject_hours: e.target.value })}
                placeholder="Ex: 48"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Criar regra
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
