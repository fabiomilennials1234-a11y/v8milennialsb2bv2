import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useResponsibleMembers } from "@/modules/identity";
import { CONDITION_OPERATOR_LABELS, WEEKDAY_OPTIONS } from "@/types/workflow";
import type { ConditionNodeData, ConditionOperator, ConditionMode } from "@/types/workflow";
import { Clock, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConditionPanelProps {
  data: ConditionNodeData;
  onUpdate: (updates: Partial<ConditionNodeData>) => void;
}

const FIELD_OPTIONS = [
  { value: "name", label: "Nome do Lead" },
  { value: "company", label: "Empresa" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Telefone" },
  { value: "origin", label: "Origem" },
  { value: "utm_campaign", label: "Campanha (UTM)" },
  { value: "utm_source", label: "Fonte (UTM source)" },
  { value: "utm_medium", label: "Meio (UTM medium)" },
  { value: "utm_content", label: "Conteudo (UTM content)" },
  { value: "utm_term", label: "Termo (UTM term)" },
  { value: "rating", label: "Rating" },
  { value: "faturamento", label: "Faturamento" },
  { value: "segment", label: "Segmento" },
  { value: "urgency", label: "Urgencia" },
  { value: "score", label: "Score" },
  { value: "tag", label: "Tag" },
  { value: "stage", label: "Estagio" },
  { value: "pre_sale_responsible_id", label: "Responsavel Pre-vendas" },
  { value: "sale_responsible_id", label: "Responsavel Vendas" },
  { value: "any_responsible", label: "Responsavel (qualquer)" },
  { value: "sdr_id", label: "Responsavel Qualificacao (legado)" },
  { value: "last_message", label: "Ultima mensagem" },
  { value: "message_count", label: "Qtd. mensagens" },
  { value: "days_since_contact", label: "Dias sem contato" },
  { value: "custom", label: "Campo customizado" },
];

// Fields that reference a team member (FK). Value picks a member, not free text.
const RESPONSIBLE_FIELDS = new Set([
  "pre_sale_responsible_id",
  "sale_responsible_id",
  "any_responsible",
  "sdr_id",
]);

// Only these operators make sense against a responsible (member) field.
const RESPONSIBLE_OPERATORS: ConditionOperator[] = [
  "equals",
  "not_equals",
  "is_empty",
  "is_not_empty",
];

const NO_VALUE_OPERATORS: ConditionOperator[] = ["is_empty", "is_not_empty"];

const TIMEZONE_OPTIONS = [
  { value: "America/Sao_Paulo", label: "Brasilia (GMT-3)" },
  { value: "America/Manaus", label: "Manaus (GMT-4)" },
  { value: "America/Belem", label: "Belem (GMT-3)" },
  { value: "America/Fortaleza", label: "Fortaleza (GMT-3)" },
  { value: "America/Recife", label: "Recife (GMT-3)" },
  { value: "America/Cuiaba", label: "Cuiaba (GMT-4)" },
  { value: "America/Rio_Branco", label: "Rio Branco (GMT-5)" },
  { value: "America/Noronha", label: "Noronha (GMT-2)" },
];

export function ConditionPanel({ data, onUpdate }: ConditionPanelProps) {
  const mode: ConditionMode = data.conditionMode || "field";
  const needsValue = !NO_VALUE_OPERATORS.includes(data.operator);
  const members = useResponsibleMembers();
  const isResponsibleField = RESPONSIBLE_FIELDS.has(data.field || "");

  const handleFieldChange = (v: string) => {
    const nowResponsible = RESPONSIBLE_FIELDS.has(v);
    const updates: Partial<ConditionNodeData> = { field: v };
    // Switching responsible <-> non-responsible swaps value semantics (member id vs free text) → clear.
    if (nowResponsible !== isResponsibleField) updates.value = "";
    // Carry over only operators valid for a member field.
    if (nowResponsible && !RESPONSIBLE_OPERATORS.includes(data.operator)) {
      updates.operator = "equals";
    }
    onUpdate(updates);
  };

  const operatorEntries: Array<[string, string]> = isResponsibleField
    ? RESPONSIBLE_OPERATORS.map((k) => [k, CONDITION_OPERATOR_LABELS[k]])
    : (Object.entries(CONDITION_OPERATOR_LABELS) as Array<[string, string]>);

  const timeWindow = data.timeWindow || {
    days: ["seg", "ter", "qua", "qui", "sex"],
    startTime: "08:00",
    endTime: "18:00",
    timezone: "America/Sao_Paulo",
  };

  const handleModeChange = (newMode: ConditionMode) => {
    if (newMode === "time_window" && !data.timeWindow) {
      onUpdate({
        conditionMode: newMode,
        label: data.label || "Janela de horario",
        timeWindow: {
          days: ["seg", "ter", "qua", "qui", "sex"],
          startTime: "08:00",
          endTime: "18:00",
          timezone: "America/Sao_Paulo",
        },
      });
    } else {
      onUpdate({ conditionMode: newMode });
    }
  };

  const toggleDay = (day: string) => {
    const current = timeWindow.days;
    const updated = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day];
    if (updated.length === 0) return;
    onUpdate({ timeWindow: { ...timeWindow, days: updated } });
  };

  return (
    <div className="space-y-4">
      {/* Label */}
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder={mode === "time_window" ? "Ex: Horario comercial" : "Ex: Score maior que 50?"}
        />
      </div>

      {/* Mode toggle */}
      <div className="space-y-2">
        <Label>Tipo de condicao</Label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={mode === "field" ? "default" : "outline"}
            size="sm"
            className="justify-start gap-2"
            onClick={() => handleModeChange("field")}
          >
            <Filter className="w-3.5 h-3.5" />
            Campo
          </Button>
          <Button
            type="button"
            variant={mode === "time_window" ? "default" : "outline"}
            size="sm"
            className="justify-start gap-2"
            onClick={() => handleModeChange("time_window")}
          >
            <Clock className="w-3.5 h-3.5" />
            Horario
          </Button>
        </div>
      </div>

      {/* Field mode — existing behavior */}
      {mode === "field" && (
        <>
          <div className="space-y-2">
            <Label>Campo</Label>
            <Select
              value={data.field?.startsWith("custom.") ? "custom" : data.field || ""}
              onValueChange={handleFieldChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o campo" />
              </SelectTrigger>
              <SelectContent>
                {FIELD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(data.field === "custom" || data.field?.startsWith("custom.")) && (
            <div className="space-y-2">
              <Label>Nome do campo customizado</Label>
              <Input
                value={data.field?.startsWith("custom.") ? data.field.slice(7) : ""}
                onChange={(e) => onUpdate({ field: `custom.${e.target.value}` })}
                placeholder="Ex: cargo"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Operador</Label>
            <Select
              value={data.operator || ""}
              onValueChange={(v) => onUpdate({ operator: v as ConditionOperator })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o operador" />
              </SelectTrigger>
              <SelectContent>
                {operatorEntries.map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsValue && (
            <div className="space-y-2">
              <Label>Valor</Label>
              {isResponsibleField ? (
                <Select
                  value={data.value || ""}
                  onValueChange={(v) => onUpdate({ value: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o responsavel" />
                  </SelectTrigger>
                  <SelectContent>
                    {members.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        Nenhum responsavel disponivel
                      </div>
                    ) : (
                      members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={data.value || ""}
                  onChange={(e) => onUpdate({ value: e.target.value })}
                  placeholder="Ex: 50"
                />
              )}
            </div>
          )}
        </>
      )}

      {/* Time window mode */}
      {mode === "time_window" && (
        <>
          {/* Days */}
          <div className="space-y-2">
            <Label>Dias permitidos</Label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_OPTIONS.map((d) => (
                <Badge
                  key={d.value}
                  variant={timeWindow.days.includes(d.value) ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer select-none px-2.5 py-1 text-xs",
                    timeWindow.days.includes(d.value)
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                  onClick={() => toggleDay(d.value)}
                >
                  {d.label}
                </Badge>
              ))}
            </div>
          </div>

          {/* Time range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Inicio</Label>
              <Input
                type="time"
                value={timeWindow.startTime}
                onChange={(e) => onUpdate({ timeWindow: { ...timeWindow, startTime: e.target.value } })}
              />
            </div>
            <div className="space-y-2">
              <Label>Fim</Label>
              <Input
                type="time"
                value={timeWindow.endTime}
                onChange={(e) => onUpdate({ timeWindow: { ...timeWindow, endTime: e.target.value } })}
              />
            </div>
          </div>

          {/* Timezone */}
          <div className="space-y-2">
            <Label>Timezone</Label>
            <Select
              value={timeWindow.timezone}
              onValueChange={(v) => onUpdate({ timeWindow: { ...timeWindow, timezone: v } })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Behavior note */}
          <div className="rounded-md bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/40 p-3">
            <p className="text-xs text-blue-700 dark:text-blue-400">
              <strong>Fora da janela:</strong> o fluxo ficara pausado e sera retomado automaticamente no proximo horario permitido.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
