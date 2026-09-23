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
  assert.ok(v.waypoints.length >= 1 && v.waypoints.length <= 3);
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

// ------------------------------------------------------------ deeplinks

test('deeplink Maps leva waypoints; Waze não', () => {
  const m = C.deeplinkMaps([-22.93, -43.57], [-22.97, -43.40], [[-22.95, -43.5]]);
  assert.match(m, /api=1/);
  assert.match(m, /waypoints=/);
  assert.doesNotMatch(C.deeplinkWaze([-22.97, -43.40]), /waypoints/);
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
