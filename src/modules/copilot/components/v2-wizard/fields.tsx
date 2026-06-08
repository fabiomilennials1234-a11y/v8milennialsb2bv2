/**
 * fields — typed-slot renderers for the Copilot v2 ESPECIFICIDADES tab (redesign
 * 2026-06-08). Each FieldKind maps to a shadcn primitive. No free text except the
 * escape-hatch. Tone + capabilities are NOT here anymore — they live on the BASE
 * tab (BaseTab.tsx). Required labels carry a GOLD `*` (not red); validation is
 * on-blur and mirrors missingHardForActivation().
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPath } from "./pathUtils";
import {
  CARTEIRA_SEGMENTS,
  ESCAPE_HATCH_MAX,
  type Archetype,
} from "../../lib/copilot-v2-config";
import type { FieldDef } from "./wizardSections";

interface FieldProps {
  field: FieldDef;
  archetype: Archetype;
  config: Record<string, unknown>;
  onChange: (path: string, value: unknown) => void;
  /** Set of hard-required paths still missing (drives on-blur inline errors). */
  missingPaths?: Set<string>;
  linterError?: string | null;
}

export function FieldRenderer({ field, archetype, config, onChange, missingPaths, linterError }: FieldProps) {
  const value = getPath(config, field.path);
  const [touched, setTouched] = useState(false);
  const showError = touched && field.required === true && missingPaths?.has(field.path) === true;
  const errorMsg = showError ? "Campo obrigatório para ativar." : null;

  const labeled = (children: React.ReactNode) => (
    <Labeled
      label={field.label}
      hint={field.hint}
      required={field.required}
      archetypeChip={field.archetypeChip}
      error={errorMsg}
    >
      {children}
    </Labeled>
  );

  switch (field.kind) {
    case "text":
      return labeled(
        <Input
          value={(value as string) ?? ""}
          maxLength={field.maxLength}
          aria-invalid={showError}
          className={cn(showError && "border-destructive")}
          onBlur={() => setTouched(true)}
          onChange={(e) => onChange(field.path, e.target.value)}
        />,
      );

    case "textarea":
      return labeled(
        <Textarea
          value={(value as string) ?? ""}
          maxLength={field.maxLength}
          rows={field.rows ?? 3}
          aria-invalid={showError}
          className={cn(showError && "border-destructive")}
          onBlur={() => setTouched(true)}
          onChange={(e) => onChange(field.path, e.target.value)}
        />,
      );

    case "particularities": {
      const text = (value as string) ?? "";
      return labeled(
        <div className="space-y-1">
          <Textarea
            value={text}
            maxLength={field.maxLength ?? 1000}
            rows={field.rows ?? 5}
            placeholder="Ex.: Atendemos a Grande SP · entrega em 48h · faturado a prazo para CNPJ · forte em obras hidráulicas"
            onChange={(e) => onChange(field.path, e.target.value)}
          />
          <div className="text-right text-xs text-muted-foreground">
            {text.length}/{field.maxLength ?? 1000}
          </div>
        </div>,
      );
    }

    case "chips":
      return labeled(
        <ChipList
          items={(value as string[]) ?? []}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          invalid={showError}
          onBlur={() => setTouched(true)}
          onChange={(v) => onChange(field.path, v)}
        />,
      );

    case "enum":
      return labeled(
        <Select value={(value as string) ?? ""} onValueChange={(v) => { onChange(field.path, v); setTouched(true); }}>
          <SelectTrigger aria-invalid={showError} className={cn(showError && "border-destructive")}>
            <SelectValue placeholder="Selecione…" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {field.optionLabels?.[opt] ?? opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>,
      );

    case "objective-cards": {
      const selected = (value as string) ?? "";
      return labeled(
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(field.options ?? []).map((opt) => {
            const on = selected === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(field.path, opt); setTouched(true); }}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  on ? "border-primary bg-primary/[0.08] text-foreground" : "border-border/60 hover:border-primary/40",
                )}
              >
                <span>{field.optionLabels?.[opt] ?? opt}</span>
                {on && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>,
      );
    }

    case "segments": {
      const selected = new Set((value as string[]) ?? []);
      return labeled(
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
        </div>,
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

function Labeled({
  label,
  hint,
  required,
  archetypeChip,
  error,
  children,
}: {
  label?: string;
  hint?: string;
  required?: boolean;
  archetypeChip?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {(label || archetypeChip) && (
        <div className="flex items-center gap-2">
          {label && (
            <Label className="text-sm">
              {label}
              {required && <span className="ml-0.5 text-primary">*</span>}
            </Label>
          )}
          {archetypeChip && (
            <span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {archetypeChip}
            </span>
          )}
        </div>
      )}
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function ChipList({
  items,
  maxLength,
  placeholder,
  invalid,
  onBlur,
  onChange,
}: {
  items: string[];
  maxLength?: number;
  placeholder?: string;
  invalid?: boolean;
  onBlur?: () => void;
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
          aria-invalid={invalid}
          className={cn(invalid && "border-destructive")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { add(); onBlur?.(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder ?? "Adicionar item + Enter"}
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
