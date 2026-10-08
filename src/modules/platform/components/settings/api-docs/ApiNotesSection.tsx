import { Info } from "lucide-react";

interface ApiNotesSectionProps {
  notes: string[];
}

export function ApiNotesSection({ notes }: ApiNotesSectionProps) {
  if (!notes.length) return null;

  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
        <Info className="h-4 w-4 text-insights" />
        Notas
      </h4>
      <div className="rounded-xl border border-insights/20 bg-insights/5 p-4">
        <ul className="space-y-2">
          {notes.map((note, i) => (
            <li key={i} className="flex gap-2 text-[13px] text-muted-foreground leading-relaxed">
              <span className="mt-0.5 shrink-0 text-insights">&#x2022;</span>
              {note}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
