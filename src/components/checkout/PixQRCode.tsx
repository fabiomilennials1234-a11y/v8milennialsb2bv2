import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Copy, Check, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  paymentId: string;
  qrCodeBase64?: string;
  pixPayload?: string;
  onConfirmed: () => void;
}

export function PixQRCode({
  paymentId,
  qrCodeBase64,
  pixPayload,
  onConfirmed,
}: Props) {
  const [status, setStatus] = useState<"waiting" | "confirmed">("waiting");
  const [copied, setCopied] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // ── Poll payment status ──────────────────────────────────────────────────
  const pollStatus = useCallback(async () => {
    if (!mountedRef.current) return;

    try {
      const { data, error } = await supabase.functions.invoke(
        "checkout-create-payment",
        {
          body: {
            action: "check_status",
            payment_id: paymentId,
          },
        },
      );

      if (!mountedRef.current) return;

      if (
        !error &&
        data?.status &&
        (data.status === "confirmed" || data.status === "received")
      ) {
        setStatus("confirmed");
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        onConfirmed();
      }
    } catch {
      // Silently continue polling
    }
  }, [paymentId, onConfirmed]);

  useEffect(() => {
    mountedRef.current = true;

    // Start polling every 5 seconds
    intervalRef.current = setInterval(pollStatus, 5000);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [pollStatus]);

  // ── Copy PIX code ────────────────────────────────────────────────────────
  async function handleCopy() {
    if (!pixPayload) return;
    try {
      await navigator.clipboard.writeText(pixPayload);
      setCopied(true);
      toast.success("Codigo PIX copiado!");
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast.error("Nao foi possivel copiar. Tente manualmente.");
    }
  }

  // ── Confirmed state ──────────────────────────────────────────────────────
  if (status === "confirmed") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center py-8 text-center"
      >
        <div className="h-16 w-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
        </div>
        <h3 className="text-lg font-bold text-foreground mb-1">
          Pagamento confirmado!
        </h3>
        <p className="text-sm text-muted-foreground">
          Redirecionando para o dashboard...
        </p>
      </motion.div>
    );
  }

  // ── Waiting state ────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center py-6"
    >
      {/* QR Code */}
      {qrCodeBase64 ? (
        <div className="rounded-2xl bg-white p-4 mb-5">
          <img
            src={
              qrCodeBase64.startsWith("data:")
                ? qrCodeBase64
                : `data:image/png;base64,${qrCodeBase64}`
            }
            alt="QR Code PIX"
            className="w-48 h-48 object-contain"
          />
        </div>
      ) : (
        <div className="rounded-2xl bg-muted/30 border border-border w-56 h-56 flex items-center justify-center mb-5">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Copy PIX button */}
      {pixPayload && (
        <Button
          variant="outline"
          onClick={handleCopy}
          className="mb-5 h-10 px-5"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 mr-2 text-emerald-400" />
              Copiado!
            </>
          ) : (
            <>
              <Copy className="h-4 w-4 mr-2" />
              Copiar codigo PIX
            </>
          )}
        </Button>
      )}

      {/* Status */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Aguardando pagamento...</span>
      </div>
      <p className="text-xs text-muted-foreground/50 mt-2 text-center max-w-[280px]">
        O status sera atualizado automaticamente apos o pagamento ser
        processado.
      </p>
    </motion.div>
  );
}
