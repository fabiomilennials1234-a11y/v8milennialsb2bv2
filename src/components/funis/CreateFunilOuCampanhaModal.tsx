import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  Gift,
  Kanban,
  Loader2,
  Megaphone,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  Users,
  ShoppingBag,
  Heart,
  Briefcase,
  Star,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCreateCustomPipeline,
  type FunnelTemplateType,
} from "@/hooks/useCustomPipelines";
import {
  useHiddenDefaultPipes,
  useTogglePipeVisibility,
} from "@/hooks/usePipelineDisplayConfig";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

// ── Constants ──────────────────────────────────────────────

const PIPELINE_COLORS = [
  "#3b82f6", "#22c55e", "#eab308", "#f97316", "#ef4444",
  "#8b5cf6", "#ec4899", "#06b6d4", "#64748b",
];

const PIPELINE_ICONS = [
  { name: "kanban", icon: Kanban, label: "Kanban" },
  { name: "target", icon: Target, label: "Alvo" },
  { name: "users", icon: Users, label: "Pessoas" },
  { name: "shopping-bag", icon: ShoppingBag, label: "Vendas" },
  { name: "heart", icon: Heart, label: "Relacionamento" },
  { name: "briefcase", icon: Briefcase, label: "Negócios" },
  { name: "star", icon: Star, label: "Destaque" },
  { name: "zap", icon: Zap, label: "Rápido" },
  { name: "gift", icon: Gift, label: "Bônus" },
];

type TemplateOption = {
  id: FunnelTemplateType | "blank";
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  hasTemporal: boolean;
};

const TEMPLATES: TemplateOption[] = [
  {
    id: "blank",
    label: "Em branco",
    description: "Comece do zero com etapas customizáveis.",
    icon: Sparkles,
    color: "#64748b",
    hasTemporal: false,
  },
  {
    id: "indicacao",
    label: "Indicação",
    description: "Programa de indicações com rastreamento de quem indicou e conversão.",
    icon: Megaphone,
    color: "#8b5cf6",
    hasTemporal: true,
  },
  {
    id: "prospeccao",
    label: "Prospecção",
    description: "Importar lista de leads e acompanhar abordagem até conversão.",
    icon: Search,
    color: "#3b82f6",
    hasTemporal: true,
  },
  {
    id: "reativacao",
    label: "Reativação",
    description: "Recuperar clientes inativos com ações direcionadas.",
    icon: RefreshCw,
    color: "#f97316",
    hasTemporal: true,
  },
];

// ── Props ──────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

// ── Main Component ─────────────────────────────────────────

export function CreateFunilOuCampanhaModal({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const createPipeline = useCreateCustomPipeline();
  const hiddenPipes = useHiddenDefaultPipes();

  // Step
  const [step, setStep] = useState<"templates" | "config">("templates");

  // Template
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateOption | null>(null);

  // Config
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedColor, setSelectedColor] = useState(PIPELINE_COLORS[0]);
  const [selectedIcon, setSelectedIcon] = useState("kanban");

  // Temporal toggle
  const [hasTemporal, setHasTemporal] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [teamGoal, setTeamGoal] = useState("");
  const [individualGoal, setIndividualGoal] = useState("");
  const [bonusValue, setBonusValue] = useState("");
  const [bonusDescription, setBonusDescription] = useState("");

  // Activate hidden
  const [showActivateHidden, setShowActivateHidden] = useState(false);

  const resetForm = () => {
    setStep("templates");
    setSelectedTemplate(null);
    setName("");
    setDescription("");
    setSelectedColor(PIPELINE_COLORS[0]);
    setSelectedIcon("kanban");
    setHasTemporal(false);
    setStartsAt("");
    setEndsAt("");
    setTeamGoal("");
    setIndividualGoal("");
    setBonusValue("");
    setBonusDescription("");
  };

  const handleSelectTemplate = (template: TemplateOption) => {
    setSelectedTemplate(template);
    setSelectedColor(template.color);
    setSelectedIcon(template.hasTemporal ? "target" : "kanban");
    setHasTemporal(template.hasTemporal);
    if (template.id !== "blank") {
      setName(template.label);
    }
    setStep("config");
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }

    const isTemporary = hasTemporal && !!endsAt;

    try {
      const pipeline = await createPipeline.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        icon: selectedIcon,
        color: selectedColor,
        lifecycle_type: isTemporary ? "temporary" : "permanent",
        template_type:
          selectedTemplate && selectedTemplate.id !== "blank"
            ? (selectedTemplate.id as FunnelTemplateType)
            : undefined,
        starts_at: isTemporary && startsAt ? startsAt : undefined,
        ends_at: isTemporary ? endsAt : undefined,
        team_goal: isTemporary && teamGoal ? Number(teamGoal) : undefined,
        individual_goal: isTemporary && individualGoal ? Number(individualGoal) : undefined,
        bonus_value: isTemporary && bonusValue ? Math.round(Number(bonusValue) * 100) : undefined,
        bonus_description: isTemporary && bonusDescription.trim() ? bonusDescription.trim() : undefined,
      });

      toast.success(`Funil "${pipeline.name}" criado com sucesso`);
      handleClose();
      navigate(`/pipe/custom/${pipeline.slug}`);
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar funil");
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    resetForm();
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) handleClose();
    else onOpenChange(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[540px] p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="text-lg font-bold tracking-tight">
              {step === "templates" ? "Criar Funil" : "Configurar Funil"}
            </DialogTitle>
          </DialogHeader>

          {step === "templates" ? (
            /* ── Step 1: Templates ── */
            <div className="px-6 pb-6">
              <p className="text-sm text-muted-foreground mb-4">
                Escolha um template ou comece do zero.
              </p>

              <div className="grid grid-cols-2 gap-3">
                {TEMPLATES.map((template) => {
                  const Icon = template.icon;
                  return (
                    <button
                      key={template.id}
                      onClick={() => handleSelectTemplate(template)}
                      className="group flex flex-col items-start gap-2 p-4 rounded-xl border-2 border-border/50 hover:border-primary/50 hover:bg-primary/5 transition-all text-left"
                    >
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${template.color}15` }}
                      >
                        <Icon className="w-5 h-5" style={{ color: template.color }} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{template.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {template.description}
                        </p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity self-end" />
                    </button>
                  );
                })}
              </div>

              {/* Activate hidden funnels link */}
              {hiddenPipes.length > 0 && (
                <button
                  onClick={() => {
                    onOpenChange(false);
                    setShowActivateHidden(true);
                  }}
                  className="mt-4 w-full flex items-center gap-3 p-3 rounded-lg border border-dashed border-green-500/30 hover:border-green-500/60 hover:bg-green-500/5 transition-all text-left"
                >
                  <Eye className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">Ativar funil oculto</p>
                    <p className="text-[11px] text-muted-foreground">
                      {hiddenPipes.map((p) => p.display_name).join(", ")}
                    </p>
                  </div>
                </button>
              )}
            </div>
          ) : (
            /* ── Step 2: Config ── */
            <div className="px-6 pb-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Back */}
              <button
                onClick={() => setStep("templates")}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Voltar
              </button>

              {/* Template badge */}
              {selectedTemplate && selectedTemplate.id !== "blank" && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Template:</span>
                  <span
                    className="font-medium px-2 py-0.5 rounded-md"
                    style={{
                      backgroundColor: `${selectedTemplate.color}15`,
                      color: selectedTemplate.color,
                    }}
                  >
                    {selectedTemplate.label}
                  </span>
                </div>
              )}

              {/* Name */}
              <div className="space-y-1.5">
                <Label htmlFor="funnel-name">Nome *</Label>
                <Input
                  id="funnel-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Pós-Venda, Indicação Q1, Prospecção Evento..."
                  autoFocus
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label htmlFor="funnel-desc">Descrição</Label>
                <Textarea
                  id="funnel-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descreva o propósito deste funil..."
                  rows={2}
                />
              </div>

              {/* Icon */}
              <div className="space-y-1.5">
                <Label>Ícone</Label>
                <div className="flex flex-wrap gap-1.5">
                  {PIPELINE_ICONS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.name}
                        onClick={() => setSelectedIcon(item.name)}
                        className={cn(
                          "flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all",
                          selectedIcon === item.name
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:border-primary/50"
                        )}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Color */}
              <div className="space-y-1.5">
                <Label>Cor</Label>
                <div className="flex gap-2">
                  {PIPELINE_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setSelectedColor(color)}
                      className={cn(
                        "w-7 h-7 rounded-full border-2 transition-all",
                        selectedColor === color
                          ? "border-foreground scale-110"
                          : "border-transparent hover:scale-105"
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              {/* ── Temporal toggle ── */}
              <div className="border-t border-border/50 pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Definir prazo e metas</p>
                      <p className="text-xs text-muted-foreground">
                        Adicionar data limite, metas e bônus para a equipe
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={hasTemporal}
                    onCheckedChange={setHasTemporal}
                  />
                </div>

                {hasTemporal && (
                  <div className="mt-4 space-y-3 pl-6 border-l-2 border-primary/20">
                    {/* Dates */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="f-start" className="text-xs">Início</Label>
                        <Input
                          id="f-start"
                          type="date"
                          value={startsAt}
                          onChange={(e) => setStartsAt(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="f-end" className="text-xs">Término *</Label>
                        <Input
                          id="f-end"
                          type="date"
                          value={endsAt}
                          onChange={(e) => setEndsAt(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>

                    {/* Goals */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="f-team-goal" className="text-xs">Meta do time</Label>
                        <Input
                          id="f-team-goal"
                          type="number"
                          min={0}
                          value={teamGoal}
                          onChange={(e) => setTeamGoal(e.target.value)}
                          placeholder="Ex: 50"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="f-ind-goal" className="text-xs">Meta individual</Label>
                        <Input
                          id="f-ind-goal"
                          type="number"
                          min={0}
                          value={individualGoal}
                          onChange={(e) => setIndividualGoal(e.target.value)}
                          placeholder="Ex: 10"
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>

                    {/* Bonus */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="f-bonus" className="text-xs">Bônus (R$)</Label>
                        <Input
                          id="f-bonus"
                          type="number"
                          min={0}
                          step="0.01"
                          value={bonusValue}
                          onChange={(e) => setBonusValue(e.target.value)}
                          placeholder="Ex: 500"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="f-bonus-desc" className="text-xs">Descrição do bônus</Label>
                        <Input
                          id="f-bonus-desc"
                          value={bonusDescription}
                          onChange={(e) => setBonusDescription(e.target.value)}
                          placeholder="Ex: Vale-presente"
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <DialogFooter className="pt-2">
                <Button variant="outline" onClick={handleClose}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!name.trim() || (hasTemporal && !endsAt) || createPipeline.isPending}
                >
                  {createPipeline.isPending && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  Criar Funil
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Activate hidden funnel dialog */}
      <ActivateHiddenFunnelDialog
        open={showActivateHidden}
        onOpenChange={setShowActivateHidden}
      />
    </>
  );
}

// ── Inline: Activate Hidden Funnel Dialog ──────────────────

function ActivateHiddenFunnelDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const hiddenPipes = useHiddenDefaultPipes();
  const toggleVisibility = useTogglePipeVisibility();

  const handleActivate = async (pipeType: string, displayName: string) => {
    try {
      await toggleVisibility.mutateAsync({ pipeType, visible: true });
      toast.success(`"${displayName}" ativado com sucesso`);
      onOpenChange(false);
    } catch {
      toast.error("Erro ao ativar funil");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold tracking-tight flex items-center gap-2">
            <Eye className="w-5 h-5 text-green-500" />
            Ativar funil oculto
          </DialogTitle>
        </DialogHeader>

        {hiddenPipes.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Nenhum funil oculto encontrado.
          </p>
        ) : (
          <div className="space-y-2 py-2">
            {hiddenPipes.map((pipe) => (
              <div
                key={pipe.pipe_type}
                className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/50 bg-muted/30"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{pipe.display_name}</p>
                  <p className="text-xs text-muted-foreground">
                    Funil estrutural
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-shrink-0 border-green-500/50 text-green-600 hover:bg-green-500/10 hover:text-green-600"
                  onClick={() => handleActivate(pipe.pipe_type, pipe.display_name)}
                  disabled={toggleVisibility.isPending}
                >
                  {toggleVisibility.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Check className="w-4 h-4 mr-1" />
                      Ativar
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
