import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import logo from "@/assets/torque-logo.png";
import type { CheckoutLink } from "../../lib/checkout-api";
import { COPY, cycleText, formatLongDate, formatMoney, recurrenceText } from "./checkout-copy";

/** Valor grande com o "R$" menor; o `aria-label` é o que o leitor de tela lê inteiro. */
function BigAmount({ cents }: { cents: number }) {
  const full = formatMoney(cents);
  const [symbol, ...rest] = full.split(/\s/);
  return (
    <p
      aria-label={full}
      className="text-[clamp(2.5rem,9vw,3.5rem)] font-extrabold leading-none tracking-[-0.045em] tabular-nums"
    >
      <span aria-hidden className="mr-1.5 align-[.42em] text-[.5em] font-bold tracking-normal">{symbol}</span>
      <span aria-hidden>{rest.join(" ")}</span>
    </p>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-t border-border py-2.5 first:border-t-0 first:pt-0">
      <dt className={cn("text-sm", strong ? "font-semibold text-foreground" : "text-muted-foreground")}>{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

/** Composição só aparece se fechar. Override maior que o preço (#1559) não fecha. */
function compositionCloses(t: CheckoutLink["totals"]): boolean {
  if (t.subtotal_cents === null || t.monthly_cents === null) return false;
  return (
    t.subtotal_cents - (t.cycle_discount_cents ?? 0) - (t.coupon_discount_cents ?? 0) - (t.manual_discount_cents ?? 0) ===
    t.monthly_cents
  );
}

function Timeline({ link, paid }: { link: CheckoutLink; paid: boolean }) {
  const amount = formatMoney(link.amount_cents);
  const nextDate = formatLongDate(link.next_charge_preview_at) ?? COPY.summary.onRenewal;
  const recurrence = recurrenceText(link.plan.billing_cycle);
  return (
    <ol className="grid grid-cols-[12px_1fr_auto] gap-x-3 text-sm" aria-label="Quando a cobrança acontece">
      <li className="contents">
        <span aria-hidden className="flex h-5 items-center justify-center">
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full ring-2 transition-colors duration-[400ms] ease-out-expo motion-reduce:transition-none",
              paid ? "bg-success ring-success" : "ring-foreground",
            )}
          />
        </span>
        <span className="font-semibold">{paid ? COPY.summary.paidToday : COPY.summary.today}</span>
        <span className="text-right font-semibold tabular-nums">{amount}</span>
      </li>
      <li className="contents">
        <span aria-hidden className="flex h-5 justify-center">
          <span className="w-px bg-border" />
        </span>
        <span aria-hidden className="col-span-2 h-5" />
      </li>
      <li className="contents">
        <span aria-hidden className="flex h-5 items-center justify-center">
          <span className="h-2.5 w-2.5 rounded-full border border-muted-foreground" />
        </span>
        <span>{nextDate}</span>
        <span className="text-right tabular-nums">{amount}</span>
        {recurrence && (
          <span className="col-start-2 col-span-2 mt-1 text-[13px] leading-5 text-muted-foreground">
            {COPY.summary.renews(recurrence)}
          </span>
        )}
      </li>
    </ol>
  );
}

function Footer({ className }: { className?: string }) {
  return (
    <p className={cn("text-[13px] leading-5 text-muted-foreground", className)}>
      {COPY.summary.brand} ·{" "}
      <a
        href="/privacidade"
        target="_blank"
        rel="noreferrer"
        className="inline-block rounded py-2 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {COPY.summary.privacy}
      </a>
    </p>
  );
}

export { Footer as CheckoutFooter };

export function CheckoutSummary({ link, paid }: { link: CheckoutLink; paid: boolean }) {
  const [open, setOpen] = useState(false);
  const { plan, totals } = link;
  const upfront = plan.billing_cycle !== "monthly";
  const monthly = totals.monthly_cents !== null ? formatMoney(totals.monthly_cents) : null;
  const validUntil = formatLongDate(link.expires_at);
  const showComposition = compositionCloses(totals);
  const discount = (v: number | null) => (v && v > 0 ? `−${formatMoney(v)}` : null);

  return (
    <aside aria-label="Resumo da proposta">
      <div className="px-5 pb-8 pt-6 sm:mx-auto sm:max-w-[34rem] lg:sticky lg:top-0 lg:ml-auto lg:mr-0 lg:max-w-[30rem] lg:px-0 lg:py-14 lg:pl-8 lg:pr-16">
        {/* Com a confirmação em cima, no celular, o logo sobe junto com ela. */}
        <img src={logo} alt="Torque CRM" className={cn("h-7 w-auto", paid && "hidden lg:block")} />

        <div className={cn("mt-10 lg:mt-14", paid && "mt-0")}>
          {link.display_name ? (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground">{COPY.summary.eyebrow}</p>
              <h1 className="mt-1.5 break-words text-[1.375rem] font-extrabold leading-[1.1] tracking-[-0.035em] lg:text-[1.75rem]">
                {link.display_name}
              </h1>
            </>
          ) : (
            <h1 className="text-[1.375rem] font-extrabold leading-[1.1] tracking-[-0.035em] lg:text-[1.75rem]">
              {COPY.summary.fallbackTitle}
            </h1>
          )}
        </div>

        <div className="mt-8">
          <BigAmount cents={link.amount_cents} />
          <p className="mt-2.5 text-sm leading-5 text-muted-foreground">
            {upfront ? COPY.summary.captionUpfront(monthly) : COPY.summary.captionMonthly}
          </p>
        </div>

        <div className="mt-8">
          <Timeline link={link} paid={paid} />
        </div>

        <Collapsible open={open} onOpenChange={setOpen} className="mt-6 lg:mt-8">
          <CollapsibleTrigger
            className="flex min-h-11 w-full items-center justify-between rounded-md text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
          >
            {open ? COPY.summary.hideDetails : COPY.summary.showDetails}
            <ChevronDown
              aria-hidden
              className={cn("h-4 w-4 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")}
            />
          </CollapsibleTrigger>
          <CollapsibleContent forceMount className="data-[state=closed]:hidden lg:data-[state=closed]:block">
            <dl className="mt-2 border-t border-border pt-4 lg:mt-0">
              {plan.name && <Row label={COPY.summary.plan} value={plan.name} />}
              {plan.seats !== null && <Row label={COPY.summary.users} value={String(plan.seats)} />}
              <Row label={COPY.summary.cycle} value={cycleText(plan.billing_cycle)} />
              {showComposition ? (
                <>
                  {discount(totals.cycle_discount_cents) || discount(totals.coupon_discount_cents) || discount(totals.manual_discount_cents) ? (
                    <Row label={COPY.summary.listPrice} value={formatMoney(totals.subtotal_cents as number)} />
                  ) : null}
                  {discount(totals.cycle_discount_cents) && <Row label={COPY.summary.cycleDiscount} value={discount(totals.cycle_discount_cents) as string} />}
                  {discount(totals.coupon_discount_cents) && <Row label={COPY.summary.coupon} value={discount(totals.coupon_discount_cents) as string} />}
                  {discount(totals.manual_discount_cents) && <Row label={COPY.summary.negotiated} value={discount(totals.manual_discount_cents) as string} />}
                </>
              ) : null}
              {monthly && <Row label={COPY.summary.monthly} value={monthly} strong />}
            </dl>
            {validUntil && (
              <p className="mt-6 border-t border-border pt-4 text-[13px] leading-5 text-muted-foreground">
                {COPY.summary.validUntil(validUntil)}
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>

        <Footer className="mt-4 hidden lg:block" />
      </div>
    </aside>
  );
}
