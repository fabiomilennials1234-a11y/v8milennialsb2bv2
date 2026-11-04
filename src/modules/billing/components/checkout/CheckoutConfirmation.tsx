import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import logo from "@/assets/torque-logo.png";
import type { RegistrationState } from "../../hooks/useCheckoutStatus";
import { COPY, formatMoney, orgPossessive } from "./checkout-copy";
import { CheckoutFooter } from "./CheckoutSummary";
import { CHECKOUT_OUTLINE_CLASS } from "./checkout-classes";

const CHECK_LENGTH = 26;

/** O traço desenha uma vez, 400 ms. Com movimento reduzido, já vem cheio. */
function DrawnCheck() {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setDrawn(true));
    return () => window.cancelAnimationFrame(id);
  }, []);
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5 text-success" fill="none">
      <path
        d="M4 12.5 9.5 18 20 6.5"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={CHECK_LENGTH}
        strokeDashoffset={drawn ? 0 : CHECK_LENGTH}
        className="transition-[stroke-dashoffset] duration-[400ms] ease-out-expo motion-reduce:transition-none"
      />
    </svg>
  );
}

export function CheckoutConfirmation({
  analysis,
  amountCents,
  displayName,
  nextChargeText,
  recurrence,
  registration,
}: {
  analysis: boolean;
  amountCents: number;
  displayName: string | null;
  nextChargeText: string | null;
  recurrence: string | null;
  registration: RegistrationState;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  const org = orgPossessive(displayName);
  const message = analysis
    ? COPY.confirmed.analysis
    : registration === "paid"
      ? COPY.confirmed.paid(org)
      : registration === "slow"
        ? COPY.confirmed.slow
        : COPY.confirmed.pending(org);

  return (
    <div className="motion-safe:animate-[panel-down_250ms_cubic-bezier(0.2,0,0,1)_both]">
      <img src={logo} alt="" className="mb-10 h-7 w-auto lg:hidden" />
      {!analysis && <DrawnCheck />}
      <h1
        ref={titleRef}
        tabIndex={-1}
        className="mt-3 text-[1.375rem] font-extrabold leading-[1.1] tracking-[-0.035em] outline-none lg:text-[1.75rem]"
      >
        {analysis ? COPY.confirmed.analysisTitle : COPY.confirmed.title}
      </h1>
      <p role="status" className="mt-3 text-[15px] leading-6 text-muted-foreground">{message}</p>

      {!analysis && (
        <dl className="mt-6 border-t border-border">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border py-2.5">
            <dt className="text-sm text-muted-foreground">{COPY.confirmed.amountPaid}</dt>
            <dd className="text-sm font-semibold tabular-nums">{formatMoney(amountCents)}</dd>
          </div>
          {nextChargeText && (
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border py-2.5">
              <dt className="text-sm text-muted-foreground">{COPY.confirmed.nextCharge}</dt>
              <dd className="text-sm font-semibold tabular-nums">{nextChargeText}</dd>
            </div>
          )}
        </dl>
      )}

      <Button variant="outline" size="lg" className={`mt-6 ${CHECKOUT_OUTLINE_CLASS}`} asChild>
        {/* Navegação de verdade: o tema travado desta rota é decidido no boot do App. */}
        <a href="/auth">{COPY.confirmed.enter}</a>
      </Button>

      {!analysis && recurrence && (
        <p className="mt-4 text-[13px] leading-5 text-muted-foreground">{COPY.confirmed.renewal(recurrence)}</p>
      )}
      <CheckoutFooter className="mt-6 lg:hidden" />
    </div>
  );
}
