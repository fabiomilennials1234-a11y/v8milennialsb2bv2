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
  AlertTriangle,
  Shield,
  Clock,
} from "lucide-react";
import { useMasterOrganizationStats } from "../hooks/useMasterOrganizations";
import { useMasterUserStats } from "../hooks/useMasterUsers";
import { useMasterAuditStats } from "../hooks/useMasterAuditLogs";
import { useMasterAuth } from "../hooks/useMasterAuth";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/ui/page-header";
import { KpiRow, KpiTile } from "@/components/ui/bento";

const kpiLinkClass =
  "block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function MasterDashboard() {
  const { masterUser } = useMasterAuth();
  const { data: orgStats, isLoading: orgLoading } = useMasterOrganizationStats();
  const { data: userStats, isLoading: userLoading } = useMasterUserStats();
  const { data: auditStats, isLoading: auditLoading } = useMasterAuditStats();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Master Admin"
        subtitle="Painel de controle com acesso total ao sistema"
      />

      {/* Quick Stats */}
      <KpiRow cols={4}>
        <Link to="/master/organizations" className={kpiLinkClass}>
          <KpiTile
            label="Organizações"
            icon={Building2}
            tone="info"
            loading={orgLoading}
            value={orgLoading ? "..." : orgStats?.total || 0}
          >
            <div className="flex gap-2">
              <Badge variant="success" className="text-xs">
                {orgStats?.active || 0} ativas
              </Badge>
              <Badge variant="soft" className="text-xs">
                {orgStats?.trial || 0} trial
              </Badge>
            </div>
          </KpiTile>
        </Link>

        <Link to="/master/users" className={kpiLinkClass}>
          <KpiTile
            label="Usuários"
            icon={Users}
            tone="good"
            loading={userLoading}
            value={userLoading ? "..." : userStats?.total || 0}
          >
            <div className="flex gap-2">
              <Badge variant="success" className="text-xs">
                {userStats?.active || 0} ativos
              </Badge>
              <Badge variant="outline" className="text-xs">
                {userStats?.admins || 0} admins
              </Badge>
            </div>
          </KpiTile>
        </Link>

        <Link to="/master/organizations" className={kpiLinkClass}>
          <KpiTile
            label="Billing Overrides"
            icon={CreditCard}
            tone="gold"
            loading={orgLoading}
            value={orgLoading ? "..." : orgStats?.withOverride || 0}
            note="Organizações com plano liberado manualmente"
          />
        </Link>

        <Link to="/master/audit-logs" className={kpiLinkClass}>
          <KpiTile
            label="Ações Hoje"
            icon={Activity}
            tone="neutral"
            loading={auditLoading}
            value={auditLoading ? "..." : auditStats?.totalToday || 0}
            note={`${auditStats?.totalWeek || 0} na última semana`}
          />
        </Link>
      </KpiRow>

      {/* Status Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Organization Status */}
        <Card>
          <CardHeader>
            <CardTitle>Status das Organizações</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-success" />
                <span>Ativas</span>
              </div>
              <span className="font-bold tabular-nums">{orgStats?.active || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-insights" />
                <span>Em Trial</span>
              </div>
              <span className="font-bold tabular-nums">{orgStats?.trial || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-warning" />
                <span>Suspensas</span>
              </div>
              <span className="font-bold tabular-nums">{orgStats?.suspended || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-destructive" />
                <span>Canceladas/Expiradas</span>
              </div>
              <span className="font-bold tabular-nums">{orgStats?.cancelled || 0}</span>
            </div>
          </CardContent>
        </Card>

        {/* User Roles */}
        <Card>
          <CardHeader>
            <CardTitle>Distribuição de Roles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="destructive">Admin</Badge>
                <span>Administradores</span>
              </div>
              <span className="font-bold tabular-nums">{userStats?.admins || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="gold">Reuniões</Badge>
                <span>Responsáveis (Reuniões)</span>
              </div>
              <span className="font-bold tabular-nums">{userStats?.sdrs || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="soft">Vendas</Badge>
                <span>Responsáveis (Vendas)</span>
              </div>
              <span className="font-bold tabular-nums">{userStats?.closers || 0}</span>
            </div>
            {(userStats?.withoutOrg || 0) > 0 && (
              <div className="flex items-center justify-between text-warning-strong">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Sem Organização</span>
                </div>
                <span className="font-bold tabular-nums">{userStats?.withoutOrg}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Master Info */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-destructive/10">
              <Shield className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="font-semibold">Logado como Master</p>
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
