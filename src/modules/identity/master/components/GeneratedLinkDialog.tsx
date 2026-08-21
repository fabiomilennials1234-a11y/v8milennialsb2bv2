/**
 * GeneratedLinkDialog — a única vez que o link existe em texto.
 *
 * A tabela guarda o SHA-256 do token, nunca o texto: dump de banco não entrega
 * link vivo, e nem o próprio Master consegue recuperá-lo depois. Por isso este
 * diálogo não é confirmação de sucesso — é a ENTREGA. Fechar sem copiar custa
 * uma proposta nova e a revogação da anterior, e o texto diz isso em vez de
 * deixar a pessoa descobrir sozinha.
 *
 * O link NÃO é pré-selecionado num campo editável por acidente: campo editável
 * convida a corrigir o que não pode ser corrigido. É leitura, com um botão que
 * copia.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

interface GeneratedLinkDialogProps {
  /** O token em texto. `null` fecha o diálogo. */
  token: string | null;
  buyerPrefilled: boolean;
  onClose: () => void;
}

function checkoutUrl(token: string): string {
  return `${window.location.origin}/checkout/${token}`;
}

export function GeneratedLinkDialog({ token, buyerPrefilled, onClose }: GeneratedLinkDialogProps) {
  const [copied, setCopied] = useState(false);

  /**
   * O RESET SEGUE O TOKEN, não o caminho de fechamento — e essa distinção é o
   * bloqueante que o Sentinela achou.
   *
   * `onOpenChange` do Radix só dispara em dismissal iniciado DENTRO do
   * componente: ESC e clique fora. O botão "Fechar" chama `onClose()` no pai,
   * que zera o token, e o `open` vira false pela PROP — sem passar por
   * `onOpenChange`. Resetar lá cobria dois dos três caminhos.
   *
   * O que ficava para trás era o pior estado possível nesta tela: a proposta
   * SEGUINTE abria com o botão dizendo "Copiado", o check verde, e o aviso de
   * "se fechar sem copiar" SUPRIMIDO — porque ele é condicionado a `!copied`.
   * A tela afirmava sucesso de cópia para um link que ninguém copiou, e
   * escondia justamente o aviso que existe para impedir isso.
   *
   * Derivar do `token` cobre os três caminhos e não depende de alguém lembrar
   * de resetar em cada um que aparecer depois.
   */
  useEffect(() => {
    setCopied(false);
  }, [token]);

  async function copy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(checkoutUrl(token));
      setCopied(true);
      toast.success("Link copiado.");
    } catch {
      // Clipboard bloqueado (permissão, contexto inseguro) não pode virar
      // silêncio: quem não souber que falhou fecha o diálogo com nada na área
      // de transferência e perde o link.
      toast.error("Não consegui copiar. Selecione o texto e copie na mão antes de fechar.");
    }
  }

  return (
    <Dialog
      open={!!token}
      onOpenChange={(open) => {
        // ESC e clique fora chegam por aqui; o botão "Fechar" chama `onClose`
        // direto. Os dois caminhos convergem no mesmo lugar, e o reset do
        // `copied` não mora em nenhum dos dois — mora no efeito do token.
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Proposta gerada</DialogTitle>
          <DialogDescription>
            Este link aparece uma única vez. O banco guarda só o hash — ninguém, nem você,
            consegue recuperá-lo depois.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-sm font-mono break-all select-all">
            {token ? checkoutUrl(token) : ""}
          </p>
        </div>

        {buyerPrefilled && (
          <p className="text-xs text-muted-foreground">
            O comprador foi pré-preenchido. O cliente pode corrigir os dados no checkout — é a
            mesma linha, não uma segunda via.
          </p>
        )}

        {!copied && (
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-px text-warning" />
            <span>Se fechar sem copiar, a saída é gerar outra proposta e revogar esta.</span>
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={copy}>
            {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
            {copied ? "Copiado" : "Copiar link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
