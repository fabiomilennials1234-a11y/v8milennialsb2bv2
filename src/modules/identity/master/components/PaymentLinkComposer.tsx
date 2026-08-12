/**
 * PaymentLinkComposer — a tela em que o Master MONTA a proposta e gera o link.
 *
 * TRÊS REGRAS QUE ESTA TELA NÃO PODE QUEBRAR, e as três custaram medição:
 *
 *   1. O FRONT NÃO CALCULA PREÇO. Todo número exibido veio de
 *      `billing_quote_price`, via `useBillingQuote`. O desconto de ciclo é uma
 *      multiplicação de uma linha e por isso é a tentação óbvia — e é
 *      exatamente onde duas implementações divergem no dia em que o catálogo
 *      muda.
 *
 *   2. O DESCONTO NEGOCIADO É MENSAL. O motor lê `p_manual_final_cents` como
 *      preço POR MÊS e recalcula a cobrança para `mensal × meses`. Mandar o
 *      total de um ciclo anual cobra 12× o previsto, sem erro em lugar nenhum
 *      (medido: 21.250 mensal, override de 254.000 → cobrança de 3.048.000).
 *      Por isso o campo se chama "preço mensal negociado", tem sufixo "/mês", e
 *      é comparado com o mensal do motor na própria linha. Renomeação do
 *      parâmetro no banco: issue #1559.
 *
 *   3. PII DO COMPRADOR NÃO VOLTA. Os três campos fiscais vão para
 *      `payment_link_buyers` pela porta `billing_prefill_link_buyer`, na MESMA
 *      transação do link. Não existe leitura de volta, e é decisão: uma porta
 *      que devolvesse nome e e-mail para `authenticated` recriaria a superfície
 *      que a Fatia 8 fechou. O formulário some depois de gerar.
 *
 * E o SKU não aparece: `torque-2.0` é chave estável, o rótulo de vitrine é
 * `display_name`.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Info } from "lucide-react";
import { FEATURES, LIMITS } from "@/modules/platform";
import { useMasterPlans } from "../hooks/useMasterPlans";
import { useMasterOrganizations } from "../hooks/useMasterOrganizations";
import { PlanFeatureCard } from "./PlanFeatureCard";
import { PlanLimitRow } from "./PlanLimitRow";
import {
  countDirections,
  displayDirection,
  featureDirection,
  limitDirection,
  visibleKeys,
  seatFloor,
  seatFloorMessage,
  validateBuyer,
  useBillingQuote,
  useCreatePaymentLink,
  type Direction,
} from "@/modules/billing";
import { QuoteSummary } from "./QuoteSummary";
import { GeneratedLinkDialog } from "./GeneratedLinkDialog";

const CYCLES = [
  { value: "monthly", label: "Mensal" },
  { value: "semiannual", label: "Semestral" },
  { value: "annual", label: "Anual" },
];

const METHODS = [
  { value: "pix", label: "Pix" },
  { value: "credit_card", label: "Cartão de crédito" },
];

/** Sete dias é o padrão da casa para proposta; o operador ajusta. */
const DEFAULT_EXPIRY_DAYS = 7;

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

export function PaymentLinkComposer() {
  const { data: plans } = useMasterPlans();
  const { data: orgs } = useMasterOrganizations();
  const createLink = useCreatePaymentLink();

  const [targetKind, setTargetKind] = useState<"existing_org" | "new_org">("existing_org");
  const [organizationId, setOrganizationId] = useState<string>("");
  const [newOrgName, setNewOrgName] = useState("");
  const [planId, setPlanId] = useState<string>("");
  const [userCount, setUserCount] = useState(5);
  const [billingCycle, setBillingCycle] = useState("annual");
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [expiresAt, setExpiresAt] = useState(() => isoDaysFromNow(DEFAULT_EXPIRY_DAYS));
  const [couponCode, setCouponCode] = useState("");

  const [manualMonthlyReais, setManualMonthlyReais] = useState("");
  const [manualReason, setManualReason] = useState("");

  const [buyerLegalName, setBuyerLegalName] = useState("");
  const [buyerTaxId, setBuyerTaxId] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");

  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [filterOn, setFilterOn] = useState(false);
  const [snapshotKeys, setSnapshotKeys] = useState<Set<string> | null>(null);

  const [generated, setGenerated] = useState<{ token: string; buyerPrefilled: boolean } | null>(null);

  const plan = useMemo(() => plans?.find((p) => p.id === planId), [plans, planId]);

  // O pacote NASCE do plano base e é editado em cima dele. Começar vazio faria
  // toda feature parecer removida no diff — a proposta mais generosa apareceria
  // como a mais pobre.
  const basePackage = useMemo(() => {
    if (!plan) return { features: {} as Record<string, boolean>, limits: {} as Record<string, number> };
    return { features: plan.features ?? {}, limits: plan.limits ?? {} };
  }, [plan]);

  function selectPlan(id: string) {
    const next = plans?.find((p) => p.id === id);
    setPlanId(id);
    setFeatures({ ...(next?.features ?? {}) });
    setLimits({ ...(next?.limits ?? {}) });
    // Trocar de plano zera o retrato do filtro: as diferenças eram contra OUTRO
    // base, e mantê-las mostraria "concedido" para coisa que agora é padrão.
    setFilterOn(false);
    setSnapshotKeys(null);
    if (next?.included_users) setUserCount(next.included_users);
  }

  const manualMonthlyCents = useMemo(() => {
    const parsed = Number(manualMonthlyReais.replace(/\./g, "").replace(",", "."));
    if (!manualMonthlyReais.trim() || !Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round(parsed * 100);
  }, [manualMonthlyReais]);

  const quoteInput = useMemo(
    () => ({
      planId: planId || null,
      userCount,
      billingCycle,
      paymentMethod,
      couponCode: couponCode.trim() || null,
      manualFinalMonthlyCents: manualMonthlyCents,
    }),
    [planId, userCount, billingCycle, paymentMethod, couponCode, manualMonthlyCents],
  );

  const { data: quote, isLoading, isStale, error } = useBillingQuote(quoteInput);

  const floor = seatFloor(userCount, plan?.included_users ?? quote?.included_seats ?? 0);
  const floorMessage = seatFloorMessage(floor);

  // As listas vêm do CATÁLOGO, não das chaves que o plano por acaso tem
  // gravadas. Plano salvo antes de uma feature existir não traz a chave, e
  // iterar o objeto do plano esconderia justamente a feature nova — que é a que
  // o operador mais precisa poder conceder.
  const featureKeys = FEATURES.map((f) => f.key);
  const limitKeys = LIMITS.map((l) => l.key);
  const featureMeta = useMemo(() => new Map(FEATURES.map((f) => [f.key, f])), []);
  const limitMeta = useMemo(() => new Map(LIMITS.map((l) => [l.key, l])), []);

  const directionByKey = useMemo(() => {
    const map = new Map<string, Direction>();
    featureKeys.forEach((k) =>
      map.set(`f:${k}`, featureDirection(!!features[k], !!basePackage.features[k])),
    );
    limitKeys.forEach((k) =>
      map.set(`l:${k}`, limitDirection(limits[k] ?? 0, basePackage.limits[k] ?? 0)),
    );
    return map;
  }, [featureKeys, limitKeys, features, limits, basePackage]);

  const diffKeys = useMemo(
    () => new Set([...directionByKey].filter(([, d]) => d !== "same").map(([k]) => k)),
    [directionByKey],
  );

  const counts = countDirections([...directionByKey.values()]);

  function toggleFilter(next: boolean) {
    // R2: religar tira retrato NOVO. É o único jeito de um item sair da lista,
    // e é ato deliberado do operador.
    setFilterOn(next);
    setSnapshotKeys(next ? new Set(diffKeys) : null);
  }

  const visibleFeatureKeys = visibleKeys(
    featureKeys.map((k) => `f:${k}`),
    diffKeys,
    filterOn,
    snapshotKeys,
  );
  const visibleLimitKeys = visibleKeys(
    limitKeys.map((k) => `l:${k}`),
    diffKeys,
    filterOn,
    snapshotKeys,
  );

  const targetOk =
    targetKind === "existing_org" ? !!organizationId : newOrgName.trim().length >= 2;
  const discountOk = manualMonthlyCents === null || manualReason.trim().length >= 3;

  // A validação do comprador acontece ANTES de enviar, e o motivo é o canal de
  // PII: documento inválido faz a porta do banco levantar 22023, e o evento de
  // erro nasce carregando o payload — CPF e e-mail junto. O valor inválido não
  // sair daqui é o que impede o erro que o carregaria de existir.
  const buyerErrors = validateBuyer({
    legalName: buyerLegalName,
    taxId: buyerTaxId,
    email: buyerEmail,
  });
  const buyerOk = buyerErrors === null || Object.keys(buyerErrors).length === 0;

  const canGenerate =
    !!planId && targetOk && discountOk && buyerOk && !!quote && !isStale && !createLink.isPending;

  async function handleGenerate() {
    if (!planId) return;
    const result = await createLink.mutateAsync({
      targetKind,
      organizationId: targetKind === "existing_org" ? organizationId : null,
      newOrgName: targetKind === "new_org" ? newOrgName.trim() : null,
      planId,
      userCount,
      billingCycle,
      paymentMethod,
      expiresAt: new Date(expiresAt).toISOString(),
      packageFeatures: features,
      packageLimits: limits,
      couponCode: couponCode.trim() || null,
      manualFinalMonthlyCents: manualMonthlyCents,
      manualDiscountReason: manualMonthlyCents === null ? null : manualReason.trim(),
      buyerLegalName: buyerLegalName.trim() || null,
      buyerTaxId: buyerTaxId.trim() || null,
      buyerEmail: buyerEmail.trim() || null,
    });

    setGenerated({ token: result.token, buyerPrefilled: result.buyer_prefilled });
    // Os campos fiscais somem da tela junto com o sucesso: eles já estão na
    // tabela do comprador, e deixá-los aqui é PII parada numa tela aberta.
    setBuyerLegalName("");
    setBuyerTaxId("");
    setBuyerEmail("");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        {/* ---------------------------------------------------------------- */}
        <section className="space-y-4">
          <h3 className="text-sm font-medium">Para quem é a proposta</h3>

          <div className="flex gap-2">
            <Button
              type="button"
              variant={targetKind === "existing_org" ? "default" : "outline"}
              size="sm"
              onClick={() => setTargetKind("existing_org")}
            >
              Organização existente
            </Button>
            <Button
              type="button"
              variant={targetKind === "new_org" ? "default" : "outline"}
              size="sm"
              onClick={() => setTargetKind("new_org")}
            >
              Organização nova
            </Button>
          </div>

          {targetKind === "existing_org" ? (
            <div className="space-y-2">
              <Label htmlFor="org">Organização</Label>
              <Select value={organizationId} onValueChange={setOrganizationId}>
                <SelectTrigger id="org">
                  <SelectValue placeholder="Escolha a organização" />
                </SelectTrigger>
                <SelectContent>
                  {orgs?.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="new-org">Nome da organização a criar</Label>
              <Input
                id="new-org"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="Ex.: Metalúrgica Andrade"
              />
              <p className="text-xs text-muted-foreground">
                A organização é criada quando o pagamento confirmar, com o e-mail do comprador.
              </p>
            </div>
          )}
        </section>

        <Separator />

        {/* ---------------------------------------------------------------- */}
        <section className="space-y-4">
          <h3 className="text-sm font-medium">Plano e ciclo</h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="plan">Plano</Label>
              <Select value={planId} onValueChange={selectPlan}>
                <SelectTrigger id="plan">
                  <SelectValue placeholder="Escolha o plano" />
                </SelectTrigger>
                <SelectContent>
                  {plans
                    ?.filter((p) => p.is_active)
                    .map((p) => (
                      // display_name, nunca o SKU: `torque-2.0` é chave estável,
                      // não rótulo de vitrine.
                      <SelectItem key={p.id} value={p.id}>
                        {p.display_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="seats">Assentos</Label>
              <Input
                id="seats"
                type="number"
                min={1}
                value={userCount}
                onChange={(e) => setUserCount(Math.max(1, Number(e.target.value) || 1))}
              />
              {floorMessage && (
                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
                  <span>{floorMessage}</span>
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="cycle">Ciclo</Label>
              <Select value={billingCycle} onValueChange={setBillingCycle}>
                <SelectTrigger id="cycle">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CYCLES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="method">Forma de pagamento</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger id="method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <Separator />

        {/* ---------------------------------------------------------------- */}
        {plan && (
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium">Pacote</h3>
                <p className="text-xs text-muted-foreground">
                  {counts.total === 0
                    ? "Igual ao plano base"
                    : `${counts.up} a mais · ${counts.down} a menos`}
                </p>
              </div>

              {/* R3: o interruptor só some com ZERO diferenças E filtro
                  desligado — senão ele desapareceria debaixo do dedo de quem
                  acabou de ligá-lo. */}
              {(counts.total > 0 || filterOn) && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="only-diff" className="text-xs text-muted-foreground">
                    Só diferenças
                  </Label>
                  <Switch id="only-diff" checked={filterOn} onCheckedChange={toggleFilter} />
                </div>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {visibleFeatureKeys.map((prefixed) => {
                const key = prefixed.slice(2);
                const meta = featureMeta.get(key as never);
                if (!meta) return null;
                return (
                  <PlanFeatureCard
                    key={key}
                    feature={meta}
                    enabled={!!features[key]}
                    delta={displayDirection(
                      prefixed,
                      directionByKey.get(prefixed) ?? "same",
                      filterOn,
                      snapshotKeys,
                    )}
                    onToggle={(featureKey, next) =>
                      setFeatures((prev) => ({ ...prev, [featureKey]: next }))
                    }
                  />
                );
              })}
            </div>

            <div className="space-y-2">
              {visibleLimitKeys.map((prefixed) => {
                const key = prefixed.slice(2);
                const meta = limitMeta.get(key as never);
                return (
                  <PlanLimitRow
                    key={key}
                    label={meta?.label ?? key}
                    description={meta?.description}
                    value={limits[key] ?? 0}
                    baseValue={basePackage.limits[key] ?? 0}
                    displayAs={displayDirection(
                      prefixed,
                      directionByKey.get(prefixed) ?? "same",
                      filterOn,
                      snapshotKeys,
                    )}
                    onChange={(next) => setLimits((prev) => ({ ...prev, [key]: next }))}
                  />
                );
              })}
            </div>
          </section>
        )}

        <Separator />

        {/* ---------------------------------------------------------------- */}
        <section className="space-y-4">
          <h3 className="text-sm font-medium">Negociação</h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="coupon">Cupom</Label>
              <Input
                id="coupon"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                placeholder="Opcional"
              />
              <p className="text-xs text-muted-foreground">
                Quem aplica o desconto é o motor — a tela passa só o código.
              </p>
            </div>

            <div className="space-y-2">
              {/* O rótulo diz MENSAL, o sufixo diz /mês, e o texto de apoio
                  compara com o mensal do motor. Três avisos para o mesmo campo
                  porque errar aqui cobra 12× do cliente. */}
              <Label htmlFor="manual">Preço mensal negociado</Label>
              <div className="relative">
                <Input
                  id="manual"
                  inputMode="decimal"
                  value={manualMonthlyReais}
                  onChange={(e) => setManualMonthlyReais(e.target.value)}
                  placeholder="Opcional"
                  className="pr-14"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  /mês
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Valor <strong>por mês</strong>, não o total do ciclo.
                {quote && (
                  <> Sem negociação, o mensal é {(quote.monthly_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.</>
                )}
              </p>
            </div>
          </div>

          {manualMonthlyCents !== null && (
            <div className="space-y-2">
              <Label htmlFor="reason">Motivo da concessão</Label>
              <Textarea
                id="reason"
                value={manualReason}
                onChange={(e) => setManualReason(e.target.value)}
                rows={2}
                placeholder="Fica no rastro de auditoria, com o seu nome."
              />
              {!discountOk && (
                <p className="text-xs text-destructive">
                  O banco recusa desconto sem motivo — não é validação de tela, é constraint.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2 max-w-xs">
            <Label htmlFor="expires">Validade do link</Label>
            <Input
              id="expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
        </section>

        <Separator />

        {/* ---------------------------------------------------------------- */}
        <section className="space-y-4">
          <div>
            <h3 className="text-sm font-medium">Comprador (opcional)</h3>
            <p className="text-xs text-muted-foreground">
              Pré-preencher poupa o cliente de digitar. O que ele digitar no checkout corrige o
              que você colocar aqui — é a mesma linha. Os três campos andam juntos: preencha os
              três ou nenhum.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="buyer-name">Nome / razão social</Label>
              <Input
                id="buyer-name"
                value={buyerLegalName}
                onChange={(e) => setBuyerLegalName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="buyer-tax">CPF ou CNPJ</Label>
              <Input
                id="buyer-tax"
                value={buyerTaxId}
                onChange={(e) => setBuyerTaxId(e.target.value)}
                placeholder="Só números ou formatado"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="buyer-email">E-mail</Label>
              <Input
                id="buyer-email"
                type="email"
                value={buyerEmail}
                onChange={(e) => setBuyerEmail(e.target.value)}
              />
            </div>
          </div>

          {buyerErrors?.incomplete && (
            <p className="text-xs text-destructive">{buyerErrors.incomplete}</p>
          )}
          {buyerErrors?.taxId && <p className="text-xs text-destructive">{buyerErrors.taxId}</p>}
          {buyerErrors?.email && <p className="text-xs text-destructive">{buyerErrors.email}</p>}

          <p className="text-xs text-muted-foreground">
            Estes dados não voltam para esta tela depois de gravados, por decisão de segurança.
          </p>
        </section>
      </div>

      {/* ------------------------------------------------------------------ */}
      <aside className="lg:sticky lg:top-6 h-fit space-y-4 rounded-xl border p-5">
        <h3 className="text-sm font-medium">Composição do preço</h3>
        <QuoteSummary
          quote={quote}
          isLoading={isLoading}
          isStale={isStale}
          error={(error as Error) ?? null}
        />

        <Button
          className="w-full"
          disabled={!canGenerate}
          onClick={() =>
            handleGenerate().catch(() => {
              /* o toast do hook já falou; aqui só evita rejeição solta */
            })
          }
        >
          {createLink.isPending ? "Gerando…" : "Gerar link de pagamento"}
        </Button>

        {isStale && quote && (
          <p className="text-xs text-muted-foreground">
            O botão volta quando a cotação alcançar o que está na tela — link com preço velho é
            proposta errada.
          </p>
        )}
      </aside>

      <GeneratedLinkDialog
        token={generated?.token ?? null}
        buyerPrefilled={generated?.buyerPrefilled ?? false}
        onClose={() => {
          setGenerated(null);
          toast.info("O link não é recuperável. Se não copiou, gere outro e revogue este.");
        }}
      />
    </div>
  );
}
