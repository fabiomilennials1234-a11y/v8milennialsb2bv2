/**
 * Step: Persona e Tom de Voz (Wizard v3)
 *
 * Substitui: PersonalityStep + ConversationStyleStep + AvailabilityStep
 *
 * Campo livre descritivo onde o usuário descreve como o agente deve
 * se comportar e se comunicar, substituindo os dropdowns genéricos.
 * Seção colapsável de configurações técnicas (identidade, delay, horários).
 */

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import {
  User,
  ChevronDown,
  ChevronUp,
  Clock,
  Shield,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CopilotWizardData } from "@/types/copilot";

const WEEKDAYS = [
  { value: "mon", label: "Seg" },
  { value: "tue", label: "Ter" },
  { value: "wed", label: "Qua" },
  { value: "thu", label: "Qui" },
  { value: "fri", label: "Sex" },
  { value: "sat", label: "Sáb" },
  { value: "sun", label: "Dom" },
];

export function PersonaTomStep() {
  const { register, watch, setValue } = useFormContext<CopilotWizardData>();
  const [showTechnical, setShowTechnical] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const hideAiIdentity = watch("conversationStyle.hideAiIdentity");
  const availabilityMode = watch("availability.mode");
  const availabilityDays = watch("availability.days") || [];

  const toggleDay = (day: string) => {
    const current = availabilityDays;
    if (current.includes(day)) {
      setValue("availability.days", current.filter((d) => d !== day), { shouldDirty: true });
    } else {
      setValue("availability.days", [...current, day], { shouldDirty: true });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <User className="w-6 h-6 text-primary" />
          Persona e Tom de Voz
        </h2>
        <p className="text-muted-foreground">
          Descreva como o agente deve se comportar e se comunicar, como se estivesse
          instruindo um vendedor novo na empresa.
        </p>
      </div>

      {/* Guia contextual */}
      <button
        type="button"
        onClick={() => setShowGuide(!showGuide)}
        className="flex items-center gap-2 text-sm text-blue-500 hover:text-blue-600 transition-colors"
      >
        {showGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        {showGuide ? "Ocultar dicas" : "Ver dicas do que incluir"}
      </button>

      {showGuide && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-xs text-muted-foreground space-y-1">
          <p><strong className="text-blue-500">Inclua informações como:</strong></p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>Como o agente se apresenta (nome fictício, cargo, saudação)</li>
            <li>Tom de voz: formal, casual, consultivo, energético...</li>
            <li>Comprimento das mensagens (curtas e diretas? ou mais detalhadas?)</li>
            <li>Uso de emojis (nunca, às vezes, sempre)</li>
            <li>Como abrir e fechar conversas</li>
            <li>Dicas de humanização (confirmar antes de perguntar, usar gírias, etc.)</li>
            <li>Qualquer característica que torne o agente único</li>
          </ul>
        </div>
      )}

      {/* Campo principal */}
      <div>
        <Textarea
          {...register("personaDescription")}
          placeholder={`Exemplo: "Fale de forma casual e amigável, como um consultor experiente que conversa pelo WhatsApp. Use mensagens curtas (2-3 frases no máximo). Use emojis com moderação (1 por mensagem no máximo). Se apresente como consultor da equipe comercial. Abra conversas com uma saudação calorosa e personalizada. Feche sempre com uma pergunta aberta ou próximo passo claro. Confirme o que o lead disse antes de fazer uma nova pergunta. Nunca pareça robótico — fale como gente."`}
          className="min-h-[180px] resize-y"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Quanto mais detalhado, mais personalizado será o agente.
        </p>
      </div>

      {/* Tempo de resposta — VISÍVEL (não colapsável) */}
      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" />
          <Label className="text-sm font-semibold">Tempo de espera antes de responder</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          O agente aguarda este tempo para acumular mensagens antes de responder.
          Pessoas costumam quebrar uma ideia em várias mensagens — esse delay evita
          que o agente responda a cada uma separadamente.
        </p>
        <div className="flex items-center gap-3 pt-1">
          <div className="flex gap-2">
            {[5, 8, 12, 15, 20].map((val) => {
              const currentDelay = watch("responseDelaySeconds") || 8;
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => setValue("responseDelaySeconds", val, { shouldDirty: true })}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                    currentDelay === val
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-input bg-background hover:bg-muted/50"
                  }`}
                >
                  {val}s
                </button>
              );
            })}
          </div>
          <span className="text-xs text-muted-foreground">ou</span>
          <Input
            type="number"
            min={3}
            max={30}
            {...register("responseDelaySeconds", { valueAsNumber: true })}
            className="w-20"
          />
          <span className="text-xs text-muted-foreground">seg</span>
        </div>
        <p className="text-[11px] text-muted-foreground/70">
          Recomendado: 8-15 segundos. Valores baixos podem causar respostas fragmentadas.
        </p>
      </Card>

      {/* Configurações Técnicas (colapsável) */}
      <button
        type="button"
        onClick={() => setShowTechnical(!showTechnical)}
        className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors w-full"
      >
        {showTechnical ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        Configurações técnicas
      </button>

      {showTechnical && (
        <Card className="p-4 space-y-5">
          {/* Identidade */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <div>
                <Label className="text-sm font-medium">Persona humana</Label>
                <p className="text-xs text-muted-foreground">
                  O agente nunca admite ser uma IA — se apresenta como humano
                </p>
              </div>
            </div>
            <Switch
              checked={hideAiIdentity || false}
              onCheckedChange={(checked) =>
                setValue("conversationStyle.hideAiIdentity", checked, { shouldDirty: true })
              }
            />
          </div>

          {/* Disponibilidade */}
          <div>
            <Label className="text-sm font-medium mb-2 block">Horário de atendimento</Label>
            <Select
              value={availabilityMode}
              onValueChange={(val) => setValue("availability.mode", val as any, { shouldDirty: true })}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="always">24 horas</SelectItem>
                <SelectItem value="scheduled">Horário comercial</SelectItem>
              </SelectContent>
            </Select>

            {availabilityMode === "scheduled" && (
              <div className="mt-3 space-y-3">
                <div className="flex gap-2 flex-wrap">
                  {WEEKDAYS.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleDay(day.value)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        availabilityDays.includes(day.value)
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    {...register("availability.start")}
                    className="w-28"
                  />
                  <span className="text-sm text-muted-foreground">até</span>
                  <Input
                    type="time"
                    {...register("availability.end")}
                    className="w-28"
                  />
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
