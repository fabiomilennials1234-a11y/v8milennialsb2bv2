import { useMemo, useState } from "react";
import { Check, ChevronDown, Filter, Tag as TagIcon, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { QUALIFICATION_TIERS, QUALIFICATION_TIER_CONFIG } from "@/modules/leads";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Audience CONDITIONS for the Disparo wizard (Phase 2a) — four multi-select
 * narrowers layered on top of whichever source the operator chose (stage /
 * filtro / segmento). They map 1:1 onto the Phase-1 resolver params
 * (`tagIds` / `qualificationTier` / `preQualificationTier` / `origin`) and
 * apply to EVERY source except a hand-picked Manual set.
 *
 * Presented as one calm collapsible "Condições" group (Linear settings rows):
 * a header that summarizes how many conditions are active, then four rows each
 * with a label + a chip-popover. Empty = "todas/todos" (no narrowing), exactly
 * as the resolvers treat an empty list server-side.
 */

export interface AudienceConditions {
  tagIds: string[];
  qualificationTier: string[];
  preQualificationTier: string[];
  origin: string[];
}

export const EMPTY_CONDITIONS: AudienceConditions = {
  tagIds: [],
  qualificationTier: [],
  preQualificationTier: [],
  origin: [],
};

/**
 * Qualification / pre-qualification tiers — derived from the canonical tier
 * config in the leads module (single source of value set + labels). Same
 * `{ value, label }` shape/order as before, so every TIER_OPTIONS consumer
 * (DisparoWizard, campaigns) is unaffected.
 */
export const TIER_OPTIONS: { value: string; label: string }[] =
  QUALIFICATION_TIERS.map((tier) => ({
    value: tier,
    label: QUALIFICATION_TIER_CONFIG[tier].label,
  }));

/** Lead origins — friendly pt-BR labels for the raw `leads.origin` enum. */
export const ORIGIN_OPTIONS: { value: string; label: string }[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "meta_ads", label: "Meta Ads" },
  { value: "site", label: "Site" },
  { value: "remarketing", label: "Remarketing" },
  { value: "google_ads", label: "Google Ads" },
  { value: "cal", label: "Cal.com" },
  { value: "instagram", label: "Instagram" },
  { value: "messenger", label: "Messenger" },
  { value: "tiktok", label: "TikTok" },
  { value: "indicacao", label: "Indicação" },
  { value: "evento", label: "Evento" },
  { value: "prospeccao_ativa", label: "Prospecção ativa" },
  { value: "landing_page", label: "Landing page" },
  { value: "web", label: "Web" },
  { value: "outro", label: "Outro" },
];

interface AudienceConditionsControlsProps {
  value: AudienceConditions;
  onChange: (next: AudienceConditions) => void;
  /** Org tag dictionary — drives the Tags selector. */
  tags: { id: string; name: string; color?: string | null }[];
  disabled?: boolean;
}

export function AudienceConditionsControls({
  value,
  onChange,
  tags,
  disabled,
}: AudienceConditionsControlsProps) {
  // Open the group automatically once any condition is set, so the operator
  // never loses sight of an active narrower behind a collapsed header.
  const activeCount =
    value.tagIds.length +
    value.qualificationTier.length +
    value.preQualificationTier.length +
    value.origin.length;
  const [open, setOpen] = useState(activeCount > 0);

  const tagOptions = useMemo(
    () => tags.map((t) => ({ value: t.id, label: t.name, color: t.color ?? undefined })),
    [tags],
  );

  return (
    <div className="overflow-hidden rounded-lg border border-border/70">
      {/* Header — toggles the group, summarizes active conditions */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          open ? "bg-muted/30" : "hover:bg-muted/20",
        )}
      >
        <Filter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium leading-none">Condições</span>
        {activeCount > 0 && (
          <span className="rounded-full border border-primary/30 bg-primary/[0.08] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
            {activeCount}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {!open && activeCount === 0 && (
            <span className="text-[11px] text-muted-foreground">Refinar por tag, qualificação, origem</span>
          )}
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </span>
      </button>

      {open && (
        <div className="divide-y divide-border/50 border-t border-border/60">
          <ConditionRow
            label="Tags"
            placeholder="Qualquer tag"
            icon={<TagIcon className="h-3.5 w-3.5 text-muted-foreground" />}
            options={tagOptions}
            selected={value.tagIds}
            onSelected={(next) => onChange({ ...value, tagIds: next })}
            disabled={disabled}
            emptyHint="Nenhuma tag na organização"
            searchPlaceholder="Buscar tag…"
          />
          <ConditionRow
            label="Qualificação"
            placeholder="Todas"
            options={TIER_OPTIONS}
            selected={value.qualificationTier}
            onSelected={(next) => onChange({ ...value, qualificationTier: next })}
            disabled={disabled}
          />
          <ConditionRow
            label="Pré-qualificação"
            placeholder="Todas"
            options={TIER_OPTIONS}
            selected={value.preQualificationTier}
            onSelected={(next) => onChange({ ...value, preQualificationTier: next })}
            disabled={disabled}
          />
          <ConditionRow
            label="Origem"
            placeholder="Todas"
            options={ORIGIN_OPTIONS}
            selected={value.origin}
            onSelected={(next) => onChange({ ...value, origin: next })}
            disabled={disabled}
            searchPlaceholder="Buscar origem…"
          />
        </div>
      )}
    </div>
  );
}

interface ConditionOption {
  value: string;
  label: string;
  color?: string;
}

/** One settings row: label on the left, a multi-select chip-popover on the right. */
function ConditionRow({
  label,
  placeholder,
  icon,
  options,
  selected,
  onSelected,
  disabled,
  emptyHint,
  searchPlaceholder,
}: {
  label: string;
  placeholder: string;
  icon?: React.ReactNode;
  options: ConditionOption[];
  selected: string[];
  onSelected: (next: string[]) => void;
  disabled?: boolean;
  emptyHint?: string;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);

  const selectedOptions = useMemo(
    () => selected.map((v) => options.find((o) => o.value === v)).filter(Boolean) as ConditionOption[],
    [selected, options],
  );

  function toggle(v: string) {
    onSelected(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }

  const noOptions = options.length === 0;

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="text-sm leading-none text-foreground">{label}</span>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled || noOptions}
            className={cn(
              "flex min-w-[9rem] max-w-[15rem] items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              "disabled:pointer-events-none disabled:opacity-50",
              selected.length > 0
                ? "border-primary/40 bg-primary/[0.05]"
                : "border-border bg-background hover:border-border/80",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-[12px]">
              {selected.length === 0 ? (
                <span className="text-muted-foreground">{noOptions ? emptyHint ?? placeholder : placeholder}</span>
              ) : selected.length <= 2 ? (
                <span className="text-foreground">
                  {selectedOptions.map((o) => o.label).join(", ")}
                </span>
              ) : (
                <span className="text-foreground">
                  {selectedOptions[0]?.label} +{selected.length - 1}
                </span>
              )}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60 p-0">
          <Command>
            {(searchPlaceholder || options.length > 6) && (
              <CommandInput placeholder={searchPlaceholder ?? "Buscar…"} className="h-9" />
            )}
            <CommandList>
              <CommandEmpty>Nada encontrado.</CommandEmpty>
              <CommandGroup>
                {options.map((o) => {
                  const isSelected = selected.includes(o.value);
                  return (
                    <CommandItem
                      key={o.value}
                      value={o.label}
                      onSelect={() => toggle(o.value)}
                      className="gap-2"
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border",
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                      {o.color && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: o.color }}
                        />
                      )}
                      <span className="flex-1 truncate">{o.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
          {selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 border-t border-border/60 p-2">
              {selectedOptions.map((o) => (
                <Badge
                  key={o.value}
                  variant="secondary"
                  className="gap-1 py-0.5 pl-2 pr-1 text-[11px] font-normal"
                >
                  {o.label}
                  <button
                    type="button"
                    onClick={() => toggle(o.value)}
                    className="rounded-sm text-muted-foreground hover:text-foreground"
                    aria-label={`Remover ${o.label}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
