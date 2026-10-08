/**
 * "Falando com" — o contato do telefone desta conversa (Chamado 82c50502).
 *
 * O cliente da Café Jurerê tem vários contatos ("José Luiz - Compras",
 * "Recepção"), cada um com o seu número. Aqui o vendedor vê com quem está
 * falando, nomeia o contato quando o número ainda não tem nome (o nome fica
 * travado: o ERP não mexe mais) e abre conversa com outro contato do mesmo
 * cliente — pelo `AbrirConversaButton`, que continua sendo o único caminho.
 */
import { useState } from "react";
import { Check, Loader2, MessageCircle, Pencil, X } from "lucide-react";
import { notifyError } from "@/shared/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLeadPhones, useNomearContatoDoTelefone, rotuloDoTelefone } from "@/modules/leads";
import { AbrirConversaButton } from "../AbrirConversaButton";
import { normalizarTelefoneBr } from "@/modules/communication/lib/normalizarTelefoneBr";

const ROTULO = "text-[10.5px] font-bold uppercase tracking-[.08em] text-muted-foreground";

export function FalandoCom({ leadId, telefone }: { leadId: string; telefone: string }) {
  const { data: telefones = [], isLoading } = useLeadPhones(leadId);
  const nomear = useNomearContatoDoTelefone(leadId);
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState("");

  const daConversa = normalizarTelefoneBr(telefone);
  const atual = telefones.find((t) => t.normalizedPhone === daConversa) ?? null;
  const outros = telefones.filter((t) => t.normalizedPhone !== daConversa);

  const abrir = () => {
    setRascunho(atual?.label ?? "");
    setEditando(true);
  };

  const salvar = async () => {
    try {
      await nomear.mutateAsync({ phone: telefone, label: rascunho });
      setEditando(false);
    } catch (e) {
      notifyError(e, { fallback: "Não foi possível nomear o contato." });
    }
  };

  return (
    <section className="mx-3 mt-3 flex flex-col gap-2 rounded-[14px] border border-border/60 bg-card px-3 py-2.5" data-testid="falando-com">
      <h3 className={ROTULO}>Falando com</h3>

      {isLoading ? (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Carregando contatos" />
      ) : editando ? (
        <div className="flex items-center gap-1.5">
          <Input
            autoFocus
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void salvar();
              if (e.key === "Escape") setEditando(false);
            }}
            placeholder="Nome do contato (ex.: José Luiz - Compras)"
            aria-label="Nome do contato"
            className="h-8 text-[12.5px]"
          />
          <Button size="icon" variant="ghost" className="size-8" onClick={salvar} disabled={nomear.isPending} aria-label="Salvar nome">
            {nomear.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
          </Button>
          <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditando(false)} aria-label="Cancelar">
            <X className="size-3.5" aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className={atual?.label ? "truncate text-[13px] font-bold" : "text-[13px] text-muted-foreground"}>
            {atual?.label ?? "Sem nome"}
          </span>
          <button
            type="button"
            onClick={abrir}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="falando-com-nomear"
          >
            <Pencil className="size-3" aria-hidden />
            {atual?.label ? "Renomear" : "Nomear contato"}
          </button>
        </div>
      )}

      {outros.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
          <span className={ROTULO}>Outros contatos do cliente</span>
          <ul className="flex flex-col">
            {outros.map((t) => (
              <li key={t.id}>
                <AbrirConversaButton
                  leadId={leadId}
                  phone={t.phone}
                  variant="ghost"
                  className="h-auto w-full justify-start gap-2 px-1.5 py-1 text-left text-[12.5px] font-normal"
                >
                  <MessageCircle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{rotuloDoTelefone(t)}</span>
                </AbrirConversaButton>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
