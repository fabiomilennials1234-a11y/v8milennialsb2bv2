/**
 * `AbrirConversaButton` — o ÚNICO caminho para "falar com este lead".
 *
 * Antes existiam 15 caminhos, cada card reimplementando o seu. Foi assim que a
 * prop `primaryInstanceId` ficou sem um único produtor em todo o repo, e assim
 * que um dos botões passou a lançar `ReferenceError` sem ninguém notar.
 *
 * Regra (decisão 1 da spec): com mais de uma caixa, PERGUNTA. Uma caixa só,
 * abre direto. A resposta óbvia não ganha atalho — caminho opcional apodrece.
 *
 * `leadId` é OBRIGATÓRIO. O inventário contra `main` mediu que todos os call
 * sites conseguem passá-lo; vários simplesmente não passavam. Sem lead, não
 * compila.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2 } from "lucide-react";
import { formatPhoneForWhatsApp } from "@/modules/communication/lib/whatsapp";
import { useConversasDoLead } from "@/modules/communication/hooks/chat/useConversasDoLead";
import { useWhatsAppInstancesForUser } from "@/modules/communication/hooks/chat/useWhatsAppInstances";
import { usePreferredInstance } from "@/modules/communication/hooks/usePreferredInstance";
import { decidirAberturaConversa } from "@/modules/communication/lib/decidirAberturaConversa";
import { SeletorConversaDoLead } from "@/modules/communication/components/chat/SeletorConversaDoLead";

export interface AbrirConversaButtonProps
  extends Pick<
    ButtonProps,
    "variant" | "size" | "className" | "title" | "aria-label" | "disabled"
  > {
  /** Obrigatório por decisão de contrato — ver docstring. */
  leadId: string;
  phone: string | null | undefined;
  /**
   * Texto que vira DRAFT no composer, nunca mensagem enviada (decisão 10).
   * Sugestão de IA que vira mensagem sem o vendedor reler é como sugestão
   * vira erro em cliente real.
   */
  draft?: string;
  children?: React.ReactNode;
  /** Impede que o clique borbulhe para o card por baixo do botão. */
  stopPropagation?: boolean;
}

export function AbrirConversaButton({
  leadId,
  phone,
  draft,
  children,
  stopPropagation = true,
  ...buttonProps
}: AbrirConversaButtonProps) {
  const navigate = useNavigate();
  const [aberto, setAberto] = useState(false);

  const telefone = formatPhoneForWhatsApp(phone ?? undefined);

  // Só busca quando o popover abre: em kanban com 90 cards, buscar por card no
  // mount seria uma consulta por linha.
  const { data: caixas = [], isLoading } = useConversasDoLead(aberto ? telefone : null);
  const { data: instancias = [] } = useWhatsAppInstancesForUser({ enabled: aberto });
  const { preferredInstanceId } = usePreferredInstance(instancias);

  const irParaConversa = useCallback(
    (instanceId: string) => {
      if (!telefone) return;
      const params = new URLSearchParams({ phone: telefone, instance: instanceId, lead: leadId });
      if (draft) params.set("draft", draft);
      setAberto(false);
      navigate(`/chat?${params.toString()}`);
    },
    [telefone, draft, leadId, navigate],
  );

  const decisao = decidirAberturaConversa({ caixas });

  // Caixa única: a lista chegou, não há o que perguntar — vai direto e o
  // popover nem chega a mostrar conteúdo. Sem este efeito, a decisão "abrir"
  // cairia no seletor e mostraria uma lista de um item só, contrariando a
  // decisão 1 da spec.
  useEffect(() => {
    if (!aberto) return;
    if (isLoading) return;
    if (decisao.acao !== "abrir") return;
    irParaConversa(decisao.instanceId);
  }, [aberto, isLoading, decisao, irParaConversa]);

  // Sem telefone não há conversa a abrir. O botão não aparece — melhor que
  // aparecer e não fazer nada.
  if (!telefone) return null;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          {...buttonProps}
          onClick={(e) => {
            if (stopPropagation) e.stopPropagation();
          }}
        >
          {children}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-0 p-0" onClick={(e) => e.stopPropagation()}>
        {isLoading && (
          <div className="flex w-[380px] items-center gap-2 rounded-xl border border-border bg-card px-3 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Procurando conversas deste lead…
          </div>
        )}
        {!isLoading && decisao.acao === "sem-caixa" && (
          <div className="w-[380px] rounded-xl border border-border bg-card px-3 py-4 text-sm text-muted-foreground">
            Nenhum número de WhatsApp disponível nesta organização.
          </div>
        )}
        {!isLoading && decisao.acao === "perguntar" && (
          <SeletorConversaDoLead
            caixas={caixas}
            instanceIdsComEscrita={instancias.map((i) => i.id)}
            preferredInstanceId={preferredInstanceId}
            onEscolher={irParaConversa}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
