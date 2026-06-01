/**
 * avatarGradient — gradiente determinístico por contato para avatares do chat.
 *
 * Mapeia o nome (hash simples) para 1 de N gradientes coloridos. Mesma string →
 * sempre o mesmo gradiente (estável entre renders e sessões).
 *
 * 100% visual: usado só em `style={{ background }}` dos avatares. Sem lógica de
 * negócio, sem deps externas. O primeiro gradiente é o laranja da marca
 * (`--gradient-gold`), os demais são acentos derivados da referência do mockup.
 *
 * `ink` indica se as iniciais devem usar tinta escura (#1c1c1c) sobre fundos
 * claros/saturados (laranja/amarelo) ou branco sobre os demais.
 */

export interface AvatarGradient {
  /** CSS `background` (linear-gradient) aplicado direto no círculo. */
  background: string;
  /** True → iniciais escuras (ink). False → iniciais brancas. */
  ink: boolean;
}

// Paleta derivada do mockup. Index 0 = laranja da marca (gradient-gold).
const GRADIENTS: AvatarGradient[] = [
  // Brand orange → yellow (mockup accent) — texto ink
  { background: "linear-gradient(135deg, hsl(31 85% 53%) 0%, hsl(47 100% 50%) 100%)", ink: true },
  // Roxo
  { background: "linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)", ink: false },
  // Azul
  { background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)", ink: false },
  // Verde
  { background: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)", ink: false },
  // Vermelho
  { background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)", ink: false },
  // Âmbar/dourado — texto ink
  { background: "linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)", ink: true },
];

/** Hash determinístico simples (djb2-ish) → inteiro não-negativo. */
function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0; // força int 32-bit
  }
  return Math.abs(hash);
}

/**
 * Retorna o gradiente determinístico para um nome/identificador de contato.
 * Strings vazias caem no gradiente da marca (index 0).
 */
export function getAvatarGradient(seed: string): AvatarGradient {
  const key = (seed || "").trim();
  if (!key) return GRADIENTS[0];
  return GRADIENTS[hashString(key) % GRADIENTS.length];
}
