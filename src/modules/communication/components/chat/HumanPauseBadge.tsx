/**
 * HumanPauseBadge — countdown badge + reactivate button for copilot human pause.
 *
 * Shows remaining time until copilot auto-reactivates.
 * Tick interval: 1s when <5min remaining, 60s otherwise.
 * Disappears when countdown hits 0.
 */

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PauseCircle, Play } from "lucide-react";

interface HumanPauseBadgeProps {
  pausedUntil: Date;
  onReactivate: () => void;
  isReactivating: boolean;
}

export function HumanPauseBadge({
  pausedUntil,
  onReactivate,
  isReactivating,
}: HumanPauseBadgeProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const remaining = pausedUntil.getTime() - now.getTime();
    if (remaining <= 0) return;
    const interval = remaining < 5 * 60_000 ? 1_000 : 60_000;
    const timer = setInterval(() => setNow(new Date()), interval);
    return () => clearInterval(timer);
  }, [pausedUntil, now]);

  const remaining = Math.max(0, pausedUntil.getTime() - now.getTime());
  if (remaining <= 0) return null;

  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);

  const timeText =
    minutes >= 5
      ? `${minutes}min`
      : `${minutes}min ${seconds.toString().padStart(2, "0")}s`;

  return (
    <div className="hidden md:inline-flex items-center gap-1.5">
      <Badge variant="warning" className="gap-1.5 text-xs">
        <PauseCircle className="h-3 w-3" />
        Copilot pausado · {timeText}
      </Badge>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 rounded-full px-2.5 text-xs text-warning-strong hover:bg-warning/10 hover:text-warning-strong"
        onClick={onReactivate}
        disabled={isReactivating}
      >
        <Play className="h-3 w-3 mr-1" />
        Reativar
      </Button>
    </div>
  );
}
