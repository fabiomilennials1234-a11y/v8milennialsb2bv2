import { useRef } from 'react';
import { useInView } from 'framer-motion';

interface FeatureSectionProps {
  label: string;
  labelWhite?: boolean;
  title: React.ReactNode;
  description: string;
  chips: string[];
  chipsVariant?: 'light' | 'dark';
  variant?: 'light' | 'dark' | 'gradient' | 'default';
  reversed?: boolean;
  icon: string;
  placeholderText: string;
  visualVariant?: 'light' | 'dark' | 'glow';
}

function FeatureSection({
  label,
  labelWhite,
  title,
  description,
  chips,
  chipsVariant = 'light',
  variant = 'default',
  reversed = false,
  icon,
  placeholderText,
  visualVariant = 'light',
}: FeatureSectionProps) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });

  const sectionClass = [
    'feat',
    variant === 'light' ? 'feat-light' : '',
    variant === 'dark' ? 'feat-dark' : '',
    variant === 'gradient' ? 'feat-gradient' : '',
    'reveal',
    inView ? 'visible' : '',
  ].filter(Boolean).join(' ');

  const gridClass = ['feat-grid', reversed ? 'reverse' : ''].filter(Boolean).join(' ');

  const visualClass = [
    'feat-visual',
    visualVariant === 'light' ? 'feat-visual-light' : '',
    visualVariant === 'dark' ? 'feat-visual-dark' : '',
    visualVariant === 'glow' ? 'feat-visual-glow' : '',
  ].filter(Boolean).join(' ');

  return (
    <section className={sectionClass} ref={ref}>
      <div className="container">
        <div className={gridClass}>
          <div className="feat-text">
            <span className={`label${labelWhite ? ' label-white' : ''}`}>{label}</span>
            <h2 className={`title${variant === 'dark' || variant === 'gradient' ? ' title-white' : ''}`}>
              {title}
            </h2>
            <p className={`sub${variant === 'dark' || variant === 'gradient' ? ' sub-white' : ''}`}>
              {description}
            </p>
            <div className="feat-chips">
              {chips.map((chip, i) => (
                <span key={i} className={`feat-chip${chipsVariant === 'dark' ? ' feat-chip-dark' : ''}`}>
                  {chip}
                </span>
              ))}
            </div>
          </div>
          <div className={visualClass}>
            <div className="feat-visual-placeholder">
              <i className={icon}></i>
              <span>{placeholderText}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function FeatureShowcase() {
  return (
    <>
      {/* All-in-one intro */}
      <AllInOne />

      {/* Feature 1: Conversas */}
      <FeatureSection
        label="Conversas"
        title={<>WhatsApp + Instagram<br />em um inbox.</>}
        description="Todas as conversas da sua equipe em um só lugar. Distribuição automática, respostas rápidas e controle total."
        chips={['Multi-atendentes', 'Respostas rápidas', 'Distribuição automática']}
        variant="light"
        icon="fab fa-whatsapp"
        placeholderText="Inbox centralizado"
        visualVariant="light"
      />

      {/* Feature 2: CRM (dark, reversed) */}
      <FeatureSection
        label="CRM"
        labelWhite
        title={<>Pipeline kanban.<br />Histórico completo.</>}
        description="Arraste e solte leads entre etapas. Timeline, compromissos, notas e todas as interações em tempo real."
        chips={['Kanban drag & drop', 'Timeline do lead', 'Filtros avançados']}
        chipsVariant="dark"
        variant="dark"
        reversed
        icon="fas fa-table-columns"
        placeholderText="Pipeline Kanban"
        visualVariant="dark"
      />

      {/* Feature 3: Automações */}
      <FeatureSection
        label="Automações"
        title={<>Sua operação no<br />piloto automático. 24/7.</>}
        description="Follow-ups, disparos, fluxos e agentes de IA que trabalham enquanto sua equipe descansa."
        chips={['Fluxos visuais', 'Agentes IA', 'Follow-up automático']}
        variant="default"
        icon="fas fa-gears"
        placeholderText="Workflow builder"
        visualVariant="glow"
      />

      {/* Feature 4: IA (gradient, reversed) */}
      <FeatureSection
        label="Inteligência Artificial"
        labelWhite
        title={<>IA que transcreve, analisa<br />e pontua reuniões.</>}
        description="Copilot de vendas que transcreve chamadas, qualifica leads e gera resumos automaticamente."
        chips={['Transcrição automática', 'Lead scoring IA', 'Resumos inteligentes']}
        chipsVariant="dark"
        variant="gradient"
        reversed
        icon="fas fa-robot"
        placeholderText="Copilot IA"
        visualVariant="dark"
      />

      {/* Feature 5: Campanhas */}
      <FeatureSection
        label="Campanhas"
        title={<>Dispare por WhatsApp,<br />SMS e voz.</>}
        description="Envio em massa com segmentação inteligente. Taxas de abertura, resposta e conversão em tempo real."
        chips={['Envio agendado', 'Segmentação', 'Métricas em tempo real']}
        variant="light"
        icon="fas fa-bullhorn"
        placeholderText="Campanhas"
        visualVariant="light"
      />

      {/* Feature 6: Indicadores (dark, reversed) */}
      <FeatureSection
        label="Indicadores"
        labelWhite
        title={<>Dashboards de<br />performance. Em tempo real.</>}
        description="Metas, conversão, receita por vendedor e todos os KPIs que importam. Atualizado minuto a minuto."
        chips={['Relatórios customizáveis', 'KPIs automáticos', 'Exportação']}
        chipsVariant="dark"
        variant="dark"
        reversed
        icon="fas fa-chart-line"
        placeholderText="Dashboard"
        visualVariant="dark"
      />
    </>
  );
}

function AllInOne() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section className={`allinone reveal${inView ? ' visible' : ''}`} ref={ref}>
      <div className="container">
        <span className="label">Plataforma integrada</span>
        <h2 className="title">Tudo que sua operação<br />precisa. Em um só lugar.</h2>
        <p className="sub" style={{ margin: '0 auto 36px', textAlign: 'center' }}>
          Chega de alternar entre 10 ferramentas. Torque reúne CRM, WhatsApp, automações, IA e indicadores em uma plataforma única.
        </p>
        <div className="play-btn-wrap">
          <span className="play-circle"><i className="fas fa-play"></i></span>
          Assistir vídeo
        </div>
      </div>
    </section>
  );
}
