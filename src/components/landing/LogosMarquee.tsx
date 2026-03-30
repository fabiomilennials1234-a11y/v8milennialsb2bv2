const logos = [
  { icon: 'fa-building', name: 'Empresa Alpha' },
  { icon: 'fa-store', name: 'Loja Beta' },
  { icon: 'fa-industry', name: 'Indústria Gama' },
  { icon: 'fa-briefcase', name: 'Consultoria Delta' },
  { icon: 'fa-hospital', name: 'Clínica Epsilon' },
  { icon: 'fa-graduation-cap', name: 'Escola Zeta' },
  { icon: 'fa-rocket', name: 'Startup Eta' },
  { icon: 'fa-gem', name: 'Grupo Theta' },
];

// Duplicate for infinite marquee
const allLogos = [...logos, ...logos];

export function LogosMarquee() {
  return (
    <section className="logos">
      <h3>Quem já apostou na Torque</h3>
      <div className="logos-track">
        {allLogos.map((logo, i) => (
          <div key={i} className="logo-item">
            <i className={`fas ${logo.icon}`}></i> {logo.name}
          </div>
        ))}
      </div>
    </section>
  );
}
