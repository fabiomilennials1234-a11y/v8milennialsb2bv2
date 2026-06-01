/**
 * Master Admin — Copilot Toggle Audit
 *
 * Onda 3 F6 (2026-04-26).
 *
 * 2 abas:
 *   - Histórico: ações de toggle (lead_history + master_audit_logs)
 *   - Drift: preferences ↔ leads divergentes (sync falhou)
 */

import { Fragment, useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  History,
  RefreshCw,
  Shield,
  ShieldCheck,
  ToggleLeft as SwitchIcon,
  User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  useCopilotToggleAudit,
  useCopilotToggleDrift,
  type CopilotToggleAuditFilters,
} from "@/modules/copilot/hooks/useCopilotToggleAudit";
import { useMasterOrganizations } from "../hooks/useMasterOrganizations";

const PRESET_RANGES = [
  { value: "24h", label: "Últimas 24h", hours: 24 },
  { value: "7d", label: "Últimos 7d", hours: 24 * 7 },
  { value: "30d", label: "Últimos 30d", hours: 24 * 30 },
  { value: "all", label: "Tudo", hours: 0 },
] as const;

function HistoryTab() {
  const [orgId, setOrgId] = useState<string>("all");
  const [leadId, setLeadId] = useState<string>("");
  const [rangeKey, setRangeKey] = useState<string>("7d");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: orgs } = useMasterOrganizations();
  const orgNameById = useMemo(() => {
    const m = new Map<string, string>();
    (orgs ?? []).forEach((o) => m.set(o.id, o.name));
    return m;
  }, [orgs]);

  const filters: CopilotToggleAuditFilters = useMemo(() => {
    const preset = PRESET_RANGES.find((p) => p.value === rangeKey);
    const since = preset && preset.hours > 0
      ? new Date(Date.now() - preset.hours * 60 * 60 * 1000).toISOString()
      : undefined;
    return {
      organizationId: orgId !== "all" ? orgId : undefined,
      leadId: leadId.trim() || undefined,
      startDate: since,
      limit: 200,
    };
  }, [orgId, leadId, rangeKey]);

  const { data: rows, isLoading, refetch, isFetching } = useCopilotToggleAudit(filters);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Organização</Label>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {(orgs ?? []).map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Lead ID</Label>
              <Input placeholder="UUID do lead" value={leadId} onChange={(e) => setLeadId(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Janela</Label>
              <Select value={rangeKey} onValueChange={setRangeKey}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESET_RANGES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={cn("w-4 h-4 mr-2", isFetching && "animate-spin")} />
                Atualizar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">
            {isLoading ? "Carregando..." : `${rows?.length ?? 0} eventos de toggle`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Buscando…</div>
          ) : !rows || rows.length === 0 ? (
            <div className="py-12 text-center">
              <History className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Nenhum evento na janela.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Quando</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Organização</TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead>Por</TableHead>
                  <TableHead>RPC</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const isOpen = expanded === r.id;
                  const isDisable = r.action === "ai_disabled" || r.action === "copilot_disabled";
                  return (
                    <Fragment key={r.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => setExpanded(isOpen ? null : r.id)}
                      >
                        <TableCell>
                          {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          <div>{format(new Date(r.created_at), "dd/MM HH:mm:ss", { locale: ptBR })}</div>
                          <div className="text-muted-foreground">
                            {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, locale: ptBR })}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={isDisable ? "destructive" : "default"} className="text-xs">
                            <SwitchIcon className="w-3 h-3 mr-1" />
                            {isDisable ? "Desligou" : "Ligou"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.organization_id
                            ? orgNameById.get(r.organization_id) ?? <span className="font-mono text-xs text-muted-foreground">{r.organization_id.slice(0, 8)}…</span>
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {r.lead_id ? `${r.lead_id.slice(0, 8)}…` : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-xs">
                            {r.set_by_master ? (
                              <Shield className="w-3.5 h-3.5 text-red-500" />
                            ) : (
                              <User className="w-3.5 h-3.5 text-muted-foreground" />
                            )}
                            <span className="font-mono text-muted-foreground">
                              {r.set_by_user_id ? `${r.set_by_user_id.slice(0, 8)}…` : "—"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {r.rpc ? <Badge variant="outline" className="font-mono text-xs">{r.rpc}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-muted/30">
                            <div className="py-3 space-y-2">
                              <div className="text-xs"><span className="font-semibold">Descrição:</span> {r.description ?? "—"}</div>
                              <ScrollArea className="max-h-[300px] rounded-md border bg-background p-3">
                                <pre className="text-xs whitespace-pre-wrap font-mono">{JSON.stringify(r.metadata, null, 2)}</pre>
                              </ScrollArea>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DriftTab() {
  const { data: drift, refetch, isFetching } = useCopilotToggleDrift();
  const { data: orgs } = useMasterOrganizations();
  const orgNameById = useMemo(() => {
    const m = new Map<string, string>();
    (orgs ?? []).forEach((o) => m.set(o.id, o.name));
    return m;
  }, [orgs]);

  const totalAffectedLeads = useMemo(
    () => (drift ?? []).reduce((sum, d) => sum + d.total_leads, 0),
    [drift],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {drift && drift.length > 0 ? (
                <>
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  <div>
                    <p className="font-semibold text-sm">{drift.length} phones com drift</p>
                    <p className="text-xs text-muted-foreground">
                      {totalAffectedLeads} leads afetados — sync entre phone_ai_preferences ↔ leads.ai_disabled falhou
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-5 h-5 text-emerald-500" />
                  <div>
                    <p className="font-semibold text-sm">Sem drift detectado</p>
                    <p className="text-xs text-muted-foreground">phone_ai_preferences ↔ leads.ai_disabled coerentes</p>
                  </div>
                </>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("w-4 h-4 mr-2", isFetching && "animate-spin")} />
              Reverificar
            </Button>
          </div>
        </CardContent>
      </Card>

      {drift && drift.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organização</TableHead>
                  <TableHead>Phone normalizado</TableHead>
                  <TableHead>Preference</TableHead>
                  <TableHead className="text-right">Leads desligados</TableHead>
                  <TableHead className="text-right">Leads ligados</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drift.map((d) => (
                  <TableRow key={`${d.organization_id}-${d.normalized_phone}`}>
                    <TableCell className="text-sm">
                      {orgNameById.get(d.organization_id) ?? (
                        <span className="font-mono text-xs">{d.organization_id.slice(0, 8)}…</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{d.normalized_phone}</TableCell>
                    <TableCell>
                      <Badge variant={d.preferences_disabled ? "destructive" : "default"} className="text-xs">
                        {d.preferences_disabled ? "Desligado" : "Ligado"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{d.leads_disabled_count}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{d.leads_enabled_count}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{d.total_leads}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function CopilotToggleAudit() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-blue-500/10">
          <SwitchIcon className="w-6 h-6 text-blue-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Copilot Toggle Audit</h1>
          <p className="text-sm text-muted-foreground">
            Histórico de ações ligar/desligar copilot + detecção de drift entre fontes
          </p>
        </div>
      </div>

      <Tabs defaultValue="history" className="space-y-4">
        <TabsList>
          <TabsTrigger value="history">
            <History className="w-4 h-4 mr-2" /> Histórico
          </TabsTrigger>
          <TabsTrigger value="drift">
            <AlertTriangle className="w-4 h-4 mr-2" /> Drift
          </TabsTrigger>
        </TabsList>
        <TabsContent value="history"><HistoryTab /></TabsContent>
        <TabsContent value="drift"><DriftTab /></TabsContent>
      </Tabs>
    </div>
  );
}
