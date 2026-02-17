/**
 * Step: Instruções Personalizadas
 *
 * Textarea simples para o usuário adicionar regras específicas
 * que serão injetadas no final do prompt do agente.
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
import { Textarea } from "@/components/ui/textarea";
import type { CopilotWizardData } from "@/types/copilot";
import { Settings2 } from "lucide-react";

export function CustomInstructionsStep() {
  const { control, watch } = useFormContext<CopilotWizardData>();
  const value = watch("customInstructions") || "";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Settings2 className="w-6 h-6 text-millennials-yellow" />
          Instruções Personalizadas
        </h2>
        <p className="text-muted-foreground">
          Adicione regras ou instruções específicas que o agente deve seguir (opcional).
        </p>
      </div>

      <FormField
        control={control}
        name="customInstructions"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Suas Instruções</FormLabel>
            <FormControl>
              <Textarea
                placeholder={"Ex:\n- Nunca mencione o concorrente X pelo nome\n- Sempre pergunte o CNPJ antes de qualificar\n- Se o lead perguntar sobre desconto, ofereça 10% para fechamento no mesmo dia\n- Priorize leads que mencionem urgência"}
                {...field}
                rows={8}
                className="resize-none"
              />
            </FormControl>
            <FormDescription>
              {value.length}/2000 caracteres. Estas instruções são adicionadas ao final do prompt.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="bg-muted/50 p-4 rounded-lg space-y-2">
        <h3 className="font-semibold text-sm">Exemplos de uso:</h3>
        <ul className="space-y-1 text-sm text-muted-foreground">
          <li>- Regras de compliance da empresa</li>
          <li>- Exceções de comportamento para segmentos específicos</li>
          <li>- Termos ou jargões internos que o agente deve usar</li>
          <li>- Proibições específicas do seu negócio</li>
        </ul>
      </div>
    </div>
  );
}
