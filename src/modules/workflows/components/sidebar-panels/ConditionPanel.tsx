import { useId } from "react";
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
import { useLeadOrigins, useLeadCustomFields, useTags } from "@/modules/leads";
import { useAllPipelineStages, useFunisDaOrg } from "@/modules/pipelines";
import { CONDITION_OPERATOR_LABELS, WEEKDAY_OPTIONS } from "@/types/workflow";
import type { ConditionNodeData, ConditionOperator, ConditionMode } from "@/types/workflow";
import { Clock, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgUtmValues, UTM_VALUE_FIELDS } from "@/modules/workflows/hooks/useOrgUtmValues";
import { useOrgCustomFieldValues } from "@/modules/workflows/hooks/useOrgCustomFieldValues";
import { useOrgConditionValues } from "../../hooks/useOrgConditionValues";
import { conditionOperators, conditionValueKind, defaultConditionOperator, RESPONSIBLE_FIELDS, OBSERVED_FIELDS, UNSUPPORTED_FIELDS, VALUELESS_OPERATORS } from "../../lib/condition-field-controls";
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
  { value: "rating", label: "Avaliação (1 a 5)" },
  { value: "faturamento", label: "Faturamento" },
  { value: "segment", label: "Segmento" },
  { value: "urgency", label: "Urgência" },
  { value: "score", label: "Pontuação de qualificação" },
  { value: "tags", label: "Tag" },
  { value: "stage_id", label: "Etapa atual do negócio" },
  // ── Negócio ── (ADR-0023: lead não tem etapa nem valor; negócio tem)
  { value: "deal_value", label: "Valor do negocio" },
  { value: "has_open_deal", label: "Tem negócio aberto" },
  { value: "days_in_stage", label: "Dias na etapa atual" },
  { value: "pre_sale_responsible_id", label: "Responsavel Pre-vendas" },
  { value: "sale_responsible_id", label: "Responsavel Vendas" },
  { value: "any_responsible", label: "Responsavel (qualquer)" },
  { value: "sdr_id", label: "Responsavel Qualificacao (legado)" },
  { value: "last_message", label: "Ultima mensagem" },
  { value: "message_count", label: "Qtd. mensagens" },
  { value: "days_since_contact", label: "Dias sem contato" },
  { value: "custom", label: "Campo customizado" },
];

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
  const formId = useId();
  const mode: ConditionMode = data.conditionMode || "field";
  const needsValue = !VALUELESS_OPERATORS.has(data.operator);
  const members = useResponsibleMembers();
  const isResponsibleField = RESPONSIBLE_FIELDS.has(data.field || "");
  const isUtmField = UTM_VALUE_FIELDS.has(data.field || "");
  const isTagField = data.field === "tag" || data.field === "tags";
  const { data: tags = [], isLoading: tagsLoading, isError: tagsError } = useTags();
  const tagNames = [...new Set(tags.map((tag) => tag.name))];
  const missingTag = isTagField && !!data.value && !tagsLoading && !tagsError && !tagNames.includes(data.value);
  const isOriginField = data.field === "origin";
  const isStageField = data.field === "stage" || data.field === "stage_id";
  const observedValues = useOrgConditionValues(data.field);
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
  const valueKind = conditionValueKind(data.field || "", selectedCustomField?.field_type);
  const validOperators = conditionOperators(data.field || "", selectedCustomField?.field_type);
  const legacyOperator = !validOperators.includes(data.operator);
  const fixedValues = data.field === "rating"
    ? [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} ${n === 1 ? "estrela" : "estrelas"}` }))
    : valueKind === "boolean"
      ? [{ value: "true", label: "Sim" }, { value: "false", label: "Não" }]
      : valueKind === "select"
        ? [...new Set(selectedCustomField?.field_options ?? [])].filter(Boolean).map((value) => ({ value, label: value }))
        : null;
  if (fixedValues && data.value && !fixedValues.some((item) => item.value === data.value)) {
    fixedValues.unshift({ value: data.value, label: `${data.value} (valor salvo fora das opções)` });
  }
  const { values: customValues, isLoading: customValuesLoading } =
    useOrgCustomFieldValues(selectedCustomField?.id);

  // Catálogo dinâmico de origens (built-ins globais + custom da org) — mesma fonte do gatilho.
  // Compara por slug; garante que o valor já salvo continue selecionável se sumiu do catálogo.
  const { origins: leadOrigins } = useLeadOrigins();
  const originItems = leadOrigins.map((o) => ({ value: o.slug, label: o.label }));
  if (isOriginField && data.value && !originItems.some((o) => o.value === data.value)) {
    originItems.unshift({ value: data.value, label: data.value });
  }

  // Etapa exata, por UUID. O campo legado `stage` guardava stage_key digitada
  // à mão e não distinguia etapas iguais em dois funis. Definitions antigas
  // continuam legíveis, mas a próxima escolha migra para `stage_id`.
  const { data: funnels = [] } = useFunisDaOrg();
  const { data: pipelineStages = [] } = useAllPipelineStages();
  const stageItems = pipelineStages
    .filter((stage) => stage.pipeline_id && (stage.is_active || stage.id === data.value))
    .map((stage) => ({
      value: stage.id,
      label: `${funnels.find((funnel) => funnel.id === stage.pipeline_id)?.label ?? "Funil removido"} · ${stage.name}`,
    }));
  const legacyStageValue = data.field === "stage" && data.value
    ? `__legacy_stage__:${data.value}`
    : "";
  const selectedStageValue = legacyStageValue || (data.field === "stage_id" ? data.value : "") || "";

  const handleFieldChange = (field: string) => {
    if (field === data.field || (field === "tags" && isTagField)) return;
    const updates: Partial<ConditionNodeData> = { field };
    // Catalogs have different value domains; compatible responsible roles share IDs.
    const simpleTextFields = new Set(["name", "company", "email", "phone"]);
    const sameDomain = (RESPONSIBLE_FIELDS.has(field) && isResponsibleField)
      || (UTM_VALUE_FIELDS.has(field) && isUtmField)
      || (simpleTextFields.has(field) && simpleTextFields.has(data.field || ""));
    if (!sameDomain) updates.value = "";
    const allowed = conditionOperators(field);
    if (!allowed.includes(data.operator)) updates.operator = defaultConditionOperator(field);
    onUpdate(updates);
  };

  const handleCustomFieldChange = (name: string) => {
    if (name === customFieldName) return;
    const field = `${CUSTOM_FIELD_PREFIX}${name}`;
    const type = customFields.find((item) => item.field_name === name)?.field_type;
    onUpdate({ field, value: "", ...(!conditionOperators(field, type).includes(data.operator)
      ? { operator: defaultConditionOperator(field, type) } : {}) });
  };

  const operatorEntries = [...validOperators, ...(legacyOperator ? [data.operator] : [])]
    .map((operator) => [operator, `${CONDITION_OPERATOR_LABELS[operator] ?? operator}${legacyOperator && operator === data.operator ? " (configuração antiga)" : ""}`]);

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
        <Label htmlFor={`${formId}-name`}>Nome</Label>
        <Input
          id={`${formId}-name`}
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
            <Label htmlFor={`${formId}-field`}>Campo</Label>
            <Select
              value={data.field?.startsWith("custom.") ? "custom" : isTagField ? "tags" : isStageField ? "stage_id" : data.field || ""}
              onValueChange={handleFieldChange}
            >
              <SelectTrigger id={`${formId}-field`}>
                <SelectValue placeholder="Selecione o campo" />
              </SelectTrigger>
              <SelectContent>
                {data.field && UNSUPPORTED_FIELDS[data.field] && (
                  <SelectItem value={data.field}>{UNSUPPORTED_FIELDS[data.field]} (não disponível)</SelectItem>
                )}
                {FIELD_OPTIONS.filter((option) => !UNSUPPORTED_FIELDS[option.value]).map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {data.field && UNSUPPORTED_FIELDS[data.field] && (
            <p role="alert" className="text-xs text-destructive">Este campo antigo não é calculado pelo executor. Escolha outro campo antes de ativar o fluxo.</p>
          )}
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
            <Label htmlFor={`${formId}-operator`}>Operador</Label>
            <Select
              value={data.operator || ""}
              onValueChange={(v) => onUpdate({ operator: v as ConditionOperator })}
            >
              <SelectTrigger id={`${formId}-operator`}>
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

          {legacyOperator && (
            <p className="text-xs text-amber-600 dark:text-amber-500">Operador salvo de uma configuração antiga. Escolha um operador compatível com este campo.</p>
          )}
          {needsValue && (
            <div className="space-y-2">
              <Label>{isTagField ? "Tag" : isStageField ? "Etapa" : isResponsibleField ? "Responsável" : data.field === "days_in_stage" ? "Quantidade de dias" : data.field === "deal_value" ? "Valor do negócio" : "Valor"}</Label>
              {fixedValues ? (
                <Select value={data.value || ""} onValueChange={(value) => onUpdate({ value })}>
                  <SelectTrigger aria-label="Valor da condição"><SelectValue placeholder="Selecione uma opção" /></SelectTrigger>
                  <SelectContent>
                    {fixedValues.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                    {fixedValues.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma opção cadastrada para este campo.</p>}
                  </SelectContent>
                </Select>
              ) : valueKind === "number" || valueKind === "date" ? (
                <Input
                  aria-label="Valor da condição"
                  type={valueKind === "date" ? "date" : "number"}
                  min={valueKind === "number" && !isCustomField ? 0 : undefined}
                  max={data.field === "score" ? 100 : undefined}
                  step={data.field === "score" || data.field === "days_in_stage" ? 1 : "any"}
                  value={data.value || ""}
                  onChange={(event) => onUpdate({ value: event.target.value })}
                  placeholder={data.field === "days_in_stage" ? "Quantidade de dias" : data.field === "score" ? "Pontuação de 0 a 100" : "Informe o valor"}
                />
              ) : OBSERVED_FIELDS.has(data.field || "") ? (
                <>
                  <ValueCombobox values={observedValues.values} isLoading={observedValues.isLoading}
                    value={data.value || ""} onChange={(value) => onUpdate({ value })}
                    placeholder="Selecione um valor da organização"
                    emptyMessage="Nenhum valor encontrado nos leads visíveis. Você pode informar um valor." />
                  {observedValues.isError && <p role="alert" className="text-xs text-destructive">Não foi possível carregar as sugestões.</p>}
                </>
              ) : isTagField ? (
                <>
                  <Select
                    value={data.value || ""}
                    disabled={tagsLoading || tagsError}
                    onValueChange={(value) => onUpdate({
                      field: "tags",
                      value,
                      operator: ["not_has_tag", "not_contains", "not_equals"].includes(data.operator)
                        ? "not_has_tag" : "has_tag",
                    })}
                  >
                    <SelectTrigger aria-label="Tag da organização">
                      <SelectValue placeholder={tagsLoading ? "Carregando tags…" : "Selecione uma tag"} />
                    </SelectTrigger>
                    <SelectContent>
                      {missingTag && <SelectItem value={data.value}>{data.value} (fora do catálogo)</SelectItem>}
                      {tagNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                      {!tagsLoading && tagNames.length === 0 && (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma tag cadastrada nesta organização.</p>
                      )}
                    </SelectContent>
                  </Select>
                  {tagsError && <p role="alert" className="text-xs text-destructive">Não foi possível carregar as tags. Tente novamente.</p>}
                  {missingTag && <p className="text-xs text-amber-600 dark:text-amber-500">Valor salvo fora do catálogo atual. Selecione uma tag para atualizar a condição.</p>}
                </>
              ) : isStageField ? (
                <Select
                  value={selectedStageValue}
                  onValueChange={(v) => onUpdate({ field: "stage_id", value: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a etapa exata" />
                  </SelectTrigger>
                  <SelectContent>
                    {legacyStageValue && (
                      <SelectItem value={legacyStageValue} disabled>
                        Configuração antiga: {data.value}. Selecione a etapa exata.
                      </SelectItem>
                    )}
                    {data.field === "stage_id" && data.value &&
                      !stageItems.some((stage) => stage.value === data.value) && (
                        <SelectItem value={data.value} disabled>
                          Etapa removida ({data.value})
                        </SelectItem>
                      )}
                    {stageItems.map((stage) => (
                      <SelectItem key={stage.value} value={stage.value}>
                        {stage.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : isResponsibleField ? (
                <Select
                  value={data.value || ""}
                  onValueChange={(v) => onUpdate({ value: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o responsavel" />
                  </SelectTrigger>
                  <SelectContent>
                    {data.value && !members.some((member) => member.id === data.value) && (
                      <SelectItem value={data.value} disabled>Responsável indisponível (configuração salva)</SelectItem>
                    )}
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
                  placeholder={data.field === "email" ? "Ex.: @empresa.com.br" : data.field === "phone" ? "Ex.: 5511" : "Digite o texto a comparar"}
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
                  role="button"
                  tabIndex={0}
                  aria-pressed={timeWindow.days.includes(d.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleDay(d.value); } }}
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
            <Label>Fuso horário</Label>
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
