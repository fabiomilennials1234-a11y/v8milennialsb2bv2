import { useState } from "react";
import {
  CreditCard,
  ExternalLink,
  RefreshCw,
  Receipt,
  Users,
  MessageSquare,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FocusCard, FocusTile, InkPanel } from "@/components/ui/bento";
import { useIdentity, useOrganization } from "@/modules/identity";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  BILLING_PAGE_SIZE,
  useBillingAccount,
} from "../hooks/useBillingAccount";
import {
  billingDate,
  cycleLabel,
  documentUrl,
  methodLabel,
  money,
  paymentLabels,
  subscriptionLabels,
} from "../lib/billing-display";
import type { Json } from "@/integrations/supabase/types";

type Props = { onContactSupport?: () => void };

/*
 * V5 (2026-10): mesma área, mesmos estados e mesmos textos. Onda "mais perto do
 * mockup": as sub-abas viram uma página só — Visão geral em tinta (plano e
 * limites em vidro) com a renovação no cartão de ouro, depois a grade de
 * planos só para comparar, o histórico e pagamento e ajuda.
 */
const ALERT_CARD = "rounded-card border-card-border bg-card shadow-relevo";
const ALERT_BAD = "rounded-card border-destructive/30 bg-destructive/5";

/** Tom da situação da cobrança — o rótulo é o mesmo; o tom só reforça. */
function paymentBadgeClass(status: string) {
  switch (status.toUpperCase()) {
    case "RECEIVED":
    case "CONFIRMED":
    case "PAID":
      return "border-transparent bg-success/10 text-success";
    case "OVERDUE":
    case "FAILED":
    case "CHARGEBACK_REQUESTED":
      return "border-transparent bg-destructive/10 text-destructive";
    case "PENDING":
    case "REFUND_REQUESTED":
      return "border-transparent bg-warning/15 text-warning-strong";
    default:
      return "border-transparent bg-muted text-foreground/75";
  }
}

function ReadError({ retry }: { retry: () => void }) {
  return (
    <Alert variant="destructive" className={ALERT_BAD}>
      <AlertTitle>Não foi possível carregar esta seção</AlertTitle>
      <AlertDescription>
        Os dados da sua assinatura permanecem preservados.
      </AlertDescription>
      <Button variant="outline" size="sm" onClick={retry} className="mt-3">
        Tentar novamente
      </Button>
    </Alert>
  );
}
function Loading() {
  return (
    <div
      role="status"
      aria-label="Carregando dados de cobrança"
      className="grid gap-3"
    >
      <Skeleton className="h-24 w-full rounded-card" />
      <Skeleton className="h-40 w-full rounded-card" />
    </div>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** Mesmo `Detail`, no cartão de ouro do plano. */
function GoldDetail({ label, value }: { label: string; value: string }) {
  return (
    <FocusTile className="flex flex-col gap-1">
      <dt className="text-[11px] font-bold text-primary-foreground/70">{label}</dt>
      <dd className="text-[15px] font-extrabold tabular-nums tracking-[-0.02em]">{value}</dd>
    </FocusTile>
  );
}
function DocumentLink({
  url,
  children,
}: {
  url: string | null;
  children: string;
}) {
  const safe = documentUrl(url);
  return safe ? (
    <Button variant="outline" size="sm" asChild>
      <a href={safe} target="_blank" rel="noopener noreferrer">
        {children}
        <ExternalLink className="size-3" />
      </a>
    </Button>
  ) : null;
}

const resources = [
  { key: "max_users", label: "Pessoas na equipe", icon: Users },
  {
    key: "max_whatsapp_instances",
    label: "Conexões de WhatsApp",
    icon: MessageSquare,
  },
  { key: "max_copilot_agents", label: "Agentes de IA", icon: Bot },
];
function Quotas({ value }: { value: Json | undefined }) {
  const quotas =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  // V5: os limites viram vidros dentro do painel de tinta da Visão geral.
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {resources.map((resource) => {
        const item = quotas[resource.key];
        const quota =
          item && typeof item === "object" && !Array.isArray(item)
            ? item
            : null;
        const used =
          typeof quota?.current_usage === "number" ? quota.current_usage : null;
        const limit =
          typeof quota?.effective_limit === "number"
            ? quota.effective_limit
            : null;
        const unlimited = quota?.is_unlimited === true;
        const known = used !== null && limit !== null;
        const over = known && !unlimited && used > limit;
        const Icon = resource.icon;
        return (
          <div
            key={resource.key}
            className="flex min-w-0 flex-col gap-2 rounded-[22px] border border-tinta-line bg-tinta-2 p-4"
          >
            <p className="flex items-center gap-2 text-[12.5px] font-semibold text-tinta-muted">
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {resource.label}
            </p>
            {known ? (
              <p className={cn("text-[1.9rem] font-extrabold leading-none tracking-[-0.04em] tabular-nums", over && "text-destructive")}>
                {used}
                <span className="text-[0.55em] font-bold tracking-normal text-tinta-muted">
                  {" / "}
                  {unlimited ? "ilimitado" : limit}
                </span>
              </p>
            ) : (
              <p className="text-[15px] font-bold text-tinta-muted">Não informado</p>
            )}
            {known && !unlimited && (
              <Progress
                aria-label={`Uso de ${resource.label}`}
                className={cn("h-1.5 bg-white/10", over ? "[&>div]:bg-destructive" : "[&>div]:bg-primary")}
                value={
                  limit > 0
                    ? Math.min(100, (used / limit) * 100)
                    : used > 0
                      ? 100
                      : 0
                }
              />
            )}
            <p className="text-[11.5px] text-tinta-muted">
              {!known
                ? "O limite ainda não está disponível."
                : unlimited
                  ? "Sem limite de quantidade."
                  : `${Math.max(0, limit - used)} disponíveis${used > limit ? " · Uso acima do limite" : ""}`}
            </p>
          </div>
        );
      })}
    </div>
  );
}

type PlanoDoCatalogo = {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  price_monthly: number | null;
  included_users: number | null;
  included_copilots: number | null;
};

/** Grade de planos SÓ para comparar — sem "mudar para", o checkout não existe. */
function GradeDePlanos({ planos, atual }: { planos: PlanoDoCatalogo[]; atual: string | null | undefined }) {
  if (!planos.length) return null;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
      {planos.map((p) => {
        const meu = !!atual && (p.display_name === atual || p.name === atual);
        return (
          <div
            key={p.id}
            className={cn(
              "flex min-w-0 flex-col gap-2 rounded-2xl border p-4",
              meu ? "border-primary bg-primary-soft text-primary-soft-foreground" : "border-border bg-sunken",
            )}
          >
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[15px] font-extrabold tracking-[-0.02em]">{p.display_name}</p>
              {meu && <Badge variant="ink">Seu plano</Badge>}
            </div>
            <p className="text-[1.35rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums">
              {p.price_monthly != null ? money(p.price_monthly) : "Sob consulta"}
              {p.price_monthly != null && <span className="ml-1 text-[12px] font-semibold tracking-normal opacity-70">/mês</span>}
            </p>
            {p.description && <p className="line-clamp-2 text-[12.5px] opacity-80">{p.description}</p>}
            <ul className="mt-auto space-y-0.5 text-[12px] font-semibold opacity-80">
              {p.included_users != null && <li>{p.included_users} {p.included_users === 1 ? "pessoa incluída" : "pessoas incluídas"}</li>}
              {p.included_copilots != null && <li>{p.included_copilots} {p.included_copilots === 1 ? "agente de IA" : "agentes de IA"}</li>}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function BillingSettings(props: Props) {
  const { organizationId, isLoading, error } = useOrganization();
  const { isAdmin } = useIdentity();
  if (!isAdmin)
    return (
      <Alert className={ALERT_CARD}>
        <AlertTitle>Acesso restrito</AlertTitle>
        <AlertDescription>
          Somente administradores podem consultar esta área.
        </AlertDescription>
      </Alert>
    );
  if (isLoading) return <Loading />;
  if (error)
    return (
      <Alert variant="destructive" className={ALERT_BAD}>
        <AlertTitle>Organização indisponível</AlertTitle>
        <AlertDescription>
          Não foi possível identificar a organização atual. Tente selecioná-la
          novamente.
        </AlertDescription>
      </Alert>
    );
  if (!organizationId)
    return (
      <Alert className={ALERT_CARD}>
        <AlertTitle>Selecione uma organização</AlertTitle>
        <AlertDescription>
          A assinatura e as cobranças pertencem à organização selecionada.
        </AlertDescription>
      </Alert>
    );
  // Remontar ao trocar de organização impede preservar página ou detalhes da anterior.
  return (
    <BillingAccount
      key={organizationId}
      organizationId={organizationId}
      {...props}
    />
  );
}

function BillingAccount({
  organizationId,
  onContactSupport,
}: Props & { organizationId: string }) {
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { account, history, quotas, plans } = useBillingAccount(
    organizationId,
    true,
    page,
  );
  const org = account.data?.organization;
  const sub = account.data?.subscription;
  const selected = history.data?.rows.find((row) => row.id === selectedId);
  const refresh = () => {
    void account.refetch();
    void history.refetch();
    void quotas.refetch();
  };
  const fetching =
    account.isFetching || history.isFetching || quotas.isFetching;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-bold tracking-[-0.02em]">Assinatura e cobrança</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {org?.name ?? "Sua organização"} · Plano, utilização e pagamentos em
            um só lugar.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={fetching}
        >
          <RefreshCw className={cn(fetching && "animate-spin")} />
          {fetching ? "Atualizando…" : "Atualizar"}
        </Button>
      </div>

      {/* V5: as quatro sub-abas viraram UMA página com seções — Visão geral em
          tinta com a renovação no ouro, depois limites e planos, histórico e
          pagamento. Mesmos dados, mesmos textos. */}
      {account.isPending ? (
        <Loading />
      ) : account.isError ? (
        <ReadError retry={() => void account.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          {org?.billing_override && (
            <Alert className={ALERT_CARD}>
              <AlertTitle>Acesso liberado pela equipe Torque</AlertTitle>
              <AlertDescription>
                Esta liberação não representa confirmação de pagamento.
                Consulte abaixo o plano e o histórico registrado.
              </AlertDescription>
            </Alert>
          )}
          {org &&
            ["overdue", "expired", "suspended", "cancelled"].includes(
              org.subscription_status,
            ) && (
              <Alert variant="destructive" className={ALERT_BAD}>
                <AlertTitle>
                  Assinatura{" "}
                  {subscriptionLabels[
                    org.subscription_status
                  ]?.toLowerCase()}
                </AlertTitle>
                <AlertDescription>
                  Confira as cobranças registradas ou fale com a equipe para
                  regularizar sua assinatura.
                </AlertDescription>
              </Alert>
            )}
          <InkPanel
            title="Visão geral"
            count={subscriptionLabels[org?.subscription_status ?? ""] ?? "Situação não informada"}
          >
            <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
              <div className="order-2 flex min-w-0 flex-col gap-4 px-1.5 lg:order-1">
                <div>
                  <p className="text-[12px] font-semibold text-tinta-muted">Plano atual</p>
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    <h3 className="text-[clamp(2rem,4vw,2.8rem)] font-extrabold leading-none tracking-[-0.045em]">
                      {(plans?.data as PlanoDoCatalogo[] | undefined)?.find((p) => p.name === account.data?.planName)?.display_name ||
                        account.data?.planName ||
                        "Plano não informado"}
                    </h3>
                    {sub && (
                      <span className="rounded-full bg-white/10 px-2.5 py-1 text-[12px] font-bold">
                        {cycleLabel(sub.billing_cycle)}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-[13px] text-tinta-muted">
                    {sub
                      ? "Condições da assinatura contratada."
                      : "Ainda não há um contrato de pagamento registrado nesta área."}
                  </p>
                </div>
                {quotas.isPending ? (
                  <Skeleton className="h-28 rounded-2xl bg-white/[.07]" />
                ) : quotas.isError ? (
                  <div className="rounded-2xl bg-white/[.06] p-3 text-[12.5px] text-tinta-muted">
                    Não foi possível carregar os limites.{" "}
                    <button type="button" className="font-semibold text-tinta-foreground underline" onClick={() => void quotas.refetch()}>
                      Tentar novamente
                    </button>
                  </div>
                ) : (
                  <Quotas value={quotas.data} />
                )}
              </div>
              <FocusCard className="order-1 lg:order-2">
                <Badge variant="ink" className="w-fit">Renovação</Badge>
                <dl className="grid gap-2 sm:grid-cols-2">
                  <GoldDetail
                    label="Ciclo contratado"
                    value={cycleLabel(sub?.billing_cycle)}
                  />
                  <GoldDetail
                    label="Valor mensal do contrato"
                    value={money(sub ? sub.final_amount_cents / 100 : null)}
                  />
                  <GoldDetail
                    label="Acesso válido até"
                    value={billingDate(org?.subscription_expires_at)}
                  />
                  <GoldDetail
                    label="Data prevista de renovação"
                    value={billingDate(sub?.renews_at)}
                  />
                </dl>
                {onContactSupport && (
                  <div className="mt-auto">
                    <Button
                      variant="on-gold"
                      onClick={onContactSupport}
                    >
                      Falar sobre minha assinatura
                    </Button>
                  </div>
                )}
              </FocusCard>
            </div>
          </InkPanel>
          <Alert className={ALERT_CARD}>
            <CreditCard className="size-4" />
            <AlertTitle>Gestão de pagamentos em preparação</AlertTitle>
            <AlertDescription>
              A contratação e a renovação pelo checkout serão
              disponibilizadas aqui. Por enquanto, alterações de plano e
              cancelamento são tratados com a equipe Torque.
            </AlertDescription>
          </Alert>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-[15px] tracking-[-0.02em]">Planos</CardTitle>
          <CardDescription>
            Compare os planos disponíveis. Consultar esta tela não altera seu
            plano nem gera cobranças.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {plans?.isError ? (
            <p className="text-sm text-muted-foreground">Não foi possível carregar os planos.</p>
          ) : plans?.data ? (
            <GradeDePlanos planos={plans.data as PlanoDoCatalogo[]} atual={account.data?.planName} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Converse com a equipe sobre mais pessoas, conexões de WhatsApp
              ou agentes de IA.
            </p>
          )}
        </CardContent>
        {onContactSupport && (
          <CardFooter>
            <Button variant="outline" onClick={onContactSupport}>
              Solicitar alteração de plano
            </Button>
          </CardFooter>
        )}
      </Card>

          {history.isPending ? (
            <Loading />
          ) : history.isError ? (
            <ReadError retry={() => void history.refetch()} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-[15px] tracking-[-0.02em]">Histórico de cobranças</CardTitle>
                <CardDescription>
                  Pagamentos registrados para esta organização. Abra os detalhes
                  para consultar documentos disponíveis.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!history.data?.rows.length ? (
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                      <Receipt className="size-6" />
                    </span>
                    <p className="font-bold">Nenhuma cobrança registrada</p>
                    <p className="text-sm text-muted-foreground">
                      Isso não significa que há uma dívida ou que seu acesso foi
                      interrompido.
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Emissão</TableHead>
                        <TableHead>Valor</TableHead>
                        <TableHead>Situação</TableHead>
                        <TableHead>Forma</TableHead>
                        <TableHead>
                          <span className="sr-only">Ações</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.data.rows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="whitespace-nowrap tabular-nums">
                            {billingDate(row.created_at)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-semibold tabular-nums">
                            {money(row.amount)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={paymentBadgeClass(row.status)}>
                              {paymentLabels[row.status.toUpperCase()] ??
                                "Em análise"}
                            </Badge>
                          </TableCell>
                          <TableCell>{methodLabel(row.billing_type)}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedId(row.id)}
                              aria-label={`Detalhes da cobrança de ${billingDate(row.created_at)}, ${money(row.amount)}`}
                            >
                              Detalhes
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
              {!!history.data?.count && (
                <CardFooter className="flex flex-wrap justify-between gap-3 border-t border-border/70 pt-4">
                  <span className="text-sm tabular-nums text-muted-foreground">
                    Página {page + 1} de{" "}
                    {Math.ceil(history.data.count / BILLING_PAGE_SIZE)} ·{" "}
                    {history.data.count} cobranças
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage(page - 1)}
                    >
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        (page + 1) * BILLING_PAGE_SIZE >= history.data.count
                      }
                      onClick={() => setPage(page + 1)}
                    >
                      Próxima
                    </Button>
                  </div>
                </CardFooter>
              )}
            </Card>
          )}

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-[15px] tracking-[-0.02em]">Forma de pagamento</CardTitle>
                <CardDescription>
                  Informações do contrato atual.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-lg font-extrabold tracking-[-0.02em]">
                  {account.isError
                    ? "Não foi possível consultar a forma de pagamento."
                    : account.isPending
                      ? "Carregando…"
                      : methodLabel(sub?.payment_method)}
                </p>
                <p className="text-sm text-muted-foreground">
                  Cartão salvo e renovação automática ainda não estão
                  disponíveis nesta área. Nenhum dado de cartão é solicitado
                  aqui.
                </p>
              </CardContent>
              {onContactSupport && (
                <CardFooter>
                  <Button variant="outline" onClick={onContactSupport}>
                    Preciso de ajuda com um pagamento
                  </Button>
                </CardFooter>
              )}
            </Card>
            <Card className="px-5 py-1">
              <Accordion type="single" collapsible className="[&>*:last-child]:border-b-0">
                <AccordionItem value="change">
                  <AccordionTrigger>
                    Como alterar ou cancelar meu plano?
                  </AccordionTrigger>
                  <AccordionContent>
                    Use o atendimento nesta página. A equipe confere as condições
                    do seu contrato e orienta a alteração. Abrir o atendimento não
                    cancela nem modifica sua assinatura.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="renewal">
                  <AccordionTrigger>
                    A data prevista significa cobrança automática?
                  </AccordionTrigger>
                  <AccordionContent>
                    Não. A data vem do contrato registrado e não confirma uma
                    cobrança futura. A renovação automática depende da forma de
                    pagamento e da ativação desse serviço.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="documents">
                  <AccordionTrigger>Onde encontro comprovantes?</AccordionTrigger>
                  <AccordionContent>
                    Abra os detalhes de uma cobrança no histórico. Links para a
                    cobrança e o comprovante aparecem quando esses documentos
                    estão disponíveis.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="scope">
                  <AccordionTrigger>
                    Estas são as vendas da minha empresa?
                  </AccordionTrigger>
                  <AccordionContent>
                    Não. Esta área reúne a assinatura da sua organização no
                    Torque. Os pedidos e as vendas dos seus clientes continuam na
                    Carteira e nos negócios.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </Card>
          </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Detalhes da cobrança</DialogTitle>
            <DialogDescription>
              Informações registradas para esta organização.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="flex flex-col gap-5">
              <dl className="grid grid-cols-2 gap-4">
                <Detail label="Valor" value={money(selected.amount)} />
                <Detail
                  label="Situação"
                  value={
                    paymentLabels[selected.status.toUpperCase()] ?? "Em análise"
                  }
                />
                <Detail
                  label="Ciclo"
                  value={cycleLabel(selected.billing_cycle)}
                />
                <Detail
                  label="Pagamento em"
                  value={billingDate(selected.paid_at)}
                />
                <Detail
                  label="Início do período"
                  value={billingDate(selected.period_start)}
                />
                <Detail
                  label="Fim do período"
                  value={billingDate(selected.period_end)}
                />
              </dl>
              <div className="flex flex-wrap gap-2">
                <DocumentLink url={selected.invoice_url}>
                  Ver cobrança
                </DocumentLink>
                <DocumentLink url={selected.receipt_url}>
                  Ver comprovante
                </DocumentLink>
              </div>
              {!documentUrl(selected.invoice_url) &&
                !documentUrl(selected.receipt_url) && (
                  <p className="text-sm text-muted-foreground">
                    Documentos ainda não disponíveis.
                  </p>
                )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
