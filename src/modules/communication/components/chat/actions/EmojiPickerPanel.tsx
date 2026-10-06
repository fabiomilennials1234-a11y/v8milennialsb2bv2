import { useMemo, useState } from "react";
import { Clock3, Flag, Flower2, Heart, Lightbulb, Plane, Search, Smile, Trophy, Utensils, Hand } from "lucide-react";
import emojiData from "emojibase-data/pt/compact.json";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Emoji {
  unicode: string;
  label: string;
  hexcode: string;
  group?: number;
  tags?: string[];
  skins?: Emoji[];
}

const categories = [
  { id: -1, label: "Recentes", icon: Clock3 },
  { id: 0, label: "Carinhas e emoções", icon: Smile },
  { id: 1, label: "Pessoas e gestos", icon: Hand },
  { id: 3, label: "Animais e natureza", icon: Flower2 },
  { id: 4, label: "Comidas e bebidas", icon: Utensils },
  { id: 5, label: "Viagens e lugares", icon: Plane },
  { id: 6, label: "Atividades", icon: Trophy },
  { id: 7, label: "Objetos", icon: Lightbulb },
  { id: 8, label: "Símbolos", icon: Heart },
  { id: 9, label: "Bandeiras", icon: Flag },
];
const RECENTS_KEY = "torque:emoji-recents";
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
// Standalone components (regional letters, modifiers, hair) only belong inside
// a complete emoji sequence, not in the picker as separate messages.
const emojis: Emoji[] = emojiData.filter((emoji) => emoji.group !== undefined && emoji.group !== 2);
const allEmojis = emojis.flatMap((emoji) => [emoji, ...(emoji.skins ?? [])]);
const byUnicode = new Map(allEmojis.map((emoji) => [emoji.unicode, emoji]));
const searchText = new Map(allEmojis.map((emoji) => [emoji.unicode, normalize([emoji.label, ...(emoji.tags ?? [])].join(" "))]));

function readRecents(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(stored)
      ? stored.filter((value): value is string => typeof value === "string" && byUnicode.has(value)).slice(0, 24)
      : [];
  } catch {
    return [];
  }
}

export default function EmojiPickerPanel({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(0);
  const [tone, setTone] = useState("0");
  const [recents, setRecents] = useState(readRecents);
  const searching = query.trim().length > 0;

  const visible = useMemo(() => {
    const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
    if (!searching && category === -1) return recents.flatMap((unicode) => byUnicode.get(unicode) ?? []);
    return emojis.filter((emoji) => searching || emoji.group === category).flatMap((emoji) => {
      const variants = [emoji, ...(emoji.skins ?? [])];
      // Search reaches all variations, including mixed skin tones, regardless
      // of the selected category/tone. Pasting an emoji also finds it.
      if (searching) {
        return variants.filter((variant) => terms.every((term) =>
          variant.unicode.includes(term) || searchText.get(variant.unicode)?.includes(term),
        ));
      }
      if (tone === "all") return variants;
      if (tone === "0" || !emoji.skins?.length) return [emoji];
      const modifier = String.fromCodePoint(0x1f3fa + Number(tone));
      return [emoji.skins.find((skin) => {
        const modifiers = skin.unicode.match(/[\u{1F3FB}-\u{1F3FF}]/gu);
        return modifiers?.length && modifiers.every((value) => value === modifier);
      }) ?? emoji];
    });
  }, [category, query, recents, searching, tone]);

  const select = (emoji: Emoji) => {
    const next = [emoji.unicode, ...recents.filter((value) => value !== emoji.unicode)].slice(0, 24);
    setRecents(next);
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* Storage can be disabled. */ }
    onSelect(emoji.unicode);
  };

  return (
    <div className="w-full space-y-2 p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
        <Input autoFocus aria-label="Buscar emoji" placeholder="Buscar emoji..." value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 pl-9" />
      </div>
      <div className="flex pb-1" aria-label="Categorias de emojis">
        {categories.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" title={label} aria-label={label} aria-pressed={!searching && category === id}
            onClick={() => { setCategory(id); setQuery(""); }}
            className={cn("flex h-10 min-w-0 flex-1 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", !searching && category === id && "bg-primary/15 text-primary")}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground" aria-live="polite">
          {searching ? "Resultados" : categories.find(({ id }) => id === category)?.label}
        </p>
        <select aria-label="Tom de pele" value={tone} onChange={(event) => setTone(event.target.value)} className="h-8 min-w-0 rounded-md border border-border bg-popover px-1 text-xs focus-visible:ring-2 focus-visible:ring-ring">
          <option value="0">✋ Padrão</option>
          <option value="1">✋🏻 Claro</option>
          <option value="2">✋🏼 Médio claro</option>
          <option value="3">✋🏽 Médio</option>
          <option value="4">✋🏾 Médio escuro</option>
          <option value="5">✋🏿 Escuro</option>
          <option value="all">Todos os tons</option>
        </select>
      </div>
      <div key={`${category}:${query}:${tone}`} className="h-60 overflow-y-auto overscroll-contain" aria-label="Emojis">
        {visible.length ? (
          <div className="grid grid-cols-8 gap-0.5">
            {visible.map((emoji) => (
              <button key={emoji.hexcode} type="button" aria-label={emoji.label} title={emoji.label} onClick={() => select(emoji)}
                className="flex h-10 min-w-0 items-center justify-center rounded-lg text-2xl hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [font-family:'Noto_Color_Emoji','Apple_Color_Emoji','Segoe_UI_Emoji',sans-serif]"
              >
                {emoji.unicode}
              </button>
            ))}
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground" role="status">
            {searching ? "Nenhum emoji encontrado." : "Os emojis que você usar aparecerão aqui."}
          </p>
        )}
      </div>
    </div>
  );
}
