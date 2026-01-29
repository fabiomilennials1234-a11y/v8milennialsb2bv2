/**
 * Step 4: Habilidades do Agente
 *
 * Checkboxes para selecionar habilidades do agente.
 */

import { useFormContext } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import type { CopilotWizardData } from "@/types/copilot";
import { AVAILABLE_SKILLS } from "@/types/copilot";

export function SkillsStep() {
  const { control } = useFormContext<CopilotWizardData>();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Habilidades do Copilot</h2>
        <p className="text-muted-foreground">
          Selecione as habilidades que seu agente possui
        </p>
      </div>

      <FormField
        control={control}
        name="skills"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Habilidades Disponíveis</FormLabel>
            <FormDescription>
              Escolha pelo menos 1 habilidade (máximo 10)
            </FormDescription>
            <div className="space-y-3 mt-4">
              {AVAILABLE_SKILLS.map((skill) => {
                const isChecked = field.value?.includes(skill) || false;

                return (
                  <FormItem
                    key={skill}
                    className="flex flex-row items-start space-x-3 space-y-0"
                  >
                    <FormControl>
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(checked) => {
                          const currentSkills = field.value || [];
                          if (checked) {
                            // Adicionar skill (máximo 10)
                            if (currentSkills.length < 10) {
                              field.onChange([...currentSkills, skill]);
                            }
                          } else {
                            // Remover skill
                            field.onChange(
                              currentSkills.filter((s) => s !== skill)
                            );
                          }
                        }}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="font-normal cursor-pointer">
                        {skill}
                      </FormLabel>
                    </div>
                  </FormItem>
                );
              })}
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="bg-muted/50 p-4 rounded-lg">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold">Dica:</span> Escolha habilidades que
          sejam relevantes para o objetivo do agente. Menos é mais - foque nas
          competências essenciais.
        </p>
      </div>
    </div>
  );
}
