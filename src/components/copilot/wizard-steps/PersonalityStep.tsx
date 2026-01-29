/**
 * Step 3: Personalidade do Agente
 *
 * Define tom de voz, estilo de comunicação e nível de energia.
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
import type { CopilotWizardData } from "@/types/copilot";

const TONE_OPTIONS = [
  {
    value: "formal",
    label: "Formal",
    description: "Linguagem corporativa e respeitosa",
  },
  {
    value: "casual",
    label: "Casual",
    description: "Conversa descontraída e amigável",
  },
  {
    value: "profissional",
    label: "Profissional",
    description: "Equilibrado e confiável",
  },
  {
    value: "amigavel",
    label: "Amigável",
    description: "Caloroso e acolhedor",
  },
  {
    value: "energetico",
    label: "Energético",
    description: "Entusiasmado e motivador",
  },
  {
    value: "consultivo",
    label: "Consultivo",
    description: "Orientado a solução de problemas",
  },
];

const STYLE_OPTIONS = [
  { value: "direto", label: "Direto", description: "Vai direto ao ponto" },
  {
    value: "detalhado",
    label: "Detalhado",
    description: "Explicações completas",
  },
  {
    value: "consultivo",
    label: "Consultivo",
    description: "Faz perguntas e orienta",
  },
  {
    value: "persuasivo",
    label: "Persuasivo",
    description: "Focado em convencer",
  },
  {
    value: "educativo",
    label: "Educativo",
    description: "Ensina e informa",
  },
];

const ENERGY_OPTIONS = [
  { value: "baixa", label: "Baixa", description: "Calmo e pausado" },
  { value: "moderada", label: "Moderada", description: "Equilibrado" },
  { value: "alta", label: "Alta", description: "Animado e proativo" },
  {
    value: "muito_alta",
    label: "Muito Alta",
    description: "Extremamente energético",
  },
];

export function PersonalityStep() {
  const { control } = useFormContext<CopilotWizardData>();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Defina a Personalidade</h2>
        <p className="text-muted-foreground">
          Configure como seu Copilot se comunica e interage
        </p>
      </div>

      <div className="grid gap-6">
        <FormField
          control={control}
          name="personality.tone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tom de Voz</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o tom" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {TONE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div>
                        <div className="font-medium">{option.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {option.description}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>Como o agente deve se expressar</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="personality.style"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Estilo de Comunicação</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o estilo" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {STYLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div>
                        <div className="font-medium">{option.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {option.description}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>Abordagem de interação</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="personality.energy"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nível de Energia</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a energia" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {ENERGY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div>
                        <div className="font-medium">{option.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {option.description}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>Intensidade da comunicação</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}
