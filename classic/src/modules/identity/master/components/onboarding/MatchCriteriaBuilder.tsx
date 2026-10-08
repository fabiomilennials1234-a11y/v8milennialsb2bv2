import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const KNOWN_FIELDS = [
  "perfil.sells",
  "perfil.segment",
  "estrutura.has_sdr",
  "estrutura.has_closer",
  "estrutura.team_size",
  "processo.schedules_meeting",
  "processo.uses_proposal",
];

interface Props {
  value: Record<string, string[]>;
  onChange: (v: Record<string, string[]>) => void;
}

export function MatchCriteriaBuilder({ value, onChange }: Props) {
  const [newField, setNewField] = useState("");

  const fields = Object.keys(value);

  const addField = (field: string) => {
    if (!field.trim() || value[field]) return;
    onChange({ ...value, [field]: [] });
    setNewField("");
  };

  const addValueToField = (field: string, val: string) => {
    if (!val.trim()) return;
    const existing = value[field] ?? [];
    if (existing.includes(val)) return;
    onChange({ ...value, [field]: [...existing, val] });
  };

  const removeValue = (field: string, val: string) => {
    const updated = (value[field] ?? []).filter((v) => v !== val);
    if (updated.length === 0) {
      const copy = { ...value };
      delete copy[field];
      onChange(copy);
    } else {
      onChange({ ...value, [field]: updated });
    }
  };

  const removeField = (field: string) => {
    const copy = { ...value };
    delete copy[field];
    onChange(copy);
  };

  const unusedFields = KNOWN_FIELDS.filter((f) => !value[f]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        AND entre campos, OR dentro dos valores. Dot notation para paths JSONB.
      </p>

      {fields.map((field) => (
        <div key={field} className="p-2.5 rounded-lg border border-border/40 space-y-2">
          <div className="flex items-center justify-between">
            <code className="text-xs font-mono text-amber-500">{field}</code>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeField(field)}>
              <X className="w-3 h-3" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {(value[field] ?? []).map((v) => (
              <Badge key={v} variant="secondary" className="text-[10px] gap-1 pr-1">
                {v}
                <button onClick={() => removeValue(field, v)} className="hover:text-destructive">
                  <X className="w-2.5 h-2.5" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-1">
            <Input
              placeholder="Novo valor..."
              className="h-7 text-xs flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addValueToField(field, e.currentTarget.value);
                  e.currentTarget.value = "";
                }
              }}
            />
          </div>
        </div>
      ))}

      <div className="flex gap-2">
        <Input
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
          placeholder="Campo (ex: perfil.sells)"
          className="h-8 text-xs flex-1"
          list="known-fields"
          onKeyDown={(e) => {
            if (e.key === "Enter") addField(newField);
          }}
        />
        <Button variant="outline" size="sm" className="h-8" onClick={() => addField(newField)}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Campo
        </Button>
      </div>

      {unusedFields.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {unusedFields.map((f) => (
            <button
              key={f}
              onClick={() => addField(f)}
              className="text-[10px] px-2 py-0.5 rounded-full border border-border/40 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            >
              + {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
