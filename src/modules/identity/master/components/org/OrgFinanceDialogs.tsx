/**
 * Diálogos do financeiro da central Organizações: a mensalidade de contrato de
 * uma org e os custos unitários da operação. Ambos gravam por RPC auditada.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatBRL, maskCurrencyInput, parseCurrencyInput } from "@/lib/format";
import { useSetCostSettings, useSetOrgMonthlyFee } from "../../hooks/useOrgFinance";
import type { CostSettings, OrgFinance } from "../../lib/org-finance";

const centsToMask = (cents: number) => (cents > 0 ? maskCurrencyInput(String(cents)) : "");
const maskToCents = (masked: string) => Math.round(parseCurrencyInput(masked) * 100);

/** Aceita "0,40" e "0.40"; vazio ou inválido vira 0. */
const parseDecimal = (raw: string) => {
  const n = Number(raw.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const decimalToText = (n: number) => (n > 0 ? String(n).replace(".", ",") : "");

interface MonthlyFeeDialogProps {
  org: { id: string; name: string } | null;
  finance: OrgFinance | undefined;
  notes: string | null;
  onOpenChange: (open: boolean) => void;
}

/** O formulário remonta por org (`key`): o estado nasce dos props uma vez e não reseta enquanto se digita. */
export function MonthlyFeeDialog(props: MonthlyFeeDialogProps) {
  if (!props.org) return null;
  return <MonthlyFeeForm key={props.org.id} {...props} org={props.org} />;
}

function MonthlyFeeForm({
  org,
  finance,
  notes,
  onOpenChange,
}: MonthlyFeeDialogProps & { org: { id: string; name: string } }) {
  const setFee = useSetOrgMonthlyFee();
  const [valor, setValor] = useState(() =>
    finance?.feeSource === "contrato" ? centsToMask(finance.feeCents) : "",
  );
  const [obs, setObs] = useState(notes ?? "");

  const temContrato = finance?.feeSource === "contrato";
  const estimativa = finance?.feeSource === "tabela" ? finance.feeCents : null;

  const salvar = (feeCents: number | null) =>
    setFee.mutate(
      { orgId: org.id, feeCents, notes: feeCents === null ? null : obs.trim() || null },
      { onSuccess: () => onOpenChange(false) },
    );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mensalidade · {org.name}</DialogTitle>
          <DialogDescription>
            Quanto a org paga ao Torque por mês, pelo contrato. Entra na receita e na margem.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="fee">Valor mensal</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
              <Input
                id="fee"
                inputMode="numeric"
                className="pl-9 tabular-nums"
                placeholder={estimativa != null ? centsToMask(estimativa) : "0,00"}
                value={valor}
                onChange={(e) => setValor(maskCurrencyInput(e.target.value))}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {estimativa != null && !temContrato
                ? `Hoje estimado pela tabela do plano: ${formatBRL(estimativa / 100)}. `
                : ""}
              Deixe vazio para cortesia (R$ 0).
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fee-notes">Observação</Label>
            <Textarea
              id="fee-notes"
              rows={2}
              placeholder="Ex.: contrato anual, desconto de implantação até dez/26"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {temContrato ? (
            <Button variant="ghost" onClick={() => salvar(null)} disabled={setFee.isPending}>
              Voltar para a estimativa
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            {/* Vazio grava R$ 0: org cortesia/parceira é contrato legítimo. */}
            <Button onClick={() => salvar(maskToCents(valor))} disabled={setFee.isPending}>
              {setFee.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CostSettingsDialog({
  open,
  onOpenChange,
  settings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: CostSettings | undefined;
}) {
  const save = useSetCostSettings();
  const [chip, setChip] = useState("");
  const [infra, setInfra] = useState("");
  const [llmIn, setLlmIn] = useState("");
  const [llmOut, setLlmOut] = useState("");
  const [cambio, setCambio] = useState("");

  useEffect(() => {
    if (!open || !settings) return;
    setChip(centsToMask(settings.chip_monthly_cents));
    setInfra(centsToMask(settings.infra_fixed_monthly_cents));
    setLlmIn(decimalToText(settings.llm_input_usd_per_mtok));
    setLlmOut(decimalToText(settings.llm_output_usd_per_mtok));
    setCambio(decimalToText(settings.usd_brl));
  }, [open, settings]);

  const salvar = () =>
    save.mutate(
      {
        chip_monthly_cents: maskToCents(chip),
        infra_fixed_monthly_cents: maskToCents(infra),
        llm_input_usd_per_mtok: parseDecimal(llmIn),
        llm_output_usd_per_mtok: parseDecimal(llmOut),
        usd_brl: parseDecimal(cambio),
      },
      { onSuccess: () => onOpenChange(false) },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Custos da operação</DialogTitle>
          <DialogDescription>
            Preços unitários usados no custo de cada org. Infra fixa é dividida igualmente entre as orgs ativas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <MoneyField id="cost-chip" label="Chip Uazapi (por mês)" value={chip} onChange={setChip} />
          <MoneyField id="cost-infra" label="Infra fixa (por mês)" value={infra} onChange={setInfra} hint="Supabase, servidor, ferramentas" />
          <DecimalField id="cost-llm-in" label="LLM entrada" suffix="US$ / 1M tokens" value={llmIn} onChange={setLlmIn} />
          <DecimalField id="cost-llm-out" label="LLM saída" suffix="US$ / 1M tokens" value={llmOut} onChange={setLlmOut} />
          <DecimalField id="cost-fx" label="Câmbio" suffix="R$ por US$" value={cambio} onChange={setCambio} />
        </div>
        <p className="text-xs text-muted-foreground">
          O custo de LLM é um piso: só o Copilot V1 e o Oráculo registram tokens hoje.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={save.isPending || !settings}>
            {save.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoneyField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
        <Input
          id={id}
          inputMode="numeric"
          className="pl-9 tabular-nums"
          placeholder="0,00"
          value={value}
          onChange={(e) => onChange(maskCurrencyInput(e.target.value))}
        />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function DecimalField({
  id,
  label,
  suffix,
  value,
  onChange,
}: {
  id: string;
  label: string;
  suffix: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="decimal"
        className="tabular-nums"
        placeholder="0,00"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
      />
      <p className="text-xs text-muted-foreground">{suffix}</p>
    </div>
  );
}
