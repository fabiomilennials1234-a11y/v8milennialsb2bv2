import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  MessageSquare,
  Trash2,
  PlugZap,
  AlertTriangle,
  Headphones,
} from "lucide-react";

const DISMISS_KEY = "v8:whatsapp-reconnect-v2:dismissed";

const steps = [
  {
    icon: Trash2,
    number: "1",
    label: "Exclua sua instancia atual do WhatsApp",
    description:
      "Va em Configuracoes > WhatsApp e clique em Excluir instancia. Isso remove a conexao antiga.",
  },
  {
    icon: PlugZap,
    number: "2",
    label: "Conecte uma nova instancia",
    description:
      "Clique em Conectar WhatsApp e escaneie o QR Code com seu celular. Pronto, nova conexao ativa!",
  },
];

export function WhatsAppUpdateModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (!dismissed) setOpen(true);
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, new Date().toISOString());
    setOpen(false);
  };

  const handleContact = () => {
    window.open(
      "https://wa.me/554884334050?text=Ol%C3%A1!%20Preciso%20de%20ajuda%20para%20reconectar%20meu%20WhatsApp%20no%20Torque%20CRM.",
      "_blank",
    );
    handleDismiss();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleDismiss()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 ring-1 ring-amber-500/20">
            <AlertTriangle className="h-7 w-7 text-amber-400" />
          </div>
          <DialogTitle className="text-center text-xl">
            Reconexao do WhatsApp necessaria
          </DialogTitle>
          <DialogDescription className="text-center text-sm text-muted-foreground">
            Para garantir o funcionamento correto do sistema, voce precisa
            excluir sua instancia atual do WhatsApp e conectar uma nova.
            Siga os passos abaixo:
          </DialogDescription>
        </DialogHeader>

        <div className="my-4 flex flex-col gap-3">
          {steps.map(({ icon: Icon, number, label, description }) => (
            <div
              key={number}
              className="flex items-start gap-3 rounded-lg border border-border/50 bg-muted/30 px-4 py-3"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 font-semibold text-amber-400">
                {number}
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">
                  {description}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
          <Headphones className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            Duvidas? Entre em contato com nosso suporte pelo botao abaixo.
          </span>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col mt-2">
          <Button onClick={handleDismiss} className="w-full">
            Entendi, vou reconectar
          </Button>
          <Button
            variant="outline"
            onClick={handleContact}
            className="w-full"
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            Falar com suporte
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
