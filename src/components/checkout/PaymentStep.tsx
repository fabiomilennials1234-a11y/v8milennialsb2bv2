import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CreditCard,
  QrCode,
  ChevronLeft,
  Loader2,
  Lock,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL, type PricingBreakdown } from "@/lib/pricing-calculator";
import { PixQRCode } from "./PixQRCode";
import type { CheckoutState } from "@/hooks/useCheckout";

// ─── Masks ────────────────────────────────────────────────────────────────────

function maskCardNumber(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

function maskExpiry(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length > 2) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }
  return digits;
}

function maskCvv(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  state: CheckoutState;
  pricing: PricingBreakdown | null;
  submitPayment: (
    method: "pix" | "credit_card",
    cardData?: {
      number: string;
      expiry: string;
      cvv: string;
      holder_name: string;
    },
  ) => Promise<void>;
  onBack: () => void;
  onPaymentConfirmed: () => void;
}

type PaymentTab = "credit_card" | "pix";

// ─── Component ────────────────────────────────────────────────────────────────

export function PaymentStep({
  state,
  pricing,
  submitPayment,
  onBack,
  onPaymentConfirmed,
}: Props) {
  const [tab, setTab] = useState<PaymentTab>("credit_card");

  // Card form state
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardHolder, setCardHolder] = useState("");

  const isProcessing = state.payment_status === "processing";
  const isAwaitingPix = state.payment_status === "awaiting_pix";

  // ── Card validation ──────────────────────────────────────────────────────
  const cardNumberClean = cardNumber.replace(/\s/g, "");

  // Check if expiry is not in the past
  const isExpiryValid = (() => {
    if (cardExpiry.length !== 5) return false;
    const [mm, yy] = cardExpiry.split("/");
    const expiryMonth = parseInt(mm, 10);
    const expiryYear = 2000 + parseInt(yy, 10);
    if (isNaN(expiryMonth) || isNaN(expiryYear)) return false;
    if (expiryMonth < 1 || expiryMonth > 12) return false;
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    return expiryYear > currentYear || (expiryYear === currentYear && expiryMonth >= currentMonth);
  })();

  const expiryTouched = cardExpiry.length === 5;
  const showExpiryError = expiryTouched && !isExpiryValid;

  const isCardValid =
    cardNumberClean.length >= 13 &&
    isExpiryValid &&
    cardCvv.length >= 3 &&
    cardHolder.trim().length >= 3;

  // ── Submit card payment ──────────────────────────────────────────────────
  async function handleCardSubmit() {
    if (!isCardValid) return;
    await submitPayment("credit_card", {
      number: cardNumberClean,
      expiry: cardExpiry,
      cvv: cardCvv,
      holder_name: cardHolder.trim(),
    });
  }

  // ── Submit PIX payment ─────────────────────────────────────────────────
  async function handlePixGenerate() {
    await submitPayment("pix");
  }

  return (
    <div className="space-y-6">
      {/* ── Payment method tabs ───────────────────────────────────────── */}
      <div className="flex rounded-xl border border-border bg-muted/30 p-1">
        {[
          {
            key: "credit_card" as const,
            label: "Cartao de Credito",
            icon: CreditCard,
          },
          { key: "pix" as const, label: "PIX", icon: QrCode },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => !isProcessing && !isAwaitingPix && setTab(key)}
            disabled={isProcessing || isAwaitingPix}
            className={`
              flex-1 flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-medium transition-all
              ${
                tab === key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground/80"
              }
              ${isProcessing || isAwaitingPix ? "opacity-50 cursor-not-allowed" : ""}
            `}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Total reminder ────────────────────────────────────────────── */}
      {pricing && (
        <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Total a pagar
          </span>
          <span className="text-lg font-bold text-foreground tabular-nums">
            {pricing.cycle_months > 1
              ? formatBRL(pricing.total_cycle)
              : formatBRL(pricing.total_monthly)}
          </span>
        </div>
      )}

      {/* ── Error message ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {state.error && state.payment_status === "error" && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-3 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3"
          >
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive leading-snug">
              {state.error}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Credit card form ──────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {tab === "credit_card" && !isAwaitingPix && (
          <motion.div
            key="card"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {/* Card number */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Numero do cartao</Label>
              <Input
                placeholder="0000 0000 0000 0000"
                value={cardNumber}
                onChange={(e) => setCardNumber(maskCardNumber(e.target.value))}
                className="h-12 text-base font-mono tracking-wider"
                inputMode="numeric"
                autoComplete="cc-number"
                disabled={isProcessing}
              />
            </div>

            {/* Expiry + CVV */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Validade</Label>
                <Input
                  placeholder="MM/AA"
                  value={cardExpiry}
                  onChange={(e) => setCardExpiry(maskExpiry(e.target.value))}
                  className={`h-12 text-base font-mono ${showExpiryError ? "border-destructive" : ""}`}
                  inputMode="numeric"
                  autoComplete="cc-exp"
                  disabled={isProcessing}
                />
                {showExpiryError && (
                  <p className="text-xs text-destructive">Cartao expirado</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">CVV</Label>
                <Input
                  placeholder="000"
                  value={cardCvv}
                  onChange={(e) => setCardCvv(maskCvv(e.target.value))}
                  className="h-12 text-base font-mono"
                  inputMode="numeric"
                  type="password"
                  autoComplete="cc-csc"
                  disabled={isProcessing}
                />
              </div>
            </div>

            {/* Cardholder name */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Nome no cartao
              </Label>
              <Input
                placeholder="Como impresso no cartao"
                value={cardHolder}
                onChange={(e) => setCardHolder(e.target.value.toUpperCase())}
                className="h-12 text-base uppercase"
                autoComplete="cc-name"
                disabled={isProcessing}
              />
            </div>

            {/* Submit */}
            <Button
              onClick={handleCardSubmit}
              disabled={!isCardValid || isProcessing}
              className="w-full h-13 gradient-primary gradient-primary-hover text-white font-semibold border-0 text-sm mt-2"
              style={{ height: 52 }}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Processando...
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4 mr-2" />
                  Finalizar pagamento
                </>
              )}
            </Button>

            <p className="text-[11px] text-muted-foreground/50 text-center flex items-center justify-center gap-1">
              <Lock className="h-3 w-3" />
              Pagamento seguro processado via Asaas
            </p>
          </motion.div>
        )}

        {/* ── PIX form ──────────────────────────────────────────────────── */}
        {tab === "pix" && !isAwaitingPix && (
          <motion.div
            key="pix"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <div className="rounded-xl bg-muted/30 border border-border p-6 text-center">
              <QrCode className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground mb-1">
                Pague via PIX de forma rapida e segura.
              </p>
              <p className="text-xs text-muted-foreground/60">
                O QR Code sera gerado apos clicar no botao abaixo.
              </p>
            </div>

            <Button
              onClick={handlePixGenerate}
              disabled={isProcessing}
              className="w-full h-13 gradient-primary gradient-primary-hover text-white font-semibold border-0 text-sm"
              style={{ height: 52 }}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Gerando PIX...
                </>
              ) : (
                <>
                  <QrCode className="h-4 w-4 mr-2" />
                  Gerar PIX
                </>
              )}
            </Button>
          </motion.div>
        )}

        {/* ── PIX QR Code (after generation) ────────────────────────────── */}
        {isAwaitingPix && state.payment_id && (
          <motion.div
            key="pix-qr"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-xl border border-border bg-card/50 p-5"
          >
            <PixQRCode
              paymentId={state.payment_id}
              qrCodeBase64={state.qr_code_base64 ?? undefined}
              pixPayload={state.pix_payload ?? undefined}
              onConfirmed={onPaymentConfirmed}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Back button ───────────────────────────────────────────────── */}
      {!isProcessing && !isAwaitingPix && (
        <div className="flex pt-2">
          <Button variant="ghost" onClick={onBack} className="h-11 px-5">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Voltar
          </Button>
        </div>
      )}
    </div>
  );
}
