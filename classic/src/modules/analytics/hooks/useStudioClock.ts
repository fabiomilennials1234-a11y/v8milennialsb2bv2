import { useEffect, useState } from "react";

/** Atualiza os presets também numa tela deixada aberta durante a virada do mês. */
export function useStudioClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  return now;
}
