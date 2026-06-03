/**
 * RubricForm — Qualificador Section 4 (Slice 8). One row per tier (diamante →
 * bronze); 'desqualificado' is the implicit fallback and not editable. Each row
 * sets the optional TierRule floors. Region is a captured signal but NOT a
 * threshold (the engine has no minRegiao), so it is intentionally absent here.
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RUBRIC_TIERS, RUBRIC_LEVELS, type RubricRule } from "../../lib/copilot-v2-config";

const NONE = "__none";

export function RubricForm({ rules, onChange }: { rules: RubricRule[]; onChange: (r: RubricRule[]) => void }) {
  const byTier = (tier: string) => rules.find((r) => r.tier === tier);

  const update = (tier: (typeof RUBRIC_TIERS)[number], patch: Partial<RubricRule>) => {
    const existing = byTier(tier);
    const merged: RubricRule = { ...(existing ?? { tier }), ...patch, tier };
    // strip undefined keys so an empty floor means "criterion ignored"
    (Object.keys(merged) as (keyof RubricRule)[]).forEach((k) => merged[k] === undefined && delete merged[k]);
    const others = rules.filter((r) => r.tier !== tier);
    const hasContent = Object.keys(merged).length > 1; // more than just `tier`
    onChange(hasContent ? [...others, merged] : others);
  };

  const num = (v: string): number | undefined => {
    if (v.trim() === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Defina os PISOS (≥) de cada tier. Campo vazio = critério ignorado. O agente extrai os sinais; este código decide o
        tier. Preencha ao menos o <span className="font-medium">bronze</span>, senão todo lead vira “desqualificado”.
      </p>
      {RUBRIC_TIERS.map((tier) => {
        const r = byTier(tier);
        return (
          <div key={tier} className="rounded-lg border border-border/60 p-3 space-y-3">
            <div className="text-sm font-medium capitalize text-primary">{tier}</div>
            <div className="grid grid-cols-2 gap-3">
              <Labeled label="Faturamento mín. (R$/mês)">
                <Input
                  type="number"
                  min={0}
                  step={1000}
                  value={r?.minFaturamento ?? ""}
                  onChange={(e) => update(tier, { minFaturamento: num(e.target.value) })}
                />
              </Labeled>
              <Labeled label="Volume mín.">
                <Input
                  type="number"
                  min={0}
                  value={r?.minVolume ?? ""}
                  onChange={(e) => update(tier, { minVolume: num(e.target.value) })}
                />
              </Labeled>
              <LevelSelect label="Recorrência mín." value={r?.minRecorrencia} onChange={(v) => update(tier, { minRecorrencia: v })} />
              <LevelSelect label="Urgência mín." value={r?.minUrgencia} onChange={(v) => update(tier, { minUrgencia: v })} />
            </div>
            <label className="flex items-center justify-between gap-4">
              <span className="text-sm">Exige encaixe no ICP</span>
              <Switch checked={r?.requiresIcp === true} onCheckedChange={(c) => update(tier, { requiresIcp: c || undefined })} />
            </label>
          </div>
        );
      })}
    </div>
  );
}

function LevelSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: (typeof RUBRIC_LEVELS)[number];
  onChange: (v: (typeof RUBRIC_LEVELS)[number] | undefined) => void;
}) {
  return (
    <Labeled label={label}>
      <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? undefined : (v as (typeof RUBRIC_LEVELS)[number]))}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>—</SelectItem>
          {RUBRIC_LEVELS.map((lvl) => (
            <SelectItem key={lvl} value={lvl} className="capitalize">
              {lvl}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Labeled>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
