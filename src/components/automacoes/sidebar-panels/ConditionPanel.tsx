import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CONDITION_OPERATOR_LABELS } from "@/types/workflow";
import type { ConditionNodeData, ConditionOperator } from "@/types/workflow";

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
  { value: "rating", label: "Rating" },
  { value: "faturamento", label: "Faturamento" },
  { value: "segment", label: "Segmento" },
  { value: "urgency", label: "Urgência" },
  { value: "score", label: "Score" },
  { value: "tag", label: "Tag" },
  { value: "stage", label: "Estágio" },
  { value: "sdr_id", label: "SDR" },
  { value: "closer_id", label: "Closer" },
  { value: "last_message", label: "Última mensagem" },
  { value: "message_count", label: "Qtd. mensagens" },
  { value: "days_since_contact", label: "Dias sem contato" },
  { value: "custom", label: "Campo customizado" },
];

// Operadores que não precisam de valor
const NO_VALUE_OPERATORS: ConditionOperator[] = ["is_empty", "is_not_empty"];

export function ConditionPanel({ data, onUpdate }: ConditionPanelProps) {
  const needsValue = !NO_VALUE_OPERATORS.includes(data.operator);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Ex: Score maior que 50?"
        />
      </div>

      <div className="space-y-2">
        <Label>Campo</Label>
        <Select
          value={data.field || ""}
          onValueChange={(v) => onUpdate({ field: v })}
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

      {data.field === "custom" && (
        <div className="space-y-2">
          <Label>Nome do campo customizado</Label>
          <Input
            value={data.field === "custom" ? (data as any).customFieldName || "" : ""}
            onChange={(e) =>
              onUpdate({ field: `custom.${e.target.value}` } as any)
            }
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
            {Object.entries(CONDITION_OPERATOR_LABELS).map(([key, label]) => (
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
          <Input
            value={data.value || ""}
            onChange={(e) => onUpdate({ value: e.target.value })}
            placeholder="Ex: 50"
          />
        </div>
      )}
    </div>
  );
}
