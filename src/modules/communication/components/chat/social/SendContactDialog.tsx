/**
 * SendContactDialog — mandar um cartão de contato.
 *
 * O caso real é passar o cliente para outro vendedor, ou mandar o contato do
 * técnico que vai à obra. Hoje o vendedor digita o telefone no texto, e o
 * cliente copia à mão; o cartão nativo entra na agenda com um toque.
 *
 * ⚠️ Um cartão sem telefone não vai. O destinatário receberia um nome que não dá
 * para chamar — e o provider recusa antes do envio, com essa razão.
 */
import { useState } from "react";
import { Contact, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ContatoParaEnviar {
  nome: string;
  telefones: Array<{ numero: string }>;
  emails?: string[];
}

export function SendContactDialog({
  open,
  onOpenChange,
  enviar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enviar: (contatos: ContatoParaEnviar[]) => Promise<void>;
}) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);

  const submeter = async () => {
    if (!nome.trim()) { toast.error("Informe o nome"); return; }
    if (!telefone.trim()) { toast.error("Informe o telefone"); return; }

    setEnviando(true);
    try {
      await enviar([
        {
          nome: nome.trim(),
          telefones: [{ numero: telefone.trim() }],
          ...(email.trim() ? { emails: [email.trim()] } : {}),
        },
      ]);
      toast.success("Contato enviado");
      onOpenChange(false);
      setNome("");
      setTelefone("");
      setEmail("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Contact className="h-4 w-4" />
            Enviar contato
          </DialogTitle>
          <DialogDescription>
            O cliente recebe um cartão que entra na agenda com um toque.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Maria Souza"
            />
          </div>

          <div className="space-y-2">
            <Label>Telefone</Label>
            <Input
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="+55 44 99999-9999"
            />
          </div>

          <div className="space-y-2">
            <Label>E-mail (opcional)</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="maria@empresa.com.br"
              type="email"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submeter} disabled={enviando}>
            {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
