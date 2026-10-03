import { forwardRef } from "react";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SUPPORTED_CURRENCIES, useConvertCurrency } from "@/modules/analytics/hooks/useExchangeRates";

interface CurrencyInputProps {
  value: number | null;
  currency: string;
  onValueChange: (value: number | null) => void;
  onCurrencyChange: (currency: string) => void;
  showConversion?: string; // target currency code to show converted value
  className?: string;
  disabled?: boolean;
}

export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  function CurrencyInput(
    { value, currency, onValueChange, onCurrencyChange, showConversion, className, disabled },
    ref,
  ) {
    const convert = useConvertCurrency();
    const converted = showConversion && value != null
      ? convert(value, currency, showConversion)
      : null;

    const currencyMeta = SUPPORTED_CURRENCIES.find((c) => c.code === currency);

    return (
      <div className={`space-y-1 ${className ?? ""}`}>
        <div className="flex gap-2">
          <Select value={currency} onValueChange={onCurrencyChange} disabled={disabled}>
            <SelectTrigger className="w-[100px] shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_CURRENCIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            {currencyMeta && (
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                {currencyMeta.symbol}
              </span>
            )}
            <Input
              ref={ref}
              type="number"
              min={0}
              step="0.01"
              value={value ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                onValueChange(raw === "" ? null : parseFloat(raw));
              }}
              className={`${currencyMeta ? "pl-8" : ""} tabular-nums`}
              disabled={disabled}
            />
          </div>
        </div>
        {converted != null && showConversion && currency !== showConversion && (
          <p className="text-xs text-muted-foreground tabular-nums">
            ~{new Intl.NumberFormat("pt-BR", { style: "currency", currency: showConversion }).format(converted)}
          </p>
        )}
      </div>
    );
  },
);
