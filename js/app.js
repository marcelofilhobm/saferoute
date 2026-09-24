// Interface do Contorno. Toda a lógica de decisão mora em core.js;
// aqui só se desenha tela e se trata toque.

import * as C from './core.js';
import { calculaRota, buscaEndereco, MOTOR } from './rede.js';
import * as G from './guarda.js';

const maplibregl = window.maplibregl;

// ----------------------------------------------------------- constantes

const CENTRO_RIO = [-43.40, -22.93];
const ESTILO = 'https://tiles.openfreemap.org/styles/positron';
const ESTILO_OFFLINE = {
  version: 8, sources: {},
  layers: [{ id: 'fundo', type: 'background', paint: { 'background-color': '#e4e9e6' } }],
};
const COR = {
  privada: '#b06a00', oficial: '#b3261e', inativa: '#8a9994',
  base: '#5f6f6a', segura: '#0a6b5c', rascunho: '#0a6b5c',
};

// Exemplo: o link real que o Marcelo compartilhou.
const EXEMPLO = {
  origem: { ponto: [-22.9358454, -43.5704374], nome: 'Campo Grande (exemplo)' },
  destino: { ponto: [-22.9715354, -43.4013443], nome: 'Estação BRT Morro do Outeiro' },
  area: [[-23.0091, -43.5634], [-23.0091, -43.5554], [-23.0011, -43.5554], [-23.0011, -43.5634]],
};

// ----------------------------------------------------------- estado

const S = {
  modo: 'rota',          // rota | escolher | desenho | nomear | calculando | veredito | link
  origem: null,          // { ponto, nome }
  destino: null,
  textoOrigem: '',
  textoDestino: '',
  escolhendo: null,      // 'origem' | 'destino'
  rascunho: [],
  validacao: null,
  veredito: null,
  erro: null,
  mensagem: null,
  etapa: null,           // texto da tela "calculando"
};

G.carrega();

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const folha = $('#folha');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fmtKm = (v) => v.toFixed(1).replace('.', ',');
const fmtM = (m) => (m >= 1000 ? `${fmtKm(m / 1000)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`);
const areasAtivas = () => G.estado().areas.filter((a) => !a.inativa);

let timerToast;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => { t.hidden = true; }, 3200);
}

// ----------------------------------------------------------- ícones

const IC = {
  alvo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  pino: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  seta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>',
  lupa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  olho: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  olhoFechado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/></svg>',
  lixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
};

// ----------------------------------------------------------- mapa

const mapa = new maplibregl.Map({
  container: 'mapa',
  style: ESTILO,
  center: CENTRO_RIO,
  zoom: 10.3,
  attributionControl: { compact: true },
  dragRotate: false,
  pitchWithRotate: false,
});
mapa.touchZoomRotate.disableRotation();

let estiloCarregou = false;
const timerEstilo = setTimeout(() => {
  if (!estiloCarregou) mapa.setStyle(ESTILO_OFFLINE);
}, 8000);
mapa.on('error', (e) => {
  if (!estiloCarregou) { clearTimeout(timerEstilo); mapa.setStyle(ESTILO_OFFLINE); return; }
  // Depois que o estilo carregou, erro de tile é normal (sem rede); erro de
  // camada nossa não é — registra para não falhar em silêncio de novo.
  const msg = String(e?.error?.message || '');
  if (!/tile|fetch|Failed|NetworkError|AJAXError/i.test(msg)) console.error('[mapa]', msg);
});

const vazioFC = () => ({ type: 'FeatureCollection', features: [] });

function instalaCamadas() {
  estiloCarregou = true;
  clearTimeout(timerEstilo);
  if (mapa.getSource('areas')) return;

  mapa.addSource('areas', { type: 'geojson', data: vazioFC() });
  mapa.addSource('rotas', { type: 'geojson', data: vazioFC() });
  mapa.addSource('rascunho', { type: 'geojson', data: vazioFC() });

  mapa.addLayer({
    id: 'areas-fill', type: 'fill', source: 'areas',
    paint: { 'fill-color': ['get', 'cor'], 'fill-opacity': ['case', ['get', 'inativa'], 0.06, 0.2] },
  });
  mapa.addLayer({
    id: 'areas-linha', type: 'line', source: 'areas',
    paint: { 'line-color': ['get', 'cor'], 'line-width': 2, 'line-dasharray': [3, 2], 'line-opacity': ['case', ['get', 'inativa'], 0.4, 0.95] },
  });
  // line-dasharray não aceita expressão por dado no MapLibre 4: duas camadas.
  mapa.addLayer({
    id: 'rota-base', type: 'line', source: 'rotas',
    filter: ['all', ['==', ['get', 'tipo'], 'base'], ['!', ['get', 'sozinha']]],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': COR.base, 'line-width': 4, 'line-opacity': 0.7, 'line-dasharray': [2, 1.5] },
  });
  mapa.addLayer({
    id: 'rota-base-sozinha', type: 'line', source: 'rotas',
    filter: ['all', ['==', ['get', 'tipo'], 'base'], ['get', 'sozinha']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': COR.base, 'line-width': 5, 'line-opacity': 0.9 },
  });
  mapa.addLayer({
    id: 'rota-segura-borda', type: 'line', source: 'rotas', filter: ['==', ['get', 'tipo'], 'segura'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 8 },
  });
  mapa.addLayer({
    id: 'rota-segura', type: 'line', source: 'rotas', filter: ['==', ['get', 'tipo'], 'segura'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': COR.segura, 'line-width': 5 },
  });
  mapa.addLayer({
    id: 'rascunho-fill', type: 'fill', source: 'rascunho', filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': COR.rascunho, 'fill-opacity': 0.15 },
  });
  mapa.addLayer({
    id: 'rascunho-linha', type: 'line', source: 'rascunho', filter: ['!=', ['geometry-type'], 'Point'],
    paint: { 'line-color': COR.rascunho, 'line-width': 2.5 },
  });
  mapa.addLayer({
    id: 'rascunho-pontos', type: 'circle', source: 'rascunho', filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': COR.rascunho, 'circle-stroke-width': 3 },
  });

  atualizaAreasNoMapa();
  atualizaRotasNoMapa();
  atualizaRascunhoNoMapa();
}
mapa.on('style.load', instalaCamadas);

const lonlat = ([la, lo]) => [lo, la];

function atualizaAreasNoMapa() {
  const src = mapa.getSource('areas');
  if (!src) return;
  src.setData({
    type: 'FeatureCollection',
    features: G.estado().areas.map((a) => ({
      type: 'Feature',
      properties: { id: a.id, inativa: !!a.inativa, cor: a.inativa ? COR.inativa : (a.escopo === 'oficial' ? COR.oficial : COR.privada) },
      geometry: { type: 'Polygon', coordinates: [[...a.geometria, a.geometria[0]].map(lonlat)] },
    })),
  });
  $('#contador-areas').textContent = String(G.estado().areas.length);
}

function atualizaRotasNoMapa() {
  const src = mapa.getSource('rotas');
  if (!src) return;
  const v = S.veredito;
  const feats = [];
  if (v?.base && S.modo === 'veredito') {
    feats.push({ type: 'Feature', properties: { tipo: 'base', sozinha: !v.segura }, geometry: { type: 'LineString', coordinates: v.base.pontos.map(lonlat) } });
    if (v.segura) feats.push({ type: 'Feature', properties: { tipo: 'segura' }, geometry: { type: 'LineString', coordinates: v.segura.pontos.map(lonlat) } });
  }
  src.setData({ type: 'FeatureCollection', features: feats });
  atualizaParadasNoMapa();
}

// Paradas com as mesmas letras que o Maps mostra (A, B, C...), para comparar.
const letraParada = (i) => String.fromCharCode(65 + i);
let marcasParadas = [];
function atualizaParadasNoMapa() {
  marcasParadas.forEach((m) => m.remove());
  marcasParadas = [];
  const v = S.veredito;
  if (S.modo !== 'veredito' || !v?.segura) return;
  (v.waypoints || []).forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'parada';
    el.textContent = letraParada(i);
    el.setAttribute('aria-label', `Parada ${letraParada(i)}`);
    marcasParadas.push(new maplibregl.Marker({ element: el }).setLngLat(lonlat(p)).addTo(mapa));
  });
}

function atualizaRascunhoNoMapa() {
  const src = mapa.getSource('rascunho');
  if (!src) return;
  const r = S.rascunho;
  const feats = r.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: lonlat(p) } }));
  if (r.length >= 3) feats.unshift({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...r, r[0]].map(lonlat)] } });
  else if (r.length === 2) feats.unshift({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.map(lonlat) } });
  src.setData({ type: 'FeatureCollection', features: feats });
}

const pinos = { origem: null, destino: null };
function atualizaPinos() {
  for (const k of ['origem', 'destino']) {
    const alvo = S[k];
    if (!alvo) { pinos[k]?.remove(); pinos[k] = null; continue; }
    if (!pinos[k]) {
      const el = document.createElement('div');
      el.className = `pino ${k === 'origem' ? 'o' : 'd'}`;
      el.setAttribute('aria-label', k === 'origem' ? 'Origem' : 'Destino');
      pinos[k] = new maplibregl.Marker({ element: el }).setLngLat(lonlat(alvo.ponto)).addTo(mapa);
    } else {
      pinos[k].setLngLat(lonlat(alvo.ponto));
    }
  }
}

function enquadra(pontos) {
  if (!pontos.length) return;
  const b = new maplibregl.LngLatBounds();
  pontos.forEach((p) => b.extend(lonlat(p)));
  const alturaFolha = folha.getBoundingClientRect().height;
  const largo = window.innerWidth >= 720;
  mapa.fitBounds(b, {
    padding: largo
      ? { top: 60, bottom: 60, left: 420, right: 60 }
      : { top: 60, right: 40, left: 40, bottom: Math.min(alturaFolha + 30, window.innerHeight * 0.6) },
    maxZoom: 15, duration: 600,
  });
}

function ajustaControlesMapa() {
  const largo = window.innerWidth >= 720;
  document.documentElement.style.setProperty('--folha-h', largo ? '0px' : `${folha.getBoundingClientRect().height}px`);
}

mapa.on('click', (e) => {
  const p = [e.lngLat.lat, e.lngLat.lng];
  if (S.modo === 'desenho') {
    S.rascunho.push(p);
    atualizaRascunhoNoMapa();
    render();
  } else if (S.modo === 'escolher' && S.escolhendo) {
    S[S.escolhendo] = { ponto: p, nome: `Ponto no mapa (${p[0].toFixed(4)}, ${p[1].toFixed(4)})` };
    S[S.escolhendo === 'origem' ? 'textoOrigem' : 'textoDestino'] = S[S.escolhendo].nome;
    S.escolhendo = null;
    S.modo = 'rota';
    atualizaPinos();
    render();
  }
});

// ----------------------------------------------------------- telas

function render() {
  const telas = { rota: telaRota, escolher: telaEscolher, desenho: telaDesenho, nomear: telaNomear, calculando: telaCalculando, veredito: telaVeredito, link: telaLink };
  (telas[S.modo] || telaRota)();
  $('#nova-area').hidden = S.modo === 'desenho' || S.modo === 'nomear' || S.modo === 'calculando';
  mapa.getCanvas().style.cursor = (S.modo === 'desenho' || S.modo === 'escolher') ? 'crosshair' : '';
  requestAnimationFrame(ajustaControlesMapa);
}

function telaRota() {
  const nAreas = G.estado().areas.length;
  const pronto = S.origem && S.destino;
  folha.innerHTML = `
    ${S.erro ? `<div class="nota erro" style="margin-bottom:12px"><span class="sig">!</span><span>${esc(S.erro)}</span></div>` : ''}
    ${S.mensagem ? `<div class="nota aviso" style="margin-bottom:12px"><span class="sig">i</span><span>${esc(S.mensagem)}</span></div>` : ''}
    <p class="rotulo-sec">Verificar uma rota</p>
    <div class="pilha">
      ${campoRota('origem', 'Saindo de', S.textoOrigem, true)}
      ${campoRota('destino', 'Indo para', S.textoDestino, false)}
      <button class="btn btn-pri" id="verificar" type="button" ${pronto ? '' : 'disabled'}>${IC.lupa}Verificar rota</button>
      <button class="link-texto" id="abrir-link" type="button">Tenho um link de rota do Google Maps</button>
    </div>
    ${nAreas === 0 ? `
      <div class="vazio" style="margin-top:14px">
        <div class="nota"><span class="sig">i</span><span>Você ainda não marcou nenhuma área. Toque em <b>+ Área</b> e marque no mapa um trecho que você prefere não atravessar.</span></div>
        ${!G.estado().exemploCarregado ? `<button class="btn btn-sec" id="carregar-exemplo" type="button" style="margin-top:8px">Ver um exemplo na Zona Oeste</button>` : ''}
      </div>` : ''}
  `;
  ligaCampo('origem');
  ligaCampo('destino');
  $('#verificar').onclick = verifica;
  $('#abrir-link').onclick = () => { S.modo = 'link'; S.erro = null; S.mensagem = null; render(); };
  const ex = $('#carregar-exemplo');
  if (ex) ex.onclick = carregaExemplo;
}

function campoRota(k, rotulo, valor, comLocalizacao) {
  return `
    <div class="campo-rota" id="campo-${k}">
      <label for="in-${k}"><span class="marcador-campo ${k === 'origem' ? 'o' : 'd'}"></span>${rotulo}</label>
      <div class="linha-campo">
        <input id="in-${k}" type="text" autocomplete="off" enterkeyhint="search" placeholder="Endereço ou lugar" value="${esc(valor)}">
        ${comLocalizacao ? `<button class="btn-icone" id="loc-${k}" type="button" aria-label="Usar minha localização" title="Minha localização">${IC.alvo}</button>` : ''}
        <button class="btn-icone" id="mapa-${k}" type="button" aria-label="Escolher no mapa" title="Escolher no mapa">${IC.pino}</button>
      </div>
      <ul class="sugestoes" id="sug-${k}" hidden></ul>
    </div>`;
}

let timerBusca;
function ligaCampo(k) {
  const input = $(`#in-${k}`);
  const lista = $(`#sug-${k}`);
  const chaveTexto = k === 'origem' ? 'textoOrigem' : 'textoDestino';

  input.addEventListener('input', () => {
    S[chaveTexto] = input.value;
    S[k] = null;
    atualizaPinos();
    $('#verificar').disabled = true;
    clearTimeout(timerBusca);
    const q = input.value;
    if (q.trim().length < 3) { lista.hidden = true; return; }
    timerBusca = setTimeout(async () => {
      let res = [];
      try { res = await buscaEndereco(q); } catch { /* sem rede */ }
      if (input.value !== q) return;
      if (!res.length) {
        lista.innerHTML = '<li><span class="s2" style="display:block;padding:8px 9px">Nada encontrado. Tente outro nome ou escolha no mapa.</span></li>';
      } else {
        lista.innerHTML = res.map((r, i) =>
          `<li><button type="button" data-i="${i}"><span class="s1">${esc(r.nome)}</span>${r.detalhe ? `<span class="s2">${esc(r.detalhe)}</span>` : ''}</button></li>`).join('');
        lista.querySelectorAll('button').forEach((b) => {
          b.onclick = () => {
            const r = res[+b.dataset.i];
            S[k] = { ponto: r.ponto, nome: r.nome };
            S[chaveTexto] = r.nome;
            S.erro = null;
            atualizaPinos();
            render();
            if (S.origem && S.destino) enquadra([S.origem.ponto, S.destino.ponto]);
            else mapa.flyTo({ center: lonlat(r.ponto), zoom: 14 });
          };
        });
      }
      lista.hidden = false;
    }, 350);
  });

  $(`#mapa-${k}`).onclick = () => {
    S.modo = 'escolher';
    S.escolhendo = k;
    render();
  };

  const loc = $(`#loc-${k}`);
  if (loc) {
    loc.onclick = () => {
      if (!navigator.geolocation) { toast('Este aparelho não informa a localização.'); return; }
      loc.setAttribute('aria-pressed', 'true');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const p = [pos.coords.latitude, pos.coords.longitude];
          S[k] = { ponto: p, nome: 'Minha localização' };
          S[chaveTexto] = 'Minha localização';
          atualizaPinos();
          render();
          mapa.flyTo({ center: lonlat(p), zoom: 14 });
        },
        () => { loc.setAttribute('aria-pressed', 'false'); toast('Não foi possível pegar sua localização. Digite o endereço ou escolha no mapa.'); },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
      );
    };
  }
}

function telaEscolher() {
  const qual = S.escolhendo === 'origem' ? 'de onde você sai' : 'para onde você vai';
  folha.innerHTML = `
    <p class="rotulo-sec">Escolher no mapa</p>
    <h2 class="titulo">Toque no mapa ${esc(qual)}</h2>
    <button class="btn btn-sec" id="cancelar" type="button">Voltar</button>`;
  $('#cancelar').onclick = () => { S.modo = 'rota'; S.escolhendo = null; render(); };
}

function telaDesenho() {
  const n = S.rascunho.length;
  folha.innerHTML = `
    <p class="rotulo-sec">Nova área que você evita</p>
    <h2 class="titulo">Toque no mapa para marcar os cantos</h2>
    <p class="contagem-desenho">${n} ${n === 1 ? 'ponto' : 'pontos'} · ${n < 3 ? `faltam ${3 - n} para fechar` : 'pode concluir quando quiser'}</p>
    <div class="trio">
      <button class="btn btn-sec" id="desfazer" type="button" ${n ? '' : 'disabled'}>Desfazer</button>
      <button class="btn btn-sec" id="cancelar" type="button">Cancelar</button>
      <button class="btn btn-pri" id="concluir" type="button" ${n >= 3 ? '' : 'disabled'}>Concluir</button>
    </div>`;
  $('#desfazer').onclick = () => { S.rascunho.pop(); atualizaRascunhoNoMapa(); render(); };
  $('#cancelar').onclick = () => { S.rascunho = []; atualizaRascunhoNoMapa(); S.modo = 'rota'; render(); };
  $('#concluir').onclick = () => {
    S.validacao = C.validaPoligono(S.rascunho);
    S.modo = 'nomear';
    render();
  };
}

function telaNomear() {
  const v = S.validacao;
  const bloqueado = v.erros.length > 0;
  const km2 = C.areaKm2(S.rascunho);
  folha.innerHTML = `
    <p class="rotulo-sec">Nova área que você evita</p>
    ${bloqueado
      ? `<h2 class="titulo">Essa área não pode ser salva</h2>
         <div class="pilha" style="margin-bottom:12px">${v.erros.map((e) => `<div class="nota erro"><span class="sig">!</span><span>${esc(e)}</span></div>`).join('')}</div>`
      : `<h2 class="titulo">Dê um nome, se quiser</h2>
         <p class="sub">${fmtKm(km2 < 0.1 ? km2 * 100 : km2)} ${km2 < 0.1 ? 'hectares' : 'km²'}. O nome é só para você — fica neste aparelho.</p>
         <div class="campo-simples">
           <label for="rotulo-area">Nome (opcional)</label>
           <input id="rotulo-area" type="text" maxlength="60" placeholder="Área que eu evito" autocomplete="off">
         </div>
         ${v.avisos.map((a) => `<div class="nota aviso" style="margin-bottom:12px"><span class="sig">i</span><span>${esc(a)}</span></div>`).join('')}`}
    <div class="duas">
      <button class="btn btn-sec" id="voltar-desenho" type="button">Ajustar pontos</button>
      ${bloqueado
        ? '<button class="btn btn-sec" id="descartar" type="button">Descartar</button>'
        : '<button class="btn btn-pri" id="salvar-area" type="button">Salvar área</button>'}
    </div>`;
  $('#voltar-desenho').onclick = () => { S.modo = 'desenho'; render(); };
  const d = $('#descartar');
  if (d) d.onclick = () => { S.rascunho = []; atualizaRascunhoNoMapa(); S.modo = 'rota'; render(); };
  const s = $('#salvar-area');
  if (s) {
    s.onclick = () => {
      const rotulo = $('#rotulo-area').value.trim();
      G.adicionaArea({
        id: `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        geometria: S.rascunho.slice(),
        escopo: 'privada',
        rotulo: rotulo || null,
        severidade: 1,
        criadaEm: new Date().toISOString(),
      });
      S.rascunho = [];
      atualizaRascunhoNoMapa();
      atualizaAreasNoMapa();
      S.modo = 'rota';
      render();
      toast('Área salva neste aparelho.');
    };
  }
}

function telaCalculando() {
  folha.innerHTML = `
    <p class="rotulo-sec">Verificando</p>
    <div class="carregando"><span class="giro" aria-hidden="true"></span>
      <div><div style="font-weight:600">${esc(S.etapa || 'Calculando a rota e o desvio')}</div>
      <div style="font-size:13px;color:var(--ink-3)">Conferindo contra ${areasAtivas().length} ${areasAtivas().length === 1 ? 'área' : 'áreas'} suas</div></div>
    </div>`;
}

function linhaAtingida(at) {
  const oficial = at.area.escopo === 'oficial';
  return `<div class="atingida ${oficial ? 'oficial' : ''}">
    <div class="corpo"><div class="n">${esc(C.nomeExibicao(at.area))}</div>
    <div class="m">${oficial ? esc(at.area.fonte || 'Camada oficial') : 'Minha camada'}</div></div>
    <div class="d">${fmtM(at.metrosDentro)}</div></div>`;
}

// Por que não houve desvio, com o motivo de verdade (core.MOTIVO).
function motivoSemDesvio(v, destinoNome) {
  const tipo = v.erroSeg?.tipo;
  if (tipo === 'rede' || tipo === 'servidor') {
    return `A rota direta cruza suas áreas, mas não consegui calcular o desvio agora (${esc(v.erroSeg.message)}). Tente de novo em instantes.`;
  }
  if (tipo === 'limite') {
    return 'As áreas do caminho são grandes demais para o serviço de rotas calcular o desvio. Áreas menores funcionam melhor.';
  }
  switch (v.motivo?.tipo) {
    case C.MOTIVO.GRANDE: {
      const a = v.motivo.areas[0];
      const km = fmtKm(C.perimetroM(a.geometria) / 1000);
      return `<b>${esc(C.nomeExibicao(a))}</b> é grande demais para o serviço de rotas gratuito desviar sozinho ` +
        `(contorno de ${km} km; ele aceita até ${fmtKm(C.LIMITES.orcamentoPerimetroM / 1000)} km somando as áreas). ` +
        'Tentei dar a volta por fora com pontos de passagem e não achei caminho que ficasse fora. ' +
        'Marcar só o trecho que você evita, em áreas menores, funciona melhor.';
    }
    case C.MOTIVO.PONTA:
      return 'Sua origem ou seu destino fica dentro de uma área que você evita — não tem como sair ou chegar sem passar por ela.';
    case C.MOTIVO.MOTOR_CRUZOU:
      return 'O serviço de rotas só devolveu caminho que ainda passa por dentro. Pode não existir rua por fora, ou o serviço não respeitou a área.';
    default:
      return `O serviço de rotas não achou caminho até ${esc(destinoNome)} que fique fora dessas áreas.`;
  }
}

// O que o app conseguiu conferir sobre o caminho que o Maps vai fazer.
function notaConferencia(v) {
  const c = v.conferencia;
  if (!c) return '';
  const k = v.waypoints.length;
  const paradas = k === 0 ? '' : k === 1 ? 'pela parada A' : `pelas ${k} paradas (A a ${letraParada(k - 1)})`;
  const nota = (tipo, sig, texto) => `<div class="nota ${tipo}" style="margin-bottom:12px"><span class="sig">${sig}</span><span>${texto}</span></div>`;
  if (c.conferencia === C.CONFERENCIA.CONFERIDA) {
    return nota('', '✓', k
      ? `Conferido: passando ${paradas}, o caminho mais curto fica fora das suas áreas. O Maps usa o trânsito e pode variar um pouco entre as paradas.`
      : 'Conferido: o caminho do Maps fica fora das áreas que esta alternativa evita.');
  }
  if (c.conferencia === C.CONFERENCIA.NAO_GARANTIDA) {
    const nomes = [...new Set((c.entradas || []).map((e) => C.nomeExibicao(e.area)))];
    const onde = `<b>${esc(nomes.join(', ') || 'uma área sua')}</b>`;
    return nota('aviso', '!', k
      ? `Mesmo passando ${paradas}, o caminho mais curto entre elas ainda pode passar por ${onde}. No Maps, confira esse trecho e siga o traçado do app.`
      : `Não achei como indicar este desvio ao Maps: sem paradas, ele faria a rota direta, que passa por ${onde}. Siga o traçado do app nesse trecho.`);
  }
  return nota('aviso', 'i', 'Não consegui conferir agora o caminho que o Maps vai fazer. No Maps, confira o trecho perto das suas áreas.');
}

function telaVeredito() {
  const v = S.veredito;
  const destinoNome = S.destino?.nome || 'o destino';
  const noOrigemOuDestino = areasAtivas().some((a) =>
    C.pontoEmPoligono(S.origem.ponto, a.geometria) || C.pontoEmPoligono(S.destino.ponto, a.geometria));
  const avisoPonta = noOrigemOuDestino
    ? '<div class="nota aviso" style="margin-bottom:12px"><span class="sig">i</span><span>Sua origem ou seu destino fica dentro de uma área que você evita — esse trecho não tem como ser contornado.</span></div>'
    : '';
  // Todo link para o Maps vai preso ao trajeto que o app conferiu (decisão 020).
  const mapsBase = C.deeplinkMaps(S.origem.ponto, S.destino.ponto, C.pontosDaRota(v.base.pontos));
  const botaoNova = '<button class="btn btn-sec" id="nova" type="button">Nova verificação</button>';

  let html = '';
  if (v.estado === C.ESTADO.LIMPA) {
    html = `
      <span class="selo ok">livre</span>
      <h2 class="titulo">Nada no caminho</h2>
      <p class="sub">A rota até ${esc(destinoNome)} não cruza nenhuma das suas ${areasAtivas().length} áreas.</p>
      <dl class="custo">
        <div><dt>Distância</dt><dd>${fmtKm(v.base.km)}<small>km</small></dd></div>
        <div><dt>Tempo</dt><dd>${v.base.min}<small>min</small></dd></div>
      </dl>
      <div class="pilha">
        <a class="btn btn-pri" href="${esc(mapsBase)}" target="_blank" rel="noopener">${IC.seta}Abrir no Google Maps</a>
        ${botaoNova}
      </div>`;
  } else if (v.estado === C.ESTADO.COM_ALTERNATIVA || v.estado === C.ESTADO.PARCIAL) {
    const parcial = v.estado === C.ESTADO.PARCIAL;
    const dMin = v.segura.min - v.base.min;
    const dKm = v.segura.km - v.base.km;
    const mapsDesvio = C.deeplinkMaps(S.origem.ponto, S.destino.ponto, v.waypoints);
    const n = v.atingimentos.length;
    const notaMaps = notaConferencia(v);
    html = `
      <span class="selo alerta">${n} ${n === 1 ? 'área' : 'áreas'} no caminho</span>
      <h2 class="titulo">${parcial ? 'Dá para desviar de parte' : 'Dá para desviar'}</h2>
      <p class="sub">${parcial
        ? 'A alternativa evita a maior parte, mas ainda passa por dentro de alguma área.'
        : `A rota direta atravessa ${n === 1 ? 'uma área sua' : `${n} áreas suas`}. Existe caminho por fora.`}</p>
      ${avisoPonta}
      <dl class="custo">
        <div><dt>A mais</dt><dd>${dMin >= 0 ? '+' : ''}${dMin}<small>min</small></dd></div>
        <div><dt>A mais</dt><dd>${dKm >= 0 ? '+' : ''}${fmtKm(dKm)}<small>km</small></dd></div>
        <div><dt>Total</dt><dd>${v.segura.min}<small>min</small></dd></div>
      </dl>
      <p class="rotulo-sec">Rota direta atravessa</p>
      <div class="atingidas">${v.atingimentos.map(linhaAtingida).join('')}</div>
      ${parcial ? `<p class="rotulo-sec">A alternativa ainda passa por</p><div class="atingidas">${v.restantes.map(linhaAtingida).join('')}</div>` : ''}
      ${notaMaps}
      <div class="pilha">
        <a class="btn btn-pri" href="${esc(mapsDesvio)}" target="_blank" rel="noopener">${IC.seta}Navegar por fora no Google Maps</a>
        ${botaoNova}
      </div>`;
  } else {
    const m = v.atingimentos.reduce((s, a) => s + a.metrosDentro, 0);
    const tipo = v.erroSeg?.tipo;
    const falhaRede = tipo === 'rede' || tipo === 'servidor';
    const naPonta = v.motivo?.tipo === C.MOTIVO.PONTA;
    html = `
      <span class="selo grave">${falhaRede ? 'desvio indisponível' : 'sem desvio'}</span>
      <h2 class="titulo">${falhaRede ? 'Sua rota cruza áreas suas' : naPonta ? 'Não há como contornar' : 'Não achei caminho por fora'}</h2>
      <p class="sub">${motivoSemDesvio(v, destinoNome)}</p>
      ${naPonta ? '' : avisoPonta}
      <dl class="custo">
        <div><dt>Dentro de áreas</dt><dd>${fmtM(m)}</dd></div>
        <div><dt>Trajeto</dt><dd>${fmtKm(v.base.km)}<small>km</small></dd></div>
      </dl>
      <div class="atingidas">${v.atingimentos.map(linhaAtingida).join('')}</div>
      <div class="pilha">
        <a class="btn btn-sec" href="${esc(mapsBase)}" target="_blank" rel="noopener">${IC.seta}Seguir assim mesmo no Maps</a>
        ${botaoNova}
      </div>`;
  }
  folha.innerHTML = html;
  $('#nova').onclick = () => { S.modo = 'rota'; S.veredito = null; atualizaRotasNoMapa(); render(); };
}

function telaLink() {
  folha.innerHTML = `
    <p class="rotulo-sec">Link do Google Maps</p>
    <h2 class="titulo">Cole o link da rota</h2>
    <p class="sub">No Google Maps, monte a rota, toque em Compartilhar e copie o link. Depois cole aqui.</p>
    <div class="campo-simples">
      <label for="in-link">Link</label>
      <input id="in-link" type="url" inputmode="url" placeholder="https://www.google.com/maps/dir/..." autocomplete="off">
    </div>
    <div class="duas">
      <button class="btn btn-sec" id="voltar" type="button">Voltar</button>
      <button class="btn btn-pri" id="ler-link" type="button">${IC.link}Ler link</button>
    </div>`;
  $('#voltar').onclick = () => { S.modo = 'rota'; render(); };
  $('#ler-link').onclick = () => processaTextoCompartilhado($('#in-link').value);
  $('#in-link').focus();
}

// ----------------------------------------------------------- ações

async function verifica() {
  if (!S.origem || !S.destino) return;
  const o = S.origem.ponto;
  const d = S.destino.ponto;
  const distRetaKm = C.haversineM(o, d) / 1000;
  if (distRetaKm > C.LIMITES.maxDistanciaKm) {
    S.erro = `Distância grande demais (${fmtKm(distRetaKm)} km em linha reta). O app verifica rotas de até ${C.LIMITES.maxDistanciaKm} km.`;
    render();
    return;
  }
  if (distRetaKm < 0.05) {
    S.erro = 'Origem e destino estão no mesmo lugar.';
    render();
    return;
  }

  const areas = areasAtivas();
  S.erro = null;
  S.mensagem = null;
  S.modo = 'calculando';
  render();

  try {
    const base = await calculaRota(o, d);
    const atingBase = C.atingimentosDaRota(base.pontos, areas);
    let segura = null;
    let deixadasDeFora = [];
    let erroSeg = null;

    if (atingBase.length) {
      const pf = C.preFiltraAreas(o, d, areas, { atingidasIds: atingBase.map((a) => a.area.id) });
      deixadasDeFora = pf.deixadasDeFora;
      if (pf.enviadas.length) {
        try {
          segura = await calculaRota(o, d, pf.enviadas);
        } catch (e) {
          // A rota direta já está em mãos: qualquer falha no desvio vira
          // "sem alternativa" com o motivo, em vez de perder o resultado.
          erroSeg = e;
        }
      }
      // Área grande demais para ir como exclusão: tenta dar a volta nela
      // por pontos de passagem (decisão 019).
      const grandes = pf.deixadasDeFora.filter((a) => C.rotaAtinge((segura || base).pontos, a));
      if (grandes.length && !erroSeg) {
        S.etapa = 'Procurando caminho em volta das áreas grandes';
        render();
        const r = await C.contornaAreasGrandes({
          rota: segura || base, grandes,
          calcula: (vias) => calculaRota(o, d, pf.enviadas, vias, 'through'),
        });
        if (r?.rota) segura = r.rota;
        // Falha de rede/servidor não é "não achei caminho": o veredito diz que não conseguiu.
        else if (r?.erro && (r.erro.tipo === 'rede' || r.erro.tipo === 'servidor')) erroSeg = r.erro;
      }
    }

    S.veredito = C.montaVeredito({ origem: o, destino: d, base, segura, areas, deixadasDeFora });
    S.veredito.erroSeg = erroSeg;
    if (S.veredito.estado === C.ESTADO.COM_ALTERNATIVA || S.veredito.estado === C.ESTADO.PARCIAL) {
      // O Maps só recebe paradas: confere o caminho que ele tende a fazer por elas.
      S.etapa = 'Conferindo o caminho que o Maps vai fazer';
      render();
      try {
        const r = await C.refinaParadas({
          segura, base, areas,
          simula: (paradas) => calculaRota(o, d, [], paradas),
        });
        S.veredito.waypoints = r.paradas;
        S.veredito.conferencia = r;
      } catch {
        S.veredito.conferencia = { paradas: S.veredito.waypoints, conferencia: C.CONFERENCIA.NAO_CONFERIDA, entradas: [] };
      }
    }
    S.etapa = null;
    S.modo = 'veredito';
    G.guardaUltimaRota({ origem: S.origem, destino: S.destino });
    render();
    atualizaRotasNoMapa();
    enquadra([...base.pontos, ...(segura?.pontos || [])]);
  } catch (e) {
    S.etapa = null;
    S.erro = e.message || 'Algo deu errado ao calcular a rota.';
    S.modo = 'rota';
    render();
  }
}

function processaTextoCompartilhado(texto) {
  const url = (String(texto || '').match(/https?:\/\/\S+/) || [])[0];
  S.erro = null;
  S.mensagem = null;
  if (!url) {
    S.modo = 'rota';
    S.mensagem = 'Não encontrei um link nesse texto. Escolha a origem e o destino aqui.';
    render();
    return;
  }
  const r = C.parseUrlMaps(url);
  if (r.curto) {
    S.modo = 'rota';
    S.mensagem = 'Esse é um link curto do Google (maps.app.goo.gl), que o app ainda não consegue abrir sozinho — isso chega na próxima versão. Por enquanto, escolha a origem e o destino aqui.';
    render();
    return;
  }
  if (r.destino) {
    S.destino = { ponto: r.destino, nome: r.destinoNome || 'Destino do link' };
    S.textoDestino = S.destino.nome;
  }
  if (r.origem && r.destino) {
    S.origem = { ponto: r.origem, nome: 'Origem do link' };
    S.textoOrigem = S.origem.nome;
  }
  atualizaPinos();
  if (S.origem && S.destino) {
    S.modo = 'rota';
    verifica();
  } else {
    S.modo = 'rota';
    S.mensagem = r.destino
      ? 'Li o destino. Escolha de onde você sai.'
      : 'Não consegui ler esse link. Escolha a origem e o destino aqui.';
    render();
  }
}

function carregaExemplo() {
  G.adicionaArea({
    id: 'exemplo-zona-oeste',
    geometria: EXEMPLO.area,
    escopo: 'privada',
    rotulo: 'Exemplo — pode apagar',
    severidade: 1,
    criadaEm: new Date().toISOString(),
  });
  G.marcaExemplo();
  atualizaAreasNoMapa();
  S.origem = { ...EXEMPLO.origem };
  S.destino = { ...EXEMPLO.destino };
  S.textoOrigem = S.origem.nome;
  S.textoDestino = S.destino.nome;
  atualizaPinos();
  verifica();
}

// ----------------------------------------------------------- painel de áreas

function renderPainel() {
  const areas = G.estado().areas;
  const lista = $('#lista-areas');
  if (!areas.length) {
    lista.innerHTML = '<div class="nota"><span class="sig">i</span><span>Nenhuma área ainda. Feche este painel e toque em <b>+ Área</b>, ou importe um arquivo que alguém te mandou.</span></div>';
  } else {
    lista.innerHTML = areas.map((a) => {
      const km2 = C.areaKm2(a.geometria);
      return `<div class="item-area ${a.inativa ? 'inativa' : ''}" data-id="${esc(a.id)}">
        <div class="n">${esc(C.nomeExibicao(a))}</div>
        <div class="m">${a.inativa ? 'desligada · ' : ''}${km2 < 0.1 ? `${fmtKm(km2 * 100)} ha` : `${fmtKm(km2)} km²`}</div>
        <div class="acoes">
          <button type="button" data-acao="ver" aria-label="Mostrar no mapa" title="Mostrar no mapa">${IC.pino}</button>
          <button type="button" data-acao="alternar" aria-label="${a.inativa ? 'Ligar' : 'Desligar'}" title="${a.inativa ? 'Ligar' : 'Desligar'}">${a.inativa ? IC.olhoFechado : IC.olho}</button>
          <button type="button" data-acao="apagar" aria-label="Apagar" title="Apagar">${IC.lixo}</button>
        </div>
      </div>`;
    }).join('');
  }
  lista.querySelectorAll('.item-area').forEach((el) => {
    const id = el.dataset.id;
    el.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        const acao = b.dataset.acao;
        if (acao === 'ver') {
          const a = G.estado().areas.find((x) => x.id === id);
          $('#painel-areas').hidden = true;
          if (a) enquadra(a.geometria);
        } else if (acao === 'alternar') {
          G.alternaArea(id);
          atualizaAreasNoMapa();
          renderPainel();
        } else if (acao === 'apagar') {
          if (b.dataset.confirma === '1') {
            G.removeArea(id);
            atualizaAreasNoMapa();
            renderPainel();
            render();
            toast('Área apagada.');
          } else {
            b.dataset.confirma = '1';
            b.style.background = 'var(--danger)';
            b.style.color = '#fff';
            b.setAttribute('aria-label', 'Toque de novo para apagar');
            b.title = 'Toque de novo para apagar';
            setTimeout(() => { if (b.isConnected) renderPainel(); }, 3000);
          }
        }
      };
    });
  });
}

$('#abrir-areas').onclick = () => { renderPainel(); $('#painel-areas').hidden = false; $('#fechar-areas').focus(); };
$('#fechar-areas').onclick = () => { $('#painel-areas').hidden = true; };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#painel-areas').hidden = true; });

$('#arquivo-importar').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > 2 * 1024 * 1024) { toast('Arquivo grande demais (máximo 2 MB).'); return; }
  const texto = await f.text();
  const { areas, erros } = C.importaGeoJson(texto);
  areas.forEach((a) => G.adicionaArea(a));
  atualizaAreasNoMapa();
  renderPainel();
  render();
  if (areas.length) toast(`${areas.length} ${areas.length === 1 ? 'área importada' : 'áreas importadas'}.${erros.length ? ` ${erros.length} ignorada(s).` : ''}`);
  else toast(erros[0] || 'Nenhuma área encontrada no arquivo.');
});

$('#exportar-areas').onclick = async () => {
  const areas = G.estado().areas;
  if (!areas.length) { toast('Não há áreas para compartilhar.'); return; }
  const json = C.exportaGeoJson(areas);
  const arquivo = new File([json], 'areas-contorno.geojson', { type: 'application/geo+json' });
  try {
    if (navigator.canShare?.({ files: [arquivo] })) {
      await navigator.share({ files: [arquivo], title: 'Áreas que eu evito', text: 'Abra no app Contorno.' });
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(arquivo);
  a.download = arquivo.name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Arquivo salvo. Envie pelo WhatsApp para quem quiser.');
};

$('#nova-area').onclick = () => {
  S.rascunho = [];
  S.modo = 'desenho';
  S.veredito = null;
  atualizaRotasNoMapa();
  render();
};

// ----------------------------------------------------------- partida

(function partida() {
  const params = new URLSearchParams(location.search);
  const compartilhado = [params.get('url'), params.get('text'), params.get('title')].filter(Boolean).join(' ');

  const ult = G.estado().ultimaRota;
  if (ult?.origem && ult?.destino) {
    S.origem = ult.origem; S.destino = ult.destino;
    S.textoOrigem = ult.origem.nome; S.textoDestino = ult.destino.nome;
  }
  atualizaPinos();
  render();

  const areas = G.estado().areas;
  mapa.once('load', () => {
    if (areas.length) enquadra(areas.flatMap((a) => a.geometria));
  });

  if (compartilhado) {
    history.replaceState(null, '', location.pathname);
    processaTextoCompartilhado(compartilhado);
  }
  window.addEventListener('resize', ajustaControlesMapa);
  // Exposto só para diagnóstico no console; não é API.
  window.__contorno = { S, C, MOTOR, mapa };
})();
