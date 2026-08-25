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
import { useLeadOrigins, useLeadCustomFields } from "@/modules/leads";
import { CONDITION_OPERATOR_LABELS, WEEKDAY_OPTIONS } from "@/types/workflow";
import type { ConditionNodeData, ConditionOperator, ConditionMode } from "@/types/workflow";
import { Clock, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgUtmValues, UTM_VALUE_FIELDS } from "@/modules/workflows/hooks/useOrgUtmValues";
import { useOrgCustomFieldValues } from "@/modules/workflows/hooks/useOrgCustomFieldValues";
import { ValueCombobox } from "./ValueCombobox";

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
  // ── Negócio ── (ADR-0023: lead não tem etapa nem valor; negócio tem)
  { value: "deal_value", label: "Valor do negocio" },
  { value: "has_open_deal", label: "Tem negocio aberto (true/false)" },
  { value: "days_in_stage", label: "Dias parado na etapa" },
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

// UTM fields whose value is chosen via the creatable combobox (org's real UTM
// values). Single source of truth = the hook's allowlist.
const UTM_FIELDS = UTM_VALUE_FIELDS;

// Operators that stay sensible against a UTM string value. UTM values carry
// `.`/`[]`/acento (ex.: `[TESTE CRIATIVOS] BATERIA.`), so `equals` is fragile —
// when entering a UTM field from an incompatible (numeric) operator we default
// to `contains`, but we never override an already-sensible text operator.
const TEXT_SAFE_OPERATORS = new Set<ConditionOperator>([
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "is_empty",
  "is_not_empty",
]);

const NO_VALUE_OPERATORS: ConditionOperator[] = ["is_empty", "is_not_empty"];

// `data.field` guarda o campo personalizado como `custom.<field_name>` — é o
// formato que o avaliador (`workflow-condition-evaluator.ts`) sabe resolver.
const CUSTOM_FIELD_PREFIX = "custom.";

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
  const isUtmField = UTM_FIELDS.has(data.field || "");
  const isOriginField = data.field === "origin";
  const { values: utmValues, isLoading: utmLoading } = useOrgUtmValues(data.field);

  // Campo personalizado: `custom` = escolhido no seletor mas ainda sem campo
  // definido; `custom.<nome>` = configurado.
  const isCustomField =
    data.field === "custom" || (data.field?.startsWith(CUSTOM_FIELD_PREFIX) ?? false);
  const customFieldName = data.field?.startsWith(CUSTOM_FIELD_PREFIX)
    ? data.field.slice(CUSTOM_FIELD_PREFIX.length)
    : "";

  // Catálogo real de campos personalizados da org. Antes o nome era digitado à
  // mão — e o avaliador casa por `field_name` exato, então um acento ou
  // dois-pontos a menos (`Você tem interesse em:`) devolvia "" e mandava TODO
  // lead pela saída "Não", sem erro visível. Escolher da lista mata a classe.
  const { data: customFields = [] } = useLeadCustomFields();
  const customFieldItems = customFields.map((f) => ({
    value: f.field_name,
    label: f.field_name,
  }));
  // Campo renomeado/excluído depois do workflow salvo: mantém selecionável e
  // rotula o estrago, em vez de a seleção sumir calada.
  const customFieldMissing =
    !!customFieldName && !customFields.some((f) => f.field_name === customFieldName);
  if (customFieldMissing) {
    customFieldItems.unshift({
      value: customFieldName,
      label: `${customFieldName} (não existe mais)`,
    });
  }
  const selectedCustomField = customFields.find((f) => f.field_name === customFieldName);
  const { values: customValues, isLoading: customValuesLoading } =
    useOrgCustomFieldValues(selectedCustomField?.id);

  // Catálogo dinâmico de origens (built-ins globais + custom da org) — mesma fonte do gatilho.
  // Compara por slug; garante que o valor já salvo continue selecionável se sumiu do catálogo.
  const { origins: leadOrigins } = useLeadOrigins();
  const originItems = leadOrigins.map((o) => ({ value: o.slug, label: o.label }));
  if (isOriginField && data.value && !originItems.some((o) => o.value === data.value)) {
    originItems.unshift({ value: data.value, label: data.value });
  }

  const handleFieldChange = (v: string) => {
    const nowResponsible = RESPONSIBLE_FIELDS.has(v);
    const nowOrigin = v === "origin";
    const nowCustom = v === "custom";
    const updates: Partial<ConditionNodeData> = { field: v };
    // Switching responsible <-> non-responsible swaps value semantics (member id vs free text) → clear.
    if (nowResponsible !== isResponsibleField) updates.value = "";
    // Same for origin: free text <-> origin slug are incompatible → clear.
    if (nowOrigin !== isOriginField) updates.value = "";
    // Same for custom field: the value domain belongs to the field → clear.
    if (nowCustom !== isCustomField) updates.value = "";
    // Custom fields are always text (`lead_custom_field_values.value` is text) —
    // a numeric operator carried over from `score` would never match.
    if (nowCustom && !TEXT_SAFE_OPERATORS.has(data.operator)) {
      updates.operator = "contains";
    }
    // Carry over only operators valid for a member field.
    if (nowResponsible && !RESPONSIBLE_OPERATORS.includes(data.operator)) {
      updates.operator = "equals";
    }
    // Entering a UTM field with a numeric/incompatible operator → default to
    // `contains` (saved value has `.`/`[]`/acento; `equals` is fragile). Keep
    // an already-sensible text operator untouched.
    if (UTM_FIELDS.has(v) && !TEXT_SAFE_OPERATORS.has(data.operator)) {
      updates.operator = "contains";
    }
    onUpdate(updates);
  };

  // Trocar de campo personalizado troca o domínio do valor → limpa. Reselecionar
  // o mesmo campo é no-op (não pode apagar o valor já configurado).
  const handleCustomFieldChange = (name: string) => {
    if (name === customFieldName) return;
    onUpdate({ field: `${CUSTOM_FIELD_PREFIX}${name}`, value: "" });
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

          {isCustomField && (
            <div className="space-y-2">
              <Label>Campo personalizado</Label>
              <Select value={customFieldName} onValueChange={handleCustomFieldChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o campo personalizado" />
                </SelectTrigger>
                <SelectContent>
                  {customFieldItems.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhum campo personalizado cadastrado nesta org
                    </div>
                  ) : (
                    customFieldItems.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {customFieldMissing && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Este campo nao existe mais na org — a condicao nunca sera
                  verdadeira. Selecione outro campo.
                </p>
              )}
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
              ) : isUtmField ? (
                <ValueCombobox
                  values={utmValues}
                  isLoading={utmLoading}
                  value={data.value || ""}
                  onChange={(v) => onUpdate({ value: v })}
                  emptyMessage="Nenhum valor de UTM encontrado nesta org — digite manualmente."
                />
              ) : isCustomField ? (
                customFieldName ? (
                  <ValueCombobox
                    values={customValues}
                    isLoading={customValuesLoading}
                    value={data.value || ""}
                    onChange={(v) => onUpdate({ value: v })}
                    emptyMessage="Nenhum lead preencheu este campo ainda — digite manualmente."
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Selecione o campo personalizado acima para ver os valores ja
                    respondidos.
                  </p>
                )
              ) : isOriginField ? (
                <Select
                  value={data.value || ""}
                  onValueChange={(v) => onUpdate({ value: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a origem" />
                  </SelectTrigger>
                  <SelectContent>
                    {originItems.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        Nenhuma origem cadastrada
                      </div>
                    ) : (
                      originItems.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
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
