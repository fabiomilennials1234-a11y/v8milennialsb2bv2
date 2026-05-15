/**
 * /master/whatsapp-health — operator dashboard for the WhatsApp pipeline.
 *
 * Three sections:
 *   - Health checks (latest snapshot per Uazapi instance, drift + status)
 *   - Dead sessions (whatsapp_instances with session_dead_since set)
 *   - DLQ (pending + exhausted webhook events)
 *
 * Read-only (RLS: master + org admin). No mutations from this page — recovery
 * actions are auto-triggered by the cron functions.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, AlertTriangle, ServerOff, Inbox } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type HealthCheck = {
  instance_id: string;
  organization_id: string;
  checked_at: string;
  v8_inbound_1h: number;
  uazapi_inbound_1h: number | null;
  drift_ratio: number | null;
  status: "healthy" | "warning" | "critical" | "rebind_triggered" | "probe_failed" | "error";
  action_taken: string | null;
  notes: string | null;
  whatsapp_instances: { instance_name: string; provider: string } | null;
  organizations: { name: string } | null;
};

type DeadInstance = {
  id: string;
  instance_name: string;
  session_dead_since: string;
  session_dead_reason: string | null;
  organizations: { name: string } | null;
};

type DlqRow = {
  id: string;
  received_at: string;
  event: string | null;
  reason: string;
  attempts: number;
  last_error: string | null;
};

function statusVariant(status: HealthCheck["status"]) {
  switch (status) {
    case "healthy": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "warning": return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "critical": return "bg-red-500/15 text-red-400 border-red-500/30";
    case "rebind_triggered": return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "probe_failed":
    case "error": return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
  }
}

export default function MasterWhatsAppHealth() {
  // Latest health check per instance — group by instance, pick max checked_at.
  // Done client-side to keep the query simple; volume is small (~40 instances).
  const checks = useQuery<HealthCheck[]>({
    queryKey: ["whatsapp-health-checks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_health_checks")
        .select("instance_id, organization_id, checked_at, v8_inbound_1h, uazapi_inbound_1h, drift_ratio, status, action_taken, notes, whatsapp_instances:instance_id(instance_name,provider), organizations:organization_id(name)")
        .order("checked_at", { ascending: false })
        .limit(500)
        .returns<HealthCheck[]>();
      if (error) throw error;
      const seen = new Set<string>();
      return (data ?? []).filter((r) => {
        if (seen.has(r.instance_id)) return false;
        seen.add(r.instance_id);
        return true;
      });
    },
    refetchInterval: 60_000,
  });

  const dead = useQuery<DeadInstance[]>({
    queryKey: ["whatsapp-dead-sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_instances")
        .select("id, instance_name, session_dead_since, session_dead_reason, organizations:organization_id(name)")
        .not("session_dead_since", "is", null)
        .order("session_dead_since", { ascending: false })
        .returns<DeadInstance[]>();
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 60_000,
  });

  const dlq = useQuery<{ pending: DlqRow[]; exhausted: number }>({
    queryKey: ["whatsapp-dlq"],
    queryFn: async () => {
      const { data: pending, error: e1 } = await supabase
        .from("whatsapp_webhook_dlq")
        .select("id, received_at, event, reason, attempts, last_error")
        .is("resolved_at", null)
        .lt("attempts", 5)
        .order("received_at", { ascending: false })
        .limit(50)
        .returns<DlqRow[]>();
      if (e1) throw e1;
      const { count, error: e2 } = await supabase
        .from("whatsapp_webhook_dlq")
        .select("id", { count: "exact", head: true })
        .is("resolved_at", null)
        .gte("attempts", 5);
      if (e2) throw e2;
      return { pending: pending ?? [], exhausted: count ?? 0 };
    },
    refetchInterval: 60_000,
  });

  const summary = (() => {
    const rows = checks.data ?? [];
    return {
      total: rows.length,
      critical: rows.filter((r) => r.status === "critical" || r.status === "rebind_triggered").length,
      warning: rows.filter((r) => r.status === "warning").length,
      probe_failed: rows.filter((r) => r.status === "probe_failed").length,
    };
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">WhatsApp Health</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Saúde do pipeline Uazapi por instância. Atualiza a cada 1 min.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { checks.refetch(); dead.refetch(); dlq.refetch(); }}
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Instâncias monitoradas</p>
            <p className="text-2xl font-semibold mt-1">{summary.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Critical / rebind</p>
            <p className="text-2xl font-semibold mt-1 text-red-400">{summary.critical}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Warning</p>
            <p className="text-2xl font-semibold mt-1 text-amber-400">{summary.warning}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">DLQ pendente</p>
            <p className="text-2xl font-semibold mt-1">{dlq.data?.pending.length ?? 0}</p>
            {dlq.data && dlq.data.exhausted > 0 && (
              <p className="text-xs text-red-400 mt-1">+{dlq.data.exhausted} exhausted</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="w-4 h-4" /> Health checks (último por instância)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Instância</TableHead>
                <TableHead>Org</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">V8 / Uazapi (1h)</TableHead>
                <TableHead className="text-right">Drift</TableHead>
                <TableHead>Checked</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(checks.data ?? []).map((r) => (
                <TableRow key={r.instance_id}>
                  <TableCell className="font-mono text-xs">{r.whatsapp_instances?.instance_name ?? r.instance_id.slice(0, 8)}</TableCell>
                  <TableCell className="text-xs">{r.organizations?.name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge className={statusVariant(r.status)} variant="outline">
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.v8_inbound_1h} / {r.uazapi_inbound_1h ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.drift_ratio === null ? "—" : r.drift_ratio.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {formatDistanceToNow(new Date(r.checked_at), { addSuffix: true, locale: ptBR })}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.action_taken ? `${r.action_taken}` : (r.notes ?? "")}
                  </TableCell>
                </TableRow>
              ))}
              {checks.data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground text-sm py-8">
                    Sem snapshots ainda — o monitor roda a cada 5 min.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ServerOff className="w-4 h-4" /> Sessões WhatsApp mortas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(dead.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma sessão morta.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Instância</TableHead>
                  <TableHead>Org</TableHead>
                  <TableHead>Desde</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(dead.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.instance_name}</TableCell>
                    <TableCell className="text-xs">{r.organizations?.name ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {formatDistanceToNow(new Date(r.session_dead_since), { addSuffix: true, locale: ptBR })}
                    </TableCell>
                    <TableCell className="text-xs">{r.session_dead_reason ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="w-4 h-4" /> DLQ — eventos pendentes ({dlq.data?.pending.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(dlq.data?.pending.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">DLQ vazia.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recebido</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Razão</TableHead>
                  <TableHead className="text-right">Tentativas</TableHead>
                  <TableHead>Último erro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(dlq.data?.pending ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">
                      {formatDistanceToNow(new Date(r.received_at), { addSuffix: true, locale: ptBR })}
                    </TableCell>
                    <TableCell className="text-xs">{r.event ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.reason}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.attempts}/5</TableCell>
                    <TableCell className="text-xs text-muted-foreground truncate max-w-md">
                      {r.last_error ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
