/**
 * Aba "Atraso" do /master/automation-health.
 *
 * Requisito explícito do CTO: o master entende cada número sem perguntar.
 * A aba ENSINA enquanto mostra — em especial a distinção que originou toda a
 * investigação: Atraso (culpa nossa) ≠ Espera programada (escolha do cliente).
 *
 * Ver ADR-0023 e CONTEXT.md (termos: Lag, Wait, Due, Claim).
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Gauge, Timer, Info, Activity } from "lucide-react";
import {
  useWorkflowLagByOrg,
  useWorkflowLagByWorkflow,
  useWorkflowPoolState,
  formatLag,
  lagSeverity,
} from "@/modules/workflows";

const SEV_LABEL = { bom: "Bom", atencao: "Atenção", ruim: "Ruim" } as const;
const SEV_CLASS = {
  bom: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  atencao: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  ruim: "bg-red-500/10 text-red-400 border-red-500/20",
} as const;

function LagBadge({ ms }: { ms: number | null | undefined }) {
  const sev = lagSeverity(ms);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular-nums">{formatLag(ms)}</span>
      <Badge variant="outline" className={SEV_CLASS[sev]}>{SEV_LABEL[sev]}</Badge>
    </span>
  );
}

/** Rótulo + valor + a frase que explica o que aquilo significa. */
function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  );
}

export default function AutomationLagTab() {
  const { data: pool } = useWorkflowPoolState();
  const { data: byOrg, isLoading: loadingOrg } = useWorkflowLagByOrg(7);
  const { data: byWorkflow } = useWorkflowLagByWorkflow(7, 10);

  return (
    <div className="space-y-6">
      {/* ── Como ler ────────────────────────────────────────────────────── */}
      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4" /> Como ler esta aba
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            <strong className="text-foreground">Atraso</strong> é o tempo entre a automação{" "}
            <em>ficar pronta para rodar</em> e o sistema <em>efetivamente pegar ela</em>. É tempo em
            que o cliente esperou por nossa causa. É o número desta aba.
          </p>
          <p>
            <strong className="text-foreground">Não é</strong> a espera que o próprio cliente
            programou. Se a automação dele diz “espere 2 dias e mande a mensagem”, esses 2 dias são
            escolha dele, são saudáveis, e <strong className="text-foreground">não aparecem aqui</strong>.
            Confundir os dois é o que fez esse problema passar despercebido por meses.
          </p>
          <p>
            <strong className="text-foreground">p50</strong> é o meio da fila: metade das automações
            saiu em menos que esse tempo. <strong className="text-foreground">p90</strong> é a cauda:
            9 em cada 10 saíram em menos que isso — a décima demorou mais. O p90 representa melhor a
            reclamação do vendedor do que a média.
          </p>
        </CardContent>
      </Card>

      {/* ── Estado do motor ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4" /> Estado do motor agora
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Automações em paralelo"
            value={pool ? `${pool.size}` : "—"}
            hint={`Quantas o motor roda ao mesmo tempo. Ele ajusta sozinho entre ${pool?.min ?? 4} e ${pool?.max ?? 16}: sobe quando a fila não cabe no tempo, desce quando sobra folga.`}
          />
          <Metric
            label="Por cliente"
            value={pool ? `${Math.max(1, Math.floor(pool.size / 2))}` : "—"}
            hint="Máximo que um único cliente ocupa ao mesmo tempo. Existe para nenhum cliente sozinho tomar o motor inteiro — não é proteção de WhatsApp."
          />
          <Metric
            label="Controle"
            value={
              pool?.mode === "pinned" ? (
                <Badge variant="outline" className={SEV_CLASS.atencao}>Travado à mão</Badge>
              ) : (
                <Badge variant="outline" className={SEV_CLASS.bom}>Automático</Badge>
              )
            }
            hint={
              pool?.mode === "pinned"
                ? "Alguém fixou o valor manualmente. Enquanto estiver assim, o motor NÃO se ajusta sozinho."
                : "O motor decide sozinho quando subir ou descer, dentro da faixa. Dá para travar à mão a qualquer momento."
            }
          />
          <Metric
            label="Tempo por rodada"
            value={pool ? `${Math.round(pool.budgetMs / 1000)} s` : "—"}
            hint="Quanto cada rodada tem para trabalhar antes de devolver o que sobrou para a próxima. O motor acorda a cada 1 minuto."
          />
        </CardContent>
      </Card>

      {/* ── Por cliente ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Timer className="h-4 w-4" /> Atraso por cliente — últimos 7 dias
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingOrg ? (
            <p className="py-6 text-sm text-muted-foreground">Carregando…</p>
          ) : !byOrg?.length ? (
            <p className="py-6 text-sm text-muted-foreground">
              Nenhuma automação rodou nos últimos 7 dias — ou a medição ainda não começou a gravar.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Automações</TableHead>
                  <TableHead className="text-right">Metade saiu em (p50)</TableHead>
                  <TableHead className="text-right">9 em 10 saíram em (p90)</TableHead>
                  <TableHead className="text-right">Pior caso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byOrg.map((r) => (
                  <TableRow key={r.organization_id}>
                    <TableCell className="font-medium">{r.organization_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.claims}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatLag(r.lag_p50_ms)}</TableCell>
                    <TableCell className="text-right"><LagBadge ms={r.lag_p90_ms} /></TableCell>
                    <TableCell className="text-right tabular-nums">{formatLag(r.lag_max_ms)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Faixas: até 1 minuto é <span className="text-emerald-400">bom</span>; até 5 minutos é{" "}
            <span className="text-amber-400">atenção</span>; acima disso é{" "}
            <span className="text-red-400">ruim</span> e o vendedor percebe como “não disparou”.
          </p>
        </CardContent>
      </Card>

      {/* ── Piores automações ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> Automações que mais atrasam
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!byWorkflow?.length ? (
            <p className="py-6 text-sm text-muted-foreground">Sem dados no período.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Automação</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Execuções</TableHead>
                  <TableHead className="text-right">9 em 10 saíram em (p90)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byWorkflow.map((r) => (
                  <TableRow key={r.workflow_id}>
                    <TableCell className="font-medium">{r.workflow_name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.organization_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.claims}</TableCell>
                    <TableCell className="text-right"><LagBadge ms={r.lag_p90_ms} /></TableCell>
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
