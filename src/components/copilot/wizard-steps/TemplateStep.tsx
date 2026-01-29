/**
 * Step 1: Seleção de Template
 *
 * Permite escolher entre 5 templates pré-configurados ou criar custom.
 * Ao selecionar um template, preenche automaticamente os campos seguintes.
 */

import { useFormContext } from "react-hook-form";
import { motion } from "framer-motion";
import { AGENT_TEMPLATES } from "@/lib/copilot/templates";
import type { CopilotWizardData } from "@/types/copilot";
import { Sparkles, Check } from "lucide-react";

export function TemplateStep() {
  const { setValue, watch, trigger } = useFormContext<CopilotWizardData>();
  const selectedTemplate = watch("templateType");

  const handleSelectTemplate = async (templateType: string) => {
    // Definir o template selecionado
    setValue("templateType", templateType as any, { 
      shouldValidate: true,
      shouldDirty: true,
      shouldTouch: true,
    });

    // Aplicar preset data do template
    const template = AGENT_TEMPLATES.find((t) => t.type === templateType);
    if (template?.presetData) {
      // Preencher campos com dados do template
      if (template.presetData.personality) {
        setValue("personality", template.presetData.personality, { shouldValidate: false });
      }
      if (template.presetData.skills) {
        setValue("skills", template.presetData.skills, { shouldValidate: false });
      }
      if (template.presetData.allowedTopics) {
        setValue("allowedTopics", template.presetData.allowedTopics, { shouldValidate: false });
      }
      if (template.presetData.forbiddenTopics) {
        setValue("forbiddenTopics", template.presetData.forbiddenTopics, { shouldValidate: false });
      }
      if (template.presetData.mainObjective) {
        setValue("mainObjective", template.presetData.mainObjective, { shouldValidate: false });
      }
    }

    // Validar o campo templateType após definir
    await trigger("templateType");
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Escolha um Template</h2>
        <p className="text-muted-foreground">
          Selecione um template pré-configurado ou comece do zero
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {AGENT_TEMPLATES.map((template) => {
          const Icon = template.icon;
          const isSelected = selectedTemplate === template.type;

          return (
            <motion.button
              key={template.type}
              type="button"
              onClick={() => handleSelectTemplate(template.type)}
              className={`p-6 rounded-lg border-2 transition-all text-left ${
                isSelected
                  ? "border-millennials-yellow bg-millennials-yellow/10"
                  : "border-muted hover:border-millennials-yellow/50"
              }`}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`p-3 rounded-lg ${
                    isSelected
                      ? "bg-millennials-yellow text-black"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold">{template.name}</h3>
                    {isSelected && (
                      <Check className="w-5 h-5 text-millennials-yellow" />
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {template.description}
                  </p>
                </div>
              </div>
            </motion.button>
          );
        })}

        {/* Opção Custom */}
        <motion.button
          type="button"
          onClick={() => handleSelectTemplate("custom")}
          className={`p-6 rounded-lg border-2 transition-all text-left ${
            selectedTemplate === "custom"
              ? "border-millennials-yellow bg-millennials-yellow/10"
              : "border-muted hover:border-millennials-yellow/50"
          }`}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <div className="flex items-start gap-4">
            <div
              className={`p-3 rounded-lg ${
                selectedTemplate === "custom"
                  ? "bg-millennials-yellow text-black"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <Sparkles className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold">Custom</h3>
                {selectedTemplate === "custom" && (
                  <Check className="w-5 h-5 text-millennials-yellow" />
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Crie um agente totalmente personalizado do zero
              </p>
            </div>
          </div>
        </motion.button>
      </div>
    </div>
  );
}
