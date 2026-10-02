/**
 * InboxFilterBar — o trilho de filtros do inbox (V5, "mais perto do mockup").
 *
 * Antes as dimensões moravam atrás de um "+ Filtro": quem não abria o menu não
 * sabia que dava para recortar por funil, etapa ou etiqueta. Agora o trilho
 * expõe TUDO numa linha só, rolável na horizontal:
 *
 *   atalhos (liga/desliga) · dimensões com ▾ (abrem o editor de sempre)
 *
 * É o MESMO `InboxFilterState` de antes — nenhuma dimensão nova, nenhuma
 * semântica nova (AND entre dimensões, OR dentro; engine em
 * `lib/inboxFilter.ts`). "Não lidas" saiu daqui para o alternador
 * Todas · Não lidas · Grupos da lista, que é onde o mockup a coloca.
 *
 * `InboxActiveFiltersButton` é o ícone "Filtros" do cabeçalho: com o trilho
 * rolando, um filtro ligado pode estar fora da vista — o botão conta e lista
 * o que está valendo, e limpa tudo de uma vez.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  X,
  SlidersHorizontal,
  Filter as FunnelIcon,
  GitBranch,
  User,
  Tag as TagIcon,
  Star,
  MessageCircle,
  Bot,
  Link2,
  Headset,
  UserCheck,
  UserX,
  Unlink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  type InboxFilterState,
  type SourceFilter,
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

/** Dimensões com editor (abrem um popover). */
type DimKey = "funnel" | "stage" | "vendor" | "tag" | "tier" | "source";

const DIMS: { key: DimKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "funnel", label: "Funil", icon: FunnelIcon },
  { key: "stage", label: "Etapa", icon: GitBranch },
  { key: "tag", label: "Tag", icon: TagIcon },
  { key: "vendor", label: "Vendedor", icon: User },
  { key: "source", label: "Fonte", icon: Bot },
  { key: "tier", label: "Qualificação", icon: Star },
];

// ─── Props ───────────────────────────────────────────────────────────────────

export interface InboxFilterBarProps {
  filter: InboxFilterState;
  patch: (partial: Partial<InboxFilterState>) => void;
  toggleMulti: (key: "funnels" | "stages" | "tags" | "tiers", value: string) => void;
  clearFilter: () => void;
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
}: { dim: DimKey } & Omit<InboxFilterBarProps, "waitingHumanCount" | "clearFilter">) {
  switch (dim) {
    case "funnel":
      return (
        <PopoverList>
          {funnelOptions.length === 0 && <p className="px-2.5 py-2 text-xs text-muted-foreground">Nenhum funil</p>}
          {funnelOptions.filter((f) => f.isVisible !== false || filter.funnels.includes(f.pipelineId)).map((f) => (
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
        : funnelOptions.filter((f) => f.isVisible !== false || f.stages.some((stage) => filter.stages.includes(stage.stageKey)));
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
    default:
      return null;
  }
}

// ─── Resumo, estado e reset por dimensão ─────────────────────────────────────

type Resumivel = Pick<InboxFilterBarProps, "filter" | "funnelOptions" | "vendorOptions" | "allTags">;

function chipSummary(dim: DimKey, p: Resumivel): string {
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
      return vendorOptions.find((v) => v.id === filter.vendor)?.name ?? "—";
    case "tag":
      return multi(filter.tags, (id) => allTags.find((t) => t.id === id)?.name ?? id);
    case "tier":
      return multi(filter.tiers, (id) => TIERS.find((t) => t.id === id)?.label ?? id);
    case "source":
      return filter.source === "ia" ? "IA" : "Humano";
    default:
      return "";
  }
}

/**
 * Uma dimensão está ativa quando tem valor. O vendedor só conta como dimensão
 * quando é um vendedor ESPECÍFICO — "minhas" e "não atribuídas" têm atalho
 * próprio no trilho, e acender os dois chips para o mesmo valor diria duas
 * vezes a mesma coisa.
 */
function isDimActive(dim: DimKey, f: InboxFilterState): boolean {
  switch (dim) {
    case "funnel": return f.funnels.length > 0;
    case "stage": return f.stages.length > 0;
    case "vendor": return f.vendor !== "all" && f.vendor !== "mine" && f.vendor !== "unassigned";
    case "tag": return f.tags.length > 0;
    case "tier": return f.tiers.length > 0;
    case "source": return f.source !== null;
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
    case "source": patch({ source: null }); break;
  }
}

// ─── Chips ───────────────────────────────────────────────────────────────────

/** Chip do trilho sobre a tinta. Ligado = ouro; desligado = translúcido. */
const CHIP =
  "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const CHIP_OFF = "bg-foreground/[.07] text-foreground/80 hover:bg-foreground/[.12] hover:text-foreground";
const CHIP_ON = "bg-primary text-primary-foreground shadow-brilho-ouro";

function ToggleChip({
  label, active, onClick, icon: Icon, count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(CHIP, active ? CHIP_ON : CHIP_OFF)}
    >
      <Icon className="h-3.5 w-3.5 opacity-80" aria-hidden />
      {label}
      {count != null && count > 0 && (
        <span
          className={cn(
            "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-extrabold tabular-nums",
            active ? "bg-primary-foreground text-primary" : "bg-warning text-warning-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function DimensionChip({ dim, props }: { dim: (typeof DIMS)[number]; props: InboxFilterBarProps }) {
  const active = isDimActive(dim.key, props.filter);
  const Icon = dim.icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center overflow-hidden rounded-full", active ? CHIP_ON : CHIP_OFF)}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(CHIP, "bg-transparent hover:bg-transparent", active ? "pr-1.5" : "")}
            aria-label={active ? `${dim.label}: ${chipSummary(dim.key, props)}` : `Filtrar por ${dim.label.toLowerCase()}`}
          >
            {active ? (
              <>
                <span className="opacity-75">{dim.label}:</span>
                <span className="max-w-[120px] truncate">{chipSummary(dim.key, props)}</span>
              </>
            ) : (
              dim.label
            )}
            <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-0">
          <p className="flex items-center gap-2 px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Icon className="h-3 w-3" /> {dim.label}
          </p>
          <DimensionEditor dim={dim.key} {...props} />
        </PopoverContent>
      </Popover>
      {active && (
        <button
          type="button"
          onClick={() => resetDim(dim.key, props.patch)}
          aria-label={`Remover filtro ${dim.label}`}
          className="flex h-8 items-center border-l border-primary-foreground/15 pl-1.5 pr-2.5 opacity-70 transition-opacity hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

// ─── Trilho rolável ──────────────────────────────────────────────────────────

/**
 * Esmaece só a borda que esconde chip. Sem isso o corte parece defeito, não
 * rolagem — o mesmo raciocínio da pílula de navegação (`TabsList variant="pill"`).
 * A roda vertical do mouse rola o trilho na horizontal: ninguém tem roda lateral.
 */
function useTrilho() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [fade, setFade] = useState<{ start: boolean; end: boolean }>({ start: false, end: false });

  const medir = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setFade({ start: el.scrollLeft > 2, end: el.scrollLeft < max - 2 });
  }, []);

  useEffect(() => {
    medir();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [medir]);

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    el.scrollLeft += e.deltaY;
  }, []);

  return { ref, fade, medir, onWheel };
}

// ─── Componente principal ────────────────────────────────────────────────────

export function InboxFilterBar(props: InboxFilterBarProps) {
  const { filter, patch, clearFilter, waitingHumanCount, currentTeamMemberId, canSeeUnassigned } = props;
  const { ref, fade, medir, onWheel } = useTrilho();
  // "Não lidas" mora no alternador da lista; aqui só contam as do trilho.
  const ativosNoTrilho = countActiveFilters({ ...filter, unread: false });

  // Conteúdo muda (filtro liga/desliga) → a largura muda → remede o esmaecido.
  useEffect(() => { medir(); }, [filter, medir]);

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Filtros do inbox"
      onScroll={medir}
      onWheel={onWheel}
      data-fade-start={fade.start}
      data-fade-end={fade.end}
      className={cn(
        "-mx-3 flex items-center gap-1.5 overflow-x-auto px-3 scrollbar-hide",
        "data-[fade-end=true]:[mask-image:linear-gradient(to_right,black_82%,transparent)]",
        "data-[fade-start=true]:[mask-image:linear-gradient(to_left,black_82%,transparent)]",
        "data-[fade-start=true]:data-[fade-end=true]:[mask-image:linear-gradient(to_right,transparent,black_18%,black_82%,transparent)]",
      )}
    >
      {currentTeamMemberId && (
        <ToggleChip
          label="Minhas conversas"
          icon={UserCheck}
          active={filter.vendor === "mine"}
          onClick={() => patch({ vendor: filter.vendor === "mine" ? "all" : "mine" })}
        />
      )}
      {canSeeUnassigned && (
        <ToggleChip
          label="Não atribuídas"
          icon={UserX}
          active={filter.vendor === "unassigned"}
          onClick={() => patch({ vendor: filter.vendor === "unassigned" ? "all" : "unassigned" })}
        />
      )}
      <ToggleChip
        label="Aguardando resposta"
        icon={MessageCircle}
        active={filter.waiting}
        onClick={() => patch({ waiting: !filter.waiting })}
      />
      <ToggleChip
        label="Pediu atendente"
        icon={Headset}
        active={filter.needsHuman}
        count={waitingHumanCount}
        onClick={() => patch({ needsHuman: !filter.needsHuman })}
      />
      <ToggleChip
        label="Com lead"
        icon={Link2}
        active={filter.lead === "com"}
        onClick={() => patch({ lead: filter.lead === "com" ? null : "com" })}
      />
      <ToggleChip
        label="Sem lead"
        icon={Unlink}
        active={filter.lead === "sem"}
        onClick={() => patch({ lead: filter.lead === "sem" ? null : "sem" })}
      />

      <span className="mx-0.5 h-4 w-px shrink-0 bg-foreground/15" aria-hidden />

      {DIMS.map((d) => (
        <DimensionChip key={d.key} dim={d} props={props} />
      ))}

      {ativosNoTrilho >= 2 && (
        <button
          type="button"
          onClick={() => clearFilter()}
          className="shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          Limpar tudo
        </button>
      )}
    </div>
  );
}

// ─── Botão "Filtros" do cabeçalho ────────────────────────────────────────────

/** Um item ativo do filtro, já resumido, com o reset dele. */
function filtrosAtivos(p: Resumivel & { patch: InboxFilterBarProps["patch"] }) {
  const { filter, patch } = p;
  const itens: { key: string; rotulo: string; valor?: string; remover: () => void }[] = [];
  if (filter.unread) itens.push({ key: "unread", rotulo: "Não lidas", remover: () => patch({ unread: false }) });
  if (filter.vendor === "mine") itens.push({ key: "mine", rotulo: "Minhas conversas", remover: () => patch({ vendor: "all" }) });
  if (filter.vendor === "unassigned") itens.push({ key: "unassigned", rotulo: "Não atribuídas", remover: () => patch({ vendor: "all" }) });
  if (filter.waiting) itens.push({ key: "waiting", rotulo: "Aguardando resposta", remover: () => patch({ waiting: false }) });
  if (filter.needsHuman) itens.push({ key: "needsHuman", rotulo: "Pediu atendente", remover: () => patch({ needsHuman: false }) });
  if (filter.lead) itens.push({ key: "lead", rotulo: filter.lead === "com" ? "Com lead" : "Sem lead", remover: () => patch({ lead: null }) });
  for (const d of DIMS) {
    if (isDimActive(d.key, filter)) {
      itens.push({ key: d.key, rotulo: d.label, valor: chipSummary(d.key, p), remover: () => resetDim(d.key, patch) });
    }
  }
  return itens;
}

export function InboxActiveFiltersButton(
  props: Resumivel & Pick<InboxFilterBarProps, "patch" | "clearFilter">,
) {
  const total = countActiveFilters(props.filter);
  const itens = filtrosAtivos(props);
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={total > 0 ? `Filtros ativos: ${total}` : "Filtros"}
              className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-foreground/[.07] text-foreground/85 transition-colors hover:bg-foreground/[.12] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              {total > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-extrabold tabular-nums text-primary-foreground">
                  {total}
                </span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Filtros</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-64 p-1">
        <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Filtros ativos
        </p>
        {itens.length === 0 ? (
          <p className="px-2.5 pb-2.5 pt-1 text-[12.5px] leading-snug text-muted-foreground">
            Nenhum filtro ligado. Os atalhos ficam logo abaixo da busca.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-0.5">
              {itens.map((i) => (
                <div key={i.key} className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]">
                  <span className="text-muted-foreground">{i.rotulo}{i.valor ? ":" : ""}</span>
                  {i.valor && <span className="min-w-0 flex-1 truncate font-semibold">{i.valor}</span>}
                  {!i.valor && <span className="flex-1" />}
                  <button
                    type="button"
                    onClick={i.remover}
                    aria-label={`Remover filtro ${i.rotulo}`}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-1 border-t border-border/60 p-1">
              <button
                type="button"
                onClick={() => props.clearFilter()}
                className="w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Limpar todos os filtros
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
