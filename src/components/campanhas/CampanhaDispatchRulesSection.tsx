import { useState } from "react";
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
  useDeleteCampanhaDispatchRule,
  type CampanhaStage,
  type CampanhaDispatchRule,
  type CampanhaDispatchRuleTriggerType,
} from "@/hooks/useCampanhas";
import { useCampanhaTemplates, type CampanhaTemplate } from "@/hooks/useCampaignTemplates";
import { Send, ChevronDown, Plus, Trash2, Loader2, ListOrdered } from "lucide-react";
import { toast } from "sonner";

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
  const [triggerType, setTriggerType] = useState<CampanhaDispatchRuleTriggerType>("lead_created");
  const [selectedStageId, setSelectedStageId] = useState<string>("");
  const [steps, setSteps] = useState<{ template_id: string; delay_minutes: number }[]>([
    { template_id: "", delay_minutes: 0 },
  ]);

  const { data: rules = [], isLoading } = useCampanhaDispatchRules(campanhaId);
  const { data: templates = [] } = useCampanhaTemplates(campanhaId);
  const createRule = useCreateCampanhaDispatchRule();
  const createStep = useCreateCampanhaDispatchRuleStep();
  const deleteRule = useDeleteCampanhaDispatchRule();

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
        await createStep.mutateAsync({
          rule_id: rule.id,
          template_id: validSteps[i].template_id,
          delay_minutes: validSteps[i].delay_minutes,
          position: i,
        });
      }
      toast.success("Regra de envio criada");
      setAddOpen(false);
      setTriggerType("lead_created");
      setSelectedStageId("");
      setSteps([{ template_id: "", delay_minutes: 0 }]);
    } catch (e) {
      console.error(e);
      toast.error("Erro ao criar regra");
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

  const getStageName = (stageId: string) => stages.find((s) => s.id === stageId)?.name ?? stageId;

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
                      onDelete={() => handleDelete(r)}
                      isDeleting={deleteRule.isPending}
                    />
                  ))
                )}
              </ul>
              {!addOpen ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Adicionar regra de envio
                </Button>
              ) : (
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
                          placeholder="Delay (min)"
                          className="w-20"
                          value={step.delay_minutes || ""}
                          onChange={(e) => handleStepChange(index, "delay_minutes", e.target.value)}
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
              )}
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
  onDelete,
  isDeleting,
}: {
  rule: CampanhaDispatchRule;
  stages: CampanhaStage[];
  getStageName: (id: string) => string;
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
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-destructive hover:text-destructive"
        onClick={onDelete}
        disabled={isDeleting}
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </li>
  );
}
