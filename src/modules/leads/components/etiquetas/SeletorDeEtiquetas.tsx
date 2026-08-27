import { Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { EditorDeEtiquetas } from "./useEditorDeEtiquetas";

/**
 * O miolo do seletor: buscar, marcar, tirar e (para admin) criar.
 *
 * Recebe o editor pronto em vez de chamar o hook por dentro porque as duas
 * superfícies que o usam querem coisas diferentes do MESMO estado: a faixa do
 * card do Lead desenha as pílulas por fora (e por isso passa
 * `mostrarPresas={false}`, senão a mesma lista apareceria duas vezes a um
 * centímetro de distância), enquanto o botão do quadro e o da lista não têm
 * onde desenhá-las senão aqui dentro.
 */
export function SeletorDeEtiquetas({
  editor,
  podeCriar = false,
  /**
   * Lista as etiquetas do lead no topo, cada uma com o "×".
   *
   * É o que torna o seletor suficiente sozinho: no card do quadro e na linha da
   * lista não há faixa nenhuma para pendurar o "×", então sem isto daria para
   * adicionar e não daria para tirar — que é exatamente o buraco que este
   * trabalho veio fechar.
   */
  mostrarPresas = true,
}: {
  editor: EditorDeEtiquetas;
  podeCriar?: boolean;
  mostrarPresas?: boolean;
}) {
  const {
    presas,
    disponiveis,
    doOrg,
    busca,
    setBusca,
    termo,
    nomeInedito,
    jaNoLead,
    catalogoCarregando,
    gravando,
    removendo,
    pendurar,
    criarEPendurar,
    tirar,
  } = editor;

  return (
    <div className="space-y-2">
      {mostrarPresas && presas.length > 0 && (
        <div className="space-y-1">
          <p className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            No lead
          </p>
          <div className="flex flex-wrap gap-1">
            {presas.map((p) => {
              const cor = p.tag!.color || "#888888";
              return (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[11px]"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${cor} 12%, transparent)`,
                    borderColor: `color-mix(in srgb, ${cor} 24%, transparent)`,
                    color: cor,
                  }}
                >
                  {p.tag!.name}
                  <button
                    type="button"
                    aria-label={`Remover a etiqueta ${p.tag!.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void tirar(p.id, p.tag!.name);
                    }}
                    disabled={removendo}
                    className={cn(
                      "-mr-0.5 rounded-full opacity-60 transition-opacity",
                      "hover:opacity-100 focus-visible:opacity-100",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      "disabled:pointer-events-none disabled:opacity-30",
                    )}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <Input
        autoFocus
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar etiqueta…"
        className="h-7 text-xs"
      />

      <div className="max-h-52 space-y-0.5 overflow-y-auto">
        {disponiveis.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void pendurar(t.id, t.name);
            }}
            disabled={gravando}
            className={cn(
              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
              "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
              "disabled:pointer-events-none disabled:opacity-45",
            )}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: t.color || "#888888" }}
              aria-hidden="true"
            />
            <span className="truncate">{t.name}</span>
          </button>
        ))}

        {/* Cada vazio diz uma coisa diferente, e confundi-los é o que faz a
            pessoa concluir que a busca está quebrada. */}
        {disponiveis.length === 0 && !nomeInedito && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground/60">
            {catalogoCarregando
              ? "Carregando etiquetas…"
              : jaNoLead
                ? "Esta etiqueta já está no lead."
                : doOrg.length === 0
                  ? "Nenhuma etiqueta cadastrada nesta organização."
                  : "Nenhuma etiqueta disponível."}
          </p>
        )}
      </div>

      {nomeInedito &&
        (podeCriar ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void criarEPendurar();
            }}
            disabled={gravando}
            className={cn(
              "flex w-full items-center gap-2 rounded border border-dashed border-border px-2 py-1.5 text-left text-xs",
              "transition-colors hover:border-muted-foreground/40 hover:bg-muted/50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-45",
            )}
          >
            <Plus className="size-3 shrink-0" />
            <span className="truncate">Criar “{termo}”</span>
          </button>
        ) : (
          /* Sem poder criar, dizer O PORQUÊ vale mais que sumir: quem digitou
             um nome que não existe fica sabendo onde ele nasce, em vez de
             concluir que a busca está quebrada. */
          <p className="px-2 pb-1 text-[11px] leading-snug text-muted-foreground/60">
            “{termo}” não existe. Etiquetas novas são criadas por um administrador em
            Configurações › Tags.
          </p>
        ))}
    </div>
  );
}
