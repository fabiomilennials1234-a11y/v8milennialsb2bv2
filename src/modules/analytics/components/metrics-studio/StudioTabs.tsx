/**
 * As abas do Estúdio — trocar de painel, criar, renomear e remover.
 *
 * ── Por que abas e não um seletor ──
 *
 * O Estúdio deixou de ter um painel só. Um `Select` esconderia as outras abas
 * atrás de um clique, e a graça de ter "Visão Geral", "Performance" e "Saúde"
 * lado a lado é justamente **ver que elas existem** — o usuário que não sabe da
 * aba não vai procurá-la num menu.
 *
 * ── Editar só em modo Edição ──
 *
 * Criar, renomear e remover só aparecem quando o painel está editável. Em
 * Visualização a aba é só navegação, pelo mesmo motivo que o canvas não arrasta
 * em Visualização (SCRUM-308): o painel é para LER, e controle de escrita
 * exposto durante a leitura vira clique acidental.
 *
 * A RLS já garante que só admin escreve; isto é a barreira de UI, não a de
 * segurança.
 */

import { useEffect, useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { StudioPanel } from "@/modules/analytics/hooks/useMetricsStudioPanels";

interface StudioTabsProps {
  paineis: StudioPanel[];
  ativoId: string | null;
  /** Controles de escrita só aparecem com isto verdadeiro. */
  editavel: boolean;
  onSelecionar: (id: string) => void;
  onCriar: () => void;
  onRenomear: (id: string, nome: string) => void;
  onRemover: (id: string) => void;
}

export function StudioTabs({
  paineis,
  ativoId,
  editavel,
  onSelecionar,
  onCriar,
  onRenomear,
  onRemover,
}: StudioTabsProps) {
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editandoId) inputRef.current?.select();
  }, [editandoId]);

  const comecarEdicao = (painel: StudioPanel) => {
    setEditandoId(painel.id);
    setRascunho(painel.nome);
  };

  const confirmar = () => {
    if (!editandoId) return;
    const nome = rascunho.trim();
    // Nome vazio volta ao anterior em vez de virar "Nova aba": o usuário
    // apagou para digitar outro e desistiu — sobrescrever seria surpresa.
    if (nome) onRenomear(editandoId, nome);
    setEditandoId(null);
  };

  return (
    <div
      role="tablist"
      aria-label="Painéis de métricas"
      className="flex items-center gap-1 overflow-x-auto border-b border-border/60 px-1 scrollbar-hide"
    >
      {paineis.map((painel) => {
        const ativo = painel.id === ativoId;
        const emEdicao = editandoId === painel.id;

        if (emEdicao) {
          return (
            <div key={painel.id} className="flex shrink-0 items-center gap-1 px-1 py-1.5">
              <Input
                ref={inputRef}
                value={rascunho}
                onChange={(e) => setRascunho(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmar();
                  if (e.key === "Escape") setEditandoId(null);
                }}
                // Blur confirma em vez de descartar: clicar fora depois de
                // digitar é gesto de "pronto", não de "cancela".
                onBlur={confirmar}
                maxLength={60}
                aria-label={`Nome da aba ${painel.nome}`}
                className="h-7 w-36 text-[13px]"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label="Confirmar nome"
                onMouseDown={(e) => e.preventDefault()}
                onClick={confirmar}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        }

        return (
          <div key={painel.id} className="group/aba relative shrink-0">
            <button
              type="button"
              role="tab"
              aria-selected={ativo}
              onClick={() => onSelecionar(painel.id)}
              // Duplo clique renomeia — atalho que não ocupa espaço na barra.
              onDoubleClick={() => editavel && comecarEdicao(painel)}
              className={cn(
                "relative px-3 py-2 text-[13px] font-medium transition-colors",
                editavel && "pr-7",
                ativo
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {painel.nome}
              {/* Sublinhado gold marca a aba ativa — mesma linguagem do resto
                  do produto, sem caixa nem fundo. */}
              {ativo && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>

            {editavel && (
              <button
                type="button"
                onClick={() => onRemover(painel.id)}
                aria-label={`Remover aba ${painel.nome}`}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/60 opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/aba:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}

      {editavel && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCriar}
          className="ml-1 h-7 shrink-0 gap-1 text-[12px] text-muted-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Nova aba
        </Button>
      )}
    </div>
  );
}
