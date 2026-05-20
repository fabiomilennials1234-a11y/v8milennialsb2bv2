import { Component, type ErrorInfo, type ReactNode } from "react";
import * as Sentry from "@sentry/react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isChunkError: boolean;
}

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
    this.state = { hasError: false, error: null, isChunkError: false };
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

    return { hasError: true, error, isChunkError };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[GlobalErrorBoundary]", error, errorInfo);

    if (!this.state.isChunkError) {
      Sentry.captureException(error, {
        extra: { componentStack: errorInfo.componentStack },
      });
    }

    // Auto-reload uma vez para erros de chunk (deploy novo invalidou cache)
    if (this.state.isChunkError) {
      const reloadKey = "chunk_error_reload";
      const lastReload = sessionStorage.getItem(reloadKey);
      const now = Date.now();

      // Só faz reload automático se não fez nos últimos 10s
      if (!lastReload || now - Number(lastReload) > 10_000) {
        sessionStorage.setItem(reloadKey, String(now));
        window.location.reload();
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
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="flex flex-col items-center gap-4 max-w-md text-center">
            <AlertTriangle className="h-12 w-12 text-yellow-500" />
            <h2 className="text-xl font-semibold">
              {this.state.isChunkError
                ? "Atualização Detectada"
                : "Algo deu errado"}
            </h2>
            <p className="text-muted-foreground">
              {this.state.isChunkError
                ? "Uma nova versão do sistema foi publicada. Recarregue a página para continuar."
                : "Ocorreu um erro inesperado. Tente recarregar a página."}
            </p>
            {this.state.error && !this.state.isChunkError && (
              <pre className="text-xs text-left bg-muted p-3 rounded-lg max-w-full overflow-auto max-h-32">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-3">
              <button
                onClick={this.handleGoHome}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
              >
                Ir para o início
              </button>
              <button
                onClick={this.handleReload}
                className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Recarregar
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
