import { Fragment } from "react";
import { format, isToday, isTomorrow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowRightLeft, Loader2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { QUALIFICATION_TIER_CONFIG } from "@/modules/leads";
import type { CustomPipelineStage } from "@/contracts/pipe";
import type { StageData } from "@/modules/pipelines/hooks/model/usePaginatedPipeline";
import type { FunilEntry } from "./FunilKanban";
import { projectSaleValue } from "./funil-card-value";

/**
 * Visão Lista do funil (desktop) — tabela agrupada por etapa, como no mockup.
 *
 * Os MESMOS cards que o quadro carrega (`usePaginatedFunil`), lidos em linha:
 * negócio, etapa, qualificação, tempo na etapa, pré-venda, venda, a reunião
 * marcada (a "próxima ação" que o produto conhece) e o valor. "Mover" foi
 * para o ⋯ da linha. Cada grupo pagina como a coluna do quadro.
 *
 * O celular continua com a lista por etapa (`PipelineListView`).
 */

/** Entrada com os carimbos que `get_pipeline_page` devolve. */
type ListEntry = FunilEntry & {
  entered_at?: string | null;
  stage_changed_at?: string | null;
};

type Tier = keyof typeof QUALIFICATION_TIER_CONFIG;

interface FunilListTableProps {
  stages: CustomPipelineStage[];
  stageData: Record<string, StageData>;
  onOpen: (entry: FunilEntry) => void;
  onMove: (entryId: string, stageKey: string) => void;
  isLoading?: boolean;
}

/** Dias na etapa atual — `COALESCE(stage_changed_at, entered_at, created_at)`, como o filtro "Parado há". */
function daysInStage(entry: ListEntry): number | null {
  const raw = entry.stage_changed_at ?? entry.entered_at ?? entry.created_at;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function meetingLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hora = format(d, "HH:mm");
  if (isToday(d)) return `hoje ${hora}`;
  if (isTomorrow(d)) return `amanhã ${hora}`;
  return format(d, "dd/MM HH:mm", { locale: ptBR });
}

function initials(text: string): string {
  return (
    text
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

const PILL = "inline-flex h-[22px] max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11px] font-bold";

export function FunilListTable({ stages, stageData, onOpen, onMove, isLoading }: FunilListTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-2 rounded-card border border-card-border bg-card p-4 shadow-relevo">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-card-border bg-card shadow-relevo" data-testid="funil-list-table">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Negócio</TableHead>
            <TableHead>Etapa</TableHead>
            <TableHead>Qualificação</TableHead>
            <TableHead>Tempo na etapa</TableHead>
            <TableHead>Pré-venda</TableHead>
            <TableHead>Venda</TableHead>
            <TableHead>Reunião</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead className="w-10 pr-3" aria-label="Ações" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {stages.map((stage) => {
            const slot = stageData[stage.stage_key];
            const items = (slot?.items ?? []) as ListEntry[];
            const total = slot?.totalCount ?? items.length;
            return (
              <Fragment key={stage.stage_key}>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={9} className="py-2 pl-4 text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden className="size-2 rounded-[3px]" style={{ background: stage.color || "#64748b" }} />
                      {stage.name} · <span className="tabular-nums">{total.toLocaleString("pt-BR")}</span>
                    </span>
                  </TableCell>
                </TableRow>
                {items.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={9} className="py-3 pl-4 text-xs text-muted-foreground/70">
                      Nenhum negócio nesta etapa
                    </TableCell>
                  </TableRow>
                )}
                {items.map((entry) => {
                  const lead = entry.lead;
                  const nome = lead?.name || "Sem nome";
                  const titulo = lead?.company || nome;
                  const tier = (lead?.qualification_tier ?? null) as Tier | null;
                  const tierCfg = tier ? QUALIFICATION_TIER_CONFIG[tier] : null;
                  const dias = daysInStage(entry);
                  const pre = lead?.pre_sale_responsible ?? null;
                  const venda = lead?.sale_responsible ?? null;
                  const reuniao = meetingLabel(
                    entry.meeting_date ?? (entry.metadata?.meeting_date as string | undefined) ?? null,
                  );
                  const valor = projectSaleValue(entry);
                  return (
                    <TableRow
                      key={entry.id}
                      tabIndex={0}
                      onClick={() => onOpen(entry)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onOpen(entry);
                      }}
                      className="cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none"
                    >
                      <TableCell className="py-2.5 pl-4">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="grid size-[30px] shrink-0 place-items-center rounded-[10px] bg-muted text-[11px] font-bold text-foreground/70">
                            {initials(titulo)}
                          </span>
                          <div className="min-w-0 leading-tight">
                            <p className="max-w-[240px] truncate text-[13px] font-bold">{titulo}</p>
                            {lead?.company && <p className="max-w-[240px] truncate text-[11px] text-muted-foreground">{nome}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={cn(PILL, "bg-muted text-foreground/80")}>
                          <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: stage.color || "#64748b" }} />
                          <span className="truncate">{stage.name}</span>
                        </span>
                      </TableCell>
                      <TableCell>
                        {tierCfg ? (
                          <span className={cn(PILL, tierCfg.bgClass, tierCfg.colorClass)}>
                            <tierCfg.icon className="size-3 shrink-0" aria-hidden />
                            {tierCfg.label}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {dias != null ? (
                          <span
                            className={cn(
                              "text-[13px] font-semibold tabular-nums",
                              dias > 7 ? "text-destructive" : "text-foreground/80",
                            )}
                          >
                            {dias}d
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {pre?.name ? (
                          <div title={pre.name} className="w-fit">
                            <UserAvatar name={pre.name} avatarUrl={pre.avatar_url ?? null} size="xs" />
                          </div>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {venda?.name ? (
                          <div title={venda.name} className="w-fit">
                            <UserAvatar name={venda.name} avatarUrl={venda.avatar_url ?? null} size="xs" />
                          </div>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-[13px] text-foreground/80">
                        {reuniao ?? <span className="text-muted-foreground/60">—</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-[13px] font-bold tabular-nums">
                        {valor != null && valor > 0 ? formatBRL(valor) : <span className="font-normal text-muted-foreground/60">—</span>}
                      </TableCell>
                      <TableCell className="pr-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Ações de ${nome}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
                              <ArrowRightLeft className="size-3.5" aria-hidden />
                              Mover para
                            </DropdownMenuLabel>
                            {stages
                              .filter((s) => s.stage_key !== stage.stage_key)
                              .map((s) => (
                                <DropdownMenuItem key={s.stage_key} onClick={() => onMove(entry.id, s.stage_key)}>
                                  <span aria-hidden className="mr-2 size-2 rounded-full" style={{ background: s.color || "#64748b" }} />
                                  {s.name}
                                </DropdownMenuItem>
                              ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {slot?.hasMore && slot.fetchMore && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={9} className="py-2 pl-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-full text-xs text-muted-foreground"
                        onClick={() => slot.fetchMore?.()}
                        disabled={slot.isFetchingMore}
                      >
                        {slot.isFetchingMore && <Loader2 className="animate-spin" />}
                        Carregar mais ({(total - items.length).toLocaleString("pt-BR")} restantes)
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
