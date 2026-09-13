export interface UazapiButtonsFields {
  raw_payload?: unknown;
  uazapi_interactive_display?: unknown;
  uazapi_native_buttons?: unknown;
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max = 4096) => typeof value === 'string' && value.length <= max ? value.trim() : '';

/** Narrow display metadata; labels are text, never executable actions or HTML. */
export function readUazapiButtons(fields: UazapiButtonsFields) {
  const raw = object(fields.raw_payload);
  const display = object(fields.uazapi_interactive_display ?? raw.torqueInteractive);
  if (display.type === 'button' && Array.isArray(display.options)) {
    const options = display.options.slice(0, 10).map(value => text(value, 256)).filter(Boolean);
    if (options.length) return { text: text(display.text), options };
  }
  const content = object(raw.content);
  const native = object(object(content.InteractiveMessage).NativeFlowMessage);
  const buttons = fields.uazapi_native_buttons ?? native.buttons;
  if (!Array.isArray(buttons)) return null;
  const options: string[] = [];
  for (const value of buttons.slice(0, 10)) {
    const button = object(value);
    if (button.name !== 'quick_reply') continue;
    const params = button.buttonParamsJSON ?? button.buttonParamsJson;
    if (typeof params !== 'string' || params.length > 16384) continue;
    try {
      const label = text(object(JSON.parse(params)).display_text, 256);
      if (label) options.push(label);
    } catch { /* Ignore malformed provider metadata. */ }
  }
  return options.length ? { text: '', options } : null;
}
