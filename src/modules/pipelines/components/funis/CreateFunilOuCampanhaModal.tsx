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
} from "@/modules/pipelines/hooks/custom/useCustomPipelines";
import {
  useAvailableSystemPipes,
  useEnableSystemPipe,
  type SystemPipeType,
} from "@/modules/pipelines/hooks/config/usePipelineDisplayConfig";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { IconChip } from "@/components/ui/bento";
import { notifyError } from "@/shared/errors";

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
  const hiddenPipes = useAvailableSystemPipes();

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
      navigate(`/funil/${pipeline.slug}`);
    } catch (error: any) {
      notifyError(error, { fallback: "Não foi possível criar funil." });
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
        <DialogContent className="overflow-hidden p-0 sm:max-w-[560px]">
          <DialogHeader className="px-6 pb-2 pt-6">
            <DialogTitle className="text-xl font-extrabold tracking-[-0.03em]">
              {step === "templates" ? "Criar funil" : "Configurar funil"}
            </DialogTitle>
          </DialogHeader>

          {step === "templates" ? (
            /* ── Step 1: Templates ── */
            <div className="px-6 pb-6">
              <p className="text-sm text-muted-foreground mb-4">
                Escolha um template ou comece do zero.
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {TEMPLATES.map((template) => {
                  const Icon = template.icon;
                  return (
                    <button
                      key={template.id}
                      onClick={() => handleSelectTemplate(template)}
                      className={cn(
                        "group flex flex-col items-start gap-2.5 rounded-2xl border border-border bg-card p-4 text-left",
                        "transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-relevo",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0",
                      )}
                    >
                      <div
                        className="grid h-10 w-10 place-items-center rounded-[14px]"
                        style={{ backgroundColor: `color-mix(in srgb, ${template.color} 14%, transparent)` }}
                      >
                        <Icon className="h-5 w-5" style={{ color: template.color }} aria-hidden />
                      </div>
                      <div>
                        <p className="text-sm font-bold tracking-[-0.01em]">{template.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {template.description}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 self-end text-muted-foreground opacity-0 transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden />
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
                  className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-dashed border-success/40 p-3 text-left transition-colors hover:border-success/70 hover:bg-success/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <IconChip icon={Eye} tone="good" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold">Ativar funil oculto</p>
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
                className="-ml-1 inline-flex items-center gap-1 rounded-full px-1 py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                Voltar
              </button>

              {/* Template badge */}
              {selectedTemplate && selectedTemplate.id !== "blank" && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Template:</span>
                  <span
                    className="rounded-full px-2.5 py-0.5 font-semibold"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${selectedTemplate.color} 14%, transparent)`,
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
                        type="button"
                        aria-pressed={selectedIcon === item.name}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selectedIcon === item.name
                            ? "border-transparent bg-primary-soft text-primary-soft-foreground"
                            : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Color */}
              <div className="space-y-1.5">
                <Label>Cor</Label>
                <div className="flex flex-wrap gap-2">
                  {PIPELINE_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Cor ${color}`}
                      aria-pressed={selectedColor === color}
                      onClick={() => setSelectedColor(color)}
                      className={cn(
                        "h-7 w-7 rounded-full ring-offset-2 ring-offset-card transition-transform",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selectedColor === color
                          ? "scale-110 ring-2 ring-foreground"
                          : "hover:scale-105"
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              {/* ── Temporal toggle ── */}
              <div className="rounded-2xl bg-muted/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card text-foreground/70 shadow-relevo">
                      <Target className="h-4 w-4" aria-hidden />
                    </span>
                    <div>
                      <p className="text-sm font-bold tracking-[-0.01em]">Definir prazo e metas</p>
                      <p className="text-xs text-muted-foreground">
                        Adicionar data limite, metas e bônus para a equipe
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={hasTemporal}
                    onCheckedChange={setHasTemporal}
                    aria-label="Definir prazo e metas"
                  />
                </div>

                {hasTemporal && (
                  <div className="mt-4 space-y-3 border-l-2 border-primary/30 pl-4">
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
                    <Loader2 className="animate-spin" />
                  )}
                  Criar funil
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
  const hiddenPipes = useAvailableSystemPipes();
  const enablePipe = useEnableSystemPipe();

  const handleActivate = async (pipeType: string, displayName: string) => {
    try {
      await enablePipe.mutateAsync(pipeType as SystemPipeType);
      toast.success(`"${displayName}" ativado com sucesso`);
      onOpenChange(false);
    } catch (caught) {
      notifyError(caught, { fallback: "Não foi possível ativar funil." });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-xl font-extrabold tracking-[-0.03em]">
            <IconChip icon={Eye} tone="good" />
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
                className="flex items-center justify-between gap-3 rounded-2xl bg-muted/60 p-3 pl-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{pipe.display_name}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-success/50 text-success hover:bg-success/10 hover:text-success"
                  onClick={() => handleActivate(pipe.pipe_type, pipe.display_name)}
                  disabled={enablePipe.isPending}
                >
                  {enablePipe.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Check />
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
