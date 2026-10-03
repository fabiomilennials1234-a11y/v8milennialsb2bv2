/** PROTOTYPE — wipe me. Floating variant switcher. Hidden in prod builds. */
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

const VARIANTS: Record<string, string> = {
  A: "NOC — status board",
  B: "Stream — timeline + filtros",
  C: "Triage — fila de ação",
};

export function Switcher() {
  const [params, setParams] = useSearchParams();
  const keys = Object.keys(VARIANTS);
  const current = params.get("variant") ?? "A";

  const go = (dir: number) => {
    const i = keys.indexOf(current);
    const next = keys[(i + dir + keys.length) % keys.length];
    const p = new URLSearchParams(params);
    p.set("variant", next);
    setParams(p, { replace: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD) return null;

  return (
    <div className="fixed bottom-5 left-1/2 z-[9999] -translate-x-1/2">
      <div className="flex items-center gap-1 rounded-full border border-white/15 bg-zinc-900/95 px-1.5 py-1.5 shadow-2xl ring-1 ring-amber-400/30 backdrop-blur">
        <button onClick={() => go(-1)} className="grid h-8 w-8 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="px-3 text-center font-mono text-xs text-white/90">
          <span className="font-bold text-amber-400">{current}</span>
          <span className="mx-1.5 text-white/30">·</span>
          {VARIANTS[current]}
        </div>
        <button onClick={() => go(1)} className="grid h-8 w-8 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
