import { cn } from "@/lib/utils";

/**
 * `--input` sobre `--card` dá 1,19:1 e reprova WCAG 1.4.11; `foreground/40` dá 3,26:1. Exceção
 * local e medida: mexer no token global afetaria o app inteiro.
 */
export const CHECKOUT_INPUT_CLASS = cn(
  "h-11 bg-sunken text-base md:text-base border-foreground/40 hover:border-foreground/55",
  "ring-offset-0 focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0 focus-visible:border-primary",
  "transition-[border-color,box-shadow] duration-150 ease-standard motion-reduce:transition-none",
  "aria-[invalid=true]:border-destructive-strong aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive-strong",
  "[&:-webkit-autofill]:[-webkit-text-fill-color:hsl(var(--foreground))]",
  "[&:-webkit-autofill]:[box-shadow:inset_0_0_0_100px_hsl(var(--sunken))]",
);

/** A borda de `outline` é `--input`, invisível aqui; e o fundo `bg-card` sumiria no painel. */
export const CHECKOUT_OUTLINE_CLASS =
  "border-foreground/40 bg-transparent shadow-none hover:border-foreground/55 hover:bg-foreground/5 motion-reduce:transform-none motion-reduce:transition-none";

export const CHECKOUT_CTA_CLASS = "h-12 w-full text-[15px] motion-reduce:transform-none motion-reduce:transition-none";
