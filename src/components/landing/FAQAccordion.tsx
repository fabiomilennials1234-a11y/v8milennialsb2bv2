import { useState } from 'react';

const faqs = [
  {
    question: 'O que é um CRM?',
    answer: 'CRM (Customer Relationship Management) é uma plataforma que centraliza informações e interações com clientes e leads. Com o Torque, você gerencia pipeline, conversas no WhatsApp, automações e indicadores em um único lugar.',
  },
  {
    question: 'Para que serve um CRM na minha empresa?',
    answer: 'Um CRM organiza seu processo comercial, evita que leads sejam esquecidos, automatiza follow-ups e dá visibilidade total sobre a performance do seu time.',
  },
  {
    question: 'A plataforma é indicada para negócios que já vendem ou só iniciantes?',
    answer: 'Para ambos. O Torque escala junto com sua operação. O plano 1.0 é ideal para quem está começando. O 2.0 e V8 oferecem automações avançadas e IA para equipes estruturadas.',
  },
  {
    question: 'Como escolher o melhor CRM para o meu negócio?',
    answer: 'Avalie três coisas: integração com WhatsApp, automações para escalar sem contratar, e facilidade de uso para o time adotar de verdade. O Torque entrega as três.',
  },
  {
    question: 'É fácil adaptar minha operação atual?',
    answer: 'Sim. O Torque se conecta ao seu WhatsApp, importa sua base de leads e oferece treinamento completo. A maioria dos clientes está operando em menos de 48 horas.',
  },
];

export function FAQAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (i: number) => setOpenIndex(prev => (prev === i ? null : i));

  return (
    <section className="faq" id="faq">
      <div className="container">
        <div style={{ textAlign: 'center' }}>
          <span className="label">Perguntas frequentes</span>
          <h2 className="title">Alguma dúvida?</h2>
        </div>
        <div className="faq-list">
          {faqs.map((faq, i) => (
            <div key={i} className={`faq-item${openIndex === i ? ' open' : ''}`}>
              <button className="faq-q" onClick={() => toggle(i)}>
                {faq.question}
                <i className="fas fa-chevron-down"></i>
              </button>
              <div className="faq-a">
                <p>{faq.answer}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="faq-more">
          <a href="mailto:contato@torquecrm.com.br">
            Ainda ficou com dúvidas? Fale com nosso time <i className="fas fa-arrow-right"></i>
          </a>
        </div>
      </div>
    </section>
  );
}
