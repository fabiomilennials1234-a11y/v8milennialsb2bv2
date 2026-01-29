import { useState } from "react";
import { Settings2, MessageSquare, Calendar, Kanban, Zap, Check, X, Plus, Trash2 } from "lucide-react";
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
import { 
  useFollowUpAutomations, 
  useCreateFollowUpAutomation,
  useUpdateFollowUpAutomation, 
  useDeleteFollowUpAutomation,
  type FollowUpAutomation 
} from "@/hooks/useFollowUps";

const pipeConfig = {
  whatsapp: {
    label: "WhatsApp SDR",
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
    label: "Confirmação",
    icon: Calendar,
    color: "text-chart-4",
    stages: [
      { value: "reuniao_marcada", label: "Reunião Marcada" },
      { value: "confirmar_d5", label: "Confirmar D-5" },
      { value: "confirmar_d3", label: "Confirmar D-3" },
      { value: "confirmar_d1", label: "Confirmar D-1" },
      { value: "confirmacao_no_dia", label: "Confirmação no Dia" },
      { value: "compareceu", label: "Compareceu" },
      { value: "perdido", label: "Perdido" },
    ],
  },
  propostas: {
    label: "Propostas",
    icon: Kanban,
    color: "text-primary",
    stages: [
      { value: "marcar_compromisso", label: "Marcar Compromisso" },
      { value: "compromisso_marcado", label: "Compromisso Marcado" },
      { value: "esfriou", label: "Esfriou" },
      { value: "futuro", label: "Futuro" },
      { value: "vendido", label: "Vendido" },
      { value: "perdido", label: "Perdido" },
    ],
  },
};

const priorityLabels = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

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
              {pipeTypeConfig?.label}
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
                      {Object.entries(pipeConfig).map(([key, config]) => (
                        <SelectItem key={key} value={key}>
                          {config.label}
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
                <Label className="text-xs">Título da tarefa</Label>
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
                <Label className="text-xs">Descrição</Label>
                <Input
                  value={editedAutomation.description_template || ""}
                  onChange={(e) => setEditedAutomation({
                    ...editedAutomation,
                    description_template: e.target.value,
                  })}
                  className="h-8 text-sm"
                  placeholder="Descrição opcional"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Dias após entrada na etapa</Label>
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
                    <AlertDialogTitle>Excluir automação?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação não pode ser desfeita. A automação será removida permanentemente.
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

function CreateAutomationForm({ onClose }: { onClose: () => void }) {
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
        Nova Automação
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
                      {config.label}
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
        <Label className="text-xs">Título da tarefa *</Label>
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
        <Label className="text-xs">Descrição (opcional)</Label>
        <Input
          value={newAutomation.description_template}
          onChange={(e) => setNewAutomation({
            ...newAutomation,
            description_template: e.target.value,
          })}
          placeholder="Descrição adicional da tarefa"
          className="h-9"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Dias após entrada na etapa</Label>
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
          Criar Automação
        </Button>
      </div>
    </div>
  );
}

export function AutomationSettings() {
  const { data: automations, isLoading } = useFollowUpAutomations();
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
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Zap className="w-4 h-4" />
          Automações
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[650px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            Configurar Automações de Follow Up
          </DialogTitle>
        </DialogHeader>

        <div className="mt-4">
          <p className="text-sm text-muted-foreground mb-4">
            Configure tarefas automáticas que serão criadas quando leads entrarem em cada etapa dos pipes. 
            Selecione o <strong>pipe de origem</strong> e a <strong>etapa</strong> que vai disparar a tarefa.
          </p>

          {!showCreateForm && (
            <Button 
              onClick={() => setShowCreateForm(true)} 
              className="w-full mb-4 gap-2"
              variant="outline"
            >
              <Plus className="w-4 h-4" />
              Criar Nova Automação
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
                        <span className="font-medium">{config.label}</span>
                        <Badge variant="secondary" className="text-xs">
                          {pipeAutomations.filter((a) => a.is_active).length} ativas
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-2 space-y-3">
                      {pipeAutomations.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          Nenhuma automação configurada para este pipe
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
      </DialogContent>
    </Dialog>
  );
}
