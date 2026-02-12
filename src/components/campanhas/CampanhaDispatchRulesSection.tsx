import { useState, useEffect } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCampanhaDispatchRules,
  useCampanhaDispatchRuleSteps,
  useCreateCampanhaDispatchRule,
  useCreateCampanhaDispatchRuleStep,
  useUpdateCampanhaDispatchRule,
  useDeleteCampanhaDispatchRule,
  type CampanhaStage,
  type CampanhaDispatchRule,
  type CampanhaDispatchRuleTriggerType,
} from "@/hooks/useCampanhas";
import { useCampanhaTemplates, type CampanhaTemplate } from "@/hooks/useCampaignTemplates";
import { Send, ChevronDown, Plus, Trash2, Loader2, ListOrdered, Play, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const TRIGGER_LABELS: Record<CampanhaDispatchRuleTriggerType, string> = {
  lead_created: "Ao adicionar lead na campanha",
  lead_moved_to_stage: "Ao mover lead para etapa",
};

interface CampanhaDispatchRulesSectionProps {
  campanhaId: string;
  stages: CampanhaStage[];
}

export function CampanhaDispatchRulesSection({ campanhaId, stages }: CampanhaDispatchRulesSectionProps) {
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [processingQueue, setProcessingQueue] = useState(false);
  const [triggerType, setTriggerType] = useState<CampanhaDispatchRuleTriggerType>("lead_created");
  const [selectedStageId, setSelectedStageId] = useState<string>("");
  const [steps, setSteps] = useState<{ template_id: string; delay_minutes: number }[]>([
    { template_id: "", delay_minutes: 0 },
  ]);
  const queryClient = useQueryClient();

  const { data: rules = [], isLoading, isError, error: queryError } = useCampanhaDispatchRules(campanhaId);
  const { data: templates = [] } = useCampanhaTemplates(campanhaId);
  const createRule = useCreateCampanhaDispatchRule();
  const createStep = useCreateCampanhaDispatchRuleStep();
  const updateRule = useUpdateCampanhaDispatchRule();
  const deleteRule = useDeleteCampanhaDispatchRule();
  const [editingRule, setEditingRule] = useState<CampanhaDispatchRule | null>(null);

  const handleAddStep = () => {
    setSteps((prev) => [...prev, { template_id: "", delay_minutes: 0 }]);
  };

  const handleRemoveStep = (index: number) => {
    if (steps.length <= 1) return;
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const handleStepChange = (index: number, field: "template_id" | "delay_minutes", value: string | number) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: field === "delay_minutes" ? Number(value) || 0 : value } : s))
    );
  };

  const handleAddRule = async () => {
    if (triggerType === "lead_moved_to_stage" && !selectedStageId) {
      toast.error("Selecione a etapa para o gatilho 'Ao mover para etapa'");
      return;
    }
    const validSteps = steps.filter((s) => s.template_id);
    if (validSteps.length === 0) {
      toast.error("Adicione pelo menos um passo com template");
      return;
    }
    try {
      const rule = await createRule.mutateAsync({
        campanha_id: campanhaId,
        trigger_type: triggerType,
        campanha_stage_id: triggerType === "lead_moved_to_stage" ? selectedStageId : null,
        is_active: true,
      });
      for (let i = 0; i < validSteps.length; i++) {
        const delay = Number(validSteps[i].delay_minutes);
        await createStep.mutateAsync({
          rule_id: rule.id,
          template_id: validSteps[i].template_id,
          delay_minutes: Number.isFinite(delay) && delay >= 0 ? delay : 0,
          position: i,
        });
      }
      toast.success("Regra de envio criada");
      setAddOpen(false);
      setTriggerType("lead_created");
      setSelectedStageId("");
      setSteps([{ template_id: "", delay_minutes: 0 }]);
    } catch (e: unknown) {
      console.error(e);
      const err = e as { code?: string; message?: string };
      const msg = err?.message ?? "";
      if (err?.code === "PGRST116" || err?.code === "42P01" || msg.includes("does not exist") || msg.includes("relation")) {
        toast.error("Tabela de regras não encontrada. Execute as migrations do Supabase (campanhas_whatsapp_instance_and_dispatch_rules).");
      } else if (err?.code === "42501" || msg.toLowerCase().includes("row-level security") || msg.toLowerCase().includes("permission")) {
        toast.error("Sem permissão para criar regras de envio. Apenas administradores podem criar regras.");
      } else if (msg) {
        toast.error(msg);
      } else {
        toast.error("Erro ao criar regra");
      }
    }
  };

  const handleDelete = async (r: CampanhaDispatchRule) => {
    try {
      await deleteRule.mutateAsync({ id: r.id, campanha_id: campanhaId });
      toast.success("Regra removida");
    } catch (e) {
      toast.error("Erro ao remover regra");
    }
  };

  const handleEdit = (r: CampanhaDispatchRule) => {
    setEditingRule(r);
  };

  const handleSaveEdit = async (
    ruleId: string,
    triggerType: CampanhaDispatchRuleTriggerType,
    selectedStageId: string,
    editSteps: { template_id: string; delay_minutes: number }[]
  ) => {
    if (triggerType === "lead_moved_to_stage" && !selectedStageId) {
      toast.error("Selecione a etapa para o gatilho 'Ao mover para etapa'");
      return;
    }
    const validSteps = editSteps.filter((s) => s.template_id);
    if (validSteps.length === 0) {
      toast.error("Adicione pelo menos um passo com template");
      return;
    }
    try {
      await updateRule.mutateAsync({
        id: ruleId,
        campanha_id: campanhaId,
        trigger_type: triggerType,
        campanha_stage_id: triggerType === "lead_moved_to_stage" ? selectedStageId : null,
      });
      const { error: deleteError } = await supabase
        .from("campanha_dispatch_rule_steps")
        .delete()
        .eq("rule_id", ruleId);
      if (deleteError) throw deleteError;
      for (let i = 0; i < validSteps.length; i++) {
        const delay = Number(validSteps[i].delay_minutes);
        await createStep.mutateAsync({
          rule_id: ruleId,
          template_id: validSteps[i].template_id,
          delay_minutes: Number.isFinite(delay) && delay >= 0 ? delay : 0,
          position: i,
        });
      }
      toast.success("Regra atualizada");
      setEditingRule(null);
    } catch (e: unknown) {
      console.error(e);
      const err = e as { code?: string; message?: string };
      const msg = err?.message ?? "";
      if (err?.code === "23505") {
        toast.error("Já existe uma regra com esse gatilho e etapa.");
      } else if (msg) {
        toast.error(msg);
      } else {
        toast.error("Erro ao atualizar regra");
      }
    }
  };

  const getStageName = (stageId: string) => stages.find((s) => s.id === stageId)?.name ?? stageId;

  const handleProcessQueue = async () => {
    setProcessingQueue(true);
    try {
      const { data, error } = await supabase.functions.invoke("campaign-rule-dispatch", {});
      if (error) {
        toast.error(error.message || "Erro ao processar fila");
        return;
      }
      const result = data as { processed?: number; sent?: number; failed?: number; message?: string } | null;
      if (result?.processed === 0) {
        toast.info(result?.message || "Nenhuma mensagem pendente");
      } else if (result?.processed != null) {
        toast.success(
          `Processado: ${result.processed} | Enviadas: ${result.sent ?? 0} | Falhas: ${result.failed ?? 0}`
        );
        queryClient.invalidateQueries({ queryKey: ["dispatch_log", campanhaId] });
      } else {
        toast.success("Fila processada");
        queryClient.invalidateQueries({ queryKey: ["dispatch_log", campanhaId] });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao processar fila");
    } finally {
      setProcessingQueue(false);
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Send className="w-4 h-4" />
          Regras de envio por etapa
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="rounded-lg border bg-muted/30 p-4 mt-2 space-y-4">
          <p className="text-xs text-muted-foreground">
            Mensagens disparadas automaticamente quando um lead é adicionado à campanha ou movido para uma etapa. Configure a sequência de templates e o delay entre cada envio.
          </p>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Carregando…
            </div>
          ) : isError ? (
            <p className="text-sm text-destructive">
              {(queryError as { message?: string })?.message?.includes("does not exist") || (queryError as { message?: string })?.message?.includes("relation")
                ? "Tabela de regras não encontrada. Execute as migrations do Supabase (campanhas_whatsapp_instance_and_dispatch_rules)."
                : (queryError as Error)?.message ?? "Erro ao carregar regras."}
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {rules.length === 0 ? (
                  <li className="text-sm text-muted-foreground">Nenhuma regra de envio configurada.</li>
                ) : (
                  rules.map((r) => (
                    <RuleRow
                      key={r.id}
                      rule={r}
                      stages={stages}
                      getStageName={getStageName}
                      onEdit={() => handleEdit(r)}
                      onDelete={() => handleDelete(r)}
                      isDeleting={deleteRule.isPending}
                    />
                  ))
                )}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleProcessQueue}
                  disabled={processingQueue}
                >
                  {processingQueue ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  Processar fila agora
                </Button>
                {!addOpen ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Adicionar regra de envio
                  </Button>
                ) : null}
              </div>
              {addOpen ? (
                <div className="space-y-4 rounded-md border border-dashed p-3">
                  <div className="grid gap-2">
                    <Label>Gatilho</Label>
                    <Select
                      value={triggerType}
                      onValueChange={(v) => {
                        setTriggerType(v as CampanhaDispatchRuleTriggerType);
                        setSelectedStageId("");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lead_created">{TRIGGER_LABELS.lead_created}</SelectItem>
                        <SelectItem value="lead_moved_to_stage">{TRIGGER_LABELS.lead_moved_to_stage}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {triggerType === "lead_moved_to_stage" && (
                    <div className="grid gap-2">
                      <Label>Etapa da campanha</Label>
                      <Select value={selectedStageId} onValueChange={setSelectedStageId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a etapa" />
                        </SelectTrigger>
                        <SelectContent>
                          {stages.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <ListOrdered className="w-4 h-4" />
                      Sequência de mensagens
                    </Label>
                    {steps.map((step, index) => (
                      <div key={index} className="flex items-center gap-2 flex-wrap">
                        <Select
                          value={step.template_id}
                          onValueChange={(v) => handleStepChange(index, "template_id", v)}
                        >
                          <SelectTrigger className="flex-1 min-w-[180px]">
                            <SelectValue placeholder="Template" />
                          </SelectTrigger>
                          <SelectContent>
                            {templates.map((t) => (
                              <SelectItem key={t.template_id} value={t.template_id}>
                                {(t as CampanhaTemplate).template?.name ?? t.template_id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          min={0}
                          placeholder="0"
                          className="w-20"
                          value={step.delay_minutes === 0 ? "" : step.delay_minutes}
                          onChange={(e) => {
                            const v = e.target.value;
                            handleStepChange(index, "delay_minutes", v === "" ? 0 : Number(v));
                          }}
                        />
                        <span className="text-xs text-muted-foreground">min</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => handleRemoveStep(index)}
                          disabled={steps.length <= 1}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    <Button type="button" variant="ghost" size="sm" onClick={handleAddStep}>
                      <Plus className="w-4 h-4 mr-1" />
                      Adicionar passo
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAddOpen(false);
                        setTriggerType("lead_created");
                        setSelectedStageId("");
                        setSteps([{ template_id: "", delay_minutes: 0 }]);
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleAddRule}
                      disabled={
                        createRule.isPending ||
                        createStep.isPending ||
                        (triggerType === "lead_moved_to_stage" && !selectedStageId) ||
                        steps.every((s) => !s.template_id)
                      }
                    >
                      {(createRule.isPending || createStep.isPending) && (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      )}
                      Salvar regra
                    </Button>
                  </div>
                </div>
              ) : null}
              {editingRule ? (
                <EditRuleModal
                  rule={editingRule}
                  stages={stages}
                  templates={templates}
                  onClose={() => setEditingRule(null)}
                  onSave={handleSaveEdit}
                  isSaving={updateRule.isPending || createStep.isPending}
                />
              ) : null}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RuleRow({
  rule,
  stages,
  getStageName,
  onEdit,
  onDelete,
  isDeleting,
}: {
  rule: CampanhaDispatchRule;
  stages: CampanhaStage[];
  getStageName: (id: string) => string;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const { data: ruleSteps = [] } = useCampanhaDispatchRuleSteps(rule.id);
  const label =
    rule.trigger_type === "lead_created"
      ? TRIGGER_LABELS.lead_created
      : `${TRIGGER_LABELS.lead_moved_to_stage}: ${rule.campanha_stage_id ? getStageName(rule.campanha_stage_id) : "—"}`;
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm">
      <div>
        <span className="text-muted-foreground">{label}</span>
        <span className="ml-2 text-muted-foreground">
          — {ruleSteps.length} mensagem(ns) na sequência
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onEdit}
          aria-label="Editar regra"
        >
          <Pencil className="w-4 h-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={onDelete}
          disabled={isDeleting}
          aria-label="Excluir regra"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </li>
  );
}

interface EditRuleModalProps {
  rule: CampanhaDispatchRule;
  stages: CampanhaStage[];
  templates: CampanhaTemplate[];
  onClose: () => void;
  onSave: (
    ruleId: string,
    triggerType: CampanhaDispatchRuleTriggerType,
    selectedStageId: string,
    steps: { template_id: string; delay_minutes: number }[]
  ) => Promise<void>;
  isSaving: boolean;
}

function EditRuleModal({
  rule,
  stages,
  templates,
  onClose,
  onSave,
  isSaving,
}: EditRuleModalProps) {
  const { data: ruleSteps = [], isLoading: loadingSteps } = useCampanhaDispatchRuleSteps(rule.id);
  const [triggerType, setTriggerType] = useState<CampanhaDispatchRuleTriggerType>(rule.trigger_type);
  const [selectedStageId, setSelectedStageId] = useState<string>(rule.campanha_stage_id ?? "");
  const [steps, setSteps] = useState<{ template_id: string; delay_minutes: number }[]>([]);

  useEffect(() => {
    if (ruleSteps.length > 0) {
      setSteps(
        ruleSteps
          .sort((a, b) => a.position - b.position)
          .map((s) => ({
            template_id: s.template_id,
            delay_minutes: s.delay_minutes ?? 0,
          }))
      );
    } else {
      setSteps([{ template_id: "", delay_minutes: 0 }]);
    }
  }, [ruleSteps]);

  const handleAddStep = () => {
    setSteps((prev) => [...prev, { template_id: "", delay_minutes: 0 }]);
  };

  const handleRemoveStep = (index: number) => {
    if (steps.length <= 1) return;
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const handleStepChange = (index: number, field: "template_id" | "delay_minutes", value: string | number) => {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === index ? { ...s, [field]: field === "delay_minutes" ? Number(value) || 0 : value } : s
      )
    );
  };

  const handleSubmit = async () => {
    await onSave(rule.id, triggerType, selectedStageId, steps);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar regra de envio</DialogTitle>
        </DialogHeader>
        {loadingSteps ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Carregando…
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <div className="grid gap-2">
              <Label>Gatilho</Label>
              <Select
                value={triggerType}
                onValueChange={(v) => {
                  setTriggerType(v as CampanhaDispatchRuleTriggerType);
                  setSelectedStageId(v === "lead_moved_to_stage" ? selectedStageId : "");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead_created">{TRIGGER_LABELS.lead_created}</SelectItem>
                  <SelectItem value="lead_moved_to_stage">{TRIGGER_LABELS.lead_moved_to_stage}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {triggerType === "lead_moved_to_stage" && (
              <div className="grid gap-2">
                <Label>Etapa da campanha</Label>
                <Select value={selectedStageId} onValueChange={setSelectedStageId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a etapa" />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <ListOrdered className="w-4 h-4" />
                Sequência de mensagens
              </Label>
              {steps.map((step, index) => (
                <div key={index} className="flex items-center gap-2 flex-wrap">
                  <Select
                    value={step.template_id}
                    onValueChange={(v) => handleStepChange(index, "template_id", v)}
                  >
                    <SelectTrigger className="flex-1 min-w-[180px]">
                      <SelectValue placeholder="Template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.template_id} value={t.template_id}>
                          {(t as CampanhaTemplate).template?.name ?? t.template_id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min={0}
                    placeholder="0"
                    className="w-20"
                    value={step.delay_minutes === 0 ? "" : step.delay_minutes}
                    onChange={(e) => {
                      const v = e.target.value;
                      handleStepChange(index, "delay_minutes", v === "" ? 0 : Number(v));
                    }}
                  />
                  <span className="text-xs text-muted-foreground">min</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => handleRemoveStep(index)}
                    disabled={steps.length <= 1}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" onClick={handleAddStep}>
                <Plus className="w-4 h-4 mr-1" />
                Adicionar passo
              </Button>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={
                  isSaving ||
                  (triggerType === "lead_moved_to_stage" && !selectedStageId) ||
                  steps.every((s) => !s.template_id)
                }
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : null}
                Salvar alterações
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
