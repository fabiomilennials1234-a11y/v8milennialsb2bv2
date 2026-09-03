import { useState } from "react";
import { Settings2, MessageSquare, Calendar, Kanban, Zap, Check, X, Plus, Trash2, Clock, Timer, UserX, CalendarX } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { usePipelineDisplayConfig } from "@/modules/pipelines";
import { NOME_DE_FABRICA } from "@/contracts/pipe";
import {
  useFollowUpAutomations,
  useCreateFollowUpAutomation,
  useUpdateFollowUpAutomation,
  useDeleteFollowUpAutomation,
  type FollowUpAutomation,
  type TriggerType,
} from "@/modules/engagement/hooks/useFollowUps";

// SCRUM-641: o NOME do funil saiu daqui — vinha do seed congelado
// ("Qualificação"/"Confirmacao"/"Propostas") e aparecia independente do que a
// org chama seus funis. O rótulo agora vem de `useNomeDoPipe` (display_config).
// Ícone/cor/etapas seguem cravados (dívida conhecida: etapas legacy).
const pipeConfig = {
  whatsapp: {
    icon: MessageSquare,
    color: "text-success",
    stages: [
      { value: "novo", label: "Novo" },
      { value: "em_contato", label: "Em Contato" },
      { value: "agendado", label: "Agendado" },
      { value: "compareceu", label: "Compareceu" },
    ],
  },
  confirmacao: {
    icon: Calendar,
    color: "text-chart-4",
    stages: [
      { value: "reuniao_marcada", label: "Reuniao Marcada" },
      { value: "confirmar_d5", label: "Confirmar D-5" },
      { value: "confirmar_d3", label: "Confirmar D-3" },
      { value: "confirmar_d1", label: "Confirmar D-1" },
      { value: "confirmacao_no_dia", label: "Confirmacao no Dia" },
      { value: "compareceu", label: "Compareceu" },
      { value: "perdido", label: "Perdido" },
    ],
  },
  propostas: {
    icon: Kanban,
    color: "text-primary",
    stages: [
      { value: "marcar_compromisso", label: "Marcar Compromisso" },
      { value: "compromisso_marcado", label: "Compromisso Marcado" },
      { value: "proposta_enviada", label: "Proposta Enviada" },
      { value: "esfriou", label: "Esfriou" },
      { value: "futuro", label: "Futuro" },
      { value: "vendido", label: "Vendido" },
      { value: "perdido", label: "Perdido" },
    ],
  },
};

/**
 * O nome que a ORG usa para cada funil de sistema (SCRUM-641).
 * Linha de display ausente = a org não tem (mais) o funil → fallback honesto.
 */
function useNomeDoPipe() {
  const { data: displayConfigs } = usePipelineDisplayConfig();
  return (pipeType: string): string => {
    const c = displayConfigs?.find((x) => x.pipe_type === pipeType);
    return c ? c.display_name || NOME_DE_FABRICA[pipeType] || pipeType : "Funil removido";
  };
}

const priorityLabels: Record<string, string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

const triggerTypeLabels: Record<string, string> = {
  no_response_from_team: "Equipe nao respondeu",
  no_response_from_lead: "Lead nao respondeu",
  not_confirmed: "Nao confirmou reuniao",
};

const triggerTypeDescriptions: Record<string, string> = {
  no_response_from_team: "Cria revisao quando o lead manda mensagem e a equipe nao responde dentro do tempo configurado",
  no_response_from_lead: "Cria revisao quando a equipe manda mensagem e o lead nao responde dentro do tempo configurado",
  not_confirmed: "Cria revisao quando o lead tem reuniao marcada mas nao confirmou presenca dentro do tempo configurado",
};

const triggerTypeIcons: Record<string, typeof Clock> = {
  no_response_from_team: UserX,
  no_response_from_lead: Timer,
  not_confirmed: CalendarX,
};

// ============================================
// COMPONENTE: Item de Automação por Etapa (existente)
// ============================================

interface AutomationItemProps {
  automation: FollowUpAutomation;
  onUpdate: (id: string, updates: Partial<FollowUpAutomation>) => void;
  onDelete: (id: string) => void;
}

function AutomationItem({ automation, onUpdate, onDelete }: AutomationItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedAutomation, setEditedAutomation] = useState(automation);

  const handleSave = () => {
    onUpdate(automation.id, {
      pipe_type: editedAutomation.pipe_type,
      stage: editedAutomation.stage,
      title_template: editedAutomation.title_template,
      description_template: editedAutomation.description_template,
      days_offset: editedAutomation.days_offset,
      priority: editedAutomation.priority,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedAutomation(automation);
    setIsEditing(false);
  };

  const nomeDoPipe = useNomeDoPipe();
  const pipeTypeConfig = pipeConfig[automation.pipe_type];
  const stageLabel = pipeTypeConfig?.stages.find(
    (s) => s.value === automation.stage
  )?.label || automation.stage;

  return (
    <div className="p-4 rounded-lg border bg-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge variant="outline" className={`text-xs ${pipeTypeConfig?.color}`}>
              {nomeDoPipe(automation.pipe_type)}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {stageLabel}
            </Badge>
            <Badge variant="outline" className="text-xs">
              +{automation.days_offset} dias
            </Badge>
            <Badge
              variant="outline"
              className={`text-xs ${
                automation.priority === "urgent" ? "text-destructive border-destructive/30" :
                automation.priority === "high" ? "text-chart-5 border-chart-5/30" :
                "text-muted-foreground"
              }`}
            >
              {priorityLabels[automation.priority]}
            </Badge>
          </div>

          {isEditing ? (
            <div className="space-y-3 mt-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Pipe</Label>
                  <Select
                    value={editedAutomation.pipe_type}
                    onValueChange={(v: FollowUpAutomation["pipe_type"]) => {
                      setEditedAutomation({
                        ...editedAutomation,
                        pipe_type: v,
                        stage: pipeConfig[v].stages[0].value
                      });
                    }}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.keys(pipeConfig).map((key) => (
                        <SelectItem key={key} value={key}>
                          {nomeDoPipe(key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Etapa</Label>
                  <Select
                    value={editedAutomation.stage}
                    onValueChange={(v) => setEditedAutomation({ ...editedAutomation, stage: v })}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {pipeConfig[editedAutomation.pipe_type].stages.map((stage) => (
                        <SelectItem key={stage.value} value={stage.value}>
                          {stage.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Titulo da tarefa</Label>
                <Input
                  value={editedAutomation.title_template}
                  onChange={(e) => setEditedAutomation({
                    ...editedAutomation,
                    title_template: e.target.value,
                  })}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Descricao</Label>
                <Input
                  value={editedAutomation.description_template || ""}
                  onChange={(e) => setEditedAutomation({
                    ...editedAutomation,
                    description_template: e.target.value,
                  })}
                  className="h-8 text-sm"
                  placeholder="Descricao opcional"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Dias apos entrada na etapa</Label>
                  <Input
                    type="number"
                    min={0}
                    value={editedAutomation.days_offset}
                    onChange={(e) => setEditedAutomation({
                      ...editedAutomation,
                      days_offset: parseInt(e.target.value) || 0,
                    })}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Prioridade</Label>
                  <Select
                    value={editedAutomation.priority}
                    onValueChange={(v: FollowUpAutomation["priority"]) =>
                      setEditedAutomation({ ...editedAutomation, priority: v })
                    }
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Baixa</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">Alta</SelectItem>
                      <SelectItem value="urgent">Urgente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={handleCancel}>
                  <X className="w-4 h-4 mr-1" />
                  Cancelar
                </Button>
                <Button size="sm" onClick={handleSave}>
                  <Check className="w-4 h-4 mr-1" />
                  Salvar
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="font-medium text-sm">{automation.title_template}</p>
              {automation.description_template && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {automation.description_template}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!isEditing && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsEditing(true)}
                className="h-7 px-2"
              >
                Editar
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir automacao?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta acao nao pode ser desfeita. A automacao sera removida permanentemente.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onDelete(automation.id)}>
                      Excluir
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          <Switch
            checked={automation.is_active}
            onCheckedChange={(checked) => onUpdate(automation.id, { is_active: checked })}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================
// COMPONENTE: Formulário de criação por etapa (existente)
// ============================================

function CreateAutomationForm({ onClose }: { onClose: () => void }) {
  const nomeDoPipe = useNomeDoPipe();
  const createAutomation = useCreateFollowUpAutomation();
  const [newAutomation, setNewAutomation] = useState({
    pipe_type: "whatsapp" as FollowUpAutomation["pipe_type"],
    stage: "novo",
    title_template: "",
    description_template: "",
    days_offset: 0,
    priority: "normal" as FollowUpAutomation["priority"],
    is_active: true,
  });

  const handleCreate = () => {
    if (!newAutomation.title_template.trim()) return;

    createAutomation.mutate({
      ...newAutomation,
      trigger_type: "stage_change",
      description_template: newAutomation.description_template || undefined,
    }, {
      onSuccess: () => {
        onClose();
      },
    });
  };

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
      <h4 className="font-medium text-sm flex items-center gap-2">
        <Plus className="w-4 h-4" />
        Nova Automacao por Etapa
      </h4>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Pipe de origem *</Label>
          <Select
            value={newAutomation.pipe_type}
            onValueChange={(v: FollowUpAutomation["pipe_type"]) => {
              setNewAutomation({
                ...newAutomation,
                pipe_type: v,
                stage: pipeConfig[v].stages[0].value
              });
            }}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(pipeConfig).map(([key, config]) => {
                const Icon = config.icon;
                return (
                  <SelectItem key={key} value={key}>
                    <span className="flex items-center gap-2">
                      <Icon className={`w-4 h-4 ${config.color}`} />
                      {nomeDoPipe(key)}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Etapa que dispara *</Label>
          <Select
            value={newAutomation.stage}
            onValueChange={(v) => setNewAutomation({ ...newAutomation, stage: v })}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pipeConfig[newAutomation.pipe_type].stages.map((stage) => (
                <SelectItem key={stage.value} value={stage.value}>
                  {stage.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label className="text-xs">Titulo da tarefa *</Label>
        <Input
          value={newAutomation.title_template}
          onChange={(e) => setNewAutomation({
            ...newAutomation,
            title_template: e.target.value,
          })}
          placeholder="Ex: Entrar em contato com lead"
          className="h-9"
        />
      </div>

      <div>
        <Label className="text-xs">Descricao (opcional)</Label>
        <Input
          value={newAutomation.description_template}
          onChange={(e) => setNewAutomation({
            ...newAutomation,
            description_template: e.target.value,
          })}
          placeholder="Descricao adicional da tarefa"
          className="h-9"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Dias apos entrada na etapa</Label>
          <Input
            type="number"
            min={0}
            value={newAutomation.days_offset}
            onChange={(e) => setNewAutomation({
              ...newAutomation,
              days_offset: parseInt(e.target.value) || 0,
            })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Prioridade</Label>
          <Select
            value={newAutomation.priority}
            onValueChange={(v: FollowUpAutomation["priority"]) =>
              setNewAutomation({ ...newAutomation, priority: v })
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Baixa</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="high">Alta</SelectItem>
              <SelectItem value="urgent">Urgente</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={handleCreate}
          disabled={!newAutomation.title_template.trim() || createAutomation.isPending}
        >
          <Plus className="w-4 h-4 mr-1" />
          Criar Automacao
        </Button>
      </div>
    </div>
  );
}

// ============================================
// COMPONENTE: Item de Automação por Tempo (NOVO)
// ============================================

function TimeBasedAutomationItem({ automation, onUpdate, onDelete }: AutomationItemProps) {
  const TriggerIcon = triggerTypeIcons[automation.trigger_type] || Clock;
  const nomeDoPipe = useNomeDoPipe();
  const pipeTypeConfig = pipeConfig[automation.pipe_type];

  const delayLabel = automation.trigger_type === "not_confirmed"
    ? `${automation.trigger_delay_hours}h${automation.trigger_delay_minutes > 0 ? `${automation.trigger_delay_minutes}min` : ""} antes da reuniao`
    : `${automation.trigger_delay_hours}h${automation.trigger_delay_minutes > 0 ? `${automation.trigger_delay_minutes}min` : ""} sem resposta`;

  return (
    <div className="p-4 rounded-lg border bg-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge variant="outline" className="text-xs gap-1">
              <TriggerIcon className="w-3 h-3" />
              {triggerTypeLabels[automation.trigger_type]}
            </Badge>
            <Badge variant="outline" className={`text-xs ${pipeTypeConfig?.color}`}>
              {nomeDoPipe(automation.pipe_type)}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {delayLabel}
            </Badge>
            <Badge
              variant="outline"
              className={`text-xs ${
                automation.priority === "urgent" ? "text-destructive border-destructive/30" :
                automation.priority === "high" ? "text-chart-5 border-chart-5/30" :
                "text-muted-foreground"
              }`}
            >
              {priorityLabels[automation.priority]}
            </Badge>
            {automation.copilot_can_handle && (
              <Badge variant="secondary" className="text-xs text-chart-4">
                Copiloto
              </Badge>
            )}
          </div>

          <p className="font-medium text-sm">{automation.title_template}</p>
          {automation.description_template && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {automation.description_template}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            Max {automation.max_triggers_per_lead}x por lead
            {automation.filter_stages && automation.filter_stages.length > 0 && (
              <> &middot; Etapas: {automation.filter_stages.map(s => {
                const stageObj = pipeTypeConfig?.stages.find(st => st.value === s);
                return stageObj?.label || s;
              }).join(", ")}</>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive">
                <Trash2 className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir automacao?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta acao nao pode ser desfeita. A automacao sera removida permanentemente.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(automation.id)}>
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Switch
            checked={automation.is_active}
            onCheckedChange={(checked) => onUpdate(automation.id, { is_active: checked })}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================
// COMPONENTE: Formulário de criação por Tempo (NOVO)
// ============================================

function CreateTimeBasedForm({ onClose }: { onClose: () => void }) {
  const nomeDoPipe = useNomeDoPipe();
  const createAutomation = useCreateFollowUpAutomation();
  const [form, setForm] = useState({
    trigger_type: "no_response_from_team" as TriggerType,
    pipe_type: "whatsapp" as FollowUpAutomation["pipe_type"],
    title_template: "",
    description_template: "",
    trigger_delay_hours: 2,
    trigger_delay_minutes: 0,
    priority: "high" as FollowUpAutomation["priority"],
    max_triggers_per_lead: 3,
    copilot_can_handle: false,
    filter_stages: [] as string[],
    is_active: true,
  });

  const handleCreate = () => {
    if (!form.title_template.trim()) return;

    createAutomation.mutate({
      trigger_type: form.trigger_type,
      pipe_type: form.pipe_type,
      stage: form.trigger_type === "not_confirmed" ? "reuniao_marcada" : "_time_based",
      title_template: form.title_template,
      description_template: form.description_template || undefined,
      trigger_delay_hours: form.trigger_delay_hours,
      trigger_delay_minutes: form.trigger_delay_minutes,
      priority: form.priority,
      max_triggers_per_lead: form.max_triggers_per_lead,
      copilot_can_handle: form.copilot_can_handle,
      filter_stages: form.filter_stages.length > 0 ? form.filter_stages : undefined,
      is_active: form.is_active,
    }, {
      onSuccess: () => onClose(),
    });
  };

  const availableStages = pipeConfig[form.pipe_type]?.stages || [];

  const toggleStage = (stageValue: string) => {
    setForm(prev => ({
      ...prev,
      filter_stages: prev.filter_stages.includes(stageValue)
        ? prev.filter_stages.filter(s => s !== stageValue)
        : [...prev.filter_stages, stageValue],
    }));
  };

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
      <h4 className="font-medium text-sm flex items-center gap-2">
        <Clock className="w-4 h-4" />
        Nova Regra por Tempo
      </h4>

      {/* Tipo de gatilho */}
      <div>
        <Label className="text-xs">Tipo de gatilho *</Label>
        <Select
          value={form.trigger_type}
          onValueChange={(v: TriggerType) => {
            setForm({
              ...form,
              trigger_type: v,
              pipe_type: v === "not_confirmed" ? "confirmacao" : form.pipe_type,
            });
          }}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="no_response_from_team">
              Equipe nao respondeu o lead
            </SelectItem>
            <SelectItem value="no_response_from_lead">
              Lead nao nos respondeu
            </SelectItem>
            <SelectItem value="not_confirmed">
              Lead nao confirmou reuniao
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {triggerTypeDescriptions[form.trigger_type]}
        </p>
      </div>

      {/* Funil */}
      <div>
        <Label className="text-xs">Funil *</Label>
        <Select
          value={form.pipe_type}
          onValueChange={(v: FollowUpAutomation["pipe_type"]) => {
            setForm({ ...form, pipe_type: v, filter_stages: [] });
          }}
          disabled={form.trigger_type === "not_confirmed"}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(pipeConfig).map(([key, config]) => {
              const Icon = config.icon;
              return (
                <SelectItem key={key} value={key}>
                  <span className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${config.color}`} />
                    {nomeDoPipe(key)}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Filtro por etapas (opcional) */}
      <div>
        <Label className="text-xs">Filtrar por etapas (opcional)</Label>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {availableStages.map((stage) => (
            <Badge
              key={stage.value}
              variant={form.filter_stages.includes(stage.value) ? "default" : "outline"}
              className="cursor-pointer text-xs"
              onClick={() => toggleStage(stage.value)}
            >
              {stage.label}
            </Badge>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {form.filter_stages.length === 0 ? "Todas as etapas" : `${form.filter_stages.length} selecionada(s)`}
        </p>
      </div>

      {/* Tempo de espera */}
      <div>
        <Label className="text-xs">
          {form.trigger_type === "not_confirmed" ? "Tempo antes da reuniao *" : "Tempo de espera *"}
        </Label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <div>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={0}
                max={168}
                value={form.trigger_delay_hours}
                onChange={(e) => setForm({ ...form, trigger_delay_hours: parseInt(e.target.value) || 0 })}
                className="h-9"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">horas</span>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={0}
                max={59}
                value={form.trigger_delay_minutes}
                onChange={(e) => setForm({ ...form, trigger_delay_minutes: parseInt(e.target.value) || 0 })}
                className="h-9"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">min</span>
            </div>
          </div>
        </div>
      </div>

      {/* Titulo */}
      <div>
        <Label className="text-xs">Titulo da revisao *</Label>
        <Input
          value={form.title_template}
          onChange={(e) => setForm({ ...form, title_template: e.target.value })}
          placeholder={
            form.trigger_type === "no_response_from_team" ? "Ex: Lead aguardando resposta" :
            form.trigger_type === "no_response_from_lead" ? "Ex: Follow up - lead sem resposta" :
            "Ex: Confirmar presenca na reuniao"
          }
          className="h-9"
        />
      </div>

      {/* Descricao */}
      <div>
        <Label className="text-xs">Descricao (opcional)</Label>
        <Input
          value={form.description_template}
          onChange={(e) => setForm({ ...form, description_template: e.target.value })}
          placeholder="Descricao adicional da tarefa"
          className="h-9"
        />
      </div>

      {/* Prioridade + Max por lead */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Prioridade</Label>
          <Select
            value={form.priority}
            onValueChange={(v: FollowUpAutomation["priority"]) => setForm({ ...form, priority: v })}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Baixa</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="high">Alta</SelectItem>
              <SelectItem value="urgent">Urgente</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Max por lead</Label>
          <Input
            type="number"
            min={1}
            max={10}
            value={form.max_triggers_per_lead}
            onChange={(e) => setForm({ ...form, max_triggers_per_lead: parseInt(e.target.value) || 1 })}
            className="h-9"
          />
        </div>
      </div>

      {/* Copiloto */}
      <div className="flex items-center gap-2">
        <Switch
          id="copilot-handle"
          checked={form.copilot_can_handle}
          onCheckedChange={(checked) => setForm({ ...form, copilot_can_handle: checked })}
        />
        <Label htmlFor="copilot-handle" className="text-sm cursor-pointer">
          Copiloto pode resolver automaticamente
        </Label>
      </div>

      {/* Botoes */}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={handleCreate}
          disabled={!form.title_template.trim() || (form.trigger_delay_hours === 0 && form.trigger_delay_minutes === 0) || createAutomation.isPending}
        >
          <Plus className="w-4 h-4 mr-1" />
          Criar Regra
        </Button>
      </div>
    </div>
  );
}

// ============================================
// COMPONENTE: Aba "Por Etapa" (existente)
// ============================================

function StageBasedTab() {
  const nomeDoPipe = useNomeDoPipe();
  const { data: automations, isLoading } = useFollowUpAutomations("stage_change");
  const updateAutomation = useUpdateFollowUpAutomation();
  const deleteAutomation = useDeleteFollowUpAutomation();
  const [showCreateForm, setShowCreateForm] = useState(false);

  const handleUpdate = (id: string, updates: Partial<FollowUpAutomation>) => {
    updateAutomation.mutate({ id, ...updates });
  };

  const handleDelete = (id: string) => {
    deleteAutomation.mutate(id);
  };

  const groupedAutomations = automations?.reduce((acc, automation) => {
    if (!acc[automation.pipe_type]) {
      acc[automation.pipe_type] = [];
    }
    acc[automation.pipe_type].push(automation);
    return acc;
  }, {} as Record<string, FollowUpAutomation[]>);

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Tarefas criadas automaticamente quando leads entram em cada etapa dos funis.
      </p>

      {!showCreateForm && (
        <Button
          onClick={() => setShowCreateForm(true)}
          className="w-full mb-4 gap-2"
          variant="outline"
        >
          <Plus className="w-4 h-4" />
          Criar Nova Automacao
        </Button>
      )}

      {showCreateForm && (
        <div className="mb-4">
          <CreateAutomationForm onClose={() => setShowCreateForm(false)} />
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">
          Carregando...
        </div>
      ) : (
        <Accordion type="single" collapsible className="space-y-2">
          {Object.entries(pipeConfig).map(([pipeType, config]) => {
            const PipeIcon = config.icon;
            const pipeAutomations = groupedAutomations?.[pipeType] || [];

            return (
              <AccordionItem
                key={pipeType}
                value={pipeType}
                className="border rounded-lg px-4"
              >
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <PipeIcon className={`w-4 h-4 ${config.color}`} />
                    <span className="font-medium">{nomeDoPipe(pipeType)}</span>
                    <Badge variant="secondary" className="text-xs">
                      {pipeAutomations.filter((a) => a.is_active).length} ativas
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2 space-y-3">
                  {pipeAutomations.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Nenhuma automacao configurada para este pipe
                    </p>
                  ) : (
                    pipeAutomations.map((automation) => (
                      <AutomationItem
                        key={automation.id}
                        automation={automation}
                        onUpdate={handleUpdate}
                        onDelete={handleDelete}
                      />
                    ))
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}

// ============================================
// COMPONENTE: Aba "Por Tempo" (NOVA)
// ============================================

function TimeBasedTab() {
  const { data: noResponseTeam } = useFollowUpAutomations("no_response_from_team");
  const { data: noResponseLead } = useFollowUpAutomations("no_response_from_lead");
  const { data: notConfirmed } = useFollowUpAutomations("not_confirmed");
  const updateAutomation = useUpdateFollowUpAutomation();
  const deleteAutomation = useDeleteFollowUpAutomation();
  const [showCreateForm, setShowCreateForm] = useState(false);

  const allTimeRules = [
    ...(noResponseTeam || []),
    ...(noResponseLead || []),
    ...(notConfirmed || []),
  ];

  const handleUpdate = (id: string, updates: Partial<FollowUpAutomation>) => {
    updateAutomation.mutate({ id, ...updates });
  };

  const handleDelete = (id: string) => {
    deleteAutomation.mutate(id);
  };

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Regras que criam revisoes automaticamente com base em tempo: quando ninguem responde, ou quando o lead nao confirma uma reuniao.
      </p>

      {!showCreateForm && (
        <Button
          onClick={() => setShowCreateForm(true)}
          className="w-full mb-4 gap-2"
          variant="outline"
        >
          <Plus className="w-4 h-4" />
          Criar Nova Regra
        </Button>
      )}

      {showCreateForm && (
        <div className="mb-4">
          <CreateTimeBasedForm onClose={() => setShowCreateForm(false)} />
        </div>
      )}

      {allTimeRules.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Clock className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Nenhuma regra por tempo configurada</p>
          <p className="text-xs mt-1">Crie regras para automatizar revisoes com base em tempo de resposta</p>
        </div>
      ) : (
        <div className="space-y-3">
          {allTimeRules.map((automation) => (
            <TimeBasedAutomationItem
              key={automation.id}
              automation={automation}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// COMPONENTE PRINCIPAL: AutomationSettings
// ============================================

export function AutomationSettings() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Zap className="w-4 h-4" />
          Automacoes
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            Configurar Automacoes de Follow Up
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="stage" className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="stage" className="gap-1.5">
              <Kanban className="w-4 h-4" />
              Por Etapa
            </TabsTrigger>
            <TabsTrigger value="time" className="gap-1.5">
              <Clock className="w-4 h-4" />
              Por Tempo
            </TabsTrigger>
          </TabsList>

          <TabsContent value="stage" className="mt-4">
            <StageBasedTab />
          </TabsContent>

          <TabsContent value="time" className="mt-4">
            <TimeBasedTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
