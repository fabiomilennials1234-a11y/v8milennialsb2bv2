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
import { FocusCard, FocusTile, KpiRow, KpiTile } from "@/components/ui/bento";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
 * V5 (2026-10): mesma área, mesmos estados e mesmos textos. Abas internas em
 * segmentado (a página de Configurações já tem a navegação dela), o plano
 * contratado como o cartão de ouro da vista, limites como `KpiTile` com barra
 * e avisos/FAQ em cartão branco de bento.
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
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
        Limites disponíveis para esta organização
      </p>
      <KpiRow cols={3}>
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
          return (
            <KpiTile
              key={resource.key}
              label={resource.label}
              icon={resource.icon}
              tone={over ? "bad" : known ? "gold" : "neutral"}
              value={
                known ? (
                  <span className={cn(over && "text-destructive")}>
                    {used}
                    <span className="text-[0.6em] font-bold tracking-normal text-muted-foreground">
                      {" / "}
                      {unlimited ? "ilimitado" : limit}
                    </span>
                  </span>
                ) : (
                  <span className="text-lg text-muted-foreground">Não informado</span>
                )
              }
            >
              <div className="flex flex-col gap-2">
                {known && !unlimited && (
                  <Progress
                    aria-label={`Uso de ${resource.label}`}
                    className={cn("h-2 bg-muted", over && "[&>div]:bg-destructive")}
                    value={
                      limit > 0
                        ? Math.min(100, (used / limit) * 100)
                        : used > 0
                          ? 100
                          : 0
                    }
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  {!known
                    ? "O limite ainda não está disponível."
                    : unlimited
                      ? "Sem limite de quantidade."
                      : `${Math.max(0, limit - used)} disponíveis${used > limit ? " · Uso acima do limite" : ""}`}
                </p>
              </div>
            </KpiTile>
          );
        })}
      </KpiRow>
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
  const { account, history, quotas } = useBillingAccount(
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

      <Tabs defaultValue="overview" className="w-full">
        <TabsList variant="segmented" className="max-w-full justify-start overflow-x-auto scrollbar-hide">
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="usage">Plano e limites</TabsTrigger>
          <TabsTrigger value="history">Histórico de cobranças</TabsTrigger>
          <TabsTrigger value="payment">Pagamento e ajuda</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-5">
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
              {/* O plano contratado é o foco desta vista: o cartão de ouro. */}
              <FocusCard>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-primary-foreground/70">Plano atual</p>
                    <h3 className="mt-0.5 text-[1.5rem] font-extrabold leading-tight tracking-[-0.035em]">
                      {account.data?.planName || "Plano não informado"}
                    </h3>
                    <p className="mt-1 text-[13px] font-medium text-primary-foreground/75">
                      {sub
                        ? "Condições da assinatura contratada."
                        : "Ainda não há um contrato de pagamento registrado nesta área."}
                    </p>
                  </div>
                  <Badge variant="ink" className="shrink-0 bg-primary-foreground text-primary">
                    {subscriptionLabels[org?.subscription_status ?? ""] ??
                      "Situação não informada"}
                  </Badge>
                </div>
                <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
                  <div>
                    <Button variant="ink" onClick={onContactSupport}>
                      Falar sobre minha assinatura
                    </Button>
                  </div>
                )}
              </FocusCard>
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
        </TabsContent>
        <TabsContent value="usage" className="mt-5">
          <div className="flex flex-col gap-4">
            {quotas.isPending ? (
              <Loading />
            ) : quotas.isError ? (
              <ReadError retry={() => void quotas.refetch()} />
            ) : (
              <Quotas value={quotas.data} />
            )}
            <Card>
              <CardHeader>
                <CardTitle className="text-[15px] tracking-[-0.02em]">Precisa ampliar sua operação?</CardTitle>
                <CardDescription>
                  Converse com a equipe sobre mais pessoas, conexões de WhatsApp
                  ou agentes de IA.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Os limites acima representam o acesso atual. Consultar esta
                  tela não altera seu plano nem gera cobranças.
                </p>
              </CardContent>
              {onContactSupport && (
                <CardFooter>
                  <Button variant="outline" onClick={onContactSupport}>
                    Solicitar alteração de plano
                  </Button>
                </CardFooter>
              )}
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="history" className="mt-5">
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
        </TabsContent>
        <TabsContent value="payment" className="mt-5">
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
        </TabsContent>
      </Tabs>
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
