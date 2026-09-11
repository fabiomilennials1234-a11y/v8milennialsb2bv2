/** Canonical origin labels and colors, independent of UI dependencies. */
const origem = (h: number, s: number, label: string) => ({
  bg: `hsl(${h} ${s}% 50% / 0.14)`,
  text: `hsl(${h} ${s}% var(--origin-ink-l))`,
  label,
});

export const ORIGIN_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  whatsapp:        origem(162, 60, "WhatsApp"),
  meta_ads:        origem(246, 48, "Meta Ads"),
  instagram:       origem(333, 62, "Instagram"),
  tiktok:          { bg: "hsl(var(--muted))", text: "hsl(var(--muted-foreground))", label: "Tiktok" },
  google_ads:      origem(0, 55, "Google Ads"),
  site:            origem(209, 62, "Site"),
  landing_page:    origem(201, 70, "Landing Page"),
  remarketing:     origem(31, 75, "Remarketing"),
  indicacao:       origem(89, 58, "Indicação"),
  evento:          origem(263, 62, "Evento"),
  prospeccao_ativa:origem(20, 72, "Prospecção Ativa"),
  cal:             origem(263, 70, "Cal.com"),
  outro:           origem(45, 6, "Outros"),
};

