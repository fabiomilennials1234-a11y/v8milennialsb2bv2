/**
 * SaleValueRequiredModal — the money-entry moment before a lead enters `won`.
 *
 * Shown by `useSaleValueGuard` when a won-transition is attempted on an entry
 * with no usable `sale_value`. On confirm the value is threaded into the SAME
 * mutation that writes the won stage_key, so `fn_capture_sale_event` snapshots
 * it (D1 / SQL-I3). On cancel the card does NOT move.
 *
 * Dark-first, editorial. RHF + Zod, currency-formatted BRL input, inline
 * validation (> 0), Enter submits / Esc cancels, focus trap via Radix Dialog.
 */

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { DollarSign, TrendingUp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const saleValueSchema = z.object({
  saleValue: z
    .number({ invalid_type_error: "Informe um valor" })
    .positive("O valor precisa ser maior que zero"),
});

type SaleValueForm = z.infer<typeof saleValueSchema>;

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 0,
});

interface SaleValueRequiredModalProps {
  open: boolean;
  onConfirm: (value: number) => void;
  onCancel: () => void;
  /** Optional lead / proposal name for context in the header. */
  leadName?: string;
  /** Optional pre-fill (e.g. items sum) — user still confirms. */
  defaultValue?: number | null;
}

export function SaleValueRequiredModal({
  open,
  onConfirm,
  onCancel,
  leadName,
  defaultValue,
}: SaleValueRequiredModalProps) {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setFocus,
    formState: { errors },
  } = useForm<SaleValueForm>({
    resolver: zodResolver(saleValueSchema),
    defaultValues: { saleValue: defaultValue ?? undefined },
  });

  // Reset + focus each time the modal opens so a reused instance starts clean.
  useEffect(() => {
    if (open) {
      reset({ saleValue: defaultValue ?? undefined });
      // Defer focus until Radix mounts the content.
      const t = setTimeout(() => setFocus("saleValue"), 60);
      return () => clearTimeout(t);
    }
  }, [open, defaultValue, reset, setFocus]);

  const current = watch("saleValue");
  const preview =
    typeof current === "number" && Number.isFinite(current) && current > 0
      ? brl.format(current)
      : null;

  const saleValueField = register("saleValue", { valueAsNumber: true });

  const submit = handleSubmit((data) => onConfirm(data.saleValue));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/20">
              <TrendingUp className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <DialogTitle>Valor da venda</DialogTitle>
              <DialogDescription className="mt-0.5">
                {leadName ? (
                  <>
                    Informe o valor fechado com{" "}
                    <span className="text-foreground font-medium">{leadName}</span>{" "}
                    antes de marcar como vendido.
                  </>
                ) : (
                  "Informe o valor fechado antes de marcar como vendido."
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-2 pt-1">
          <label
            htmlFor="sale-value-input"
            className="text-sm font-medium text-muted-foreground"
          >
            Valor total (BRL)
          </label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="sale-value-input"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="0,00"
              className={cn(
                "pl-9 tabular-nums text-lg",
                errors.saleValue && "border-destructive focus-visible:ring-destructive",
              )}
              aria-invalid={!!errors.saleValue}
              {...saleValueField}
            />
          </div>
          <div className="flex min-h-[20px] items-center justify-between">
            {errors.saleValue ? (
              <p className="text-xs text-destructive">{errors.saleValue.message}</p>
            ) : preview ? (
              <p className="text-xs text-muted-foreground tabular-nums">
                Registrando <span className="text-emerald-400">{preview}</span>
              </p>
            ) : (
              <span />
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
            <Button
              type="submit"
              className="bg-emerald-600 text-white hover:bg-emerald-600/90"
            >
              Confirmar venda
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
