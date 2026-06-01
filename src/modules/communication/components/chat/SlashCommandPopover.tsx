/**
 * SlashCommandPopover — dropdown autocomplete para slash commands no chat.
 * Aparece quando o usuário digita "/" como primeiro caractere no input.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { MessageTemplate } from "@/modules/communication/hooks/useMessageTemplates";

interface SlashCommandPopoverProps {
  query: string;
  templates: MessageTemplate[];
  onSelect: (template: MessageTemplate) => void;
  onClose: () => void;
}

export function SlashCommandPopover({
  query,
  templates,
  onSelect,
  onClose,
}: SlashCommandPopoverProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const search = query.startsWith("/") ? query.slice(1).toLowerCase() : "";
  const filtered = templates.filter(
    (t) =>
      t.command.startsWith(search) ||
      t.display_name.toLowerCase().includes(search)
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, selectedIndex, onSelect, onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-lg border bg-popover shadow-lg z-50"
    >
      {filtered.slice(0, 8).map((template, i) => (
        <button
          key={template.id}
          type="button"
          className={`w-full text-left px-3 py-2.5 flex flex-col gap-0.5 transition-colors ${
            i === selectedIndex
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent/50"
          }`}
          onMouseEnter={() => setSelectedIndex(i)}
          onClick={() => onSelect(template)}
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-primary">
              /{template.command}
            </span>
            <span className="text-sm text-muted-foreground">
              {template.display_name}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {template.body}
          </p>
        </button>
      ))}
    </div>
  );
}
