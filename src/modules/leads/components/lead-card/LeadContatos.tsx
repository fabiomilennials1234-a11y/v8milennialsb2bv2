import { useMemo, useState } from "react";
import { Loader2, MessageCircle, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { reportError, toAppError } from "@/shared/errors";
import { ErrorReference } from "@/shared/errors/ErrorReference";
import { formatPhoneBR } from "@/shared/format/phone";
import { useLeadPhones, useSalvarTelefonesDoLead, type TelefoneEditado } from "../../hooks/useLeadPhones";
import { agruparPorContato } from "../../lib/lead-phones";

/**
 * Contatos do lead — o campo Telefone virou lista (Chamado 82c50502).
 *
 * No ERP o cliente tem a aba "Contatos": "José Luiz - Compras" com fixo e
 * celular. Aqui é a mesma coisa: telefones agrupados pelo nome do contato, um
 * deles o principal (é o `leads.phone`, o que disparo, Copilot e workflow usam).
 *
 * Nome editado aqui fica TRAVADO: a sincronização do ERP não mexe mais nele.
 * Telefone apagado aqui não volta pela sincronização.
 *
 * Mora fora de `LeadCard.tsx` de propósito: o card é alcançável a partir do
 * `/preview.html` e não pode tocar o banco. Quem tem o banco
 * (`LeadCardContainer`) monta este bloco e entrega pronto.
 */
const ROTULO = "text-[10.5px] font-bold uppercase tracking-[.08em] text-muted-foreground";

interface Rascunho extends TelefoneEditado {
  /** Chave estável da linha no editor (id do banco ou gerada). */
  chave: string;
}

let sequencia = 0;
const novaChave = () => `novo-${++sequencia}`;

export function LeadContatos({ leadId, podeEditar = true }: { leadId: string; podeEditar?: boolean }) {
  const { data: telefones = [], isLoading } = useLeadPhones(leadId);
  const salvar = useSalvarTelefonesDoLead(leadId);
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState<Rascunho[]>([]);
  // `referencia` só quando o erro é inesperado: recusa conhecida já diz o que fazer.
  const [erro, setErro] = useState<{ mensagem: string; referencia: string | null } | null>(null);

  const grupos = useMemo(() => agruparPorContato(telefones), [telefones]);

  const abrirEdicao = () => {
    setErro(null);
    setRascunho(
      telefones.map((t) => ({ chave: t.id, id: t.id, phone: t.phone, label: t.label, isPrimary: t.isPrimary })),
    );
    setEditando(true);
  };

  const atualizar = (chave: string, patch: Partial<Rascunho>) =>
    setRascunho((linhas) =>
      linhas.map((l) => {
        if (patch.isPrimary && l.chave !== chave) return { ...l, isPrimary: false };
        return l.chave === chave ? { ...l, ...patch } : l;
      }),
    );

  const adicionar = () =>
    setRascunho((linhas) => [
      ...linhas,
      { chave: novaChave(), phone: "", label: "", isPrimary: linhas.length === 0 },
    ]);

  const remover = (chave: string) =>
    setRascunho((linhas) => {
      const restantes = linhas.filter((l) => l.chave !== chave);
      // Apagar o principal: o próximo vira principal, para a lista não ficar sem.
      if (restantes.length > 0 && !restantes.some((l) => l.isPrimary)) {
        restantes[0] = { ...restantes[0], isPrimary: true };
      }
      return restantes;
    });

  const gravar = async () => {
    setErro(null);
    try {
      await salvar.mutateAsync(rascunho.filter((l) => l.phone.trim() || l.id));
      setEditando(false);
      toast.success("Contatos salvos");
    } catch (e) {
      const appError = toAppError(e, "Não foi possível salvar os telefones.");
      reportError(appError, { source: "handled", where: "lead-contatos" });
      setErro({
        mensagem: appError.userMessage,
        referencia: appError.reportable ? appError.reference : null,
      });
    }
  };

  return (
    <section className="flex flex-col gap-2" data-testid="lead-contatos">
      <div className="flex items-center justify-between gap-2">
        <h3 className={ROTULO}>Contatos</h3>
        {podeEditar && !editando && (
          <button
            type="button"
            onClick={abrirEdicao}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="lead-contatos-editar"
          >
            <Pencil className="size-3" aria-hidden />
            Editar
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Carregando telefones…
        </p>
      ) : !editando ? (
        grupos.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">Sem telefone</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {grupos.map((g) => (
              <li key={g.nome ?? "__sem_nome"} className="flex flex-col gap-1">
                <span className={cn("truncate text-[13px]", g.nome ? "font-bold text-foreground" : "text-muted-foreground")}>
                  {g.nome ?? "Sem nome"}
                </span>
                <ul className="flex flex-col gap-0.5">
                  {g.telefones.map((t) => (
                    <li key={t.id} className="flex items-center gap-1.5 text-[12.5px] tabular-nums text-foreground/85">
                      <span>{formatPhoneBR(t.phone)}</span>
                      {t.isWhatsApp && <MessageCircle className="size-3 text-muted-foreground" aria-label="WhatsApp" />}
                      {t.isPrimary && (
                        <span className="rounded-full bg-muted px-1.5 py-px text-[10.5px] font-semibold text-muted-foreground">
                          Principal
                        </span>
                      )}
                      {t.source === "erp" && (
                        <span className="text-[10.5px] text-muted-foreground/70" title="Veio do ERP. Editar aqui não altera o Toth.">
                          ERP
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="flex flex-col gap-2" data-testid="lead-contatos-editor">
          {rascunho.map((l) => (
            <div key={l.chave} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-1.5">
              <Input
                value={l.label ?? ""}
                onChange={(e) => atualizar(l.chave, { label: e.target.value })}
                placeholder="Nome do contato"
                aria-label="Nome do contato"
                className="h-8 text-[12.5px]"
              />
              <Input
                value={l.phone}
                onChange={(e) => atualizar(l.chave, { phone: e.target.value })}
                placeholder="(00) 00000-0000"
                aria-label="Telefone"
                inputMode="tel"
                type="tel"
                className="h-8 text-[12.5px] tabular-nums"
              />
              <button
                type="button"
                role="radio"
                aria-checked={l.isPrimary}
                aria-label="Telefone principal"
                title="Principal: o número que disparo, Copilot e automações usam"
                onClick={() => atualizar(l.chave, { isPrimary: true })}
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  l.isPrimary ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                <Star className={cn("size-3.5", l.isPrimary && "fill-current")} aria-hidden />
              </button>
              <button
                type="button"
                aria-label="Remover telefone"
                onClick={() => remover(l.chave)}
                className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={adicionar}
            className="inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-3.5" aria-hidden />
            Adicionar telefone
          </button>
          {erro && (
            <div role="alert" className="flex flex-col">
              <p className="text-[12px] text-destructive">{erro.mensagem}</p>
              {erro.referencia && <ErrorReference reference={erro.referencia} />}
            </div>
          )}
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setEditando(false)} disabled={salvar.isPending}>
              Cancelar
            </Button>
            <Button size="sm" onClick={gravar} disabled={salvar.isPending} data-testid="lead-contatos-salvar">
              {salvar.isPending && <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />}
              Salvar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
