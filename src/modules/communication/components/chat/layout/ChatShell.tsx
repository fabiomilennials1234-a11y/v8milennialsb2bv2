/**
 * ChatShell — layout 3-col resizable do chat.
 *
 * Implementação C10: ResizablePanelGroup + persistência de tamanhos por usuário.
 *
 * Coluna 1 (list):    25% default, 20–35%, contém ConversationList
 * Coluna 2 (view):    47% default, 40%+, contém ChatHeader + MessageList + composer stub
 * Coluna 3 (context): 28% default, 23–42%, colapsável, contém ContextPanel
 *
 * Persistência: localStorage key `chat-layout-sizes-${userId}` — array [leftPct, centerPct, rightPct].
 * onLayout: debounce 300ms antes de persistir.
 *
 * Mobile <780px: este componente é para viewport ≥780px.
 * Abaixo de 780px, WhatsAppChat.tsx mantém o layout stack atual (Onda 2b redesenha mobile).
 *
 * IMPORTANTE: Este componente NÃO substitui /chat em produção nesta onda.
 * WhatsAppChat.tsx continua usando seu layout próprio.
 * ChatShell é consumido pelo mockup v2 (C16) e ativado em Onda 2b.
 */
import React, { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useAuth } from "@/modules/identity";
// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Modo de densidade das mensagens — controlado externamente via useChatDensity (C11). */
export type DensityMode = "compact" | "comfortable" | "spacious";

/** CSS vars injetadas pelo useChatDensity para sobrescrever os defaults :root */
export type DensityCssVars = Record<string, string>;

export interface ChatShellProps {
  /** Coluna esquerda: ConversationList */
  list: ReactNode;
  /** Coluna central: ChatHeader + MessageList + Composer */
  view: ReactNode;
  /** Coluna direita: ContextPanel (opcional) */
  context?: ReactNode;
  /** Telefone selecionado — null quando nenhuma conversa ativa */
  selectedPhone: string | null;
  /** Callback ao fechar a conversa ativa (voltar para lista) */
  onBack: () => void;
  /** Modo de densidade — usado apenas para leitura/display externo (opcional). */
  density?: DensityMode;
  /**
   * CSS vars do preset de densidade para injeção no root do shell.
   * Gerado por useChatDensity(userId).cssVars — spread em style inline.
   * Sobrescreve os defaults de :root sem afetar outros elementos da página.
   */
  densityCssVars?: DensityCssVars;
}

// ─── Persistência de tamanhos ─────────────────────────────────────────────────

const DEFAULTS = {
  left: 25,
  center: 47,
  right: 28,
} as const;

/** Somas devem ser ~100. Tolerância de 2pp para arredondamentos de float. */
function isValidSizes(sizes: unknown): sizes is [number, number, number] {
  if (!Array.isArray(sizes) || sizes.length !== 3) return false;
  if (!sizes.every((s) => typeof s === "number" && isFinite(s) && s > 0)) return false;
  const sum = sizes.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 2) return false;
  if (sizes[0] < 20 || sizes[0] > 35) return false;
  if (sizes[1] < 40) return false;
  if (sizes[2] < 23 || sizes[2] > 42) return false;
  return true;
}

function loadSizes(userId: string | undefined): [number, number, number] {
  if (!userId) return [DEFAULTS.left, DEFAULTS.center, DEFAULTS.right];
  try {
    const raw = localStorage.getItem(`chat-layout-sizes-${userId}`);
    if (!raw) return [DEFAULTS.left, DEFAULTS.center, DEFAULTS.right];
    const parsed = JSON.parse(raw);
    if (isValidSizes(parsed)) return parsed;
  } catch {
    // localStorage inacessível ou JSON inválido — usar defaults
  }
  return [DEFAULTS.left, DEFAULTS.center, DEFAULTS.right];
}

function saveSizes(userId: string | undefined, sizes: number[]): void {
  if (!userId) return;
  try {
    localStorage.setItem(`chat-layout-sizes-${userId}`, JSON.stringify(sizes));
  } catch {
    // localStorage cheio ou bloqueado — silencioso
  }
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function ChatShell({
  list,
  view,
  context,
  selectedPhone,
  density: _density,
  densityCssVars,
}: ChatShellProps) {
  const { user } = useAuth();
  const userId = user?.id;

  const initialSizes = loadSizes(userId);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Limpar debounce ao desmontar
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleLayout = useCallback(
    (sizes: number[]) => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        saveSizes(userId, sizes);
      }, 300);
    },
    [userId],
  );

  const hasContext = context !== null && context !== undefined;

  return (
    <ResizablePanelGroup
      direction="horizontal"
      onLayout={handleLayout}
      className="flex h-full w-full"
      aria-label="Layout do chat"
      // V5: as três colunas são cartões separados pousados na bancada. A lib
      // põe `overflow: hidden` inline no grupo e em cada painel — isso cortaria
      // a sombra dos cartões. O que o `overflow` protegia (conteúdo empurrando
      // o tamanho do painel) fica com `min-w-0` em cada painel e com o
      // `overflow-hidden` do próprio cartão.
      style={{ ...(densityCssVars as React.CSSProperties), overflow: "visible" }}
    >
      {/* ── Painel esquerdo: lista de conversas ──────────────────────────── */}
      <ResizablePanel
        defaultSize={initialSizes[0]}
        minSize={20}
        maxSize={35}
        style={PANEL_STYLE}
        className={cn(
          "min-w-0",
          // Mobile: esconde a lista quando uma conversa está selecionada
          selectedPhone ? "hidden md:flex md:flex-col" : "flex flex-col",
        )}
      >
        {/* A caixa de entrada é a coluna de TINTA (o painel-herói do chat: é a
            fila do que pede resposta). O fundo de tinta fica no cartão; o
            conteúdo recebe o tema escuro (`dark`) para que busca, filtros,
            selos e linhas — todos escritos em tokens — leiam claro sobre a
            tinta sem cada componente precisar de uma segunda paleta. Menus e
            popovers saem por portal e continuam no tema da página. */}
        <div className={cn(COLUMN_CLASSES, "bg-tinta shadow-relevo-tinta")}>
          <div className="dark flex h-full min-h-0 min-w-0 flex-col text-foreground">
            {list}
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle className={HANDLE_CLASSES} />

      {/* ── Painel central: chat ──────────────────────────────────────────── */}
      <ResizablePanel
        defaultSize={hasContext ? initialSizes[1] : initialSizes[1] + initialSizes[2]}
        minSize={40}
        style={PANEL_STYLE}
        className={cn(
          "flex flex-col min-h-0 min-w-0",
          // Mobile: esconde o centro quando nenhuma conversa selecionada
          !selectedPhone ? "hidden md:flex" : "flex",
        )}
      >
        <div className={cn(COLUMN_CLASSES, CARD_CLASSES)}>
          {view}
        </div>
      </ResizablePanel>

      {/* ── Painel direito: contexto (opcional, colapsável) ───────────────── */}
      {hasContext && (
        <>
          <ResizableHandle className={HANDLE_CLASSES} />
          <ResizablePanel
            defaultSize={initialSizes[2]}
            minSize={23}
            maxSize={42}
            collapsible
            style={PANEL_STYLE}
            className="flex flex-col min-h-0 min-w-0"
          >
            <div className={cn(COLUMN_CLASSES, CARD_CLASSES)}>
              {context}
            </div>
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}

// ─── Forma V5 das colunas ────────────────────────────────────────────────────

/** Painel sem o `overflow: hidden` inline da lib — ver comentário no grupo. */
const PANEL_STYLE: React.CSSProperties = { overflow: "visible" };

/** Cartão de coluna: raio de painel, conteúdo recortado nas bordas. */
const COLUMN_CLASSES = "flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-panel";

const CARD_CLASSES = "border border-card-border bg-card text-card-foreground shadow-relevo";

/**
 * A alça vira o vão de 12 px entre os cartões. A área de arraste é o vão
 * inteiro; o traço só aparece sob o mouse (e em ouro durante o arraste).
 */
const HANDLE_CLASSES = [
  "w-3 bg-transparent after:w-3",
  "before:absolute before:left-1/2 before:top-1/2 before:h-10 before:w-1 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:bg-transparent before:transition-colors before:duration-150",
  "hover:before:bg-foreground/15 data-[resize-handle-state=drag]:before:bg-primary",
].join(" ");

// ─── Utilitário local ────────────────────────────────────────────────────────

/** cn mínimo sem importar da lib — preserva zero dependências circulares. */
function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
