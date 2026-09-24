// Testes do núcleo. Rodam com `node --test test/` — sem navegador, sem rede.
//
// Fixtures reais:
//  - link do Google Maps compartilhado pelo Marcelo (Zona Oeste → BRT Morro do Outeiro)
//  - rota devolvida pelo Valhalla público para esse mesmo par (32,61 km, 700 pontos)

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../js/core.js';

const URL_REAL =
  'https://www.google.com/maps/dir/-22.9358454,-43.5704374/' +
  'Esta%C3%A7%C3%A3o+BRT+Morro+do+Outeiro/' +
  'data=!4m12!4m11!1m1!4e1!1m5!1m4!1s0x9bdb8215f58f0d:0x71b5db0a5fb87bb4' +
  '!8m2!3d-22.9715354!4d-43.4013443!2m1!11b1!3e0?skid=e071b576';

const SHAPE = readFileSync(new URL('./fixtures/valhalla_zona_oeste.shape', import.meta.url), 'utf8').trim();
const rotaReal = C.decodePolyline(SHAPE);

const quadrado = (lat, lon, d) => [[lat - d, lon - d], [lat - d, lon + d], [lat + d, lon + d], [lat + d, lon - d]];
const area = (geometria, extra = {}) => ({ id: extra.id || Math.random().toString(36).slice(2), geometria, escopo: 'privada', severidade: 1, ...extra });

// ------------------------------------------------------------ parser

test('parser: link real da Zona Oeste', () => {
  const r = C.parseUrlMaps(URL_REAL);
  assert.deepEqual(r.origem, [-22.9358454, -43.5704374]);
  assert.deepEqual(r.destino, [-22.9715354, -43.4013443]);
  assert.match(r.destinoNome, /Morro do Outeiro/);
  assert.equal(r.modal, 'driving');
  assert.deepEqual(r.pendentes, []);
});

test('parser: link curto é reconhecido como curto (precisa expandir)', () => {
  const r = C.parseUrlMaps('https://maps.app.goo.gl/mW2Nw3YvEopLBnLY6');
  assert.equal(r.curto, true);
  assert.equal(r.origem, null);
});

test('parser: formato api=1', () => {
  const r = C.parseUrlMaps('https://www.google.com/maps/dir/?api=1&origin=-22.9,-43.5&destination=-22.97,-43.4');
  assert.deepEqual(r.origem, [-22.9, -43.5]);
  assert.deepEqual(r.destino, [-22.97, -43.4]);
});

test('parser: nunca lança exceção com entrada hostil', () => {
  for (const u of ['', 'lixo!!!', null, 42, 'https://www.google.com/maps/@-22.9,-43.1,15z',
    'https://www.google.com/maps/dir/999,-43.5/-22.9,-43.4/', 'https://www.google.com/maps/dir/' + 'a'.repeat(100000)]) {
    assert.doesNotThrow(() => C.parseUrlMaps(u));
  }
});

// ------------------------------------------------------- polyline real

test('polyline real do Valhalla: íntegra e bate com o servidor', () => {
  assert.equal(rotaReal.length, 700);
  assert.ok(C.haversineM(rotaReal[0], [-22.9358454, -43.5704374]) < 100, 'começa na origem');
  assert.ok(C.haversineM(rotaReal.at(-1), [-22.9715354, -43.4013443]) < 100, 'termina no destino');
  const km = C.comprimentoM(rotaReal) / 1000;
  assert.ok(Math.abs(km - 32.614) < 0.05, `comprimento ${km} deve bater com 32,614 do servidor`);
});

// ---------------------------------------------------------- validação

test('validação: área pequena passa sem erro', () => {
  const v = C.validaPoligono(quadrado(-22.97, -43.47, 0.005));
  assert.deepEqual(v.erros, []);
});

test('validação: área gigante é recusada', () => {
  const v = C.validaPoligono(quadrado(-22.9, -43.4, 0.2));
  assert.ok(v.erros.length > 0);
});

test('validação: aviso de perímetro sem bloquear', () => {
  const v = C.validaPoligono(quadrado(-22.97, -43.47, 0.015)); // ~3,3 km de lado
  assert.deepEqual(v.erros, []);
  assert.ok(v.avisos.length > 0);
});

test('validação: recusa NaN, poucos pontos, fora do Rio', () => {
  assert.ok(C.validaPoligono([[-22.9, -43.5]]).erros.length);
  assert.ok(C.validaPoligono([[NaN, -43.5], [-22.9, -43.4], [-22.8, -43.4]]).erros.length);
  assert.ok(C.validaPoligono(quadrado(-23.55, -46.63, 0.01)).erros.length); // São Paulo
});

// ---------------------------------------------------- interseção real

test('interseção: área sobre o meio da rota real é detectada com metragem', () => {
  const meio = rotaReal[350];
  const a = area(quadrado(meio[0], meio[1], 0.004));
  const at = C.rotaAtinge(rotaReal, a);
  assert.ok(at, 'deveria cruzar');
  assert.ok(at.metrosDentro > 200, `metros dentro = ${at.metrosDentro}`);
});

test('interseção: área longe da rota real não é acusada', () => {
  const a = area(quadrado(-22.86, -43.30, 0.005)); // Zona Norte
  assert.equal(C.rotaAtinge(rotaReal, a), null);
});

test('interseção: área expirada é ignorada', () => {
  const meio = rotaReal[350];
  const a = area(quadrado(meio[0], meio[1], 0.004), { escopo: 'oficial', validaAte: '2020-01-01' });
  assert.deepEqual(C.atingimentosDaRota(rotaReal, [a]), []);
});

// ---------------------------------------------------------- pré-filtro

test('pré-filtro: prioriza área atingida e respeita orçamento de perímetro', () => {
  const meio = rotaReal[350];
  const atingida = area(quadrado(meio[0], meio[1], 0.004), { id: 'hit' });
  const muitas = [atingida];
  for (let i = 0; i < 40; i++) muitas.push(area(quadrado(-22.95 - i * 0.001, -43.50 + i * 0.002, 0.004)));
  const { enviadas, deixadasDeFora } = C.preFiltraAreas(rotaReal[0], rotaReal.at(-1), muitas, { atingidasIds: ['hit'] });
  assert.equal(enviadas[0].id, 'hit');
  const soma = enviadas.reduce((s, a) => s + C.perimetroM(a.geometria), 0);
  assert.ok(soma <= C.LIMITES.orcamentoPerimetroM, `perímetro ${soma}`);
  assert.ok(deixadasDeFora.length > 0);
});

test('pré-filtro: área que contém a origem nunca é enviada', () => {
  const o = rotaReal[0];
  const { enviadas } = C.preFiltraAreas(o, rotaReal.at(-1), [area(quadrado(o[0], o[1], 0.003))]);
  assert.equal(enviadas.length, 0);
});

test('exclude_polygons: anéis fechados em [lon, lat]', () => {
  const [anel] = C.paraExcludePolygons([area(quadrado(-22.97, -43.47, 0.005))]);
  assert.deepEqual(anel[0], anel.at(-1));
  assert.ok(anel[0][0] < -43 && anel[0][1] > -23, 'lon primeiro, lat depois');
});

// ----------------------------------------------------------- veredito

function desvioSintetico(rota, i0, i1, deslocLat) {
  return rota.map((p, i) => (i > i0 && i < i1 ? [p[0] + deslocLat, p[1]] : p));
}

test('veredito: limpa quando nada é cruzado', () => {
  const v = C.montaVeredito({
    origem: rotaReal[0], destino: rotaReal.at(-1),
    base: { pontos: rotaReal, km: 32.6, min: 55 }, segura: null,
    areas: [area(quadrado(-22.86, -43.30, 0.005))],
  });
  assert.equal(v.estado, C.ESTADO.LIMPA);
});

test('veredito: com alternativa quando a rota segura passa por fora', () => {
  const meio = rotaReal[350];
  const a = area(quadrado(meio[0], meio[1], 0.003));
  const segura = desvioSintetico(rotaReal, 320, 380, 0.012);
  const v = C.montaVeredito({
    origem: rotaReal[0], destino: rotaReal.at(-1),
    base: { pontos: rotaReal, km: 32.6, min: 55 },
    segura: { pontos: segura, km: 34.1, min: 61 },
    areas: [a],
  });
  assert.equal(v.estado, C.ESTADO.COM_ALTERNATIVA);
  assert.ok(v.waypoints.length >= 1 && v.waypoints.length <= C.MAX_PARADAS);
});

test('veredito: sem alternativa quando o motor não achou caminho', () => {
  const meio = rotaReal[350];
  const v = C.montaVeredito({
    origem: rotaReal[0], destino: rotaReal.at(-1),
    base: { pontos: rotaReal, km: 32.6, min: 55 }, segura: null,
    areas: [area(quadrado(meio[0], meio[1], 0.003))],
  });
  assert.equal(v.estado, C.ESTADO.SEM_ALTERNATIVA);
});

test('veredito: rota "segura" que ainda cruza é conferida localmente', () => {
  const meio = rotaReal[350];
  const v = C.montaVeredito({
    origem: rotaReal[0], destino: rotaReal.at(-1),
    base: { pontos: rotaReal, km: 32.6, min: 55 },
    segura: { pontos: rotaReal, km: 32.6, min: 55 }, // motor ignorou a área
    areas: [area(quadrado(meio[0], meio[1], 0.003))],
  });
  assert.equal(v.estado, C.ESTADO.SEM_ALTERNATIVA, 'não pode prometer desvio que não existe');
});

// ------------------------------------------------- paradas para o Maps

// Rota segura com várias "barrigas" (trechos empurrados para o norte).
function comBarrigas(rota, faixas, deslocLat = 0.012) {
  return rota.map((p, i) => (faixas.some(([a, b]) => i > a && i < b) ? [p[0] + deslocLat, p[1]] : p));
}
const indiceMaisPerto = (rota, p) => {
  let m = Infinity, k = 0;
  rota.forEach((q, i) => { const d = C.haversineM(p, q); if (d < m) { m = d; k = i; } });
  return k;
};
// Simulador falso do Maps. Segue a rota segura entre as paradas, mas onde uma
// barriga não tem parada dentro, corta caminho pela rota direta.
function simuladorQueCorta(segura, base, faixas) {
  return async (paradas) => {
    const cortes = [0, ...paradas.map((p) => indiceMaisPerto(segura, p)), segura.length - 1];
    const pernas = [];
    for (let k = 0; k < cortes.length - 1; k++) {
      const [i, j] = [cortes[k], cortes[k + 1]];
      const semParada = faixas.filter(([a, b]) => i <= a && j >= b);
      const pts = [];
      for (let x = i; x <= j; x++) pts.push(semParada.some(([a, b]) => x > a && x < b) ? base[x] : segura[x]);
      pernas.push({ pontos: pts });
    }
    return { pontos: pernas.flatMap((l) => l.pontos), pernas };
  };
}

test('paradas: uma por barriga, e passa de 3 quando há mais desvios', () => {
  const faixas = [[60, 90], [180, 210], [300, 330], [420, 450], [540, 570]];
  const segura = comBarrigas(rotaReal, faixas);
  const ancoras = C.ancorasIniciais(segura, rotaReal);
  assert.ok(ancoras.length >= 5, `paradas: ${ancoras.length}`);
  faixas.forEach(([a, b], k) => {
    const trecho = segura.slice(a + 1, b);
    const perto = ancoras.some((x) => trecho.some((q) => C.haversineM(x.ponto, q) < 100));
    assert.ok(perto, `barriga ${k} ficou sem parada`);
  });
});

test('paradas: nunca passam do teto do Maps', () => {
  const faixas = Array.from({ length: 12 }, (_, k) => [20 + k * 55, 45 + k * 55]);
  const ancoras = C.ancorasIniciais(comBarrigas(rotaReal, faixas), rotaReal);
  assert.equal(ancoras.length, C.MAX_PARADAS);
});

test('conferência: Maps seguindo as paradas → conferida com uma simulação', async () => {
  const faixas = [[470, 530], [580, 640]];
  const segura = comBarrigas(rotaReal, faixas);
  const areas = [area(quadrado(...rotaReal[500], 0.003)), area(quadrado(...rotaReal[610], 0.002))];
  const r = await C.refinaParadas({
    segura: { pontos: segura }, base: { pontos: rotaReal }, areas,
    simula: simuladorQueCorta(segura, rotaReal, faixas),
  });
  assert.equal(r.conferencia, C.CONFERENCIA.CONFERIDA);
  assert.equal(r.paradas.length, 2);
  assert.equal(r.simulacoes, 1);
});

test('conferência: desvio curto sem parada inicial ganha parada e fica conferido', async () => {
  // Desvio de ~100 m: abaixo do corte das barrigas, então nenhuma parada
  // inicial — e sem parada o Maps faria a rota direta, por dentro da área.
  const faixas = [[340, 360]];
  const segura = comBarrigas(rotaReal, faixas, 0.0009);
  const areas = [area(quadrado(...rotaReal[350], 0.0003))];
  assert.equal(C.ancorasIniciais(segura, rotaReal).length, 0);
  assert.ok(C.rotaAtinge(rotaReal, areas[0]) && !C.rotaAtinge(segura, areas[0]));
  const r = await C.refinaParadas({
    segura: { pontos: segura }, base: { pontos: rotaReal }, areas,
    simula: simuladorQueCorta(segura, rotaReal, faixas),
  });
  assert.equal(r.conferencia, C.CONFERENCIA.CONFERIDA);
  assert.equal(r.paradas.length, 1);
  const i = indiceMaisPerto(segura, r.paradas[0]);
  assert.ok(i > 340 && i < 360, `parada fora do desvio (${i})`);
});

test('conferência: Maps que ignora as paradas → não garantida, com a área e dentro dos limites', async () => {
  const faixas = [[470, 530]];
  const segura = comBarrigas(rotaReal, faixas);
  const a = area(quadrado(...rotaReal[500], 0.003), { rotulo: 'Trecho X' });
  let chamadas = 0;
  const r = await C.refinaParadas({
    segura: { pontos: segura }, base: { pontos: rotaReal }, areas: [a],
    simula: async () => { chamadas++; return { pontos: rotaReal, pernas: null }; },
  });
  assert.equal(r.conferencia, C.CONFERENCIA.NAO_GARANTIDA);
  assert.equal(r.entradas[0].area.id, a.id);
  assert.ok(r.paradas.length >= 1 && r.paradas.length <= C.MAX_PARADAS);
  assert.ok(chamadas <= 4, `simulações: ${chamadas}`);
});

test('conferência: parada que força retorno é deslocada ao longo da rota', async () => {
  const faixas = [[470, 530]];
  const segura = comBarrigas(rotaReal, faixas);
  const areas = [area(quadrado(...rotaReal[500], 0.003))];
  const [inicial] = C.ancorasIniciais(segura, rotaReal);
  const segue = simuladorQueCorta(segura, rotaReal, faixas);
  const r = await C.refinaParadas({
    segura: { pontos: segura }, base: { pontos: rotaReal }, areas,
    simula: async (paradas) => {
      const sim = await segue(paradas);
      if (C.haversineM(paradas[0], inicial.ponto) < 1) {
        // Parada presa na pista errada: vai ~800 m além e volta.
        const p = sim.pernas[0].pontos.at(-1);
        sim.pernas[0].pontos.push([p[0] + 0.007, p[1]], p);
      }
      return sim;
    },
  });
  assert.equal(r.conferencia, C.CONFERENCIA.CONFERIDA);
  assert.equal(r.simulacoes, 2);
  const andou = C.haversineM(r.paradas[0], inicial.ponto);
  assert.ok(andou > 200 && andou < 450, `parada andou ${andou.toFixed(0)} m`);
});

test('conferência: falha de rede mantém as paradas e avisa que não conferiu', async () => {
  const faixas = [[470, 530]];
  const segura = comBarrigas(rotaReal, faixas);
  const r = await C.refinaParadas({
    segura: { pontos: segura }, base: { pontos: rotaReal },
    areas: [area(quadrado(...rotaReal[500], 0.003))],
    simula: async () => { throw new Error('sem rede'); },
  });
  assert.equal(r.conferencia, C.CONFERENCIA.NAO_CONFERIDA);
  assert.equal(r.paradas.length, 1);
});

// --------------------------------------------- áreas grandes demais

// Área grande (~5 km de lado, contorno ~21 km): passa do orçamento do motor.
const grande = () => area(quadrado(...rotaReal[500], 0.024), { id: 'grande', rotulo: 'Bairro inteiro' });
// Motor falso: liga origem → pontos de passagem → destino em linha reta.
const motorReto = (o, d) => async (vias) => {
  const pontos = [o, ...vias, d];
  return { pontos, km: C.comprimentoM(pontos) / 1000, min: 0 };
};

test('área grande: não cabe no motor e o veredito diz o motivo certo', () => {
  const a = grande();
  assert.ok(C.perimetroM(a.geometria) > C.LIMITES.orcamentoPerimetroM);
  const pf = C.preFiltraAreas(rotaReal[0], rotaReal.at(-1), [a], { atingidasIds: [a.id] });
  assert.equal(pf.enviadas.length, 0);
  const v = C.montaVeredito({
    origem: rotaReal[0], destino: rotaReal.at(-1),
    base: { pontos: rotaReal, km: 32.6, min: 55 }, segura: null,
    areas: [a], deixadasDeFora: pf.deixadasDeFora,
  });
  assert.equal(v.estado, C.ESTADO.SEM_ALTERNATIVA);
  assert.equal(v.motivo.tipo, C.MOTIVO.GRANDE, 'não pode dizer "não há caminho" sem ter perguntado');
  assert.equal(v.motivo.areas[0].id, a.id);
});

test('área grande: os dois lados do contorno ficam fora da área', () => {
  const a = grande();
  const lados = C.ladosDoContorno(a.geometria, rotaReal);
  assert.equal(lados.length, 2);
  for (const lado of lados) {
    assert.ok(lado.length >= 3, `pontos: ${lado.length}`);
    for (const p of lado) assert.ok(!C.pontoEmPoligono(p, a.geometria), 'ponto de passagem dentro da área');
  }
  // Um lado de cada: os pontos do meio ficam longe um do outro.
  const meio = (l) => l[Math.floor(l.length / 2)];
  assert.ok(C.haversineM(meio(lados[0]), meio(lados[1])) > 4000);
});

test('área grande: contorno por pontos acha caminho por fora e vira alternativa', async () => {
  const a = grande();
  const o = rotaReal[0], d = rotaReal.at(-1);
  const r = await C.contornaAreasGrandes({ rota: { pontos: rotaReal, km: 32.6 }, grandes: [a], calcula: motorReto(o, d) });
  assert.ok(r, 'deveria achar um lado');
  assert.equal(C.rotaAtinge(r.rota.pontos, a), null);
  const v = C.montaVeredito({
    origem: o, destino: d, base: { pontos: rotaReal, km: 32.6, min: 55 },
    segura: { ...r.rota, min: 70 }, areas: [a], deixadasDeFora: [a],
  });
  assert.equal(v.estado, C.ESTADO.COM_ALTERNATIVA);
});

test('área grande: se nenhum lado passa por fora, não inventa desvio', async () => {
  const a = grande();
  const r = await C.contornaAreasGrandes({
    rota: { pontos: rotaReal, km: 32.6 }, grandes: [a],
    calcula: async () => ({ pontos: rotaReal, km: 32.6 }), // motor sempre volta por dentro
  });
  assert.equal(r, null);
});

test('área grande: falha de rede não vira "não achei caminho"', async () => {
  const r = await C.contornaAreasGrandes({
    rota: { pontos: rotaReal, km: 32.6 }, grandes: [grande()],
    calcula: async () => { throw Object.assign(new Error('ocupado'), { tipo: 'servidor' }); },
  });
  assert.equal(r.erro.tipo, 'servidor');
});

test('veredito: origem dentro da área explica o motivo', () => {
  const o = rotaReal[0];
  const v = C.montaVeredito({
    origem: o, destino: rotaReal.at(-1), base: { pontos: rotaReal, km: 32.6, min: 55 }, segura: null,
    areas: [area(quadrado(o[0], o[1], 0.003))],
  });
  assert.equal(v.motivo.tipo, C.MOTIVO.PONTA);
});

// ------------------------------------------------------------ deeplinks

test('deeplink Maps leva waypoints', () => {
  const m = C.deeplinkMaps([-22.93, -43.57], [-22.97, -43.40], [[-22.95, -43.5]]);
  assert.match(m, /api=1/);
  assert.match(m, /waypoints=/);
  assert.equal(C.deeplinkWaze, undefined, 'Waze saiu: levaria por rota não conferida');
});

test('sem desvio, o link do Maps vai preso ao trajeto conferido, em vértices reais', () => {
  const pts = C.pontosDaRota(rotaReal);
  assert.equal(pts.length, 3);
  for (const p of pts) assert.ok(rotaReal.includes(p), 'ponto fora dos vértices da rota');
  const i = pts.map((p) => rotaReal.indexOf(p));
  assert.ok(i[0] < i[1] && i[1] < i[2], 'fora de ordem');
  assert.match(C.deeplinkMaps(rotaReal[0], rotaReal.at(-1), pts), /waypoints=/);
});

test('paradas do desvio são vértices reais da rota segura', async () => {
  const faixas = [[470, 530], [580, 640]];
  const segura = comBarrigas(rotaReal, faixas);
  const r = await C.refinaParadas({
    segura: { pontos: segura }, base: { pontos: rotaReal },
    areas: [area(quadrado(...rotaReal[500], 0.003)), area(quadrado(...rotaReal[610], 0.002))],
    simula: simuladorQueCorta(segura, rotaReal, faixas),
  });
  assert.ok(r.paradas.length >= 2);
  for (const p of r.paradas) assert.ok(segura.includes(p), 'parada entre vértices');
});

// ---------------------------------------------------------- vocabulário

test('vocabulário: área própria nunca é "risco"', () => {
  assert.equal(C.nomeExibicao({ escopo: 'privada' }), 'Área que eu evito');
  assert.doesNotMatch(C.nomeExibicao({ escopo: 'privada' }).toLowerCase(), /risco/);
  assert.match(C.nomeExibicao({ escopo: 'oficial' }).toLowerCase(), /risco/);
});

// ------------------------------------------------------ GeoJSON hostil

test('GeoJSON: ida e volta preserva a área', () => {
  const a = area(quadrado(-22.97, -43.47, 0.005), { rotulo: 'Trecho X' });
  const { areas, erros } = C.importaGeoJson(C.exportaGeoJson([a]));
  assert.deepEqual(erros, []);
  assert.equal(areas.length, 1);
  assert.equal(areas[0].rotulo, 'Trecho X');
  assert.equal(areas[0].geometria.length, 4);
});

test('GeoJSON: entrada hostil é recusada sem exceção', () => {
  assert.ok(C.importaGeoJson('não é json').erros.length);
  assert.ok(C.importaGeoJson('x'.repeat(3 * 1024 * 1024)).erros.length);
  assert.ok(C.importaGeoJson('{"type":"Point","coordinates":[0,0]}').erros.length);
  const r = C.importaGeoJson(JSON.stringify({
    type: 'Feature',
    properties: { rotulo: 'ok', __proto__: { admin: true }, escopo: 'oficial', script: '<img onerror=alert(1)>' },
    geometry: { type: 'Polygon', coordinates: [[[-43.47, -22.97], [-43.46, -22.97], [-43.46, -22.96], [-43.47, -22.97]]] },
  }));
  assert.equal(r.areas.length, 1);
  assert.equal(r.areas[0].escopo, 'privada', 'importado sempre entra como privado');
  assert.equal(r.areas[0].admin, undefined);
  assert.equal(r.areas[0].script, undefined);
});
