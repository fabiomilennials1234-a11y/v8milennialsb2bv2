import { useRef } from 'react';
import { useInView } from 'framer-motion';

const segments = [
  {
    icon: 'fa-laptop-code',
    title: 'Infoprodutores',
    description: 'Qualifique leads de lançamentos, gerencie follow-ups e escale vendas com automação.',
  },
  {
    icon: 'fa-stethoscope',
    title: 'Clínicas Médicas',
    description: 'Agendamento, confirmação e follow-up automatizado para reduzir no-show.',
  },
  {
    icon: 'fa-graduation-cap',
    title: 'Educação',
    description: 'Capture, qualifique e matricule alunos com funil otimizado e comunicação personalizada.',
  },
  {
    icon: 'fa-bullseye',
    title: 'Agências',
    description: 'Gerencie múltiplas contas, acompanhe resultados e entregue relatórios automaticamente.',
  },
];

export function SegmentsGrid() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section className={`segments reveal${inView ? ' visible' : ''}`} ref={ref}>
      <div className="container">
        <div style={{ textAlign: 'center' }}>
          <span className="label label-white">Segmentos</span>
          <h2 className="title title-white">
            Cada negócio tem sua lógica.<br />
            <span className="grad-text">Torque acompanha a sua.</span>
          </h2>
        </div>
        <div className="seg-grid">
          {segments.map((seg, i) => (
            <div key={i} className="seg-card">
              <div className="seg-top">
                <span className="seg-icon"><i className={`fas ${seg.icon}`}></i></span>
              </div>
              <div className="seg-body">
                <h4>{seg.title}</h4>
                <p>{seg.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
