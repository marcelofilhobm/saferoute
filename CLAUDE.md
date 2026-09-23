# CLAUDE.md — Contorno

> Arquivo canônico do projeto. O Claude Code lê este arquivo sozinho em toda sessão. O mesmo texto pode ir no campo Instruções do Projeto no claude.ai.

## O que é

**Contorno** verifica se uma rota atravessa áreas que o usuário marcou para evitar e, se atravessa, mostra um caminho por fora e entrega esse caminho ao Google Maps.

Não é navegador, não é rede social, não é app de denúncia.

O diferencial inteiro: Google Maps e Waze só aceitam evitar pedágio, rodovia e balsa — nenhum aceita polígono. O Valhalla aceita (`exclude_polygons`).

## Stack (revisada em 23/09/2026 — ver `docs/decisoes.md` 014 a 017)

- **App web instalável (PWA)**: HTML + JavaScript puro, sem framework, sem build. Instalado pelo Chrome no Android vira WebAPK (ícone, tela cheia, menu Compartilhar).
- **Mapa**: MapLibre GL 4.7.1 (em `vendor/`) + estilo OpenFreeMap positron. Sem rede, cai num estilo liso e as camadas do app continuam aparecendo.
- **Rotas**: Valhalla público da FOSSGIS, `exclude_polygons`, sem chave. Isolado em `js/rede.js`.
- **Busca de endereço**: Photon (komoot), enviesado para a RMRJ.
- **Dados**: `localStorage`, só no aparelho (`js/guarda.js`).
- **Publicação**: GitHub Pages via `.github/workflows/publicar.yml` (testa, depois publica).

```
index.html  manifest.webmanifest  sw.js
css/app.css
js/core.js     ← núcleo: sem DOM, sem rede. Toda regra de decisão mora aqui.
js/rede.js     ← tudo que sai do aparelho
js/guarda.js   ← persistência local
js/app.js      ← interface
test/core.test.mjs   ← 23 testes (node --test), fixtures reais do Rio
test/fumaca.mjs      ← teste de ponta a ponta em Chromium com rede simulada
docs/          ← plano, custos, decisões
```

## Sobre o Marcelo

Oficial administrativo do CBMERJ, Rio de Janeiro. Programa por interesse pessoal. 6 a 10 horas por semana. Capital: R$ 0. **Responda sempre em português do Brasil.** Quer o mínimo de intervenção dele: faça, teste e só pergunte o que é decisão de produto ou exige conta/credencial dele.

Padrão de falha dele: perder convicção e abandonar. Escopo pequeno, coisas que funcionam cedo.

## Como trabalhar

- **Núcleo primeiro, com teste.** Toda regra nova entra em `js/core.js` com teste em `test/core.test.mjs`. `core.js` não toca em DOM nem em rede.
- **Rode os testes antes de dar algo por pronto:** `node --test test/core.test.mjs`. Para mudança de interface: sirva a pasta (`python3 -m http.server 8765`) e rode `node test/fumaca.mjs`.
- **Não expanda escopo.** Ideia nova vai para a tabela de backlog em `docs/plano-contorno.md` (seção 8.1).
- **Seja direto sobre o que não funciona.** Nada de concordar por educação.
- **Registre decisões** em `docs/decisoes.md` (três linhas: o quê, por quê, o que foi descartado).

## Limites — valide sempre

| Limite | Valor | Onde |
|---|---|---|
| Área por polígono | 200 km² | `validaPoligono` (bloqueia) |
| Extensão do polígono | 20 km | `validaPoligono` (bloqueia) |
| Perímetro somado por requisição (Valhalla) | ~10 km; usamos 9,5 km | `preFiltraAreas` |
| Distância da verificação | 150 km | `verifica` em `app.js` |
| Waypoints no link do Maps | 9 | `deeplinkMaps` |

Área que contém a origem ou o destino **nunca** é enviada como exclusão (o motor não teria como sair nem chegar).

A rota alternativa devolvida pelo motor é **sempre reconferida no aparelho** contra todas as áreas. Nunca prometa desvio sem conferir.

## Regras sobre áreas — valem para todo o projeto

O mesmo polígono significa coisas diferentes conforme o alcance.

- **Área própria (privada)** é livre: preferência, não afirmação. Sem fonte, sem data, sem justificativa. Nunca exigir.
- **Camada de contatos**: livre.
- **Camada pública seguida por estranhos**: autor identificável e categoria declarada.
- **Camada oficial**: data, fonte e expiração obrigatórias.

Duas regras a fazer valer mesmo se ele esquecer:

1. **Vocabulário.** Área do usuário é **"área que eu evito"**. A palavra *risco* só aparece na camada oficial. Existe teste para isso.
2. **Nunca agregar.** Não somar áreas privadas em mapa de calor, ranking ou estatística. Se for pedido, recuse e explique: vira lista de CEP negado.

## Privacidade e segurança

- Áreas ficam só no aparelho. Para calcular rota, saem origem, destino e o contorno das áreas do caminho — **sem rótulo**. Existe teste para isso.
- **Nenhuma telemetria.** Nenhum SDK de analytics ou crash reporting.
- **Toda entrada de fora é hostil**: GeoJSON importado passa por `importaGeoJson` (teto de tamanho, whitelist de campos, validação, sempre entra como privado); link colado passa por `parseUrlMaps` (nunca lança exceção).
- Todo texto de usuário ou de serviço externo que vai para HTML passa por `esc()` em `app.js`.
- Nenhum segredo no repositório. Hoje não existe chave nenhuma.

## Estado atual

- App completo e testado: verificar rota, desenhar área, veredito (limpa / alternativa / parcial / sem desvio), handoff Maps com waypoints e Waze com aviso, importar e compartilhar áreas, share target, funciona instalado.
- **Pendente de verificação no mundo real:** se o Valhalla público respeita `exclude_polygons` na geometria do Rio (portão da Fase 0). A primeira rota real com área no caminho responde isso — se o veredito vier "sem desvio" em toda rota que obviamente tem desvio, o motor está ignorando o polígono.
- **Pendências conhecidas:** link curto `maps.app.goo.gl` (precisa de Worker); Valhalla público não serve para escala; ícone e nome são provisórios.
