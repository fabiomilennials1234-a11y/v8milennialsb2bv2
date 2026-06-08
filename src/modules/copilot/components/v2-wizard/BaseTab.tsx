/**
 * BaseTab — Copilot v2 "Base (de fábrica)" tab (redesign 2026-06-08).
 *
 * READ-ONLY surface that transmits SOLIDEZ, never "disabled". It shows the
 * factory core the operator gets for free: a Torque-verified seal, the ONE
 * editable thing on this tab (tone, as selectable cards with a micro-example),
 * the archetype's capabilities as informative chips (NOT switches), and the
 * guarantees accordion distilled from BASE_NARRATIVE. The "O que ele nunca faz"
 * section is a TRUST seal — rendered with a GREEN ShieldCheck, never a red warning.
 */

import {
  ShieldCheck,
  Check,
  CalendarClock,
  ArrowRightLeft,
  ListChecks,
  Image,
  Tag,
  UserCog,
  Send,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ALLOWED_CAPABILITIES_BY_ARCHETYPE,
  TONE_OPTIONS,
  type Archetype,
  type CapabilityFlag,
} from "../../lib/copilot-v2-config";
import {
  BASE_NARRATIVE,
  NARRATIVE_SECTION_ORDER,
  CAP_LABELS,
  TONE_MICRO_EXAMPLE,
} from "../../lib/copilot-v2-base-narrative";

const CAP_ICON: Record<CapabilityFlag, typeof Send> = {
  can_move_stage: ListChecks,
  can_schedule_meeting: CalendarClock,
  can_set_tier: Tag,
  can_fill_field: UserCog,
  can_send_media: Image,
  can_transfer: ArrowRightLeft,
  can_handoff: Send,
};

export interface BaseTabProps {
  archetype: Archetype;
  tone: string | undefined;
  onToneChange: (tone: string) => void;
}

export function BaseTab({ archetype, tone, onToneChange }: BaseTabProps) {
  const narrative = BASE_NARRATIVE[archetype];
  const tones = TONE_OPTIONS[archetype];
  const caps = ALLOWED_CAPABILITIES_BY_ARCHETYPE[archetype];

  return (
    <div className="space-y-6">
      {/* Header + Torque-verified seal */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">Núcleo de fábrica do {narrative.label}</h3>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            Verificado pela Torque
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Este comportamento é garantido e não muda. Você ajusta só o tom de voz.
        </p>
      </div>

      {/* Tom de voz — the ONLY editable thing on the Base tab */}
      <section className="space-y-3">
        <Label className="text-sm">Tom de voz</Label>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {tones.map((opt) => {
            const on = tone === opt;
            const example = TONE_MICRO_EXAMPLE[opt];
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={on}
                onClick={() => onToneChange(opt)}
                className={cn(
                  "flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors",
                  on ? "border-primary bg-primary/[0.08]" : "border-border/60 hover:border-primary/40",
                )}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  {opt}
                  {on && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </span>
                {example && <span className="text-xs text-muted-foreground">{example}</span>}
              </button>
            );
          })}
        </div>
      </section>

      {/* Capability strip — informative read-only chips (NOT switches) */}
      <section className="space-y-3">
        <Label className="text-sm">O que ele já sabe fazer</Label>
        <TooltipProvider delayDuration={150}>
          <div className="flex flex-wrap gap-2">
            {caps.map((flag) => {
              const Icon = CAP_ICON[flag];
              return (
                <Tooltip key={flag}>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-default items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      {CAP_LABELS[flag]}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>habilitado por padrão para este arquétipo</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      </section>

      {/* Garantias accordion — first item open; "nunca faz" is a green trust seal */}
      <section className="space-y-3">
        <Label className="text-sm">Garantias</Label>
        <Accordion type="single" collapsible defaultValue={NARRATIVE_SECTION_ORDER[0].key}>
          {NARRATIVE_SECTION_ORDER.map(({ key, isTrustSeal }) => {
            const sec = narrative[key];
            return (
              <AccordionItem key={key} value={key} className="border-border/60">
                <AccordionTrigger className="text-sm hover:no-underline">
                  <span className="flex items-center gap-2">
                    {isTrustSeal && <ShieldCheck className="h-4 w-4 text-success" />}
                    {sec.title}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <ul className="space-y-1.5">
                    {sec.points.map((p, i) => (
                      <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                        {isTrustSeal ? (
                          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                        ) : (
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
                        )}
                        {p}
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </section>

      <Card className="border-border/40 bg-muted/20">
        <CardContent className="flex items-start gap-2 py-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          O núcleo acima é mantido pela Torque e revisado contra ataques. Você nunca o edita — só preenche as
          especificidades da sua empresa na aba ao lado.
        </CardContent>
      </Card>
    </div>
  );
}
