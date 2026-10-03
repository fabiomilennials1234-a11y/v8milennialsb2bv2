/**
 * WhatsAppProviderChooser — o chooser de conexão.
 *
 * Mostrado (atrás das flags `meta_cloud` / `notificame`) ao adicionar um número,
 * porque escolher a API é uma decisão consequente, não um dropdown: Uazapi = QR
 * + ferramental completo (não-oficial); Meta Oficial = Embedded Signup, gated
 * pela janela de 24h; WhatsApp Oficial (NotificaMe) = login Meta pelo Seamless,
 * número oficial sem risco de ban. Honesto sobre o trade nos três casos.
 *
 * OS DOIS CAMINHOS OFICIAIS SÃO OPCIONAIS, E PELA MESMA REGRA: o card existe se, e
 * somente se, o handler dele chegar. Até 2026-08-17 o card da Meta renderizava
 * INCONDICIONALMENTE — a flag `meta_cloud` decidia só se o diálogo abria, não se
 * aquele card aparecia. Efeito: uma org com `meta_cloud` desligada e `notificame`
 * ligada via o Embedded Signup oferecido, clicava, e caía num caminho que a org
 * não tem. Quem manda no card é o handler; a flag mora no chamador, um lugar só.
 *
 * Card DESABILITADO COM MOTIVO: quando a configuração do fornecedor ainda não
 * existe, o card nasce inerte e diz por quê ANTES do clique. O precedente
 * (`meta_cloud`) só avisa por toast depois — o usuário clica, nada acontece
 * visualmente, e ele clica de novo.
 *
 * NÃO ADICIONE UM CARD DE INSTAGRAM AQUI. É a modificação óbvia — o NotificaMe
 * conecta Instagram pelo MESMO popup, pelo MESMO hook — e é a errada. Este
 * diálogo se chama "Conectar WhatsApp" e é aberto pelo botão "Adicionar
 * número"; um card de Instagram dentro dele repetiria exatamente o erro de
 * rótulo que a fatia 1 evitou ao dar ao NotificaMe um perfil próprio em
 * `whatsapp-provider.ts`. Instagram entra pelo catálogo de integrações, em
 * componente próprio (`InstagramChannelSettings`), sem a palavra "WhatsApp" em
 * nenhum texto do caminho. Por isso `onChooseNotificame` continua sem
 * parâmetro: quem o passa é que escolhe o canal, e aqui ele é sempre WhatsApp.
 */
import { motion } from "framer-motion";
import { QrCode, ShieldCheck, BadgeCheck, Check, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { getProviderProfile } from "@/modules/communication/lib/whatsapp-provider";

interface WhatsAppProviderChooserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Uazapi QR path → opens the existing create-instance flow. */
  onChooseUazapi: () => void;
  /**
   * Meta Cloud path → launches Embedded Signup. O card só existe quando este
   * handler é passado (flag `meta_cloud` ligada) — mesma regra do NotificaMe.
   */
  onChooseMeta?: () => void;
  /**
   * NotificaMe Seamless path → abre o popup do fornecedor. O card só existe
   * quando este handler é passado (flag `notificame` ligada).
   */
  onChooseNotificame?: () => void;
  /**
   * Motivo legível quando o NotificaMe ainda não está configurado. Preenchido =
   * card desabilitado exibindo esta frase no lugar da pílula "Escolher".
   */
  notificameDisabledReason?: string | null;
}

const UAZAPI = getProviderProfile("uazapi");
const META = getProviderProfile("meta_cloud");
const NOTIFICAME = getProviderProfile("notificame");

const UAZAPI_FEATURES = ["Texto", "Mídia", "Menus", "Pix", "Reações", "Disparo em massa", "Histórico"];
const META_FEATURES = ["Texto", "Mídia", "Templates aprovados", "Métricas Meta", "Selo verificado"];
const NOTIFICAME_FEATURES = [
  "Texto",
  "Mídia",
  "Templates aprovados",
  "Número oficial verificado",
  "Sem risco de ban",
];

function ProviderCard({
  icon,
  label,
  tagline,
  features,
  caveat,
  onChoose,
  highlight,
  disabled,
  disabledReason,
}: {
  icon: React.ReactNode;
  label: string;
  tagline: string;
  features: string[];
  caveat: string;
  onChoose: () => void;
  highlight?: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
}) {
  return (
    <motion.button
      type="button"
      onClick={disabled ? undefined : onChoose}
      disabled={disabled}
      aria-disabled={disabled}
      whileHover={disabled ? undefined : { y: -2 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "group flex w-full flex-col rounded-xl border bg-card/60 p-5 text-left",
        "border-border/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        disabled
          ? "cursor-not-allowed opacity-60"
          : "hover:border-primary/60 hover:bg-card",
        highlight && !disabled && "border-primary/40",
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

      {disabled ? (
        <span className="text-xs leading-relaxed text-muted-foreground">
          {disabledReason || "Indisponível no momento"}
        </span>
      ) : (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium",
            "bg-muted/60 text-foreground group-hover:bg-primary group-hover:text-primary-foreground",
            "transition-colors",
          )}
        >
          Escolher
        </span>
      )}
    </motion.button>
  );
}

export function WhatsAppProviderChooser({
  open,
  onOpenChange,
  onChooseUazapi,
  onChooseMeta,
  onChooseNotificame,
  notificameDisabledReason,
}: WhatsAppProviderChooserProps) {
  const hasMeta = typeof onChooseMeta === "function";
  const hasNotificame = typeof onChooseNotificame === "function";
  // A largura e as colunas saem da CONTAGEM de cards, não de qual deles existe.
  // Com o card da Meta agora opcional, amarrar o grid a `hasNotificame` deixaria
  // uma coluna vazia no caso Uazapi + NotificaMe — o mais comum depois desta
  // mudança.
  const cardCount = 1 + (hasMeta ? 1 : 0) + (hasNotificame ? 1 : 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-2xl", cardCount === 3 && "lg:max-w-4xl")}>
        <DialogHeader>
          <DialogTitle>Conectar WhatsApp</DialogTitle>
          <DialogDescription>
            Escolha como conectar este número. Você pode ter números dos dois tipos na mesma organização.
          </DialogDescription>
        </DialogHeader>

        <div className={cn("grid gap-4 py-2 sm:grid-cols-2", cardCount === 3 && "lg:grid-cols-3")}>
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
          {hasMeta && (
            <ProviderCard
              icon={<ShieldCheck className="h-5 w-5" />}
              label={META.label}
              tagline={META.tagline}
              features={META_FEATURES}
              caveat="Janela 24h · sem Pix/menu/disparo Uazapi"
              // O destaque migra para o NotificaMe quando ele existe: é o caminho
              // oficial que já está ao alcance, enquanto o Embedded Signup segue
              // esperando App Review.
              highlight={!hasNotificame}
              onChoose={() => {
                onOpenChange(false);
                onChooseMeta?.();
              }}
            />
          )}
          {hasNotificame && (
            <ProviderCard
              icon={<BadgeCheck className="h-5 w-5" />}
              label={NOTIFICAME.label}
              tagline={NOTIFICAME.tagline}
              features={NOTIFICAME_FEATURES}
              caveat="Janela 24h · sem Pix/menu/disparo"
              highlight
              disabled={Boolean(notificameDisabledReason)}
              disabledReason={notificameDisabledReason}
              onChoose={() => {
                onOpenChange(false);
                onChooseNotificame?.();
              }}
            />
          )}
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
