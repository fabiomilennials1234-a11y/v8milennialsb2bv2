/**
 * BlastPlanRecipientsSheet — drill-down v1 da audiência congelada de um Blast
 * Plan (#944 / PRD #941). Mesma mecânica do drill-down de leads por etapa da
 * aba Saúde (FunnelStageLeadsSheet): sheet lateral, busca client-side, clique
 * no lead fecha o sheet e navega pra `/leads?lead=<id>`. O modal do lead só
 * monta na aba Leads desde 2026-07-29 (no funil, o card abre o negócio).
 *
 * Tabs = Blast Recipient Status: Enviados (`sent`) / Falha na entrega
 * (`failed`, motivo por lead — ADR-0016/#948) / Pulados (`skipped`, motivo por
 * lead) / Aguardando (`pending`, "Lote N · previsto DD/MM"). Grupos mutuamente
 * exclusivos: o sync do poll reclassifica sent → failed, então um lead migra
 * de Enviados pra Falha entre refreshes ("Enviado" = aceito pela fila).
 *
 * A tab Falha só é renderizada quando o plano tem ≥1 `failed`: plano antigo
 * (sem provenance, ADR-0016) ou plano saudável não ganha um grupo vazio que
 * insinua tracking que não existe(ia) — decisão documentada na feature note.
 *
 * Lead excluído do CRM (lead_id null, FK SET NULL): telefone + "Lead excluído",
 * não-clicável — o histórico do disparo continua íntegro e auditável.
 *
 * Audiência pode passar de 1000 rows → paginação client-side (50/página).
 */
import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BlastPlan } from "@/modules/campaigns/hooks/useBlastPlans";
import {
  useBlastPlanRecipients,
  type BlastPlanRecipient,
  type BlastRecipientStatus,
} from "@/modules/campaigns/hooks/useBlastPlanRecipients";
import {
  awaitingLotLabel,
  failureReasonLabel,
  recipientMatchesQuery,
  skipReasonLabel,
  unconfirmedLabel,
} from "@/modules/campaigns/lib/blast-recipient-view";

const PAGE_SIZE = 50;

/**
 * A ordem conta a HISTÓRIA de um destinatário, da esquerda para a direita:
 * saiu → chegou → não chegou → nunca se soube → não saiu → ainda não saiu.
 *
 * `delivered` entra depois de `sent` porque é para lá que a linha migra quando o
 * callback do canal confirma (#1724); `unconfirmed` fica encostado em `failed`
 * porque os dois respondem "não recebeu", com a diferença de que um sabe por quê.
 */
const TABS: { key: BlastRecipientStatus; label: string }[] = [
  { key: "sent", label: "Enviados" },
  { key: "delivered", label: "Entregues" },
  // "Falha na entrega" logo após Enviados: é de lá que o lead migra quando o
  // sync reclassifica (ADR-0016) ou quando o canal recusa (#1724).
  { key: "failed", label: "Falha na entrega" },
  { key: "unconfirmed", label: "Não confirmadas" },
  { key: "skipped", label: "Pulados" },
  { key: "pending", label: "Aguardando" },
];

/**
 * Abas que somem quando vazias.
 *
 * Um zero permanente INSINUA rastreamento que não existe — planos pré-ADR-0016
 * não têm `failed`, e planos do Chip nunca terão `delivered` nem `unconfirmed`,
 * porque o ciclo de entrega é do Canal Oficial (#1724; o Chip é #1731). Nenhum
 * dos três regride, então a aba nunca some debaixo do usuário: só pode aparecer.
 */
const TABS_QUE_SOMEM_VAZIAS = new Set<BlastRecipientStatus>([
  "failed",
  "delivered",
  "unconfirmed",
]);

function firstLine(message: string): string {
  const line = message.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line || "Sem mensagem";
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Coluna direita da linha, por tab. */
function recipientDetail(r: BlastPlanRecipient, plan: BlastPlan): string {
  if (r.status === "skipped") return skipReasonLabel(r.reason);
  if (r.status === "failed") return failureReasonLabel(r.reason);
  if (r.status === "unconfirmed") return unconfirmedLabel();
  if (r.status === "pending") {
    return awaitingLotLabel({
      lotIndex: r.lot_index,
      lotsReleased: plan.lots_released,
      nextReleaseDate: plan.next_release_date,
    });
  }
  return `Lote ${r.lot_index + 1}`;
}

interface BlastPlanRecipientsSheetProps {
  /** Plano da org corrente (useBlastPlans) — null fecha o sheet. */
  plan: BlastPlan | null;
  onClose: () => void;
  onOpenLead: (leadId: string) => void;
}

export function BlastPlanRecipientsSheet({ plan, onClose, onOpenLead }: BlastPlanRecipientsSheetProps) {
  const { data: recipients, isLoading } = useBlastPlanRecipients(plan);
  const [tab, setTab] = useState<BlastRecipientStatus>("sent");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  // Novo plano aberto → estado zerado.
  useEffect(() => {
    if (plan) {
      setTab("sent");
      setQuery("");
      setPage(0);
    }
  }, [plan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    // Literal EXAUSTIVO de propósito: `Record<BlastRecipientStatus, number>` é o
    // que faz o compilador reprovar quem ampliar a união e esquecer da tela — e
    // um status sem balde aqui viraria `undefined + 1 = NaN`, que a tela mostra
    // sem reclamar.
    const c: Record<BlastRecipientStatus, number> = {
      sent: 0,
      delivered: 0,
      failed: 0,
      unconfirmed: 0,
      skipped: 0,
      pending: 0,
    };
    for (const r of recipients ?? []) c[r.status] += 1;
    return c;
  }, [recipients]);

  const visibleTabs = useMemo(
    () => TABS.filter((t) => !TABS_QUE_SOMEM_VAZIAS.has(t.key) || counts[t.key] > 0),
    [counts],
  );

  const filtered = useMemo(
    () => (recipients ?? []).filter((r) => r.status === tab && recipientMatchesQuery(r, query)),
    [recipients, tab, query],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <Sheet open={plan !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-[480px]">
        <SheetHeader className="border-b border-border px-6 pb-4 pt-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
            Leads do disparo
          </div>
          <SheetTitle className="flex items-baseline gap-2.5 text-[22px] font-extrabold tracking-tight">
            <span className="min-w-0 truncate">{plan ? firstLine(plan.message) : ""}</span>
            <span className="text-primary tabular-nums">{recipients?.length ?? plan?.total_recipients ?? 0}</span>
          </SheetTitle>
          <SheetDescription className="text-xs">
            A audiência congelada deste disparo, grupo a grupo.
          </SheetDescription>
        </SheetHeader>

        {/* Tabs com contadores — flex-wrap: com Falha visível são 4 pills */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-6 py-3">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setPage(0);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-muted-foreground transition-colors",
                tab === t.key &&
                  (t.key === "failed"
                    ? "border-destructive/50 bg-destructive/10 text-foreground"
                    : "border-primary/50 bg-primary/10 text-foreground"),
              )}
            >
              {t.label}
              <span
                className={cn(
                  "tabular-nums",
                  t.key === "failed" ? "text-destructive" : "text-primary",
                )}
              >
                {counts[t.key]}
              </span>
            </button>
          ))}
        </div>

        <div className="border-b border-border px-6 py-3">
          <Input
            placeholder="Buscar por nome ou telefone..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            className="h-8 text-xs"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 p-6">
              {Array(6)
                .fill(0)
                .map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {query.trim()
                ? "Nenhum contato encontrado para essa busca."
                : "Nenhum contato neste grupo."}
            </div>
          ) : (
            visible.map((r) => {
              const deleted = r.lead_id === null;
              const displayName = deleted ? "Lead excluído" : r.name ?? "Sem nome";
              const detail = plan ? recipientDetail(r, plan) : "";
              const rowInner = (
                <>
                  <span
                    className={cn(
                      "flex h-9 w-9 flex-none items-center justify-center rounded-full border border-border bg-muted text-[11px] font-bold",
                      deleted ? "text-muted-foreground" : "text-primary",
                    )}
                  >
                    {deleted ? "—" : initialsOf(r.name ?? "?")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-[13.5px] font-semibold",
                        deleted && "italic text-muted-foreground",
                      )}
                    >
                      {displayName}
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground tabular-nums">
                      {r.phone ?? "Sem telefone"}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "flex-none text-right text-[11.5px] font-medium",
                      r.status === "skipped" || r.status === "unconfirmed"
                        ? "text-orange-400"
                        : r.status === "failed"
                          ? "text-destructive"
                          : r.status === "delivered"
                            ? "text-emerald-400"
                            : "text-muted-foreground",
                      !deleted && "group-hover:hidden",
                    )}
                  >
                    {detail}
                  </span>
                  {!deleted && (
                    <span className="hidden flex-none rounded-full border border-primary/35 bg-primary/10 px-2.5 py-1 text-[10.5px] font-semibold text-primary group-hover:inline-flex">
                      Abrir lead ↗
                    </span>
                  )}
                </>
              );
              // Lead excluído: linha estática, não-clicável (histórico auditável).
              return deleted ? (
                <div
                  key={r.id}
                  className="flex w-full items-center gap-3 border-b border-border/40 px-6 py-3 text-left opacity-70"
                >
                  {rowInner}
                </div>
              ) : (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onOpenLead(r.lead_id!)}
                  className="group flex w-full items-center gap-3 border-b border-border/40 px-6 py-3 text-left transition-colors hover:bg-primary/5"
                >
                  {rowInner}
                </button>
              );
            })
          )}
        </div>

        {/* Rodapé: contagem + paginação client-side */}
        <div className="flex items-center justify-between border-t border-border bg-card px-6 py-3 text-xs text-muted-foreground tabular-nums">
          <span>
            {filtered.length} contato{filtered.length === 1 ? "" : "s"}
            {query.trim() && ` de ${counts[tab]}`}
          </span>
          {pageCount > 1 && (
            <span className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
                aria-label="Página anterior"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span>
                {safePage + 1}/{pageCount}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
                aria-label="Próxima página"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </span>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
