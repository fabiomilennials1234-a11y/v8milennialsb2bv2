import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Selo "▶ vídeo" — marca um artigo que tem vídeo (fatia A3).
 *
 * Derivado de `video_url` (sem coluna nova); dourado sutil, como no mockup.
 * Usado na lista do cliente (HelpSection) e na do admin (HelpAdminPanel).
 */
export function VideoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-bold text-primary-soft-foreground",
        className,
      )}
    >
      <Play className="h-2.5 w-2.5 fill-current" aria-hidden />
      vídeo
    </span>
  );
}
