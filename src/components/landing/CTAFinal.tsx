import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useInView } from 'framer-motion';

export function CTAFinal() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section className={`cta-end reveal${inView ? ' visible' : ''}`} ref={ref}>
      <div className="container">
        <h2>Está na hora de<br />virar o jogo.</h2>
        <p>Tudo começa com uma decisão. Agende sua demonstração gratuita agora.</p>
        <Link to="/signup" className="btn btn-grad btn-lg">
          Quero virar o jogo <i className="fas fa-arrow-right"></i>
        </Link>
      </div>
    </section>
  );
}
