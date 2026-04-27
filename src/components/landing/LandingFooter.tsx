import { Link } from 'react-router-dom';

export function LandingFooter() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="foot-grid">
          <div className="foot-brand">
            <a href="/" className="nav-logo" style={{ marginBottom: 0 }}>
              <span className="nav-logo-icon"><i className="fas fa-bolt"></i></span>
              Torque CRM
            </a>
            <p>A plataforma de vendas feita para quem vive de bater meta.</p>
            <div className="foot-social">
              <a href="#" aria-label="Facebook"><i className="fab fa-facebook-f"></i></a>
              <a href="#" aria-label="LinkedIn"><i className="fab fa-linkedin-in"></i></a>
              <a href="#" aria-label="YouTube"><i className="fab fa-youtube"></i></a>
              <a href="#" aria-label="Instagram"><i className="fab fa-instagram"></i></a>
            </div>
          </div>
          <div className="foot-col">
            <h4>Recursos</h4>
            <a href="#">CRM</a>
            <a href="#">Conversas</a>
            <a href="#">Automações</a>
            <a href="#">IA</a>
            <a href="#">Indicadores</a>
          </div>
          <div className="foot-col">
            <h4>Serviços</h4>
            <a href="#">Implantação</a>
            <a href="#">Treinamento</a>
            <a href="#">Consultoria</a>
            <a href="#">API</a>
          </div>
          <div className="foot-col">
            <h4>Aprenda</h4>
            <a href="#">Blog</a>
            <a href="#">Central de ajuda</a>
            <a href="#">Webinars</a>
            <a href="#">Cases</a>
          </div>
          <div className="foot-col">
            <h4>Sobre nós</h4>
            <a href="#">Quem somos</a>
            <a href="#">Carreiras</a>
            <a href="#">Contato</a>
            <a href="#">Parceiros</a>
          </div>
        </div>
        <div className="foot-bottom">
          <span>&copy; 2026 Torque CRM. Todos os direitos reservados.</span>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <Link to="/privacidade">Privacidade</Link>
            <a href="#">Termos</a>
            <a href="#">Cookies</a>
            <span className="meta-badge">
              <i className="fab fa-meta"></i> Meta Business Partner
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
