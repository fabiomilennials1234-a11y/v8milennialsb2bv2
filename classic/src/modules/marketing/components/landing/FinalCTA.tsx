export function FinalCTA() {
  return (
    <section className="py-24 lg:py-32 relative z-10 overflow-hidden">
      <div className="cta-glow"></div>
      <div className="max-w-7xl mx-auto px-6 relative">
        <div className="text-center max-w-4xl mx-auto reveal">
          <h2 className="font-display text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight leading-[1.02]">
            Acelere sua operação<br />com o <span className="gradient-text-orange">CRM de alta performance</span>.
          </h2>
          <p className="text-mute text-lg lg:text-xl mt-6 max-w-2xl mx-auto leading-relaxed">
            Comece em 5 minutos. Sem cartão. Sem complicação.
            Veja por que 2.400+ empresas escolheram o TorqueCRM.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a href="/auth" className="btn-primary rounded-full px-8 py-4 inline-flex items-center gap-2 text-base font-semibold">
              Vem ser Torque
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </a>
            <a href="#" className="btn-ghost rounded-full px-8 py-4 inline-flex items-center gap-2 text-base">
              Agendar demonstração
            </a>
          </div>

          {/* Micro stats */}
          <div className="mt-14 grid grid-cols-3 gap-4 max-w-2xl mx-auto">
            <div>
              <div className="font-display text-2xl font-semibold gradient-text-orange">5 min</div>
              <div className="text-xs text-mute mt-1">Setup completo</div>
            </div>
            <div>
              <div className="font-display text-2xl font-semibold gradient-text-orange">$30M</div>
              <div className="text-xs text-mute mt-1">gerados no último mês</div>
            </div>
            <div>
              <div className="font-display text-2xl font-semibold gradient-text-orange">24/7</div>
              <div className="text-xs text-mute mt-1">Suporte humano</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
