/**
 * fields — generic typed-slot renderers for the Copilot v2 wizard (Slice 8).
 * Each FieldKind maps to a shadcn primitive. No free text except the escape-hatch.
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPath } from "./pathUtils";
import {
  ALLOWED_CAPABILITIES_BY_ARCHETYPE,
  CARTEIRA_SEGMENTS,
  ESCAPE_HATCH_MAX,
  type Archetype,
  type CapabilityFlag,
} from "../../lib/copilot-v2-config";
import type { FieldDef } from "./wizardSections";

const CAP_LABELS: Record<CapabilityFlag, string> = {
  can_move_stage: "Mover lead de estágio",
  can_schedule_meeting: "Agendar reunião",
  can_set_tier: "Registrar tier (rúbrica)",
  can_fill_field: "Preencher campo do lead",
  can_send_media: "Enviar mídia aprovada",
  can_transfer: "Transferir para humano",
  can_handoff: "Handoff para o Vendedor",
};

interface FieldProps {
  field: FieldDef;
  archetype: Archetype;
  config: Record<string, unknown>;
  onChange: (path: string, value: unknown) => void;
  linterError?: string | null;
}

export function FieldRenderer({ field, archetype, config, onChange, linterError }: FieldProps) {
  const value = getPath(config, field.path);

  switch (field.kind) {
    case "text":
      return (
        <Labeled label={field.label} hint={field.hint}>
          <Input
            value={(value as string) ?? ""}
            maxLength={field.maxLength}
            onChange={(e) => onChange(field.path, e.target.value)}
          />
        </Labeled>
      );

    case "textarea":
      return (
        <Labeled label={field.label} hint={field.hint}>
          <Textarea
            value={(value as string) ?? ""}
            maxLength={field.maxLength}
            rows={3}
            onChange={(e) => onChange(field.path, e.target.value)}
          />
        </Labeled>
      );

    case "chips":
      return (
        <Labeled label={field.label} hint={field.hint}>
          <ChipList items={(value as string[]) ?? []} maxLength={field.maxLength} onChange={(v) => onChange(field.path, v)} />
        </Labeled>
      );

    case "enum":
      return (
        <Labeled label={field.label} hint={field.hint}>
          <Select value={(value as string) ?? ""} onValueChange={(v) => onChange(field.path, v)}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione…" />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {field.optionLabels?.[opt] ?? opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Labeled>
      );

    case "capabilities": {
      const allowed = ALLOWED_CAPABILITIES_BY_ARCHETYPE[archetype];
      const flags = (field.flags ?? []).filter((f) => allowed.includes(f));
      const caps = (value as Record<string, boolean>) ?? {};
      if (flags.length === 0) return null;
      return (
        <div className="space-y-3">
          {flags.map((flag) => (
            <label key={flag} className="flex items-center justify-between gap-4 rounded-md border border-border/60 px-3 py-2">
              <span className="text-sm">{CAP_LABELS[flag]}</span>
              <Switch
                checked={caps[flag] === true}
                onCheckedChange={(checked) => onChange("capabilities", { ...caps, [flag]: checked })}
              />
            </label>
          ))}
        </div>
      );
    }

    case "segments": {
      const selected = new Set((value as string[]) ?? []);
      return (
        <Labeled label={field.label} hint={field.hint}>
          <div className="flex flex-wrap gap-2">
            {CARTEIRA_SEGMENTS.map((seg) => {
              const on = selected.has(seg);
              return (
                <button
                  key={seg}
                  type="button"
                  onClick={() => {
                    const next = new Set(selected);
                    if (on) next.delete(seg);
                    else next.add(seg);
                    onChange(field.path, [...next]);
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs capitalize transition-colors",
                    on ? "border-primary bg-primary/15 text-primary" : "border-border/60 text-muted-foreground",
                  )}
                >
                  {seg}
                </button>
              );
            })}
          </div>
        </Labeled>
      );
    }

    case "escape-hatch": {
      const text = (value as string) ?? "";
      return (
        <div className="space-y-2">
          <Textarea
            value={text}
            maxLength={ESCAPE_HATCH_MAX}
            rows={4}
            placeholder="Observações específicas do cliente. Único campo livre — subordinado às regras-base. PII/jailbreak/conflito são rejeitados."
            onChange={(e) => onChange(field.path, e.target.value)}
            aria-invalid={!!linterError}
            className={cn(linterError && "border-destructive")}
          />
          <div className="flex items-center justify-between text-xs">
            <span className={cn("text-destructive", !linterError && "invisible")}>{linterError}</span>
            <span className={cn("text-muted-foreground", text.length >= ESCAPE_HATCH_MAX - 20 && "text-amber-500")}>
              {text.length}/{ESCAPE_HATCH_MAX}
            </span>
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}

function Labeled({ label, hint, children }: { label?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      {label && <Label className="text-sm">{label}</Label>}
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ChipList({
  items,
  maxLength,
  onChange,
}: {
  items: string[];
  maxLength?: number;
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v) {
      onChange([...items, v]);
      setDraft("");
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          maxLength={maxLength}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Adicionar item + Enter"
        />
        <Button type="button" variant="secondary" onClick={add}>
          Add
        </Button>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item, i) => (
            <Badge key={`${item}-${i}`} variant="secondary" className="gap-1">
              {item}
              <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="remover">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
