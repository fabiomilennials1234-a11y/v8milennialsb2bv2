/**
 * Step 1: Seleção de Template
 *
 * Permite escolher entre 5 templates pré-configurados.
 * Ao selecionar um template, o wizard carrega a config específica do tipo.
 */

import { useFormContext } from "react-hook-form";
import { motion } from "framer-motion";
import { AGENT_TEMPLATES } from "@/lib/copilot/templates";
import { getWizardConfig } from "../wizard-configs";
import type { CopilotWizardData } from "@/types/copilot";
import { Check } from "lucide-react";

export function TemplateStep() {
  const { setValue, watch, trigger } = useFormContext<CopilotWizardData>();
  const selectedTemplate = watch("templateType");

  // Filtrar apenas os tipos que têm wizard config (exclui custom)
  const availableTemplates = AGENT_TEMPLATES.filter(
    (t) => getWizardConfig(t.type) !== null
  );

  const handleSelectTemplate = async (templateType: string) => {
    setValue("templateType", templateType as any, {
      shouldValidate: true,
      shouldDirty: true,
      shouldTouch: true,
    });

    await trigger("templateType");
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Escolha o Tipo de Copilot</h2>
        <p className="text-muted-foreground">
          Cada tipo tem etapas e configurações específicas para seu objetivo
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {availableTemplates.map((template) => {
          const Icon = template.icon;
          const isSelected = selectedTemplate === template.type;
          const config = getWizardConfig(template.type);
          const stepCount = config?.steps.length ?? 0;

          return (
            <motion.button
              key={template.type}
              type="button"
              onClick={() => handleSelectTemplate(template.type)}
              className={`p-6 rounded-lg border-2 transition-all text-left ${
                isSelected
                  ? "border-primary bg-primary/10"
                  : "border-muted hover:border-primary/50"
              }`}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`p-3 rounded-lg ${
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold">{template.name}</h3>
                    {isSelected && (
                      <Check className="w-5 h-5 text-primary" />
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    {template.description}
                  </p>
                  <span className="text-xs text-muted-foreground/70">
                    {stepCount} etapas de configuração
                  </span>
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
