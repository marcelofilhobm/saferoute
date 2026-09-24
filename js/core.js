// Núcleo do Contorno. JavaScript puro: nada de DOM, nada de rede.
// Roda no navegador e no Node — é por isso que os testes rodam sem emulador.
//
// Porte fiel dos algoritmos 7.1 a 7.4 do plano, validados antes em Python
// contra o link real da Zona Oeste (31/31 testes).
//
// Coordenadas internas: [lat, lon]. GeoJSON e Valhalla usam [lon, lat] —
// a troca acontece só nas funções toGeo/fromGeo, num lugar só.

// ------------------------------------------------------------ limites

export const LIMITES = Object.freeze({
  // Validação de área na criação (UX + sanidade de entrada hostil).
  maxAreaKm2: 200,
  maxExtensaoKm: 20,
  maxVertices: 2000,
  // Valhalla: soma dos perímetros de todos os polígonos de exclusão numa
  // requisição. Padrão do servidor = 10 000 m. Usamos 9 500 de margem.
  orcamentoPerimetroM: 9500,
  // Teto próprio de polígonos por requisição.
  maxPoligonosPorRequisicao: 20,
  // Rota: acima disto a verificação é recusada.
  maxDistanciaKm: 150,
});

// Caixa da Região Metropolitana do Rio, com folga.
export const BBOX_RMRJ = Object.freeze({ latMin: -23.15, lonMin: -43.9, latMax: -22.6, lonMax: -42.9 });

export function dentroRmrj([lat, lon]) {
  return lat >= BBOX_RMRJ.latMin && lat <= BBOX_RMRJ.latMax &&
         lon >= BBOX_RMRJ.lonMin && lon <= BBOX_RMRJ.lonMax;
}

// ---------------------------------------------------------- geometria

const R = 6371008.8;
const rad = (g) => g * Math.PI / 180;

export function haversineM(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function comprimentoM(linha) {
  let s = 0;
  for (let i = 0; i < linha.length - 1; i++) s += haversineM(linha[i], linha[i + 1]);
  return s;
}

export function perimetroM(poly) {
  if (poly.length < 2) return 0;
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += haversineM(poly[i], poly[(i + 1) % poly.length]);
  return s;
}

// Ray casting; aresta semiaberta para não contar vértice duas vezes.
export function pontoEmPoligono(p, poly) {
  if (poly.length < 3) return false;
  let dentro = false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((a[0] > p[0]) !== (b[0] > p[0])) {
      const x = (b[1] - a[1]) * (p[0] - a[0]) / (b[0] - a[0]) + a[1];
      if (p[1] < x) dentro = !dentro;
    }
  }
  return dentro;
}

function orient(p, q, r) {
  return (q[1] - p[1]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[1] - p[1]);
}

export function segmentosCruzam(p1, p2, p3, p4) {
  const d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// Shoelace sobre projeção equirretangular local.
export function areaKm2(poly) {
  if (poly.length < 3) return 0;
  const lat0 = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const k = Math.cos(rad(lat0));
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += (a[1] * k * 111320) * (b[0] * 111320) - (b[1] * k * 111320) * (a[0] * 111320);
  }
  return Math.abs(s) / 2 / 1e6;
}

export function extensaoKm(poly) {
  if (!poly.length) return { larguraKm: 0, alturaKm: 0 };
  const lats = poly.map((p) => p[0]);
  const lons = poly.map((p) => p[1]);
  const latMin = Math.min(...lats), latMax = Math.max(...lats);
  const lonMin = Math.min(...lons), lonMax = Math.max(...lons);
  const lat0 = (latMin + latMax) / 2;
  return {
    larguraKm: haversineM([lat0, lonMin], [lat0, lonMax]) / 1000,
    alturaKm: haversineM([latMin, lonMin], [latMax, lonMin]) / 1000,
  };
}

function bbox(pts) {
  let latMin = Infinity, lonMin = Infinity, latMax = -Infinity, lonMax = -Infinity;
  for (const [la, lo] of pts) {
    if (la < latMin) latMin = la; if (la > latMax) latMax = la;
    if (lo < lonMin) lonMin = lo; if (lo > lonMax) lonMax = lo;
  }
  return { latMin, lonMin, latMax, lonMax };
}

function bboxIntersecta(a, b) {
  return !(a.latMax < b.latMin || b.latMax < a.latMin || a.lonMax < b.lonMin || b.lonMax < a.lonMin);
}

// ------------------------------------------------- validação de entrada

const coordValida = (p) =>
  Array.isArray(p) && p.length >= 2 &&
  Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
  p[0] >= -90 && p[0] <= 90 && p[1] >= -180 && p[1] <= 180;

// Roda na CRIAÇÃO e na IMPORTAÇÃO — nunca só na hora do cálculo.
// Devolve { erros, avisos }. Erro bloqueia; aviso só informa.
export function validaPoligono(poly) {
  const erros = [];
  const avisos = [];
  if (!Array.isArray(poly) || poly.length < 3) {
    return { erros: ['Uma área precisa de pelo menos 3 pontos.'], avisos };
  }
  if (poly.length > LIMITES.maxVertices) {
    erros.push(`Área com pontos demais (${poly.length}). O máximo é ${LIMITES.maxVertices}.`);
  }
  if (!poly.every(coordValida)) {
    erros.push('A área tem coordenada inválida.');
    return { erros, avisos };
  }
  if (!poly.every(dentroRmrj)) {
    erros.push('A área está fora da Região Metropolitana do Rio.');
  }
  const a = areaKm2(poly);
  if (a > LIMITES.maxAreaKm2) {
    erros.push(`Área grande demais: ${a.toFixed(0)} km². O máximo é ${LIMITES.maxAreaKm2} km². Divida em áreas menores.`);
  }
  const { larguraKm, alturaKm } = extensaoKm(poly);
  const maior = Math.max(larguraKm, alturaKm);
  if (maior > LIMITES.maxExtensaoKm) {
    erros.push(`Área comprida demais: ${maior.toFixed(1)} km. O máximo é ${LIMITES.maxExtensaoKm} km.`);
  }
  const per = perimetroM(poly);
  if (per > LIMITES.orcamentoPerimetroM) {
    avisos.push(
      `Área grande para desvio automático (contorno de ${(per / 1000).toFixed(1)} km). ` +
      'Ela é grande demais para o serviço de rotas desviar sozinho: o app tenta dar a volta por fora ' +
      'com pontos de passagem, o que nem sempre dá certo. Áreas menores funcionam melhor.'
    );
  }
  return { erros, avisos };
}

// ----------------------------------------- 7.1 parser do link do Maps

const MODAIS = { 0: 'driving', 1: 'cycling', 2: 'walking', 3: 'transit' };
const MAX_URL = 4096;

function tentaCoordenada(seg) {
  const m = /^\s*(-?\d+\.?\d*),\s*(-?\d+\.?\d*)\s*$/.exec(seg);
  if (!m) return null;
  const p = [parseFloat(m[1]), parseFloat(m[2])];
  return coordValida(p) ? p : null;
}

function decodifica(s) {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
}

// O formato é interno e não documentado. Nunca lança exceção:
// devolve o que conseguiu e a interface cai na entrada manual.
export function parseUrlMaps(url) {
  const vazio = { origem: null, destino: null, paradas: [], destinoNome: null, modal: null, pendentes: [], curto: false };
  if (typeof url !== 'string' || !url || url.length > MAX_URL) return vazio;

  if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(url)) return { ...vazio, curto: true };

  // Formato api=1: ?origin=..&destination=.. (inclusive /maps/dir/?api=1)
  if (/[?&]api=1\b/.test(url)) {
    try {
      const u = new URL(url);
      const o = tentaCoordenada(u.searchParams.get('origin') || '');
      const d = tentaCoordenada(u.searchParams.get('destination') || '');
      if (o || d) return { ...vazio, origem: o, destino: d };
    } catch { /* segue */ }
  }

  const m = /\/maps\/dir\/([^?#]*)/.exec(url);
  if (!m || !m[1]) return vazio;

  let resto = m[1];
  let blob = '';
  const iData = resto.indexOf('/data=');
  if (iData >= 0) { blob = resto.slice(iData + 6); resto = resto.slice(0, iData); }
  else if (resto.startsWith('data=')) { blob = resto.slice(5); resto = ''; }

  const segmentos = resto.split('/').filter((s) => s && !s.startsWith('@'));
  const coordsBlob = [...blob.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g)]
    .map((x) => [parseFloat(x[1]), parseFloat(x[2])]);
  const mm = /!3e([0-3])/.exec(blob);
  const modal = mm ? MODAIS[mm[1]] : null;

  const resolvidos = [];
  const pendentes = [];
  for (const seg of segmentos) {
    const p = tentaCoordenada(seg);
    if (p) resolvidos.push(p);
    else { pendentes.push(decodifica(seg)); resolvidos.push(null); }
  }

  let destinoNome = null;
  if (resolvidos.length && resolvidos.at(-1) === null && coordsBlob.length) {
    resolvidos[resolvidos.length - 1] = coordsBlob.at(-1);
    destinoNome = pendentes.pop() ?? null;
  }
  if (!resolvidos.length) return vazio;

  return {
    origem: resolvidos[0],
    destino: resolvidos.length > 1 ? resolvidos.at(-1) : null,
    paradas: resolvidos.slice(1, -1).filter(Boolean),
    destinoNome,
    modal,
    pendentes,
    curto: false,
  };
}

// ------------------------------------------- polyline (Valhalla, prec. 6)

export function decodePolyline(s, precisao = 6) {
  const f = 10 ** precisao;
  const out = [];
  let i = 0, lat = 0, lon = 0;
  while (i < s.length) {
    for (let k = 0; k < 2; k++) {
      let shift = 0, res = 0, b;
      do {
        b = s.charCodeAt(i++) - 63;
        res |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20); // fora do fim, charCodeAt dá NaN e o laço para
      const d = (res & 1) ? ~(res >> 1) : (res >> 1);
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lat / f, lon / f]);
  }
  return out;
}

// ------------------------------------- 7.2 interseção rota × áreas

function amostraAoLongo(rota, passoM = 25) {
  if (rota.length < 2) return rota.slice();
  const out = [];
  for (let i = 0; i < rota.length - 1; i++) {
    const a = rota[i], b = rota[i + 1];
    const n = Math.max(1, Math.floor(haversineM(a, b) / passoM));
    for (let j = 0; j < n; j++) {
      const t = j / n;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  out.push(rota.at(-1));
  return out;
}

export function areaExpirada(area, agora = Date.now()) {
  return area.validaAte != null && new Date(area.validaAte).getTime() < agora;
}

// Não responde só "cruza": responde ONDE e POR QUANTOS METROS.
export function rotaAtinge(rota, area) {
  const poly = area.geometria;
  if (rota.length < 2 || poly.length < 3) return null;

  const bb = bbox(poly);
  const bbRota = bbox(rota);
  if (!bboxIntersecta(bb, bbRota)) return null;

  const amostras = amostraAoLongo(rota);
  let metros = 0;
  let entrada = null;
  for (let i = 0; i < amostras.length - 1; i++) {
    if (pontoEmPoligono(amostras[i], poly)) {
      metros += haversineM(amostras[i], amostras[i + 1]);
      if (!entrada) entrada = amostras[i];
    }
  }
  if (!entrada) {
    // Pode só raspar uma quina entre amostras.
    let cruza = false;
    outer: for (let i = 0; i < rota.length - 1; i++) {
      for (let j = 0; j < poly.length; j++) {
        if (segmentosCruzam(rota[i], rota[i + 1], poly[j], poly[(j + 1) % poly.length])) { cruza = true; break outer; }
      }
    }
    if (!cruza) return null;
    entrada = rota[0];
  }
  return { area, metrosDentro: metros, pontoEntrada: entrada };
}

export function atingimentosDaRota(rota, areas) {
  const out = [];
  for (const a of areas) {
    if (areaExpirada(a)) continue;
    const at = rotaAtinge(rota, a);
    if (at) out.push(at);
  }
  out.sort((x, y) => (y.area.severidade ?? 1) - (x.area.severidade ?? 1) || y.metrosDentro - x.metrosDentro);
  return out;
}

// --------------------------------------------- 7.3 pré-filtro

// OBRIGATÓRIO antes de montar a requisição. Prioridade:
//   1. áreas que a rota base efetivamente cruza
//   2. áreas dentro do corredor origem-destino, por severidade
// E cabe no orçamento de perímetro do Valhalla.
// Devolve { enviadas, deixadasDeFora }.
export function preFiltraAreas(origem, destino, areas, { atingidasIds = [], folgaKm = 5 } = {}) {
  const dg = folgaKm / 111;
  const corredor = {
    latMin: Math.min(origem[0], destino[0]) - dg,
    lonMin: Math.min(origem[1], destino[1]) - dg,
    latMax: Math.max(origem[0], destino[0]) + dg,
    lonMax: Math.max(origem[1], destino[1]) + dg,
  };
  const ids = new Set(atingidasIds);
  const candidatas = areas
    .filter((a) => !areaExpirada(a))
    .filter((a) => a.geometria.length >= 3)
    .filter((a) => validaPoligono(a.geometria).erros.length === 0)
    .filter((a) => bboxIntersecta(corredor, bbox(a.geometria)))
    // Área que contém a origem ou o destino não pode ser excluída —
    // o motor não teria como sair nem chegar.
    .filter((a) => !pontoEmPoligono(origem, a.geometria) && !pontoEmPoligono(destino, a.geometria));

  candidatas.sort((x, y) =>
    (ids.has(y.id) - ids.has(x.id)) ||
    ((y.severidade ?? 1) - (x.severidade ?? 1)) ||
    (perimetroM(x.geometria) - perimetroM(y.geometria)));

  const enviadas = [];
  const deixadasDeFora = [];
  let orcamento = LIMITES.orcamentoPerimetroM;
  for (const a of candidatas) {
    const p = perimetroM(a.geometria);
    if (enviadas.length < LIMITES.maxPoligonosPorRequisicao && p <= orcamento) {
      enviadas.push(a);
      orcamento -= p;
    } else {
      deixadasDeFora.push(a);
    }
  }
  return { enviadas, deixadasDeFora };
}

// Converte para o formato do Valhalla: anéis fechados de [lon, lat].
export function paraExcludePolygons(areas) {
  return areas.map((a) => {
    const anel = a.geometria.map(([la, lo]) => [+lo.toFixed(6), +la.toFixed(6)]);
    const [p0] = anel;
    const ult = anel.at(-1);
    if (p0[0] !== ult[0] || p0[1] !== ult[1]) anel.push([...p0]);
    return anel;
  });
}

// --------------------------------------- 7.4 waypoints e deeplinks

// O Maps não aceita "evite esta área", só paradas. Entre duas paradas ele
// escolhe o caminho que quiser — por isso as paradas são escolhidas por
// desvio e depois conferidas (refinaParadas).

export const MAX_PARADAS = 9; // teto do link do Maps (decisão 018)
const PASSO_AMOSTRA_M = 150;
const MIN_AFASTAMENTO_M = 120;
const FOLGA_PONTA_M = 200;    // parada colada na origem, destino ou noutra parada não serve

// Amostras da rota segura com a distância acumulada (s, em metros) e, para
// cada amostra, o vértice real da rota mais perto dela. A parada que vai
// para o Maps é sempre o vértice: amostra cai entre dois vértices e, em via
// expressa com curva, pode ficar fora da pista; o vértice está na rua.
function trilho(rota) {
  const pts = [];
  const vert = [];
  for (let i = 0; i < rota.length - 1; i++) {
    const a = rota[i], b = rota[i + 1];
    const n = Math.max(1, Math.floor(haversineM(a, b) / PASSO_AMOSTRA_M));
    for (let j = 0; j < n; j++) {
      const t = j / n;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      vert.push(t < 0.5 ? a : b);
    }
  }
  pts.push(rota.at(-1));
  vert.push(rota.at(-1));
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + haversineM(pts[i - 1], pts[i]));
  return { pts, vert, s, total: s.at(-1) };
}

// Pontos do próprio trajeto (vértices reais) para prender o Maps a ele
// quando não há desvio: sem parada, o Maps escolheria outra rota, que o app
// não conferiu (decisão 020).
export function pontosDaRota(rota, n = 3) {
  if (rota.length < 2) return [];
  const t = trilho(rota);
  const out = [];
  for (let k = 1; k <= n; k++) {
    const alvo = (t.total * k) / (n + 1);
    const i = t.s.findIndex((s) => s >= alvo);
    const v = t.vert[i < 0 ? t.vert.length - 1 : i];
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

const RAIO_RETORNO_M = 1000;
const EXCESSO_RETORNO_M = 600;

// Quanto da linha (já densificada) fica a até `raio` metros do centro.
function comprimentoNoRaio(linha, centro, raio) {
  let m = 0;
  for (let i = 0; i < linha.length - 1; i++) {
    if (haversineM(linha[i], centro) <= raio && haversineM(linha[i + 1], centro) <= raio) {
      m += haversineM(linha[i], linha[i + 1]);
    }
  }
  return m;
}

function distAteLinha(p, ref) {
  let m = Infinity;
  for (const q of ref) { const d = haversineM(p, q); if (d < m) m = d; }
  return m;
}

// Uma parada por "barriga": cada trecho contínuo em que a rota segura se
// afasta da direta ganha uma parada no ponto mais afastado.
// Devolve âncoras { ponto, s, s0 } em ordem ao longo da rota segura.
export function ancorasIniciais(rotaSegura, rotaBase, { max = MAX_PARADAS, minAfastamentoM = MIN_AFASTAMENTO_M } = {}) {
  if (rotaSegura.length < 2 || rotaBase.length < 1) return [];
  const t = trilho(rotaSegura);
  // rotaBase pode ter centenas de pontos: densifica pouco para medir distância.
  const ref = amostraAoLongo(rotaBase, 100);
  const dists = t.pts.map((p) => distAteLinha(p, ref));
  const picos = [];
  let pico = null;
  for (let i = 0; i < dists.length; i++) {
    if (dists[i] > minAfastamentoM) {
      if (!pico || dists[i] > pico.d) pico = { i, d: dists[i] };
    } else if (pico) { picos.push(pico); pico = null; }
  }
  if (pico) picos.push(pico);
  const usados = picos
    .filter((p) => t.s[p.i] > FOLGA_PONTA_M && t.total - t.s[p.i] > FOLGA_PONTA_M)
    .sort((a, b) => b.d - a.d)
    .slice(0, max)
    .sort((a, b) => a.i - b.i);
  return usados.map(({ i }) => ({ ponto: t.vert[i], s: t.s[i], s0: t.s[i] }));
}

export function extraiWaypoints(rotaSegura, rotaBase, opts) {
  return ancorasIniciais(rotaSegura, rotaBase, opts).map((a) => a.ponto);
}

// Olha o caminho que um roteador faria passando pelas paradas atuais
// (simulada: { pernas: [{ pontos }] }, uma perna entre cada par de paradas)
// e decide o que mudar. Duas falhas:
//  1. uma perna entra numa área que a rota segura evita → nova parada no
//     ponto da rota segura mais afastado dessa perna;
//  2. o caminho dá uma volta grande perto de uma parada (parada presa na
//     pista errada, retorno) → a parada anda 300 m ao longo da rota.
// Pura: devolve { ancoras, entradas, retornos, mudou }.
export function avaliaSimulacao({ segura, ancoras, simulada, areas, max = MAX_PARADAS }) {
  const t = trilho(segura);
  const evitadas = areas.filter((a) => !areaExpirada(a) && !rotaAtinge(segura, a));
  const n = ancoras.length;
  const cortes = [0, ...ancoras.map((a) => a.s), t.total];
  const pernas = simulada.pernas?.length === n + 1 ? simulada.pernas : null;

  const entradas = [];
  const novas = [];
  if (!pernas) {
    for (const at of atingimentosDaRota(simulada.pontos || [], evitadas)) entradas.push({ area: at.area, perna: -1 });
  } else {
    pernas.forEach((perna, k) => {
      const ats = atingimentosDaRota(perna.pontos, evitadas);
      if (!ats.length) return;
      for (const at of ats) entradas.push({ area: at.area, perna: k });
      // Ponto da rota segura, dentro deste trecho, mais longe do atalho.
      const ref = amostraAoLongo(perna.pontos, 100);
      let melhor = null;
      for (let i = 0; i < t.pts.length; i++) {
        if (t.s[i] <= cortes[k] + FOLGA_PONTA_M || t.s[i] >= cortes[k + 1] - FOLGA_PONTA_M) continue;
        const d = distAteLinha(t.pts[i], ref);
        if (!melhor || d > melhor.d) melhor = { i, d };
      }
      if (melhor && melhor.d > 25) novas.push({ ponto: t.vert[melhor.i], s: t.s[melhor.i], s0: t.s[melhor.i] });
    });
  }

  // Retorno: perto da parada, o caminho simulado anda bem mais que a rota
  // segura (vai além e volta). Medido num raio em volta da parada, para
  // não confundir com um caminho diferente, porém razoável, entre paradas.
  const retornos = [];
  const movidas = ancoras.map((a) => ({ ...a }));
  const sim = amostraAoLongo(pernas ? pernas.flatMap((p) => p.pontos) : (simulada.pontos || []), 50);
  const seg = amostraAoLongo(segura, 50);
  if (sim.length > 1) {
    for (let j = 0; j < n; j++) {
      const volta = comprimentoNoRaio(sim, ancoras[j].ponto, RAIO_RETORNO_M) -
                    comprimentoNoRaio(seg, ancoras[j].ponto, RAIO_RETORNO_M);
      if (volta <= EXCESSO_RETORNO_M) continue;
      retornos.push({ parada: j, metros: volta });
      // Primeiro 300 m para frente; se já andou, 300 m para trás da original.
      const a = movidas[j];
      const alvo = a.s === a.s0 ? a.s0 + 300 : (a.s > a.s0 ? a.s0 - 300 : null);
      if (alvo == null || alvo <= cortes[j] + FOLGA_PONTA_M || alvo >= cortes[j + 2] - FOLGA_PONTA_M) continue;
      let i = t.s.findIndex((s) => s >= alvo);
      if (i < 0) i = t.pts.length - 1;
      movidas[j] = { ponto: t.vert[i], s: t.s[i], s0: a.s0 };
    }
  }

  const cabem = novas.slice(0, Math.max(0, max - n));
  const resultado = [...movidas, ...cabem].sort((a, b) => a.s - b.s);
  const mudou = cabem.length > 0 || movidas.some((a, j) => a.s !== ancoras[j].s);
  return { ancoras: resultado, entradas, retornos, mudou };
}

export const CONFERENCIA = Object.freeze({
  CONFERIDA: 'conferida',          // o caminho pelas paradas fica fora das áreas
  NAO_GARANTIDA: 'nao-garantida',  // mesmo ajustando, ainda entra em alguma
  NAO_CONFERIDA: 'nao-conferida',  // não deu para simular (rede, servidor)
});

// Escolhe as paradas e confere o caminho que um roteador faria por elas.
// `simula(paradas)` é injetada (a rede fica fora do núcleo) e devolve
// { pontos, pernas: [{ pontos }] }.
export async function refinaParadas({ segura, base, areas, simula, max = MAX_PARADAS, maxSimulacoes = 4 }) {
  let ancoras = ancorasIniciais(segura.pontos, base.pontos, { max });
  let conferidas = null; // última combinação simulada que ficou fora das áreas
  let entradas = [];
  let simulacoes = 0;
  const pontos = (as) => as.map((a) => a.ponto);
  for (;;) {
    let sim;
    if (!ancoras.length) {
      // Sem parada nenhuma o Maps faz a rota direta — já está em mãos.
      sim = { pontos: base.pontos, pernas: [{ pontos: base.pontos }] };
    } else {
      if (simulacoes >= maxSimulacoes) break;
      simulacoes++;
      try {
        sim = await simula(pontos(ancoras));
      } catch (erro) {
        if (conferidas) break;
        return { paradas: pontos(ancoras), conferencia: CONFERENCIA.NAO_CONFERIDA, simulacoes, entradas: [], erro };
      }
    }
    const r = avaliaSimulacao({ segura: segura.pontos, ancoras, simulada: sim, areas, max });
    entradas = r.entradas;
    if (!entradas.length) conferidas = ancoras;
    if ((!entradas.length && !r.retornos.length) || !r.mudou) break;
    ancoras = r.ancoras;
  }
  if (conferidas) return { paradas: pontos(conferidas), conferencia: CONFERENCIA.CONFERIDA, simulacoes, entradas: [] };
  return { paradas: pontos(ancoras), conferencia: CONFERENCIA.NAO_GARANTIDA, simulacoes, entradas };
}

const fmt = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;

export function deeplinkMaps(origem, destino, waypoints = [], modal = 'driving') {
  let url = 'https://www.google.com/maps/dir/?api=1' +
    `&origin=${encodeURIComponent(fmt(origem))}` +
    `&destination=${encodeURIComponent(fmt(destino))}`;
  if (waypoints.length) {
    url += `&waypoints=${encodeURIComponent(waypoints.slice(0, 9).map(fmt).join('|'))}`;
  }
  return url + `&travelmode=${modal}&dir_action=navigate`;
}

// Sem Waze: ele só aceita destino, então levaria a pessoa por uma rota que o
// app não conferiu (decisão 020).

// ---------------------------------------------------- veredito

export const ESTADO = Object.freeze({
  LIMPA: 'limpa',
  COM_ALTERNATIVA: 'alternativa',
  PARCIAL: 'parcial',
  SEM_ALTERNATIVA: 'sem',
  FALHA: 'falha',
});

// Por que não houve desvio — o veredito nunca diz "não há caminho" quando o
// motor nem foi consultado.
export const MOTIVO = Object.freeze({
  GRANDE: 'grande',             // área grande demais para o motor; contorno por pontos falhou
  PONTA: 'ponta',               // origem ou destino dentro da área
  MOTOR_CRUZOU: 'motor-cruzou', // o motor devolveu caminho que ainda passa por dentro
  SEM_CAMINHO: 'sem-caminho',   // o motor não achou caminho por fora
});

function motivoSemDesvio({ origem, destino, atingBase, deixadasDeFora, seguraCruzou }) {
  const fora = new Set(deixadasDeFora.map((a) => a.id));
  const grandes = atingBase.filter((at) => fora.has(at.area.id)).map((at) => at.area);
  if (grandes.length) return { tipo: MOTIVO.GRANDE, areas: grandes };
  if (origem && destino && atingBase.some((at) =>
    pontoEmPoligono(origem, at.area.geometria) || pontoEmPoligono(destino, at.area.geometria))) {
    return { tipo: MOTIVO.PONTA };
  }
  return { tipo: seguraCruzou ? MOTIVO.MOTOR_CRUZOU : MOTIVO.SEM_CAMINHO };
}

// base e segura: { pontos, km, min } | null
export function montaVeredito({ origem, destino, base, segura, areas, deixadasDeFora = [] }) {
  const atingBase = atingimentosDaRota(base.pontos, areas);
  if (!atingBase.length) {
    return { estado: ESTADO.LIMPA, base, segura: null, atingimentos: [], restantes: [], waypoints: [] };
  }
  if (!segura) {
    const motivo = motivoSemDesvio({ origem, destino, atingBase, deixadasDeFora, seguraCruzou: false });
    return { estado: ESTADO.SEM_ALTERNATIVA, base, segura: null, atingimentos: atingBase, restantes: atingBase, waypoints: [], deixadasDeFora, motivo };
  }
  // A rota "segura" é SEMPRE conferida localmente contra todas as áreas —
  // o motor pode ter recebido só parte delas (orçamento de perímetro).
  const atingSeg = atingimentosDaRota(segura.pontos, areas);
  const mBase = atingBase.reduce((s, a) => s + a.metrosDentro, 0);
  const mSeg = atingSeg.reduce((s, a) => s + a.metrosDentro, 0);
  const waypoints = extraiWaypoints(segura.pontos, base.pontos);

  if (!atingSeg.length) {
    return { estado: ESTADO.COM_ALTERNATIVA, base, segura, atingimentos: atingBase, restantes: [], waypoints, deixadasDeFora };
  }
  if (mSeg < mBase * 0.8) {
    return { estado: ESTADO.PARCIAL, base, segura, atingimentos: atingBase, restantes: atingSeg, waypoints, deixadasDeFora };
  }
  const motivo = motivoSemDesvio({ origem, destino, atingBase, deixadasDeFora, seguraCruzou: true });
  return { estado: ESTADO.SEM_ALTERNATIVA, base, segura: null, atingimentos: atingBase, restantes: atingBase, waypoints: [], deixadasDeFora, motivo };
}

// ------------------------------------------- áreas grandes demais

// O Valhalla público só aceita ~10 km de contorno somado por pedido. Área
// maior não vai como exclusão: o app tenta dar a volta nela por pontos de
// passagem, um lado de cada vez, e fica com o lado que passa por fora.

function projecaoLocal(pts) {
  const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lon0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const k = Math.cos(rad(lat0)) * 111320;
  return {
    xy: ([la, lo]) => [(lo - lon0) * k, (la - lat0) * 110540],
    ll: ([x, y]) => [lat0 + y / 110540, lon0 + x / k],
  };
}

// Casco convexo (cadeia monótona), sentido anti-horário.
function cascoConvexo(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cruz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const baixo = [], cima = [];
  for (const q of p) {
    while (baixo.length >= 2 && cruz(baixo.at(-2), baixo.at(-1), q) <= 0) baixo.pop();
    baixo.push(q);
  }
  for (const q of p.reverse()) {
    while (cima.length >= 2 && cruz(cima.at(-2), cima.at(-1), q) <= 0) cima.pop();
    cima.push(q);
  }
  return [...baixo.slice(0, -1), ...cima.slice(0, -1)];
}

// Os dois jeitos de dar a volta na área a partir de onde a rota entra até
// onde sai, `folgaM` para fora do casco convexo da área.
export function ladosDoContorno(geometria, rota, { folgaM = 300 } = {}) {
  if (geometria.length < 3 || rota.length < 2) return null;
  const { xy, ll } = projecaoLocal(geometria);
  const casco = cascoConvexo(geometria.map(xy));
  if (casco.length < 3) return null;
  const n = casco.length;
  const normal = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; };
  const anel = casco.map((v, i) => {
    const n1 = normal(casco[(i - 1 + n) % n], v);
    const n2 = normal(v, casco[(i + 1) % n]);
    const bx = n1[0] + n2[0], by = n1[1] + n2[1], bl = Math.hypot(bx, by) || 1;
    const d = folgaM / Math.max(0.3, (bx * n1[0] + by * n1[1]) / bl);
    return [v[0] + (bx / bl) * d, v[1] + (by / bl) * d];
  });

  // Onde a rota entra e sai do anel folgado.
  const anelLL = anel.map(ll);
  const dentro = amostraAoLongo(rota, 50).filter((p) => pontoEmPoligono(p, anelLL));
  if (!dentro.length) return null;

  const segs = anel.map((a, i) => [a, anel[(i + 1) % n]]);
  const acum = [0];
  segs.forEach(([a, b]) => acum.push(acum.at(-1) + Math.hypot(b[0] - a[0], b[1] - a[1])));
  const P = acum.at(-1);
  const posicaoNoAnel = (p) => {
    let melhor = { d: Infinity, s: 0 };
    segs.forEach(([a, b], i) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
      if (d < melhor.d) melhor = { d, s: acum[i] + t * (acum[i + 1] - acum[i]) };
    });
    return melhor.s;
  };
  const pontoNoAnel = (s) => {
    s = ((s % P) + P) % P;
    let i = 0;
    while (i < n - 1 && acum[i + 1] < s) i++;
    const [a, b] = segs[i];
    const t = (s - acum[i]) / ((acum[i + 1] - acum[i]) || 1);
    return ll([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  };

  const sE = posicaoNoAnel(xy(dentro[0]));
  const sX = posicaoNoAnel(xy(dentro.at(-1)));
  const ida = ((sX - sE) % P + P) % P || P / 2;
  const volta = P - ida;
  // Cada lado: ponto de entrada, os cantos do anel no caminho, ponto de saída.
  // Ligar cantos vizinhos segue a borda do anel, que fica toda por fora.
  const lado = (sentido, comprimento) => {
    const cantos = anel
      .map((v, i) => ({ v, off: (((acum[i] - sE) * sentido) % P + P) % P }))
      .filter((c) => c.off > 1 && c.off < comprimento - 1)
      .sort((a, b) => a.off - b.off)
      .map((c) => ll(c.v));
    const passo = Math.max(1, Math.ceil(cantos.length / MAX_CANTOS));
    return [pontoNoAnel(sE), ...cantos.filter((_, i) => i % passo === 0), pontoNoAnel(sX)];
  };
  return [lado(1, ida), lado(-1, volta)];
}
const MAX_CANTOS = 5;

// `calcula(vias)` é injetada e devolve { pontos, km, min }. Tenta os dois
// lados de cada área grande (até `maxAreas`), fica com o mais curto que passa
// por fora. Devolve { rota, vias }; { erro } se nenhum lado serviu e algum
// pedido falhou (rede, servidor ocupado); null se o motor respondeu e nenhum
// lado ficou fora.
export async function contornaAreasGrandes({ rota, grandes, calcula, maxAreas = 2 }) {
  let atual = rota;
  let grupos = []; // um grupo de pontos por área, na ordem em que a rota passa
  const posicao = (p) => {
    let m = Infinity, k = 0;
    rota.pontos.forEach((q, i) => { const d = haversineM(p, q); if (d < m) { m = d; k = i; } });
    return k;
  };
  const vias = (gs) => gs.flatMap((g) => g.pts);
  let erro = null;

  for (const area of grandes.slice(0, maxAreas)) {
    if (!rotaAtinge(atual.pontos, area)) continue;
    const lados = ladosDoContorno(area.geometria, atual.pontos);
    if (!lados) continue;
    let melhor = null;
    for (const lado of lados) {
      const tentativa = [...grupos, { k: posicao(lado[0]), pts: lado }].sort((a, b) => a.k - b.k);
      let r;
      try { r = await calcula(vias(tentativa)); } catch (e) { erro = e; continue; }
      if (rotaAtinge(r.pontos, area)) continue;
      if (!melhor || r.km < melhor.r.km) melhor = { r, grupos: tentativa };
    }
    if (melhor) { atual = melhor.r; grupos = melhor.grupos; }
  }
  if (grupos.length) return { rota: atual, vias: vias(grupos) };
  return erro ? { erro } : null;
}

// ---------------------------------------------------- vocabulário

// Área própria é "área que eu evito". "Risco" só na camada oficial.
export function nomeExibicao(area) {
  switch (area.escopo) {
    case 'oficial': return area.categoria || 'Área de risco registrada';
    case 'publica': return area.rotulo || area.categoria || 'Área sinalizada';
    default: return area.rotulo || 'Área que eu evito';
  }
}

// ----------------------------------------------- GeoJSON (entrada hostil)

const MAX_GEOJSON_BYTES = 2 * 1024 * 1024;
const MAX_FEATURES = 500;
const CAMPOS_PERMITIDOS = ['rotulo', 'nome', 'name', 'severidade'];

// Nunca joga campo arbitrário do arquivo no modelo: whitelist.
// Toda área importada entra como PRIVADA — quem importa passa a evitá-la.
export function importaGeoJson(texto, { idBase = Date.now() } = {}) {
  const erros = [];
  if (typeof texto !== 'string') return { areas: [], erros: ['Arquivo ilegível.'] };
  if (texto.length > MAX_GEOJSON_BYTES) return { areas: [], erros: ['Arquivo grande demais (máximo 2 MB).'] };
  let j;
  try { j = JSON.parse(texto); } catch { return { areas: [], erros: ['Isso não é um arquivo GeoJSON válido.'] }; }

  let feats = [];
  if (j?.type === 'FeatureCollection' && Array.isArray(j.features)) feats = j.features;
  else if (j?.type === 'Feature') feats = [j];
  else if (j?.type === 'Polygon' || j?.type === 'MultiPolygon') feats = [{ type: 'Feature', geometry: j, properties: {} }];
  else return { areas: [], erros: ['O arquivo não tem áreas (polígonos).'] };

  if (feats.length > MAX_FEATURES) {
    erros.push(`Arquivo com áreas demais; só as primeiras ${MAX_FEATURES} foram lidas.`);
    feats = feats.slice(0, MAX_FEATURES);
  }

  const areas = [];
  let n = 0;
  for (const f of feats) {
    const g = f?.geometry;
    const aneis = g?.type === 'Polygon' ? [g.coordinates?.[0]]
      : g?.type === 'MultiPolygon' ? (g.coordinates || []).map((pl) => pl?.[0]) : [];
    const props = f?.properties && typeof f.properties === 'object' ? f.properties : {};
    const limpos = {};
    for (const k of CAMPOS_PERMITIDOS) if (k in props) limpos[k] = props[k];
    const rotulo = typeof (limpos.rotulo ?? limpos.nome ?? limpos.name) === 'string'
      ? String(limpos.rotulo ?? limpos.nome ?? limpos.name).slice(0, 60) : null;
    const sev = [1, 2, 3].includes(limpos.severidade) ? limpos.severidade : 1;

    for (const anel of aneis) {
      if (!Array.isArray(anel)) continue;
      const pts = anel
        .filter((c) => Array.isArray(c) && c.length >= 2)
        .map((c) => [Number(c[1]), Number(c[0])]);
      if (pts.length > 1) {
        const a = pts[0], b = pts.at(-1);
        if (a[0] === b[0] && a[1] === b[1]) pts.pop();
      }
      const v = validaPoligono(pts);
      if (v.erros.length) { erros.push(`${rotulo || 'Área'}: ${v.erros[0]}`); continue; }
      areas.push({
        id: `imp-${idBase}-${n++}`,
        geometria: pts,
        escopo: 'privada',
        rotulo,
        severidade: sev,
        criadaEm: new Date().toISOString(),
      });
    }
  }
  return { areas, erros };
}

export function exportaGeoJson(areas) {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: areas.map((a) => ({
      type: 'Feature',
      properties: { rotulo: a.rotulo || null, severidade: a.severidade ?? 1 },
      geometry: {
        type: 'Polygon',
        coordinates: [[...a.geometria, a.geometria[0]].map(([la, lo]) => [+lo.toFixed(6), +la.toFixed(6)])],
      },
    })),
  });
}
