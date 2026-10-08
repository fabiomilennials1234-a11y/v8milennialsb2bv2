/**
 * Utilitários para serialização/parse das Instruções Personalizadas (Do's & Don'ts)
 *
 * O campo custom_instructions no banco é TEXT.
 * Armazenamos como JSON: {"dos": "...", "donts": "..."}.
 * Backward compat: se for uma string plana, trata como "dos".
 */

export interface CustomInstructionsData {
  dos: string;
  donts: string;
}

/**
 * Parseia o valor armazenado no banco para { dos, donts }.
 * Suporta tanto JSON novo quanto string legada.
 */
export function parseCustomInstructions(
  raw: string | null | undefined
): CustomInstructionsData {
  if (!raw || raw.trim() === "") return { dos: "", donts: "" };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && ("dos" in parsed || "donts" in parsed)) {
      return {
        dos: typeof parsed.dos === "string" ? parsed.dos : "",
        donts: typeof parsed.donts === "string" ? parsed.donts : "",
      };
    }
  } catch {
    // Backward compat: string plana vira "dos"
  }
  return { dos: raw, donts: "" };
}

/**
 * Serializa { dos, donts } para armazenamento no banco.
 * Retorna null se ambos estiverem vazios.
 */
export function serializeCustomInstructions(
  dos: string,
  donts: string
): string | null {
  const d = dos.trim();
  const dt = donts.trim();
  if (!d && !dt) return null;
  return JSON.stringify({ dos: d, donts: dt });
}
