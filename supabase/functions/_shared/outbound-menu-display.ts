/** Minimal list display metadata, derived from the documented /send/menu choices. */
export function outboundMenuDisplay(menu: {
  type: string;
  choices: string[];
  footer?: string;
  listButtonLabel?: string;
} | undefined, text: string | null) {
  if (menu?.type !== "list") return undefined;
  const sections: { title: string; rows: { title: string; description: string }[] }[] = [];
  for (const choice of menu.choices) {
    const value = choice.trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      sections.push({ title: value.slice(1, -1), rows: [] });
    } else {
      const [title, , description = ""] = value.split("|");
      if (!title) continue;
      if (!sections.length) sections.push({ title: "", rows: [] });
      sections[sections.length - 1].rows.push({ title, description });
    }
  }
  return { source: "torque_outbound_display", content: {
    description: text, sections: sections.filter(section => section.rows.length),
    buttonText: menu.listButtonLabel ?? "Ver opções", footerText: menu.footer ?? "",
  } };
}
