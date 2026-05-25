import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

export function LandingNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const smoothScroll = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    setMobileOpen(false);
  };

  return (
    <nav
      id="navbar"
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 nav-blur ${
        scrolled ? 'shadow-2xl py-3' : 'py-5'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2">
          <img
            src="/landing/TORQUE_Logo_Icone.png"
            alt="Torque"
            className="h-8 w-8"
          />
          <span className="text-lg font-bold text-white tracking-tight">
            Torque<span className="text-orange">CRM</span>
          </span>
        </Link>

        {/* Desktop nav links */}
        <div className="hidden lg:flex items-center gap-8">
          <a
            href="#beneficios"
            onClick={(e) => smoothScroll(e, 'beneficios')}
            className="text-sm font-medium text-white/70 hover:text-white transition-colors"
          >
            Produto
          </a>
          <a
            href="#showcase"
            onClick={(e) => smoothScroll(e, 'showcase')}
            className="text-sm font-medium text-white/70 hover:text-white transition-colors"
          >
            Recursos
          </a>
          <a
            href="#prova"
            onClick={(e) => smoothScroll(e, 'prova')}
            className="text-sm font-medium text-white/70 hover:text-white transition-colors"
          >
            Clientes
          </a>
          <a
            href="#recursos"
            onClick={(e) => smoothScroll(e, 'recursos')}
            className="text-sm font-medium text-white/70 hover:text-white transition-colors"
          >
            Recursos
          </a>
        </div>

        {/* Desktop actions */}
        <div className="hidden lg:flex items-center gap-4">
          <Link
            to="/auth"
            className="text-sm font-medium text-white/70 hover:text-white transition-colors"
          >
            Entrar
          </Link>
          <Link
            to="/auth"
            className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
          >
            Começar agora
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="inline-block"
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
        </div>

        {/* Mobile hamburger */}
        <button
          className="lg:hidden flex flex-col gap-1.5 p-2"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Menu"
        >
          <span
            className={`block w-6 h-0.5 bg-white transition-transform duration-300 ${
              mobileOpen ? 'rotate-45 translate-y-2' : ''
            }`}
          />
          <span
            className={`block w-6 h-0.5 bg-white transition-opacity duration-300 ${
              mobileOpen ? 'opacity-0' : ''
            }`}
          />
          <span
            className={`block w-6 h-0.5 bg-white transition-transform duration-300 ${
              mobileOpen ? '-rotate-45 -translate-y-2' : ''
            }`}
          />
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-white/10 bg-black/90 backdrop-blur-xl px-6 py-6 flex flex-col gap-4">
          <a
            href="#beneficios"
            onClick={(e) => smoothScroll(e, 'beneficios')}
            className="text-base font-medium text-white/80 hover:text-white py-2"
          >
            Produto
          </a>
          <a
            href="#showcase"
            onClick={(e) => smoothScroll(e, 'showcase')}
            className="text-base font-medium text-white/80 hover:text-white py-2"
          >
            Recursos
          </a>
          <a
            href="#prova"
            onClick={(e) => smoothScroll(e, 'prova')}
            className="text-base font-medium text-white/80 hover:text-white py-2"
          >
            Clientes
          </a>
          <a
            href="#recursos"
            onClick={(e) => smoothScroll(e, 'recursos')}
            className="text-base font-medium text-white/80 hover:text-white py-2"
          >
            Recursos
          </a>
          <div className="flex flex-col gap-3 pt-4 border-t border-white/10">
            <Link
              to="/auth"
              className="text-center text-sm font-medium text-white/70 hover:text-white py-2"
              onClick={() => setMobileOpen(false)}
            >
              Entrar
            </Link>
            <Link
              to="/auth"
              className="btn-primary text-center px-5 py-3 rounded-full text-sm font-semibold text-white"
              onClick={() => setMobileOpen(false)}
            >
              Começar agora
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
