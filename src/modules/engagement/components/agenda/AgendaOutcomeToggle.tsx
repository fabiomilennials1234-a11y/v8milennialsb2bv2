/**
 * Registrar o resultado de um compromisso: compareceu ou não compareceu.
 *
 * Um par de botões, e não um switch: switch tem dois estados e aqui existem
 * TRÊS — compareceu, não compareceu e **ainda não registrado**, que é o estado
 * em que a maioria vive e o único que não pode ser confundido com os outros
 * dois. Clicar no que já está marcado desmarca, e é assim que se volta para
 * "sem registro" depois de errar.
 *
 * Cor não é o único sinal (DESIGN.md): cada botão traz ícone e rótulo, e o
 * selecionado ganha superfície cheia — funciona em preto e branco e para quem
 * não distingue verde de vermelho.
 */

import { Check, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AttendanceOutcome } from "./agenda-helpers";

interface AgendaOutcomeToggleProps {
  /** `null` quando ainda não há resultado registrado. */
  value: AttendanceOutcome | null;
  /** Recebe `null` quando a pessoa desmarca o que estava selecionado. */
  onChange: (proximo: AttendanceOutcome | null) => void;
  saving?: boolean;
  disabled?: boolean;
}

/**
 * ⚠️ NÃO trocar por `text-success` / `text-destructive`.
 *
 * Parece o certo — são os tokens semânticos, e o DESIGN.md manda usar token.
 * Mas esses tokens são valor de PREENCHIMENTO, não de texto. Medido sobre a
 * própria pílula tingida (banho de 15% sobre `--card`), no tema claro:
 *
 *   text-success      2,00:1   ✗
 *   text-destructive  3,05:1   ✗
 *   text-emerald-800  6,63:1   ✓
 *   text-red-800      6,70:1   ✓
 *
 * No escuro os pares `-200` dão 11,2:1 e 11,4:1. É a mesma armadilha já
 * documentada em `--warning` (`index.css`), e o par `x dark:y` de escala é o
 * idioma que a #1792 fixou em `SessionDeadBanner` justamente para corrigi-la.
 *
 * V5 (2026-10): banho e borda viraram token (`success`/`destructive` — é
 * preenchimento, o papel deles); o TEXTO continua no par de escala. O V5
 * resolveu isso para o âmbar com `warning-strong`,
 * mas ainda não tem o equivalente para verde e vermelho — quando existir um
 * `success-strong`/`destructive-strong`, é ele que entra aqui.
 */
const OPCOES: Array<{
  key: AttendanceOutcome;
  label: string;
  Icon: typeof Check;
  selecionado: string;
}> = [
  {
    key: "compareceu",
    label: "Compareceu",
    Icon: Check,
    selecionado:
      "border-success/40 bg-success/15 text-emerald-800 dark:text-emerald-200",
  },
  {
    key: "nao_compareceu",
    label: "Não compareceu",
    Icon: X,
    selecionado:
      "border-destructive/40 bg-destructive/15 text-red-800 dark:text-red-200",
  },
];

export function AgendaOutcomeToggle({
  value,
  onChange,
  saving = false,
  disabled = false,
}: AgendaOutcomeToggleProps) {
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-center gap-1.5">
        <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
          Resultado
        </p>
        {saving && (
          <Loader2
            className="h-3 w-3 animate-spin text-muted-foreground"
            aria-label="Salvando"
          />
        )}
      </div>

      <div role="group" aria-label="Resultado do compromisso" className="flex gap-2">
        {OPCOES.map(({ key, label, Icon, selecionado }) => {
          const ativo = value === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={ativo}
              disabled={disabled || saving}
              // Clicar no que já está marcado desmarca — é o caminho de volta
              // para "sem registro" quando alguém marca errado.
              onClick={() => onChange(ativo ? null : key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-full border py-1.5 text-[11px] font-semibold transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                "disabled:cursor-not-allowed disabled:opacity-50",
                ativo
                  ? selecionado
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-3 w-3 shrink-0" strokeWidth={ativo ? 3 : 2} />
              {label}
            </button>
          );
        })}
      </div>

      {value === null && (
        <p className="text-[11px] text-muted-foreground">
          Sem registro — não entra na contagem.
        </p>
      )}
    </div>
  );
}
