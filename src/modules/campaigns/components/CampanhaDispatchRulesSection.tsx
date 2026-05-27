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
  type CampanhaDispatchRuleStepActionType,
  type CampanhaDispatchRuleTimeoutAction,
  type SdrAssignmentMode,
} from "@/modules/campaigns/hooks/useCampanhas";
import { useCampanhaTemplates, type CampanhaTemplate } from "@/modules/campaigns/hooks/useCampaignTemplates";
import { useTeamMembers } from "@/modules/identity";
import {
  Send, ChevronDown, Plus, Trash2, Loader2, ListOrdered, Play, Pencil,
  CheckCircle2, Clock, XCircle, MessageSquare, ArrowRightLeft, UserPlus, Ban, Hourglass,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useCampaignQueueItems, useRetryDispatchItems } from "@/modules/campaigns/hooks/useDispatchQueueItems";
import { DispatchQueueSheet } from "@/components/shared/DispatchQueueSheet";

const TRIGGER_LABELS: Record<CampanhaDispatchRuleTriggerType, string> = {
  lead_created: "Ao adicionar lead na campanha",
  lead_moved_to_stage: "Ao mover lead para etapa",
};

const ACTION_LABELS: Record<CampanhaDispatchRuleStepActionType, string> = {
  send_template: "Enviar template",
  wait_response: "Esperar resposta",
  change_stage: "Mudar etapa",
  assign_sdr: "Atribuir Responsável",
  cancel_sequence: "Cancelar sequência",
};

const ACTION_ICONS: Record<CampanhaDispatchRuleStepActionType, typeof Send> = {
  send_template: MessageSquare,
  wait_response: Hourglass,
  change_stage: ArrowRightLeft,
  assign_sdr: UserPlus,
  cancel_sequence: Ban,
};

const TIMEOUT_ACTION_LABELS: Record<CampanhaDispatchRuleTimeoutAction, string> = {
  continue: "Continuar sequência",
  change_stage: "Mudar etapa",
  send_template: "Enviar template",
  cancel_sequence: "Cancelar sequência",
};

// Step state used locally in the form
interface StepFormState {
  action_type: CampanhaDispatchRuleStepActionType;
  template_id: string;
  delay_minutes: number;
  wait_timeout_minutes: number;
  timeout_action: CampanhaDispatchRuleTimeoutAction;
  timeout_target_stage_id: string;
  timeout_template_id: string;
  target_stage_id: string;
  sdr_assignment_mode: SdrAssignmentMode;
  target_sdr_id: string;
}

function defaultStep(): StepFormState {
  return {
    action_type: "send_template",
    template_id: "",
    delay_minutes: 0,
    wait_timeout_minutes: 1440,
    timeout_action: "continue",
    timeout_target_stage_id: "",
    timeout_template_id: "",
    target_stage_id: "",
    sdr_assignment_mode: "specific",
    target_sdr_id: "",
  };
}

interface CampanhaDispatchRulesSectionProps {
  campanhaId: string;
  stages: CampanhaStage[];
  embedded?: boolean;
}

export function CampanhaDispatchRulesSection({ campanhaId, stages, embedded }: CampanhaDispatchRulesSectionProps) {
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [processingQueue, setProcessingQueue] = useState(false);
  const [triggerType, setTriggerType] = useState<CampanhaDispatchRuleTriggerType>("lead_created");
  const [selectedStageId, setSelectedStageId] = useState<string>("");
  const [steps, setSteps] = useState<StepFormState[]>([defaultStep()]);
  const queryClient = useQueryClient();

  const { data: rules = [], isLoading, isError, error: queryError } = useCampanhaDispatchRules(campanhaId);
  const { data: templates = [] } = useCampanhaTemplates(campanhaId);
  const { data: teamMembers = [] } = useTeamMembers();
  const createRule = useCreateCampanhaDispatchRule();
  const createStep = useCreateCampanhaDispatchRuleStep();
  const updateRule = useUpdateCampanhaDispatchRule();
  const deleteRule = useDeleteCampanhaDispatchRule();
  const [editingRule, setEditingRule] = useState<CampanhaDispatchRule | null>(null);
  const [queueSheetStatus, setQueueSheetStatus] = useState<string | null>(null);

  // Queue items for the detail sheet
  const { data: queueItems = [], isLoading: queueLoading } = useCampaignQueueItems(campanhaId, queueSheetStatus);
  const retryMutation = useRetryDispatchItems("scheduled_campaign_messages", [
    ["dispatch_metrics", campanhaId],
    ["campaign_queue_items", campanhaId, queueSheetStatus],
  ]);

  // --- Dispatch metrics ---
  const { data: dispatchMetrics } = useQuery({
    queryKey: ["dispatch_metrics", campanhaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scheduled_campaign_messages")
        .select("status")
        .eq("campanha_id", campanhaId);
      if (error) throw error;
      const counts = { scheduled: 0, sent: 0, failed: 0, waiting_response: 0, executed: 0 };
      for (const row of data || []) {
        if (row.status === "scheduled" || row.status === "processing") counts.scheduled++;
        else if (row.status === "sent") counts.sent++;
        else if (row.status === "failed") counts.failed++;
        else if (row.status === "waiting_response") counts.waiting_response++;
        else if (row.status === "executed") counts.executed++;
      }
      return counts;
    },
    enabled: !!campanhaId,
  });

  const handleAddStep = () => setSteps((prev) => [...prev, defaultStep()]);

  const handleRemoveStep = (index: number) => {
    if (steps.length <= 1) return;
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const handleStepChange = (index: number, updates: Partial<StepFormState>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  };

  const isStepValid = (step: StepFormState) => {
    switch (step.action_type) {
      case "send_template": return !!step.template_id;
      case "wait_response": return step.wait_timeout_minutes > 0;
      case "change_stage": return !!step.target_stage_id;
      case "assign_sdr": return step.sdr_assignment_mode === "round_robin" || !!step.target_sdr_id;
      case "cancel_sequence": return true;
      default: return false;
    }
  };

  const handleAddRule = async () => {
    if (triggerType === "lead_moved_to_stage" && !selectedStageId) {
      toast.error("Selecione a etapa para o gatilho 'Ao mover para etapa'");
      return;
    }
    const validSteps = steps.filter(isStepValid);
    if (validSteps.length === 0) {
      toast.error("Adicione pelo menos um passo válido");
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
        const s = validSteps[i];
        await createStep.mutateAsync({
          rule_id: rule.id,
          action_type: s.action_type,
          template_id: s.action_type === "send_template" ? s.template_id : null,
          delay_minutes: s.delay_minutes,
          position: i,
          wait_timeout_minutes: s.action_type === "wait_response" ? s.wait_timeout_minutes : null,
          timeout_action: s.action_type === "wait_response" ? s.timeout_action : null,
          timeout_target_stage_id: s.timeout_action === "change_stage" ? s.timeout_target_stage_id : null,
          timeout_template_id: s.timeout_action === "send_template" ? s.timeout_template_id : null,
          target_stage_id: s.action_type === "change_stage" ? s.target_stage_id : null,
          sdr_assignment_mode: s.action_type === "assign_sdr" ? s.sdr_assignment_mode : null,
          target_sdr_id: s.sdr_assignment_mode === "specific" ? s.target_sdr_id : null,
        });
      }
      toast.success("Regra de envio criada com " + validSteps.length + " passo(s)");
      setAddOpen(false);
      setTriggerType("lead_created");
      setSelectedStageId("");
      setSteps([defaultStep()]);
    } catch (e: unknown) {
      console.error("Erro ao criar regra de envio:", e);
      const msg = (e as { message?: string })?.message ?? "";
      toast.error(msg ? `Erro: ${msg}` : "Erro ao criar regra de envio");
      queryClient.invalidateQueries({ queryKey: ["campanha_dispatch_rules", campanhaId] });
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

  const handleSaveEdit = async (
    ruleId: string,
    trigType: CampanhaDispatchRuleTriggerType,
    stageId: string,
    editSteps: StepFormState[]
  ) => {
    if (trigType === "lead_moved_to_stage" && !stageId) {
      toast.error("Selecione a etapa para o gatilho 'Ao mover para etapa'");
      return;
    }
    const validSteps = editSteps.filter(isStepValid);
    if (validSteps.length === 0) {
      toast.error("Adicione pelo menos um passo válido");
      return;
    }
    try {
      // 1. Atualizar a regra
      await updateRule.mutateAsync({
        id: ruleId,
        campanha_id: campanhaId,
        trigger_type: trigType,
        campanha_stage_id: trigType === "lead_moved_to_stage" ? stageId : null,
      });
      // 2. Deletar steps antigos
      const { error: deleteError } = await supabase
        .from("campanha_dispatch_rule_steps")
        .delete()
        .eq("rule_id", ruleId);
      if (deleteError) throw deleteError;
      // 3. Criar novos steps
      for (let i = 0; i < validSteps.length; i++) {
        const s = validSteps[i];
        await createStep.mutateAsync({
          rule_id: ruleId,
          action_type: s.action_type,
          template_id: s.action_type === "send_template" ? s.template_id : null,
          delay_minutes: s.delay_minutes,
          position: i,
          wait_timeout_minutes: s.action_type === "wait_response" ? s.wait_timeout_minutes : null,
          timeout_action: s.action_type === "wait_response" ? s.timeout_action : null,
          timeout_target_stage_id: s.timeout_action === "change_stage" ? s.timeout_target_stage_id : null,
          timeout_template_id: s.timeout_action === "send_template" ? s.timeout_template_id : null,
          target_stage_id: s.action_type === "change_stage" ? s.target_stage_id : null,
          sdr_assignment_mode: s.action_type === "assign_sdr" ? s.sdr_assignment_mode : null,
          target_sdr_id: s.sdr_assignment_mode === "specific" ? s.target_sdr_id : null,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["campanha_dispatch_rule_steps", ruleId] });
      toast.success("Regra atualizada com " + validSteps.length + " passo(s)");
      setEditingRule(null);
    } catch (e: unknown) {
      console.error("Erro ao atualizar regra:", e);
      queryClient.invalidateQueries({ queryKey: ["campanha_dispatch_rule_steps", ruleId] });
      const msg = (e as { message?: string })?.message ?? "";
      toast.error(msg ? `Erro: ${msg}` : "Erro ao atualizar regra");
    }
  };

  const getStageName = (stageId: string) => stages.find((s) => s.id === stageId)?.name ?? stageId;

  const handleProcessQueue = async () => {
    setProcessingQueue(true);
    try {
      const { data, error } = await supabase.functions.invoke("campaign-rule-dispatch", {
        body: { campanha_id: campanhaId },
      });
      if (error) {
        toast.error(error.message || "Erro ao processar fila");
        return;
      }
      const result = data as { success?: boolean; processed?: number; sent?: number; failed?: number; actions_executed?: number; message?: string; error?: string } | null;
      if (result?.error) {
        toast.error(`Erro ao processar fila: ${result.error}`);
        return;
      }
      if (result?.processed === 0 && !result?.actions_executed) {
        toast.info(result?.message || "Nenhuma mensagem pendente");
      } else if (result?.processed != null) {
        toast.success(
          `Enviadas: ${result.sent ?? 0} | Ações: ${result.actions_executed ?? 0} | Falhas: ${result.failed ?? 0}`
        );
      } else {
        toast.success("Fila processada");
      }
      queryClient.invalidateQueries({ queryKey: ["dispatch_log", campanhaId] });
      queryClient.invalidateQueries({ queryKey: ["dispatch_metrics", campanhaId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao processar fila");
    } finally {
      setProcessingQueue(false);
    }
  };

  const innerContent = (
    <>
      <p className="text-xs text-muted-foreground">
        Automações disparadas quando um lead é adicionado ou movido de etapa. Configure sequências com templates, espera de resposta, mudança de etapa, atribuição de responsável e mais.
      </p>
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">
          {(queryError as { message?: string })?.message?.includes("does not exist")
            ? "Tabela de regras não encontrada. Execute as migrations."
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
                  onEdit={() => setEditingRule(r)}
                  onDelete={() => handleDelete(r)}
                  isDeleting={deleteRule.isPending}
                />
              ))
            )}
          </ul>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={handleProcessQueue} disabled={processingQueue}>
              {processingQueue ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
              Processar fila agora
            </Button>
            {!addOpen && (
              <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="w-4 h-4 mr-2" /> Adicionar regra
              </Button>
            )}
          </div>

          {/* Dispatch Metrics */}
          {dispatchMetrics && (dispatchMetrics.sent > 0 || dispatchMetrics.scheduled > 0 || dispatchMetrics.failed > 0 || dispatchMetrics.waiting_response > 0 || dispatchMetrics.executed > 0) && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <MetricCard icon={CheckCircle2} color="text-green-500" value={dispatchMetrics.sent} label="Enviadas" onClick={() => setQueueSheetStatus("sent")} />
              <MetricCard icon={Clock} color="text-yellow-500" value={dispatchMetrics.scheduled} label="Pendentes" onClick={() => setQueueSheetStatus("scheduled")} />
              <MetricCard icon={Hourglass} color="text-blue-500" value={dispatchMetrics.waiting_response} label="Aguardando" onClick={() => setQueueSheetStatus("waiting_response")} />
              <MetricCard icon={ArrowRightLeft} color="text-purple-500" value={dispatchMetrics.executed} label="Ações" onClick={() => setQueueSheetStatus("executed")} />
              <MetricCard icon={XCircle} color="text-red-500" value={dispatchMetrics.failed} label="Falharam" onClick={() => setQueueSheetStatus("failed")} />
            </div>
          )}

          {/* Queue detail sheet */}
          <DispatchQueueSheet
            open={!!queueSheetStatus}
            onOpenChange={(open) => !open && setQueueSheetStatus(null)}
            title={`Campanha — Disparos`}
            statusFilter={queueSheetStatus ?? "scheduled"}
            items={queueItems}
            isLoading={queueLoading}
            onRetry={(ids) => retryMutation.mutate(ids)}
            isRetrying={retryMutation.isPending}
            onProcessQueue={handleProcessQueue}
            isProcessing={processingQueue}
          />

          {addOpen && (
            <RuleForm
              triggerType={triggerType}
              setTriggerType={(v) => { setTriggerType(v); setSelectedStageId(""); }}
              selectedStageId={selectedStageId}
              setSelectedStageId={setSelectedStageId}
              steps={steps}
              setSteps={setSteps}
              stages={stages}
              templates={templates}
              teamMembers={teamMembers}
              onAddStep={handleAddStep}
              onRemoveStep={handleRemoveStep}
              onStepChange={handleStepChange}
              onCancel={() => { setAddOpen(false); setSteps([defaultStep()]); setTriggerType("lead_created"); setSelectedStageId(""); }}
              onSave={handleAddRule}
              isSaving={createRule.isPending || createStep.isPending}
            />
          )}

          {editingRule && (
            <EditRuleModal
              rule={editingRule}
              stages={stages}
              templates={templates}
              teamMembers={teamMembers}
              onClose={() => setEditingRule(null)}
              onSave={handleSaveEdit}
              isSaving={updateRule.isPending || createStep.isPending}
            />
          )}
        </>
      )}
    </>
  );

  if (embedded) {
    return <div className="space-y-4">{innerContent}</div>;
  }

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
          {innerContent}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ============================
// Metric Card
// ============================
function MetricCard({ icon: Icon, color, value, label, onClick }: { icon: typeof Send; color: string; value: number; label: string; onClick?: () => void }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border bg-background p-2.5",
        onClick && "cursor-pointer hover:border-primary/50 transition-colors"
      )}
      onClick={onClick}
    >
      <Icon className={`w-4 h-4 ${color} shrink-0`} />
      <div>
        <p className="text-base font-semibold leading-none">{value}</p>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

// ============================
// Rule Row (list item)
// ============================
function RuleRow({
  rule, stages, getStageName, onEdit, onDelete, isDeleting,
}: {
  rule: CampanhaDispatchRule;
  stages: CampanhaStage[];
  getStageName: (id: string) => string;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const { data: ruleSteps = [] } = useCampanhaDispatchRuleSteps(rule.id);
  const label = rule.trigger_type === "lead_created"
    ? TRIGGER_LABELS.lead_created
    : `${TRIGGER_LABELS.lead_moved_to_stage}: ${rule.campanha_stage_id ? getStageName(rule.campanha_stage_id) : "—"}`;

  const stepSummary = ruleSteps.map((s) => ACTION_LABELS[s.action_type as CampanhaDispatchRuleStepActionType] || s.action_type);

  return (
    <li className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm">
      <div className="min-w-0">
        <span className="text-muted-foreground">{label}</span>
        <span className="ml-2 text-muted-foreground">
          — {ruleSteps.length} passo(s): {stepSummary.join(" → ")}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
          <Pencil className="w-4 h-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={onDelete} disabled={isDeleting}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </li>
  );
}

// ============================
// Step Editor Row
// ============================
function StepEditorRow({
  step, index, stages, templates, teamMembers, onChange, onRemove, canRemove,
}: {
  step: StepFormState;
  index: number;
  stages: CampanhaStage[];
  templates: CampanhaTemplate[];
  teamMembers: { id: string; name: string; role?: string }[];
  onChange: (updates: Partial<StepFormState>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const Icon = ACTION_ICONS[step.action_type] || MessageSquare;

  return (
    <div className="rounded-md border border-dashed p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
        <Select value={step.action_type} onValueChange={(v) => onChange({ action_type: v as CampanhaDispatchRuleStepActionType })}>
          <SelectTrigger className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ACTION_LABELS) as CampanhaDispatchRuleStepActionType[]).map((at) => (
              <SelectItem key={at} value={at}>{ACTION_LABELS[at]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number" min={0} placeholder="0" className="w-20"
          value={step.delay_minutes === 0 ? "" : step.delay_minutes}
          onChange={(e) => onChange({ delay_minutes: e.target.value === "" ? 0 : Number(e.target.value) })}
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap">min delay</span>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onRemove} disabled={!canRemove}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      {/* send_template fields */}
      {step.action_type === "send_template" && (
        <Select value={step.template_id} onValueChange={(v) => onChange({ template_id: v })}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecione o template" />
          </SelectTrigger>
          <SelectContent>
            {templates.map((t) => (
              <SelectItem key={t.template_id} value={t.template_id}>
                {(t as CampanhaTemplate).template?.name ?? t.template_id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* wait_response fields */}
      {step.action_type === "wait_response" && (
        <div className="space-y-2 pl-6">
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Timeout:</Label>
            <Input
              type="number" min={1} className="w-20"
              value={step.wait_timeout_minutes}
              onChange={(e) => onChange({ wait_timeout_minutes: Number(e.target.value) || 1440 })}
            />
            <span className="text-xs text-muted-foreground">min ({Math.round(step.wait_timeout_minutes / 60)}h)</span>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">Se não responder:</Label>
            <Select value={step.timeout_action} onValueChange={(v) => onChange({ timeout_action: v as CampanhaDispatchRuleTimeoutAction })}>
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TIMEOUT_ACTION_LABELS) as CampanhaDispatchRuleTimeoutAction[]).map((ta) => (
                  <SelectItem key={ta} value={ta}>{TIMEOUT_ACTION_LABELS[ta]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {step.timeout_action === "change_stage" && (
            <Select value={step.timeout_target_stage_id} onValueChange={(v) => onChange({ timeout_target_stage_id: v })}>
              <SelectTrigger><SelectValue placeholder="Etapa destino (timeout)" /></SelectTrigger>
              <SelectContent>
                {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {step.timeout_action === "send_template" && (
            <Select value={step.timeout_template_id} onValueChange={(v) => onChange({ timeout_template_id: v })}>
              <SelectTrigger><SelectValue placeholder="Template (timeout)" /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.template_id} value={t.template_id}>
                    {(t as CampanhaTemplate).template?.name ?? t.template_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {/* change_stage fields */}
      {step.action_type === "change_stage" && (
        <Select value={step.target_stage_id} onValueChange={(v) => onChange({ target_stage_id: v })}>
          <SelectTrigger><SelectValue placeholder="Etapa destino" /></SelectTrigger>
          <SelectContent>
            {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      {/* assign_sdr fields */}
      {step.action_type === "assign_sdr" && (
        <div className="space-y-2 pl-6">
          <Select value={step.sdr_assignment_mode} onValueChange={(v) => onChange({ sdr_assignment_mode: v as SdrAssignmentMode })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="specific">Responsável específico</SelectItem>
              <SelectItem value="round_robin">Round-robin (distribuir)</SelectItem>
            </SelectContent>
          </Select>
          {step.sdr_assignment_mode === "specific" && (
            <Select value={step.target_sdr_id} onValueChange={(v) => onChange({ target_sdr_id: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione o responsável" /></SelectTrigger>
              <SelectContent>
                {teamMembers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}{m.role ? ` (${m.role})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {/* cancel_sequence - no extra fields */}
      {step.action_type === "cancel_sequence" && (
        <p className="text-xs text-muted-foreground pl-6">Cancela todas as mensagens pendentes desta regra para o lead.</p>
      )}
    </div>
  );
}

// ============================
// Rule Form (used in add and edit)
// ============================
function RuleForm({
  triggerType, setTriggerType, selectedStageId, setSelectedStageId,
  steps, setSteps, stages, templates, teamMembers,
  onAddStep, onRemoveStep, onStepChange,
  onCancel, onSave, isSaving,
}: {
  triggerType: CampanhaDispatchRuleTriggerType;
  setTriggerType: (v: CampanhaDispatchRuleTriggerType) => void;
  selectedStageId: string;
  setSelectedStageId: (v: string) => void;
  steps: StepFormState[];
  setSteps: React.Dispatch<React.SetStateAction<StepFormState[]>>;
  stages: CampanhaStage[];
  templates: CampanhaTemplate[];
  teamMembers: { id: string; name: string; role?: string }[];
  onAddStep: () => void;
  onRemoveStep: (i: number) => void;
  onStepChange: (i: number, updates: Partial<StepFormState>) => void;
  onCancel: () => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  return (
    <div className="space-y-4 rounded-md border border-dashed p-3">
      <div className="grid gap-2">
        <Label>Gatilho</Label>
        <Select value={triggerType} onValueChange={(v) => setTriggerType(v as CampanhaDispatchRuleTriggerType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
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
            <SelectTrigger><SelectValue placeholder="Selecione a etapa" /></SelectTrigger>
            <SelectContent>
              {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <ListOrdered className="w-4 h-4" /> Sequência de ações
        </Label>
        {steps.map((step, index) => (
          <StepEditorRow
            key={index}
            step={step}
            index={index}
            stages={stages}
            templates={templates}
            teamMembers={teamMembers}
            onChange={(updates) => onStepChange(index, updates)}
            onRemove={() => onRemoveStep(index)}
            canRemove={steps.length > 1}
          />
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={onAddStep}>
          <Plus className="w-4 h-4 mr-1" /> Adicionar passo
        </Button>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button type="button" size="sm" onClick={onSave} disabled={isSaving}>
          {isSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          Salvar regra
        </Button>
      </div>
    </div>
  );
}

// ============================
// Edit Rule Modal
// ============================
function EditRuleModal({
  rule, stages, templates, teamMembers, onClose, onSave, isSaving,
}: {
  rule: CampanhaDispatchRule;
  stages: CampanhaStage[];
  templates: CampanhaTemplate[];
  teamMembers: { id: string; name: string; role?: string }[];
  onClose: () => void;
  onSave: (ruleId: string, triggerType: CampanhaDispatchRuleTriggerType, selectedStageId: string, steps: StepFormState[]) => Promise<void>;
  isSaving: boolean;
}) {
  const { data: ruleSteps = [], isLoading: loadingSteps } = useCampanhaDispatchRuleSteps(rule.id);
  const [triggerType, setTriggerType] = useState<CampanhaDispatchRuleTriggerType>(rule.trigger_type);
  const [selectedStageId, setSelectedStageId] = useState<string>(rule.campanha_stage_id ?? "");
  const [steps, setSteps] = useState<StepFormState[]>([]);

  useEffect(() => {
    if (ruleSteps.length > 0) {
      setSteps(
        ruleSteps
          .sort((a, b) => a.position - b.position)
          .map((s) => ({
            action_type: (s.action_type as CampanhaDispatchRuleStepActionType) || "send_template",
            template_id: s.template_id || "",
            delay_minutes: s.delay_minutes ?? 0,
            wait_timeout_minutes: s.wait_timeout_minutes ?? 1440,
            timeout_action: (s.timeout_action as CampanhaDispatchRuleTimeoutAction) || "continue",
            timeout_target_stage_id: s.timeout_target_stage_id || "",
            timeout_template_id: s.timeout_template_id || "",
            target_stage_id: s.target_stage_id || "",
            sdr_assignment_mode: (s.sdr_assignment_mode as SdrAssignmentMode) || "specific",
            target_sdr_id: s.target_sdr_id || "",
          }))
      );
    } else {
      setSteps([defaultStep()]);
    }
  }, [ruleSteps]);

  const handleAddStep = () => setSteps((prev) => [...prev, defaultStep()]);
  const handleRemoveStep = (i: number) => { if (steps.length > 1) setSteps((prev) => prev.filter((_, idx) => idx !== i)); };
  const handleStepChange = (i: number, updates: Partial<StepFormState>) => {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...updates } : s)));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar regra de envio</DialogTitle>
        </DialogHeader>
        {loadingSteps ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
          </div>
        ) : (
          <RuleForm
            triggerType={triggerType}
            setTriggerType={(v) => { setTriggerType(v); setSelectedStageId(v === "lead_moved_to_stage" ? selectedStageId : ""); }}
            selectedStageId={selectedStageId}
            setSelectedStageId={setSelectedStageId}
            steps={steps}
            setSteps={setSteps}
            stages={stages}
            templates={templates}
            teamMembers={teamMembers}
            onAddStep={handleAddStep}
            onRemoveStep={handleRemoveStep}
            onStepChange={handleStepChange}
            onCancel={onClose}
            onSave={() => onSave(rule.id, triggerType, selectedStageId, steps)}
            isSaving={isSaving}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
