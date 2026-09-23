// Tudo que sai do aparelho passa por aqui. É curto de propósito:
// o que vai para a rede são SÓ pares de coordenadas de rota e texto de busca.
// Áreas que o usuário evita nunca saem inteiras — só as que entram no
// cálculo daquela rota, e sem rótulo.

import { decodePolyline, paraExcludePolygons } from './core.js';

// Motor de rota: Valhalla público da FOSSGIS (o mesmo que o openstreetmap.org
// usa). Sem chave. Serve para testes e poucos usuários; para lançar em escala,
// trocar por instância própria ou ORS com proxy — ver plano, seção 2.2.
export const MOTOR = {
  nome: 'Valhalla (FOSSGIS)',
  url: 'https://valhalla1.openstreetmap.de/route',
};

const TIMEOUT_MS = 20000;

export class ErroRota extends Error {
  constructor(tipo, mensagem, detalhe) {
    super(mensagem);
    this.tipo = tipo;       // 'sem-caminho' | 'rede' | 'limite' | 'servidor'
    this.detalhe = detalhe;
  }
}

async function comTimeout(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Devolve { pontos: [[lat,lon]...], km, min, pernas: [{ pontos }] }.
// `paradas` entram como paradas de verdade (type 'break', permite retorno),
// do jeito que o Google Maps trata os waypoints do link: é assim que o app
// confere o caminho que o Maps tende a fazer. As paradas são pontos da própria
// rota que o motor devolveu — não revelam nada novo.
export async function calculaRota(origem, destino, excluir = [], paradas = []) {
  const loc = (p, extra = {}) => ({ lat: +p[0].toFixed(6), lon: +p[1].toFixed(6), ...extra });
  const req = {
    locations: [loc(origem), ...paradas.map((p) => loc(p, { type: 'break' })), loc(destino)],
    costing: 'auto',
    directions_type: 'none',
    units: 'kilometers',
  };
  if (excluir.length) req.exclude_polygons = paraExcludePolygons(excluir);

  const url = `${MOTOR.url}?json=${encodeURIComponent(JSON.stringify(req))}`;

  let resp;
  try {
    resp = await comTimeout(url, { headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new ErroRota('rede', 'Sem conexão com o serviço de rotas. Verifique a internet e tente de novo.', String(e));
  }

  let corpo = null;
  try { corpo = await resp.json(); } catch { /* corpo vazio ou não-JSON */ }

  if (!resp.ok) {
    const cod = corpo?.error_code;
    const msg = String(corpo?.error || '');
    if (cod === 442 || cod === 443 || /no path could be found/i.test(msg)) {
      throw new ErroRota('sem-caminho', 'Não existe caminho que evite essas áreas.', msg);
    }
    if (/exclude_polygons|perimeter|circumference|exceed/i.test(msg)) {
      throw new ErroRota('limite', 'As áreas são grandes demais para o cálculo de desvio.', msg);
    }
    if (resp.status === 429) {
      throw new ErroRota('servidor', 'O serviço de rotas está ocupado. Espere alguns segundos e tente de novo.', msg);
    }
    throw new ErroRota('servidor', 'O serviço de rotas recusou o pedido.', `${resp.status} ${msg}`);
  }

  const trip = corpo?.trip;
  const shape = trip?.legs?.[0]?.shape;
  if (!shape) throw new ErroRota('servidor', 'O serviço de rotas respondeu sem rota.', JSON.stringify(corpo).slice(0, 200));

  // Rota com várias pernas: concatena.
  const pernas = trip.legs.map((l) => ({ pontos: decodePolyline(l.shape, 6) }));
  const pontos = pernas.flatMap((l, i) => (i === 0 ? l.pontos : l.pontos.slice(1)));
  return {
    pontos,
    pernas,
    km: trip.summary.length,
    min: Math.round(trip.summary.time / 60),
  };
}

// Busca de endereço: Photon (Komoot), sobre dados do OpenStreetMap.
// Enviesada para a Região Metropolitana do Rio.
export async function buscaEndereco(texto) {
  const q = texto.trim();
  if (q.length < 3) return [];
  const url = 'https://photon.komoot.io/api/?' + new URLSearchParams({
    q, limit: '6', lat: '-22.93', lon: '-43.40', bbox: '-43.9,-23.15,-42.9,-22.6',
  });
  const resp = await comTimeout(url);
  if (!resp.ok) return [];
  const j = await resp.json();
  return (j.features || []).map((f) => {
    const p = f.properties || {};
    const linha1 = p.name || [p.street, p.housenumber].filter(Boolean).join(', ') || 'Local';
    const linha2 = [p.street && p.name ? p.street : null, p.district || p.locality, p.city].filter(Boolean).join(' · ');
    return {
      nome: linha1,
      detalhe: linha2,
      ponto: [f.geometry.coordinates[1], f.geometry.coordinates[0]],
    };
  });
}
