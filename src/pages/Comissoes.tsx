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
import { useTeamMembers, useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useCommissions, useCommissionSummary } from "@/hooks/useCommissions";
import { useIsAdmin } from "@/hooks/useUserRole";
import { Skeleton } from "@/components/ui/skeleton";

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
}

function MemberCommissionCard({ memberId, memberName, memberRole, month, year }: MemberCommissionCardProps) {
  const { data: summary, isLoading } = useCommissionSummary(memberId, month, year);

  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardContent className="p-6">
          <Skeleton className="h-4 w-32 mb-4" />
          <Skeleton className="h-8 w-24 mb-2" />
          <Skeleton className="h-3 w-full" />
        </CardContent>
      </Card>
    );
  }

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
      <Card className="glass-card h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-sm font-bold text-primary">
                  {memberName.split(" ").map(n => n[0]).join("").slice(0, 2)}
                </span>
              </div>
              <div>
                <CardTitle className="text-base">{memberName}</CardTitle>
                <Badge variant="outline" className="text-xs mt-0.5">
                  {memberRole === "closer" ? "Closer" : "SDR"}
                </Badge>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-success">
                {formatCurrency(summary.totalEarnings)}
              </p>
              <p className="text-xs text-muted-foreground">Total do mês</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Goal Progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progresso da Meta</span>
              <span className="font-medium">{summary.goalProgress.toFixed(0)}%</span>
            </div>
            <Progress value={Math.min(summary.goalProgress, 100)} className="h-2" />
            <div className="flex items-center gap-2 text-xs">
              {summary.goalProgress >= 120 ? (
                <Badge className="bg-success/20 text-success border-success/30">
                  <TrendingUp className="w-3 h-3 mr-1" />
                  1.2x Bônus
                </Badge>
              ) : summary.goalProgress >= 100 ? (
                <Badge className="bg-primary/20 text-primary border-primary/30">
                  <Check className="w-3 h-3 mr-1" />
                  1.0x Bônus
                </Badge>
              ) : summary.goalProgress >= 70 ? (
                <Badge className="bg-chart-5/20 text-chart-5 border-chart-5/30">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  0.7x Bônus
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Abaixo de 70%
                </Badge>
              )}
            </div>
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Wallet className="w-3 h-3" /> Base Fixa
              </p>
              <p className="text-sm font-medium">{formatCurrency(summary.oteBase)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <PiggyBank className="w-3 h-3" /> Bônus ({bonusMultiplier}x)
              </p>
              <p className="text-sm font-medium">{formatCurrency(summary.calculatedBonus)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Percent className="w-3 h-3" /> Comissão MRR
              </p>
              <p className="text-sm font-medium text-chart-3">{formatCurrency(summary.commissionMRR)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Percent className="w-3 h-3" /> Comissão Projeto
              </p>
              <p className="text-sm font-medium text-chart-4">{formatCurrency(summary.commissionProjeto)}</p>
            </div>
          </div>

          {/* Campaign Bonuses */}
          {summary.campaignBonuses > 0 && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                <Trophy className="w-3 h-3 text-primary" /> Bônus de Campanhas
              </p>
              <div className="space-y-1">
                {summary.campaignBonusList.map((cb, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground truncate max-w-[140px]">{cb.campaignName}</span>
                    <span className="font-medium text-primary">{formatCurrency(cb.bonusValue)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-sm font-semibold pt-1 border-t border-border/50">
                  <span>Total Campanhas</span>
                  <span className="text-primary">{formatCurrency(summary.campaignBonuses)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Sales breakdown */}
          <div className="pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground mb-2">Vendas do Mês</p>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-chart-3">
                MRR: {formatCurrency(summary.totalMRR)}
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

  const { isAdmin, isLoading: isLoadingAdmin } = useIsAdmin();
  const { data: currentMember, isLoading: isLoadingCurrentMember } = useCurrentTeamMember();
  const { data: teamMembers = [], isLoading: isLoadingMembers } = useTeamMembers();
  const { data: commissions = [], isLoading: isLoadingCommissions } = useCommissions(selectedMonth, selectedYear);

  // Filter members based on admin status
  const visibleClosers = useMemo(() => {
    const allClosers = teamMembers.filter(m => m.role === "closer" && m.is_active);
    if (isAdmin) return allClosers;
    if (currentMember?.role === "closer") {
      return allClosers.filter(m => m.id === currentMember.id);
    }
    return [];
  }, [teamMembers, isAdmin, currentMember]);

  const visibleSdrs = useMemo(() => {
    const allSdrs = teamMembers.filter(m => m.role === "sdr" && m.is_active);
    if (isAdmin) return allSdrs;
    if (currentMember?.role === "sdr") {
      return allSdrs.filter(m => m.id === currentMember.id);
    }
    return [];
  }, [teamMembers, isAdmin, currentMember]);

  // Determine which tab to show based on user role
  const defaultTab = useMemo(() => {
    if (isAdmin) return "closers";
    if (currentMember?.role === "sdr") return "sdrs";
    return "closers";
  }, [isAdmin, currentMember]);

  // Summary stats (only for admins)
  const totalPaidCommissions = useMemo(() => 
    isAdmin ? commissions.filter(c => c.paid).reduce((sum, c) => sum + Number(c.amount || 0), 0) : 0,
    [commissions, isAdmin]
  );

  const totalPendingCommissions = useMemo(() => 
    isAdmin ? commissions.filter(c => !c.paid).reduce((sum, c) => sum + Number(c.amount || 0), 0) : 0,
    [commissions, isAdmin]
  );

  const years = Array.from({ length: 5 }, (_, i) => currentDate.getFullYear() - i);

  const isLoading = isLoadingAdmin || isLoadingCurrentMember || isLoadingMembers;

  // Check if user has no team member record
  const hasNoAccess = !isAdmin && !currentMember && !isLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-bold flex items-center gap-2"
          >
            <DollarSign className="w-6 h-6 text-primary" />
            Comissões
          </motion.h1>
          <p className="text-muted-foreground mt-1">
            Acompanhe ganhos da equipe com OTE e comissões
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select 
            value={selectedMonth.toString()} 
            onValueChange={(v) => setSelectedMonth(Number(v))}
          >
            <SelectTrigger className="w-[140px]">
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
            <SelectTrigger className="w-[100px]">
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
        </div>
      </div>

      {/* OTE Rules Card */}
      <Card className="glass-card border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            Regras de OTE (On-Target Earnings)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-muted">{"< 70%"}</Badge>
              <span className="text-muted-foreground">0x bônus</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-chart-5/20 text-chart-5 border-chart-5/30">70-99%</Badge>
              <span className="text-muted-foreground">0.7x bônus</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-primary/20 text-primary border-primary/30">100-119%</Badge>
              <span className="text-muted-foreground">1.0x bônus</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-success/20 text-success border-success/30">≥ 120%</Badge>
              <span className="text-muted-foreground">1.2x bônus</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards - Only for admins */}
      {isAdmin && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-4"
          >
            <p className="text-xs text-muted-foreground mb-1">Total Closers</p>
            <p className="text-xl font-bold">{visibleClosers.length}</p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="glass-card p-4"
          >
            <p className="text-xs text-muted-foreground mb-1">Total SDRs</p>
            <p className="text-xl font-bold">{visibleSdrs.length}</p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card p-4"
          >
            <p className="text-xs text-muted-foreground mb-1">Comissões Pagas</p>
            <p className="text-xl font-bold text-success">{formatCurrency(totalPaidCommissions)}</p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="glass-card p-4"
          >
            <p className="text-xs text-muted-foreground mb-1">Comissões Pendentes</p>
            <p className="text-xl font-bold text-chart-5">{formatCurrency(totalPendingCommissions)}</p>
          </motion.div>
        </div>
      )}

      {/* No access message */}
      {hasNoAccess && (
        <Card className="glass-card border-destructive/30">
          <CardContent className="py-12 text-center">
            <Lock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium mb-2">Acesso Restrito</p>
            <p className="text-muted-foreground">
              Você não possui um registro de membro da equipe associado à sua conta.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Commission Cards by Role */}
      {!hasNoAccess && (
        <Tabs defaultValue={defaultTab} className="w-full">
          <TabsList className={`grid w-full max-w-md ${isAdmin ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {(isAdmin || currentMember?.role === "closer") && (
              <TabsTrigger value="closers" className="gap-2">
                <Users className="w-4 h-4" />
                {isAdmin ? `Closers (${visibleClosers.length})` : "Minha Comissão"}
              </TabsTrigger>
            )}
            {(isAdmin || currentMember?.role === "sdr") && (
              <TabsTrigger value="sdrs" className="gap-2">
                <Users className="w-4 h-4" />
                {isAdmin ? `SDRs (${visibleSdrs.length})` : "Minha Comissão"}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="closers" className="mt-4">
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-[300px]" />
                ))}
              </div>
            ) : visibleClosers.length === 0 ? (
              <Card className="glass-card">
                <CardContent className="py-8 text-center text-muted-foreground">
                  {isAdmin ? "Nenhum closer cadastrado" : "Sem dados de comissão"}
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleClosers.map(member => (
                  <MemberCommissionCard
                    key={member.id}
                    memberId={member.id}
                    memberName={member.name}
                    memberRole={member.role}
                    month={selectedMonth}
                    year={selectedYear}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="sdrs" className="mt-4">
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-[300px]" />
                ))}
              </div>
            ) : visibleSdrs.length === 0 ? (
              <Card className="glass-card">
                <CardContent className="py-8 text-center text-muted-foreground">
                  {isAdmin ? "Nenhum SDR cadastrado" : "Sem dados de comissão"}
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleSdrs.map(member => (
                  <MemberCommissionCard
                    key={member.id}
                    memberId={member.id}
                    memberName={member.name}
                    memberRole={member.role}
                    month={selectedMonth}
                    year={selectedYear}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
