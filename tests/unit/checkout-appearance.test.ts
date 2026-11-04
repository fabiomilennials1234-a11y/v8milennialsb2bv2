// @vitest-environment node
/**
 * Deriva dos hex do Stripe Elements contra os tokens. O iframe não lê `var()`: mudar um token
 * sem mudar o hex deixa o formulário do cartão para trás em silêncio.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHECKOUT_COLORS, PAYMENT_ELEMENT_OPTIONS, checkoutAppearance } from "@/modules/billing/components/checkout/checkout-appearance";

const css = readFileSync(resolve(__dirname, "../../src/index.css"), "utf8");
const darkBlock = css.slice(css.indexOf(".dark {"));

function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`).exec(darkBlock);
  if (!m) throw new Error(`token ${name} ausente`);
  return hslToHex(Number(m[1]), Number(m[2]), Number(m[3]));
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round((lig - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))) * 255);
  };
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

describe("hex do Stripe == tokens .dark", () => {
  it.each([
    ["primary", CHECKOUT_COLORS.primary],
    ["sunken", CHECKOUT_COLORS.sunken],
    ["foreground", CHECKOUT_COLORS.foreground],
    ["muted-foreground", CHECKOUT_COLORS.mutedForeground],
    ["destructive-strong", CHECKOUT_COLORS.destructiveStrong],
    ["success-strong", CHECKOUT_COLORS.successStrong],
    ["warning-strong", CHECKOUT_COLORS.warningStrong],
  ])("--%s", (name, hex) => {
    expect(hex).toBe(token(name));
  });
});

describe("opções do Element", () => {
  it("sem carteira, sem termo da Stripe, e-mail e país por nossa conta", () => {
    expect(PAYMENT_ELEMENT_OPTIONS.wallets).toEqual({ applePay: "never", googlePay: "never", link: "never" });
    expect(PAYMENT_ELEMENT_OPTIONS.terms).toEqual({ card: "never" });
    expect(PAYMENT_ELEMENT_OPTIONS.fields?.billingDetails).toMatchObject({ email: "never", address: { country: "never" } });
  });
  it('todo "never" tem par no confirmParams: telefone não pode ser "never"', () => {
    expect(PAYMENT_ELEMENT_OPTIONS.fields?.billingDetails).toMatchObject({ phone: "auto" });
  });
  it("movimento reduzido desliga animação da Stripe", () => {
    expect(checkoutAppearance(true).disableAnimations).toBe(true);
    expect(checkoutAppearance(false).disableAnimations).toBe(false);
  });
});
