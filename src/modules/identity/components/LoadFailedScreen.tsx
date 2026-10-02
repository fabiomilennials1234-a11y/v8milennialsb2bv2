import { useEffect, useMemo } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorReference, reportError, toAppError } from "@/shared/errors";

interface Props {
  /** A causa. `null` quando o estado é indeterminado (ex.: assinatura sem resposta). */
  error: unknown;
  /** Frase para quando a causa não diz nada legível. */
  fallback: string;
  title?: string;
  onRetry?: () => void;
  onSignOut?: () => void;
  /** Tag segura para o relatório: de onde a tela veio. */
  source: string;
}

/**
 * A tela para "não conseguimos carregar" — nunca um diagnóstico inventado.
 *
 * Até o ADR-0038, uma consulta de membro que falhava por rede virava "Aguardando
 * Ativação — sua conta está sendo configurada", e uma checagem de assinatura que
 * falhava virava "assinatura expirada" ou um 404. O cliente recebia uma mentira
 * sobre a própria conta. Esta tela diz o que se sabe (não carregou), mantém o
 * acesso fechado, oferece tentar de novo e deixa o código para o suporte.
 */
export function LoadFailedScreen({
  error,
  fallback,
  title = "Não conseguimos carregar sua conta",
  onRetry,
  onSignOut,
  source,
}: Props) {
  const appError = useMemo(() => toAppError(error, fallback), [error, fallback]);

  useEffect(() => {
    reportError(appError, { source });
  }, [appError, source]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div role="alert" className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-muted/40">
          <WifiOff className="h-5 w-5 text-muted-foreground" aria-hidden />
        </div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{appError.userMessage}</p>
        <ErrorReference reference={appError.reference} className="mt-3" />
        <div className="mt-6 flex gap-2">
          {onSignOut && (
            <Button variant="outline" onClick={onSignOut}>
              Sair
            </Button>
          )}
          <Button onClick={onRetry ?? (() => window.location.reload())}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
            Tentar de novo
          </Button>
        </div>
      </div>
    </div>
  );
}
