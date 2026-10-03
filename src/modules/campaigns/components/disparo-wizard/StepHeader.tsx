/**
 * StepHeader — shared heading for each Wizard Linear step (#904).
 * Editorial, generous, one decision per screen. Kicker · title · subtitle.
 */
interface StepHeaderProps {
  kicker: string;
  title: string;
  subtitle: string;
}

export function StepHeader({ kicker, title, subtitle }: StepHeaderProps) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-[.08em] text-primary-soft-foreground">
        {kicker}
      </p>
      <h2 className="text-2xl font-extrabold leading-tight tracking-[-0.03em] text-foreground">
        {title}
      </h2>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
        {subtitle}
      </p>
    </div>
  );
}
