// Teste de fumaça: abre o app num Chromium de verdade, com a rede simulada,
// e percorre os fluxos principais. Uso:
//   python3 -m http.server 8765 &   (na raiz do app)
//   node test/fumaca.mjs
//
// A rede é simulada porque a máquina de desenvolvimento não alcança os
// serviços externos. A resposta "base" é a rota REAL que o Valhalla devolveu
// para o link da Zona Oeste.

import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const C = await import('../js/core.js');

const BASE = process.env.APP_URL || 'http://localhost:8765/';
const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SAIDA = new URL('./capturas/', import.meta.url).pathname;
mkdirSync(SAIDA, { recursive: true });

const shapeReal = readFileSync(new URL('./fixtures/valhalla_zona_oeste.shape', import.meta.url), 'utf8').trim();
const rotaReal = C.decodePolyline(shapeReal);

function encode(pts, prec = 6) {
  const f = 10 ** prec;
  let lat0 = 0, lon0 = 0, s = '';
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let o = '';
    while (v >= 0x20) { o += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    return o + String.fromCharCode(v + 63);
  };
  for (const [la, lo] of pts) {
    const a = Math.round(la * f), b = Math.round(lo * f);
    s += enc(a - lat0) + enc(b - lon0);
    lat0 = a; lon0 = b;
  }
  return s;
}

// Desvio sintético: empurra o miolo da rota ~1,3 km para o norte.
const desvio = rotaReal.map((p, i) => (i > 300 && i < 400 ? [p[0] + 0.012, p[1]] : p));
const shapeDesvio = encode(desvio);

let modoMotor = 'normal'; // normal | sem-caminho
const pedidos = [];

function respostaValhalla(url) {
  const q = JSON.parse(new URL(url).searchParams.get('json'));
  pedidos.push(q);
  const excl = !!q.exclude_polygons?.length;
  if (excl && modoMotor === 'sem-caminho') {
    return { status: 400, body: { error_code: 442, error: 'No path could be found for input', status_code: 400 } };
  }
  const shape = excl ? shapeDesvio : shapeReal;
  const km = excl ? 34.21 : 32.614;
  const t = excl ? 3710 : 3282.9;
  return { status: 200, body: { trip: { legs: [{ shape }], summary: { length: km, time: t }, status: 0 } } };
}

const erros = [];
const resultados = [];
const ok = (nome, cond, extra = '') => { resultados.push([cond, nome, extra]); };

const browser = await chromium.launch({ executablePath: EXE });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'pt-BR' });
const page = await ctx.newPage();
page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|openfreemap|ERR_FAILED/.test(m.text())) erros.push(`console: ${m.text()}`); });

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE)) return route.continue();
  if (url.includes('valhalla1.openstreetmap.de/route')) {
    const r = respostaValhalla(url);
    return route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(r.body) });
  }
  if (url.includes('photon.komoot.io')) {
    return route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ features: [
        { geometry: { coordinates: [-43.5626, -22.9024] }, properties: { name: 'Estação Campo Grande', city: 'Rio de Janeiro', district: 'Campo Grande' } },
        { geometry: { coordinates: [-43.5500, -22.9100] }, properties: { name: 'West Shopping', city: 'Rio de Janeiro', district: 'Campo Grande' } },
      ] }),
    });
  }
  return route.abort(); // tiles e o resto: sem rede, força o estilo offline
});


// WebGL por software (Chromium sem tela) apresenta o quadro com atraso:
// espera fixa em vez de 'idle', que resolve antes da tela atualizar.
const mapaOcioso = () => page.waitForTimeout(3000);

// 1. Primeira abertura
await page.goto(BASE);
await page.waitForSelector('#folha .rotulo-sec');
await page.waitForTimeout(900);
await page.screenshot({ path: `${SAIDA}01-inicio.png` });
ok('abre com tela de rota', await page.isVisible('text=Verificar uma rota'));
ok('mostra convite de exemplo', await page.isVisible('#carregar-exemplo'));

// 2. Exemplo → veredito com alternativa
await page.click('#carregar-exemplo');
await page.waitForSelector('text=Dá para desviar', { timeout: 15000 });
await mapaOcioso();
await page.screenshot({ path: `${SAIDA}02-veredito-alternativa.png` });
const desenhadas = await page.evaluate(() => {
  const m = window.__contorno.mapa;
  const n = (l) => (m.getLayer(l) ? m.queryRenderedFeatures({ layers: [l] }).length : -1);
  return { segura: n('rota-segura'), base: n('rota-base'), areas: n('areas-fill') };
});
ok('rota segura desenhada no mapa', desenhadas.segura > 0, JSON.stringify(desenhadas));
ok('rota direta desenhada no mapa', desenhadas.base > 0);
const hrefDesvio = await page.getAttribute('a:has-text("Navegar por fora")', 'href');
ok('deeplink do Maps leva waypoints', /waypoints=/.test(hrefDesvio || ''), hrefDesvio?.slice(0, 90));
ok('aviso do Waze aparece', await page.isVisible('text=O Waze não aceita desvio por área'));
ok('área própria chamada de "área que eu evito" ou rótulo', !(await page.textContent('#folha')).toLowerCase().includes('área de risco'));
const excl = pedidos.find((p) => p.exclude_polygons);
ok('motor recebeu exclude_polygons', !!excl);
ok('exclude_polygons em [lon,lat] e fechado', !!excl && excl.exclude_polygons[0][0][0] < -43 &&
  JSON.stringify(excl.exclude_polygons[0][0]) === JSON.stringify(excl.exclude_polygons[0].at(-1)));
ok('nenhum rótulo de área vai para a rede', !JSON.stringify(pedidos).includes('Exemplo'));

// 3. Sem caminho
modoMotor = 'sem-caminho';
await page.click('#nova');
await page.click('#verificar');
await page.waitForSelector('text=Não há como contornar', { timeout: 15000 });
await mapaOcioso();
await page.screenshot({ path: `${SAIDA}03-veredito-sem-desvio.png` });
ok('estado sem desvio', true);
modoMotor = 'normal';

// 4. Desenhar área
await page.click('#nova');
await page.click('#nova-area');
await page.waitForSelector('text=Toque no mapa para marcar os cantos');
const box = await page.locator('#mapa').boundingBox();
for (const [dx, dy] of [[0.30, 0.18], [0.62, 0.16], [0.66, 0.36], [0.34, 0.40]]) {
  await page.mouse.click(box.x + box.width * dx, box.y + box.height * dy);
  await page.waitForTimeout(120);
}
await page.screenshot({ path: `${SAIDA}04-desenhando.png` });
ok('contador de pontos', await page.isVisible('text=4 pontos'));
await page.click('#concluir');
await page.waitForSelector('#folha .titulo');
const tituloNomear = await page.textContent('#folha .titulo');
ok('validação roda ao concluir', /nome|não pode/i.test(tituloNomear), tituloNomear);
if (await page.isVisible('#rotulo-area')) {
  await page.fill('#rotulo-area', 'Trecho que eu evito à noite');
  await page.click('#salvar-area');
  await page.waitForSelector('text=Área salva');
  ok('área salva', (await page.textContent('#contador-areas')) === '2');
}

// 5. Painel de áreas
await page.click('#abrir-areas');
await page.waitForSelector('#painel-areas:not([hidden])');
await page.screenshot({ path: `${SAIDA}05-minhas-areas.png` });
ok('painel lista as áreas', (await page.locator('.item-area').count()) >= 2);
const persistiu = await page.evaluate(() => JSON.parse(localStorage.getItem('contorno.v1')).areas.length);
ok('áreas persistem no aparelho', persistiu >= 2, String(persistiu));
await page.click('#fechar-areas');

// 6. Share target com link longo real
const URL_REAL = 'https://www.google.com/maps/dir/-22.9358454,-43.5704374/Esta%C3%A7%C3%A3o+BRT+Morro+do+Outeiro/data=!4m12!4m11!1m1!4e1!1m5!1m4!1s0x9bdb8215f58f0d:0x71b5db0a5fb87bb4!8m2!3d-22.9715354!4d-43.4013443!2m1!11b1!3e0';
await page.goto(`${BASE}?text=${encodeURIComponent('Rota: ' + URL_REAL)}`);
await page.waitForSelector('#folha .selo', { timeout: 15000 });
ok('compartilhar do Maps abre direto no veredito', true, await page.textContent('#folha .selo'));
ok('share target limpa a URL', !(await page.evaluate(() => location.search)));

// 7. Link curto → mensagem honesta, sem quebrar
await page.goto(`${BASE}?text=${encodeURIComponent('https://maps.app.goo.gl/mW2Nw3YvEopLBnLY6')}`);
await page.waitForSelector('text=link curto do Google');
await page.screenshot({ path: `${SAIDA}06-link-curto.png` });
ok('link curto explica e cai na entrada manual', true);

// 8. Busca de endereço
await page.fill('#in-origem', 'campo grande');
await page.waitForSelector('#sug-origem:not([hidden]) button');
ok('sugestões de endereço aparecem', (await page.locator('#sug-origem button').count()) === 2);

// 9. Tema escuro não quebra
await page.emulateMedia({ colorScheme: 'dark' });
await page.goto(BASE);
await page.waitForSelector('#folha .rotulo-sec');
await page.waitForTimeout(500);
await page.screenshot({ path: `${SAIDA}07-escuro.png` });

// 10. Largura de desktop
await page.setViewportSize({ width: 1280, height: 800 });
await page.emulateMedia({ colorScheme: 'light' });
await page.goto(`${BASE}?text=${encodeURIComponent(URL_REAL)}`);
await page.waitForSelector('#folha .selo', { timeout: 15000 });
await mapaOcioso();
await page.screenshot({ path: `${SAIDA}08-desktop.png` });

await browser.close();

ok('sem erro de JavaScript', erros.length === 0, erros.join(' | '));
let falhas = 0;
for (const [c, n, x] of resultados) {
  if (!c) falhas++;
  console.log(`${c ? 'PASSOU' : 'FALHOU'}  ${n}${x ? `  — ${x}` : ''}`);
}
console.log(`\n${resultados.length - falhas}/${resultados.length} passaram`);
process.exit(falhas ? 1 : 0);
