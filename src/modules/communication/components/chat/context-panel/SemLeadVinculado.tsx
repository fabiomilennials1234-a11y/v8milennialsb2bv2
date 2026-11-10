/**
 * SemLeadVinculado — aba Infos do painel de contexto quando a conversa não tem lead.
 *
 * Dois estados:
 *   - número sem cadastro (ou com um só que a regra não achou): o diagnóstico de
 *     sempre + "Criar ou vincular lead";
 *   - número em 2+ cadastros (o mesmo cliente com PF, PJ, filiais — ERP Toth):
 *     a conversa fica sem lead porque nenhuma regra decide sozinha. Aqui o
 *     usuário decide: cada cadastro tem "Vincular esta conversa", que grava a
 *     escolha para o número e vincula as mensagens sem lead
 *     (`escolher_lead_do_numero`). As próximas mensagens seguem a escolha.
 */
import { useState } from "react";
import { Building2, Link2, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LeadContactModal } from "@/modules/communication/components/chat/LeadContactModal";
import {
  useCadastrosDoNumero,
  useVincularConversaAoLead,
  type CadastroDoNumero,
} from "@/modules/communication/hooks/useCadastrosDoNumero";
import { telefoneParaExibicao } from "@/modules/communication/lib/identificadorOculto";
import { notifyError } from "@/shared/errors";

export function SemLeadVinculado({ phoneNumber }: { phoneNumber: string }) {
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const { data } = useCadastrosDoNumero(phoneNumber);
  const cadastros = data?.cadastros ?? [];
  const telefone = telefoneParaExibicao(phoneNumber) ?? phoneNumber;

  return (
    <div className="flex flex-col gap-4 px-4 pb-5 pt-3">
      {cadastros.length >= 2 ? (
        <CadastrosDoNumero phoneNumber={phoneNumber} telefone={telefone} cadastros={cadastros} />
      ) : (
        <div className="pt-3 text-center">
          <p className="mb-1 text-xs text-muted-foreground">Nenhum lead vinculado a</p>
          <p className="text-sm font-medium tabular-nums">{telefone}</p>
        </div>
      )}

      {/*
        A AÇÃO, e não só o diagnóstico: mesmo componente que o resto do produto
        usa para criar e vincular por telefone (`LeadDetailContent`, dentro de
        `LeadContactModal`). Continua valendo com o número em vários cadastros —
        o cliente pode ser outro.
      */}
      <div className="flex justify-center">
        <Button
          variant={cadastros.length >= 2 ? "ghost" : "outline"}
          size="sm"
          className="h-9 text-xs"
          onClick={() => setLeadModalOpen(true)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Criar ou vincular lead
        </Button>
      </div>

      <LeadContactModal
        isOpen={leadModalOpen}
        onClose={() => setLeadModalOpen(false)}
        phoneNumber={phoneNumber}
      />
    </div>
  );
}

function CadastrosDoNumero({
  phoneNumber,
  telefone,
  cadastros,
}: {
  phoneNumber: string;
  telefone: string;
  cadastros: CadastroDoNumero[];
}) {
  const vincular = useVincularConversaAoLead(phoneNumber);
  const emAndamento = vincular.isPending ? vincular.variables : null;

  const escolher = (cadastro: CadastroDoNumero) =>
    vincular.mutate(cadastro.id, {
      onSuccess: (total) =>
        toast.success(`Conversa vinculada a ${cadastro.name}`, {
          description:
            total > 0
              ? `${total} ${total === 1 ? "mensagem vinculada" : "mensagens vinculadas"}. As próximas seguem este cadastro.`
              : "As próximas mensagens seguem este cadastro.",
        }),
      // A RPC recusa com frase em PT (cadastro sem o número) ou com código que o
      // catálogo traduz (access_denied → sem permissão). O fallback cobre o resto.
      onError: (err) => notifyError(err, { fallback: "Não foi possível vincular a conversa." }),
    });

  return (
    <section aria-labelledby="numero-em-varios-cadastros" className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
          Número compartilhado
        </span>
        <h3 id="numero-em-varios-cadastros" className="text-[15px] font-bold leading-snug tracking-[-0.01em]">
          Este número está em {cadastros.length} cadastros
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="tabular-nums text-foreground/80">{telefone}</span> pertence a mais de um cliente.
          Escolha de quem é esta conversa.
        </p>
      </header>

      <ul className="flex flex-col gap-2" role="list">
        {cadastros.map((c) => {
          const carregando = emAndamento === c.id;
          return (
            <li
              key={c.id}
              className="flex flex-col gap-3 rounded-xl border border-border/50 bg-muted/20 p-3 transition-colors hover:border-border hover:bg-muted/40"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
                    {c.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold leading-tight" title={c.name}>
                    {c.name}
                  </span>
                  {(c.company || c.erp_code) && (
                    <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                      {c.company && (
                        <span className="flex min-w-0 items-center gap-1">
                          <Building2 className="h-3 w-3 shrink-0" aria-hidden />
                          <span className="truncate">{c.company}</span>
                        </span>
                      )}
                      {c.erp_code && (
                        <span className="shrink-0 rounded-md bg-muted/70 px-1.5 py-px font-mono tabular-nums text-foreground/70">
                          ERP {c.erp_code}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="h-8 w-full gap-1.5 text-xs"
                disabled={vincular.isPending}
                onClick={() => escolher(c)}
                aria-label={`Vincular esta conversa a ${c.name}`}
              >
                {carregando ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Link2 className="h-3.5 w-3.5" aria-hidden />
                )}
                Vincular esta conversa
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
