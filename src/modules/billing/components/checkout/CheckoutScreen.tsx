/**
 * A tela do link de pagamento. Duas superfícies, separadas por luminância e sem cartão
 * flutuante: à esquerda a proposta, à direita só o necessário para pagar.
 *
 * Ordem fixada pelo contrato do POST: comprador + autorização → POST → cartão. A autorização
 * é registrada ANTES de a assinatura nascer, então a marcação mora na etapa 1.
 *
 * Segredos: o documento sai do estado no instante do POST (fica o tipo e 2 dígitos). O
 * client_secret vive só neste estado e no `Elements`. Nenhum dos dois vai para DOM, log,
 * storage ou Sentry; o token também não.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe } from "@stripe/stripe-js";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { reportError, toAppError } from "@/shared/errors";
import { useCheckoutStatus } from "../../hooks/useCheckoutStatus";
import { useStartSubscription } from "../../hooks/useStartSubscription";
import type { CheckoutLink } from "../../lib/checkout-api";
import { writePaidMark } from "../../lib/checkout-paid-mark";
import { ensureStripeReachable } from "../../lib/checkout-sw";
import { keyMatchesLivemode, type PublishableKey } from "../../lib/stripe-env";
import { CheckoutBuyerStep, type BuyerErrors, type BuyerSubmit } from "./CheckoutBuyerStep";
import { CheckoutCardStep, type CardResult } from "./CheckoutCardStep";
import { CheckoutConfirmation } from "./CheckoutConfirmation";
import { CheckoutFooter, CheckoutSummary } from "./CheckoutSummary";
import { CheckoutTerminal } from "./CheckoutTerminal";
import {
  CHECKOUT_CONSENT_VERSION,
  COPY,
  declineMessage,
  formatLongDate,
  recurrenceText,
  taxIdTail,
  type TerminalId,
} from "./checkout-copy";

type Phase =
  | { name: "buyer"; notice: string | null; retype: boolean; serverErrors: BuyerErrors }
  | { name: "card"; clientSecret: string; docKind: string; docTail: string }
  | { name: "resuming" }
  | { name: "confirmed" }
  | { name: "analysis" }
  | { name: "terminal"; id: TerminalId };

const BUYER_INITIAL: Phase = { name: "buyer", notice: null, retype: false, serverErrors: {} };

function StepHeader({
  number,
  title,
  muted,
  titleRef,
  action,
}: {
  number: number;
  title: string;
  muted?: boolean;
  titleRef?: React.Ref<HTMLHeadingElement>;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center gap-3">
      <span aria-hidden className="text-[13px] font-bold tabular-nums text-muted-foreground">{number}</span>
      <h2
        ref={titleRef}
        tabIndex={titleRef ? -1 : undefined}
        className={`text-[15px] font-bold tracking-[-0.01em] outline-none ${muted ? "text-muted-foreground" : "text-foreground"}`}
      >
        {title}
      </h2>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

export function CheckoutScreen({
  token,
  link,
  publishableKey,
  initialPaid,
  redirectSecret,
  onRetry,
}: {
  token: string;
  link: CheckoutLink;
  publishableKey: Extract<PublishableKey, { ok: true }>;
  initialPaid: boolean;
  redirectSecret: string | null;
  onRetry: () => void;
}) {
  const [phase, setPhase] = useState<Phase>(() =>
    initialPaid ? { name: "confirmed" } : redirectSecret ? { name: "resuming" } : BUYER_INITIAL,
  );
  const [legalName, setLegalName] = useState("");
  const [email, setEmail] = useState("");
  const { start, isPending } = useStartSubscription();

  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [stripeFailed, setStripeFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [cardBusy, setCardBusy] = useState(false);

  const needsStripe = phase.name === "buyer" || phase.name === "card" || phase.name === "resuming";

  // O Stripe.js só é baixado aqui, depois do link validado, e nunca fora deste chunk.
  useEffect(() => {
    if (!needsStripe || stripe) return;
    let alive = true;
    // Primeiro garante que nenhum Service Worker antigo vai barrar o script.
    ensureStripeReachable()
      .then(() => loadStripe(publishableKey.key))
      .then((loaded) => {
        if (!alive) return;
        if (loaded) setStripe(loaded);
        else setStripeFailed(true);
      })
      .catch(() => {
        if (alive) setStripeFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [needsStripe, stripe, publishableKey.key, loadAttempt]);

  const cardTitleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (phase.name === "card") cardTitleRef.current?.focus();
  }, [phase.name]);

  const nextChargeText = formatLongDate(link.next_charge_preview_at);
  const recurrence = recurrenceText(link.plan.billing_cycle);
  const cycle = link.plan.billing_cycle as string;

  const paid = phase.name === "confirmed";
  const finished = paid || phase.name === "analysis";
  const registration = useCheckoutStatus(token, paid);

  const markPaid = useCallback(() => {
    void writePaidMark(token);
    setPhase({ name: "confirmed" });
  }, [token]);

  // Volta de redirect do banco: o client_secret já saiu da URL, e o PaymentIntent decide.
  useEffect(() => {
    if (phase.name !== "resuming" || !redirectSecret) return;
    // Sem Stripe.js não há como ler o PaymentIntent, e a pessoa pode ter pago.
    if (stripeFailed) {
      setPhase({ name: "terminal", id: "resume_unknown" });
      return;
    }
    if (!stripe) return;
    let alive = true;
    void stripe.retrievePaymentIntent(redirectSecret).then(({ paymentIntent }) => {
      if (!alive) return;
      if (paymentIntent?.status === "succeeded") {
        // O que a URL trouxe pode ser de outro pagamento: só celebra se for o valor deste link.
        if (paymentIntent.amount !== link.amount_cents) {
          reportError(toAppError(new Error("checkout_resume_amount_mismatch"), "Pagamento indisponível."), { feature: "checkout" });
          setPhase({ name: "terminal", id: "unavailable" });
          return;
        }
        markPaid();
      } else if (paymentIntent?.status === "processing") setPhase({ name: "analysis" });
      else if (paymentIntent?.last_payment_error) {
        const last = paymentIntent.last_payment_error;
        setPhase({ name: "buyer", notice: declineMessage(last.code, last.decline_code, link.amount_cents), retype: false, serverErrors: {} });
      } else if (paymentIntent?.status === "requires_payment_method") {
        setPhase({ name: "buyer", notice: COPY.buyer.sessionExpired, retype: false, serverErrors: {} });
      } else {
        setPhase({ name: "buyer", notice: COPY.card.unconfirmed, retype: false, serverErrors: {} });
      }
    }).catch(() => {
      if (alive) setPhase({ name: "terminal", id: "resume_unknown" });
    });
    return () => {
      alive = false;
    };
  }, [phase.name, redirectSecret, stripe, stripeFailed, link.amount_cents, markPaid]);

  const submitBuyer = async (values: BuyerSubmit) => {
    const outcome = await start({
      token,
      buyer: { legal_name: values.legalName, email: values.email, tax_id: values.taxId.replace(/\D/g, "") },
      consent: { accepted: true, version: CHECKOUT_CONSENT_VERSION },
    });
    if (!outcome) return;

    switch (outcome.kind) {
      case "ready": {
        const secret = outcome.clientSecret;
        // Trava de valor: o que a pessoa viu e autorizou é o que se cobra.
        const amountDiffers = outcome.amountCents !== link.amount_cents || outcome.billingCycle !== link.plan.billing_cycle;
        if (amountDiffers || !keyMatchesLivemode(publishableKey, outcome.livemode)) {
          reportError(toAppError(new Error(amountDiffers ? "checkout_amount_mismatch" : "checkout_livemode_mismatch"), "Pagamento indisponível."), { feature: "checkout" });
          setPhase({ name: "terminal", id: "unavailable" });
          return;
        }
        const doc = taxIdTail(values.taxId);
        setLegalName(values.legalName);
        setEmail(values.email);
        setPhase({ name: "card", clientSecret: secret, docKind: doc.kind, docTail: doc.tail });
        return;
      }
      case "field":
        setPhase({
          name: "buyer",
          notice: null,
          retype: false,
          serverErrors: {
            taxId: outcome.field === "taxId" ? COPY.buyer.taxIdInvalid : undefined,
            email: outcome.field === "email" ? COPY.buyer.emailInvalid : undefined,
            legalName: outcome.field === "legalName" ? COPY.buyer.legalNameMissing : undefined,
          },
        });
        return;
      case "rate_limited":
        setPhase({ name: "buyer", notice: COPY.buyer.rateLimited, retype: false, serverErrors: {} });
        return;
      case "offline":
        setPhase({ name: "buyer", notice: COPY.buyer.offline, retype: false, serverErrors: {} });
        return;
      case "consent_required":
        setPhase({ name: "terminal", id: "stale_bundle" });
        return;
      case "terminal":
        setPhase({ name: "terminal", id: outcome.state });
        return;
      case "unavailable":
        setPhase({ name: "terminal", id: "unavailable" });
        return;
    }
  };

  const cardResult = (result: CardResult) => {
    if (result.kind === "succeeded") markPaid();
    else if (result.kind === "processing") setPhase({ name: "analysis" });
    else setPhase({ name: "buyer", notice: COPY.buyer.sessionExpired, retype: true, serverErrors: {} });
  };

  if (phase.name === "terminal") {
    return <CheckoutTerminal id={phase.id} displayName={link.display_name} onRetry={onRetry} />;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground sentry-block lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <CheckoutSummary link={link} paid={paid} />

      <main className={`flex-1 border-t border-card-border bg-card lg:border-l lg:border-t-0 ${finished ? "order-first lg:order-none" : ""}`}>
        <div className="px-5 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:mx-auto sm:max-w-[34rem] lg:ml-0 lg:mr-auto lg:max-w-[28rem] lg:px-0 lg:py-14 lg:pl-16 lg:pr-8">
          {finished ? (
            <CheckoutConfirmation
              analysis={phase.name === "analysis"}
              amountCents={link.amount_cents}
              displayName={link.display_name}
              nextChargeText={nextChargeText}
              recurrence={recurrence}
              registration={registration}
            />
          ) : phase.name === "resuming" ? (
            <p role="status" className="text-[15px] leading-6 text-muted-foreground">{COPY.card.ctaBusy}</p>
          ) : (
            <>
              {phase.name === "card" ? (
                <section>
                  <StepHeader
                    number={1}
                    title={COPY.buyer.title}
                    action={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-9"
                        disabled={cardBusy}
                        onClick={() => setPhase({ name: "buyer", notice: null, retype: true, serverErrors: {} })}
                      >
                        {COPY.buyer.edit}
                      </Button>
                    }
                  />
                  <div className="mt-1 pl-5 text-[13px] leading-5 text-muted-foreground">
                    <p className="break-words">{legalName}</p>
                    <p>{COPY.buyer.collapsedDoc(phase.docKind, phase.docTail)}</p>
                    <p className="break-words">{email}</p>
                    <p>{COPY.buyer.consentGiven}</p>
                  </div>
                </section>
              ) : (
                <section>
                  <StepHeader number={1} title={COPY.buyer.title} />
                  <CheckoutBuyerStep
                    amountCents={link.amount_cents}
                    cycle={cycle}
                    nextChargeText={nextChargeText}
                    initialLegalName={legalName}
                    initialEmail={email}
                    retypeTaxId={phase.retype}
                    notice={phase.notice}
                    serverErrors={phase.serverErrors}
                    isPending={isPending}
                    onSubmit={submitBuyer}
                  />
                </section>
              )}

              <section className="mt-8 border-t border-border pt-6">
                <StepHeader
                  number={2}
                  title={COPY.card.title}
                  muted={phase.name !== "card"}
                  titleRef={phase.name === "card" ? cardTitleRef : undefined}
                />
                {phase.name === "card" && (
                  <div className="motion-safe:animate-[panel-down_250ms_cubic-bezier(0.2,0,0,1)_both]">
                    <CheckoutCardStep
                      stripe={stripe}
                      stripeFailed={stripeFailed}
                      clientSecret={phase.clientSecret}
                      token={token}
                      email={email}
                      amountCents={link.amount_cents}
                      isTest={!publishableKey.livemode}
                      onRetryLoad={() => {
                        setStripeFailed(false);
                        setStripe(null);
                        setLoadAttempt((n) => n + 1);
                      }}
                      onLoadError={() => setStripeFailed(true)}
                      onResult={cardResult}
                      onBusyChange={setCardBusy}
                    />
                  </div>
                )}
              </section>
              <CheckoutFooter className="mt-6 lg:hidden" />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/** Mesma grade da tela final, para não haver salto. */
export function CheckoutSkeleton() {
  const bar = "motion-reduce:animate-none";
  return (
    <div aria-busy="true" className="flex min-h-dvh flex-col bg-background lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <span role="status" className="sr-only">Carregando a proposta</span>
      <div className="px-5 pb-8 pt-6 sm:mx-auto sm:w-full sm:max-w-[34rem] lg:ml-auto lg:mr-0 lg:max-w-[30rem] lg:px-0 lg:py-14 lg:pl-8 lg:pr-16">
        <Skeleton className={`h-7 w-28 ${bar}`} />
        <Skeleton className={`mt-10 h-3 w-24 lg:mt-14 ${bar}`} />
        <Skeleton className={`mt-2 h-8 w-64 max-w-full ${bar}`} />
        <Skeleton className={`mt-8 h-14 w-72 max-w-full ${bar}`} />
        <div className="mt-8 space-y-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className={`h-4 w-full ${bar}`} />)}
        </div>
      </div>
      <div className="flex-1 border-t border-card-border bg-card lg:border-l lg:border-t-0">
        <div className="space-y-5 px-5 py-8 sm:mx-auto sm:max-w-[34rem] lg:ml-0 lg:mr-auto lg:max-w-[28rem] lg:px-0 lg:py-14 lg:pl-16 lg:pr-8">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className={`h-3.5 w-32 ${bar}`} />
              <Skeleton className={`h-11 w-full rounded-md ${bar}`} />
            </div>
          ))}
          <Skeleton className={`h-12 w-full rounded-full ${bar}`} />
        </div>
      </div>
    </div>
  );
}
