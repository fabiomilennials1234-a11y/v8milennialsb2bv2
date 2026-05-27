import { Link } from 'react-router-dom';

export function HeroSection() {
  return (
    <section
      id="hero"
      className="relative pt-36 pb-24 lg:pt-44 lg:pb-32 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-16 items-center">
        {/* Left column — copy */}
        <div className="flex flex-col gap-6">
          {/* Pill badge */}
          <div className="hero-pill inline-flex items-center gap-2 self-start px-4 py-1.5 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
            <span className="text-xs font-medium text-white/80">
              Novo &middot; Automação com IA para times comerciais
            </span>
          </div>

          {/* Headline */}
          <h1 className="hero-title text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.1] tracking-tight text-white">
            O CRM com torque para escalar vendas{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-yellow-400">
              de verdade.
            </span>
          </h1>

          {/* Subtitle */}
          <p className="hero-sub text-lg text-white/60 max-w-lg leading-relaxed">
            Pipeline inteligente, WhatsApp nativo e agentes IA que qualificam, agendam e fazem follow-up — enquanto seu time foca em fechar.
          </p>

          {/* CTAs */}
          <div className="hero-cta flex flex-wrap items-center gap-4 pt-2">
            <Link
              to="/auth"
              className="btn-primary inline-flex items-center gap-2 px-7 py-3.5 rounded-full text-base font-semibold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
            >
              Vem ser Torque
              <svg
                width="16"
                height="16"
                viewBox="0 0 14 14"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M1 7h12m0 0L8 2m5 5L8 12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
            <a
              href="#showcase"
              className="btn-ghost inline-flex items-center gap-2 px-6 py-3.5 rounded-full text-base font-medium text-white/80 border border-white/15 bg-white/5 backdrop-blur-sm hover:bg-white/10 transition-all"
            >
              Ver demonstração
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M4 1l8 6-8 6V1z"
                  fill="currentColor"
                />
              </svg>
            </a>
          </div>

          {/* Trust microcopy */}
          <div className="hero-trust flex flex-wrap items-center gap-5 pt-4 text-sm text-white/50">
            <span className="inline-flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 7.5l3 3 7-7" stroke="#34c759" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Sem cartão de crédito
            </span>
            <span className="inline-flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 7.5l3 3 7-7" stroke="#34c759" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Setup em 5 minutos
            </span>
            <span className="inline-flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 7.5l3 3 7-7" stroke="#34c759" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Cancele quando quiser
            </span>
          </div>
        </div>

        {/* Right column — 3D logo stage */}
        <div className="hero-logo-stage relative flex items-center justify-center" style={{ '--tilt-x': '0deg', '--tilt-y': '0deg' } as React.CSSProperties}>
          {/* Glow far */}
          <div className="logo-glow-far absolute inset-0 rounded-full opacity-40 blur-3xl bg-gradient-to-br from-orange-500/30 to-yellow-400/20" />

          {/* Rings */}
          <div className="logo-ring-1 absolute inset-4 rounded-full border border-white/5 animate-spin-slow" style={{ animationDuration: '20s' }} />
          <div className="logo-ring-2 absolute inset-10 rounded-full border border-white/8 animate-spin-slow" style={{ animationDuration: '30s', animationDirection: 'reverse' }} />
          <div className="logo-ring-3 absolute inset-16 rounded-full border border-orange-400/10 animate-spin-slow" style={{ animationDuration: '40s' }} />

          {/* Glow inner */}
          <div className="logo-glow-inner absolute w-40 h-40 rounded-full bg-orange-500/20 blur-2xl" />

          {/* 3D Logo container */}
          <div
            className="hero-logo-3d relative w-48 h-48 lg:w-64 lg:h-64"
            style={{ transformStyle: 'preserve-3d', transform: 'rotateX(var(--tilt-x)) rotateY(var(--tilt-y))' }}
          >
            {/* Back face */}
            <img
              src="/landing/TORQUE_Logo_Icone.png"
              alt=""
              className="logo-back absolute inset-0 w-full h-full object-contain opacity-30 blur-sm"
              style={{ transform: 'translateZ(-40px) scale(1.1)' }}
            />
            {/* Front face */}
            <img
              src="/landing/TORQUE_Logo_Icone.png"
              alt="Torque CRM"
              className="logo-front absolute inset-0 w-full h-full object-contain drop-shadow-2xl"
              style={{ transform: 'translateZ(40px)' }}
            />
          </div>

          {/* Reflection */}
          <div className="logo-reflection absolute bottom-0 left-1/2 -translate-x-1/2 w-48 h-24 bg-gradient-to-t from-orange-400/10 to-transparent blur-xl rounded-full" />
        </div>
      </div>
    </section>
  );
}
