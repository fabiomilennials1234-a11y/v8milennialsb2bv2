/**
 * ChatComposerShell — shell unificado que envolve o composer humano
 * (full /chat ou compact /bubble) e renderiza:
 *   1. Estado 1 (HABILITADO) → innerComposer cru, zero overlay.
 *   2. Estado 2 (BLOQUEADO_INSTANCIA_ALHEIA) → banner + composer disabled
 *      visualmente (opacity stack) MAS o innerComposer continua montado para
 *      que a integração com aba Notas funcione (variant=full).
 *   3. Estado 3 (ERRO_SEM_INSTANCIA / NO_RESPONSIBLE) → SUBSTITUI o composer
 *      por <EmptyComposerCard> com CTA correto conforme spec.
 *
 * Spec visual de referência:
 *   Obsidian/.../06 — Features/whatsapp-write-instance/02-ui-states.md
 *
 * Tokens: 100% via hsl(var(--token)) — sem hex em lugar nenhum.
 */
import { useMemo } from "react";
import { Lock, Plug2, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useLeadWriteInstance } from "@/hooks/useLeadWriteInstance";
import type { WriteInstanceErrorCode } from "@/types/user-write-instance";
import { useIdentity } from "@/modules/identity";
export type ChatComposerVariant = "full" | "compact";

export interface ChatComposerShellProps {
  /** Lead vinculado à conversa atual. Se null/undefined, renderiza innerComposer (legado). */
  leadId: string | null | undefined;
  variant: ChatComposerVariant;
  /** Composer já configurado (ChatComposer / ChatBubbleComposer). */
  innerComposer: React.ReactNode;
  /** Estado 3a: CTA "Atribuir responsável". Quando ausente em admin/master, o card
   *  ainda mostra o motivo mas sem botão. */
  onAssignResponsible?: () => void;
  /** Estado 3b: CTA "Vincular número" (só admin/master). */
  onLinkInstance?: () => void;
  /** Estado 3b alternativo: CTA secundário "Trocar responsável". */
  onChangeResponsible?: () => void;
  /** Hook escapatório p/ aba Notas (Estado 2 full): atalho `N` foca aba notas. Opcional. */
  onOpenNotesTab?: () => void;
}

// ─── Banner (Estado 2) ──────────────────────────────────────────────────────

function BlockedBanner({
  variant,
  ownerFirstName,
}: {
  variant: ChatComposerVariant;
  ownerFirstName?: string;
}) {
  const fallbackName = !ownerFirstName;
  const compact = variant === "compact";

  // Anatomia conforme spec:
  //  - container: border-t, bg muted/40, padding por variant
  //  - ícone alinhado opticamente à 1ª linha (mt-0.5)
  //  - sem CTA, sem hover, sem cursor-pointer
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "border-t border-border/60 bg-muted/40 transition-opacity duration-150 ease-out motion-reduce:transition-none",
        compact ? "px-3 py-2" : "px-4 py-2.5",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Lock
          className={cn(
            "shrink-0 text-muted-foreground mt-0.5",
            compact ? "w-3 h-3" : "w-3.5 h-3.5",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "leading-snug text-foreground/85",
              compact ? "text-[12px]" : "text-[13px] font-medium",
            )}
          >
            {compact
              ? fallbackName
                ? "Conversa do número de outro vendedor."
                : (
                    <>
                      Conversa do número de{" "}
                      <span className="font-semibold text-foreground">{ownerFirstName}</span>.
                    </>
                  )
              : fallbackName
                ? "Esta conversa pertence ao número de outro vendedor."
                : (
                    <>
                      Esta conversa pertence ao número de{" "}
                      <span className="font-semibold text-foreground">{ownerFirstName}</span>.
                    </>
                  )}
          </p>
          {!compact && (
            <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">
              Você pode ler e adicionar notas internas.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Estado 3 — Empty / Error card ──────────────────────────────────────────

interface EmptyComposerCardProps {
  variant: ChatComposerVariant;
  errorCode: WriteInstanceErrorCode;
  responsibleFirstName?: string;
  isAdminOrMaster: boolean;
  onAssignResponsible?: () => void;
  onLinkInstance?: () => void;
  onChangeResponsible?: () => void;
}

function EmptyComposerCard({
  variant,
  errorCode,
  responsibleFirstName,
  isAdminOrMaster,
  onAssignResponsible,
  onLinkInstance,
  onChangeResponsible,
}: EmptyComposerCardProps) {
  const compact = variant === "compact";

  // Resolve content por error_code + permissão.
  let Icon = Plug2;
  let title = "";
  let subtitle = "";
  let primary: { label: string; icon: typeof Plug2; onClick?: () => void } | null = null;
  let secondary: { label: string; icon: typeof Plug2; onClick?: () => void } | null = null;

  if (errorCode === "NO_RESPONSIBLE") {
    Icon = UserPlus;
    title = "Lead sem responsável";
    if (isAdminOrMaster && onAssignResponsible) {
      subtitle =
        "Defina um responsável para que ele envie mensagens por esta conversa.";
      primary = {
        label: "Atribuir responsável",
        icon: UserPlus,
        onClick: onAssignResponsible,
      };
    } else {
      subtitle =
        "Peça ao administrador para definir um responsável por este lead.";
    }
  } else if (errorCode === "NO_INSTANCE") {
    Icon = Plug2;
    const respLabel = responsibleFirstName ?? "o responsável";
    title = `${respLabel} ainda não tem um número de WhatsApp`;
    if (isAdminOrMaster) {
      subtitle = `Vincule um número para que ${respLabel} possa responder pelos leads dele.`;
      if (onLinkInstance) {
        primary = {
          label: "Vincular número",
          icon: Plug2,
          onClick: onLinkInstance,
        };
      }
      if (onChangeResponsible) {
        secondary = {
          label: "Trocar responsável",
          icon: UserPlus,
          onClick: onChangeResponsible,
        };
      }
    } else {
      subtitle = `Peça ao administrador para vincular um número de WhatsApp ao perfil de ${respLabel}.`;
    }
  } else if (errorCode === "INSTANCE_INACTIVE") {
    Icon = Plug2;
    const respLabel = responsibleFirstName ?? "o responsável";
    title = "Número desativado";
    if (isAdminOrMaster && onLinkInstance) {
      subtitle = `O número de ${respLabel} está desativado. Vincule outro para retomar o envio.`;
      primary = {
        label: "Vincular número",
        icon: Plug2,
        onClick: onLinkInstance,
      };
    } else {
      subtitle = `O número de ${respLabel} está desativado. Peça ao administrador para reconectar ou trocar.`;
    }
  } else {
    // LEAD_NOT_FOUND ou desconhecido — degrada elegante
    Icon = Plug2;
    title = "Conversa indisponível";
    subtitle =
      "Não foi possível identificar o lead desta conversa. Recarregue a página.";
  }

  return (
    <section
      role="region"
      aria-live="polite"
      aria-label="Composer indisponível"
      className={cn(
        "border-t border-border/60 bg-background flex flex-col items-start gap-3",
        compact ? "px-4 py-4" : "px-6 py-5",
        "min-h-[var(--chat-composer-min-h,44px)]",
      )}
    >
      <div
        className={cn(
          "rounded-xl border border-border/60 bg-muted/40 flex items-center justify-center",
          compact ? "p-2" : "p-2.5",
        )}
      >
        <Icon
          className={cn(
            "text-muted-foreground",
            compact ? "w-6 h-6" : "w-7 h-7",
          )}
          aria-hidden
        />
      </div>
      <div className="flex flex-col gap-1">
        <h3
          className={cn(
            "font-semibold text-foreground tracking-tight",
            compact ? "text-[14px]" : "text-[15px]",
          )}
        >
          {title}
        </h3>
        <p
          className={cn(
            "text-muted-foreground leading-relaxed",
            compact ? "text-[12px] max-w-[36ch]" : "text-[13px] max-w-[52ch]",
          )}
        >
          {subtitle}
        </p>
      </div>
      {(primary || secondary) && (
        <div className="flex items-center gap-2 mt-1">
          {primary && (
            <Button
              type="button"
              size={compact ? "sm" : "default"}
              onClick={primary.onClick}
              className="gradient-primary text-white border-0"
            >
              <primary.icon className="w-4 h-4 mr-2" aria-hidden />
              {primary.label}
            </Button>
          )}
          {secondary && (
            <Button
              type="button"
              variant="ghost"
              size={compact ? "sm" : "default"}
              onClick={secondary.onClick}
            >
              <secondary.icon className="w-4 h-4 mr-2" aria-hidden />
              {secondary.label}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Wrapper principal ──────────────────────────────────────────────────────

export function ChatComposerShell({
  leadId,
  variant,
  innerComposer,
  onAssignResponsible,
  onLinkInstance,
  onChangeResponsible,
}: ChatComposerShellProps) {
  const { state } = useLeadWriteInstance(leadId);
  const { isAdmin, isMaster } = useIdentity();
  const isAdminOrMaster = isAdmin || isMaster;

  // Quando não há leadId, renderiza inner direto (legado / pré-resolução).
  // Mantém comportamento atual em todos os call-sites antigos.
  const noLead = !leadId;

  // Skeleton com altura idêntica ao composer para evitar layout shift.
  const skeletonContent = useMemo(
    () => (
      <div
        className={cn(
          "border-t border-border/60 bg-background animate-pulse motion-reduce:animate-none",
          variant === "compact" ? "px-3 py-2" : "px-4 py-3",
        )}
        aria-hidden
      >
        <div
          className={cn(
            "rounded-xl bg-muted/40",
            variant === "compact" ? "h-9" : "h-10",
          )}
          style={{ minHeight: "var(--chat-composer-min-h, 44px)" }}
        />
      </div>
    ),
    [variant],
  );

  if (noLead) {
    return <>{innerComposer}</>;
  }

  if (state.status === "loading") {
    return skeletonContent;
  }

  if (state.status === "error") {
    return (
      <EmptyComposerCard
        variant={variant}
        errorCode={state.errorCode}
        responsibleFirstName={state.responsibleFirstName}
        isAdminOrMaster={isAdminOrMaster}
        onAssignResponsible={onAssignResponsible}
        onLinkInstance={onLinkInstance}
        onChangeResponsible={onChangeResponsible}
      />
    );
  }

  // status === "ok"
  if (state.canWrite) {
    return <>{innerComposer}</>;
  }

  // Estado 2: bloqueado por instância alheia.
  // Banner acima + composer visualmente desabilitado abaixo. Pointer events
  // bloqueados via overlay; opacity e aria-disabled comunicam estado.
  return (
    <div className="flex flex-col">
      <BlockedBanner variant={variant} ownerFirstName={state.ownerFirstName} />
      <div
        className={cn(
          "relative pointer-events-none select-none cursor-not-allowed",
          "[&_button]:!cursor-not-allowed",
          "opacity-[0.55]",
        )}
        aria-hidden="true"
        data-write-blocked="true"
      >
        {innerComposer}
      </div>
    </div>
  );
}
