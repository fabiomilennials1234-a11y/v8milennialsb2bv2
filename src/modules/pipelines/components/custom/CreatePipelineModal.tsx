import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateCustomPipeline } from "@/modules/pipelines/hooks/custom/useCustomPipelines";
import { Loader2, Kanban, Target, Users, ShoppingBag, Heart, Briefcase, Star, Zap, Gift } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

interface CreatePipelineModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PIPELINE_COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#eab308", // yellow
  "#f97316", // orange
  "#ef4444", // red
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#64748b", // slate
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

export function CreatePipelineModal({ open, onOpenChange }: CreatePipelineModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedColor, setSelectedColor] = useState(PIPELINE_COLORS[0]);
  const [selectedIcon, setSelectedIcon] = useState("kanban");
  const navigate = useNavigate();

  const createPipeline = useCreateCustomPipeline();

  const handleCreate = async () => {
    if (!name.trim()) return;

    try {
      const pipeline = await createPipeline.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        icon: selectedIcon,
        color: selectedColor,
      });

      toast.success(`Funil "${pipeline.name}" criado com sucesso`);
      onOpenChange(false);
      resetForm();
      navigate(`/pipe/custom/${pipeline.slug}`);
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar funil");
    }
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setSelectedColor(PIPELINE_COLORS[0]);
    setSelectedIcon("kanban");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Criar Novo Funil</DialogTitle>
          <DialogDescription>
            Crie um funil personalizado com etapas customizáveis.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Nome */}
          <div className="space-y-2">
            <Label htmlFor="pipeline-name">Nome do Funil *</Label>
            <Input
              id="pipeline-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Pós-Venda, Indicações, Onboarding..."
              autoFocus
            />
          </div>

          {/* Descrição */}
          <div className="space-y-2">
            <Label htmlFor="pipeline-desc">Descrição</Label>
            <Textarea
              id="pipeline-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva o propósito deste funil..."
              rows={2}
            />
          </div>

          {/* Ícone */}
          <div className="space-y-2">
            <Label>Ícone</Label>
            <div className="flex flex-wrap gap-2">
              {PIPELINE_ICONS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.name}
                    onClick={() => setSelectedIcon(item.name)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-all",
                      selectedIcon === item.name
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cor */}
          <div className="space-y-2">
            <Label>Cor</Label>
            <div className="flex gap-2">
              {PIPELINE_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setSelectedColor(color)}
                  className={cn(
                    "w-8 h-8 rounded-full border-2 transition-all",
                    selectedColor === color
                      ? "border-foreground scale-110"
                      : "border-transparent hover:scale-105"
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || createPipeline.isPending}
          >
            {createPipeline.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Criar Funil
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { PIPELINE_ICONS, PIPELINE_COLORS };
