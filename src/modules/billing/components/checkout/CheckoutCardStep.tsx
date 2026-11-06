import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { PaymentIntentResult, Stripe, StripeElementsOptions, StripePaymentElement } from "@stripe/stripe-js";
import { AlertCircle, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { reportError, toAppError } from "@/shared/errors";
import { CHECKOUT_CTA_CLASS, CHECKOUT_OUTLINE_CLASS } from "./checkout-classes";
import { CHECKOUT_FONTS, PAYMENT_ELEMENT_OPTIONS, checkoutAppearance } from "./checkout-appearance";
import { COPY, declineMessage, formatMoney, isExplicitDecline } from "./checkout-copy";

export type CardResult =
  | { kind: "succeeded" }
  | { kind: "processing" }
  | { kind: "session_expired" };

function CardForm({
  clientSecret,
  token,
  email,
  amountCents,
  isTest,
  onResult,
  onLoadError,
  onBusyChange,
}: {
  clientSecret: string;
  token: string;
  email: string;
  amountCents: number;
  isTest: boolean;
  onResult: (result: CardResult) => void;
  onLoadError: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [decline, setDecline] = useState<string | null>(null);
  const fieldset = useRef<HTMLDivElement>(null);
  const element = useRef<StripePaymentElement | null>(null);

  // `inert` não é prop do React 18.
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  useEffect(() => {
    const node = fieldset.current;
    if (!node) return;
    if (busy) node.setAttribute("inert", "");
    else node.removeAttribute("inert");
  }, [busy]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !stripe || !elements) return;
    setBusy(true);
    setDecline(null);

    let confirmation: PaymentIntentResult;
    try {
      confirmation = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: {
          return_url: `${window.location.origin}/checkout/${token}`,
          payment_method_data: { billing_details: { email, address: { country: "BR" } } },
        },
      });
    } catch {
      // Erro de integração REJEITA a promise, em vez de devolver `error`. Só o nome fixo vai ao
      // relatório: a mensagem cita dados.
      reportError(toAppError(new Error("checkout_confirm_rejected"), "Pagamento indisponível."), { feature: "checkout" });
      await settleFromPaymentIntent();
      return;
    }
    const { error, paymentIntent } = confirmation;

    if (!error) {
      if (paymentIntent?.status === "succeeded") return onResult({ kind: "succeeded" });
      if (paymentIntent?.status === "processing") return onResult({ kind: "processing" });
      await settleFromPaymentIntent();
      return;
    }

    if (error.type === "validation_error") {
      setBusy(false);
      return;
    }

    if (isExplicitDecline(error)) {
      setBusy(false);
      setDecline(declineMessage(error.code, error.decline_code, amountCents));
      element.current?.focus();
      return;
    }

    if (error.code === "payment_intent_unexpected_state" && error.payment_intent) {
      // Outra aba pagou, ou a incompleta expirou. Só o PaymentIntent sabe.
      const status = error.payment_intent.status;
      if (status === "succeeded") return onResult({ kind: "succeeded" });
      if (status === "processing") return onResult({ kind: "processing" });
      return onResult({ kind: "session_expired" });
    }

    await settleFromPaymentIntent();
  };

  /**
   * Conexão caída, erro da API, resposta perdida: o pagamento pode ter passado. Quem decide é o
   * PaymentIntent, e nunca se diz "recusou" nem "nada foi cobrado" sem ele.
   */
  const settleFromPaymentIntent = async () => {
    try {
      const { paymentIntent } = await stripe!.retrievePaymentIntent(clientSecret);
      if (paymentIntent?.status === "succeeded") return onResult({ kind: "succeeded" });
      if (paymentIntent?.status === "processing") return onResult({ kind: "processing" });
      const last = paymentIntent?.last_payment_error;
      if (paymentIntent?.status === "requires_payment_method" && last) {
        setBusy(false);
        setDecline(declineMessage(last.code, last.decline_code, amountCents));
        return;
      }
    } catch {
      // Sem rede também para consultar: cai no aviso abaixo, que não afirma nada.
    }
    setBusy(false);
    setDecline(COPY.card.unconfirmed);
  };

  return (
    <form noValidate onSubmit={submit} className="mt-6 space-y-5">
      <div ref={fieldset} className="space-y-5">
        {isTest && <p className="text-[13px] text-warning">{COPY.card.testEnv}</p>}
        <div className={ready ? "relative" : "relative min-h-[136px]"}>
          {!ready && (
            <div aria-hidden className="absolute inset-x-0 top-0 space-y-4">
              <Skeleton className="h-11 w-full rounded-md motion-reduce:animate-none" />
              <div className="grid grid-cols-2 gap-3">
                <Skeleton className="h-11 rounded-md motion-reduce:animate-none" />
                <Skeleton className="h-11 rounded-md motion-reduce:animate-none" />
              </div>
            </div>
          )}
          <PaymentElement
            id="checkout-payment-element"
            options={PAYMENT_ELEMENT_OPTIONS}
            onReady={(el) => {
              element.current = el;
              setReady(true);
            }}
            onLoadError={onLoadError}
          />
        </div>
      </div>

      {decline && (
        <p role="alert" className="flex items-start gap-2 text-sm leading-5 text-destructive">
          <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{decline}</span>
        </p>
      )}

      <Button type="submit" size="lg" aria-busy={busy || undefined} className={CHECKOUT_CTA_CLASS}>
        {busy ? (
          <>
            <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            {COPY.card.ctaBusy}
          </>
        ) : (
          COPY.card.cta(formatMoney(amountCents))
        )}
      </Button>

      <div role="status" className="min-h-0">
        {busy && <p className="text-[13px] leading-5 text-muted-foreground">{COPY.card.statusBusy}</p>}
      </div>

      <p className="flex items-start gap-2 text-[13px] leading-5 text-muted-foreground">
        <Lock aria-hidden className="mt-[3px] h-3.5 w-3.5 shrink-0" />
        <span>{COPY.card.trust}</span>
      </p>
    </form>
  );
}

export function CheckoutCardStep({
  stripe,
  stripeFailed,
  clientSecret,
  token,
  email,
  amountCents,
  isTest,
  onRetryLoad,
  onLoadError,
  onResult,
  onBusyChange,
}: {
  stripe: Stripe | null;
  stripeFailed: boolean;
  clientSecret: string;
  token: string;
  email: string;
  amountCents: number;
  isTest: boolean;
  onRetryLoad: () => void;
  onLoadError: () => void;
  onResult: (result: CardResult) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const options = useMemo<StripeElementsOptions>(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    return {
      clientSecret,
      appearance: checkoutAppearance(reduced),
      fonts: CHECKOUT_FONTS,
      locale: "pt-BR",
      loader: "never",
    };
  }, [clientSecret]);

  if (stripeFailed) {
    return (
      <div className="mt-6 space-y-4">
        <p role="alert" className="flex items-start gap-2 text-sm leading-5 text-destructive">
          <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{COPY.card.loadError}</span>
        </p>
        <Button type="button" variant="outline" size="lg" onClick={onRetryLoad} className={CHECKOUT_OUTLINE_CLASS}>
          {COPY.card.retry}
        </Button>
      </div>
    );
  }

  if (!stripe) {
    return (
      <div aria-hidden className="mt-6 min-h-[136px] space-y-4">
        <Skeleton className="h-11 w-full rounded-md motion-reduce:animate-none" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-11 rounded-md motion-reduce:animate-none" />
          <Skeleton className="h-11 rounded-md motion-reduce:animate-none" />
        </div>
      </div>
    );
  }

  return (
    <Elements key={clientSecret} stripe={stripe} options={options}>
      <CardForm
        clientSecret={clientSecret}
        token={token}
        email={email}
        amountCents={amountCents}
        isTest={isTest}
        onResult={onResult}
        onLoadError={onLoadError}
        onBusyChange={onBusyChange}
      />
    </Elements>
  );
}
