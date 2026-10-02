/**
 * Página de logs de auditoria do Master
 */

import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Activity,
  CalendarDays,
  ListFilter,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PageHeader } from "@/components/ui/page-header";
import { KpiRow, KpiTile } from "@/components/ui/bento";
import {
  useMasterAuditLogs,
  useMasterAuditActions,
  useMasterAuditStats,
} from "../hooks/useMasterAuditLogs";

export default function MasterAuditLogs() {
  const [actionFilter, setActionFilter] = useState<string>("");
  const [targetFilter, setTargetFilter] = useState<string>("");

  const { data: logs, isLoading, refetch } = useMasterAuditLogs({
    action: actionFilter || undefined,
    targetType: targetFilter || undefined,
    limit: 200,
  });
  const { data: actions } = useMasterAuditActions();
  const { data: stats } = useMasterAuditStats();

  const getActionBadge = (action: string) => {
    const tones: Record<string, BadgeProps["variant"]> = {
      BILLING_OVERRIDE: "gold",
      FEATURE_ENABLE: "success",
      FEATURE_DISABLE: "destructive",
      USER_UPDATE: "info",
      ORG_CREATE: "success",
      ORG_DELETE: "destructive",
    };
    return <Badge variant={tones[action] ?? "soft"}>{action.replace(/_/g, " ")}</Badge>;
  };

  const formatDetails = (details: Record<string, any> | null) => {
    if (!details) return "-";
    return Object.entries(details)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Logs de Auditoria"
        subtitle="Histórico de todas as ações realizadas por Masters"
        actions={
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </Button>
        }
      />

      {/* Stats */}
      <KpiRow cols={3}>
        <KpiTile label="Ações hoje" icon={Activity} value={stats?.totalToday || 0} />
        <KpiTile label="Últimos 7 dias" icon={CalendarDays} value={stats?.totalWeek || 0} />
        <KpiTile
          label="Tipos de ação"
          icon={ListFilter}
          value={Object.keys(stats?.byAction || {}).length || 0}
        />
      </KpiRow>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Select 
          value={actionFilter || "__all__"} 
          onValueChange={(value) => setActionFilter(value === "__all__" ? "" : value)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filtrar por ação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas as ações</SelectItem>
            {actions?.map((action) => (
              <SelectItem key={action} value={action}>
                {action.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select 
          value={targetFilter || "__all__"} 
          onValueChange={(value) => setTargetFilter(value === "__all__" ? "" : value)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filtrar por tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os tipos</SelectItem>
            <SelectItem value="organization">Organização</SelectItem>
            <SelectItem value="user">Usuário</SelectItem>
            <SelectItem value="feature">Feature</SelectItem>
            <SelectItem value="plan">Plano</SelectItem>
          </SelectContent>
        </Select>

        {(actionFilter || targetFilter) && (
          <Button
            variant="ghost"
            onClick={() => {
              setActionFilter("");
              setTargetFilter("");
            }}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Data/Hora</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Detalhes</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : logs?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Nenhum log encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  logs?.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm">
                        {format(new Date(log.created_at), "dd/MM/yyyy HH:mm:ss", {
                          locale: ptBR,
                        })}
                      </TableCell>
                      <TableCell>{getActionBadge(log.action)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {log.target_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate text-sm text-muted-foreground">
                        {formatDetails(log.details)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {log.ip_address || "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
