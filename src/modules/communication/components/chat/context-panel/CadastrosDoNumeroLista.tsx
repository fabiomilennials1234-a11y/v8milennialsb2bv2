import { Link } from "react-router-dom";
import { Link2, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CadastroNaConversa } from "@/modules/communication/hooks/chat/useCadastrosNaConversa";

interface Props {
  cadastros: CadastroNaConversa[];
  leadIdDaConversa: string | null;
  onVincular?: (cadastro: CadastroNaConversa) => void;
  vinculandoId?: string | null;
  /** O resumo recolhido já diz quantos são: a lista aberta dispensa o título. */
  semCabecalho?: boolean;
}

/** Lista vertical: rola com as informações do lead, nunca com as mensagens. */
export function CadastrosDoNumeroLista({
  cadastros,
  leadIdDaConversa,
  onVincular,
  vinculandoId,
  semCabecalho = false,
}: Props) {
  return (
    <section
      aria-label="Cadastros deste número"
      className="flex min-w-0 flex-col gap-3"
    >
      {!semCabecalho && (
      <header className="flex items-start gap-2">
        <Users className="mt-0.5 h-4 w-4 shrink-0 text-insights" aria-hidden />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            {cadastros.length > 1
              ? `Este número está em ${cadastros.length} cadastros`
              : "Cadastro deste número"}
          </h3>
          {!leadIdDaConversa && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              A conversa não está ligada a nenhum cadastro.
              {onVincular && " Escolha de quem é esta conversa."}
            </p>
          )}
        </div>
      </header>
      )}
      <ul className="flex min-w-0 flex-col gap-2">
        {cadastros.map((c) => {
          const aberto = c.negociosAbertos[0];
          const daConversa = c.id === leadIdDaConversa;
          return (
            <li
              key={c.id}
              className="min-w-0 rounded-xl border border-border/60 bg-muted/20 p-3"
            >
              <Link
                to={`/leads?lead=${c.id}`}
                className="flex min-w-0 flex-col gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="break-words text-sm font-semibold text-foreground hover:underline">
                  {c.name || "Sem nome"}
                </span>
                {c.company && (
                  <span className="break-words text-xs text-muted-foreground">
                    {c.company}
                  </span>
                )}
                <span className="flex flex-wrap items-center gap-2 text-[11px]">
                  {c.erp_code && (
                    <span className="tabular-nums text-muted-foreground">
                      ERP {c.erp_code}
                    </span>
                  )}
                  {daConversa && (
                    <span className="rounded-full bg-insights/15 px-2 py-0.5 font-semibold text-insights">
                      nesta conversa
                    </span>
                  )}
                </span>
              </Link>
              <p
                className={`mt-2 break-words text-xs ${aberto ? "text-success-strong" : "text-muted-foreground"}`}
              >
                {aberto
                  ? `${[aberto.pipeline_name, aberto.stage_name].filter(Boolean).join(" · ") || "Negócio aberto"}${c.negociosAbertos.length > 1 ? ` +${c.negociosAbertos.length - 1}` : ""}`
                  : "sem negócio aberto"}
              </p>
              {onVincular && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3 h-8 w-full gap-1.5 text-xs"
                  disabled={!!vinculandoId}
                  onClick={() => onVincular(c)}
                  aria-label={`Vincular esta conversa a ${c.name || "Sem nome"}`}
                >
                  {vinculandoId === c.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Vincular esta conversa
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
