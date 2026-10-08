import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const sizeClasses = {
  xs: "h-6 w-6",
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
  xl: "h-16 w-16",
  "2xl": "h-20 w-20",
} as const;

const textSizeClasses = {
  xs: "text-[10px]",
  sm: "text-xs",
  md: "text-sm",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
} as const;

interface UserAvatarProps {
  /**
   * Nullable de propósito: quase todo call site alimenta este componente com
   * nome vindo de RPC, onde `name` é `string | null` (ex.: get_ranking_data).
   * Tipar como `string` fazia o TS mentir — o erro de atribuição existia, mas
   * estava suprimido pelo .tsc-baseline.json — e estourava `null.split(" ")`
   * em runtime, derrubando a página inteira do Ranking.
   */
  name: string | null | undefined;
  avatarUrl?: string | null;
  size?: keyof typeof sizeClasses;
  className?: string;
  fallbackClassName?: string;
}

export function UserAvatar({
  name,
  avatarUrl,
  size = "md",
  className,
  fallbackClassName,
}: UserAvatarProps) {
  const safeName = name?.trim() ?? "";
  const initials =
    safeName
      .split(/\s+/)
      .filter(Boolean)
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  return (
    <Avatar className={cn(sizeClasses[size], className)}>
      <AvatarImage src={avatarUrl || ""} alt={safeName} />
      <AvatarFallback
        className={cn(
          textSizeClasses[size],
          "font-semibold",
          fallbackClassName
        )}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
