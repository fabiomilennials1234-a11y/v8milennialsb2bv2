/**
 * Follow-up Situations config (ADR-0006).
 *
 * Per-Organization control surface: the seven Torque-curated Situations grouped
 * by Archetype. Each is a switch + a few basics. Which stages trigger each
 * Situation is decided by the AI Stage Classifier — surfaced read-only here.
 *
 * Design: dark-first, gold accent for the live state, Linear-style dense rows,
 * no emoji. The cadence and copy ship ready — the Org only flips and tunes.
 */

import { useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Loader2, ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  useFollowupSituationConfig,
  useUpsertFollowupSituationConfig,
  type FollowupSituationConfig,
  type SituationId,
} from "@/modules/copilot/hooks/useFollowupSituationConfig";

type Archetype = "Qualificador" | "Vendedor" | "Carteira";

interface SituationMeta {
  id: SituationId;
  label: string;
  description: string;
  archetype: Archetype;
}

const SITUATIONS: SituationMeta[] = [
  { id: "new_lead_no_reply", label: "Lead novo sem resposta", description: "Abordamos um lead novo e ele nunca respondeu.", archetype: "Qualificador" },
  { id: "qualified_no_meeting", label: "Qualificou, não agendou", description: "Lead qualificado que ainda não marcou a conversa.", archetype: "Qualificador" },
  { id: "cold_reengage", label: "Re-engajamento frio", description: "Conversou, esfriou e ficou parado na nutrição.", archetype: "Qualificador" },
  { id: "meeting_reminder", label: "Lembrete de reunião", description: "Lembra da reunião marcada. Só lembra, não confirma.", archetype: "Vendedor" },
  { id: "no_show_rebook", label: "Não compareceu, remarcar", description: "Faltou na reunião e pode reagendar.", archetype: "Vendedor" },
  { id: "proposal_no_reply", label: "Proposta sem resposta", description: "Proposta enviada e o lead sumiu.", archetype: "Vendedor" },
  { id: "dormant_winback", label: "Cliente dormindo, win-back", description: "Cliente da carteira que parou de comprar.", archetype: "Carteira" },
];

const ARCHETYPES: Archetype[] = ["Qualificador", "Vendedor", "Carteira"];

function BasicField({
  label,
  suffix,
  value,
  placeholder,
  min,
  max,
  onCommit,
}: {
  label: string;
  suffix: string;
  value: number | null;
  placeholder?: string;
  min?: number;
  max?: number;
  onCommit: (v: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground mb-1.5">
        {label}
      </span>
      <span className="relative block">
        <Input
          type="number"
          min={min}
          max={max}
          defaultValue={value ?? undefined}
          placeholder={placeholder}
          onBlur={(e) => onCommit(e.target.value === "" ? null : parseInt(e.target.value, 10))}
          className="h-9 bg-background/60 pr-9 text-sm tabular-nums"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground/70">
          {suffix}
        </span>
      </span>
    </label>
  );
}

function SituationRow({
  meta,
  config,
  organizationId,
}: {
  meta: SituationMeta;
  config: FollowupSituationConfig | undefined;
  organizationId?: string;
}) {
  const upsert = useUpsertFollowupSituationConfig(organizationId);
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);

  const isActive = config?.is_active ?? false;
  const classified = (config?.trigger_stage_keys?.length ?? 0) > 0;
  const patch = (p: Parameters<typeof upsert.mutate>[0]) => upsert.mutate(p);

  return (
    <div className={cn("border-l-2 transition-colors", isActive ? "border-l-primary" : "border-l-transparent")}>
      <div className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-muted/40">
        <Switch
          checked={isActive}
          onCheckedChange={(c) => patch({ situationId: meta.id, is_active: c })}
          aria-label={`Ativar ${meta.label}`}
        />

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left"
        >
          <span className="min-w-0">
            <span className={cn("block truncate text-sm font-medium", isActive ? "text-foreground" : "text-muted-foreground")}>
              {meta.label}
            </span>
            <span className="block truncate text-xs text-muted-foreground/70">{meta.description}</span>
          </span>

          <span className="flex shrink-0 items-center gap-3">
            {isActive && (
              <span className="hidden items-center gap-1.5 sm:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]" />
                <span className="text-xs text-primary/80">Ativa</span>
              </span>
            )}
            {isActive && !classified && (
              <span className="text-[11px] text-amber-400/90">aguardando classificação da IA</span>
            )}
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
          </span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/60 bg-muted/20 px-4 py-4 pl-[4.5rem]">
              <div className="grid max-w-md grid-cols-3 gap-4">
                <BasicField
                  label="Espera"
                  suffix="h"
                  min={0}
                  value={config?.delay_hours ?? 24}
                  onCommit={(v) => patch({ situationId: meta.id, delay_hours: v ?? 0 })}
                />
                <BasicField
                  label="Toques"
                  suffix=""
                  min={1}
                  max={6}
                  placeholder="padrão"
                  value={config?.touch_count ?? null}
                  onCommit={(v) => patch({ situationId: meta.id, touch_count: v })}
                />
                <BasicField
                  label="Intervalo"
                  suffix="h"
                  min={1}
                  placeholder="padrão"
                  value={config?.spacing_hours ?? null}
                  onCommit={(v) => patch({ situationId: meta.id, spacing_hours: v })}
                />
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/70">
                As etapas que disparam esta situação são definidas automaticamente pela IA a partir do seu funil. Cadência e mensagens já vêm prontas.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function FollowupSituationsTab({ organizationId }: { organizationId?: string } = {}) {
  const { data: configs = [], isLoading } = useFollowupSituationConfig(organizationId);

  const byId = useMemo(() => {
    const m = new Map<SituationId, FollowupSituationConfig>();
    for (const c of configs) m.set(c.situation_id, c);
    return m;
  }, [configs]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando situações...
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header className="max-w-xl">
        <h2 className="text-xl font-semibold tracking-tight">Follow-up automático</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Escolha em quais situações a IA deve reativar leads que esfriaram. A cadência e as
          mensagens já vêm prontas. Você liga, desliga e ajusta o ritmo.
        </p>
      </header>

      {ARCHETYPES.map((arch) => {
        const items = SITUATIONS.filter((s) => s.archetype === arch);
        const activeCount = items.filter((s) => byId.get(s.id)?.is_active).length;
        return (
          <section key={arch} className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-primary/70">{arch}</span>
              <span className="h-px flex-1 bg-border/60" />
              <span className="text-xs tabular-nums text-muted-foreground">
                {activeCount} de {items.length} ativas
              </span>
            </div>
            <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card/40">
              {items.map((meta) => (
                <SituationRow key={meta.id} meta={meta} config={byId.get(meta.id)} organizationId={organizationId} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
