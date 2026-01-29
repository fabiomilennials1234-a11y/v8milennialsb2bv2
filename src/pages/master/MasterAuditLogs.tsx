/**
 * Página de logs de auditoria do Master
 */

import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Activity,
  Search,
  Filter,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  useMasterAuditLogs,
  useMasterAuditActions,
  useMasterAuditStats,
} from "@/hooks/useMasterAuditLogs";

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
    const colors: Record<string, string> = {
      BILLING_OVERRIDE: "bg-purple-500",
      FEATURE_ENABLE: "bg-green-500",
      FEATURE_DISABLE: "bg-red-500",
      USER_UPDATE: "bg-blue-500",
      ORG_CREATE: "bg-emerald-500",
      ORG_DELETE: "bg-red-600",
    };
    return (
      <Badge className={colors[action] || "bg-gray-500"}>
        {action.replace(/_/g, " ")}
      </Badge>
    );
  };

  const formatDetails = (details: Record<string, any> | null) => {
    if (!details) return "-";
    return Object.entries(details)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6" />
            Logs de Auditoria
          </h1>
          <p className="text-muted-foreground">
            Histórico de todas as ações realizadas por Masters
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Atualizar
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats?.totalToday || 0}</div>
            <p className="text-sm text-muted-foreground">Ações hoje</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats?.totalWeek || 0}</div>
            <p className="text-sm text-muted-foreground">Últimos 7 dias</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {Object.keys(stats?.byAction || {}).length || 0}
            </div>
            <p className="text-sm text-muted-foreground">Tipos de ação</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
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
