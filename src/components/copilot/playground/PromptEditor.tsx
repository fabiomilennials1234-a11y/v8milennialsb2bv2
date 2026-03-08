/**
 * PromptEditor — Textarea rico com @autocomplete para tools e documentos
 *
 * Features:
 * - Textarea com @mention trigger
 * - Popover com Command (cmdk) para autocomplete
 * - Botao fullscreen/expandir
 * - Contador de caracteres
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Maximize2, Minimize2, AtSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import type { MentionItem, PlaygroundToolState, PlaygroundToolDef, KnowledgeDocument, KnowledgeLink } from "./types";

interface PromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  tools: Record<string, PlaygroundToolState>;
  toolDefs: PlaygroundToolDef[];
  documents: KnowledgeDocument[];
  links: KnowledgeLink[];
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function PromptEditor({
  value,
  onChange,
  tools,
  toolDefs,
  documents,
  links,
  isExpanded,
  onToggleExpand,
}: PromptEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState("");
  const [mentionStartPos, setMentionStartPos] = useState<number | null>(null);

  // Build mention items from active tools + docs + links
  const mentionItems = useMemo<MentionItem[]>(() => {
    const items: MentionItem[] = [];

    // Active tools
    for (const def of toolDefs) {
      if (tools[def.id]?.enabled) {
        items.push({ type: "tool", id: def.id, label: def.name, icon: def.icon });
      }
    }

    // Documents
    for (const doc of documents) {
      items.push({ type: "document", id: doc.id, label: doc.name });
    }

    // Links
    for (const link of links) {
      items.push({ type: "link", id: link.id, label: link.alias });
    }

    return items;
  }, [tools, toolDefs, documents, links]);

  // Filter mentions by search
  const filteredMentions = useMemo(() => {
    if (!mentionSearch) return mentionItems;
    const q = mentionSearch.toLowerCase();
    return mentionItems.filter(
      (item) => item.label.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)
    );
  }, [mentionItems, mentionSearch]);

  // Handle textarea input — detect @ trigger
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursorPos = e.target.selectionStart;
      onChange(newValue);

      // Check if @ was just typed
      if (cursorPos > 0 && newValue[cursorPos - 1] === "@") {
        // Check char before @ is space, newline or start
        const charBefore = cursorPos > 1 ? newValue[cursorPos - 2] : " ";
        if (charBefore === " " || charBefore === "\n" || cursorPos === 1) {
          setMentionStartPos(cursorPos);
          setMentionSearch("");
          setShowMentions(true);
          return;
        }
      }

      // If mention popup is open, update search
      if (showMentions && mentionStartPos !== null) {
        const searchText = newValue.slice(mentionStartPos, cursorPos);
        if (searchText.includes(" ") || searchText.includes("\n")) {
          setShowMentions(false);
          setMentionStartPos(null);
        } else {
          setMentionSearch(searchText);
        }
      }
    },
    [onChange, showMentions, mentionStartPos]
  );

  // Handle mention selection
  const handleSelectMention = useCallback(
    (item: MentionItem) => {
      if (mentionStartPos === null || !textareaRef.current) return;

      const before = value.slice(0, mentionStartPos - 1); // before the @
      const after = value.slice(textareaRef.current.selectionStart);
      const mentionText = `@${item.id}`;
      const newValue = `${before}${mentionText} ${after}`;

      onChange(newValue);
      setShowMentions(false);
      setMentionStartPos(null);
      setMentionSearch("");

      // Focus back and set cursor
      setTimeout(() => {
        if (textareaRef.current) {
          const newPos = before.length + mentionText.length + 1;
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newPos, newPos);
        }
      }, 0);
    },
    [value, onChange, mentionStartPos]
  );

  // Handle keyboard in textarea
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape" && showMentions) {
        e.preventDefault();
        setShowMentions(false);
        setMentionStartPos(null);
      }
      if (e.key === "Escape" && isExpanded) {
        e.preventDefault();
        onToggleExpand();
      }
    },
    [showMentions, isExpanded, onToggleExpand]
  );

  // Open mention popup manually via @ button
  const handleAtButtonClick = useCallback(() => {
    if (!textareaRef.current) return;
    const ta = textareaRef.current;
    const cursorPos = ta.selectionStart;
    const before = value.slice(0, cursorPos);
    const after = value.slice(cursorPos);
    const newValue = `${before}@${after}`;
    onChange(newValue);

    setTimeout(() => {
      ta.focus();
      const newPos = cursorPos + 1;
      ta.setSelectionRange(newPos, newPos);
      setMentionStartPos(newPos);
      setMentionSearch("");
      setShowMentions(true);
    }, 0);
  }, [value, onChange]);

  return (
    <div className={`relative flex flex-col ${isExpanded ? "flex-1" : ""}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 rounded-t-lg">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">System Prompt</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 gap-1 text-xs"
            onClick={handleAtButtonClick}
          >
            <AtSign className="w-3.5 h-3.5" />
            Mencionar
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{value.length} chars</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onToggleExpand}
          >
            {isExpanded ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Textarea */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Delay to allow click on mention item
            setTimeout(() => setShowMentions(false), 200);
          }}
          placeholder={"Escreva as instrucoes do seu agente aqui...\n\nUse @ para mencionar tools e documentos.\n\nEx: Voce e um SDR da empresa TechCorp. Quando o lead demonstrar interesse em preco, use @MOVER_CARD para mover para a etapa Negociacao."}
          className={`w-full resize-none bg-background p-4 text-sm leading-relaxed focus:outline-none focus:ring-0 border-0 rounded-b-lg ${
            isExpanded ? "flex-1 min-h-[500px]" : "min-h-[280px]"
          }`}
          style={{ fontFamily: "inherit" }}
        />

        {/* Mention autocomplete dropdown */}
        {showMentions && (
          <div className="absolute left-4 top-12 z-50 w-72 rounded-lg border bg-popover shadow-md">
            <Command>
              <CommandInput
                placeholder="Buscar tool ou documento..."
                value={mentionSearch}
                onValueChange={setMentionSearch}
              />
              <CommandList>
                <CommandEmpty>Nenhum item encontrado</CommandEmpty>

                {/* Tools */}
                {filteredMentions.some((m) => m.type === "tool") && (
                  <CommandGroup heading="Tools">
                    {filteredMentions
                      .filter((m) => m.type === "tool")
                      .map((item) => (
                        <CommandItem
                          key={item.id}
                          value={item.id}
                          onSelect={() => handleSelectMention(item)}
                        >
                          <span className="text-xs font-mono bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-1.5 py-0.5 rounded mr-2">
                            @{item.id}
                          </span>
                          <span className="text-sm">{item.label}</span>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                )}

                {/* Documents */}
                {filteredMentions.some((m) => m.type === "document") && (
                  <CommandGroup heading="Documentos">
                    {filteredMentions
                      .filter((m) => m.type === "document")
                      .map((item) => (
                        <CommandItem
                          key={item.id}
                          value={item.id}
                          onSelect={() => handleSelectMention(item)}
                        >
                          <span className="text-xs font-mono bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded mr-2">
                            @{item.label}
                          </span>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                )}

                {/* Links */}
                {filteredMentions.some((m) => m.type === "link") && (
                  <CommandGroup heading="Links">
                    {filteredMentions
                      .filter((m) => m.type === "link")
                      .map((item) => (
                        <CommandItem
                          key={item.id}
                          value={item.id}
                          onSelect={() => handleSelectMention(item)}
                        >
                          <span className="text-xs font-mono bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded mr-2">
                            @{item.label}
                          </span>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </div>
        )}
      </div>
    </div>
  );
}
