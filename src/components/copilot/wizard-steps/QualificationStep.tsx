/**
 * Step 10: Qualificação mínima
 *
 * Define quais informações o agente deve buscar primeiro.
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
import { Textarea } from "@/components/ui/textarea";
import { ListChecks } from "lucide-react";
import type { CopilotWizardData } from "@/types/copilot";

const DEFAULT_FIELDS = [
  "Necessidade / Dor principal",
  "Volume / Escopo",
  "Urgência / Prazo",
  "Orçamento (faixa)",
  "Decisor / Autoridade",
  "Segmento / Nicho",
  "Tamanho da empresa",
  "Número de vendedores",
  "Sistema atual / Ferramentas",
];

export function QualificationStep() {
  const { control, watch, setValue } = useFormContext<CopilotWizardData>();
  const requiredFields = watch("qualification.requiredFields");
  const optionalFields = watch("qualification.optionalFields");

  const toggleField = (field: string, type: "requiredFields" | "optionalFields") => {
    const current = type === "requiredFields" ? requiredFields : optionalFields;
    const next = current.includes(field)
      ? current.filter((f) => f !== field)
      : [...current, field];
    setValue(`qualification.${type}`, next, { shouldValidate: true, shouldDirty: true });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <ListChecks className="w-6 h-6 text-millennials-yellow" />
          Qualificação mínima
        </h2>
        <p className="text-muted-foreground">
          Defina as informações essenciais e opcionais para qualificar o lead.
        </p>
      </div>

      <div className="grid gap-6">
        <FormField
          control={control}
          name="qualification.requiredFields"
          render={() => (
            <FormItem>
              <FormLabel>Campos obrigatórios</FormLabel>
              <FormDescription>
                O agente deve buscar estes dados primeiro, um de cada vez.
              </FormDescription>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                {DEFAULT_FIELDS.map((field) => (
                  <label
                    key={`required-${field}`}
                    className="flex items-center gap-2 border rounded-md p-3 cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={requiredFields.includes(field)}
                      onCheckedChange={() => toggleField(field, "requiredFields")}
                    />
                    <span className="text-sm">{field}</span>
                  </label>
                ))}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormItem>
          <FormLabel>Campos opcionais</FormLabel>
          <FormDescription>
            Usados quando o lead está engajado ou quando faltar contexto.
          </FormDescription>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
            {DEFAULT_FIELDS.map((field) => (
              <label
                key={`optional-${field}`}
                className="flex items-center gap-2 border rounded-md p-3 cursor-pointer hover:bg-muted/40"
              >
                <Checkbox
                  checked={optionalFields.includes(field)}
                  onCheckedChange={() => toggleField(field, "optionalFields")}
                />
                <span className="text-sm">{field}</span>
              </label>
            ))}
          </div>
        </FormItem>

        <FormField
          control={control}
          name="qualification.notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notas adicionais (opcional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Ex: Não perguntar orçamento logo de cara; priorizar urgência..."
                  rows={3}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}
