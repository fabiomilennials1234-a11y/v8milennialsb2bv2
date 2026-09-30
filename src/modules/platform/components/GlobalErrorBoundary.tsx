import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { ErrorReference, reportError, toAppError } from "@/shared/errors";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isChunkError: boolean;
  /** Código que o usuário copia para o suporte (ADR-0038). */
  reference: string | null;
}

const RENDER_FALLBACK = "Algo deu errado nesta tela.";

/**
 * ErrorBoundary global — captura erros de runtime e exibe
 * uma tela de fallback ao invés de tela branca.
 *
 * Trata especialmente erros de chunk loading (comum após deploys)
 * fazendo reload automático uma vez.
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, isChunkError: false, reference: null };
  }

  static getDerivedStateFromError(error: Error): State {
    const isChunkError =
      error.message?.includes("Failed to fetch dynamically imported module") ||
      error.message?.includes("Loading chunk") ||
      error.message?.includes("Loading CSS chunk") ||
      error.message?.includes("Importing a module script failed") ||
      error.message?.includes("Invalid or unexpected token") ||
      error.message?.includes("Unexpected token '<'") ||
      error.message?.includes("expected expression, got '<'") ||
      error.name === "ChunkLoadError";

    // A referência nasce aqui para já estar na primeira renderização da tela de
    // erro; `componentDidCatch` relata o mesmo objeto e recebe o mesmo código.
    return { hasError: true, error, isChunkError, reference: toAppError(error, RENDER_FALLBACK).reference };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[GlobalErrorBoundary]", error, errorInfo);

    // Chunk velho é deploy novo, não defeito — o reload abaixo resolve.
    if (!this.state.isChunkError) {
      reportError(toAppError(error, RENDER_FALLBACK), { source: "render" });
    }

    // Auto-reload uma vez para erros de chunk (deploy novo invalidou cache).
    // Desregistra SW + limpa caches antes do reload — index.html cacheado
    // pelo SW antigo aponta para chunks que não existem mais no servidor,
    // então reload puro reentra no mesmo loop.
    if (this.state.isChunkError) {
      const reloadKey = "chunk_error_reload";
      const lastReload = sessionStorage.getItem(reloadKey);
      const now = Date.now();

      if (!lastReload || now - Number(lastReload) > 10_000) {
        sessionStorage.setItem(reloadKey, String(now));
        (async () => {
          try {
            const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
            await Promise.all(regs.map((r) => r.unregister()));
            if (typeof caches !== "undefined") {
              const keys = await caches.keys();
              await Promise.all(keys.map((k) => caches.delete(k)));
            }
          } catch {
            // best-effort — segue pro reload mesmo se algo falhar
          }
          window.location.reload();
        })();
        return;
      }
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const { isChunkError, reference } = this.state;

    // Sem o texto do erro na tela: "Cannot read properties of undefined" não diz
    // nada ao cliente e diz demais a qualquer um. O código leva o suporte à
    // causa (ADR-0038).
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div role="alert" className="flex w-full max-w-sm flex-col items-center text-center">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-muted/40">
            {isChunkError ? (
              <RefreshCw className="h-5 w-5 text-muted-foreground" aria-hidden />
            ) : (
              <AlertTriangle className="h-5 w-5 text-muted-foreground" aria-hidden />
            )}
          </div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {isChunkError ? "Há uma versão nova do Torque" : "Algo deu errado nesta tela"}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {isChunkError
              ? "Publicamos uma atualização. Recarregue para continuar de onde parou."
              : "Recarregue a página para tentar de novo. Se continuar, fale com o suporte e informe o código abaixo."}
          </p>
          {!isChunkError && reference && <ErrorReference reference={reference} className="mt-3" />}
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={this.handleGoHome}
              className="h-9 rounded-lg border border-border px-4 text-sm transition-colors hover:bg-muted"
            >
              Ir para o início
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Recarregar
            </button>
          </div>
        </div>
      </div>
    );
  }
}
