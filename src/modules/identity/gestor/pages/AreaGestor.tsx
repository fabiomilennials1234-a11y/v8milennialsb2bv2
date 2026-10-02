/** Hub independente do gestor. Dados e ações não usam APIs ou componentes master. */
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Building2,
  LayoutGrid,
  LogOut,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { KpiTile } from "@/components/ui/bento";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TorqueLoader } from "@/components/ui/branding/TorqueLoader";
import { useAuth } from "../../auth/contexts/AuthContext";
import { setSelectedOrgId } from "../../org-team/hooks/useCurrentTeamMember";
import { useGestorOrganizations } from "../hooks/useGestorOrganizations";

const number = new Intl.NumberFormat("pt-BR");

export default function AreaGestor() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { signOut } = useAuth();
  const {
    data: orgs = [],
    isLoading,
    isError,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useGestorOrganizations();
  const [search, setSearch] = useState("");
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const entering = useRef(false);

  const enterOrg = async (orgId: string) => {
    if (entering.current) return;
    entering.current = true;
    setEnteringId(orgId);
    try {
      // Confere novamente o vínculo antes de selecionar a organização.
      const fresh = await refetch();
      if (
        fresh.error ||
        !fresh.data?.some((org) => org.organization_id === orgId && !org.access_blocked)
      ) {
        throw new Error(
          "Não foi possível confirmar seu acesso a esta organização. Atualize a lista e tente novamente.",
        );
      }
      setSelectedOrgId(orgId);
      await queryClient.invalidateQueries();
      navigate("/dashboard");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível abrir a organização.",
      );
    } finally {
      entering.current = false;
      setEnteringId(null);
    }
  };

  const term = search.trim().toLocaleLowerCase("pt-BR");
  const filtered = orgs.filter((org) =>
    `${org.name} ${org.slug}`.toLocaleLowerCase("pt-BR").includes(term),
  );
  const leads = orgs.reduce((sum, org) => sum + (org.leads_last_7_days ?? 0), 0);
  const sales = orgs.reduce((sum, org) => sum + (org.sales_last_7_days ?? 0), 0);
  const hasBlockedOrgs = orgs.some((org) => org.access_blocked);

  return (
    // Página fora do MainLayout: liga a bancada V5 (grade de 28 px) por conta própria.
    <div data-layout="main" className="min-h-screen bg-background md:flex">
      {/* Lateral em tinta flutuante — o mesmo objeto da lateral do app
          (`platform/components/layout/Sidebar.tsx`), com um item só. */}
      <aside className="m-3 mb-0 flex shrink-0 flex-col overflow-hidden rounded-panel border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-relevo-tinta md:sticky md:top-3 md:mb-3 md:mr-0 md:h-[calc(100vh-1.5rem)] md:w-60">
        <div className="flex items-center gap-3 px-4 pb-3 pt-4 md:pb-4 md:pt-5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sidebar-accent text-primary">
            <LayoutGrid className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight text-sidebar-foreground">Área do Gestor</p>
            <p className="truncate text-xs text-sidebar-foreground/55">
              Gestão de organizações
            </p>
          </div>
        </div>
        <nav
          aria-label="Navegação do gestor"
          className="flex items-center gap-1 px-2.5 pb-2.5 md:flex-1 md:flex-col md:items-stretch md:gap-0.5"
        >
          <a
            href="/gestor"
            aria-current="page"
            className="relative flex items-center gap-3 rounded-xl bg-sidebar-accent px-2.5 py-2 text-sm font-semibold text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar"
          >
            {/* Trilho dourado do ativo, colado na borda da lateral. */}
            <span
              aria-hidden
              className="absolute -left-2.5 top-1/2 hidden h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/.65)] md:block"
            />
            <Building2 className="h-[17px] w-[17px] shrink-0 text-primary" />
            Organizações
          </a>
          <Button
            variant="ghost"
            className="ml-auto h-auto justify-start gap-3 rounded-xl px-2.5 py-2 font-normal text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground md:ml-0 md:mt-auto"
            onClick={() => signOut()}
          >
            <LogOut className="h-[17px] w-[17px]" />
            Sair
          </Button>
        </nav>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 sm:p-8 lg:p-10">
        <div className="mx-auto max-w-7xl space-y-5">
          <PageHeader
            title="Suas organizações"
            subtitle="Acompanhe os resultados das organizações vinculadas à sua conta."
            actions={
              <Button
                variant="outline"
                size="sm"
                disabled={isFetching}
                onClick={() => void refetch()}
              >
                <RefreshCw className={cn(isFetching && "animate-spin")} />
                Atualizar
              </Button>
            }
          />

          {isLoading ? (
            <TorqueLoader variant="full" />
          ) : isError ? (
            <div
              role="alert"
              className="rounded-card border border-destructive/30 bg-destructive/5 p-8 text-center"
            >
              <h3 className="text-base font-bold tracking-tight">
                Não foi possível carregar suas organizações
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Tente novamente para consultar os vínculos e os indicadores
                atualizados.
              </p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => void refetch()}
              >
                Tentar novamente
              </Button>
            </div>
          ) : orgs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border bg-card/60 px-6 py-20 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-muted text-foreground/70">
                <Building2 className="h-6 w-6" />
              </span>
              <h3 className="text-lg font-bold tracking-tight">
                Nenhuma organização vinculada
              </h3>
              <p className="max-w-md text-sm text-muted-foreground">
                Peça ao administrador da plataforma para vincular as
                organizações à sua conta.
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                {([
                  {
                    label: "Organizações vinculadas",
                    value: orgs.length,
                    Icon: Building2,
                    tone: "neutral",
                    detail: "Sob sua gestão",
                  },
                  {
                    label: "Leads recebidos",
                    value: leads,
                    Icon: Users,
                    tone: "info",
                    detail: "Últimos 7 dias",
                  },
                  {
                    label: "Vendas realizadas",
                    value: sales,
                    Icon: TrendingUp,
                    tone: "good",
                    detail: "Últimos 7 dias · sem estornos",
                  },
                ] as const).map(({ label, value, Icon, tone, detail }) => (
                  <KpiTile
                    key={label}
                    label={label}
                    value={number.format(value)}
                    icon={Icon}
                    tone={tone}
                    note={detail}
                  />
                ))}
              </div>

              {hasBlockedOrgs && (
                <p className="text-sm text-muted-foreground">
                  Os indicadores incluem apenas organizações com acesso liberado.
                  Organizações com acesso restrito permanecem na lista.
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative w-full sm:max-w-sm">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Buscar organização"
                    placeholder="Buscar organização..."
                    className="pl-9"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <p className="text-xs tabular-nums text-muted-foreground">
                  Atualizado às{" "}
                  {new Date(dataUpdatedAt).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · atualização automática a cada minuto
                </p>
              </div>

              <Card className="overflow-hidden">
                <Table className="min-w-[700px] text-card-foreground">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5">Organização</TableHead>
                      <TableHead className="h-auto py-2.5 text-right">
                        Leads
                        <span className="block text-[11px] font-medium normal-case tracking-normal text-muted-foreground/80">
                          Últimos 7 dias
                        </span>
                      </TableHead>
                      <TableHead className="h-auto py-2.5 text-right">
                        Vendas
                        <span className="block text-[11px] font-medium normal-case tracking-normal text-muted-foreground/80">
                          Últimos 7 dias
                        </span>
                      </TableHead>
                      <TableHead>Usuários online</TableHead>
                      <TableHead>
                        <span className="sr-only">Ações</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="h-32 text-center text-muted-foreground"
                        >
                          Nenhuma organização encontrada para essa busca.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((org) => (
                        <TableRow key={org.organization_id}>
                          <TableCell className="py-5 pl-5">
                            <div className="flex items-center gap-3">
                              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground/70">
                                <Building2 className="h-[18px] w-[18px]" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold">{org.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {org.slug}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-bold tabular-nums">
                            {org.leads_last_7_days === null ? "—" : number.format(org.leads_last_7_days)}
                          </TableCell>
                          <TableCell className="text-right font-bold tabular-nums">
                            {org.sales_last_7_days === null ? "—" : number.format(org.sales_last_7_days)}
                          </TableCell>
                          <TableCell>
                            {org.access_blocked ? (
                              <span className="text-sm text-muted-foreground">Acesso restrito</span>
                            ) : <details className="max-w-56">
                              <summary className="flex cursor-pointer items-center gap-2 text-sm">
                                <span
                                  className={cn(
                                    "h-2 w-2 rounded-full",
                                    org.online_users.length ? "bg-success" : "bg-muted-foreground/40",
                                  )}
                                />
                                {number.format(org.online_users.length)} online
                                <span className="sr-only">
                                  {" "}
                                  em {org.name}; ver usuários
                                </span>
                              </summary>
                              {org.online_users.length ? (
                                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                                  {org.online_users.map((user) => (
                                    <li key={user.user_id}>
                                      {user.name || "Usuário sem nome"}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  Nenhum usuário online no momento.
                                </p>
                              )}
                            </details>}
                          </TableCell>
                          <TableCell className="pr-5 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!!enteringId || org.access_blocked}
                              aria-label={`Entrar em ${org.name}`}
                              onClick={() => void enterOrg(org.organization_id)}
                            >
                              {enteringId === org.organization_id
                                ? "Entrando..."
                                : "Entrar"}
                              <ArrowRight />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>
              <p className="text-xs text-muted-foreground">
                Online: membros ativos com o CRM visível nos últimos 2 minutos.
                Clique na contagem para ver os nomes.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
