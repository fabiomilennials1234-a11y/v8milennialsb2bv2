/**
 * RC.6: Master Admin — Copilot Reasoning Inspector
 *
 * Lista chains-of-thought capturados de <thinking>...</thinking> dos agentes
 * (runtime_logs.action='reasoning'). Filtros: org, agente, conversa, datas.
 * Click numa linha expande inline o raciocínio completo.
 */

import { Fragment, useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Filter,
  RefreshCw,
  Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  useCopilotReasoning,
  type CopilotReasoningFilters,
} from "@/modules/copilot/hooks/useCopilotReasoning";
import { useMasterOrganizations } from "../hooks/useMasterOrganizations";

const PRESET_RANGES = [
  { value: "1h", label: "Última 1h", hours: 1 },
  { value: "24h", label: "Últimas 24h", hours: 24 },
  { value: "7d", label: "Últimos 7d", hours: 24 * 7 },
  { value: "30d", label: "Últimos 30d", hours: 24 * 30 },
] as const;

export default function CopilotReasoning() {
  const [orgId, setOrgId] = useState<string>("all");
  const [agentId, setAgentId] = useState<string>("");
  const [conversationId, setConversationId] = useState<string>("");
  const [rangeKey, setRangeKey] = useState<string>("24h");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: orgs } = useMasterOrganizations();

  const filters: CopilotReasoningFilters = useMemo(() => {
    const preset = PRESET_RANGES.find((p) => p.value === rangeKey);
    const since = preset
      ? new Date(Date.now() - preset.hours * 60 * 60 * 1000).toISOString()
      : undefined;
    return {
      organizationId: orgId !== "all" ? orgId : undefined,
      agentId: agentId.trim() || undefined,
      conversationId: conversationId.trim() || undefined,
      startDate: since,
      limit: 200,
    };
  }, [orgId, agentId, conversationId, rangeKey]);

  const { data: rows, isLoading, refetch, isFetching } = useCopilotReasoning(filters);

  const orgNameById = useMemo(() => {
    const m = new Map<string, string>();
    (orgs ?? []).forEach((o) => m.set(o.id, o.name));
    return m;
  }, [orgs]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10">
            <Brain className="w-6 h-6 text-purple-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Copilot Reasoning</h1>
            <p className="text-sm text-muted-foreground">
              Chain-of-thought capturado dos agentes durante a conversa
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("w-4 h-4 mr-2", isFetching && "animate-spin")} />
          Atualizar
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
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
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Agent ID</Label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="UUID do agente"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Conversation ID</Label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="UUID da conversa"
                  value={conversationId}
                  onChange={(e) => setConversationId(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Janela</Label>
              <Select value={rangeKey} onValueChange={setRangeKey}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESET_RANGES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold">
            {isLoading ? "Carregando..." : `${rows?.length ?? 0} reasoning chains`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Buscando…
            </div>
          ) : !rows || rows.length === 0 ? (
            <div className="py-12 text-center">
              <Brain className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                Nenhum reasoning capturado nessa janela.
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Verifique se o agente tem <code className="bg-muted px-1 rounded">reasoning_mode</code> ≠ <code className="bg-muted px-1 rounded">off</code>.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Quando</TableHead>
                  <TableHead>Organização</TableHead>
                  <TableHead>Conversa</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Latência</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const isOpen = expanded === r.id;
                  const totalTokens =
                    (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0);
                  return (
                    <Fragment key={r.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => setExpanded(isOpen ? null : r.id)}
                      >
                        <TableCell>
                          {isOpen ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          <div>{format(new Date(r.created_at), "dd/MM HH:mm:ss", { locale: ptBR })}</div>
                          <div className="text-muted-foreground">
                            {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, locale: ptBR })}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.organization_id
                            ? orgNameById.get(r.organization_id) ?? (
                                <span className="font-mono text-xs text-muted-foreground">
                                  {r.organization_id.slice(0, 8)}…
                                </span>
                              )
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {r.entity_id ? `${r.entity_id.slice(0, 8)}…` : "—"}
                        </TableCell>
                        <TableCell>
                          {r.llm_model ? (
                            <Badge variant="secondary" className="font-mono text-xs">
                              {r.llm_model}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {totalTokens > 0 ? totalTokens.toLocaleString("pt-BR") : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {r.duration_ms != null ? `${r.duration_ms}ms` : "—"}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-muted/30">
                            <div className="py-3 space-y-3">
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span><span className="font-semibold">Agent:</span> <code>{r.triggered_by ?? "—"}</code></span>
                                <span><span className="font-semibold">Conversation:</span> <code>{r.entity_id ?? "—"}</code></span>
                                <span><span className="font-semibold">Status:</span> {r.status}</span>
                              </div>
                              <ScrollArea className="max-h-[420px] rounded-md border bg-background">
                                <pre className="p-4 text-xs whitespace-pre-wrap font-mono leading-relaxed">
                                  {r.reasoning ?? "(sem conteúdo)"}
                                </pre>
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
