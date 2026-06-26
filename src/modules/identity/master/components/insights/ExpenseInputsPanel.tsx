import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { AutosaveIndicator, type AutosaveStatus } from "./AutosaveIndicator";
import { formatBRL, formatInt } from "./lib/format";

export type DespesasMode = "detalhado" | "mc";

/** Forma editável dos pressupostos (números puros). */
export interface ExpenseForm {
  anuncios: number;
  /** Custo do produto por unidade (R$). */
  custo_por_produto: number;
  /** 'detalhado' (itens) ou 'mc' (margem de contribuição %). */
  despesas_mode: DespesasMode;
  /** Margem de contribuição (% do ticket) — modo 'mc'. */
  margem_contribuicao_pct: number;
  embalagem: number;
  frete: number;
  imposto_pct: number;
  admin_pct: number;
  comissao_pct: number;
  recompras: number;
  meta_num_vendas: number;
  meta_ticket_medio: number;
}

export interface ExpenseRealRefs {
  anuncios: number;
  custo_por_produto: number;
  margem_contribuicao_pct: number;
  embalagem: number;
  frete: number;
  imposto_pct: number;
  admin_pct: number;
  comissao_pct: number;
  recompras: number;
  num_vendas: number;
  ticket_medio: number;
}

interface ExpenseInputsPanelProps {
  mode: "real" | "projection";
  value: ExpenseForm;
  onChange: (next: ExpenseForm) => void;
  status: AutosaveStatus;
  onRetry?: () => void;
  realRefs?: ExpenseRealRefs;
  /** Margem de contribuição efetiva (% do faturamento) — derivada da engine, p/ exibir no modo detalhado. */
  mcEfetivaPct?: number | null;
}

/** Parser leniente pt-BR: aceita "1.500,50" e "1500.5". */
function parseDecimal(raw: string): number {
  const s = raw.trim();
  if (s === "") return 0;
  let normalized = s.replace(/\s/g, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = normalized.replace(",", ".");
  }
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

type Adorn = "R$" | "%" | "nº";

interface NumberFieldProps {
  label: string;
  adorn: Adorn;
  value: number;
  onChange: (n: number) => void;
  dashed?: boolean;
  realLine?: string;
}

function NumberField({ label, adorn, value, onChange, dashed, realLine }: NumberFieldProps) {
  const id = useId();
  const descId = `${id}-desc`;
  // Texto local p/ digitação livre; ressincroniza se o valor externo mudar.
  const [text, setText] = useState(() => (value ? String(value).replace(".", ",") : ""));

  useEffect(() => {
    const parsed = parseDecimal(text);
    if (parsed !== value) {
      setText(value ? String(value).replace(".", ",") : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const leftAdorn = adorn === "R$";

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[13px] font-medium text-foreground/80">
        {label}
      </Label>
      <div className="relative">
        {leftAdorn && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-medium text-muted-foreground">
            R$
          </span>
        )}
        {!leftAdorn && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] font-medium text-muted-foreground">
            {adorn}
          </span>
        )}
        <input
          id={id}
          inputMode="decimal"
          aria-describedby={realLine ? descId : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(parseDecimal(e.target.value));
          }}
          placeholder="0"
          className={cn(
            "h-10 w-full rounded-lg border bg-background text-[15px] tabular-nums text-foreground",
            "transition-colors placeholder:text-muted-foreground/50",
            "focus-visible:outline-none focus-visible:border-insights/50 focus-visible:ring-2 focus-visible:ring-insights/40",
            leftAdorn ? "pl-9 pr-3" : "pl-3 pr-9",
            dashed ? "border-dashed border-warning/40" : "border-input",
          )}
        />
      </div>
      {realLine && (
        <p id={descId} className="text-[11px] tabular-nums text-muted-foreground">
          {realLine}
        </p>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
      {children}
    </p>
  );
}

/**
 * Painel de despesas & investimento (DESIGN §6 / §11). Controlado: emite
 * `onChange` a cada tecla; o autosave (debounce 600ms por org) vive no pai e
 * alimenta o `AutosaveIndicator` via `status`.
 *
 * `mode='projection'`: inputs `border-dashed`, metas de vendas/ticket no topo e
 * linha-fantasma "Real: R$ X" sob cada campo.
 */
export function ExpenseInputsPanel({
  mode,
  value,
  onChange,
  status,
  onRetry,
  realRefs,
  mcEfetivaPct,
}: ExpenseInputsPanelProps) {
  const projection = mode === "projection";
  const set = (patch: Partial<ExpenseForm>) => onChange({ ...value, ...patch });
  const mc = value.despesas_mode === "mc";

  const realLine = (n: number, opts?: { pct?: boolean; count?: boolean }) => {
    if (!projection || !realRefs) return undefined;
    if (opts?.count) return `Real: ${formatInt(n)}`;
    if (opts?.pct) return `Real: ${formatInt(n)} %`;
    return `Real: ${formatBRL(n)}`;
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base text-foreground">Despesas & Investimento</h2>
        <AutosaveIndicator status={status} onRetry={onRetry} />
      </div>

      <div className="mt-5 space-y-6">
        {projection && (
          <div className="space-y-3">
            <SectionLabel>Metas</SectionLabel>
            <NumberField
              label="Nº de vendas (meta)"
              adorn="nº"
              value={value.meta_num_vendas}
              onChange={(n) => set({ meta_num_vendas: n })}
              dashed
              realLine={realLine(realRefs?.num_vendas ?? 0, { count: true })}
            />
            <NumberField
              label="Ticket médio (meta)"
              adorn="R$"
              value={value.meta_ticket_medio}
              onChange={(n) => set({ meta_ticket_medio: n })}
              dashed
              realLine={realLine(realRefs?.ticket_medio ?? 0)}
            />
          </div>
        )}

        <div className="space-y-3">
          <SectionLabel>Investimento</SectionLabel>
          <NumberField
            label="Anúncios (R$)"
            adorn="R$"
            value={value.anuncios}
            onChange={(n) => set({ anuncios: n })}
            dashed={projection}
            realLine={realLine(realRefs?.anuncios ?? 0)}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>Despesas</SectionLabel>
            <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
              <button
                type="button"
                onClick={() => set({ despesas_mode: "mc" })}
                aria-pressed={mc}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                  mc
                    ? "bg-insights/15 text-insights"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Margem de contrib.
              </button>
              <button
                type="button"
                onClick={() => set({ despesas_mode: "detalhado" })}
                aria-pressed={!mc}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                  !mc
                    ? "bg-insights/15 text-insights"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Detalhar
              </button>
            </div>
          </div>

          {mc ? (
            <>
              <NumberField
                key="despesa-mc"
                label="Margem de contribuição (%)"
                adorn="%"
                value={value.margem_contribuicao_pct}
                onChange={(n) => set({ margem_contribuicao_pct: n })}
                dashed={projection}
                realLine={realLine(realRefs?.margem_contribuicao_pct ?? 0, { pct: true })}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                MC = o que sobra do ticket depois de todos os custos (fora aquisição). Sem
                esse número? Toque <span className="text-foreground/80">Detalhar</span>.
              </p>
            </>
          ) : (
            <>
              <NumberField
                key="despesa-custo-produto"
                label="Custo por produto (R$ / unidade)"
                adorn="R$"
                value={value.custo_por_produto}
                onChange={(n) => set({ custo_por_produto: n })}
                dashed={projection}
                realLine={realLine(realRefs?.custo_por_produto ?? 0)}
              />
              <NumberField
                label="Embalagem (R$)"
                adorn="R$"
                value={value.embalagem}
                onChange={(n) => set({ embalagem: n })}
                dashed={projection}
                realLine={realLine(realRefs?.embalagem ?? 0)}
              />
              <NumberField
                label="Frete (R$)"
                adorn="R$"
                value={value.frete}
                onChange={(n) => set({ frete: n })}
                dashed={projection}
                realLine={realLine(realRefs?.frete ?? 0)}
              />
              <NumberField
                label="Impostos (%)"
                adorn="%"
                value={value.imposto_pct}
                onChange={(n) => set({ imposto_pct: n })}
                dashed={projection}
                realLine={realLine(realRefs?.imposto_pct ?? 0, { pct: true })}
              />
              <NumberField
                label="Despesas administrativas (%)"
                adorn="%"
                value={value.admin_pct}
                onChange={(n) => set({ admin_pct: n })}
                dashed={projection}
                realLine={realLine(realRefs?.admin_pct ?? 0, { pct: true })}
              />
              <NumberField
                label="Comissão (%)"
                adorn="%"
                value={value.comissao_pct}
                onChange={(n) => set({ comissao_pct: n })}
                dashed={projection}
                realLine={realLine(realRefs?.comissao_pct ?? 0, { pct: true })}
              />
              {mcEfetivaPct != null && Number.isFinite(mcEfetivaPct) && (
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  Margem de contribuição ≈ {formatInt(mcEfetivaPct)} %
                </p>
              )}
            </>
          )}
        </div>

        <div className="space-y-3">
          <SectionLabel>Operação</SectionLabel>
          <NumberField
            label="Recompras (nº)"
            adorn="nº"
            value={value.recompras}
            onChange={(n) => set({ recompras: n })}
            dashed={projection}
            realLine={realLine(realRefs?.recompras ?? 0, { count: true })}
          />
        </div>
      </div>
    </div>
  );
}
