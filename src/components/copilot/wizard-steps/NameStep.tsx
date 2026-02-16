/**
 * Step 2: Nome do Agente
 *
 * Campo de texto para definir o nome único do agente.
 * Inclui toggle para atender contatos desconhecidos (shadow leads).
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { UserPlus } from "lucide-react";
import type { CopilotWizardData } from "@/types/copilot";

export function NameStep() {
  const { control, watch, setValue } = useFormContext<CopilotWizardData>();
  const attendUnknown = watch("attendUnknownContacts");

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

      {/* Toggle: Atender contatos desconhecidos */}
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <UserPlus className="w-4 h-4 text-primary" />
            </div>
            <div>
              <Label className="font-semibold">Atender contatos sem lead</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Responde automaticamente a números que ainda não são leads no sistema
              </p>
            </div>
          </div>
          <Switch
            checked={attendUnknown ?? false}
            onCheckedChange={(checked) => setValue("attendUnknownContacts", checked)}
          />
        </div>
        {attendUnknown && (
          <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
            O copilot criará um contato temporário para conversar. Quando qualificar ou desqualificar,
            o lead será criado oficialmente e colocado no funil configurado nas ações automáticas.
          </p>
        )}
      </div>

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
