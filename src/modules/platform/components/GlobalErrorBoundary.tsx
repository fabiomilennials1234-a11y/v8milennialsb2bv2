import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { ErrorReference, reportError, toAppError } from "@/shared/errors";
import { browserEnv, isStaleChunkError, recoverFromStaleBuild } from "@/core/stale-build-recovery";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isChunkError: boolean;
  /** Código que o usuário copia para o suporte (ADR-0038). */
  reference: string | null;
  recovering?: boolean;
  recoveryFailed?: boolean;
}

const RENDER_FALLBACK = "Algo deu errado nesta tela.";

/**
 * ErrorBoundary global — captura erros de runtime e exibe
 * uma tela de fallback ao invés de tela branca.
 *
 * Erro de chunk (build velho após deploy) vai para a recuperação única de
 * `@/core/stale-build-recovery`.
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, isChunkError: false, reference: null };
  }

  static getDerivedStateFromError(error: Error): State {
    const isChunkError = isStaleChunkError(error);

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

    // Chunk velho: recuperação única (unregister SW + caches + reload, com
    // throttle). Dentro da janela ela não recarrega — a tela abaixo fica, e o
    // botão "Recarregar" força a mesma recuperação.
    if (this.state.isChunkError) void this.recover();
  }

  handleReload = () => {
    // Reload puro numa versão velha reentra no mesmo erro: o SW antigo serve o
    // mesmo index.html. O clique do usuário força a limpeza.
    if (this.state.isChunkError) void this.recover(true);
    else window.location.reload();
  };

  recover = async (force = false, goHome = false) => {
    if (this.state.recovering) return;
    this.setState({ recovering: true, recoveryFailed: false });
    try {
      const env = goHome ? { ...browserEnv(), reload: () => { window.location.href = "/"; } } : undefined;
      const reloading = await recoverFromStaleBuild(env, { force });
      if (!reloading) this.setState({ recovering: false, recoveryFailed: true });
    } catch {
      this.setState({ recovering: false, recoveryFailed: true });
    }
  };

  handleGoHome = () => {
    // The old worker can serve the same broken build at the root URL.
    if (this.state.isChunkError) void this.recover(true, true);
    else window.location.href = "/";
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
          {/* V5: chip tintado (âmbar no erro, ouro na versão nova) e título apertado. */}
          <div
            className={
              isChunkError
                ? "mb-5 grid h-11 w-11 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground"
                : "mb-5 grid h-11 w-11 place-items-center rounded-xl bg-warning/15 text-warning-strong"
            }
          >
            {isChunkError ? (
              <RefreshCw className="h-5 w-5" aria-hidden />
            ) : (
              <AlertTriangle className="h-5 w-5" aria-hidden />
            )}
          </div>
          <h2 className="text-xl font-extrabold tracking-[-0.02em] text-foreground">
            {isChunkError ? "Há uma versão nova do Torque" : "Algo deu errado nesta tela"}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {isChunkError
              ? "Publicamos uma atualização. Recarregue para continuar de onde parou."
              : "Recarregue a página para tentar de novo. Se continuar, fale com o suporte e informe o código abaixo."}
          </p>
          {isChunkError && this.state.recoveryFailed && (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              Não foi possível concluir a atualização. Confira sua conexão e tente recarregar novamente.
            </p>
          )}
          {!isChunkError && reference && <ErrorReference reference={reference} className="mt-3" />}
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={this.handleGoHome}
              disabled={this.state.recovering}
              className="h-10 rounded-full border border-input bg-card px-4 text-sm font-semibold shadow-relevo transition-colors hover:border-foreground/20"
            >
              Ir para o início
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              disabled={this.state.recovering}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-brilho-ouro transition-colors hover:bg-primary/90"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              {this.state.recovering ? "Atualizando…" : "Recarregar"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
