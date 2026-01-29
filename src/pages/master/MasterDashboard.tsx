/**
 * Dashboard principal da área Master
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  Users,
  CreditCard,
  Activity,
  TrendingUp,
  AlertTriangle,
  Shield,
  Clock,
} from "lucide-react";
import { useMasterOrganizationStats } from "@/hooks/useMasterOrganizations";
import { useMasterUserStats } from "@/hooks/useMasterUsers";
import { useMasterAuditStats } from "@/hooks/useMasterAuditLogs";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import { Link } from "react-router-dom";

export default function MasterDashboard() {
  const { masterUser } = useMasterAuth();
  const { data: orgStats, isLoading: orgLoading } = useMasterOrganizationStats();
  const { data: userStats, isLoading: userLoading } = useMasterUserStats();
  const { data: auditStats, isLoading: auditLoading } = useMasterAuditStats();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Shield className="w-8 h-8 text-red-500" />
          Master Admin
        </h1>
        <p className="text-muted-foreground mt-1">
          Painel de controle com acesso total ao sistema
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link to="/master/organizations">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Organizações
              </CardTitle>
              <Building2 className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {orgLoading ? "..." : orgStats?.total || 0}
              </div>
              <div className="flex gap-2 mt-2">
                <Badge variant="default" className="text-xs">
                  {orgStats?.active || 0} ativas
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {orgStats?.trial || 0} trial
                </Badge>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/master/users">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Usuários
              </CardTitle>
              <Users className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {userLoading ? "..." : userStats?.total || 0}
              </div>
              <div className="flex gap-2 mt-2">
                <Badge variant="default" className="text-xs">
                  {userStats?.active || 0} ativos
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {userStats?.admins || 0} admins
                </Badge>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/master/organizations">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Billing Overrides
              </CardTitle>
              <CreditCard className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {orgLoading ? "..." : orgStats?.withOverride || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Organizações com plano liberado manualmente
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link to="/master/audit-logs">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Ações Hoje
              </CardTitle>
              <Activity className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {auditLoading ? "..." : auditStats?.totalToday || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {auditStats?.totalWeek || 0} na última semana
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Organization Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Status das Organizações</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>Ativas</span>
              </div>
              <span className="font-semibold">{orgStats?.active || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500" />
                <span>Em Trial</span>
              </div>
              <span className="font-semibold">{orgStats?.trial || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <span>Suspensas</span>
              </div>
              <span className="font-semibold">{orgStats?.suspended || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span>Canceladas/Expiradas</span>
              </div>
              <span className="font-semibold">{orgStats?.cancelled || 0}</span>
            </div>
          </CardContent>
        </Card>

        {/* User Roles */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Distribuição de Roles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="destructive">Admin</Badge>
                <span>Administradores</span>
              </div>
              <span className="font-semibold">{userStats?.admins || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="default">SDR</Badge>
                <span>SDRs</span>
              </div>
              <span className="font-semibold">{userStats?.sdrs || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Closer</Badge>
                <span>Closers</span>
              </div>
              <span className="font-semibold">{userStats?.closers || 0}</span>
            </div>
            {(userStats?.withoutOrg || 0) > 0 && (
              <div className="flex items-center justify-between text-yellow-600">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Sem Organização</span>
                </div>
                <span className="font-semibold">{userStats?.withoutOrg}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Master Info */}
      <Card className="bg-muted/30">
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-full bg-red-500/10">
              <Shield className="w-6 h-6 text-red-500" />
            </div>
            <div>
              <p className="font-medium">Logado como Master</p>
              <p className="text-sm text-muted-foreground">
                {masterUser?.notes || "Acesso total ao sistema"}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4" />
              <span>Todas as ações são registradas no log de auditoria</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
