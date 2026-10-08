import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { LAYER_CLASS } from "./layers";
import { ignoreToasterInteraction } from "./outside-toaster";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      LAYER_CLASS.modalOverlay,
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Camadas: overlay `modalOverlay` (50) e conteúdo `modalContent` (51), da
 * escala de `ui/layers.ts` — o mesmo degrau da `Sheet`.
 *
 * `overlayClassName` existe para o diálogo ANINHADO: aberto de dentro de uma
 * folha (o painel do Negócio no celular), ele empata com o `z-[51]` dela e só
 * vence pela ordem do DOM — e o overlay dele, a 50, fica abaixo da folha, sem
 * escurecê-la. A convenção do repo é subir os DOIS para `z-[60]` (acima da
 * folha, no degrau `popper`, abaixo do AlertDialog). O overlay é irmão do
 * conteúdo dentro do mesmo portal: subir só o `className` deixa o escurecido
 * para trás. Quem sobe, sobe os dois.
 */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    overlayClassName?: string;
  }
>(({ className, overlayClassName, children, onInteractOutside, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border border-card-border bg-card p-6 shadow-relevo-alto duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-panel",
        LAYER_CLASS.modalContent,
        // Mobile: bottom-sheet — ancora embaixo, full-width, altura limitada com
        // scroll (botão de salvar sempre alcançável), safe-area, slide de baixo.
        "max-sm:left-0 max-sm:right-0 max-sm:top-auto max-sm:bottom-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:max-w-full max-sm:max-h-[92dvh] max-sm:overflow-y-auto max-sm:rounded-t-2xl max-sm:rounded-b-none max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-sm:data-[state=open]:slide-in-from-bottom-4 max-sm:data-[state=closed]:slide-out-to-bottom-4",
        className,
      )}
      {...props}
      onInteractOutside={ignoreToasterInteraction(onInteractOutside)}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full opacity-70 hover:bg-accent ring-offset-background transition-opacity data-[state=open]:bg-accent data-[state=open]:text-muted-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
