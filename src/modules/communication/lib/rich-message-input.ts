export function parseLocation(latitude: string, longitude: string) {
  const lat = latitude.trim().replace(',', '.');
  const lng = longitude.trim().replace(',', '.');
  const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  if (!decimal.test(lat) || !decimal.test(lng)) throw new Error('Informe latitude e longitude numéricas');
  const values = { latitude: Number(lat), longitude: Number(lng) };
  if (!Number.isFinite(values.latitude) || !Number.isFinite(values.longitude) || Math.abs(values.latitude) > 90 || Math.abs(values.longitude) > 180) {
    throw new Error('Latitude deve estar entre -90 e 90; longitude entre -180 e 180');
  }
  return values;
}

export function validateContactPhone(value: string) {
  if (!/^\+?[\d\s().-]+$/.test(value.trim())) throw new Error('Informe um telefone com DDI e DDD');
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) throw new Error('Informe um telefone com DDI e DDD');
  return digits;
}
