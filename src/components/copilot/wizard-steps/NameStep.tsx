/**
 * Step 2: Nome do Agente
 *
 * Campo de texto para definir o nome único do agente.
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
import { Input } from "@/components/ui/input";
import type { CopilotWizardData } from "@/types/copilot";

export function NameStep() {
  const { control } = useFormContext<CopilotWizardData>();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Nomeie seu Copilot</h2>
        <p className="text-muted-foreground">
          Escolha um nome único e memorável para seu agente de IA
        </p>
      </div>

      <FormField
        control={control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Nome do Agente</FormLabel>
            <FormControl>
              <Input
                placeholder="Ex: Alex - SDR Pro"
                {...field}
                className="text-lg"
              />
            </FormControl>
            <FormDescription>
              Este nome será usado para identificar o agente no sistema
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="bg-muted/50 p-4 rounded-lg">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <span>💡</span> Dicas para um bom nome:
        </h3>
        <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
          <li>Use nomes humanizados e fáceis de lembrar</li>
          <li>Indique a especialidade do agente no nome</li>
          <li>Evite nomes genéricos ou muito técnicos</li>
          <li>Considere a cultura da sua empresa</li>
        </ul>
      </div>
    </div>
  );
}
