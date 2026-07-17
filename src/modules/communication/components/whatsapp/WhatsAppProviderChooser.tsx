/**
 * WhatsAppProviderChooser — the two-path connect chooser.
 *
 * Shown (behind the `meta_cloud` feature flag) when adding a number, because
 * picking the API is a consequential choice, not a dropdown: Uazapi = QR +
 * full toolset (non-official); Meta Oficial = Embedded Signup + templates,
 * gated by the 24h window. Honest about the trade either way.
 */
import { motion } from "framer-motion";
import { QrCode, ShieldCheck, Check, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getProviderProfile } from "@/modules/communication/lib/whatsapp-provider";

interface WhatsAppProviderChooserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Uazapi QR path → opens the existing create-instance flow. */
  onChooseUazapi: () => void;
  /** Meta Cloud path → launches Embedded Signup. */
  onChooseMeta: () => void;
}

const UAZAPI = getProviderProfile("uazapi");
const META = getProviderProfile("meta_cloud");

const UAZAPI_FEATURES = ["Texto", "Mídia", "Menus", "Pix", "Reações", "Disparo em massa", "Histórico"];
const META_FEATURES = ["Texto", "Mídia", "Templates aprovados", "Métricas Meta", "Selo verificado"];

function ProviderCard({
  icon,
  label,
  tagline,
  features,
  caveat,
  onChoose,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  tagline: string;
  features: string[];
  caveat: string;
  onChoose: () => void;
  highlight?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onChoose}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "group flex w-full flex-col rounded-xl border bg-card/60 p-5 text-left",
        "border-border/60 hover:border-primary/60 hover:bg-card",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        highlight && "border-primary/40",
      )}
    >
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/50 text-foreground">
          {icon}
        </span>
        <span className="text-base font-semibold text-foreground">{label}</span>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">{tagline}</p>

      <ul className="mb-4 flex-1 space-y-1.5">
        {features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-sm text-foreground/90">
            <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
            {f}
          </li>
        ))}
      </ul>

      <p className="mb-4 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400/90">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {caveat}
      </p>

      <span
        className={cn(
          "inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium",
          "bg-muted/60 text-foreground group-hover:bg-primary group-hover:text-primary-foreground",
          "transition-colors",
        )}
      >
        Escolher
      </span>
    </motion.button>
  );
}

export function WhatsAppProviderChooser({
  open,
  onOpenChange,
  onChooseUazapi,
  onChooseMeta,
}: WhatsAppProviderChooserProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Conectar WhatsApp</DialogTitle>
          <DialogDescription>
            Escolha como conectar este número. Você pode ter números dos dois tipos na mesma organização.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <ProviderCard
            icon={<QrCode className="h-5 w-5" />}
            label={UAZAPI.label}
            tagline={UAZAPI.tagline}
            features={UAZAPI_FEATURES}
            caveat="Não-oficial"
            onChoose={() => {
              onOpenChange(false);
              onChooseUazapi();
            }}
          />
          <ProviderCard
            icon={<ShieldCheck className="h-5 w-5" />}
            label={META.label}
            tagline={META.tagline}
            features={META_FEATURES}
            caveat="Janela 24h · sem Pix/menu/disparo Uazapi"
            highlight
            onChoose={() => {
              onOpenChange(false);
              onChooseMeta();
            }}
          />
        </div>

        <p className="px-1 pb-1 text-center text-xs text-muted-foreground">
          Ao conectar o WhatsApp Oficial (API da Meta), você concorda com a{" "}
          <a
            href="https://torquecrm.com.br/privacidade"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Política de Privacidade
          </a>
          .
        </p>
      </DialogContent>
    </Dialog>
  );
}
