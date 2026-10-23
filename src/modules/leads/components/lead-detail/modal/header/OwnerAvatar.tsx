import { memo } from "react";
import { cn } from "@/lib/utils";

interface OwnerAvatarProps {
  name: string;
  avatarUrl?: string | null;
  /** Lado em px. */
  size?: number;
  className?: string;
}

function initials(name: string): string {
  return name.split(" ").filter(Boolean).map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

/** Cor estável por nome — a mesma de `ResponsibleSlot`, para a mesma pessoa não mudar de cor. */
function colorFromName(name: string): string {
  const hash = Array.from(name).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return `hsl(${hash % 360}, 60%, 45%)`;
}

/**
 * Avatar redondo de um dono (foto, ou iniciais sobre cor estável).
 * Decorativo (`aria-hidden`): quem usa sempre escreve o nome ao lado ou no
 * `aria-label` do botão, e repetir aqui dobraria o nome lido pelo leitor de tela.
 */
export const OwnerAvatar = memo(function OwnerAvatar({
  name,
  avatarUrl,
  size = 24,
  className,
}: OwnerAvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full", className)}
      style={{
        width: size,
        height: size,
        backgroundColor: avatarUrl ? undefined : colorFromName(name),
      }}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span
          className="font-semibold text-white"
          style={{ fontSize: Math.max(8, Math.round(size * 0.38)) }}
        >
          {initials(name)}
        </span>
      )}
    </span>
  );
});
