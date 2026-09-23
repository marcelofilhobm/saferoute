// Persistência local. Nada sai do aparelho.
// localStorage pode falhar (modo anônimo, armazenamento cheio): toda leitura
// e escrita tem plano B, e o app funciona em memória se precisar.

const CHAVE = 'contorno.v1';

let memoria = { areas: [], ultimaRota: null, exemploCarregado: false };

export function carrega() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (bruto) {
      const j = JSON.parse(bruto);
      if (j && Array.isArray(j.areas)) memoria = { ...memoria, ...j };
    }
  } catch { /* segue em memória */ }
  return memoria;
}

export function salva() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(memoria));
    return true;
  } catch {
    return false;
  }
}

export const estado = () => memoria;

export function adicionaArea(area) {
  memoria.areas.push(area);
  salva();
}

export function removeArea(id) {
  memoria.areas = memoria.areas.filter((a) => a.id !== id);
  salva();
}

export function renomeiaArea(id, rotulo) {
  const a = memoria.areas.find((x) => x.id === id);
  if (a) { a.rotulo = rotulo ? String(rotulo).slice(0, 60) : null; salva(); }
}

export function alternaArea(id) {
  const a = memoria.areas.find((x) => x.id === id);
  if (a) { a.inativa = !a.inativa; salva(); }
}

export function guardaUltimaRota(r) {
  memoria.ultimaRota = r;
  salva();
}

export function marcaExemplo() {
  memoria.exemploCarregado = true;
  salva();
}
