/**
 * Cartão do nó legado `action` + `send_whatsapp_menu`.
 *
 * O nó continua executando pelo handler antigo enquanto ninguém converte; aqui
 * o conteúdo aparece só em leitura e a única ação é a conversão explícita para
 * pergunta com botões (`convertLegacyMenuNode`). Sem upgrade silencioso: a
 * conversão remove a saída antiga, então quem decide é o usuário.
 */
import { MessageSquareText, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionNodeData } from "@/types/workflow";
import { MAX_QUESTION_BUTTONS, normalizeMenuChoiceLabels } from "@/modules/workflows/lib/convertLegacyMenuNode";

export function LegacyMenuCard({ data, onConvert }: { data: ActionNodeData; onConvert?: () => void }) {
  const text = data.menuText?.trim() ? data.menuText : data.messageTemplate ?? "";
  // Mesma regra da conversão: o que aparece riscado é exatamente o que ela descarta.
  const { labels: choices, dropped } = normalizeMenuChoiceLabels(data.menuChoices);
  const overLimit = dropped.length > 0;

  return (
    <section
      aria-labelledby="legacy-menu-title"
      className="space-y-3 rounded-xl border border-border bg-muted/30 p-3.5"
    >
      <div className="flex items-start gap-2.5">
        <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-1">
          <h3 id="legacy-menu-title" className="text-sm font-semibold tracking-[-0.01em]">Menu no formato antigo</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Continua enviando como antes. Converta para editar a mensagem, os botões e as saídas de cada resposta.
          </p>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-card p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mensagem</p>
        <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">
          {text || <span className="italic text-muted-foreground">Sem texto</span>}
        </p>
        <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Opções</p>
        {choices.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Opções do menu">
            {choices.map((label, index) => (
              <li
                key={`${index}-${label}`}
                className={
                  index < MAX_QUESTION_BUTTONS
                    ? "rounded-full border border-border bg-background px-2.5 py-0.5 text-xs"
                    : "rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground line-through"
                }
              >
                {label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm italic text-muted-foreground">Sem opções</p>
        )}
      </div>

      {overLimit && (
        <p className="text-xs text-warning-strong">
          O WhatsApp aceita até {MAX_QUESTION_BUTTONS} botões: só as {MAX_QUESTION_BUTTONS} primeiras opções serão mantidas.
        </p>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Ao converter, a conexão de saída atual é removida — você religa cada resposta. Dá para desfazer.
      </p>
      {onConvert && (
        <Button type="button" className="w-full" onClick={onConvert}>
          <ArrowRightLeft className="mr-2 h-4 w-4" aria-hidden />
          Converter em pergunta com botões
        </Button>
      )}
    </section>
  );
}
