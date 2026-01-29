/**
 * Step 12: Disponibilidade e tempo de resposta
 *
 * Define se o agente atende 24/7 ou em horário específico.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Clock } from "lucide-react";
import type { CopilotWizardData } from "@/types/copilot";

const DAYS = [
  { value: "mon", label: "Seg" },
  { value: "tue", label: "Ter" },
  { value: "wed", label: "Qua" },
  { value: "thu", label: "Qui" },
  { value: "fri", label: "Sex" },
  { value: "sat", label: "Sáb" },
  { value: "sun", label: "Dom" },
];

export function AvailabilityStep() {
  const { control, watch, setValue } = useFormContext<CopilotWizardData>();
  const mode = watch("availability.mode");
  const days = watch("availability.days");

  const toggleDay = (value: string) => {
    const next = days.includes(value)
      ? days.filter((d) => d !== value)
      : [...days, value];
    setValue("availability.days", next, { shouldValidate: true, shouldDirty: true });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Clock className="w-6 h-6 text-millennials-yellow" />
          Disponibilidade do agente
        </h2>
        <p className="text-muted-foreground">
          Defina se o agente atende 24h ou em horários específicos.
        </p>
      </div>

      <div className="grid gap-6">
        <FormField
          control={control}
          name="availability.mode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Modo de atendimento</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="always">24 horas</SelectItem>
                  <SelectItem value="scheduled">Horário específico</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="availability.timezone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Fuso horário</FormLabel>
              <FormControl>
                <Input placeholder="Ex: America/Sao_Paulo" {...field} />
              </FormControl>
              <FormDescription>Use formato IANA.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {mode === "scheduled" && (
          <>
            <FormField
              control={control}
              name="availability.days"
              render={() => (
                <FormItem>
                  <FormLabel>Dias de atendimento</FormLabel>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {DAYS.map((day) => (
                      <label
                        key={day.value}
                        className="flex items-center gap-2 border rounded-md px-3 py-2 cursor-pointer hover:bg-muted/40"
                      >
                        <Checkbox
                          checked={days.includes(day.value)}
                          onCheckedChange={() => toggleDay(day.value)}
                        />
                        <span className="text-sm">{day.label}</span>
                      </label>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={control}
                name="availability.start"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Início</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="availability.end"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fim</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </>
        )}

        <FormField
          control={control}
          name="responseDelaySeconds"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tempo de resposta (segundos)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  max={30}
                  placeholder="Ex: 3"
                  value={field.value}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                />
              </FormControl>
              <FormDescription>
                Simula um pequeno atraso humano antes de responder (0–30s).
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}
