import { ValueUnit } from "@/components/ui/bento";

/**
 * R$ com os centavos menores (`ValueUnit`) — o número-herói do V5. A cor dos
 * centavos acompanha a superfície: na tinta, no ouro e no cartão ela muda.
 */
export function Dinheiro({ value, centsClassName }: { value: number; centsClassName?: string }) {
  const full = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  const i = full.lastIndexOf(",");
  if (i < 0) return <>{full}</>;
  return (
    <>
      {full.slice(0, i)}
      <ValueUnit className={centsClassName}>{full.slice(i)}</ValueUnit>
    </>
  );
}
