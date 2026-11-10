import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import { useFeatureFlag } from "@/modules/platform";
import {
  FLAG_CADASTROS_DO_NUMERO,
  deveMostrarFaixa,
  useCadastrosNaConversa,
  type CadastroNaConversa,
} from "@/modules/communication/hooks/chat/useCadastrosNaConversa";

interface CadastrosDoNumeroFaixaProps {
  telefone: string | null | undefined;
  /** Lead que a conversa já tem (vínculo resolvido), ou nulo. */
  leadIdDaConversa: string | null | undefined;
  isGroup?: boolean;
}

/**
 * Faixa automática, sem clique (Café Jurerê, 10/11): o número que está falando
 * é de UM ou MAIS cadastros, e cada um com ou sem negócio aberto.
 *
 * Entre o cabeçalho e a thread, como o aviso da automação: quem abre a conversa
 * precisa saber com quem fala ANTES de responder. Só aparece quando há o que
 * dizer — número em 2+ cadastros, ou conversa sem lead com o número de alguém.
 */
export function CadastrosDoNumeroFaixa({ telefone, leadIdDaConversa, isGroup = false }: CadastrosDoNumeroFaixaProps) {
  const { enabled } = useFeatureFlag(FLAG_CADASTROS_DO_NUMERO);
  const { data: cadastros = [] } = useCadastrosNaConversa(telefone, enabled && !isGroup);

  if (!enabled) return null;
  if (!deveMostrarFaixa({ cadastros: cadastros.length, conversaTemLead: !!leadIdDaConversa, isGroup })) return null;

  return <FaixaCadastros cadastros={cadastros} leadIdDaConversa={leadIdDaConversa ?? null} />;
}

/** Só desenha — testável sem rede. */
export function FaixaCadastros({ cadastros, leadIdDaConversa }: { cadastros: CadastroNaConversa[]; leadIdDaConversa: string | null }) {
  const varios = cadastros.length >= 2;
  return (
    <div role="status" className="flex items-start gap-2 border-b border-insights/25 bg-insights/10 px-4 py-2">
      <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-insights" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] leading-snug text-muted-foreground">
          {varios ? (
            <>
              Este número está em <span className="font-semibold text-foreground">{cadastros.length} cadastros</span>
              {leadIdDaConversa ? "." : " — a conversa não está ligada a nenhum deles."}
            </>
          ) : (
            <>Este número é do cadastro abaixo, mas a conversa não está ligada a ele.</>
          )}
        </p>
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {cadastros.map((c) => {
            const aberto = c.negociosAbertos[0];
            const daConversa = c.id === leadIdDaConversa;
            return (
              <li key={c.id}>
                <Link
                  to={`/leads?lead=${c.id}`}
                  className="inline-flex max-w-[360px] items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="truncate font-semibold text-foreground">{c.name || "Sem nome"}</span>
                  {c.erp_code && <span className="shrink-0 tabular-nums text-muted-foreground">ERP {c.erp_code}</span>}
                  <span className="shrink-0 text-muted-foreground">·</span>
                  {aberto ? (
                    <span className="truncate text-success-strong">
                      {[aberto.pipeline_name, aberto.stage_name].filter(Boolean).join(" · ") || "Negócio aberto"}
                      {c.negociosAbertos.length > 1 ? ` +${c.negociosAbertos.length - 1}` : ""}
                    </span>
                  ) : (
                    <span className="shrink-0 text-muted-foreground">sem negócio aberto</span>
                  )}
                  {daConversa && (
                    <span className="shrink-0 rounded-full bg-insights/15 px-1.5 text-[10px] font-bold text-insights">nesta conversa</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
