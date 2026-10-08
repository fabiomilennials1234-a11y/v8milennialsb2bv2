import { memo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Timer } from "lucide-react";
import { useOrganizationSettings } from "@/modules/identity";
import { FilterChip } from "@/shared/components/FilterChip";
import { cn } from "@/lib/utils";
import { useFunnelOptions } from "../../lib/funnel-nav";

/**
 * Faixa de funis — um chip por funil, o aberto em tinta (mockup V5).
 *
 * Substitui o seletor que morava no título: com o título fixo "Funis", trocar
 * de funil vira um clique à vista em vez de abrir uma lista. O funil padrão da
 * org (`organizations.default_pipeline_id`) leva o selo PADRÃO; funil com prazo
 * leva o relógio. Encerrado não entra (mora no hub, em "Todos os funis") —
 * a não ser que seja o aberto.
 *
 * Org com muitos funis: a faixa rola na horizontal com a mesma affordance da
 * pílula (a borda que esconde chip esmaece) e traz o ativo para dentro.
 */
interface FunnelChipStripProps {
  /** Chave do funil aberto: `pipeline:<id>`. */
  currentKey: string;
  className?: string;
}

export const FunnelChipStrip = memo(function FunnelChipStrip({ currentKey, className }: FunnelChipStripProps) {
  const navigate = useNavigate();
  const { options } = useFunnelOptions();
  const { settings } = useOrganizationSettings();
  const defaultId = settings?.default_pipeline_id ?? null;
  const ref = useRef<HTMLDivElement>(null);

  const items = options.filter((o) => !o.ended || o.key === currentKey);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      el.dataset.fadeStart = String(el.scrollLeft > 1);
      el.dataset.fadeEnd = String(el.scrollLeft < max - 1);
    };
    const active = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (active) {
      const left = active.offsetLeft;
      const right = left + active.offsetWidth;
      if (left < el.scrollLeft) el.scrollLeft = left - 24;
      else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth + 24;
    }
    update();
    el.addEventListener("scroll", update, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resize?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      resize?.disconnect();
    };
  }, [items.length, currentKey]);

  if (items.length === 0) return null;

  return (
    <nav aria-label="Funis" className={cn("min-w-0", className)}>
      <div
        ref={ref}
        data-testid="funnel-chip-strip"
        className={cn(
          // `py-1 -my-1`: a sombra do chip não é cortada pela rolagem.
          // No celular sangra até a borda (`-mx-4 px-4`), como as outras faixas.
          "-my-1 flex min-w-0 items-center gap-2 overflow-x-auto py-1 scrollbar-hide max-sm:-mx-4 max-sm:px-4",
          "data-[fade-end=true]:[mask-image:linear-gradient(to_right,black_calc(100%_-_36px),transparent)]",
          "data-[fade-start=true]:[mask-image:linear-gradient(to_left,black_calc(100%_-_36px),transparent)]",
          "data-[fade-start=true]:data-[fade-end=true]:[mask-image:linear-gradient(to_right,transparent,black_36px,black_calc(100%_-_36px),transparent)]",
        )}
      >
        {items.map((option) => {
          const active = option.key === currentKey;
          const isDefault = !!defaultId && option.pipeline?.id === defaultId;
          return (
            <FilterChip
              key={option.key}
              active={active}
              swatch={option.color}
              aria-current={active ? "page" : undefined}
              data-testid={`funnel-chip-${option.key}`}
              onClick={() => {
                if (!active) navigate(option.path);
              }}
              className={cn(option.ended && "opacity-60")}
            >
              <span className="max-w-[220px] truncate">{option.label}</span>
              {isDefault && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-[9.5px] font-extrabold uppercase tracking-[.04em]",
                    active ? "bg-primary text-primary-foreground" : "bg-primary-soft text-primary-soft-foreground",
                  )}
                >
                  Padrão
                </span>
              )}
              {option.group === "prazo" && (
                <Timer
                  aria-label="Funil com prazo"
                  className={cn("size-3.5 shrink-0", active ? "text-tinta-muted dark:text-background/60" : "text-muted-foreground")}
                />
              )}
            </FilterChip>
          );
        })}
      </div>
    </nav>
  );
});
