/**
 * Prévia da importação: as linhas da planilha por grupo, e o que fazer com cada grupo.
 *
 * Os grupos que pedem decisão (já é cliente do ERP, telefone de outra empresa) abrem
 * primeiro e expandidos; o resto fica fechado com a contagem à vista. Em dois grupos a
 * decisão é por linha: marcar a linha = "criar como lead próprio, com o telefone
 * compartilhado". É um clique explícito por linha — a regra do telefone N:N exige isso.
 */
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { formatPhoneBR } from "@/shared/format/phone";
import {
  GROUP_META,
  GROUP_ORDER,
  groupAction,
  matchSentence,
  type ImportPreview,
  type PreviewChoices,
  type PreviewGroup,
  type PreviewRow,
  type RowAction,
} from "../../lib/import-preview";

const TONE: Record<(typeof GROUP_META)[PreviewGroup]["tone"], string> = {
  good: "bg-success/10 text-success-strong",
  info: "bg-insights/10 text-insights",
  warn: "bg-warning/15 text-warning-strong",
  neutral: "bg-muted text-muted-foreground",
  bad: "bg-destructive/10 text-destructive",
};

interface ImportPreviewReviewProps {
  preview: ImportPreview;
  choices: PreviewChoices;
  onChange: (next: PreviewChoices) => void;
}

export function ImportPreviewReview({ preview, choices, onChange }: ImportPreviewReviewProps) {
  const byGroup = useMemo(() => {
    const map = new Map<PreviewGroup, PreviewRow[]>();
    for (const r of preview.rows) map.set(r.group, [...(map.get(r.group) ?? []), r]);
    return map;
  }, [preview.rows]);

  const groups = GROUP_ORDER.filter((g) => (byGroup.get(g)?.length ?? 0) > 0);
  const [open, setOpen] = useState<Set<PreviewGroup>>(
    () => new Set(groups.filter((g) => GROUP_META[g].sharePerRow)),
  );

  const toggleOpen = (g: PreviewGroup) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  const setAction = (g: PreviewGroup, action: RowAction) =>
    onChange({ ...choices, group: { ...choices.group, [g]: action } });

  const setShared = (rows: number[], on: boolean) => {
    const shared = new Set(choices.shared);
    for (const r of rows) {
      if (on) shared.add(r);
      else shared.delete(r);
    }
    onChange({ ...choices, shared });
  };

  return (
    <div className="space-y-2" data-testid="import-preview-review">
      {groups.map((g) => (
        <GroupSection
          key={g}
          group={g}
          rows={byGroup.get(g) ?? []}
          action={groupAction(choices, g)}
          shared={choices.shared}
          open={open.has(g)}
          onToggleOpen={() => toggleOpen(g)}
          onAction={(a) => setAction(g, a)}
          onShare={setShared}
        />
      ))}
    </div>
  );
}

interface GroupSectionProps {
  group: PreviewGroup;
  rows: PreviewRow[];
  action: RowAction;
  shared: Set<number>;
  open: boolean;
  onToggleOpen: () => void;
  onAction: (action: RowAction) => void;
  onShare: (rows: number[], on: boolean) => void;
}

function GroupSection({ group, rows, action, shared, open, onToggleOpen, onAction, onShare }: GroupSectionProps) {
  const meta = GROUP_META[group];
  const markedHere = rows.filter((r) => shared.has(r.row)).length;
  const allMarked = markedHere === rows.length;
  const headingId = `import-preview-${group}`;

  return (
    <section className="rounded-xl border bg-card" aria-labelledby={headingId}>
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 p-3">
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
        >
          <span
            className={cn(
              "mt-px inline-flex min-w-7 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums",
              TONE[meta.tone],
            )}
          >
            {rows.length}
          </span>
          <span className="min-w-0">
            <span id={headingId} className="block text-sm font-medium leading-5">
              {meta.title}
            </span>
            <span className="block text-xs text-muted-foreground">{meta.hint}</span>
          </span>
          <ChevronDown
            aria-hidden
            className={cn("ml-auto mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </button>
        {meta.actions.length > 1 && (
          <SegmentedControl
            label={`O que fazer com ${meta.title.toLowerCase()}`}
            options={meta.actions.map((a) => ({ value: a.value, label: a.label }))}
            value={action}
            onValueChange={(v) => onAction(v as RowAction)}
          />
        )}
      </header>

      {open && (
        <div className="border-t">
          {meta.sharePerRow && (
            <div className="flex items-center justify-between gap-3 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <span>Marque as que são empresas diferentes: viram lead próprio, com o telefone compartilhado.</span>
              <button
                type="button"
                className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline"
                onClick={() => onShare(rows.map((r) => r.row), !allMarked)}
              >
                {allMarked ? "Desmarcar todas" : "Marcar todas"}
              </button>
            </div>
          )}
          <ul className="max-h-56 divide-y overflow-y-auto">
            {rows.map((r) => {
              const detail = [r.phone ? formatPhoneBR(r.phone) : null, matchSentence(r) ?? r.reason].filter(Boolean).join(" · ");
              const checkboxId = `import-preview-share-${r.row}`;
              return (
                <li key={r.row} className="flex items-start gap-3 px-3 py-2">
                  {meta.sharePerRow && (
                    <Checkbox
                      id={checkboxId}
                      className="mt-0.5"
                      checked={shared.has(r.row)}
                      onCheckedChange={(v) => onShare([r.row], v === true)}
                      aria-label={`Linha ${r.row}: criar com telefone compartilhado`}
                    />
                  )}
                  <label htmlFor={meta.sharePerRow ? checkboxId : undefined} className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      <span className="tabular-nums text-muted-foreground">Linha {r.row}</span>
                      <span className="text-muted-foreground"> · </span>
                      {r.company?.trim() || r.name}
                    </span>
                    {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
