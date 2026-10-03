/**
 * OverdueBanner — aviso de cobrança em atraso, com o acesso AINDA de pé.
 *
 * É o degrau anterior ao bloqueio: quem vê isto continua trabalhando. Por isso
 * usa `--warning` ("precisa de atenção, prazo perto"), e não `--destructive`,
 * que é o hue de quem já está fora — ver SubscriptionBlockedPage. Antes os dois
 * estados pintavam de âmbar e ficavam indistinguíveis (#1507).
 *
 * O matiz MARCA (ícone, borda, fundo a 10%); o texto fala em `--foreground`.
 * `--warning` como cor de texto dá ~2,3:1 sobre o creme do tema claro e reprova
 * AA — a mesma colisão que o DESIGN.md §3 já resolveu para o ouro.
 */

import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";

interface OverdueBannerProps {
  graceRemaining: number;
}

const DISMISS_KEY = "overdue-banner-dismissed";

export function OverdueBanner({ graceRemaining }: OverdueBannerProps) {
  const today = new Date().toISOString().split("T")[0];
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISS_KEY) === today
  );

  if (dismissed) return null;

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, today);
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className="bg-warning/10 border-b border-warning/25 px-4 py-3"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* aria-hidden: o texto ao lado carrega o significado inteiro, então o
              ícone é reforço visual e não precisa passar em contraste de gráfico. */}
          <AlertTriangle className="w-5 h-5 text-warning shrink-0" aria-hidden="true" />
          <p className="text-sm text-foreground">
            <strong>Pagamento em atraso.</strong>{" "}
            {graceRemaining > 0
              ? `Regularize em até ${graceRemaining} dia${graceRemaining !== 1 ? "s" : ""} para o time não perder o acesso.`
              : "O prazo terminou. O acesso do time pode ser interrompido a qualquer momento — regularize hoje."}
          </p>
        </div>
        <button
          onClick={handleDismiss}
          aria-label="Fechar aviso de pagamento em atraso"
          /* -my-2 mantém a altura do banner enquanto o alvo de toque chega a 44px. */
          className="h-11 w-11 -my-2 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
