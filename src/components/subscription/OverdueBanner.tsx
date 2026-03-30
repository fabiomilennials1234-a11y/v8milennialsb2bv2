/**
 * OverdueBanner — banner de aviso para orgs com pagamento em atraso.
 * Mostra dias de graça restantes.
 */

import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";

interface OverdueBannerProps {
  graceRemaining: number;
}

export function OverdueBanner({ graceRemaining }: OverdueBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            <strong>Pagamento em atraso.</strong>{" "}
            {graceRemaining > 0
              ? `Regularize em até ${graceRemaining} dia${graceRemaining !== 1 ? "s" : ""} para evitar a suspensão da conta.`
              : "Sua conta será suspensa em breve. Regularize o pagamento imediatamente."}
          </p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-500 hover:text-amber-600 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
