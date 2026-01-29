import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useCreateCampanha, type CampaignType, type AutoConfig } from "@/hooks/useCampanhas";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { toast } from "sonner";
import {
  Plus, X, GripVertical, Target, Users, Calendar, DollarSign,
  Bot, FileText, Kanban, ChevronLeft, ChevronRight, Check,
  Zap, Clock, MousePointer
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { AgentSelectorStep } from "./AgentSelectorStep";
import { TemplateSelectorStep } from "./TemplateSelectorStep";

interface CreateCampanhaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface StageInput {
  id: string;
  name: string;
  color: string;
  is_reuniao_marcada: boolean;
}

const defaultStages: StageInput[] = [
  { id: "1", name: "Novo", color: "#6B7280", is_reuniao_marcada: false },
  { id: "2", name: "Em Contato", color: "#3B82F6", is_reuniao_marcada: false },
  { id: "3", name: "Qualificado", color: "#8B5CF6", is_reuniao_marcada: false },
  { id: "4", name: "Reunião Marcada", color: "#22C55E", is_reuniao_marcada: true },
  { id: "5", name: "Perdido", color: "#EF4444", is_reuniao_marcada: false },
];

const CAMPAIGN_MODES = [
  {
    type: "automatica" as CampaignType,
    title: "Automática",
    description: "IA envia mensagens e conversa até atingir o objetivo",
    icon: Bot,
    color: "text-purple-600",
    bgColor: "bg-purple-50",
    borderColor: "border-purple-200",
    features: ["Copilot envia primeira mensagem", "IA responde automaticamente", "Move leads no Kanban"],
    badge: "Recomendado",
    badgeColor: "bg-purple-100 text-purple-700",
  },
  {
    type: "semi_automatica" as CampaignType,
    title: "Semi-Automática",
    description: "Disparo de templates em lote com agendamento",
    icon: Zap,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    features: ["Disparo imediato ou agendado", "Templates personalizados", "SDR trabalha respostas"],
    badge: null,
  },
  {
    type: "manual" as CampaignType,
    title: "Manual",
    description: "Controle total via Kanban tradicional",
    icon: MousePointer,
    color: "text-gray-600",
    bgColor: "bg-muted",
    borderColor: "border-gray-200",
    features: ["Kanban drag-drop", "Sem automação", "Controle total do SDR"],
    badge: null,
  },
];

type WizardStep = "mode" | "config" | "details" | "stages" | "members";

const STEP_ORDER: WizardStep[] = ["mode", "config", "details", "stages", "members"];

const STEP_LABELS: Record<WizardStep, string> = {
  mode: "Tipo",
  config: "Configuração",
  details: "Detalhes",
  stages: "Etapas",
  members: "Equipe",
};

export function CreateCampanhaModal({ open, onOpenChange }: CreateCampanhaModalProps) {
  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>("mode");

  // Campaign mode
  const [campaignType, setCampaignType] = useState<CampaignType>("manual");

  // Automatic mode config
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [autoConfig, setAutoConfig] = useState<AutoConfig>({
    delay_minutes: 5,
    send_on_add_lead: true,
    working_hours_only: false,
    working_hours: { start: "09:00", end: "18:00" },
  });

  // Semi-automatic mode config
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);

  // Basic info
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState(format(new Date(), "yyyy-MM-dd"));
  const [teamGoal, setTeamGoal] = useState(30);
  const [individualGoal, setIndividualGoal] = useState(10);
  const [bonusValue, setBonusValue] = useState(500);

  // Stages and members
  const [stages, setStages] = useState<StageInput[]>(defaultStages);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  const createCampanha = useCreateCampanha();
  const { data: teamMembers } = useTeamMembers();

  // Calculate steps based on campaign type
  const getStepsForType = (type: CampaignType): WizardStep[] => {
    switch (type) {
      case "automatica":
        return ["mode", "config", "details", "stages", "members"]; // config = agent selector
      case "semi_automatica":
        return ["mode", "config", "details", "stages", "members"]; // config = template selector
      case "manual":
      default:
        return ["mode", "details", "stages", "members"]; // no config step
    }
  };

  const activeSteps = getStepsForType(campaignType);
  const currentStepIndex = activeSteps.indexOf(currentStep);
  const progress = ((currentStepIndex + 1) / activeSteps.length) * 100;
  const isLastStep = currentStepIndex === activeSteps.length - 1;

  const canGoNext = () => {
    switch (currentStep) {
      case "mode":
        return true;
      case "config":
        if (campaignType === "automatica") {
          return !!selectedAgentId;
        }
        if (campaignType === "semi_automatica") {
          return selectedTemplateIds.length > 0;
        }
        return true;
      case "details":
        return name.trim().length > 0;
      case "stages":
        return stages.filter((s) => s.name.trim()).length >= 2 && stages.some((s) => s.is_reuniao_marcada);
      case "members":
        return selectedMembers.length > 0;
      default:
        return false;
    }
  };

  const goNext = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < activeSteps.length) {
      setCurrentStep(activeSteps[nextIndex]);
    }
  };

  const goBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(activeSteps[prevIndex]);
    }
  };

  const handleModeSelect = (type: CampaignType) => {
    setCampaignType(type);
    // Reset config when changing mode
    setSelectedAgentId(null);
    setSelectedTemplateIds([]);
  };

  const handleAddStage = () => {
    const newStage: StageInput = {
      id: Date.now().toString(),
      name: "",
      color: "#3B82F6",
      is_reuniao_marcada: false,
    };
    setStages([...stages, newStage]);
  };

  const handleRemoveStage = (id: string) => {
    setStages(stages.filter((s) => s.id !== id));
  };

  const handleStageChange = (id: string, field: keyof StageInput, value: string | boolean) => {
    setStages(stages.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const handleSetReuniaoMarcada = (id: string) => {
    setStages(stages.map((s) => ({
      ...s,
      is_reuniao_marcada: s.id === id,
    })));
  };

  const handleMemberToggle = (memberId: string) => {
    setSelectedMembers((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId]
    );
  };

  const handleSubmit = async () => {
    if (!canGoNext()) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    try {
      await createCampanha.mutateAsync({
        name,
        description: description || null,
        deadline: new Date(deadline).toISOString(),
        team_goal: teamGoal,
        individual_goal: individualGoal,
        bonus_value: bonusValue,
        campaign_type: campaignType,
        agent_id: campaignType === "automatica" ? selectedAgentId : null,
        auto_config: campaignType === "automatica" ? autoConfig : null,
        stages: stages
          .filter((s) => s.name.trim())
          .map((s, index) => ({
            name: s.name,
            color: s.color,
            position: index,
            is_reuniao_marcada: s.is_reuniao_marcada,
          })),
        memberIds: selectedMembers,
        templateIds: campaignType === "semi_automatica" ? selectedTemplateIds : undefined,
      });

      toast.success("Campanha criada com sucesso!");
      onOpenChange(false);
      resetForm();
    } catch (error) {
      toast.error("Erro ao criar campanha");
      console.error(error);
    }
  };

  const resetForm = () => {
    setCurrentStep("mode");
    setCampaignType("manual");
    setSelectedAgentId(null);
    setAutoConfig({
      delay_minutes: 5,
      send_on_add_lead: true,
      working_hours_only: false,
      working_hours: { start: "09:00", end: "18:00" },
    });
    setSelectedTemplateIds([]);
    setName("");
    setDescription("");
    setDeadline(format(new Date(), "yyyy-MM-dd"));
    setTeamGoal(30);
    setIndividualGoal(10);
    setBonusValue(500);
    setStages(defaultStages);
    setSelectedMembers([]);
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case "mode":
        return (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold">Escolha o tipo de campanha</h3>
              <p className="text-sm text-muted-foreground">
                Cada tipo oferece diferentes níveis de automação
              </p>
            </div>

            <div className="grid gap-4">
              {CAMPAIGN_MODES.map((mode) => {
                const Icon = mode.icon;
                const isSelected = campaignType === mode.type;

                return (
                  <Card
                    key={mode.type}
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-md",
                      isSelected && "ring-2 ring-primary shadow-md",
                      mode.bgColor
                    )}
                    onClick={() => handleModeSelect(mode.type)}
                  >
                    <CardContent className="p-4 flex items-start gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-lg flex items-center justify-center shrink-0",
                        isSelected ? "bg-primary text-primary-foreground" : "bg-card shadow-sm border border-border"
                      )}>
                        <Icon className={cn("w-6 h-6", !isSelected && mode.color)} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{mode.title}</span>
                          {mode.badge && (
                            <Badge className={mode.badgeColor}>
                              {mode.badge}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {mode.description}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-3">
                          {mode.features.map((feature, i) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              {feature}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {isSelected && (
                        <Check className="w-5 h-5 text-primary shrink-0" />
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );

      case "config":
        if (campaignType === "automatica") {
          return (
            <AgentSelectorStep
              selectedAgentId={selectedAgentId}
              onAgentSelect={setSelectedAgentId}
              autoConfig={autoConfig}
              onAutoConfigChange={setAutoConfig}
            />
          );
        }
        if (campaignType === "semi_automatica") {
          return (
            <TemplateSelectorStep
              selectedTemplateIds={selectedTemplateIds}
              onTemplatesChange={setSelectedTemplateIds}
            />
          );
        }
        return null;

      case "details":
        return (
          <div className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="name">Nome da Campanha *</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Black Friday 2026"
                  />
                </div>

                <div className="col-span-2 space-y-2">
                  <Label htmlFor="description">Descrição</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descrição da campanha..."
                    rows={2}
                  />
                </div>
              </div>
            </div>

            {/* Goals */}
            <div className="space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Target className="w-4 h-4" />
                Metas e Bônus
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="deadline" className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Prazo Final
                  </Label>
                  <Input
                    id="deadline"
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="teamGoal">Meta do Time (reuniões)</Label>
                  <Input
                    id="teamGoal"
                    type="number"
                    min={1}
                    value={teamGoal}
                    onChange={(e) => setTeamGoal(Number(e.target.value))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="individualGoal">Meta Individual (reuniões)</Label>
                  <Input
                    id="individualGoal"
                    type="number"
                    min={1}
                    value={individualGoal}
                    onChange={(e) => setIndividualGoal(Number(e.target.value))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bonusValue" className="flex items-center gap-1">
                    <DollarSign className="w-3 h-3" />
                    Bônus por Meta
                  </Label>
                  <Input
                    id="bonusValue"
                    type="number"
                    min={0}
                    value={bonusValue}
                    onChange={(e) => setBonusValue(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case "stages":
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Etapas do Pipe</h3>
                <p className="text-xs text-muted-foreground">
                  Defina as etapas do Kanban para esta campanha
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={handleAddStage}>
                <Plus className="w-4 h-4 mr-1" />
                Adicionar
              </Button>
            </div>

            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {stages.map((stage, index) => (
                <div key={stage.id} className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
                  <GripVertical className="w-4 h-4 text-muted-foreground" />

                  <Input
                    value={stage.name}
                    onChange={(e) => handleStageChange(stage.id, "name", e.target.value)}
                    placeholder={`Etapa ${index + 1}`}
                    className="flex-1"
                  />

                  <input
                    type="color"
                    value={stage.color}
                    onChange={(e) => handleStageChange(stage.id, "color", e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer"
                  />

                  <div className="flex items-center gap-1">
                    <Checkbox
                      id={`reuniao-${stage.id}`}
                      checked={stage.is_reuniao_marcada}
                      onCheckedChange={() => handleSetReuniaoMarcada(stage.id)}
                    />
                    <Label htmlFor={`reuniao-${stage.id}`} className="text-xs whitespace-nowrap cursor-pointer">
                      Reunião Marcada
                    </Label>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveStage(stage.id)}
                    className="h-8 w-8"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              * Marque uma etapa como "Reunião Marcada" para que leads nela sejam contabilizados.
            </p>
          </div>
        );

      case "members":
        return (
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <Users className="w-4 h-4" />
                Vendedores com Acesso
              </h3>
              <p className="text-xs text-muted-foreground">
                Selecione quem terá acesso a esta campanha
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 max-h-[280px] overflow-y-auto">
              {teamMembers?.map((member) => (
                <label
                  key={member.id}
                  className={cn(
                    "flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-colors",
                    "hover:bg-muted/50",
                    selectedMembers.includes(member.id) && "bg-primary/5 border border-primary/20"
                  )}
                >
                  <Checkbox
                    checked={selectedMembers.includes(member.id)}
                    onCheckedChange={() => handleMemberToggle(member.id)}
                  />
                  <div>
                    <span className="text-sm font-medium">{member.name}</span>
                    <span className="text-xs text-muted-foreground capitalize ml-2">({member.role})</span>
                  </div>
                </label>
              ))}
            </div>

            {selectedMembers.length > 0 && (
              <div className="flex items-center gap-2 p-3 bg-primary/5 rounded-lg border border-primary/20">
                <Check className="w-4 h-4 text-primary" />
                <span className="text-sm">
                  <strong>{selectedMembers.length}</strong> vendedor(es) selecionado(s)
                </span>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            Criar Nova Campanha
          </DialogTitle>

          {/* Progress */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Passo {currentStepIndex + 1} de {activeSteps.length}: {STEP_LABELS[currentStep]}
              </span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-1" />

            {/* Step indicators */}
            <div className="flex items-center justify-center gap-2 pt-2">
              {activeSteps.map((step, index) => (
                <div
                  key={step}
                  className={cn(
                    "w-2 h-2 rounded-full transition-colors",
                    index < currentStepIndex && "bg-primary",
                    index === currentStepIndex && "bg-primary ring-2 ring-primary/20",
                    index > currentStepIndex && "bg-muted"
                  )}
                />
              ))}
            </div>
          </div>
        </DialogHeader>

        {/* Step Content */}
        <div className="flex-1 overflow-y-auto py-4">
          {renderStepContent()}
        </div>

        {/* Navigation */}
        <div className="shrink-0 flex items-center justify-between pt-4 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={goBack}
            disabled={currentStepIndex === 0}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Voltar
          </Button>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>

            {isLastStep ? (
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!canGoNext() || createCampanha.isPending}
              >
                {createCampanha.isPending ? "Criando..." : "Criar Campanha"}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={goNext}
                disabled={!canGoNext()}
              >
                Próximo
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
