import { useMemo, useState } from "react";
import { AlertTriangle, Check, Tag as TagIcon, X, Zap } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTags, type Tag } from "../../hooks/useTags";
import { useTagAddedAutomations } from "../../hooks/useTagAddedAutomations";
import type { EdgeFunctionReport } from "../../hooks/useImportLeads";
import { dobrar } from "../etiquetas/useEditorDeEtiquetas";
import { disparoDoImport, MAX_ETIQUETAS_POR_IMPORT } from "../../lib/import-tags";

const COR_PADRAO = "#888888";

function corDa(tag: Tag): string {
  return tag.color || COR_PADRAO;
}

interface ImportTagsFieldProps {
  value: string[];
  onChange: (tagIds: string[]) => void;
  /** Leads da planilha — dá a ordem de grandeza das automações disparadas. */
  totalLeads?: number;
}

export function ImportTagsField({ value, onChange, totalLeads }: ImportTagsFieldProps) {
  const { data: tags = [], isLoading } = useTags();
  const automacoes = useTagAddedAutomations();
  const [busca, setBusca] = useState("");

  const porId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const escolhidas = value.map((id) => porId.get(id)).filter((t): t is Tag => t !== undefined);

  const termo = dobrar(busca);
  const visiveis = termo ? tags.filter((t) => dobrar(t.name).includes(termo)) : tags;
  const noLimite = value.length >= MAX_ETIQUETAS_POR_IMPORT;

  const disparo = disparoDoImport(
    automacoes.data ?? [],
    escolhidas.map((t) => t.name),
  );

  const alternar = (id: string) => {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else if (!noLimite) onChange([...value, id]);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="import-etiquetas-busca" className="flex items-center gap-1.5">
        <TagIcon className="w-3.5 h-3.5 text-muted-foreground" />
        Etiquetas
      </Label>
      <p className="text-xs text-muted-foreground -mt-1">
        Entram em todos os leads desta planilha, inclusive nos que já estavam cadastrados.
      </p>

      {!isLoading && tags.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">
          Nenhuma etiqueta cadastrada. Um administrador cria em Configurações › Tags.
        </p>
      ) : (
        <div className="rounded-lg border">
          {escolhidas.length > 0 && (
            <div className="flex flex-wrap gap-1 border-b p-2">
              {escolhidas.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[11px]"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${corDa(t)} 12%, transparent)`,
                    borderColor: `color-mix(in srgb, ${corDa(t)} 24%, transparent)`,
                    color: corDa(t),
                  }}
                >
                  {t.name}
                  <button
                    type="button"
                    aria-label={`Tirar a etiqueta ${t.name}`}
                    onClick={() => alternar(t.id)}
                    className={cn(
                      "-mr-0.5 rounded-full opacity-60 transition-opacity",
                      "hover:opacity-100 focus-visible:opacity-100",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="space-y-1 p-2">
            <Input
              id="import-etiquetas-busca"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar etiqueta…"
              className="h-8 text-xs"
            />
            <div className="max-h-36 space-y-0.5 overflow-y-auto" role="group" aria-label="Etiquetas da organização">
              {visiveis.map((t) => {
                const marcada = value.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={marcada}
                    disabled={!marcada && noLimite}
                    onClick={() => alternar(t.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
                      "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
                      "disabled:pointer-events-none disabled:opacity-45",
                      marcada && "bg-muted/40",
                    )}
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: corDa(t) }}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate">{t.name}</span>
                    {marcada && <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />}
                  </button>
                );
              })}
              {visiveis.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground/60">
                  {isLoading ? "Carregando etiquetas…" : `Nenhuma etiqueta com “${busca.trim()}”.`}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {noLimite && (
        <p className="text-[11px] text-muted-foreground">
          Limite de {MAX_ETIQUETAS_POR_IMPORT} etiquetas por importação.
        </p>
      )}

      {disparo.automacoes.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3">
          <Zap className="w-4 h-4 text-warning-strong shrink-0 mt-0.5" />
          <p className="text-xs text-foreground/85">
            <strong>
              {disparo.automacoes.length === 1
                ? "1 automação de etiqueta vai rodar"
                : `${disparo.automacoes.length} automações de etiqueta vão rodar`}
            </strong>{" "}
            para cada lead que ainda não tinha a etiqueta: {disparo.automacoes.map((a) => a.name).join(", ")}.
            {totalLeads ? ` São até ${(disparo.execucoesPorLead * totalLeads).toLocaleString("pt-BR")} execuções nesta importação.` : ""}
          </p>
        </div>
      )}

      {escolhidas.length > 0 && automacoes.isError && (
        <p className="text-[11px] text-muted-foreground">
          Não foi possível verificar se estas etiquetas disparam automações.
        </p>
      )}
    </div>
  );
}

/** Resultado das etiquetas no passo final do import. */
export function ImportTagsOutcome({ report }: { report: EdgeFunctionReport | null }) {
  const tags = report?.tags;
  if (!tags) return null;

  if (tags.failed > 0) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3">
        <AlertTriangle className="w-4 h-4 text-warning-strong shrink-0 mt-0.5" />
        <p className="text-xs text-foreground/85">
          <strong>
            {tags.failed.toLocaleString("pt-BR")} {tags.failed === 1 ? "lead ficou" : "leads ficaram"} sem as etiquetas.
          </strong>{" "}
          Selecione-os na lista de leads e aplique pela ação em massa.
        </p>
      </div>
    );
  }

  return (
    <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
      <TagIcon className="size-3.5" aria-hidden="true" />
      Etiquetas aplicadas em {tags.leads.toLocaleString("pt-BR")} {tags.leads === 1 ? "lead" : "leads"}.
    </p>
  );
}
