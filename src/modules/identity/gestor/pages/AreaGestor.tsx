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
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="min-h-screen bg-background md:flex">
      <aside className="flex shrink-0 flex-col border-b border-border bg-card md:sticky md:top-0 md:h-screen md:w-60 md:border-b-0 md:border-r">
        <div className="flex items-center gap-3 px-5 py-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <LayoutGrid className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-semibold">Área do Gestor</h1>
            <p className="text-xs text-muted-foreground">
              Gestão de organizações
            </p>
          </div>
        </div>
        <nav
          aria-label="Navegação do gestor"
          className="flex items-center gap-2 px-3 pb-3 md:flex-1 md:flex-col md:items-stretch"
        >
          <a
            href="/gestor"
            aria-current="page"
            className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
          >
            <Building2 className="h-4 w-4" />
            Organizações
          </a>
          <Button
            variant="ghost"
            className="justify-start md:mt-auto"
            onClick={() => signOut()}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sair
          </Button>
        </nav>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 sm:p-8 lg:p-10">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold">Suas organizações</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Acompanhe os resultados das organizações vinculadas à sua conta.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
              />
              Atualizar
            </Button>
          </header>

          {isLoading ? (
            <TorqueLoader variant="full" />
          ) : isError ? (
            <div
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center"
            >
              <h3 className="font-semibold">
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
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-20 text-center">
              <Building2 className="h-10 w-10 text-muted-foreground" />
              <h3 className="text-lg font-semibold">
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
                {[
                  {
                    label: "Organizações vinculadas",
                    value: orgs.length,
                    Icon: Building2,
                    detail: "Sob sua gestão",
                  },
                  {
                    label: "Leads recebidos",
                    value: leads,
                    Icon: Users,
                    detail: "Últimos 7 dias",
                  },
                  {
                    label: "Vendas realizadas",
                    value: sales,
                    Icon: TrendingUp,
                    detail: "Últimos 7 dias · sem estornos",
                  },
                ].map(({ label, value, Icon, detail }) => (
                  <Card key={label}>
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>{label}</span>
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <p className="mt-3 text-3xl font-semibold tabular-nums">
                        {number.format(value)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {detail}
                      </p>
                    </CardContent>
                  </Card>
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
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    aria-label="Buscar organização"
                    placeholder="Buscar organização..."
                    className="pl-9"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Atualizado às{" "}
                  {new Date(dataUpdatedAt).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · atualização automática a cada minuto
                </p>
              </div>

              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <Table className="min-w-[700px] text-card-foreground">
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="pl-5">Organização</TableHead>
                      <TableHead className="text-right">
                        Leads
                        <span className="block text-xs font-normal">
                          Últimos 7 dias
                        </span>
                      </TableHead>
                      <TableHead className="text-right">
                        Vendas
                        <span className="block text-xs font-normal">
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
                              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                                <Building2 className="h-5 w-5" />
                              </div>
                              <div>
                                <p className="font-medium">{org.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {org.slug}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {org.leads_last_7_days === null ? "—" : number.format(org.leads_last_7_days)}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {org.sales_last_7_days === null ? "—" : number.format(org.sales_last_7_days)}
                          </TableCell>
                          <TableCell>
                            {org.access_blocked ? (
                              <span className="text-sm text-muted-foreground">Acesso restrito</span>
                            ) : <details className="max-w-56">
                              <summary className="flex cursor-pointer items-center gap-2 text-sm">
                                <span
                                  className={`h-2 w-2 rounded-full ${org.online_users.length ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
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
                              <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
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
