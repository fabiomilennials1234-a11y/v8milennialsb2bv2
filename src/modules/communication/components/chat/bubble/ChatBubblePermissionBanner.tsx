/**
 * Banner inline (rodapé do thread) — substitui composer quando user não pode
 * responder na instância (useCanReplyOnInstanceByName === false).
 */
import { Lock } from "lucide-react";

export function ChatBubblePermissionBanner() {
  return (
    <div
      role="status"
      className="flex items-center gap-2 px-4 py-3 border-t border-border/40 bg-destructive/10 text-destructive"
    >
      <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden />
      <p className="text-xs leading-snug">
        Você não tem permissão pra responder nesta instância. Peça acesso ao admin.
      </p>
    </div>
  );
}
