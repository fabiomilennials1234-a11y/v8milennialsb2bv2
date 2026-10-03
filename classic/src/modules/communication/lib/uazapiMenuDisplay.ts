export interface UazapiMenuFields {
  raw_payload?: unknown;
  uazapi_menu_sections?: unknown;
  uazapi_menu_title?: unknown;
  uazapi_menu_description?: unknown;
  uazapi_menu_button?: unknown;
  uazapi_menu_footer?: unknown;
}
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown): string => typeof v === "string" ? v.trim() : "";

/** Read only the menu projection, never provider credentials or the full payload. */
export function readUazapiMenu(fields: UazapiMenuFields) {
  // Realtime rows have raw_payload; SELECT uses narrow JSON projections.
  const content = object(object(fields.raw_payload).content);
  const rawSections = fields.uazapi_menu_sections ?? content.sections;
  if (!Array.isArray(rawSections)) return null;
  const sections = rawSections.map(section => {
    const s = object(section);
    return {
      title: text(s.title),
      rows: Array.isArray(s.rows) ? s.rows.map(row => {
        const r = object(row);
        return { title: text(r.title), description: text(r.description) };
      }).filter(row => row.title) : [],
    };
  }).filter(section => section.rows.length);
  if (!sections.length) return null;
  return { sections, title: text(fields.uazapi_menu_title ?? content.title), description: text(fields.uazapi_menu_description ?? content.description), button: text(fields.uazapi_menu_button ?? content.buttonText) || "Ver opções", footer: text(fields.uazapi_menu_footer ?? content.footerText) };
}
