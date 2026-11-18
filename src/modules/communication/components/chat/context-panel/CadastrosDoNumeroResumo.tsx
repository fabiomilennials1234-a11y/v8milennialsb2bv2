import { useState } from "react";
import { ChevronDown, Users } from "lucide-react";
import { useFeatureFlag } from "@/modules/platform/feature-flags";
import {
  FLAG_CADASTROS_DO_NUMERO,
  deveMostrarCadastros,
  useCadastrosNaConversa,
  type CadastroNaConversa,
} from "@/modules/communication/hooks/chat/useCadastrosNaConversa";
import { CadastrosDoNumeroLista } from "./CadastrosDoNumeroLista";

interface Props {
  telefone: string | null | undefined;
  leadIdDaConversa: string;
  isGroup?: boolean;
}

/**
 * Conversa COM lead e número em 2+ cadastros: só a contagem, recolhida, entre o
 * card do lead e o "Falando com". A lista abre ao clicar. Mesma flag e mesma
 * regra de exibição da lista (`chat_cadastros_do_numero`).
 */
export function CadastrosDoNumeroResumo({ telefone, leadIdDaConversa, isGroup = false }: Props) {
  const { enabled } = useFeatureFlag(FLAG_CADASTROS_DO_NUMERO);
  const { data: cadastros = [] } = useCadastrosNaConversa(telefone, enabled && !isGroup);

  if (!enabled) return null;
  if (!deveMostrarCadastros({ cadastros: cadastros.length, conversaTemLead: true, isGroup })) return null;

  return <ResumoCadastros key={telefone} cadastros={cadastros} leadIdDaConversa={leadIdDaConversa} />;
}

/** Só desenha — testável sem rede. */
export function ResumoCadastros({ cadastros, leadIdDaConversa }: { cadastros: CadastroNaConversa[]; leadIdDaConversa: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <section className="mx-3 mt-3 rounded-[14px] border border-card-border bg-card" data-testid="cadastros-do-numero">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 rounded-[14px] px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Users className="h-3.5 w-3.5 shrink-0 text-insights" aria-hidden />
        <span className="min-w-0 flex-1 text-[12px] text-muted-foreground">
          Este número está em <span className="font-semibold text-foreground">{cadastros.length} cadastros</span>
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {aberto && (
        <div className="border-t border-border/60 p-3">
          <CadastrosDoNumeroLista cadastros={cadastros} leadIdDaConversa={leadIdDaConversa} semCabecalho />
        </div>
      )}
    </section>
  );
}
