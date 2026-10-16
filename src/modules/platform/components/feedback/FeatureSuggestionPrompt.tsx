import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { useLocation } from "react-router-dom";
import { useIdentity } from "@/modules/identity";
import { usePromptImpression, type PromptOutcome } from "@/modules/platform/hooks/usePromptImpression";
import { useSubmitFeatureSuggestion } from "@/modules/platform/hooks/useSubmitFeatureSuggestion";
import {
  FEATURE_SUGGESTION_PROMPT_KEY,
  isAnotherDialogOpen,
  isExcludedRoute,
  type SuggestionKind,
} from "./feature-suggestion";
import type { FeatureSuggestionDialogProps } from "./FeatureSuggestionDialog";

/**
 * Prompt de sugestões na primeira abertura do Torque: UMA vez por usuário, em
 * qualquer device (a marca mora no servidor — `usePromptImpression`).
 *
 * Gates, todos antes de gravar qualquer coisa:
 *  (a) kill-switch `ENABLED`;
 *  (b) identidade pronta, com usuário e org, e não-master;
 *  (c) rota fora de /auth, /signup, /reset-password, /_mockup, /master, /tv;
 *  (d) servidor diz "não visto" (erro = visto: falha fecha);
 *  (e) ~1,5 s depois de montar;
 *  (f) aba visível;
 *  (g) nenhum outro diálogo aberto — senão adia e re-checa.
 *
 * Ordem depois dos gates — nada gasta a exibição sem ela acontecer:
 *  1. carrega o chunk do diálogo. Falhou → desiste SEM gravar;
 *  2. claim (INSERT). A linha nasce antes do render, então reload, outra aba ou
 *     outro device não mostram de novo;
 *  3. se um diálogo abriu nesse meio-tempo, espera ele fechar;
 *  4. abre.
 * O MainLayout remonta a cada rota (LayoutWrapper por rota em App.tsx). Se a
 * montagem morre entre 2 e 4, o cache fica "claimed" e a próxima montagem pula
 * o claim e abre — a exibição não se perde na troca de rota. Se morre DURANTE o
 * INSERT, o cache fica "claiming" e `claim()` devolve a mesma promise em voo:
 * um INSERT só.
 *
 * Fechou → espera a animação de saída (`onExited`) e desmonta o diálogo
 * (fase `closed`). Um teto (`EXIT_FALLBACK_MS`) garante a desmontagem mesmo
 * se a animação nunca terminar.
 *
 * A decisão é tomada uma vez por montagem.
 */

/** Kill-switch. Desligar é esta linha. */
const ENABLED = true;

export const ENTRY_DELAY_MS = 1500;
export const RECHECK_MS = 1000;
/** Teto para a saída: mais que a animação de fechar (~220ms). */
export const EXIT_FALLBACK_MS = 700;

type DialogModule = { FeatureSuggestionDialog: ComponentType<FeatureSuggestionDialogProps> };

const loadDialogChunk = (): Promise<DialogModule> => import("./FeatureSuggestionDialog");

type Phase = "waiting" | "starting" | "open" | "closed";

function isPageFree(): boolean {
  return document.visibilityState === "visible" && !isAnotherDialogOpen();
}

export interface FeatureSuggestionPromptProps {
  /** Só para teste: troca o carregador do chunk do diálogo. */
  loadDialog?: () => Promise<DialogModule>;
}

export function FeatureSuggestionPrompt({ loadDialog = loadDialogChunk }: FeatureSuggestionPromptProps = {}) {
  const { userId, organizationId, isMaster, isReady } = useIdentity();
  const { pathname } = useLocation();

  const eligible = ENABLED && isReady && !!userId && !!organizationId && !isMaster && !isExcludedRoute(pathname);

  const { status, claim, resolve } = usePromptImpression(FEATURE_SUGGESTION_PROMPT_KEY, { enabled: eligible });
  const submit = useSubmitFeatureSuggestion();

  const [phase, setPhase] = useState<Phase>("waiting");
  const [Dialog, setDialog] = useState<ComponentType<FeatureSuggestionDialogProps> | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const pending = status === "unseen" || status === "claiming" || status === "claimed";

  // Esquenta o chunk do diálogo assim que se sabe que ele pode aparecer.
  useEffect(() => {
    if (pending) void loadDialog().catch(() => undefined);
  }, [loadDialog, pending]);

  useEffect(() => {
    if (phase !== "waiting" || !eligible) return;
    if (status === "seen" || status === "error") {
      setPhase("closed");
      return;
    }
    if (!pending) return;

    const alreadyClaimed = status === "claimed";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    /** Resolve quando a página está livre; `false` se a montagem morreu antes. */
    const waitUntilFree = () =>
      new Promise<boolean>((done) => {
        const check = () => {
          if (!mountedRef.current) return done(false);
          if (isPageFree()) return done(true);
          setTimeout(check, RECHECK_MS);
        };
        check();
      });

    const start = async () => {
      let module: DialogModule;
      try {
        module = await loadDialog();
      } catch {
        // Sem o chunk não há o que mostrar: desiste sem gastar a exibição.
        if (mountedRef.current) setPhase("closed");
        return;
      }
      if (!mountedRef.current) return;

      const claimed = alreadyClaimed || (await claim());
      if (!claimed) {
        if (mountedRef.current) setPhase("closed");
        return;
      }
      // Claim feito: a partir daqui uma montagem nova assume ("claimed" no cache).
      if (!(await waitUntilFree())) return;
      setDialog(() => module.FeatureSuggestionDialog);
      setPhase("open");
    };

    const attempt = () => {
      if (cancelled) return;
      if (!isPageFree()) {
        timer = setTimeout(attempt, RECHECK_MS);
        return;
      }
      // Daqui em diante a sequência não é cancelada por re-render (o claim muda
      // o status); só a desmontagem a interrompe, via mountedRef.
      setPhase("starting");
      void start();
    };

    timer = setTimeout(attempt, ENTRY_DELAY_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, eligible, status, pending, claim, loadDialog]);

  // Fechou: desmonta depois da saída (onExited) ou, no pior caso, pelo teto.
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setPhase("closed"), EXIT_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  const handleExited = useCallback(() => setPhase("closed"), []);

  const handleSubmit = useCallback(
    async ({ kind, body }: { kind: SuggestionKind; body: string }) => {
      if (!organizationId) throw new Error("sem organização");
      await submit.mutateAsync({ organizationId, kind, body });
      void resolve("submitted");
    },
    [organizationId, resolve, submit],
  );

  const handleClose = useCallback(
    (outcome: Extract<PromptOutcome, "dismissed"> | null) => {
      setClosing(true);
      if (outcome) void resolve(outcome);
    },
    [resolve],
  );

  if (phase !== "open" || !Dialog) return null;

  return <Dialog onSubmit={handleSubmit} onClose={handleClose} onExited={handleExited} />;
}
