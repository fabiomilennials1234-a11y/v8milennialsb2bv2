import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Users } from "lucide-react";
import { useFeatureFlag } from "@/modules/platform";
import {
  FLAG_CADASTROS_DO_NUMERO,
  deveMostrarFaixa,
  useCadastrosNaConversa,
  type CadastroNaConversa,
} from "@/modules/communication/hooks/chat/useCadastrosNaConversa";

interface CadastrosDoNumeroProps {
  telefone: string | null | undefined;
  /** Lead que a conversa já tem (vínculo resolvido), ou nulo. */
  leadIdDaConversa: string | null | undefined;
  isGroup?: boolean;
}

/**
 * De quem é este número (Café Jurerê, 10/11): UM ou MAIS cadastros, cada um com
 * ou sem negócio aberto. Vive na coluna direita, entre o lead e o "Falando com".
 *
 * Recolhido, só diz quantos são — o número chama a atenção sem tomar a coluna.
 * A lista abre ao clicar. Só aparece quando há o que dizer: número em 2+
 * cadastros, ou conversa sem lead com o número de alguém.
 */
export function CadastrosDoNumero({ telefone, leadIdDaConversa, isGroup = false }: CadastrosDoNumeroProps) {
  const { enabled } = useFeatureFlag(FLAG_CADASTROS_DO_NUMERO);
  const { data: cadastros = [] } = useCadastrosNaConversa(telefone, enabled && !isGroup);

  if (!enabled) return null;
  if (!deveMostrarFaixa({ cadastros: cadastros.length, conversaTemLead: !!leadIdDaConversa, isGroup })) return null;

  return <BlocoCadastros cadastros={cadastros} leadIdDaConversa={leadIdDaConversa ?? null} />;
}

/** Só desenha — testável sem rede. */
export function BlocoCadastros({ cadastros, leadIdDaConversa }: { cadastros: CadastroNaConversa[]; leadIdDaConversa: string | null }) {
  const [aberto, setAberto] = useState(false);
  const varios = cadastros.length >= 2;
  const total = cadastros.length;

  return (
    <section className="mx-3 mt-3 rounded-[14px] border border-insights/25 bg-insights/10" data-testid="cadastros-do-numero">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 rounded-[14px] px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Users className="h-3.5 w-3.5 shrink-0 text-insights" aria-hidden />
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-muted-foreground">
          {varios ? (
            <>
              Este número está em <span className="font-semibold text-foreground">{total} cadastros</span>
            </>
          ) : (
            <>Este número é de 1 cadastro</>
          )}
          {!leadIdDaConversa && <span className="block text-[11px]">A conversa não está ligada a {varios ? "nenhum deles" : "ele"}.</span>}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {aberto && (
        <ul className="flex flex-col gap-1 border-t border-insights/20 p-2">
          {cadastros.map((c) => {
            const negocio = c.negociosAbertos[0];
            const daConversa = c.id === leadIdDaConversa;
            return (
              <li key={c.id}>
                <Link
                  to={`/leads?lead=${c.id}`}
                  className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{c.name || "Sem nome"}</span>
                    {daConversa && (
                      <span className="shrink-0 rounded-full bg-insights/15 px-1.5 text-[10px] font-bold text-insights">nesta conversa</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {c.erp_code && <span className="shrink-0 tabular-nums text-muted-foreground">ERP {c.erp_code}</span>}
                    {c.erp_code && <span className="shrink-0 text-muted-foreground">·</span>}
                    {negocio ? (
                      <span className="truncate text-success-strong">
                        {[negocio.pipeline_name, negocio.stage_name].filter(Boolean).join(" · ") || "Negócio aberto"}
                        {c.negociosAbertos.length > 1 ? ` +${c.negociosAbertos.length - 1}` : ""}
                      </span>
                    ) : (
                      <span className="shrink-0 text-muted-foreground">sem negócio aberto</span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
