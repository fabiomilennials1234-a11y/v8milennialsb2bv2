import { type FormEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CHECKOUT_CTA_CLASS, CHECKOUT_INPUT_CLASS } from "./checkout-classes";
import {
  COPY,
  cancellationText,
  consentText,
  emailError,
  legalNameError,
  maskTaxId,
  taxIdError,
} from "./checkout-copy";

export type BuyerField = "legalName" | "taxId" | "email" | "consent";
export type BuyerErrors = Partial<Record<BuyerField, string>>;

export interface BuyerSubmit {
  legalName: string;
  taxId: string;
  email: string;
}

function FieldError({ id, message, className }: { id: string; message: string; className?: string }) {
  return (
    <p id={id} className={cn("flex items-start gap-1.5 text-[13px] font-medium leading-5 text-destructive", className)}>
      <AlertCircle aria-hidden className="mt-[3px] h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

export function CheckoutBuyerStep({
  amountCents,
  cycle,
  nextChargeText,
  initialLegalName,
  initialEmail,
  retypeTaxId,
  notice,
  serverErrors,
  isPending,
  onSubmit,
}: {
  amountCents: number;
  cycle: string;
  nextChargeText: string | null;
  initialLegalName: string;
  initialEmail: string;
  retypeTaxId: boolean;
  notice: string | null;
  serverErrors: BuyerErrors;
  isPending: boolean;
  onSubmit: (values: BuyerSubmit) => void;
}) {
  const [legalName, setLegalName] = useState(initialLegalName);
  const [taxId, setTaxId] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [accepted, setAccepted] = useState(retypeTaxId);
  const [errors, setErrors] = useState<BuyerErrors>({});

  const nameRef = useRef<HTMLInputElement>(null);
  const taxRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLButtonElement>(null);

  const focusField = (field: BuyerField) => {
    ({ legalName: nameRef, taxId: taxRef, email: emailRef, consent: consentRef })[field].current?.focus();
  };

  useEffect(() => {
    if (retypeTaxId) nameRef.current?.focus();
  }, [retypeTaxId]);

  // Recusa do servidor: mostra no campo e põe o foco nele.
  useEffect(() => {
    const first = (["legalName", "taxId", "email"] as const).find((f) => serverErrors[f]);
    if (!first) return;
    setErrors((prev) => ({ ...prev, ...serverErrors }));
    focusField(first);
  }, [serverErrors]);

  const validators = { legalName: legalNameError, taxId: taxIdError, email: emailError };

  const blurField = (field: keyof typeof validators, value: string) => {
    const message = validators[field](value);
    setErrors((prev) => ({ ...prev, [field]: message ?? undefined }));
  };

  /** Depois do primeiro erro, revalida a cada digitação. */
  const typed = (field: keyof typeof validators, value: string) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: validators[field](value) ?? undefined } : prev));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (isPending) return;
    const next: BuyerErrors = {
      legalName: legalNameError(legalName) ?? undefined,
      taxId: taxIdError(taxId) ?? undefined,
      email: emailError(email) ?? undefined,
      consent: accepted ? undefined : COPY.buyer.consentRequired,
    };
    setErrors(next);
    const first = (["legalName", "taxId", "email", "consent"] as const).find((f) => next[f]);
    if (first) {
      focusField(first);
      return;
    }
    onSubmit({ legalName: legalName.trim(), taxId, email: email.trim() });
  };

  const describe = (field: BuyerField, help?: string) =>
    [errors[field] ? `checkout-${field}-error` : null, help ?? null].filter(Boolean).join(" ") || undefined;

  return (
    <form noValidate onSubmit={submit} className="mt-6 space-y-5 motion-safe:animate-[panel-down_250ms_cubic-bezier(0.2,0,0,1)_both]">
      <div className="space-y-2">
        <Label htmlFor="checkout-legal-name" className="text-foreground">{COPY.buyer.legalName}</Label>
        <Input
          id="checkout-legal-name"
          ref={nameRef}
          required
          autoComplete="organization"
          value={legalName}
          aria-invalid={errors.legalName ? true : undefined}
          aria-describedby={describe("legalName")}
          className={CHECKOUT_INPUT_CLASS}
          onChange={(e) => {
            setLegalName(e.target.value);
            typed("legalName", e.target.value);
          }}
          onBlur={(e) => blurField("legalName", e.target.value)}
        />
        {errors.legalName && <FieldError id="checkout-legalName-error" message={errors.legalName} />}
      </div>

      <div className="space-y-2">
        <Label htmlFor="checkout-tax-id" className="text-foreground">{COPY.buyer.taxId}</Label>
        <Input
          id="checkout-tax-id"
          ref={taxRef}
          required
          autoComplete="off"
          inputMode="numeric"
          value={taxId}
          aria-invalid={errors.taxId ? true : undefined}
          aria-describedby={describe("taxId", retypeTaxId ? "checkout-tax-help" : undefined)}
          className={cn(CHECKOUT_INPUT_CLASS, "tabular-nums")}
          onChange={(e) => {
            const masked = maskTaxId(e.target.value);
            setTaxId(masked);
            typed("taxId", masked);
          }}
          onBlur={(e) => blurField("taxId", e.target.value)}
        />
        {retypeTaxId && !errors.taxId && (
          <p id="checkout-tax-help" className="text-[13px] leading-5 text-muted-foreground">{COPY.buyer.taxIdRetype}</p>
        )}
        {errors.taxId && <FieldError id="checkout-taxId-error" message={errors.taxId} />}
      </div>

      <div className="space-y-2">
        <Label htmlFor="checkout-email" className="text-foreground">{COPY.buyer.email}</Label>
        <Input
          id="checkout-email"
          ref={emailRef}
          required
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          autoCapitalize="none"
          value={email}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={describe("email", "checkout-email-help")}
          className={CHECKOUT_INPUT_CLASS}
          onChange={(e) => {
            setEmail(e.target.value);
            typed("email", e.target.value);
          }}
          onBlur={(e) => blurField("email", e.target.value)}
        />
        {errors.email ? (
          <FieldError id="checkout-email-error" message={errors.email} />
        ) : null}
        <p id="checkout-email-help" className="text-[13px] leading-5 text-muted-foreground">{COPY.buyer.emailHelp}</p>
      </div>

      <div className="space-y-2 border-t border-border pt-5">
        <div className="flex gap-3">
          <Checkbox
            id="checkout-consent"
            ref={consentRef}
            checked={accepted}
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={describe("consent", "checkout-cancel-help")}
            className="mt-1 h-5 w-5 rounded-[6px] border-foreground/40 ring-offset-card data-[state=checked]:border-primary"
            onCheckedChange={(value) => {
              const next = value === true;
              setAccepted(next);
              if (next) setErrors((prev) => ({ ...prev, consent: undefined }));
            }}
          />
          <Label
            htmlFor="checkout-consent"
            className="cursor-pointer py-1 text-[13px] font-normal leading-5 text-foreground"
          >
            {consentText(amountCents, cycle)}
          </Label>
        </div>
        {errors.consent && <FieldError id="checkout-consent-error" message={errors.consent} className="pl-8" />}
        <p id="checkout-cancel-help" className="pl-8 text-[13px] leading-5 text-muted-foreground">
          {cancellationText(nextChargeText)}
        </p>
      </div>

      {notice && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </p>
      )}

      <Button type="submit" size="lg" aria-busy={isPending || undefined} className={CHECKOUT_CTA_CLASS}>
        {isPending ? (
          <>
            <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            {COPY.buyer.ctaBusy}
          </>
        ) : (
          COPY.buyer.cta
        )}
      </Button>
    </form>
  );
}
