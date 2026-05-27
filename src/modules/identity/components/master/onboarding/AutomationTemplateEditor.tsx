import { useState, useEffect } from "react";
import { X, Plus, Trash2, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAutomationTemplates,
  useCreateAutomationTemplate,
  useUpdateAutomationTemplate,
} from "@/modules/platform/hooks/useOnboardingTemplates";
import { MatchCriteriaBuilder } from "./MatchCriteriaBuilder";
import { toast } from "sonner";

interface CustomizableField {
  field_path: string;
  label: string;
  type: "text" | "textarea" | "number" | "select";
  default_value: string;
  placeholder?: string;
  options?: string[];
}

interface Props {
  templateId: string | null;
  onClose: () => void;
}

const TYPES = ["boas_vindas", "follow_up", "confirmacao_reuniao", "custom"] as const;
const TRIGGER_TYPES = ["lead_created", "stage_changed", "tag_added", "cron", "manual"] as const;

export function AutomationTemplateEditor({ templateId, onClose }: Props) {
  const { data: templates } = useAutomationTemplates();
  const createMutation = useCreateAutomationTemplate();
  const updateMutation = useUpdateAutomationTemplate();

  const existing = templates?.find((t: any) => t.id === templateId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<string>("boas_vindas");
  const [icon, setIcon] = useState("Zap");
  const [triggerType, setTriggerType] = useState<string>("lead_created");
  const [triggerConfig, setTriggerConfig] = useState("{}");
  const [workflowDef, setWorkflowDef] = useState("{}");
  const [customFields, setCustomFields] = useState<CustomizableField[]>([]);
  const [matchCriteria, setMatchCriteria] = useState<Record<string, string[]>>({});
  const [isActive, setIsActive] = useState(true);
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setDescription(existing.description ?? "");
      setType(existing.type);
      setIcon((existing as any).icon ?? "Zap");
      setTriggerType(existing.trigger_type);
      setTriggerConfig(JSON.stringify(existing.trigger_config ?? {}, null, 2));
      setWorkflowDef(JSON.stringify(existing.workflow_definition ?? {}, null, 2));
      setCustomFields((existing.customizable_fields as any) ?? []);
      setMatchCriteria((existing.match_criteria as any) ?? {});
      setIsActive(existing.is_active ?? true);
    }
  }, [existing]);

  const addCustomField = () => {
    setCustomFields((prev) => [
      ...prev,
      {
        field_path: "",
        label: "",
        type: "text",
        default_value: "",
        placeholder: "",
      },
    ]);
  };

  const updateField = (idx: number, patch: Partial<CustomizableField>) => {
    setCustomFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const removeField = (idx: number) => {
    setCustomFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    let parsedWorkflow: unknown;
    let parsedTrigger: unknown;
    try {
      parsedWorkflow = JSON.parse(workflowDef);
      parsedTrigger = JSON.parse(triggerConfig);
    } catch {
      toast.error("JSON inválido em workflow ou trigger config");
      return;
    }

    const payload = {
      name,
      description: description || null,
      type,
      icon,
      trigger_type: triggerType,
      trigger_config: parsedTrigger,
      workflow_definition: parsedWorkflow,
      customizable_fields: customFields,
      match_criteria: Object.keys(matchCriteria).length > 0 ? matchCriteria : null,
      is_active: isActive,
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
            {templateId ? "Editar Automação" : "Nova Automação"}
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
            <Label>Tipo</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label>Descrição</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Trigger</Label>
            <Select value={triggerType} onValueChange={setTriggerType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TRIGGER_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Label>Ativo</Label>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <Label>Trigger Config (JSON)</Label>
          </div>
          <Textarea
            value={triggerConfig}
            onChange={(e) => setTriggerConfig(e.target.value)}
            rows={3}
            className="font-mono text-xs"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <Label>Workflow Definition (JSON)</Label>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-6"
              onClick={() => setShowJson(!showJson)}
            >
              <Code2 className="w-3 h-3 mr-1" />
              {showJson ? "Ocultar" : "Expandir"}
            </Button>
          </div>
          <Textarea
            value={workflowDef}
            onChange={(e) => setWorkflowDef(e.target.value)}
            rows={showJson ? 15 : 4}
            className="font-mono text-xs"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Campos Customizáveis</Label>
            <Button variant="outline" size="sm" onClick={addCustomField}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar
            </Button>
          </div>
          {customFields.map((field, idx) => (
            <div key={idx} className="p-3 rounded-lg border border-border/40 mb-2 space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  value={field.field_path}
                  onChange={(e) => updateField(idx, { field_path: e.target.value })}
                  placeholder="field_path (ex: nodes.action_1.data.message)"
                  className="flex-1 text-xs h-8 font-mono"
                />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeField(idx)}>
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Input
                  value={field.label}
                  onChange={(e) => updateField(idx, { label: e.target.value })}
                  placeholder="Label"
                  className="text-xs h-7"
                />
                <Select value={field.type} onValueChange={(v) => updateField(idx, { type: v as CustomizableField["type"] })}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">text</SelectItem>
                    <SelectItem value="textarea">textarea</SelectItem>
                    <SelectItem value="number">number</SelectItem>
                    <SelectItem value="select">select</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={field.placeholder ?? ""}
                  onChange={(e) => updateField(idx, { placeholder: e.target.value })}
                  placeholder="Placeholder"
                  className="text-xs h-7"
                />
              </div>
              <Textarea
                value={field.default_value}
                onChange={(e) => updateField(idx, { default_value: e.target.value })}
                placeholder="Valor default"
                rows={2}
                className="text-xs"
              />
            </div>
          ))}
        </div>

        <div>
          <Label className="mb-2 block">Match Criteria (opcional)</Label>
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
