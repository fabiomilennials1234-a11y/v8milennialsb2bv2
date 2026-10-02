import { ValueUnit } from "@/components/ui/bento";

/** R$ sem centavos — para valores de tabela e notas. */
export function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

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

/** Mesma régua de `calculateOTEBonus` (useCommissions.ts) — só o rótulo. */
export function multiplicadorDaMeta(goalProgress: number): { valor: number; rotulo: string } {
  const valor = goalProgress >= 120 ? 1.2 : goalProgress >= 100 ? 1 : goalProgress >= 70 ? 0.7 : 0;
  return { valor, rotulo: `${valor.toLocaleString("pt-BR", { minimumFractionDigits: valor === 0 ? 0 : 1 })}x` };
}

export const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** As faixas reais do acelerador (as mesmas de `calculateOTEBonus`). */
export const FAIXAS_ACELERADOR = [
  { de: 0, ate: 70, mult: "0x", faixa: "abaixo de 70%" },
  { de: 70, ate: 100, mult: "0,7x", faixa: "70% a 99%" },
  { de: 100, ate: 120, mult: "1,0x", faixa: "100% a 119%" },
  { de: 120, ate: 140, mult: "1,2x", faixa: "120% ou mais" },
] as const;
