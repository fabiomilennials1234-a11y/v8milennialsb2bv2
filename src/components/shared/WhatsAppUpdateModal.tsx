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
  Zap,
  Send,
  SmilePlus,
  Pin,
  History,
} from "lucide-react";

const DISMISS_KEY = "v8:whatsapp-update-v1:dismissed";

const features = [
  { icon: SmilePlus, label: "Reagir, editar e fixar mensagens" },
  { icon: Send, label: "Menus interativos e botoes PIX" },
  { icon: History, label: "Sincronizacao de historico" },
  { icon: Zap, label: "Envio em massa otimizado" },
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
      "https://wa.me/554884334050?text=Ol%C3%A1!%20Quero%20saber%20sobre%20as%20novidades%20do%20WhatsApp%20no%20Torque%20CRM",
      "_blank",
    );
    handleDismiss();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleDismiss()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
            <MessageSquare className="h-7 w-7 text-emerald-400" />
          </div>
          <DialogTitle className="text-center text-xl">
            WhatsApp com superpoderes
          </DialogTitle>
          <DialogDescription className="text-center text-sm text-muted-foreground">
            Atualizamos a integracao do WhatsApp com recursos que antes nao
            eram possiveis. Confira o que agora voce pode fazer direto pelo
            Torque CRM:
          </DialogDescription>
        </DialogHeader>

        <div className="my-4 grid grid-cols-1 gap-3">
          {features.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/30 px-4 py-3"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                <Icon className="h-4 w-4 text-emerald-400" />
              </div>
              <span className="text-sm font-medium">{label}</span>
            </div>
          ))}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={handleContact} className="w-full bg-emerald-600 hover:bg-emerald-700">
            <MessageSquare className="mr-2 h-4 w-4" />
            Falar com suporte sobre as novidades
          </Button>
          <Button variant="ghost" onClick={handleDismiss} className="w-full text-muted-foreground">
            Agora nao
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
