import { useEffect, useState } from "react";
import { Loader2, Zap, ArrowRight } from "lucide-react";
import { useOnboardingAdvance } from "@/modules/platform/hooks/useOnboardingAdvance";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  type: string;
  icon: string;
  trigger_type: string;
  customizable_fields: {
    field_path: string;
    label: string;
    type: string;
    default_value: string;
    placeholder: string;
  }[];
}

interface Selection {
  template_id: string;
  enabled: boolean;
  customizations: Record<string, string>;
}

export function OnbStepAutomacoes() {
  const advance = useOnboardingAdvance();
  const [templates, setTemplates] = useState<AutomationTemplate[]>([]);
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      const result = await advance.mutateAsync({ action: "get_automation_templates" });
      const tpls = result.templates ?? [];
      setTemplates(tpls);

      const initial: Record<string, Selection> = {};
      tpls.forEach((t: AutomationTemplate) => {
        const customizations: Record<string, string> = {};
        t.customizable_fields?.forEach((f) => {
          customizations[f.field_path] = f.default_value;
        });
        initial[t.id] = { template_id: t.id, enabled: true, customizations };
      });
      setSelections(initial);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar automações");
    } finally {
      setLoading(false);
    }
  };

  const toggleTemplate = (id: string) => {
    setSelections((prev) => ({
      ...prev,
      [id]: { ...prev[id], enabled: !prev[id].enabled },
    }));
  };

  const updateCustomization = (templateId: string, fieldPath: string, value: string) => {
    setSelections((prev) => ({
      ...prev,
      [templateId]: {
        ...prev[templateId],
        customizations: { ...prev[templateId].customizations, [fieldPath]: value },
      },
    }));
  };

  const enabledCount = Object.values(selections).filter((s) => s.enabled).length;

  const handleActivate = async () => {
    if (enabledCount === 0) {
      toast.error("Ative pelo menos uma automação");
      return;
    }

    try {
      await advance.mutateAsync({
        action: "activate_automations",
        payload: { selections: Object.values(selections) },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao ativar automações");
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 text-center max-w-sm">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-amber-500" />
        <p className="text-sm text-muted-foreground">Carregando automações...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-lg w-full">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
          <Zap className="w-5 h-5 text-violet-500" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Ative suas automações</h3>
          <p className="text-sm text-muted-foreground">
            Automações recomendadas para sua operação. Personalize as mensagens.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {templates.map((tpl) => {
          const sel = selections[tpl.id];
          if (!sel) return null;

          return (
            <div
              key={tpl.id}
              className={cn(
                "p-4 rounded-xl border transition-all",
                sel.enabled
                  ? "border-violet-500/40 bg-violet-500/5"
                  : "border-border/40 bg-muted/10 opacity-60",
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{tpl.icon}</span>
                  <div>
                    <span className="text-sm font-medium">{tpl.name}</span>
                    <p className="text-xs text-muted-foreground">{tpl.description}</p>
                  </div>
                </div>
                <Switch checked={sel.enabled} onCheckedChange={() => toggleTemplate(tpl.id)} />
              </div>

              {sel.enabled && tpl.customizable_fields?.length > 0 && (
                <div className="space-y-3 mt-3 pt-3 border-t border-border/30">
                  {tpl.customizable_fields.map((field) => (
                    <div key={field.field_path}>
                      <label className="text-xs font-medium text-muted-foreground">
                        {field.label}
                      </label>
                      <Textarea
                        value={sel.customizations[field.field_path] ?? field.default_value}
                        onChange={(e) => updateCustomization(tpl.id, field.field_path, e.target.value)}
                        placeholder={field.placeholder}
                        rows={2}
                        className="mt-1 text-sm resize-none"
                      />
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                        Variáveis: {"{{nome}}"}, {"{{empresa}}"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={handleActivate}
        disabled={enabledCount === 0 || advance.isPending}
        className="w-full py-3 px-4 rounded-xl bg-violet-600 text-white font-medium text-sm flex items-center justify-center gap-2 hover:bg-violet-700 disabled:opacity-50 transition-all"
      >
        {advance.isPending ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Ativando...</>
        ) : (
          <>Ativar {enabledCount} automação{enabledCount !== 1 ? "ões" : ""} e começar <ArrowRight className="w-4 h-4" /></>
        )}
      </button>
    </div>
  );
}
