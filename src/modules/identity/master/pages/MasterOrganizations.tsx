/**
 * Organizações — a central de clientes da Área Dev (board das 5 centrais,
 * regras OR-1…OR-7).
 *
 * A lista mostra o que decide a conversa com o cliente: saúde, usuários,
 * último login, plano. Clicar abre a FICHA (plano, uso, usuários, features,
 * vendas, chamados) — o que antes estava espalhado em Dashboard, Usuários,
 * Planos, Features e /insights. `?org=<id>` abre a ficha direto (links da
 * Implementação).
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Plus,
  Search,
  MoreVertical,
  CreditCard,
  Trash2,
  Eye,
  Power,
  PowerOff,
  Copy,
  Check,
  AlertTriangle,
  Building2,
  Gauge,
  UserX,
  Wallet,
  Receipt,
  TrendingUp,
  ShoppingBag,
  SlidersHorizontal,
  BadgeDollarSign,
} from "lucide-react";
import { formatBRL } from "@/lib/format";
import { useCostSettings, useOrgFinance } from "../hooks/useOrgFinance";
import { usePlanCatalog } from "../hooks/usePlanCatalog";
import { planLabel } from "../lib/plan-label";
import { costsConfigured, orgFinance, sumFinance, type OrgFinance } from "../lib/org-finance";
import { CostSettingsDialog, MonthlyFeeDialog } from "../components/org/OrgFinanceDialogs";
import { KpiRow, KpiTile } from "@/components/ui/bento";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useMasterOrganizations,
  useMasterCreateOrganization,
  useMasterSetOrgSuspension,
  useMasterDeleteOrganization,
  type MasterOrganization,
  FUNNEL_TEMPLATES,
  type OrgType,
  type FunnelTemplateKey,
} from "../hooks/useMasterOrganizations";
import { BillingOverrideModal } from "../components/BillingOverrideModal";
import { OrgSuspensionDialog } from "../components/OrgSuspensionDialog";
import { useMasterAuth } from "../hooks/useMasterAuth";
import { toast } from "sonner";
import { MasterPageHeader } from "../components/MasterPageHeader";
import { OrgFicha } from "../components/org/OrgFicha";
import { useOrgHealthSignals } from "../hooks/useOrgFicha";
import {
  healthBand,
  IN_USE_LOGIN_DAYS,
  isOrgInUse,
  orgHealth,
  RISK_NO_LOGIN_DAYS,
  type OrgHealth,
} from "../lib/org-health";

type Recorte = "todas" | "risco" | "limite";
/** Em uso = login de membro nos últimos 30 dias (`isOrgInUse`). Vive na URL (`?uso=`) para o link do recorte ser compartilhável. */
type Uso = "todas" | "ativas" | "inativas";
const USOS: readonly Uso[] = ["todas", "ativas", "inativas"];

const BAND_CHIP = {
  good: "bg-success/10 text-success-strong",
  warn: "bg-warning/15 text-warning-strong",
  bad: "bg-destructive/10 text-destructive",
} as const;

export default function MasterOrganizations() {
  const { isOutbounder, isFullMaster } = useMasterAuth();
  const [search, setSearch] = useState("");
  const [feeOrg, setFeeOrg] = useState<MasterOrganization | null>(null);
  const [costsOpen, setCostsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [billingOverrideOpen, setBillingOverrideOpen] = useState(false);
  const [suspensionOrg, setSuspensionOrg] = useState<MasterOrganization | null>(null);
  const [suspensionMode, setSuspensionMode] = useState<"suspend" | "reactivate">("suspend");
  const [selectedOrg, setSelectedOrg] = useState<any>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [recorte, setRecorte] = useState<Recorte>("todas");
  const [params, setParams] = useSearchParams();
  const fichaId = params.get("org");
  const usoParam = params.get("uso") as Uso | null;
  const uso: Uso = usoParam && USOS.includes(usoParam) ? usoParam : "todas";
  const setUso = (v: Uso) =>
    setParams(
      (p) => {
        if (v === "todas") p.delete("uso");
        else p.set("uso", v);
        return p;
      },
      { replace: true },
    );
  const abrirFicha = (id: string | null) =>
    setParams(
      (p) => {
        if (id) p.set("org", id);
        else p.delete("org");
        return p;
      },
      { replace: true },
    );

  // Form states
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [newOrgType, setNewOrgType] = useState<OrgType>(isOutbounder ? "outbound" : "crm");
  const [newOrgFunnel, setNewOrgFunnel] = useState<FunnelTemplateKey | "none">("none");

  const { data: organizations, isLoading } = useMasterOrganizations();
  const { data: signals } = useOrgHealthSignals();
  const saude = useMemo(() => {
    const m = new Map<string, OrgHealth>();
    signals?.forEach((sig, id) => m.set(id, orgHealth(sig)));
    return m;
  }, [signals]);
  const createOrg = useMasterCreateOrganization();
  const deleteOrg = useMasterDeleteOrganization();
  const setSuspension = useMasterSetOrgSuspension();

  // Outbounder só vê organizações outbound
  const baseOrgs = isOutbounder
    ? organizations?.filter((org) => org.org_type === "outbound")
    : organizations;

  // Org encerrada não entra na conta de risco: não há o que salvar.
  const vivas = (baseOrgs ?? []).filter((o) => !["cancelled", "expired"].includes(o.subscription_status));
  const emRisco = vivas.filter((o) => saude.get(o.id)?.atRisk);
  const pertoDoLimite = vivas.filter((o) => saude.get(o.id)?.quotaWarning);
  const semLogin = vivas.filter((o) => {
    const h = saude.get(o.id);
    return !!h && (h.daysSinceLogin === null || h.daysSinceLogin >= RISK_NO_LOGIN_DAYS);
  });
  const notaMedia = vivas.length
    ? Math.round(vivas.reduce((acc, o) => acc + (saude.get(o.id)?.score ?? 0), 0) / vivas.length)
    : 0;

  // Ativa/inativa olha TODAS as orgs, encerradas inclusive: a pergunta é
  // "quantos clientes usam o Torque hoje", não "quantos pagam".
  const emUso = useMemo(() => {
    const now = new Date();
    return new Set((baseOrgs ?? []).filter((o) => isOrgInUse(signals?.get(o.id), now)).map((o) => o.id));
  }, [baseOrgs, signals]);
  const totalOrgs = (baseOrgs ?? []).length;

  const recortadas = (recorte === "risco" ? emRisco : recorte === "limite" ? pertoDoLimite : baseOrgs)?.filter(
    (o) => uso === "todas" || emUso.has(o.id) === (uso === "ativas"),
  );

  const filteredOrgs = recortadas
    ?.filter(
      (org) =>
        org.name.toLowerCase().includes(search.toLowerCase()) ||
        org.slug.toLowerCase().includes(search.toLowerCase()) ||
        org.id.toLowerCase().includes(search.toLowerCase())
    )
    // Num recorte, a pior nota primeiro — é por onde o dia começa.
    .sort((a, b) => (recorte === "todas" ? 0 : (saude.get(a.id)?.score ?? 0) - (saude.get(b.id)?.score ?? 0)));

  const fichaOrg = (baseOrgs ?? []).find((o) => o.id === fichaId) ?? null;
  const sinaisCarregando = isLoading || !signals;

  // Financeiro: só master pleno (as RPCs recusam outbounder).
  const { data: finFacts, isError: finFactsErro } = useOrgFinance();
  const { data: costSettings, isError: custosErro } = useCostSettings();
  const { data: plans, isError: planosErro } = usePlanCatalog();
  // Sem a migration aplicada a RPC falha: some com o financeiro em vez de carregar para sempre.
  const finDisponivel = isFullMaster && !finFactsErro && !custosErro && !planosErro;
  const financeiro = useMemo(() => {
    const m = new Map<string, OrgFinance>();
    if (!isFullMaster || !finFacts || !costSettings || !plans || !signals) return m;
    for (const o of baseOrgs ?? []) {
      m.set(
        o.id,
        orgFinance({
          facts: finFacts.get(o.id),
          plan: o.subscription_plan ? plans.get(o.subscription_plan) : undefined,
          users: signals.get(o.id)?.members_active ?? 0,
          settings: costSettings,
          inUse: emUso.has(o.id),
          orgsInUse: emUso.size,
        }),
      );
    }
    return m;
  }, [isFullMaster, finFacts, costSettings, plans, signals, baseOrgs, emUso]);
  const finCarregando = financeiro.size === 0 && !!(baseOrgs ?? []).length;
  // Os números seguem o seletor de uso e o recorte; a busca não mexe neles.
  const totais = sumFinance(
    (recortadas ?? []).map((o) => financeiro.get(o.id)).filter((f): f is OrgFinance => !!f),
  );
  const custosOk = costsConfigured(costSettings);

  const handleCreate = async () => {
    if (!newOrgName || !newOrgSlug) return;
    await createOrg.mutateAsync({
      name: newOrgName,
      slug: newOrgSlug.toLowerCase().replace(/\s+/g, "-"),
      org_type: newOrgType,
      funnelTemplate: newOrgFunnel === "none" ? null : newOrgFunnel,
    });
    setNewOrgName("");
    setNewOrgSlug("");
    setNewOrgType("crm");
    setNewOrgFunnel("none");
    setCreateOpen(false);
  };

  // Status e override são dois fatos, não um. Colapsar os dois num badge só
  // escondia o caso que mais importa: org "suspensa" com override ligado, que
  // continua com acesso liberado. Agora aparecem lado a lado.
  const getStatusBadge = (status: string, hasOverride: boolean) => {
    const bloqueada = ["suspended", "cancelled", "expired"].includes(status) && !hasOverride;

    const statusBadge = (() => {
      switch (status) {
        case "active":
          return <Badge variant="success">Ativo</Badge>;
        case "trial":
          return <Badge variant="info">Trial</Badge>;
        case "suspended":
          return <Badge variant="warning">Suspenso</Badge>;
        case "cancelled":
        case "expired":
          return <Badge variant="destructive" className="bg-destructive/10 text-destructive hover:bg-destructive/15">Cancelado</Badge>;
        default:
          return <Badge variant="secondary">{status}</Badge>;
      }
    })();

    return (
      <div className="flex items-center gap-1.5">
        {statusBadge}
        {hasOverride && (
          <Badge variant="gold" title="Plano liberado pelo Master — ignora o status da assinatura">
            Override
          </Badge>
        )}
        {bloqueada && (
          <span className="text-[10px] uppercase tracking-wide text-destructive">
            sem acesso
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <MasterPageHeader
        title={isOutbounder ? "Organizações outbound" : "Organizações"}
        subtitle={
          isOutbounder
            ? "Gerencie as organizações de outbound"
            : "Plano, uso, usuários e saúde de cada cliente. Clique numa org para abrir a ficha."
        }
        actions={
          <div className="flex items-center gap-2">
            {finDisponivel && (
              <Button variant="outline" onClick={() => setCostsOpen(true)}>
                <SlidersHorizontal className="w-4 h-4" />
                Custos
              </Button>
            )}
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" />
              Nova organização
            </Button>
          </div>
        }
      />

      <KpiRow cols={4}>
        <KpiTile
          label="Orgs ativas"
          value={emUso.size}
          icon={Building2}
          tone="info"
          loading={sinaisCarregando}
          note={`de ${totalOrgs} · login nos últimos ${IN_USE_LOGIN_DAYS} dias`}
        />
        <KpiTile
          label="Em risco"
          value={emRisco.length}
          icon={AlertTriangle}
          tone={emRisco.length > 0 ? "bad" : "good"}
          note={`nota < 45 ou ${RISK_NO_LOGIN_DAYS} dias sem login`}
          loading={sinaisCarregando}
        />
        <KpiTile
          label={`Sem login há ${RISK_NO_LOGIN_DAYS}+ dias`}
          value={semLogin.length}
          icon={UserX}
          tone={semLogin.length > 0 ? "warn" : "good"}
          note="alerta de churn"
          loading={sinaisCarregando}
        />
        <KpiTile label="Nota média" value={notaMedia} icon={Gauge} tone="gold" note="de 100, orgs ativas" loading={sinaisCarregando} />
      </KpiRow>

      {finDisponivel && (
        <KpiRow cols={4}>
          <KpiTile
            label="Receita Torque / mês"
            value={formatBRL(totais.feeCents / 100)}
            icon={Wallet}
            tone="info"
            loading={finCarregando}
            note={
              totais.estimadas > 0
                ? `${totais.contratos} por contrato · ${totais.estimadas} estimadas pela tabela`
                : `${totais.contratos} por contrato`
            }
          />
          <KpiTile
            label="Custo / mês"
            value={formatBRL(totais.costCents / 100)}
            icon={Receipt}
            tone={custosOk ? "neutral" : "warn"}
            loading={finCarregando}
            note={
              !custosOk ? (
                <button type="button" className="font-semibold text-warning-strong hover:underline" onClick={() => setCostsOpen(true)}>
                  Configure os custos
                </button>
              ) : totais.llmSemCambio ? (
                "sem câmbio: LLM fora da conta"
              ) : (
                "chips + LLM + infra e salários rateados"
              )
            }
          />
          <KpiTile
            label="Margem"
            value={formatBRL(totais.marginCents / 100)}
            icon={TrendingUp}
            tone={totais.marginCents >= 0 ? "good" : "bad"}
            loading={finCarregando}
            note={totais.marginPct === null ? "sem receita no recorte" : `${Math.round(totais.marginPct * 100)}% da receita`}
          />
          <KpiTile
            label="Vendas dos clientes · 30 d"
            value={formatBRL(totais.clientRevenue30d)}
            icon={ShoppingBag}
            tone="gold"
            loading={finCarregando}
            note="vendas líquidas registradas no Torque"
          />
        </KpiRow>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Uso"
          value={uso}
          onChange={setUso}
          title={`Ativa = alguém do cliente entrou nos últimos ${IN_USE_LOGIN_DAYS} dias (master não conta)`}
          options={[
            ["todas", sinaisCarregando ? "Todas" : `Todas · ${totalOrgs}`],
            ["ativas", sinaisCarregando ? "Ativas" : `Ativas · ${emUso.size}`],
            ["inativas", sinaisCarregando ? "Inativas" : `Inativas · ${totalOrgs - emUso.size}`],
          ]}
        />

        <Segmented
          label="Recorte"
          value={recorte}
          onChange={setRecorte}
          options={[
            ["todas", "Todas"],
            ["risco", `Em risco · ${emRisco.length}`],
            ["limite", `Perto do limite · ${pertoDoLimite.length}`],
          ]}
        />

      {/* Search */}
      <div className="relative w-full max-w-md sm:w-auto sm:flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou slug..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      </div>

      {/* Table — carga e vazio ficam FORA da tabela, centrados no cartão. No
          celular, tipo e plano sobem para baixo do slug e a data some: nenhuma
          coluna sai da tela. */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Carregando...</p>
          ) : !filteredOrgs?.length ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Nenhuma organização encontrada</p>
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organização</TableHead>
                <TableHead className={finDisponivel ? "max-2xl:hidden" : "max-sm:hidden"}>Tipo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="max-md:hidden">Plano</TableHead>
                <TableHead>Saúde</TableHead>
                <TableHead className="max-lg:hidden">Usuários</TableHead>
                <TableHead className="max-lg:hidden">Último login</TableHead>
                {finDisponivel && (
                  <>
                    <TableHead className="max-md:hidden text-right">Mensalidade</TableHead>
                    <TableHead className="max-lg:hidden text-right">Margem</TableHead>
                    <TableHead className="max-xl:hidden text-right">Vendas 30 d</TableHead>
                  </>
                )}
                <TableHead className="w-[100px] max-sm:w-14">
                  <span className="max-sm:sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrgs.map((org) => (
                  <TableRow key={org.id} className="cursor-pointer" onClick={() => abrirFicha(org.id)}>
                    <TableCell className="max-md:w-full max-md:max-w-0">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{org.name}</p>
                        <p className="truncate text-sm text-muted-foreground">{org.slug}</p>
                        <p className="truncate text-xs text-muted-foreground md:hidden">
                          <span className="sm:hidden">{org.org_type === "outbound" ? "Outbound" : "CRM"} · </span>
                          <span>{planLabel(org.subscription_plan, plans)}</span>
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className={finDisponivel ? "max-2xl:hidden" : "max-sm:hidden"}>
                      <Badge variant={org.org_type === "outbound" ? "info" : "soft"}>
                        {org.org_type === "outbound" ? "Outbound" : "CRM"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(org.subscription_status, org.billing_override)}
                    </TableCell>
                    <TableCell className="max-md:hidden">
                      <span>{planLabel(org.subscription_plan, plans)}</span>
                    </TableCell>
                    <TableCell>
                      <HealthChip health={saude.get(org.id)} />
                    </TableCell>
                    <TableCell className="max-lg:hidden tabular-nums">
                      <UsersCell signals={signals?.get(org.id)} />
                    </TableCell>
                    <TableCell className="max-lg:hidden text-sm text-muted-foreground">
                      <LastLoginCell at={signals?.get(org.id)?.last_login_at ?? null} known={!!signals?.get(org.id)} />
                    </TableCell>
                    {finDisponivel && <FinanceCells fin={financeiro.get(org.id)} />}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Ações de ${org.name}`}>
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {/* V5: a coluna de ID saiu da tabela; o copiar continua aqui. */}
                          <DropdownMenuItem
                            onClick={() => {
                              navigator.clipboard.writeText(org.id);
                              setCopiedId(org.id);
                              toast.success("ID copiado");
                              setTimeout(() => setCopiedId(null), 2000);
                            }}
                          >
                            {copiedId === org.id ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                            Copiar ID
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => abrirFicha(org.id)}>
                            <Eye className="w-4 h-4 mr-2" />
                            Abrir ficha
                          </DropdownMenuItem>
                          {finDisponivel && (
                            <DropdownMenuItem onClick={() => setFeeOrg(org)}>
                              <BadgeDollarSign className="w-4 h-4 mr-2" />
                              Definir mensalidade
                            </DropdownMenuItem>
                          )}
                          {!isOutbounder && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => {
                                  setSelectedOrg(org);
                                  setBillingOverrideOpen(true);
                                }}
                              >
                                <CreditCard className="w-4 h-4 mr-2" />
                                Liberar plano
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setSuspensionMode(
                                    org.subscription_status === "active" ? "suspend" : "reactivate"
                                  );
                                  setSuspensionOrg(org);
                                }}
                              >
                                {org.subscription_status === "active" ? (
                                  <>
                                    <PowerOff className="w-4 h-4 mr-2" />
                                    Suspender
                                  </>
                                ) : (
                                  <>
                                    <Power className="w-4 h-4 mr-2" />
                                    Ativar
                                  </>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => {
                                  if (confirm(`Excluir "${org.name}"? Esta ação não pode ser desfeita.`)) {
                                    deleteOrg.mutate(org.id);
                                  }
                                }}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Excluir
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova organização</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!isOutbounder && (
              <div className="space-y-2">
                <Label>Tipo de organização</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={newOrgType === "crm" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setNewOrgType("crm")}
                  >
                    CRM
                  </Button>
                  <Button
                    type="button"
                    variant={newOrgType === "outbound" ? "default" : "outline"}
                    className="flex-1"
                    onClick={() => setNewOrgType("outbound")}
                  >
                    Outbound
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {newOrgType === "crm"
                    ? "Fluxo padrão com Admin, SDR e Closer."
                    : "Agência de prospecção com Agency, BDR e Cliente."}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="Nome da empresa"
              />
            </div>
            <div className="space-y-2">
              <Label>Slug (URL)</Label>
              <Input
                value={newOrgSlug}
                onChange={(e) => setNewOrgSlug(e.target.value)}
                placeholder="nome-da-empresa"
              />
            </div>
            <div className="space-y-2">
              <Label>Modelo de funil (kanban)</Label>
              <Select
                value={newOrgFunnel}
                onValueChange={(v) => setNewOrgFunnel(v as FunnelTemplateKey | "none")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um modelo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Padrão (sem modelo)</SelectItem>
                  {(
                    Object.entries(FUNNEL_TEMPLATES) as [
                      FunnelTemplateKey,
                      (typeof FUNNEL_TEMPLATES)[FunnelTemplateKey],
                    ][]
                  ).map(([key, tpl]) => (
                    <SelectItem key={key} value={key}>
                      {tpl.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {newOrgFunnel === "none"
                  ? "A org começa com os kanbans padrão do sistema."
                  : FUNNEL_TEMPLATES[newOrgFunnel].description +
                    " — kanbans e automações do funil já vêm setados (as automações são criadas inativas)."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={createOrg.isPending}>
              {createOrg.isPending ? "Criando..." : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={!!fichaOrg} onOpenChange={(v) => !v && abrirFicha(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl" onOpenAutoFocus={(e) => e.preventDefault()}>
          {fichaOrg && <OrgFicha key={fichaOrg.id} org={fichaOrg} health={saude.get(fichaOrg.id) ?? null} />}
        </SheetContent>
      </Sheet>

      <MonthlyFeeDialog
        org={feeOrg}
        finance={feeOrg ? financeiro.get(feeOrg.id) : undefined}
        notes={feeOrg ? finFacts?.get(feeOrg.id)?.fee_notes ?? null : null}
        onOpenChange={(open) => !open && setFeeOrg(null)}
      />
      <CostSettingsDialog open={costsOpen} onOpenChange={setCostsOpen} settings={costSettings} />

      {/* Billing Override Modal */}
      <BillingOverrideModal
        open={billingOverrideOpen}
        onOpenChange={setBillingOverrideOpen}
        organization={selectedOrg}
      />

      <OrgSuspensionDialog
        open={!!suspensionOrg}
        onOpenChange={(open) => {
          if (!open) setSuspensionOrg(null);
        }}
        org={suspensionOrg}
        suspend={suspensionMode === "suspend"}
        pending={setSuspension.isPending}
        onConfirm={(reason) => {
          if (!suspensionOrg) return;
          setSuspension.mutate(
            {
              orgId: suspensionOrg.id,
              suspend: suspensionMode === "suspend",
              reason: reason || undefined,
            },
            // erro já vira toast no hook; o diálogo fica aberto para nova tentativa
            { onSuccess: () => setSuspensionOrg(null) }
          );
        }}
      />
    </div>
  );
}

function Segmented<K extends string>({
  label,
  value,
  onChange,
  options,
  title,
}: {
  label: string;
  value: K;
  onChange: (k: K) => void;
  options: [K, string][];
  title?: string;
}) {
  return (
    <nav
      aria-label={label}
      title={title}
      className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-muted p-[3px] scrollbar-hide"
    >
      {options.map(([k, text]) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className={cn(
            "shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold tabular-nums transition-[background-color,color,box-shadow] duration-150",
            value === k ? "bg-card text-foreground shadow-relevo" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {text}
        </button>
      ))}
    </nav>
  );
}

function HealthChip({ health }: { health: OrgHealth | undefined }) {
  if (!health) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5" title={health.riskReasons.join(" · ") || "sem alerta"}>
      <span
        className={cn(
          "inline-flex min-w-9 justify-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
          BAND_CHIP[healthBand(health.score)],
        )}
      >
        {health.score}
      </span>
      {health.atRisk && <AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-label="em risco" />}
      {health.quotaWarning && (
        <span className="text-[10px] font-bold uppercase tracking-wide text-warning-strong">limite</span>
      )}
    </span>
  );
}

const brl = (cents: number) => formatBRL(cents / 100);

function FinanceCells({ fin }: { fin: OrgFinance | undefined }) {
  if (!fin) {
    return (
      <>
        <TableCell className="max-md:hidden text-right text-muted-foreground">—</TableCell>
        <TableCell className="max-lg:hidden text-right text-muted-foreground">—</TableCell>
        <TableCell className="max-xl:hidden text-right text-muted-foreground">—</TableCell>
      </>
    );
  }
  const { cost } = fin;
  const custoDetalhe = [
    `chips ${brl(cost.chipsCents)}`,
    cost.llmCents === null ? "LLM sem câmbio" : `LLM ${brl(cost.llmCents)}`,
    `infra ${brl(cost.infraCents)}`,
    `salários ${brl(cost.payrollCents)}`,
  ].join(" · ");

  return (
    <>
      <TableCell className="max-md:hidden text-right tabular-nums">
        {fin.feeSource === "sem_plano" ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="inline-flex flex-col items-end">
            <span className="font-medium">{brl(fin.feeCents)}</span>
            {fin.feeSource === "tabela" && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground" title="Sem contrato gravado: preço de lista do plano">
                tabela
              </span>
            )}
          </span>
        )}
      </TableCell>
      <TableCell className="max-lg:hidden text-right tabular-nums" title={custoDetalhe}>
        <span className="inline-flex flex-col items-end">
          <span className={cn("font-medium", fin.marginCents < 0 ? "text-destructive" : "text-success-strong")}>
            {brl(fin.marginCents)}
          </span>
          <span className="text-xs text-muted-foreground">custo {brl(cost.totalCents)}</span>
        </span>
      </TableCell>
      <TableCell className="max-xl:hidden text-right tabular-nums">
        {fin.clientSales30d > 0 ? (
          <span className="inline-flex flex-col items-end">
            <span className="font-medium">{formatBRL(fin.clientRevenue30d)}</span>
            <span className="text-xs text-muted-foreground">
              {fin.clientSales30d} venda{fin.clientSales30d > 1 ? "s" : ""}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </>
  );
}

function UsersCell({ signals }: { signals: { active_users_7d: number; members_active: number } | undefined }) {
  if (!signals) return <span className="text-muted-foreground">—</span>;
  return (
    <span title="Entraram nos últimos 7 dias / membros ativos">
      {signals.active_users_7d}
      <span className="text-muted-foreground"> de {signals.members_active}</span>
    </span>
  );
}

function LastLoginCell({ at, known }: { at: string | null; known: boolean }) {
  if (!known) return <>—</>;
  if (!at) return <>nunca</>;
  return <>{formatDistanceToNow(new Date(at), { addSuffix: true, locale: ptBR })}</>;
}
