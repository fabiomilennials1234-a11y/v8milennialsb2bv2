import { ArrowUpRight, Gauge, Settings2, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

const PLANS = [
  {
    name: 'Basic',
    stage: '01 / Partida',
    description: 'O próximo passo da sua operação comercial começa aqui.',
    price: '297',
    icon: Gauge,
    featured: false,
  },
  {
    name: '2.0 Automation',
    stage: '02 / Aceleração',
    description: 'Mais ritmo para sua operação. Mais espaço para crescer.',
    price: '997',
    icon: Zap,
    featured: true,
  },
  {
    name: 'V8 Remap',
    stage: '03 / Performance',
    description: 'Converse com nosso time e encontre a configuração para sua empresa.',
    price: null,
    icon: Settings2,
    featured: false,
  },
] as const;

export function PricingSection() {
  return (
    <section id="planos" aria-labelledby="plans-title" className="relative z-10 scroll-mt-24 py-24 lg:py-32">
      <div className="max-w-7xl mx-auto px-6">
        <div className="max-w-3xl mb-12 lg:mb-16">
          <p className="text-orange text-xs font-semibold uppercase tracking-[0.2em] mb-5">Planos</p>
          <h2 id="plans-title" className="font-display text-4xl sm:text-5xl lg:text-6xl font-semibold leading-[1.08] tracking-tight">
            Seu próximo nível.<br />
            <span className="gradient-text-orange">Seu Torque.</span>
          </h2>
          <p className="text-cream/70 text-lg mt-6">Três planos para escolher como sua operação vai acelerar.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-6">
          {PLANS.map(({ name, stage, description, price, icon: Icon, featured }) => (
            <article key={name} className={`plan-card flex flex-col rounded-3xl p-7 sm:p-9 ${featured ? 'plan-card-featured' : ''}`}>
              <div className="flex items-center justify-between gap-4 mb-10">
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-cream/60">{stage}</span>
                <Icon aria-hidden="true" className="h-6 w-6 text-orange" strokeWidth={1.5} />
              </div>
              <h3 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">{name}</h3>
              <p className="text-sm leading-relaxed text-cream/70 mt-4 lg:min-h-[4.5rem]">{description}</p>
              <div className="mt-10 mb-10 border-t border-white/10 pt-8">
                {price ? (
                  <p className="flex items-baseline gap-2">
                    <span className="text-lg text-cream/70">R$</span>
                    <span className="font-display text-6xl font-semibold tracking-tight tabular-nums">{price}</span>
                  </p>
                ) : (
                  <p className="font-display text-5xl font-semibold tracking-tight leading-[1.2]">Consultar</p>
                )}
              </div>
              {price ? (
                <Link to="/auth" aria-label={`Começar com ${name}`} className={`plan-action mt-auto rounded-full py-4 px-5 inline-flex items-center justify-between gap-3 font-semibold ${featured ? 'btn-primary' : 'btn-ghost'}`}>
                  Começar agora <ArrowUpRight aria-hidden="true" className="h-5 w-5" />
                </Link>
              ) : (
                <a href={`mailto:contato@torquecrm.com.br?subject=${encodeURIComponent('Quero conhecer o plano V8 Remap')}`} className="plan-action btn-ghost mt-auto rounded-full py-4 px-5 inline-flex items-center justify-between gap-3 font-semibold">
                  Consultar plano <ArrowUpRight aria-hidden="true" className="h-5 w-5" />
                </a>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
