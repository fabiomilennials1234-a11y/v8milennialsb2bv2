/**
 * OverdueBanner — banner de aviso para orgs com pagamento em atraso.
 * Mostra dias de graça restantes.
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
          onClick={handleDismiss}
          className="text-amber-500 hover:text-amber-600 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
