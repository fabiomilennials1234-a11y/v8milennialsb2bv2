import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useInView } from 'framer-motion';

export function HeroSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section className="hero">
      <div className="container" ref={ref}>
        <div className={`hero-badge reveal${inView ? ' visible' : ''}`}>
          <span className="hero-badge-dot"></span>
          Plataforma de vendas #1 do Brasil
          <span className="hero-badge-tag">NOVO</span>
        </div>

        <h1 className={`reveal reveal-delay-1${inView ? ' visible' : ''}`}>
          Quem vende, usa<br /><span className="grad-text">Torque.</span>
        </h1>

        <p className={`subtitle reveal reveal-delay-2${inView ? ' visible' : ''}`}>
          A plataforma de vendas feita para quem vive de bater meta. CRM, WhatsApp, IA e automações — tudo em um só lugar.
        </p>

        <div className={`hero-ctas reveal reveal-delay-2${inView ? ' visible' : ''}`}>
          <Link to="/signup" className="btn btn-grad btn-lg">
            Começar agora <i className="fas fa-arrow-right"></i>
          </Link>
          <a href="#" className="btn btn-outline">
            Assistir demo <i className="fas fa-play" style={{ fontSize: 10 }}></i>
          </a>
        </div>

        <div className={`hero-features reveal reveal-delay-3${inView ? ' visible' : ''}`}>
          <div className="hero-feature"><i className="fas fa-robot"></i> IA</div>
          <div className="hero-feature"><i className="fas fa-gears"></i> Automações</div>
          <div className="hero-feature"><i className="fab fa-whatsapp"></i> Conversas</div>
          <div className="hero-feature"><i className="fas fa-table-columns"></i> CRM</div>
          <div className="hero-feature"><i className="fas fa-chart-pie"></i> Indicadores</div>
          <div className="hero-feature"><i className="fas fa-filter"></i> Funil</div>
          <div className="hero-feature"><i className="fas fa-list-check"></i> Tarefas</div>
          <div className="hero-feature"><i className="fas fa-plug"></i> Integrações</div>
        </div>

        <div className={`hero-mockup reveal reveal-delay-3${inView ? ' visible' : ''}`}>
          <div className="mockup-inner">
            <i className="fas fa-desktop"></i>
            <span>Screenshot do Torque CRM</span>
          </div>
        </div>
      </div>
    </section>
  );
}
