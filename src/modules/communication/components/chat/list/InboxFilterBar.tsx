/**
 * InboxFilterBar — barra de filtro do inbox no modelo Linear.
 *
 * Nasce vazia: só a busca (fora daqui), o toggle rápido "Não lidas" e o botão
 * "+ Filtro". Cada dimensão escolhida vira um chip editável (clica pra ajustar,
 * ✕ pra remover). Semântica: AND entre dimensões, OR dentro (engine em
 * `lib/inboxFilter.ts`). Dark-first, ícones lucide, sem emoji.
 */
import { useMemo, useState } from "react";
import {
  Plus,
  Check,
  ChevronDown,
  X,
  MailOpen,
  Filter as FunnelIcon,
  GitBranch,
  User,
  Tag as TagIcon,
  Star,
  MessageCircle,
  Bot,
  Link2,
  Headset,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  type InboxFilterState,
  type SourceFilter,
  type LeadPresenceFilter,
  countActiveFilters,
} from "@/modules/communication/lib/inboxFilter";
import type { FunnelOption } from "@/modules/communication/hooks/chat/useInboxFunnelOptions";

// ─── Config estática ─────────────────────────────────────────────────────────

const TIERS: { id: string; label: string; color: string }[] = [
  { id: "diamante", label: "Diamante", color: "#38bdf8" },
  { id: "ouro", label: "Ouro", color: "#fbbf24" },
  { id: "prata", label: "Prata", color: "#cbd5e1" },
  { id: "bronze", label: "Bronze", color: "#d98a5b" },
  { id: "desqualificado", label: "Desqualificado", color: "#94a3b8" },
];

type DimKey =
  | "funnel" | "stage" | "vendor" | "tag" | "tier"
  | "waiting" | "needsHuman" | "source" | "lead" | "showGroups";

const DIM_META: { key: DimKey; label: string; icon: React.ComponentType<{ className?: string }>; toggle?: boolean }[] = [
  { key: "funnel", label: "Funil", icon: FunnelIcon },
  { key: "stage", label: "Etapa", icon: GitBranch },
  { key: "vendor", label: "Vendedor", icon: User },
  { key: "tag", label: "Tag", icon: TagIcon },
  { key: "tier", label: "Qualificação", icon: Star },
  { key: "waiting", label: "Aguardando resposta", icon: MessageCircle, toggle: true },
  { key: "needsHuman", label: "Pediu atendente", icon: Headset, toggle: true },
  { key: "source", label: "Fonte", icon: Bot },
  { key: "lead", label: "Com / sem lead", icon: Link2 },
  // O desktop escondia TODA conversa de grupo desde 6356ef92 (23/07/2026),
  // sem toggle e sem aviso. Volta como dimensão opt-in.
  { key: "showGroups", label: "Grupos", icon: Users, toggle: true },
];

// ─── Props ───────────────────────────────────────────────────────────────────

interface InboxFilterBarProps {
  filter: InboxFilterState;
  patch: (partial: Partial<InboxFilterState>) => void;
  toggleMulti: (key: "funnels" | "stages" | "tags" | "tiers", value: string) => void;
  clearFilter: () => void;
  unreadCount: number;
  waitingHumanCount: number;
  funnelOptions: FunnelOption[];
  vendorOptions: { id: string; name: string }[];
  currentTeamMemberId: string | null;
  canSeeUnassigned: boolean;
  allTags: { id: string; name: string; color: string }[];
}

// ─── Primitivos de opção ─────────────────────────────────────────────────────

function OptionRow({
  label, selected, onClick, swatch,
}: { label: string; selected: boolean; onClick: () => void; swatch?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-muted"
    >
      {swatch && <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: swatch }} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        className={cn(
          "grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border transition-colors",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
        )}
      >
        {selected && <Check className="h-3 w-3" />}
      </span>
    </button>
  );
}

function PopoverList({ children }: { children: React.ReactNode }) {
  return (
    <ScrollArea className="max-h-[280px]">
      <div className="flex flex-col gap-0.5 p-1">{children}</div>
    </ScrollArea>
  );
}

// ─── Editores por dimensão ───────────────────────────────────────────────────

function DimensionEditor({
  dim, filter, patch, toggleMulti, funnelOptions, vendorOptions, currentTeamMemberId, canSeeUnassigned, allTags,
}: { dim: DimKey } & Omit<InboxFilterBarProps, "unreadCount" | "waitingHumanCount" | "clearFilter">) {
  switch (dim) {
    case "funnel":
      return (
        <PopoverList>
          {funnelOptions.length === 0 && <p className="px-2.5 py-2 text-xs text-muted-foreground">Nenhum funil</p>}
          {funnelOptions.map((f) => (
            <OptionRow key={f.pipelineId} label={f.label}
              selected={filter.funnels.includes(f.pipelineId)}
              onClick={() => toggleMulti("funnels", f.pipelineId)} />
          ))}
        </PopoverList>
      );
    case "stage": {
      // Etapas dependem do funil escolhido; sem funil, agrupa por funil.
      const selectedFunnels = filter.funnels.length
        ? funnelOptions.filter((f) => filter.funnels.includes(f.pipelineId))
        : funnelOptions;
      const grouped = filter.funnels.length === 0 && funnelOptions.length > 1;
      return (
        <PopoverList>
          {selectedFunnels.every((f) => f.stages.length === 0) && (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">Nenhuma etapa</p>
          )}
          {selectedFunnels.map((f) => (
            <div key={f.pipelineId} className="flex flex-col gap-0.5">
              {grouped && f.stages.length > 0 && (
                <p className="px-2.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {f.label}
                </p>
              )}
              {f.stages.map((s) => (
                <OptionRow key={`${f.pipelineId}:${s.stageKey}`} label={s.label}
                  selected={filter.stages.includes(s.stageKey)}
                  onClick={() => toggleMulti("stages", s.stageKey)} />
              ))}
            </div>
          ))}
        </PopoverList>
      );
    }
    case "vendor":
      return (
        <PopoverList>
          {currentTeamMemberId && (
            <OptionRow label="Minhas conversas" selected={filter.vendor === "mine"}
              onClick={() => patch({ vendor: filter.vendor === "mine" ? "all" : "mine" })} />
          )}
          {canSeeUnassigned && (
            <OptionRow label="Não atribuídas" selected={filter.vendor === "unassigned"}
              onClick={() => patch({ vendor: filter.vendor === "unassigned" ? "all" : "unassigned" })} />
          )}
          {vendorOptions.map((v) => (
            <OptionRow key={v.id} label={v.name} selected={filter.vendor === v.id}
              onClick={() => patch({ vendor: filter.vendor === v.id ? "all" : v.id })} />
          ))}
        </PopoverList>
      );
    case "tag":
      return (
        <PopoverList>
          {allTags.length === 0 && <p className="px-2.5 py-2 text-xs text-muted-foreground">Nenhuma tag</p>}
          {allTags.map((t) => (
            <OptionRow key={t.id} label={t.name} swatch={t.color}
              selected={filter.tags.includes(t.id)} onClick={() => toggleMulti("tags", t.id)} />
          ))}
        </PopoverList>
      );
    case "tier":
      return (
        <PopoverList>
          {TIERS.map((t) => (
            <OptionRow key={t.id} label={t.label} swatch={t.color}
              selected={filter.tiers.includes(t.id)} onClick={() => toggleMulti("tiers", t.id)} />
          ))}
        </PopoverList>
      );
    case "source":
      return (
        <PopoverList>
          {(["ia", "humano"] as SourceFilter[]).map((s) => (
            <OptionRow key={s} label={s === "ia" ? "IA (copilot / workflow)" : "Humano (manual)"}
              selected={filter.source === s}
              onClick={() => patch({ source: filter.source === s ? null : s })} />
          ))}
        </PopoverList>
      );
    case "lead":
      return (
        <PopoverList>
          {(["com", "sem"] as LeadPresenceFilter[]).map((l) => (
            <OptionRow key={l} label={l === "com" ? "Com lead" : "Sem lead"}
              selected={filter.lead === l}
              onClick={() => patch({ lead: filter.lead === l ? null : l })} />
          ))}
        </PopoverList>
      );
    default:
      return null;
  }
}

// ─── Resumo do valor de um chip ──────────────────────────────────────────────

function chipSummary(dim: DimKey, p: InboxFilterBarProps): string {
  const { filter, funnelOptions, vendorOptions, allTags } = p;
  const multi = (ids: string[], resolve: (id: string) => string) =>
    ids.length === 1 ? resolve(ids[0]) : `${resolve(ids[0])} +${ids.length - 1}`;
  switch (dim) {
    case "funnel":
      return multi(filter.funnels, (id) => funnelOptions.find((f) => f.pipelineId === id)?.label ?? id);
    case "stage": {
      const allStages = funnelOptions.flatMap((f) => f.stages);
      return multi(filter.stages, (k) => allStages.find((s) => s.stageKey === k)?.label ?? k);
    }
    case "vendor":
      if (filter.vendor === "mine") return "Minhas";
      if (filter.vendor === "unassigned") return "Não atribuídas";
      return vendorOptions.find((v) => v.id === filter.vendor)?.name ?? "—";
    case "tag":
      return multi(filter.tags, (id) => allTags.find((t) => t.id === id)?.name ?? id);
    case "tier":
      return multi(filter.tiers, (id) => TIERS.find((t) => t.id === id)?.label ?? id);
    case "source":
      return filter.source === "ia" ? "IA" : "Humano";
    case "lead":
      return filter.lead === "com" ? "Com lead" : "Sem lead";
    default:
      return "";
  }
}

/** Uma dimensão está ativa (rende chip) quando tem valor selecionado. */
function isDimActive(dim: DimKey, f: InboxFilterState): boolean {
  switch (dim) {
    case "funnel": return f.funnels.length > 0;
    case "stage": return f.stages.length > 0;
    case "vendor": return f.vendor !== "all";
    case "tag": return f.tags.length > 0;
    case "tier": return f.tiers.length > 0;
    case "waiting": return f.waiting;
    case "needsHuman": return f.needsHuman;
    case "source": return f.source !== null;
    case "lead": return f.lead !== null;
    case "showGroups": return f.showGroups;
    default: return false;
  }
}

function resetDim(dim: DimKey, patch: InboxFilterBarProps["patch"]) {
  switch (dim) {
    case "funnel": patch({ funnels: [], stages: [] }); break; // limpar funil limpa etapa dependente
    case "stage": patch({ stages: [] }); break;
    case "vendor": patch({ vendor: "all" }); break;
    case "tag": patch({ tags: [] }); break;
    case "tier": patch({ tiers: [] }); break;
    case "waiting": patch({ waiting: false }); break;
    case "needsHuman": patch({ needsHuman: false }); break;
    case "source": patch({ source: null }); break;
    case "lead": patch({ lead: null }); break;
    case "showGroups": patch({ showGroups: false }); break;
  }
}

// ─── Componente principal ────────────────────────────────────────────────────

export function InboxFilterBar(props: InboxFilterBarProps) {
  const { filter, patch, clearFilter, unreadCount, waitingHumanCount } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState<DimKey | null>(null);
  // Dimensões "mostradas" mas ainda sem valor — precisam existir como chip antes
  // do usuário escolher um valor. Sem isso, escolher "Funil" no menu não abre nada
  // (o chip só nasceria depois de ter valor, e o valor só se define pelo chip).
  const [shown, setShown] = useState<Set<DimKey>>(new Set());

  const activeDims = useMemo(
    () => DIM_META.filter((d) => isDimActive(d.key, filter) || shown.has(d.key)),
    [filter, shown],
  );
  const activeCount = countActiveFilters(filter);

  const dropShown = (key: DimKey) =>
    setShown((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

  const removeDim = (key: DimKey) => {
    resetDim(key, patch);
    dropShown(key);
  };

  const handlePickDimension = (dim: (typeof DIM_META)[number]) => {
    setMenuOpen(false);
    if (dim.toggle) {
      patch({ [dim.key]: true } as Partial<InboxFilterState>);
    } else {
      setShown((prev) => new Set(prev).add(dim.key)); // cria o chip
      setAutoOpen(dim.key); // e abre o editor dele
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-2">
      {/* Linha: toggle rápido + adicionar filtro */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => patch({ unread: !filter.unread })}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
            filter.unread
              ? "border-transparent bg-primary/15 text-primary"
              : "border-border bg-background text-muted-foreground hover:text-foreground",
          )}
        >
          <MailOpen className="h-3.5 w-3.5" />
          Não lidas
          {unreadCount > 0 && (
            <span
              className={cn(
                "ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
                filter.unread ? "bg-primary text-primary-foreground" : "bg-muted-foreground/15 text-muted-foreground",
              )}
            >
              {unreadCount}
            </span>
          )}
        </button>

        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Filtro
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1">
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Adicionar filtro
            </p>
            <div className="flex flex-col gap-0.5">
              {DIM_META.map((d) => {
                const Icon = d.icon;
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => handlePickDimension(d)}
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-muted"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {d.label}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Chips ativos */}
      {activeDims.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeDims.map((d) => {
            const Icon = d.icon;
            if (d.toggle) {
              return (
                <span
                  key={d.key}
                  className="inline-flex items-center overflow-hidden rounded-lg border border-primary/25 bg-primary/10 text-xs font-medium"
                >
                  <span className="flex items-center gap-1.5 py-1.5 pl-2.5 pr-1.5 text-primary">
                    <Icon className="h-3 w-3" />
                    {d.label}
                    {d.key === "needsHuman" && waitingHumanCount > 0 && (
                      <span className="ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white tabular-nums">
                        {waitingHumanCount}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeDim(d.key)}
                    aria-label={`Remover filtro ${d.label}`}
                    className="flex h-full items-center border-l border-primary/15 px-1.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            }
            return (
              <span
                key={d.key}
                className="inline-flex items-center overflow-hidden rounded-lg border border-primary/25 bg-primary/10 text-xs font-medium"
              >
                <Popover
                  defaultOpen={autoOpen === d.key}
                  onOpenChange={(o) => {
                    if (o) return;
                    setAutoOpen(null);
                    // Fechou sem escolher valor → some o chip vazio.
                    if (!isDimActive(d.key, filter)) dropShown(d.key);
                  }}
                >
                  <PopoverTrigger asChild>
                    <button type="button" className="flex items-center gap-1.5 py-1.5 pl-2.5 pr-1.5 text-foreground">
                      <span className="text-muted-foreground">{d.label}:</span>
                      <span className="max-w-[120px] truncate font-semibold text-primary">{chipSummary(d.key, props)}</span>
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-56 p-0">
                    <p className="flex items-center gap-2 px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <Icon className="h-3 w-3" /> {d.label}
                    </p>
                    <DimensionEditor dim={d.key} {...props} />
                  </PopoverContent>
                </Popover>
                <button
                  type="button"
                  onClick={() => removeDim(d.key)}
                  aria-label={`Remover filtro ${d.label}`}
                  className="flex h-full items-center border-l border-primary/15 px-1.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
          {activeCount >= 2 && (
            <button
              type="button"
              onClick={() => { clearFilter(); setShown(new Set()); }}
              className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Limpar tudo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
