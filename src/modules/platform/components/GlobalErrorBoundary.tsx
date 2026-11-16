import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { ErrorReference, reportError, toAppError } from "@/shared/errors";
import {
  failedAssetPath,
  isStaleChunkError,
  recoveredRecently,
  recoverFromStaleBuild,
} from "@/core/stale-build-recovery";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isChunkError: boolean;
  /**
   * Chunk que falha de novo logo depois de uma recuperação: o cache já foi
   * limpo, então "publicamos uma atualização" seria mentira. É defeito real
   * (rede, extensão, antivírus, arquivo ausente) e precisa chegar até nós.
   */
  persistentChunkError: boolean;
  /** Código que o usuário copia para o suporte (ADR-0038). */
  reference: string | null;
  /** Recuperação de build velho disparada pelo botão, ainda em andamento. */
  recovering: boolean;
  /** A recuperação não rodou (servidor inacessível): o clique não pode ficar mudo. */
  recoveryFailed: boolean;
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
    this.state = {
      hasError: false,
      error: null,
      isChunkError: false,
      persistentChunkError: false,
      reference: null,
      recovering: false,
      recoveryFailed: false,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    const isChunkError = isStaleChunkError(error);
    const persistentChunkError = isChunkError && recoveredRecently();
    // O erro original não diz ao suporte nada além do que o Sentry ignora por
    // regra; o embrulho leva o arquivo que não carregou e foge do filtro.
    const reported = persistentChunkError
      ? new Error(`Chunk do build não carrega mesmo após recuperação: ${failedAssetPath(error) ?? "arquivo desconhecido"}`)
      : error;

    // A referência nasce aqui para já estar na primeira renderização da tela de
    // erro; `componentDidCatch` relata o mesmo objeto e recebe o mesmo código.
    return {
      hasError: true,
      error: reported,
      isChunkError,
      persistentChunkError,
      reference: toAppError(reported, RENDER_FALLBACK).reference,
      recovering: false,
      recoveryFailed: false,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[GlobalErrorBoundary]", error, errorInfo);

    // Chunk velho é deploy novo, não defeito — o reload abaixo resolve. Se ele
    // persiste depois da recuperação, deixa de ser deploy: relata.
    const { isChunkError, persistentChunkError } = this.state;
    if (!isChunkError) {
      reportError(toAppError(error, RENDER_FALLBACK), { source: "render" });
    } else if (persistentChunkError) {
      reportError(toAppError(this.state.error, RENDER_FALLBACK), { source: "render", kind: "chunk-persistente" });
    }

    // Chunk velho: recuperação única (unregister SW + caches + reload, com
    // throttle). Dentro da janela ela não recarrega — a tela abaixo fica, e o
    // botão "Recarregar" força a mesma recuperação.
    if (isChunkError) void recoverFromStaleBuild();
  }

  handleReload = async () => {
    if (!this.state.isChunkError) {
      window.location.reload();
      return;
    }
    if (this.state.recovering) return;
    // Reload puro numa versão velha reentra no mesmo erro: o SW antigo serve o
    // mesmo index.html. O clique do usuário força a limpeza. `false` = a origem
    // não respondeu e o cache foi mantido de propósito; sem avisar, o botão
    // parecia quebrado.
    this.setState({ recovering: true, recoveryFailed: false });
    const recovered = await recoverFromStaleBuild(undefined, { force: true });
    if (!recovered) this.setState({ recovering: false, recoveryFailed: true });
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const { isChunkError, persistentChunkError, reference, recovering, recoveryFailed } = this.state;

    // Sem o texto do erro na tela: "Cannot read properties of undefined" não diz
    // nada ao cliente e diz demais a qualquer um. O código leva o suporte à
    // causa (ADR-0038).
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div role="alert" className="flex w-full max-w-sm flex-col items-center text-center">
          {/* V5: chip tintado (âmbar no erro, ouro na versão nova) e título apertado. */}
          <div
            className={
              isChunkError && !persistentChunkError
                ? "mb-5 grid h-11 w-11 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground"
                : "mb-5 grid h-11 w-11 place-items-center rounded-xl bg-warning/15 text-warning-strong"
            }
          >
            {isChunkError && !persistentChunkError ? (
              <RefreshCw className="h-5 w-5" aria-hidden />
            ) : (
              <AlertTriangle className="h-5 w-5" aria-hidden />
            )}
          </div>
          <h2 className="text-xl font-extrabold tracking-[-0.02em] text-foreground">
            {persistentChunkError
              ? "Não conseguimos carregar o Torque"
              : isChunkError
                ? "Há uma versão nova do Torque"
                : "Algo deu errado nesta tela"}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {persistentChunkError
              ? "Atualizamos o Torque neste navegador e uma parte do sistema continua sem carregar. Costuma ser extensão de bloqueio, antivírus ou a rede da empresa. Tente em uma janela anônima ou em outra rede e, se continuar, envie o código abaixo ao suporte."
              : isChunkError
              ? "Publicamos uma atualização. Recarregue para continuar de onde parou."
              : "Recarregue a página para tentar de novo. Se continuar, fale com o suporte e informe o código abaixo."}
          </p>
          {(!isChunkError || persistentChunkError) && reference && <ErrorReference reference={reference} className="mt-3" />}
          {isChunkError && recoveryFailed && (
            <p role="status" className="mt-3 text-sm leading-relaxed text-foreground">
              Não conseguimos falar com o servidor. Confira sua conexão e tente de novo. Se continuar,
              abra o Torque em uma janela anônima ou limpe os dados do site no navegador.
            </p>
          )}
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={this.handleGoHome}
              className="h-10 rounded-full border border-input bg-card px-4 text-sm font-semibold shadow-relevo transition-colors hover:border-foreground/20"
            >
              Ir para o início
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              disabled={recovering}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-brilho-ouro transition-colors hover:bg-primary/90"
            >
              <RefreshCw className={recovering ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden />
              {recovering ? "Recarregando…" : recoveryFailed ? "Tentar de novo" : "Recarregar"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
