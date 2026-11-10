import { useState } from "react";
import { Link2, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/shared/hooks/useDebounce";
import { formatPhoneBR } from "@/shared/format/phone";
import { useBuscaLeadsParaVincular, type LeadParaVincular } from "../../../hooks/useBuscaLeadsParaVincular";

interface VincularClienteExistenteProps {
  /** Número da conversa (como o chat o tem). */
  phoneNumber: string;
  onVincular: (lead: LeadParaVincular) => void;
  vinculandoId?: string | null;
}

/**
 * "Já é cliente?" — liga a conversa a um cadastro que já existe, em vez de
 * criar um lead novo (Café Jurerê, 10/11). O cliente do ERP que escreve de um
 * número fora do cadastro ficava com a conversa solta: a ficha só oferecia
 * criar, e criar fazia um duplicado do cliente.
 *
 * Só desenha e busca; quem vincula é o host (mutation + refetch da ficha).
 */
export function VincularClienteExistente({ phoneNumber, onVincular, vinculandoId = null }: VincularClienteExistenteProps) {
  const [busca, setBusca] = useState("");
  const termo = useDebounce(busca, 250);
  const resultados = useBuscaLeadsParaVincular(termo);
  const ocupado = !!vinculandoId;

  return (
    <>
    <section aria-labelledby="vincular-cliente-titulo" className="mx-6 mt-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary-soft-foreground">
          <Link2 aria-hidden className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 id="vincular-cliente-titulo" className="text-[14px] font-bold">Já é cliente?</h3>
          <p className="text-[12px] text-muted-foreground">
            Vincule esta conversa ao cadastro que já existe. O número {formatPhoneBR(phoneNumber)} passa a ser um
            telefone dele, e as próximas mensagens chegam no cliente.
          </p>
        </div>
      </div>

      <div className="relative mt-3">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Nome, empresa, código do ERP ou telefone"
          aria-label="Buscar cliente para vincular"
          className="pl-9"
          autoComplete="off"
        />
      </div>

      {termo.trim().length >= 2 && (
        <ul aria-label="Clientes encontrados" className="mt-2 max-h-[240px] overflow-y-auto rounded-xl border border-border">
          {resultados.isLoading ? (
            <li className="flex items-center justify-center gap-2 px-3 py-5 text-[12px] text-muted-foreground">
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Procurando…
            </li>
          ) : resultados.isError ? (
            <li className="px-3 py-5 text-center text-[12px] text-destructive-strong">Não deu para buscar. Tente de novo.</li>
          ) : (resultados.data ?? []).length === 0 ? (
            <li className="px-3 py-5 text-center text-[12px] text-muted-foreground">Nenhum cliente com “{termo.trim()}”.</li>
          ) : (
            (resultados.data ?? []).map((c) => (
              <li key={c.id} className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{c.name || "Sem nome"}</span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {[c.erp_code ? `ERP ${c.erp_code}` : null, c.company, c.phone ? formatPhoneBR(c.phone) : null]
                      .filter(Boolean)
                      .join(" · ") || "Sem dados"}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={ocupado}
                  onClick={() => onVincular(c)}
                  aria-label={`Vincular a ${c.name || "este cliente"}`}
                >
                  {vinculandoId === c.id && <Loader2 aria-hidden className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Vincular
                </Button>
              </li>
            ))
          )}
        </ul>
      )}

    </section>
    <p className="mx-6 mt-4 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
      <span aria-hidden className="h-px flex-1 bg-border" />
      ou crie um lead novo
      <span aria-hidden className="h-px flex-1 bg-border" />
    </p>
    </>
  );
}
