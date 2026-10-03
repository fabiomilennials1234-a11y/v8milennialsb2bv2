/**
 * Espera do cliente no Comando — curta e exata ("6 min", "1 h 35 min",
 * "3 dias"). A partir de uma hora é `longa`: é o que pinta a linha de vermelho.
 */
export function esperaCurta(iso: string | null | undefined, agora = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const min = Math.max(0, Math.round((agora - t) / 60_000));
  if (min < 60) return { valor: String(min), unidade: "min", texto: `${min} min`, longa: false };
  const h = Math.floor(min / 60);
  if (h < 24) {
    const resto = min % 60;
    return { valor: String(h), unidade: resto ? `h ${resto} min` : "h", texto: resto ? `${h} h ${resto} min` : `${h} h`, longa: true };
  }
  const d = Math.floor(h / 24);
  return { valor: String(d), unidade: d === 1 ? "dia" : "dias", texto: `${d} ${d === 1 ? "dia" : "dias"}`, longa: true };
}
