export function SocialProof() {
  return (
    <section id="prova" className="py-24 relative z-10">
      <div className="max-w-7xl mx-auto px-6">

        {/* Metrics glass card */}
        <div className="glass glass-card-border rounded-3xl p-10 lg:p-16">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-4 text-center">
            <div className="reveal">
              <div className="font-display text-5xl lg:text-6xl font-semibold gradient-text-orange">2400+</div>
              <div className="text-mute text-sm mt-2">Empresas ativas</div>
            </div>
            <div className="reveal">
              <div className="font-display text-5xl lg:text-6xl font-semibold gradient-text-orange">184M</div>
              <div className="text-mute text-sm mt-2">Em pipeline gerenciado</div>
            </div>
            <div className="reveal">
              <div className="font-display text-5xl lg:text-6xl font-semibold gradient-text-orange">38%</div>
              <div className="text-mute text-sm mt-2">&#8593; taxa de conversão média</div>
            </div>
            <div className="reveal">
              <div className="font-display text-5xl lg:text-6xl font-semibold gradient-text-orange">14h</div>
              <div className="text-mute text-sm mt-2">Economizadas por vendedor/sem.</div>
            </div>
          </div>
        </div>

        {/* Testimonials */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-16">

          {/* Marina Fernandes */}
          <div className="testi-card reveal">
            <div className="flex gap-1 mb-4">
              {[...Array(5)].map((_, i) => (
                <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill="#ed9326"><polygon points="12 2 15 8.5 22 9.5 17 14 18 21 12 17.5 6 21 7 14 2 9.5 9 8.5 12 2" /></svg>
              ))}
            </div>
            <p className="text-cream/90 leading-relaxed">
              &ldquo;Trocamos 3 ferramentas pelo TorqueCRM. Em 60 dias, batemos
              a maior meta da história da empresa. O forecast finalmente confiável.&rdquo;
            </p>
            <div className="mt-6 pt-6 border-t border-white/5 flex items-center gap-3">
              <div className="avatar w-10 h-10 text-sm" style={{ background: 'linear-gradient(135deg,#ed9326,#ffd400)' }}>MF</div>
              <div>
                <div className="text-sm font-medium">Marina Fernandes</div>
                <div className="text-xs text-mute">Head of Sales · Vortex Tech</div>
              </div>
            </div>
          </div>

          {/* Carlos Reis */}
          <div className="testi-card reveal">
            <div className="flex gap-1 mb-4">
              {[...Array(5)].map((_, i) => (
                <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill="#ed9326"><polygon points="12 2 15 8.5 22 9.5 17 14 18 21 12 17.5 6 21 7 14 2 9.5 9 8.5 12 2" /></svg>
              ))}
            </div>
            <p className="text-cream/90 leading-relaxed">
              &ldquo;A automação de qualificação por IA é absurda. Liberamos
              o time de SDR pra focar no que importa: fechar.&rdquo;
            </p>
            <div className="mt-6 pt-6 border-t border-white/5 flex items-center gap-3">
              <div className="avatar w-10 h-10 text-sm" style={{ background: 'linear-gradient(135deg,#a855f7,#ed9326)' }}>CR</div>
              <div>
                <div className="text-sm font-medium">Carlos Reis</div>
                <div className="text-xs text-mute">CEO · Helix Corp</div>
              </div>
            </div>
          </div>

          {/* Patrícia Alves */}
          <div className="testi-card reveal">
            <div className="flex gap-1 mb-4">
              {[...Array(5)].map((_, i) => (
                <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill="#ed9326"><polygon points="12 2 15 8.5 22 9.5 17 14 18 21 12 17.5 6 21 7 14 2 9.5 9 8.5 12 2" /></svg>
              ))}
            </div>
            <p className="text-cream/90 leading-relaxed">
              &ldquo;Implantação em 5 dias. Suporte que responde em minutos.
              Vale cada centavo do plano premium.&rdquo;
            </p>
            <div className="mt-6 pt-6 border-t border-white/5 flex items-center gap-3">
              <div className="avatar w-10 h-10 text-sm" style={{ background: 'linear-gradient(135deg,#3b82f6,#ffd400)' }}>PA</div>
              <div>
                <div className="text-sm font-medium">Patrícia Alves</div>
                <div className="text-xs text-mute">CRO · Norden Indústria</div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
