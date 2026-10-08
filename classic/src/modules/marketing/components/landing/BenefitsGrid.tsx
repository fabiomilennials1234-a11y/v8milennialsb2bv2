import { useCallback, type MouseEvent } from 'react';

function BenefitCard({ children }: { children: React.ReactNode }) {
  const handleMouseMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`);
  }, []);

  return (
    <div className="benefit-card reveal" onMouseMove={handleMouseMove}>
      {children}
    </div>
  );
}

export function BenefitsGrid() {
  return (
    <section id="beneficios" className="py-24 lg:py-32 relative z-10">
      <div className="max-w-7xl mx-auto px-6">

        {/* Section header */}
        <div className="text-center max-w-3xl mx-auto reveal">
          <div className="pill mb-5">
            <span className="dot"></span>
            <span className="text-cream/90">Plataforma</span>
          </div>
          <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05]">
            Tudo que sua operação<br />precisa em <span className="gradient-text-orange">um sistema só</span>.
          </h2>
          <p className="text-mute text-lg mt-5 leading-relaxed">
            Pare de orquestrar 7 ferramentas. O TorqueCRM unifica leads, pipeline,
            automação, agenda e relatórios em uma experiência fluida e premium.
          </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-16">

          {/* 1. Automação inteligente */}
          <BenefitCard>
            <div className="benefit-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
            </div>
            <h3 className="font-display text-xl font-semibold mt-5">Automação inteligente</h3>
            <p className="text-mute text-sm mt-2 leading-relaxed">
              Crie fluxos com gatilhos, condições e ações. IA distribui leads,
              agenda follow-ups e move oportunidades sozinha.
            </p>
          </BenefitCard>

          {/* 2. Gestão de leads */}
          <BenefitCard>
            <div className="benefit-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><path d="M20 8v6M23 11h-6" /></svg>
            </div>
            <h3 className="font-display text-xl font-semibold mt-5">Gestão de leads</h3>
            <p className="text-mute text-sm mt-2 leading-relaxed">
              Captação, qualificação automática por score, segmentação avançada
              e roteamento inteligente entre times.
            </p>
          </BenefitCard>

          {/* 3. Funil de vendas */}
          <BenefitCard>
            <div className="benefit-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="6" height="18" rx="1" /><rect x="11" y="3" width="6" height="14" rx="1" /><rect x="19" y="3" width="2" height="9" rx="1" /></svg>
            </div>
            <h3 className="font-display text-xl font-semibold mt-5">Funil de vendas</h3>
            <p className="text-mute text-sm mt-2 leading-relaxed">
              Pipeline visual com kanban drag-and-drop, múltiplos funis,
              previsão de receita e gestão de probabilidade.
            </p>
          </BenefitCard>

          {/* 4. Equipe comercial */}
          <BenefitCard>
            <div className="benefit-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            </div>
            <h3 className="font-display text-xl font-semibold mt-5">Equipe comercial</h3>
            <p className="text-mute text-sm mt-2 leading-relaxed">
              Permissões granulares, metas por vendedor, ranking em tempo real
              e comissionamento automático.
            </p>
          </BenefitCard>

          {/* 5. Relatórios premium */}
          <BenefitCard>
            <div className="benefit-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
            </div>
            <h3 className="font-display text-xl font-semibold mt-5">Relatórios premium</h3>
            <p className="text-mute text-sm mt-2 leading-relaxed">
              Dashboards customizáveis, drill-down por dimensão, exportação
              e relatórios automáticos por e-mail.
            </p>
          </BenefitCard>

          {/* 6. Check-ins de campo */}
          <BenefitCard>
            <div className="benefit-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            </div>
            <h3 className="font-display text-xl font-semibold mt-5">Check-ins de campo</h3>
            <p className="text-mute text-sm mt-2 leading-relaxed">
              Vendedor externo registra visita por GPS, anexa fotos e atualiza
              o card em tempo real direto do celular.
            </p>
          </BenefitCard>

          {/* 7. Dashboard tempo real */}
          <BenefitCard>
            <div className="benefit-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            </div>
            <h3 className="font-display text-xl font-semibold mt-5">Dashboard tempo real</h3>
            <p className="text-mute text-sm mt-2 leading-relaxed">
              Métricas atualizadas instantaneamente. Veja a receita do mês
              crescer enquanto seu time fecha negócios.
            </p>
          </BenefitCard>

          {/* 8. Gestão de tarefas */}
          <BenefitCard>
            <div className="benefit-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
            </div>
            <h3 className="font-display text-xl font-semibold mt-5">Gestão de tarefas</h3>
            <p className="text-mute text-sm mt-2 leading-relaxed">
              Atividades vinculadas a negócios, lembretes inteligentes,
              sequência de follow-up e SLAs automáticos.
            </p>
          </BenefitCard>

        </div>
      </div>
    </section>
  );
}
