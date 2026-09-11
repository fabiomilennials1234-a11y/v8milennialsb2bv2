export interface UazapiMenuFields {
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
  if (!Array.isArray(fields.uazapi_menu_sections)) return null;
  const sections = fields.uazapi_menu_sections.map(section => {
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
  return { sections, title: text(fields.uazapi_menu_title), description: text(fields.uazapi_menu_description), button: text(fields.uazapi_menu_button) || "Ver opções", footer: text(fields.uazapi_menu_footer) };
}
