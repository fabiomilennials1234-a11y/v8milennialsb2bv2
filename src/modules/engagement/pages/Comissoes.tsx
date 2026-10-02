import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  DollarSign,
  TrendingUp,
  Target,
  Users,
  Check,
  AlertCircle,
  Wallet,
  PiggyBank,
  Percent,
  Lock,
  Trophy,
  CalendarCheck,
  Hourglass,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { KpiTile } from "@/components/ui/bento";
import { useTeamMembers, useCurrentTeamMember } from "@/modules/identity";
import { useCommissions, useCommissionSummary } from "@/modules/engagement/hooks/useCommissions";
import { useFeaturePermission } from "@/modules/identity";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useAvatarMap } from "@/modules/identity/hooks/useAvatarMap";

const months = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
  }).format(value);
}

interface MemberCommissionCardProps {
  memberId: string;
  memberName: string;
  memberRole: string;
  month: number;
  year: number;
  avatarUrl?: string;
}

function MemberCommissionCard({ memberId, memberName, memberRole, month, year, avatarUrl }: MemberCommissionCardProps) {
  const { data: summary, isLoading, isError, refetch } = useCommissionSummary(memberId, month, year);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-5">
          <Skeleton className="h-4 w-32 mb-4" />
          <Skeleton className="h-8 w-24 mb-2" />
          <Skeleton className="h-3 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) return <Alert variant="destructive" className="rounded-2xl bg-destructive/5">
    <AlertTitle>Apuração indisponível</AlertTitle>
    <AlertDescription>Não foi possível apurar a comissão de {memberName}.</AlertDescription>
    <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>Tentar novamente</Button>
  </Alert>;
  if (!summary) return null;

  const bonusMultiplier = summary.goalProgress >= 120 ? 1.2 
    : summary.goalProgress >= 100 ? 1.0 
    : summary.goalProgress >= 70 ? 0.7 
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <Card className="h-full">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <UserAvatar
                name={memberName}
                avatarUrl={avatarUrl}
                size="md"
                fallbackClassName="bg-primary-soft text-primary-soft-foreground"
              />
              <div className="min-w-0">
                <CardTitle className="truncate text-[15px] tracking-[-0.02em]">{memberName}</CardTitle>
                <Badge variant="soft" className="text-xs mt-1">
                  {memberRole}
                </Badge>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className={summary.totalEarnings == null ? "text-sm font-bold text-warning-strong" : "text-2xl font-extrabold tabular-nums tracking-[-0.04em] text-success"}>
                {summary.totalEarnings == null ? "Apuração pendente" : formatCurrency(summary.totalEarnings)}
              </p>
              <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Total do mês</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {summary.commissionStatus === "pending" && <Alert role="status" className="rounded-2xl border-warning/40 bg-warning/10">
            <AlertTitle>Comissão pendente de conferência</AlertTitle>
            <AlertDescription>{summary.pendingCount} venda(s), total de {formatCurrency(summary.pendingRevenue)}, aguardando conferência da comissão.</AlertDescription>
          </Alert>}
          {/* Goal Progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progresso da Meta</span>
              <span className="font-bold tabular-nums">{summary.goalConfigured ? `${summary.goalProgress.toFixed(0)}%` : "Meta não configurada"}</span>
            </div>
            {summary.goalConfigured && <Progress value={Math.min(summary.goalProgress, 100)} className="h-2" />}
            <div className="flex items-center gap-2 text-xs">
              {!summary.goalConfigured ? <span className="text-muted-foreground">Realizado no período: {summary.goalCurrent}. Configure a meta para apurar o bônus.</span> : summary.goalProgress >= 120 ? (
                <Badge variant="success">
                  <TrendingUp className="w-3 h-3 mr-1" />
                  1.2x Bônus
                </Badge>
              ) : summary.goalProgress >= 100 ? (
                <Badge variant="gold">
                  <Check className="w-3 h-3 mr-1" />
                  1.0x Bônus
                </Badge>
              ) : summary.goalProgress >= 70 ? (
                <Badge variant="warning">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  0.7x Bônus
                </Badge>
              ) : (
                <Badge variant="soft" className="text-muted-foreground">
                  Abaixo de 70%
                </Badge>
              )}
            </div>
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-2 gap-3 rounded-2xl bg-sunken p-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Wallet className="w-3 h-3" /> Base Fixa
              </p>
              <p className="text-sm font-bold tabular-nums">{formatCurrency(summary.oteBase)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <PiggyBank className="w-3 h-3" /> {summary.goalConfigured ? `Bônus (${bonusMultiplier}x)` : "Bônus por meta"}
              </p>
              <p className="text-sm font-bold tabular-nums">{!summary.goalConfigured && summary.oteBonus > 0 ? "Pendente de meta" : formatCurrency(summary.calculatedBonus)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Percent className="w-3 h-3" /> Comissão Rec.
              </p>
              <p className="text-sm font-bold tabular-nums text-chart-3">{summary.commissionStatus === "pending" ? "Apuração pendente" : formatCurrency(summary.commissionMRR)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Percent className="w-3 h-3" /> Comissão Projeto
              </p>
              <p className="text-sm font-bold tabular-nums text-chart-4">{summary.commissionStatus === "pending" ? "Apuração pendente" : formatCurrency(summary.commissionProjeto)}</p>
            </div>
          </div>

          {/* Campaign Bonuses */}
          {summary.campaignBonuses > 0 && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                <Trophy className="w-3 h-3 text-primary-soft-foreground" /> Bônus de Campanhas
              </p>
              <div className="space-y-1">
                {summary.campaignBonusList.map((cb, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground truncate max-w-[140px]">{cb.campaignName}</span>
                    <span className="font-semibold tabular-nums text-primary-soft-foreground">{formatCurrency(cb.bonusValue)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-sm font-bold pt-1 border-t border-border/50">
                  <span>Total Campanhas</span>
                  <span className="tabular-nums text-primary-soft-foreground">{formatCurrency(summary.campaignBonuses)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Sales breakdown */}
          <div className="pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground mb-2 tabular-nums">Vendas do mês: {formatCurrency(summary.salesRevenue)}</p>
            <div className="flex items-center gap-4 text-sm font-semibold tabular-nums">
              <span className="text-chart-3">
                Rec.: {formatCurrency(summary.totalMRR)}
              </span>
              <span className="text-chart-4">
                Projeto: {formatCurrency(summary.totalProjeto)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function Comissoes() {
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());

  const { allowed: canViewAll, isLoading: isLoadingAdmin } = useFeaturePermission('commissions.view_all');
  const { data: currentMember, isLoading: isLoadingCurrentMember } = useCurrentTeamMember();
  const { data: teamMembers = [], isLoading: isLoadingMembers } = useTeamMembers();
  const { data: commissions = [], isLoading: isLoadingCommissions } = useCommissions(selectedMonth, selectedYear);
  const avatarMap = useAvatarMap();

  // Filter members based on metric_type and permission
  const visibleVendas = useMemo(() => {
    const allVendas = teamMembers.filter(m => (m as any).metric_type === "sales" && m.is_active);
    if (canViewAll) return allVendas;
    if ((currentMember as any)?.metric_type === "sales") {
      return allVendas.filter(m => m.id === currentMember!.id);
    }
    return [];
  }, [teamMembers, canViewAll, currentMember]);

  const visibleReunioes = useMemo(() => {
    const allReunioes = teamMembers.filter(m => (m as any).metric_type === "meetings" && m.is_active);
    if (canViewAll) return allReunioes;
    if ((currentMember as any)?.metric_type === "meetings") {
      return allReunioes.filter(m => m.id === currentMember!.id);
    }
    return [];
  }, [teamMembers, canViewAll, currentMember]);

  // Determine which tab to show based on metric_type
  const defaultTab = useMemo(() => {
    if (canViewAll) return "vendas";
    if ((currentMember as any)?.metric_type === "meetings") return "reunioes";
    return "vendas";
  }, [canViewAll, currentMember]);

  // Summary stats (only for users with view_all permission)
  const totalPaidCommissions = useMemo(() =>
    canViewAll ? commissions.filter(c => c.paid).reduce((sum, c) => sum + Number(c.amount || 0), 0) : 0,
    [commissions, canViewAll]
  );

  const totalPendingCommissions = useMemo(() =>
    canViewAll ? commissions.filter(c => !c.paid).reduce((sum, c) => sum + Number(c.amount || 0), 0) : 0,
    [commissions, canViewAll]
  );

  const years = Array.from({ length: 5 }, (_, i) => currentDate.getFullYear() - i);

  const isLoading = isLoadingAdmin || isLoadingCurrentMember || isLoadingMembers;

  // Check if user has no team member record
  const hasNoAccess = !canViewAll && !currentMember && !isLoading;

  const showVendasTab = canViewAll || (currentMember as any)?.metric_type === "sales";
  const showReunioesTab = canViewAll || (currentMember as any)?.metric_type === "meetings";

  return (
    // V5: a página inteira mora no <Tabs> para a pílula ir ao cabeçalho
    // (Radix só exige lista e conteúdos sob o mesmo Root). Mesmos values e o
    // mesmo `defaultValue` calculado por papel.
    <Tabs defaultValue={defaultTab} className="w-full space-y-5">
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
                {months.map((month, index) => (
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
          </>
        }
        tabs={
          // A lista fica mesmo com uma aba só ("Minha Comissão"): o
          // `defaultValue` é decidido antes de o membro carregar, e o gatilho
          // é a única saída de quem nasce na aba errada (ver relatório).
          !hasNoAccess ? (
            <TabsList variant="pill" aria-label="Comissões por time">
              {showVendasTab && (
                <TabsTrigger value="vendas">
                  <Users className="h-3.5 w-3.5" />
                  {canViewAll ? `Vendas (${visibleVendas.length})` : "Minha Comissão"}
                </TabsTrigger>
              )}
              {showReunioesTab && (
                <TabsTrigger value="reunioes">
                  <Users className="h-3.5 w-3.5" />
                  {canViewAll ? `Reuniões (${visibleReunioes.length})` : "Minha Comissão"}
                </TabsTrigger>
              )}
            </TabsList>
          ) : undefined
        }
      />

      {/* OTE Rules Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-[15px] tracking-[-0.02em]">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary-soft-foreground">
              <Target className="h-4 w-4" strokeWidth={2.2} />
            </span>
            Regras de OTE (On-Target Earnings)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-sm">
            <div className="flex items-center gap-2 rounded-2xl bg-sunken px-3 py-2.5">
              <Badge variant="soft" className="tabular-nums">{"< 70%"}</Badge>
              <span className="text-muted-foreground">0x bônus</span>
            </div>
            <div className="flex items-center gap-2 rounded-2xl bg-sunken px-3 py-2.5">
              <Badge variant="warning" className="tabular-nums">70-99%</Badge>
              <span className="text-muted-foreground">0.7x bônus</span>
            </div>
            <div className="flex items-center gap-2 rounded-2xl bg-sunken px-3 py-2.5">
              <Badge variant="gold" className="tabular-nums">100-119%</Badge>
              <span className="text-muted-foreground">1.0x bônus</span>
            </div>
            <div className="flex items-center gap-2 rounded-2xl bg-sunken px-3 py-2.5">
              <Badge variant="success" className="tabular-nums">≥ 120%</Badge>
              <span className="text-muted-foreground">1.2x bônus</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards - Only for users with view_all permission */}
      {canViewAll && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="min-w-0"
          >
            <KpiTile className="h-full" label="Total Vendas" value={visibleVendas.length} icon={TrendingUp} tone="neutral" />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="min-w-0"
          >
            <KpiTile className="h-full" label="Total Reuniões" value={visibleReunioes.length} icon={CalendarCheck} tone="neutral" />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="min-w-0"
          >
            <KpiTile className="h-full" label="Comissões Pagas" value={formatCurrency(totalPaidCommissions)} icon={Wallet} tone="good" />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="min-w-0"
          >
            <KpiTile className="h-full" label="Comissões Pendentes" value={formatCurrency(totalPendingCommissions)} icon={Hourglass} tone="info" />
          </motion.div>
        </div>
      )}

      {/* No access message */}
      {hasNoAccess && (
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <span className="mb-4 grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <Lock className="h-5 w-5" />
            </span>
            <p className="mb-1 text-sm font-semibold">Acesso Restrito</p>
            <p className="text-[13px] text-muted-foreground">
              Você não possui um registro de membro da equipe associado à sua conta.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Commission Cards by Role */}
      {!hasNoAccess && (
        <>
          <TabsContent value="vendas" className="mt-0">
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-[300px] rounded-card" />
                ))}
              </div>
            ) : visibleVendas.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-[13px] text-muted-foreground">
                  {canViewAll ? "Nenhum membro de vendas cadastrado" : "Sem dados de comissão"}
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleVendas.map(member => (
                  <MemberCommissionCard
                    key={member.id}
                    memberId={member.id}
                    memberName={member.name}
                    memberRole={member.role}
                    month={selectedMonth}
                    year={selectedYear}
                    avatarUrl={avatarMap.get(member.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="reunioes" className="mt-0">
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-[300px] rounded-card" />
                ))}
              </div>
            ) : visibleReunioes.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-[13px] text-muted-foreground">
                  {canViewAll ? "Nenhum membro de reuniões cadastrado" : "Sem dados de comissão"}
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleReunioes.map(member => (
                  <MemberCommissionCard
                    key={member.id}
                    memberId={member.id}
                    memberName={member.name}
                    memberRole={member.role}
                    month={selectedMonth}
                    year={selectedYear}
                    avatarUrl={avatarMap.get(member.id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </>
      )}
    </Tabs>
  );
}
