import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  useCreateCampanha,
  type CampaignType, type CampaignObjective, type TargetPipe,
  type AutoConfig, type LeadDistributionMode, type CampanhaMemberRole,
  OBJECTIVE_LABELS, OBJECTIVE_DEFAULT_STAGES,
} from "@/hooks/useCampanhas";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
import { toast } from "sonner";
import {
  Plus, X, GripVertical, Target, Users, Calendar, DollarSign,
  Bot, ChevronLeft, ChevronRight, Check,
  Zap, MousePointer, Shuffle, User, Lock,
  ClipboardList, CalendarCheck, HandCoins, Settings2
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
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

const CAMPAIGN_OBJECTIVES = [
  {
    type: "qualificacao" as CampaignObjective,
    title: OBJECTIVE_LABELS.qualificacao,
    description: "Aborde e qualifique leads frios",
    detail: "Lead entra como Novo no SDR Pipeline",
    pipeLabel: "Pipe WhatsApp",
    icon: ClipboardList,
    iconColor: "text-blue-500",
    badge: "Mais comum",
  },
  {
    type: "agendamentos" as CampaignObjective,
    title: OBJECTIVE_LABELS.agendamentos,
    description: "Converta leads em reuniões agendadas",
    detail: "Lead entra como Reunião Marcada no Pipeline de Confirmação",
    pipeLabel: "Pipe Confirmação",
    icon: CalendarCheck,
    iconColor: "text-green-500",
    badge: null,
  },
  {
    type: "propostas" as CampaignObjective,
    title: OBJECTIVE_LABELS.propostas,
    description: "Envie propostas e feche negócios",
    detail: "Lead entra em Marcar Compromisso no Pipeline de Propostas",
    pipeLabel: "Pipe Propostas",
    icon: HandCoins,
    iconColor: "text-amber-500",
    badge: null,
  },
  {
    type: "livre" as CampaignObjective,
    title: OBJECTIVE_LABELS.livre,
    description: "Objetivo personalizado para seu fluxo",
    detail: "Você escolhe o pipe e o status de destino",
    pipeLabel: null,
    icon: Settings2,
    iconColor: "text-muted-foreground",
    badge: null,
  },
];

const PIPE_OPTIONS: { value: TargetPipe; label: string }[] = [
  { value: "pipe_whatsapp", label: "Pipe WhatsApp (SDR)" },
  { value: "pipe_confirmacao", label: "Pipe Confirmação (Reuniões)" },
  { value: "pipe_propostas", label: "Pipe Propostas (Closer)" },
];

const PIPE_STAGE_OPTIONS: Record<TargetPipe, { value: string; label: string }[]> = {
  pipe_whatsapp: [
    { value: "novo", label: "Novo" },
    { value: "em_contato", label: "Em Contato" },
    { value: "qualificado", label: "Qualificado" },
  ],
  pipe_confirmacao: [
    { value: "reuniao_marcada", label: "Reunião Marcada" },
    { value: "compareceu", label: "Compareceu" },
  ],
  pipe_propostas: [
    { value: "marcar_compromisso", label: "Marcar Compromisso" },
    { value: "proposta_enviada", label: "Proposta Enviada" },
    { value: "negociacao", label: "Negociação" },
  ],
};

const CAMPAIGN_MODES = [
  {
    type: "automatica" as CampaignType,
    title: "Automática",
    description: "IA envia mensagens e conversa até atingir o objetivo",
    icon: Bot,
    color: "text-purple-600 dark:text-purple-300",
    bgColor: "bg-purple-50 dark:bg-purple-900/30",
    borderColor: "border-purple-200 dark:border-purple-700/50",
    features: ["Copilot envia primeira mensagem", "IA responde automaticamente", "Move leads no Kanban"],
    badge: "Recomendado",
    badgeColor: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-200",
  },
  {
    type: "semi_automatica" as CampaignType,
    title: "Semi-Automática",
    description: "Disparo de templates em lote com agendamento",
    icon: Zap,
    color: "text-blue-600 dark:text-blue-300",
    bgColor: "bg-blue-50 dark:bg-blue-900/30",
    borderColor: "border-blue-200 dark:border-blue-700/50",
    features: ["Disparo imediato ou agendado", "Templates personalizados", "SDR trabalha respostas"],
    badge: null,
  },
  {
    type: "manual" as CampaignType,
    title: "Manual",
    description: "Controle total via Kanban tradicional",
    icon: MousePointer,
    color: "text-gray-600 dark:text-muted-foreground",
    bgColor: "bg-muted",
    borderColor: "border-gray-200 dark:border-border",
    features: ["Kanban drag-drop", "Sem automação", "Controle total do SDR"],
    badge: null,
  },
];

type WizardStep = "objective" | "free_config" | "mode" | "config" | "details" | "stages" | "members";

const STEP_LABELS: Record<WizardStep, string> = {
  objective: "Objetivo",
  free_config: "Destino",
  mode: "Tipo",
  config: "Configuração",
  details: "Detalhes",
  stages: "Etapas",
  members: "Equipe",
};

export function CreateCampanhaModal({ open, onOpenChange }: CreateCampanhaModalProps) {
  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>("objective");

  // Campaign objective
  const [objective, setObjective] = useState<CampaignObjective>("qualificacao");
  const [freeTargetPipe, setFreeTargetPipe] = useState<TargetPipe | null>(null);
  const [freeTargetStage, setFreeTargetStage] = useState<string | null>(null);

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

  // Instância WhatsApp (semi e automática)
  const [selectedWhatsAppInstanceId, setSelectedWhatsAppInstanceId] = useState<string | null>(null);

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

  // Distribuição de leads SDR (importação, Meta Ads, integrações)
  const [leadDistributionMode, setLeadDistributionMode] = useState<LeadDistributionMode>(null);
  const [leadAssignedTo, setLeadAssignedTo] = useState<string | null>(null);
  // Distribuição de Closers
  const [closerDistributionMode, setCloserDistributionMode] = useState<LeadDistributionMode>(null);
  const [closerAssignedTo, setCloserAssignedTo] = useState<string | null>(null);
  // Papel de cada membro na campanha (SDR ou Closer)
  const [memberRoles, setMemberRoles] = useState<Record<string, CampanhaMemberRole>>({});

  const createCampanha = useCreateCampanha();
  const { data: teamMembers } = useTeamMembers();
  const { data: whatsappInstances = [] } = useWhatsAppInstances();
  const { canCreateCampaign } = useOrgFeatures();

  // Calculate steps based on objective + campaign type
  const getActiveSteps = (obj: CampaignObjective, type: CampaignType): WizardStep[] => {
    const steps: WizardStep[] = ["objective"];

    // Free config step only for 'livre'
    if (obj === "livre") {
      steps.push("free_config");
    }

    // Mode step
    steps.push("mode");

    // Config step for automatica/semi
    if (type === "automatica" || type === "semi_automatica") {
      steps.push("config");
    }

    steps.push("details", "stages", "members");
    return steps;
  };

  const activeSteps = getActiveSteps(objective, campaignType);
  const currentStepIndex = activeSteps.indexOf(currentStep);
  const progress = ((currentStepIndex + 1) / activeSteps.length) * 100;
  const isLastStep = currentStepIndex === activeSteps.length - 1;

  const canGoNext = () => {
    switch (currentStep) {
      case "objective":
        return true;
      case "free_config":
        return !!freeTargetPipe && !!freeTargetStage;
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

  const handleObjectiveSelect = (obj: CampaignObjective) => {
    setObjective(obj);
    // Reset free config when changing objective
    if (obj !== "livre") {
      setFreeTargetPipe(null);
      setFreeTargetStage(null);
    }
    // Update suggested stages based on objective
    const suggestedNames = OBJECTIVE_DEFAULT_STAGES[obj];
    const lastIndex = suggestedNames.length - 1;
    setStages(suggestedNames.map((name, i) => ({
      id: (i + 1).toString(),
      name,
      color: i === lastIndex ? "#22C55E" : i === 0 ? "#6B7280" : "#3B82F6",
      is_reuniao_marcada: i === lastIndex, // last stage = success
    })));
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
        objective,
        free_target_pipe: objective === "livre" ? freeTargetPipe : null,
        free_target_stage: objective === "livre" ? freeTargetStage : null,
        campaign_type: campaignType,
        agent_id: campaignType === "automatica" ? selectedAgentId : null,
        auto_config: campaignType === "automatica" ? autoConfig : null,
        lead_distribution_mode: leadDistributionMode || null,
        lead_assigned_to: leadDistributionMode === "single" ? leadAssignedTo : null,
        closer_distribution_mode: closerDistributionMode || null,
        closer_assigned_to: closerDistributionMode === "single" ? closerAssignedTo : null,
        stages: stages
          .filter((s) => s.name.trim())
          .map((s, index) => ({
            name: s.name,
            color: s.color,
            position: index,
            is_reuniao_marcada: s.is_reuniao_marcada,
          })),
        memberIds: selectedMembers,
        memberRoles,
        templateIds: campaignType === "semi_automatica" ? selectedTemplateIds : undefined,
        whatsapp_instance_id: (campaignType === "semi_automatica" || campaignType === "automatica") ? selectedWhatsAppInstanceId : null,
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
    setCurrentStep("objective");
    setObjective("qualificacao");
    setFreeTargetPipe(null);
    setFreeTargetStage(null);
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
    setLeadDistributionMode(null);
    setLeadAssignedTo(null);
    setCloserDistributionMode(null);
    setCloserAssignedTo(null);
    setMemberRoles({});
    setSelectedWhatsAppInstanceId(null);
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case "objective":
        return (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h3 className="text-lg font-semibold">Qual o objetivo desta campanha?</h3>
              <p className="text-sm text-muted-foreground">
                O objetivo define para onde o lead vai ao atingir sucesso
              </p>
            </div>

            <div className="grid gap-3">
              {CAMPAIGN_OBJECTIVES.map((obj) => {
                const Icon = obj.icon;
                const isSelected = objective === obj.type;
                return (
                  <Card
                    key={obj.type}
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-md bg-muted",
                      isSelected && "ring-2 ring-primary shadow-md"
                    )}
                    onClick={() => handleObjectiveSelect(obj.type)}
                  >
                    <CardContent className="p-4 flex items-start gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-lg flex items-center justify-center shrink-0",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "bg-card shadow-sm border border-border"
                      )}>
                        <Icon className={cn("w-6 h-6", !isSelected && obj.iconColor)} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{obj.title}</span>
                          {obj.badge && (
                            <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">
                              {obj.badge}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">{obj.description}</p>
                        <p className="text-xs text-muted-foreground/70 mt-1.5 flex items-center gap-1">
                          {obj.pipeLabel && (
                            <Badge variant="outline" className="text-xs font-normal">
                              {obj.pipeLabel}
                            </Badge>
                          )}
                          <span>{obj.detail}</span>
                        </p>
                      </div>

                      {isSelected && <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );

      case "free_config":
        return (
          <div className="space-y-6">
            <div className="text-center mb-4">
              <h3 className="text-lg font-semibold">Configurar destino de sucesso</h3>
              <p className="text-sm text-muted-foreground">
                Para onde o lead vai ao atingir sucesso nesta campanha?
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Pipe de destino *</Label>
                <Select
                  value={freeTargetPipe ?? ""}
                  onValueChange={(v) => {
                    setFreeTargetPipe(v as TargetPipe);
                    setFreeTargetStage(null); // Reset stage when pipe changes
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o pipe de destino" />
                  </SelectTrigger>
                  <SelectContent>
                    {PIPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {freeTargetPipe && (
                <div className="space-y-2">
                  <Label>Status inicial no pipe *</Label>
                  <Select
                    value={freeTargetStage ?? ""}
                    onValueChange={(v) => setFreeTargetStage(v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o status" />
                    </SelectTrigger>
                    <SelectContent>
                      {PIPE_STAGE_OPTIONS[freeTargetPipe].map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
        );

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
                const isLocked = !canCreateCampaign(mode.type);

                return (
                  <Card
                    key={mode.type}
                    className={cn(
                      "transition-all",
                      isLocked
                        ? "opacity-60 cursor-not-allowed"
                        : "cursor-pointer hover:shadow-md",
                      isSelected && !isLocked && "ring-2 ring-primary shadow-md",
                      mode.bgColor
                    )}
                    onClick={() => !isLocked && handleModeSelect(mode.type)}
                  >
                    <CardContent className="p-4 flex items-start gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-lg flex items-center justify-center shrink-0",
                        isLocked
                          ? "bg-muted text-muted-foreground"
                          : isSelected
                            ? "bg-primary text-primary-foreground"
                            : "bg-card shadow-sm border border-border"
                      )}>
                        <Icon className={cn("w-6 h-6", !isSelected && !isLocked && mode.color)} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{mode.title}</span>
                          {isLocked ? (
                            <Badge variant="outline" className="text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700">
                              <Lock className="w-3 h-3 mr-1" />
                              Upgrade
                            </Badge>
                          ) : mode.badge ? (
                            <Badge className={mode.badgeColor}>
                              {mode.badge}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {mode.description}
                        </p>
                        {isLocked ? (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                            Disponível em planos superiores. Fale com nosso comercial para desbloquear.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-2 mt-3">
                            {mode.features.map((feature, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {feature}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>

                      {isLocked ? (
                        <Lock className="w-5 h-5 text-amber-500 shrink-0" />
                      ) : isSelected ? (
                        <Check className="w-5 h-5 text-primary shrink-0" />
                      ) : null}
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
            <div className="space-y-6">
              <AgentSelectorStep
                selectedAgentId={selectedAgentId}
                onAgentSelect={setSelectedAgentId}
                autoConfig={autoConfig}
                onAutoConfigChange={setAutoConfig}
              />
              <div className="space-y-2">
                <Label>Instância WhatsApp (opcional)</Label>
                <Select
                  value={selectedWhatsAppInstanceId ?? "none"}
                  onValueChange={(v) => setSelectedWhatsAppInstanceId(v === "none" ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Usar primeira instância ativa da organização" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Usar primeira instância ativa</SelectItem>
                    {whatsappInstances.map((inst) => (
                      <SelectItem key={inst.id} value={inst.id}>
                        {inst.instance_name}
                        {inst.phone_number ? ` (${inst.phone_number})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Se não escolher, os disparos usarão a primeira instância ativa da organização.
                </p>
              </div>
            </div>
          );
        }
        if (campaignType === "semi_automatica") {
          return (
            <div className="space-y-6">
              <TemplateSelectorStep
                selectedTemplateIds={selectedTemplateIds}
                onTemplatesChange={setSelectedTemplateIds}
              />
              <div className="space-y-2">
                <Label>Instância WhatsApp (opcional)</Label>
                <Select
                  value={selectedWhatsAppInstanceId ?? "none"}
                  onValueChange={(v) => setSelectedWhatsAppInstanceId(v === "none" ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Usar primeira instância ativa da organização" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Usar primeira instância ativa</SelectItem>
                    {whatsappInstances.map((inst) => (
                      <SelectItem key={inst.id} value={inst.id}>
                        {inst.instance_name}
                        {inst.phone_number ? ` (${inst.phone_number})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Se não escolher, os disparos usarão a primeira instância ativa da organização.
                </p>
              </div>
            </div>
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

            <div className="space-y-2 max-h-[280px] overflow-y-auto">
              {teamMembers?.map((member) => (
                <div
                  key={member.id}
                  className={cn(
                    "flex items-center gap-2 p-3 rounded-lg transition-colors",
                    "hover:bg-muted/50",
                    selectedMembers.includes(member.id) && "bg-primary/5 border border-primary/20"
                  )}
                >
                  <Checkbox
                    checked={selectedMembers.includes(member.id)}
                    onCheckedChange={() => handleMemberToggle(member.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{member.name}</span>
                    <span className="text-xs text-muted-foreground capitalize ml-2">({member.role})</span>
                  </div>
                  {selectedMembers.includes(member.id) && (
                    <Select
                      value={memberRoles[member.id] || "sdr"}
                      onValueChange={(v) => setMemberRoles((prev) => ({ ...prev, [member.id]: v as CampanhaMemberRole }))}
                    >
                      <SelectTrigger className="w-[110px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sdr">SDR</SelectItem>
                        <SelectItem value="closer">Closer</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
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

            {/* Distribuição automática de leads - SDR */}
            <div className="space-y-3 pt-4 border-t mt-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Shuffle className="w-4 h-4" />
                Distribuição de SDRs
              </h3>
              <p className="text-xs text-muted-foreground">
                Quando leads forem importados ou chegarem via integrações, como atribuir o SDR?
              </p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/50">
                  <input
                    type="radio"
                    name="leadDistribution"
                    checked={leadDistributionMode === null}
                    onChange={() => { setLeadDistributionMode(null); setLeadAssignedTo(null); }}
                    className="rounded-full"
                  />
                  <span className="text-sm">Manual</span>
                  <span className="text-xs text-muted-foreground">— definir na importação</span>
                </label>
                <label className="flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/50">
                  <input
                    type="radio"
                    name="leadDistribution"
                    checked={leadDistributionMode === "random"}
                    onChange={() => setLeadDistributionMode("random")}
                    className="rounded-full"
                  />
                  <span className="text-sm">Aleatório</span>
                  <span className="text-xs text-muted-foreground">— distribui entre todos da campanha</span>
                </label>
                <label className="flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/50">
                  <input
                    type="radio"
                    name="leadDistribution"
                    checked={leadDistributionMode === "round_robin"}
                    onChange={() => setLeadDistributionMode("round_robin")}
                    className="rounded-full"
                  />
                  <span className="text-sm">Rotativo</span>
                  <span className="text-xs text-muted-foreground">— alterna entre os vendedores</span>
                </label>
                <label className="flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/50">
                  <input
                    type="radio"
                    name="leadDistribution"
                    checked={leadDistributionMode === "single"}
                    onChange={() => setLeadDistributionMode("single")}
                    className="rounded-full"
                  />
                  <span className="text-sm">Pessoa específica</span>
                </label>
                {leadDistributionMode === "single" && (
                  <div className="ml-6 pl-4 border-l">
                    <Select
                      value={leadAssignedTo ?? ""}
                      onValueChange={(v) => setLeadAssignedTo(v || null)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione o SDR" />
                      </SelectTrigger>
                      <SelectContent>
                        {teamMembers?.filter((m) => selectedMembers.includes(m.id) && (memberRoles[m.id] || "sdr") === "sdr").map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            <span className="flex items-center gap-2">
                              <User className="w-3 h-3" />
                              {m.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            {/* Distribuição automática de leads - Closer */}
            <div className="space-y-3 pt-4 border-t mt-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Shuffle className="w-4 h-4" />
                Distribuição de Closers
              </h3>
              <p className="text-xs text-muted-foreground">
                Como atribuir o Closer responsável por fechar o negócio?
              </p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/50">
                  <input
                    type="radio"
                    name="closerDistribution"
                    checked={closerDistributionMode === null}
                    onChange={() => { setCloserDistributionMode(null); setCloserAssignedTo(null); }}
                    className="rounded-full"
                  />
                  <span className="text-sm">Manual</span>
                  <span className="text-xs text-muted-foreground">— definir manualmente</span>
                </label>
                <label className="flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/50">
                  <input
                    type="radio"
                    name="closerDistribution"
                    checked={closerDistributionMode === "random"}
                    onChange={() => setCloserDistributionMode("random")}
                    className="rounded-full"
                  />
                  <span className="text-sm">Aleatório</span>
                  <span className="text-xs text-muted-foreground">— distribui entre closers da campanha</span>
                </label>
                <label className="flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/50">
                  <input
                    type="radio"
                    name="closerDistribution"
                    checked={closerDistributionMode === "round_robin"}
                    onChange={() => setCloserDistributionMode("round_robin")}
                    className="rounded-full"
                  />
                  <span className="text-sm">Rotativo</span>
                  <span className="text-xs text-muted-foreground">— alterna entre os closers</span>
                </label>
                <label className="flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-muted/50">
                  <input
                    type="radio"
                    name="closerDistribution"
                    checked={closerDistributionMode === "single"}
                    onChange={() => setCloserDistributionMode("single")}
                    className="rounded-full"
                  />
                  <span className="text-sm">Pessoa específica</span>
                </label>
                {closerDistributionMode === "single" && (
                  <div className="ml-6 pl-4 border-l">
                    <Select
                      value={closerAssignedTo ?? ""}
                      onValueChange={(v) => setCloserAssignedTo(v || null)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione o closer" />
                      </SelectTrigger>
                      <SelectContent>
                        {teamMembers?.filter((m) => selectedMembers.includes(m.id) && memberRoles[m.id] === "closer").map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            <span className="flex items-center gap-2">
                              <User className="w-3 h-3" />
                              {m.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>
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
