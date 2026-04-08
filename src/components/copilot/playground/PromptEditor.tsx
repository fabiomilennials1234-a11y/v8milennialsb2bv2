/**
 * PromptEditor — Editor estruturado com seções colapsáveis e @autocomplete
 *
 * Seções:
 *   1. Personalidade — quem é o copilot, persona, tom
 *   2. Objetivo — missão, critério de sucesso, limites
 *   3. Fluxo — etapas da conversa, como conduzir
 *   4. Instruções — do's e don'ts
 *
 * Cada seção é um textarea independente com @mention support.
 */

import { useState, useRef, useCallback, useMemo } from "react";
import {
  Maximize2,
  Minimize2,
  AtSign,
  ChevronDown,
  ChevronRight,
  User,
  Target,
  Route,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import type {
  MentionItem,
  PlaygroundToolState,
  PlaygroundToolDef,
  KnowledgeDocument,
  KnowledgeLink,
  PromptSections,
} from "./types";

// =====================================================
// SECTION CONFIG
// =====================================================

interface SectionConfig {
  key: keyof PromptSections;
  label: string;
  icon: React.ReactNode;
  placeholder: string;
  minHeight: string;
}

const SECTIONS: SectionConfig[] = [
  {
    key: "personality",
    label: "Personalidade",
    icon: <User className="w-4 h-4" />,
    placeholder:
      "Quem e o copilot? Descreva a persona, tom de voz, como se apresenta, como age...\n\nEx: Voce e a Ana, consultora de vendas B2B da TechCorp. Tom profissional mas acessivel, sempre consultivo. Nunca e agressiva ou insistente. Se apresenta pelo nome e pergunta como pode ajudar.",
    minHeight: "min-h-[120px]",
  },
  {
    key: "objective",
    label: "Objetivo",
    icon: <Target className="w-4 h-4" />,
    placeholder:
      "Qual a missao principal? Criterio de sucesso? Limites?\n\nEx: Sua missao e qualificar leads inbound identificando fit, budget e timeline. Sucesso = lead qualificado transferido para vendedor. Limite: nunca negocie preco ou faca promessas de desconto.",
    minHeight: "min-h-[100px]",
  },
  {
    key: "flow",
    label: "Fluxo de Atendimento",
    icon: <Route className="w-4 h-4" />,
    placeholder:
      "Como deve ser o fluxo da conversa? Etapas, quando avancar, quando recuar?\n\nEx:\n1. Saudacao + entender contexto\n2. Identificar dor principal (1-2 perguntas)\n3. Apresentar solucao alinhada a dor\n4. Se interesse, agendar reuniao\n5. Se objecao, contornar com case de sucesso\n6. Se nao qualificado, agradecer e encerrar",
    minHeight: "min-h-[140px]",
  },
  {
    key: "instructions",
    label: "Instrucoes (Do's e Don'ts)",
    icon: <ShieldCheck className="w-4 h-4" />,
    placeholder:
      "Regras rigidas. O que DEVE fazer e o que NUNCA deve fazer.\n\nEx:\n- Faca no maximo 1 pergunta por mensagem\n- Sempre use o nome do lead\n- Nunca mencione concorrentes\n- Nunca invente dados ou precos\n- Se nao souber, diga que vai verificar",
    minHeight: "min-h-[120px]",
  },
];

// =====================================================
// PROPS
// =====================================================

interface PromptEditorProps {
  sections: PromptSections;
  onSectionsChange: (sections: PromptSections) => void;
  tools: Record<string, PlaygroundToolState>;
  toolDefs: PlaygroundToolDef[];
  documents: KnowledgeDocument[];
  links: KnowledgeLink[];
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function PromptEditor({
  sections,
  onSectionsChange,
  tools,
  toolDefs,
  documents,
  links,
  isExpanded,
  onToggleExpand,
}: PromptEditorProps) {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [activeMention, setActiveMention] = useState<{
    sectionKey: string;
    startPos: number;
    search: string;
  } | null>(null);

  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Total char count
  const totalChars = useMemo(() => {
    return Object.values(sections).reduce((sum, v) => sum + v.length, 0);
  }, [sections]);

  // Build mention items
  const mentionItems = useMemo<MentionItem[]>(() => {
    const items: MentionItem[] = [];
    for (const def of toolDefs) {
      if (tools[def.id]?.enabled) {
        items.push({ type: "tool", id: def.id, label: def.name, icon: def.icon });
      }
    }
    for (const doc of documents) {
      items.push({ type: "document", id: doc.id, label: doc.name });
    }
    for (const link of links) {
      items.push({ type: "link", id: link.id, label: link.alias });
    }
    return items;
  }, [tools, toolDefs, documents, links]);

  const filteredMentions = useMemo(() => {
    if (!activeMention) return mentionItems;
    const q = activeMention.search.toLowerCase();
    if (!q) return mentionItems;
    return mentionItems.filter(
      (item) => item.label.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)
    );
  }, [mentionItems, activeMention]);

  // Toggle section collapse
  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Update a single section
  const updateSection = useCallback(
    (key: keyof PromptSections, value: string) => {
      onSectionsChange({ ...sections, [key]: value });
    },
    [sections, onSectionsChange]
  );

  // Handle textarea change with @ detection
  const handleChange = useCallback(
    (sectionKey: keyof PromptSections, e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursorPos = e.target.selectionStart;
      updateSection(sectionKey, newValue);

      // Check @ trigger
      if (cursorPos > 0 && newValue[cursorPos - 1] === "@") {
        const charBefore = cursorPos > 1 ? newValue[cursorPos - 2] : " ";
        if (charBefore === " " || charBefore === "\n" || cursorPos === 1) {
          setActiveMention({ sectionKey, startPos: cursorPos, search: "" });
          return;
        }
      }

      // Update search if mention active
      if (activeMention && activeMention.sectionKey === sectionKey) {
        const searchText = newValue.slice(activeMention.startPos, cursorPos);
        if (searchText.includes(" ") || searchText.includes("\n")) {
          setActiveMention(null);
        } else {
          setActiveMention({ ...activeMention, search: searchText });
        }
      }
    },
    [updateSection, activeMention]
  );

  // Handle mention selection
  const handleSelectMention = useCallback(
    (item: MentionItem) => {
      if (!activeMention) return;
      const ta = textareaRefs.current[activeMention.sectionKey];
      if (!ta) return;

      const sectionKey = activeMention.sectionKey as keyof PromptSections;
      const currentValue = sections[sectionKey];
      const before = currentValue.slice(0, activeMention.startPos - 1);
      const after = currentValue.slice(ta.selectionStart);
      const mentionText = `@${item.id}`;
      const newValue = `${before}${mentionText} ${after}`;

      updateSection(sectionKey, newValue);
      setActiveMention(null);

      setTimeout(() => {
        if (ta) {
          const newPos = before.length + mentionText.length + 1;
          ta.focus();
          ta.setSelectionRange(newPos, newPos);
        }
      }, 0);
    },
    [activeMention, sections, updateSection]
  );

  // Handle keyboard
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape" && activeMention) {
        e.preventDefault();
        setActiveMention(null);
      }
      if (e.key === "Escape" && isExpanded) {
        e.preventDefault();
        onToggleExpand();
      }
    },
    [activeMention, isExpanded, onToggleExpand]
  );

  // Insert @ manually
  const handleAtInsert = useCallback(
    (sectionKey: keyof PromptSections) => {
      const ta = textareaRefs.current[sectionKey];
      if (!ta) return;
      const cursorPos = ta.selectionStart;
      const currentValue = sections[sectionKey];
      const before = currentValue.slice(0, cursorPos);
      const after = currentValue.slice(cursorPos);
      const newValue = `${before}@${after}`;
      updateSection(sectionKey, newValue);

      setTimeout(() => {
        ta.focus();
        const newPos = cursorPos + 1;
        ta.setSelectionRange(newPos, newPos);
        setActiveMention({ sectionKey, startPos: newPos, search: "" });
      }, 0);
    },
    [sections, updateSection]
  );

  return (
    <div className={`relative flex flex-col ${isExpanded ? "flex-1" : ""}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 rounded-t-lg">
        <span className="text-sm font-medium text-muted-foreground">Prompt do Agente</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{totalChars} chars</span>
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

      {/* Sections */}
      <div className="divide-y">
        {SECTIONS.map((section) => {
          const isCollapsed = collapsedSections[section.key] ?? false;
          const hasContent = sections[section.key].length > 0;

          return (
            <div key={section.key} className="relative">
              {/* Section Header */}
              <button
                type="button"
                onClick={() => toggleSection(section.key)}
                className="flex items-center gap-2 w-full px-4 py-2.5 text-left hover:bg-muted/40 transition-colors"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="text-muted-foreground shrink-0">{section.icon}</span>
                <span className="text-sm font-medium">{section.label}</span>
                {hasContent && isCollapsed && (
                  <span className="text-xs text-muted-foreground truncate ml-2 max-w-[300px]">
                    {sections[section.key].slice(0, 60)}...
                  </span>
                )}
                {!isCollapsed && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 gap-1 text-xs ml-auto"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAtInsert(section.key);
                    }}
                  >
                    <AtSign className="w-3 h-3" />
                  </Button>
                )}
              </button>

              {/* Section Textarea */}
              {!isCollapsed && (
                <div className="relative px-4 pb-3">
                  <textarea
                    ref={(el) => {
                      textareaRefs.current[section.key] = el;
                    }}
                    value={sections[section.key]}
                    onChange={(e) => handleChange(section.key, e)}
                    onKeyDown={handleKeyDown}
                    onBlur={() => {
                      setTimeout(() => setActiveMention(null), 200);
                    }}
                    placeholder={section.placeholder}
                    className={`w-full resize-none bg-muted/20 rounded-lg p-3 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/30 border border-border/50 ${section.minHeight}`}
                    style={{ fontFamily: "inherit" }}
                  />

                  {/* Mention dropdown for this section */}
                  {activeMention?.sectionKey === section.key && (
                    <div className="absolute left-4 top-12 z-50 w-72 rounded-lg border bg-popover shadow-md">
                      <Command>
                        <CommandInput
                          placeholder="Buscar tool ou documento..."
                          value={activeMention.search}
                          onValueChange={(v) =>
                            setActiveMention({ ...activeMention, search: v })
                          }
                        />
                        <CommandList>
                          <CommandEmpty>Nenhum item encontrado</CommandEmpty>

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
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
