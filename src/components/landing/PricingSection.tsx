import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useInView } from 'framer-motion';

type BillingCycle = 'monthly' | 'semiannual' | 'annual';

interface PricingState {
  cycle: BillingCycle;
}

const CYCLES: { key: BillingCycle; label: string; discount?: string }[] = [
  { key: 'monthly', label: 'Mensal' },
  { key: 'semiannual', label: 'Semestral', discount: '-10%' },
  { key: 'annual', label: 'Anual', discount: '-15%' },
];

const DISCOUNTS: Record<BillingCycle, number> = {
  monthly: 1,
  semiannual: 0.9,
  annual: 0.85,
};

function formatPrice(basePrice: number, cycle: BillingCycle): string {
  const value = Math.round(basePrice * DISCOUNTS[cycle]);
  return value.toLocaleString('pt-BR');
}

function formatPriceNote(cycle: BillingCycle): string {
  if (cycle === 'monthly') return 'Cobrado mensalmente';
  if (cycle === 'semiannual') return 'Cobrado a cada 6 meses';
  return 'Cobrado anualmente';
}

const CHECK = <i className="fas fa-check"></i>;
const CROSS = <span style={{ color: 'var(--gray-200)', fontWeight: 700 }}>✗</span>;

export function PricingSection() {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section className={`pricing reveal${inView ? ' visible' : ''}`} id="pricing" ref={ref}>
      <div className="container">
        <div style={{ textAlign: 'center' }}>
          <span className="label">Planos e preços</span>
          <h2 className="title">Escolha o plano ideal<br />para sua operação</h2>
        </div>

        {/* Segmented cycle selector */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '36px 0 56px',
        }}>
          <div style={{
            display: 'inline-flex',
            background: 'var(--gray-100)',
            borderRadius: 50,
            padding: 4,
            gap: 2,
          }}>
            {CYCLES.map(({ key, label, discount }) => (
              <button
                key={key}
                onClick={() => setCycle(key)}
                style={{
                  padding: '8px 20px',
                  borderRadius: 50,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  fontWeight: cycle === key ? 700 : 500,
                  color: cycle === key ? 'var(--white)' : 'var(--gray-600)',
                  background: cycle === key ? 'var(--black)' : 'transparent',
                  transition: 'all 0.25s cubic-bezier(.22,1,.36,1)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
                {discount && (
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 50,
                    background: cycle === key ? 'var(--grad)' : 'var(--gray-200)',
                    color: cycle === key ? 'var(--white)' : 'var(--gray-600)',
                    letterSpacing: '0.3px',
                  }}>
                    {discount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Plan Cards — 3 cards */}
        <div className="price-cards" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>

          {/* Card 1: Torque 1.0 */}
          <div className="price-card">
            <h3>Torque 1.0</h3>
            <p className="desc">Para quem quer métricas e gestão manual</p>
            <div className="amount">
              R$ <span className="pv">{formatPrice(297, cycle)}</span>
              <small>/mês por usuário</small>
            </div>
            <p className="note">{formatPriceNote(cycle)}</p>
            <p className="min">Mínimo 2 usuários</p>
            <ul className="price-feats">
              <li>{CHECK} CRM completo</li>
              <li>{CHECK} Funis de vendas</li>
              <li>{CHECK} Pódio e ranking</li>
              <li>{CHECK} Metas e métricas</li>
              <li>{CHECK} Gestão de leads</li>
              <li>{CHECK} Produtos</li>
            </ul>
            <Link to="/signup?plan=torque-1.0" className="btn btn-outline">
              Começar agora <i className="fas fa-arrow-right" style={{ fontSize: 12 }}></i>
            </Link>
          </div>

          {/* Card 2: Torque 2.0 — featured */}
          <div className="price-card featured">
            <div className="price-badge">Mais popular</div>
            <h3>Torque 2.0</h3>
            <p className="desc">CRM completo com chat, automações e carteira</p>
            <div className="amount">
              R$ <span className="pv">{formatPrice(697, cycle)}</span>
              <small>/mês por usuário</small>
            </div>
            <p className="note">{formatPriceNote(cycle)}</p>
            <p className="min">Mínimo 3 usuários</p>
            <ul className="price-feats">
              <li>{CHECK} Tudo do 1.0 +</li>
              <li>{CHECK} Chat WhatsApp</li>
              <li>{CHECK} Gestão de carteira</li>
              <li>{CHECK} Mensagens agendadas</li>
              <li>{CHECK} Automações de fluxo</li>
              <li>{CHECK} Disparo em massa</li>
            </ul>
            <Link to="/signup?plan=torque-2.0" className="btn btn-grad">
              Começar agora <i className="fas fa-arrow-right" style={{ fontSize: 12 }}></i>
            </Link>
          </div>

          {/* Card 3: Torque V8 */}
          <div className="price-card">
            <h3>Torque V8</h3>
            <p className="desc">Tudo incluso: CRM, automações, IA e Copilot</p>
            <div className="amount">
              R$ <span className="pv">{formatPrice(1997, cycle)}</span>
              <small>/mês fixo</small>
            </div>
            <p className="note">{formatPriceNote(cycle)}</p>
            <p className="min">3 usuários + 1 copilot inclusos | R$120/usuário extra</p>
            <ul className="price-feats">
              <li>{CHECK} Tudo do 2.0 +</li>
              <li>{CHECK} Copilot (agentes IA)</li>
              <li>{CHECK} Oráculo Comercial</li>
            </ul>
            <Link to="/signup?plan=torque-v8" className="btn btn-outline">
              Começar agora <i className="fas fa-arrow-right" style={{ fontSize: 12 }}></i>
            </Link>
          </div>
        </div>

        {/* Comparison Table */}
        <table className="cmp-table">
          <thead>
            <tr>
              <th>Recursos</th>
              <th>1.0</th>
              <th>2.0</th>
              <th>V8</th>
            </tr>
          </thead>
          <tbody>
            <tr className="cat"><td colSpan={4}>Gestão e CRM</td></tr>
            <tr><td>Gestão de leads</td><td className="chk">✓</td><td className="chk">✓</td><td className="chk">✓</td></tr>
            <tr><td>Funis de vendas</td><td className="chk">✓</td><td className="chk">✓</td><td className="chk">✓</td></tr>
            <tr><td>Pódio e ranking</td><td className="chk">✓</td><td className="chk">✓</td><td className="chk">✓</td></tr>
            <tr><td>Metas e métricas</td><td className="chk">✓</td><td className="chk">✓</td><td className="chk">✓</td></tr>
            <tr><td>Produtos</td><td className="chk">✓</td><td className="chk">✓</td><td className="chk">✓</td></tr>

            <tr className="cat"><td colSpan={4}>Comunicação</td></tr>
            <tr><td>Chat WhatsApp</td><td className="no">✗</td><td className="chk">✓</td><td className="chk">✓</td></tr>
            <tr><td>Mensagens agendadas</td><td className="no">✗</td><td className="chk">✓</td><td className="chk">✓</td></tr>
            <tr><td>Disparo em massa</td><td className="no">✗</td><td className="chk">✓</td><td className="chk">✓</td></tr>

            <tr className="cat"><td colSpan={4}>Automação</td></tr>
            <tr><td>Automações de fluxo</td><td className="no">✗</td><td className="chk">✓</td><td className="chk">✓</td></tr>
            <tr><td>Gestão de carteira</td><td className="no">✗</td><td className="chk">✓</td><td className="chk">✓</td></tr>

            <tr className="cat"><td colSpan={4}>Inteligência Artificial</td></tr>
            <tr><td>Copilot (agentes IA)</td><td className="no">✗</td><td className="no">✗</td><td className="chk">✓</td></tr>
            <tr><td>Oráculo Comercial</td><td className="no">✗</td><td className="no">✗</td><td className="chk">✓</td></tr>

            <tr className="prc">
              <td>Valor mensal</td>
              <td>R$ {formatPrice(297, cycle)}/mês/user</td>
              <td>R$ {formatPrice(697, cycle)}/mês/user</td>
              <td>R$ {formatPrice(1997, cycle)}/mês fixo</td>
            </tr>
          </tbody>
        </table>

        {/* Serviços adicionais */}
        <h3 className="addons-title">Serviços adicionais</h3>
        <table className="addons">
          <thead>
            <tr>
              <th>Serviço</th>
              <th>Preço</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Add-on Turbo (Copilot IA)</td>
              <td>R$ 1.427/copiloto</td>
            </tr>
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 8 }}>
          * Disponível para planos 1.0 e 2.0
        </p>
      </div>
    </section>
  );
}
