/**
 * Etiqueta pela coluna da planilha: cada valor da coluna escolhida ganha a sua
 * etiqueta. É o que a Café Jurerê precisava em 25/11 — uma lista com três segmentos
 * e uma etiqueta por segmento, não as três em todo mundo.
 *
 * A escolha volta preenchida na próxima planilha (`import_tag_rules`, por org).
 */
import { useMemo } from "react";
import { Tags, Zap } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTags, type Tag } from "../../hooks/useTags";
import { useTagAddedAutomations } from "../../hooks/useTagAddedAutomations";
import { disparoDoImport } from "../../lib/import-tags";
import type { ColumnValue, ValueTagMap } from "../../lib/import-tag-rules";

const SEM_COLUNA = "__sem_coluna__";
const SEM_ETIQUETA = "__sem_etiqueta__";

interface ImportTagByColumnFieldProps {
  columns: string[];
  column: string | null;
  values: ColumnValue[];
  map: ValueTagMap;
  onColumnChange: (column: string | null) => void;
  onMapChange: (map: ValueTagMap) => void;
}

export function ImportTagByColumnField({
  columns,
  column,
  values,
  map,
  onColumnChange,
  onMapChange,
}: ImportTagByColumnFieldProps) {
  const { data: tags = [] } = useTags();
  const automacoes = useTagAddedAutomations();
  const porId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  // Execuções de automação: por valor, linhas × automações que casam com a etiqueta dele.
  const disparo = useMemo(() => {
    const nomes = new Set<string>();
    let execucoes = 0;
    for (const v of values) {
      const tag = map[v.key] ? porId.get(map[v.key]) : undefined;
      if (!tag) continue;
      const d = disparoDoImport(automacoes.data ?? [], [tag.name]);
      d.automacoes.forEach((a) => nomes.add(a.name));
      execucoes += d.execucoesPorLead * v.count;
    }
    return { nomes: [...nomes], execucoes };
  }, [values, map, porId, automacoes.data]);

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5">
        <Tags className="w-3.5 h-3.5 text-muted-foreground" />
        Etiqueta por coluna
      </Label>
      <p className="text-xs text-muted-foreground -mt-1">
        Cada valor da coluna ganha a sua etiqueta. A escolha fica salva para a próxima planilha.
      </p>

      <Select value={column ?? SEM_COLUNA} onValueChange={(v) => onColumnChange(v === SEM_COLUNA ? null : v)}>
        <SelectTrigger aria-label="Coluna que define a etiqueta">
          <SelectValue placeholder="Escolher coluna..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SEM_COLUNA}>Não usar</SelectItem>
          {columns.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {column && values.length > 0 && (
        <ul className="divide-y rounded-lg border" aria-label={`Etiqueta de cada valor de ${column}`}>
          {values.map((v) => (
            <li key={v.key} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{v.label}</span>
                <span className="block text-xs tabular-nums text-muted-foreground">
                  {v.count} {v.count === 1 ? "linha" : "linhas"}
                </span>
              </span>
              <Select
                value={map[v.key] && porId.has(map[v.key]) ? map[v.key] : SEM_ETIQUETA}
                onValueChange={(tagId) => {
                  const next = { ...map };
                  if (tagId === SEM_ETIQUETA) delete next[v.key];
                  else next[v.key] = tagId;
                  onMapChange(next);
                }}
              >
                <SelectTrigger className="w-[220px]" aria-label={`Etiqueta para ${v.label}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_ETIQUETA}>Sem etiqueta</SelectItem>
                  {tags.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <TagOption tag={t} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>
      )}

      {column && values.length === 0 && (
        <p className="text-xs text-muted-foreground">A coluna {column} está vazia nesta planilha.</p>
      )}

      {disparo.nomes.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3">
          <Zap className="w-4 h-4 text-warning-strong shrink-0 mt-0.5" />
          <p className="text-xs text-foreground/85">
            <strong>
              {disparo.nomes.length === 1
                ? "1 automação de etiqueta vai rodar"
                : `${disparo.nomes.length} automações de etiqueta vão rodar`}
            </strong>{" "}
            para cada lead que ainda não tinha a etiqueta: {disparo.nomes.join(", ")}. São até{" "}
            {disparo.execucoes.toLocaleString("pt-BR")} execuções nesta importação.
          </p>
        </div>
      )}
    </div>
  );
}

function TagOption({ tag }: { tag: Tag }) {
  return (
    <span className="flex items-center gap-2">
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color || "#888888" }} aria-hidden />
      <span className="truncate">{tag.name}</span>
    </span>
  );
}
