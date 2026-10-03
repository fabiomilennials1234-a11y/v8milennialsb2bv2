import { useMemo, useRef, useState } from "react";
import { Lock, ScrollText, Target, Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { IconChip } from "@/components/ui/bento";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTeamMembers, useCurrentTeamMember, type TeamMember } from "@/modules/identity";
import { useCommissions } from "@/modules/engagement/hooks/useCommissions";
import { useFeaturePermission } from "@/modules/identity";
import { useAvatarMap } from "@/modules/identity/hooks/useAvatarMap";
import { TimeComissoes, type PessoaComissao } from "@/modules/engagement/components/comissoes/TimeComissoes";
import {
  ComissoesPorVenda,
  type FiltroStatus,
  type LinhaComissao,
} from "@/modules/engagement/components/comissoes/ComissoesPorVenda";
import { FAIXAS_ACELERADOR, MESES } from "@/modules/engagement/components/comissoes/comissoes-format";

const tonsFaixa = ["soft", "warning", "gold", "success"] as const;

function papelDe(m: TeamMember): string {
  return m.job_title?.trim() || (m.role === "admin" ? "Administrador" : "Membro");
}

export default function Comissoes() {
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [regrasAbertas, setRegrasAbertas] = useState(false);
  const [statusFiltro, setStatusFiltro] = useState<FiltroStatus>("todas");
  const [vendedorFiltro, setVendedorFiltro] = useState<string | null>(null);
  const tabelaRef = useRef<HTMLDivElement>(null);

  const { allowed: canViewAll, isLoading: isLoadingAdmin } = useFeaturePermission('commissions.view_all');
  const { data: currentMember, isLoading: isLoadingCurrentMember } = useCurrentTeamMember();
  const { data: teamMembers = [], isLoading: isLoadingMembers } = useTeamMembers();
  const { data: commissions = [], isLoading: isLoadingCommissions } = useCommissions(selectedMonth, selectedYear);
  const avatarMap = useAvatarMap();

  // Filter members based on metric_type and permission
  const visibleVendas = useMemo(() => {
    const allVendas = teamMembers.filter(m => m.metric_type === "sales" && m.is_active);
    if (canViewAll) return allVendas;
    if (currentMember?.metric_type === "sales") {
      return allVendas.filter(m => m.id === currentMember!.id);
    }
    return [];
  }, [teamMembers, canViewAll, currentMember]);

  const visibleReunioes = useMemo(() => {
    const allReunioes = teamMembers.filter(m => m.metric_type === "meetings" && m.is_active);
    if (canViewAll) return allReunioes;
    if (currentMember?.metric_type === "meetings") {
      return allReunioes.filter(m => m.id === currentMember!.id);
    }
    return [];
  }, [teamMembers, canViewAll, currentMember]);

  // Determine which tab to show based on metric_type
  const defaultTab = useMemo(() => {
    if (canViewAll) return "vendas";
    if (currentMember?.metric_type === "meetings") return "reunioes";
    return "vendas";
  }, [canViewAll, currentMember]);
  // Controlada: segue o padrão calculado por papel até a pessoa escolher uma
  // aba. Antes o `defaultValue` era fixado no 1º render, antes de o membro
  // carregar, e quem era de reuniões nascia na aba de vendas.
  const [tabEscolhida, setTabEscolhida] = useState<string | null>(null);
  const activeTab = tabEscolhida ?? defaultTab;

  // Summary stats (only for users with view_all permission)
  const totalPaidCommissions = useMemo(() =>
    canViewAll ? commissions.filter(c => c.paid).reduce((sum, c) => sum + Number(c.amount || 0), 0) : 0,
    [commissions, canViewAll]
  );

  const pendentes = useMemo(() => (canViewAll ? commissions.filter((c) => !c.paid) : []), [commissions, canViewAll]);
  const totalPendingCommissions = useMemo(
    () => pendentes.reduce((sum, c) => sum + Number(c.amount || 0), 0),
    [pendentes],
  );

  // A tabela por venda: o time inteiro para quem vê tudo; só as próprias linhas
  // para quem não vê (antes essa pessoa não via linha nenhuma).
  const linhasTabela = useMemo(() => {
    const todas = commissions as unknown as LinhaComissao[];
    if (canViewAll) return todas;
    return currentMember ? todas.filter((c) => c.team_member_id === currentMember.id) : [];
  }, [commissions, canViewAll, currentMember]);

  const years = Array.from({ length: 5 }, (_, i) => currentDate.getFullYear() - i);
  const mesLabel = MESES[selectedMonth - 1].toLowerCase();

  const isLoading = isLoadingAdmin || isLoadingCurrentMember || isLoadingMembers;

  // Check if user has no team member record
  const hasNoAccess = !canViewAll && !currentMember && !isLoading;

  const showVendasTab = canViewAll || currentMember?.metric_type === "sales";
  const showReunioesTab = canViewAll || currentMember?.metric_type === "meetings";

  const pessoas = (lista: TeamMember[]): PessoaComissao[] =>
    lista.map((m) => ({ id: m.id, name: m.name, papel: papelDe(m), avatarUrl: avatarMap.get(m.id) }));

  const verExtrato = (memberId: string) => {
    setVendedorFiltro(memberId);
    setStatusFiltro("todas");
    requestAnimationFrame(() => tabelaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const corpoDoTime = (lista: TeamMember[], titulo: string, metrica: "sales" | "meetings", vazio: string) =>
    isLoading ? (
      <div className="space-y-4">
        <Skeleton className="h-[120px] rounded-card" />
        <Skeleton className="h-[360px] rounded-panel" />
      </div>
    ) : lista.length === 0 ? (
      <Card>
        <CardContent className="py-8 text-center text-[13px] text-muted-foreground">
          {canViewAll ? vazio : "Sem dados de comissão"}
        </CardContent>
      </Card>
    ) : (
      <TimeComissoes
        pessoas={pessoas(lista)}
        month={selectedMonth}
        year={selectedYear}
        mesLabel={mesLabel}
        titulo={titulo}
        metrica={metrica}
        canViewAll={canViewAll}
        totalPago={totalPaidCommissions}
        totalPendente={totalPendingCommissions}
        qtdPendentes={pendentes.length}
        onVerExtrato={verExtrato}
        onAbrirRegras={() => setRegrasAbertas(true)}
      />
    );

  return (
    // V5: a página inteira mora no <Tabs> para a pílula ir ao cabeçalho
    // (Radix só exige lista e conteúdos sob o mesmo Root). Mesmos values e o
    // mesmo padrão calculado por papel.
    <Tabs value={activeTab} onValueChange={setTabEscolhida} className="w-full space-y-5">
      <PageHeader
        title="Comissões"
        subtitle="Acompanhe ganhos da equipe com OTE e comissões"
        actions={
          <>
            <Select
              value={selectedMonth.toString()}
              onValueChange={(v) => setSelectedMonth(Number(v))}
            >
              <SelectTrigger className="w-[140px]" aria-label="Mês">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MESES.map((month, index) => (
                  <SelectItem key={index} value={(index + 1).toString()}>
                    {month}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={selectedYear.toString()}
              onValueChange={(v) => setSelectedYear(Number(v))}
            >
              <SelectTrigger className="w-[100px]" aria-label="Ano">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map(year => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ink" onClick={() => setRegrasAbertas(true)}>
              <ScrollText />
              Regras de comissão
            </Button>
          </>
        }
        tabs={
          // A lista fica mesmo com uma aba só ("Minha comissão"): o gatilho é
          // a única saída de quem nasce na aba errada (ver relatório).
          !hasNoAccess ? (
            <TabsList variant="pill" aria-label="Comissões por time">
              {showVendasTab && (
                <TabsTrigger value="vendas">
                  <Users className="h-3.5 w-3.5" />
                  {canViewAll ? `Vendas (${visibleVendas.length})` : "Minha comissão"}
                </TabsTrigger>
              )}
              {showReunioesTab && (
                <TabsTrigger value="reunioes">
                  <Users className="h-3.5 w-3.5" />
                  {canViewAll ? `Reuniões (${visibleReunioes.length})` : "Minha comissão"}
                </TabsTrigger>
              )}
            </TabsList>
          ) : undefined
        }
      />

      {/* No access message */}
      {hasNoAccess && (
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <span className="mb-4 grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <Lock className="h-5 w-5" />
            </span>
            <p className="mb-1 text-sm font-semibold">Acesso restrito</p>
            <p className="text-[13px] text-muted-foreground">
              Você não possui um registro de membro da equipe associado à sua conta.
            </p>
          </CardContent>
        </Card>
      )}

      {!hasNoAccess && (
        <>
          <TabsContent value="vendas" className="mt-0">
            {corpoDoTime(visibleVendas, "Time de venda", "sales", "Nenhum membro de vendas cadastrado")}
          </TabsContent>

          <TabsContent value="reunioes" className="mt-0">
            {corpoDoTime(visibleReunioes, "Time de pré-venda", "meetings", "Nenhum membro de reuniões cadastrado")}
          </TabsContent>

          <ComissoesPorVenda
            ref={tabelaRef}
            linhas={linhasTabela}
            isLoading={isLoadingCommissions}
            periodo={`${MESES[selectedMonth - 1]} ${selectedYear}`}
            status={statusFiltro}
            onStatus={setStatusFiltro}
            vendedor={vendedorFiltro}
            onVendedor={setVendedorFiltro}
            vendedores={canViewAll ? [...visibleVendas, ...visibleReunioes].map((m) => ({ id: m.id, name: m.name })) : undefined}
            avatarDe={(id) => avatarMap.get(id)}
          />
        </>
      )}

      <Dialog open={regrasAbertas} onOpenChange={setRegrasAbertas}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <IconChip icon={Target} tone="gold" />
              Regras de comissão
            </DialogTitle>
            <DialogDescription>
              OTE (On-Target Earnings) = salário base + variável alvo. O bônus da meta é multiplicado pela faixa
              da meta individual atingida no mês.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            {FAIXAS_ACELERADOR.map((f, i) => (
              <div key={f.mult} className="flex items-center gap-2 rounded-2xl bg-sunken px-3 py-2.5">
                <Badge variant={tonsFaixa[i]} className="shrink-0 whitespace-nowrap tabular-nums">
                  {f.faixa}
                </Badge>
                <span className="whitespace-nowrap text-muted-foreground">{f.mult} bônus</span>
              </div>
            ))}
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            A comissão por venda segue as taxas de recorrência e de projeto de cada pessoa, definidas em Equipe.
          </p>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
