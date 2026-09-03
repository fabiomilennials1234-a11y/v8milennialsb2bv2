import { useState, useEffect } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  usePipelineTemplates,
  useCreatePipelineTemplate,
  useUpdatePipelineTemplate,
} from "@/modules/platform/hooks/useOnboardingTemplates";
import { MatchCriteriaBuilder } from "./MatchCriteriaBuilder";
import { toast } from "sonner";

const COLORS = ["#7dc4e4", "#a6d189", "#ca9ee6", "#f6c177", "#e78284", "#8caaee"];

interface Props {
  templateId: string | null;
  onClose: () => void;
}

interface CustomPipeline {
  name: string;
  icon: string;
  color: string;
  stages: { name: string; color: string; position: number; is_final_positive: boolean; is_final_negative: boolean }[];
}

export function PipelineTemplateEditor({ templateId, onClose }: Props) {
  const { data: templates } = usePipelineTemplates();
  const createMutation = useCreatePipelineTemplate();
  const updateMutation = useUpdatePipelineTemplate();

  const existing = templates?.find((t: any) => t.id === templateId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("TrendingUp");
  const [color, setColor] = useState(COLORS[0]);
  const [priority, setPriority] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [matchCriteria, setMatchCriteria] = useState<Record<string, string[]>>({});
  // SCRUM-641: os toggles fixos do trio legado MORRERAM — template é lista
  // livre de funis custom, e a org nova já nasce com o "Funil de Vendas"
  // semeado como padrão (trigger trg_seed_default_funnel). `defaultConfig`
  // sobrevive só como passagem: preserva a chave de template ANTIGO no save
  // (o onboarding-engine a ignora), sem oferecê-la na tela.
  const [defaultConfig, setDefaultConfig] = useState<Record<string, any>>({});
  const [customPipelines, setCustomPipelines] = useState<CustomPipeline[]>([]);

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setDescription(existing.description ?? "");
      setIcon(existing.icon ?? "TrendingUp");
      setColor(existing.color ?? COLORS[0]);
      setPriority(existing.priority);
      setIsActive(existing.is_active);
      setMatchCriteria((existing.match_criteria as any) ?? {});
      setDefaultConfig((existing.default_pipelines_config as any) ?? {});
      setCustomPipelines((existing.custom_pipelines as any) ?? []);
    }
  }, [existing]);

  const addCustomPipeline = () => {
    setCustomPipelines((prev) => [
      ...prev,
      {
        name: "Novo Pipeline",
        icon: "Workflow",
        color: COLORS[prev.length % COLORS.length],
        stages: [
          { name: "Novo", color: "#7dc4e4", position: 0, is_final_positive: false, is_final_negative: false },
          { name: "Vendido", color: "#a6d189", position: 1, is_final_positive: true, is_final_negative: false },
          { name: "Perdido", color: "#e78284", position: 2, is_final_positive: false, is_final_negative: true },
        ],
      },
    ]);
  };

  const handleSave = async () => {
    const payload = {
      name,
      description: description || null,
      icon,
      color,
      priority,
      is_active: isActive,
      match_criteria: matchCriteria,
      default_pipelines_config: defaultConfig,
      custom_pipelines: customPipelines,
    };

    try {
      if (templateId) {
        await updateMutation.mutateAsync({ id: templateId, ...payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      toast.success(templateId ? "Template atualizado" : "Template criado");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {templateId ? "Editar Template" : "Novo Template"}
          </h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do template" />
          </div>
          <div>
            <Label>Prioridade</Label>
            <Input type="number" value={priority} onChange={(e) => setPriority(parseInt(e.target.value) || 0)} />
          </div>
        </div>

        <div>
          <Label>Descrição</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>

        <div className="flex items-center gap-4">
          <div>
            <Label>Ícone (Lucide)</Label>
            <Input value={icon} onChange={(e) => setIcon(e.target.value)} className="w-40" />
          </div>
          <div>
            <Label>Cor</Label>
            <div className="flex gap-1.5 mt-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 ${color === c ? "border-foreground" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Label>Ativo</Label>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <div className="p-3 rounded-lg border border-border/40 bg-muted/30">
          <p className="text-xs text-muted-foreground">
            Toda org nova já nasce com o <strong>Funil de Vendas</strong> como funil padrão.
            O template soma a ele os funis da lista abaixo.
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Custom Pipelines</Label>
            <Button variant="outline" size="sm" onClick={addCustomPipeline}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar
            </Button>
          </div>
          {customPipelines.map((cp, cpIdx) => (
            <div key={cpIdx} className="p-3 rounded-lg border border-border/40 mb-2 space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  value={cp.name}
                  onChange={(e) => {
                    const updated = [...customPipelines];
                    updated[cpIdx] = { ...cp, name: e.target.value };
                    setCustomPipelines(updated);
                  }}
                  className="flex-1"
                  placeholder="Nome do pipeline"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCustomPipelines((prev) => prev.filter((_, i) => i !== cpIdx))}
                >
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </div>
              <div className="space-y-1">
                {cp.stages.map((stage, sIdx) => (
                  <div key={sIdx} className="flex items-center gap-2 text-xs">
                    <input
                      type="color"
                      value={stage.color}
                      onChange={(e) => {
                        const updated = [...customPipelines];
                        updated[cpIdx].stages[sIdx] = { ...stage, color: e.target.value };
                        setCustomPipelines(updated);
                      }}
                      className="w-5 h-5 rounded border-0 cursor-pointer"
                    />
                    <Input
                      value={stage.name}
                      onChange={(e) => {
                        const updated = [...customPipelines];
                        updated[cpIdx].stages[sIdx] = { ...stage, name: e.target.value };
                        setCustomPipelines(updated);
                      }}
                      className="flex-1 h-7 text-xs"
                    />
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={stage.is_final_positive}
                        onChange={(e) => {
                          const updated = [...customPipelines];
                          updated[cpIdx].stages[sIdx] = { ...stage, is_final_positive: e.target.checked };
                          setCustomPipelines(updated);
                        }}
                      />
                      Won
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={stage.is_final_negative}
                        onChange={(e) => {
                          const updated = [...customPipelines];
                          updated[cpIdx].stages[sIdx] = { ...stage, is_final_negative: e.target.checked };
                          setCustomPipelines(updated);
                        }}
                      />
                      Lost
                    </label>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6"
                  onClick={() => {
                    const updated = [...customPipelines];
                    updated[cpIdx].stages.push({
                      name: "Nova Etapa",
                      color: "#888",
                      position: cp.stages.length,
                      is_final_positive: false,
                      is_final_negative: false,
                    });
                    setCustomPipelines(updated);
                  }}
                >
                  + Etapa
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div>
          <Label className="mb-2 block">Match Criteria</Label>
          <MatchCriteriaBuilder value={matchCriteria} onChange={setMatchCriteria} />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? "Salvando..." : templateId ? "Atualizar" : "Criar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
