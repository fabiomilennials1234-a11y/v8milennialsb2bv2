import { useRef } from 'react';
import { useInView } from 'framer-motion';

const testimonials = [
  { name: 'João Silva', role: 'CEO, Empresa Alpha' },
  { name: 'Maria Santos', role: 'Diretora Comercial, Clínica Beta' },
  { name: 'Carlos Oliveira', role: 'Head de Vendas, Escola Gama' },
];

export function TestimonialsGrid() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section className={`testimonials reveal${inView ? ' visible' : ''}`} ref={ref}>
      <div className="container">
        <div style={{ textAlign: 'center' }}>
          <span className="label">Cases de sucesso</span>
          <h2 className="title">Não ouça a gente.<br />Ouça eles.</h2>
        </div>
        <div className="test-grid">
          {testimonials.map((t, i) => (
            <div key={i} className="test-card">
              <div className="test-video">
                <div className="test-play"><i className="fas fa-play"></i></div>
              </div>
              <div className="test-info">
                <h4>{t.name}</h4>
                <p>{t.role}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
