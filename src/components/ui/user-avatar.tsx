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
  name: string;
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
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Avatar className={cn(sizeClasses[size], className)}>
      <AvatarImage src={avatarUrl || ""} alt={name} />
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
