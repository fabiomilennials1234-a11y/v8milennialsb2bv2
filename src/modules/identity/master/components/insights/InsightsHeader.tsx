import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { OrgInsightsCombobox, type OrgOption } from "./OrgInsightsCombobox";
import { InsightsModeTabs, type InsightsMode } from "./InsightsModeTabs";
import { ScenarioBadge } from "./ScenarioBadge";
import { HORIZONTES, type Horizonte } from "./lib/format";

interface InsightsHeaderProps {
  orgs: OrgOption[];
  orgId: string;
  orgName: string;
  onSelectOrg: (orgId: string) => void;
  mode: InsightsMode;
  onModeChange: (mode: InsightsMode) => void;
  horizonte: Horizonte;
  onHorizonteChange: (h: Horizonte) => void;
}

/**
 * Header da org selecionada (DESIGN §5). Sticky sob o topo, com nome da org,
 * org-switcher compacto, segmented Dados|Projeção, toggle de horizonte e a
 * pílula de cenário-meta na aba Projeção.
 */
export function InsightsHeader({
  orgs,
  orgId,
  orgName,
  onSelectOrg,
  mode,
  onModeChange,
  horizonte,
  onHorizonteChange,
}: InsightsHeaderProps) {
  return (
    <header className="sticky top-0 z-20 -mx-8 border-b border-border/60 bg-background/85 px-8 py-4 backdrop-blur lg:-mx-12 lg:px-12">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-insights">
              Insights · Unit Economics
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="truncate font-display text-2xl tracking-[-0.02em] text-foreground md:text-[28px]">
                {orgName}
              </h1>
              <OrgInsightsCombobox
                orgs={orgs}
                value={orgId}
                onSelect={onSelectOrg}
                variant="compact"
              />
            </div>
          </div>
          {mode === "projecao" && <ScenarioBadge />}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <InsightsModeTabs value={mode} onChange={onModeChange} />

          <ToggleGroup
            type="single"
            value={horizonte}
            onValueChange={(v) => v && onHorizonteChange(v as Horizonte)}
            variant="outline"
            size="sm"
            aria-label="Horizonte"
          >
            {HORIZONTES.map((h) => (
              <ToggleGroupItem
                key={h.key}
                value={h.key}
                aria-label={h.label}
                className={cn(
                  "text-xs",
                  "data-[state=on]:border-insights/30 data-[state=on]:bg-insights/12 data-[state=on]:text-insights",
                )}
              >
                {h.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>
    </header>
  );
}
