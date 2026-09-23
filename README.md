# Contorno

Verifica se a sua rota atravessa áreas que você prefere evitar e, se atravessar, mostra um caminho por fora — e abre esse caminho no Google Maps.

- Suas áreas ficam só no seu aparelho.
- Sem cadastro, sem anúncio, sem rastreamento.
- Funciona na Região Metropolitana do Rio de Janeiro.

## Instalar no Android

1. Abra o endereço do app no **Chrome**.
2. Toque em **⋮ → Instalar app** (ou "Adicionar à tela inicial").
3. Pronto: o Contorno aparece como app e também no menu **Compartilhar** do Google Maps.

## Desenvolvimento

Não tem build. Sirva a pasta e abra no navegador:

```
python3 -m http.server 8765
```

Testes:

```
node --test test/core.test.mjs     # núcleo, 36 testes
node test/fumaca.mjs               # ponta a ponta em Chromium (precisa de playwright-core)
```

Mapa: © OpenStreetMap, OpenFreeMap. Rotas: Valhalla (FOSSGIS). Busca: Photon (komoot).
