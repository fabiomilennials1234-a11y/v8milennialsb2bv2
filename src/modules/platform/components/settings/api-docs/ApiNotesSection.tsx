import { Info } from "lucide-react";

interface ApiNotesSectionProps {
  notes: string[];
}

export function ApiNotesSection({ notes }: ApiNotesSectionProps) {
  if (!notes.length) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Info className="w-4 h-4 text-blue-400" />
        Notas
      </h4>
      <div className="p-4 rounded-lg border border-blue-500/20 bg-blue-500/5">
        <ul className="space-y-2">
          {notes.map((note, i) => (
            <li key={i} className="flex gap-2 text-[13px] text-muted-foreground leading-relaxed">
              <span className="text-blue-400 mt-0.5 shrink-0">&#x2022;</span>
              {note}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
