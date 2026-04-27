import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

export function LandingNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handlePricingClick = (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
    setMobileOpen(false);
  };

  return (
    <nav className={`navbar${scrolled ? ' scrolled' : ''}`}>
      <div className="container">
        <a href="/" className="nav-logo">
          <span className="nav-logo-icon"><i className="fas fa-bolt"></i></span>
          Torque CRM
        </a>

        <div className="nav-links">
          <div className="nav-item">
            <a href="#">Recursos <i className="fas fa-chevron-down" style={{ fontSize: 9, marginLeft: 2 }}></i></a>
            <div className="dropdown">
              <a href="#"><i className="fas fa-table-columns"></i> CRM</a>
              <a href="#"><i className="fab fa-whatsapp"></i> Conversas WhatsApp</a>
              <a href="#"><i className="fas fa-robot"></i> Inteligência Artificial</a>
              <a href="#"><i className="fas fa-gears"></i> Automações</a>
              <a href="#"><i className="fas fa-chart-line"></i> Indicadores</a>
              <a href="#"><i className="fas fa-plug"></i> Integrações</a>
            </div>
          </div>
          <a href="#pricing" onClick={handlePricingClick}>Planos e Preços</a>
          <a href="#faq">FAQ</a>
        </div>

        <div className="nav-actions">
          <Link to="/auth" className="btn btn-outline btn-sm">Login</Link>
          <Link to="/signup" className="btn btn-grad btn-sm">
            Demonstração <i className="fas fa-arrow-right" style={{ fontSize: 11 }}></i>
          </Link>
        </div>

        <button className="mobile-toggle" onClick={() => setMobileOpen(o => !o)}>
          <i className={`fas ${mobileOpen ? 'fa-times' : 'fa-bars'}`}></i>
        </button>
      </div>

      {mobileOpen && (
        <div style={{
          background: 'rgba(255,255,255,0.97)',
          backdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(0,0,0,0.06)',
          padding: '16px 24px 24px',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <a href="#pricing" onClick={handlePricingClick} style={{ padding: '12px 0', fontSize: 15, fontWeight: 500, color: '#1d1d1f', borderBottom: '1px solid #f0f0f0' }}>
              Planos e Preços
            </a>
            <a href="#faq" onClick={() => setMobileOpen(false)} style={{ padding: '12px 0', fontSize: 15, fontWeight: 500, color: '#1d1d1f', borderBottom: '1px solid #f0f0f0' }}>
              FAQ
            </a>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              <Link to="/auth" className="btn btn-outline" style={{ justifyContent: 'center' }} onClick={() => setMobileOpen(false)}>
                Login
              </Link>
              <Link to="/signup" className="btn btn-grad" style={{ justifyContent: 'center' }} onClick={() => setMobileOpen(false)}>
                Criar conta <i className="fas fa-arrow-right" style={{ fontSize: 11 }}></i>
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
