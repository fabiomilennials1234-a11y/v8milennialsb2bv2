import type { Appearance, StripeElementsOptions, StripePaymentElementOptions } from "@stripe/stripe-js";

/**
 * O iframe da Stripe não enxerga o CSS da página e as cores base da Appearance API não
 * aceitam `var()`. Por isso o hex derivado dos tokens do bloco `.dark` de `src/index.css`;
 * `tests/unit/checkout-appearance.test.ts` quebra se um token mudar e estes ficarem para trás.
 */
export const CHECKOUT_COLORS = {
  primary: "#FFC800", // --primary
  sunken: "#0A0A0A", // --sunken
  foreground: "#F2F2F2", // --foreground
  mutedForeground: "#A3A3A3", // --muted-foreground
  destructiveStrong: "#F26969", // --destructive-strong
  successStrong: "#51D682", // --success-strong
  warningStrong: "#F7B645", // --warning-strong
  inputBorder: "#676767", // foreground/40 sobre sunken: 3,26:1 contra o card
  inputBorderHover: "#8A8A8A", // foreground/55 sobre sunken
} as const;

export function checkoutAppearance(reducedMotion: boolean): Appearance {
  const c = CHECKOUT_COLORS;
  return {
    theme: "night",
    labels: "above",
    inputs: "spaced",
    disableAnimations: reducedMotion,
    variables: {
      colorPrimary: c.primary,
      colorBackground: c.sunken,
      colorText: c.foreground,
      colorTextSecondary: c.mutedForeground,
      colorTextPlaceholder: c.mutedForeground,
      colorDanger: c.destructiveStrong,
      colorSuccess: c.successStrong,
      colorWarning: c.warningStrong,
      fontFamily: '"Plus Jakarta Sans", Inter, system-ui, sans-serif',
      fontSizeBase: "16px",
      spacingUnit: "4px",
      borderRadius: "12px", // rounded-md
    },
    rules: {
      ".Label": { color: c.foreground, fontSize: "14px", fontWeight: "500", marginBottom: "8px" },
      ".Input": {
        backgroundColor: c.sunken,
        border: `1px solid ${c.inputBorder}`,
        boxShadow: "none",
        color: c.foreground,
        fontSize: "16px",
        padding: "11.8px 12px", // medido em pixel: dá os 44px de h-11
        transition: "border-color 150ms cubic-bezier(0.2, 0, 0, 1), box-shadow 150ms cubic-bezier(0.2, 0, 0, 1)",
      },
      ".Input:hover": { border: `1px solid ${c.inputBorderHover}` },
      ".Input:focus": { border: `1px solid ${c.primary}`, boxShadow: `0 0 0 1px ${c.primary}`, outline: "none" },
      ".Input--invalid": { border: `1px solid ${c.destructiveStrong}`, boxShadow: `0 0 0 1px ${c.destructiveStrong}` },
      ".Input::placeholder": { color: c.mutedForeground },
      ".Error": { color: c.destructiveStrong, fontSize: "13px", fontWeight: "500", marginTop: "6px" },
    },
  };
}

export const CHECKOUT_FONTS: StripeElementsOptions["fonts"] = [
  { cssSrc: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" },
];

export const PAYMENT_ELEMENT_OPTIONS: StripePaymentElementOptions = {
  layout: "tabs", // só cartão: a aba não aparece
  terms: { card: "never" }, // a autorização é a nossa, marcada antes do POST
  wallets: { applePay: "never", googlePay: "never", link: "never" },
  business: { name: "Torque CRM" },
  fields: {
    billingDetails: {
      // Telefone fica em "auto": cartão não o coleta, e "never" obriga a mandá-lo no confirmParams
      // (medido: sem ele, confirmPayment rejeita a promise e a tela não sai de "Processando").
      email: "never",
      phone: "auto",
      address: { country: "never", postalCode: "auto", line1: "auto", line2: "auto", city: "auto", state: "auto" },
    },
  },
};
