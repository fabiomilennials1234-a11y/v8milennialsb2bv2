import { Plus, Trash2, Filter } from "lucide-react";
import { usePipelineDisplayConfig } from "@/modules/pipelines";
import { NOME_DE_FABRICA } from "@/contracts/pipe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface CriteriaRow {
  field: string;
  operator: string;
  value: string;
}

interface EnrollmentCriteriaData {
  enabled: boolean;
  match_all: boolean;
  conditions: CriteriaRow[];
}

interface EnrollmentCriteriaProps {
  value: EnrollmentCriteriaData;
  onChange: (value: EnrollmentCriteriaData) => void;
}

// SCRUM-641: os três campos de etapa são batizados pelo nome que a ORG dá ao
// funil (display_config) — ver `useLeadFields` abaixo. `null` marca onde o
// nome dinâmico entra.
const LEAD_FIELDS: { value: string; label: string | null; pipeType?: string }[] = [
  { value: "origin", label: "Origem" },
  { value: "rating", label: "Rating (1-5)" },
  { value: "qualification_score", label: "Score qualificacao" },
  { value: "company_name", label: "Empresa" },
  { value: "tags", label: "Tags (contem)" },
  { value: "responsible_id", label: "Responsavel" },
  { value: "pipe_whatsapp_stage", label: null, pipeType: "whatsapp" },
  { value: "pipe_confirmacao_stage", label: null, pipeType: "confirmacao" },
  { value: "pipe_propostas_stage", label: null, pipeType: "propostas" },
  { value: "created_days_ago", label: "Criado ha (dias)" },
  { value: "last_message_days", label: "Ultima msg ha (dias)" },
  { value: "custom_field", label: "Campo personalizado" },
];

/** LEAD_FIELDS com os nomes de funil resolvidos pela org. */
function useLeadFields(): { value: string; label: string }[] {
  const { data: displayConfigs } = usePipelineDisplayConfig();
  return LEAD_FIELDS.map((f) => {
    if (!f.pipeType) return { value: f.value, label: f.label ?? f.value };
    const c = displayConfigs?.find((x) => x.pipe_type === f.pipeType);
    const nome = c
      ? c.display_name || NOME_DE_FABRICA[f.pipeType] || f.pipeType
      : "Funil removido";
    return { value: f.value, label: `Etapa (${nome})` };
  });
}

const OPERATORS = [
  { value: "equals", label: "Igual a" },
  { value: "not_equals", label: "Diferente de" },
  { value: "contains", label: "Contem" },
  { value: "not_contains", label: "Nao contem" },
  { value: "greater_than", label: "Maior que" },
  { value: "less_than", label: "Menor que" },
  { value: "is_empty", label: "Vazio" },
  { value: "is_not_empty", label: "Preenchido" },
];

export const EMPTY_ENROLLMENT: EnrollmentCriteriaData = {
  enabled: false,
  match_all: true,
  conditions: [],
};

export function EnrollmentCriteria({ value, onChange }: EnrollmentCriteriaProps) {
  const leadFields = useLeadFields();
  function addCondition() {
    onChange({
      ...value,
      conditions: [
        ...value.conditions,
        { field: "origin", operator: "equals", value: "" },
      ],
    });
  }

  function removeCondition(index: number) {
    onChange({
      ...value,
      conditions: value.conditions.filter((_, i) => i !== index),
    });
  }

  function updateCondition(index: number, updates: Partial<CriteriaRow>) {
    onChange({
      ...value,
      conditions: value.conditions.map((c, i) =>
        i === index ? { ...c, ...updates } : c,
      ),
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">Criterios de inscricao automatica</CardTitle>
          </div>
          <Switch
            checked={value.enabled}
            onCheckedChange={(checked) => onChange({ ...value, enabled: checked })}
          />
        </div>
        <CardDescription className="text-xs">
          Leads que atendem os criterios serao automaticamente inscritos neste workflow
        </CardDescription>
      </CardHeader>

      {value.enabled && (
        <CardContent className="pt-0 space-y-4">
          {/* Match mode */}
          <div className="flex items-center gap-3">
            <Label className="text-xs text-muted-foreground">Combinar:</Label>
            <Select
              value={value.match_all ? "all" : "any"}
              onValueChange={(v) => onChange({ ...value, match_all: v === "all" })}
            >
              <SelectTrigger className="w-[200px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as condicoes (E)</SelectItem>
                <SelectItem value="any">Qualquer condicao (OU)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Conditions */}
          <div className="space-y-2">
            {value.conditions.map((c, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Select
                  value={c.field}
                  onValueChange={(v) => updateCondition(i, { field: v })}
                >
                  <SelectTrigger className="w-[160px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {leadFields.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={c.operator}
                  onValueChange={(v) => updateCondition(i, { operator: v })}
                >
                  <SelectTrigger className="w-[130px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPERATORS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {!["is_empty", "is_not_empty"].includes(c.operator) && (
                  <Input
                    value={c.value}
                    onChange={(e) => updateCondition(i, { value: e.target.value })}
                    className="h-8 text-xs flex-1"
                    placeholder="Valor"
                  />
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => removeCondition(i)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <Button variant="outline" size="sm" onClick={addCondition} className="text-xs">
            <Plus className="mr-1 h-3 w-3" /> Adicionar condicao
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
