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
import {
  ArrowLeft,
  ArrowRight,
  Gift,
  Loader2,
  Megaphone,
  RefreshCw,
  Search,
  Sparkles,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCreateCustomPipeline,
  type FunnelTemplateType,
} from "@/modules/pipelines/hooks/custom/useCustomPipelines";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type TemplateOption = {
  id: FunnelTemplateType | "blank";
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
};

const TEMPLATES: TemplateOption[] = [
  {
    id: "indicacao",
    label: "Indicação",
    description: "Programa de indicações com rastreamento de quem indicou e conversão.",
    icon: Megaphone,
    color: "#8b5cf6",
  },
  {
    id: "prospeccao",
    label: "Prospecção",
    description: "Importar lista de leads e acompanhar abordagem até conversão.",
    icon: Search,
    color: "#3b82f6",
  },
  {
    id: "reativacao",
    label: "Reativação",
    description: "Recuperar clientes inativos com ações direcionadas.",
    icon: RefreshCw,
    color: "#f97316",
  },
  {
    id: "blank",
    label: "Em branco",
    description: "Comece do zero com etapas customizáveis.",
    icon: Sparkles,
    color: "#64748b",
  },
];

type Step = "template" | "form";

export function CreateTemporaryFunnelModal({ open, onOpenChange }: Props) {
  const [step, setStep] = useState<Step>("template");
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateOption | null>(null);

  // Form fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [teamGoal, setTeamGoal] = useState("");
  const [individualGoal, setIndividualGoal] = useState("");
  const [bonusValue, setBonusValue] = useState("");
  const [bonusDescription, setBonusDescription] = useState("");

  const createPipeline = useCreateCustomPipeline();
  const navigate = useNavigate();

  const resetForm = () => {
    setStep("template");
    setSelectedTemplate(null);
    setName("");
    setDescription("");
    setStartsAt("");
    setEndsAt("");
    setTeamGoal("");
    setIndividualGoal("");
    setBonusValue("");
    setBonusDescription("");
  };

  const handleSelectTemplate = (template: TemplateOption) => {
    setSelectedTemplate(template);
    // Pre-fill name from template if not "blank"
    if (template.id !== "blank") {
      setName(`Campanha de ${template.label}`);
    }
    setStep("form");
  };

  const handleBack = () => {
    setStep("template");
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }

    try {
      const pipeline = await createPipeline.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        lifecycle_type: "temporary",
        template_type:
          selectedTemplate && selectedTemplate.id !== "blank"
            ? (selectedTemplate.id as FunnelTemplateType)
            : undefined,
        starts_at: startsAt || undefined,
        ends_at: endsAt || undefined,
        team_goal: teamGoal ? Number(teamGoal) : undefined,
        individual_goal: individualGoal ? Number(individualGoal) : undefined,
        bonus_value: bonusValue ? Number(bonusValue) : undefined,
        bonus_description: bonusDescription.trim() || undefined,
        icon: "target",
        color: selectedTemplate?.color || "#8b5cf6",
      });

      toast.success(`"${pipeline.name}" criado com sucesso`);
      onOpenChange(false);
      resetForm();
      navigate(`/funil/${pipeline.slug}`);
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar funil temporário");
    }
  };

  const handleOpenChange = (v: boolean) => {
    onOpenChange(v);
    if (!v) resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[540px] p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="text-lg font-bold tracking-tight flex items-center gap-2">
            <Target className="w-5 h-5 text-purple-500" />
            {step === "template" ? "Escolha um template" : "Configurar funil temporário"}
          </DialogTitle>
        </DialogHeader>

        {step === "template" ? (
          /* ── Step 1: Choose template ── */
          <div className="px-6 pb-6">
            <p className="text-sm text-muted-foreground mb-4">
              Templates definem as etapas iniciais do funil. Você pode customizar depois.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {TEMPLATES.map((template) => {
                const Icon = template.icon;
                return (
                  <button
                    key={template.id}
                    onClick={() => handleSelectTemplate(template)}
                    className="group flex flex-col items-start gap-2 p-4 rounded-xl border-2 border-border/50 hover:border-purple-500/50 hover:bg-purple-500/5 transition-all text-left"
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
          </div>
        ) : (
          /* ── Step 2: Configuration form ── */
          <div className="px-6 pb-6 space-y-4">
            {/* Back link */}
            <button
              onClick={handleBack}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Voltar para templates
            </button>

            {/* Selected template badge */}
            {selectedTemplate && (
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
              <Label htmlFor="temp-name">Nome *</Label>
              <Input
                id="temp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Campanha de Indicação Q1"
                autoFocus
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="temp-desc">Descrição</Label>
              <Textarea
                id="temp-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Objetivo e contexto da campanha..."
                rows={2}
              />
            </div>

            {/* Dates row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="temp-start">Data de início</Label>
                <Input
                  id="temp-start"
                  type="date"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="temp-end">Data de término</Label>
                <Input
                  id="temp-end"
                  type="date"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </div>
            </div>

            {/* Goals row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="temp-team-goal">Meta do time</Label>
                <Input
                  id="temp-team-goal"
                  type="number"
                  min={0}
                  value={teamGoal}
                  onChange={(e) => setTeamGoal(e.target.value)}
                  placeholder="Ex: 50"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="temp-individual-goal">Meta individual</Label>
                <Input
                  id="temp-individual-goal"
                  type="number"
                  min={0}
                  value={individualGoal}
                  onChange={(e) => setIndividualGoal(e.target.value)}
                  placeholder="Ex: 10"
                />
              </div>
            </div>

            {/* Bonus section */}
            <div className="border-t border-border/50 pt-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Gift className="w-4 h-4" />
                Bônus (opcional)
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="temp-bonus-value">Valor (R$)</Label>
                  <Input
                    id="temp-bonus-value"
                    type="number"
                    min={0}
                    step="0.01"
                    value={bonusValue}
                    onChange={(e) => setBonusValue(e.target.value)}
                    placeholder="Ex: 500"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="temp-bonus-desc">Descrição do bônus</Label>
                  <Input
                    id="temp-bonus-desc"
                    value={bonusDescription}
                    onChange={(e) => setBonusDescription(e.target.value)}
                    placeholder="Ex: Vale-presente"
                  />
                </div>
              </div>
            </div>

            {/* Footer buttons */}
            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!name.trim() || createPipeline.isPending}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {createPipeline.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                Criar funil temporário
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
