# Decisões — Projeto Contorno

> Uma entrada por decisão, três linhas: **o quê**, **por quê**, **o que foi descartado**.
> Acrescente ao fim de cada sessão de trabalho. Nunca reescreva entradas antigas — se mudar de ideia, crie uma entrada nova revogando a anterior.

---

### 001 — Verificação pré-viagem, não alerta ao vivo
Modo de operação é checar a rota antes de sair, não monitorar posição durante o trajeto.
Zero permissão de background, zero consumo de bateria, MVP de uma tela só.
Descartado: geofencing ao vivo (iOS limita a 20 regiões monitoradas por app; bateria).

### 002 — OpenRouteService como motor de rota
Único serviço gratuito com exclusão de polígono documentada (`avoid_polygons`).
Google e Waze só aceitam evitar pedágio, rodovia, balsa e trecho interno — nenhum aceita polígono, e é exatamente por isso que o app tem razão de existir.
Descartado: Valhalla self-hosted (servidor = custo recorrente + manutenção).

### 003 — Navegação por handoff, não turn-by-turn próprio
O app entrega a rota ao Google Maps via deeplink e sai de cena.
Construir navegação é projeto de meses competindo com o Waze; o Mapbox Navigation SDK cobra por MAU.
Descartado: navegação embarcada; Waze como destino principal (só aceita destino, ignoraria o desvio).

### 004 — Entrada por Share Intent
O usuário compartilha a rota do Google Maps para o app, em vez de digitar origem e destino.
O link curto expande e expõe origem, destino, paradas e modal no path e no blob `data` (`!3d`/`!4d`). Pega carona num hábito que a pessoa já tem.
Descartado: só formulário manual — que permanece como fallback obrigatório, porque o formato da URL do Maps é interno e pode mudar sem aviso.

### 005 — Todo processamento no aparelho
Geometria, interseção e persistência acontecem no device; a localização nunca sai do telefone.
Custo de servidor perto de zero, funciona offline e é o que torna o app defensável num tema sensível.
Descartado: backend fazendo o matching.

### 006 — Chave de API atrás de um Cloudflare Worker
Um Worker de ~60 linhas guarda a chave do ORS, repassa a chamada e cacheia respostas idênticas.
Chave embutida no APK é extraída e a cota é queimada por terceiros.
Descartado: chave no cliente.

### 007 — Três níveis de área, com regras diferentes
Área própria e privada é livre (sem fonte, sem validade, sem justificativa). Camada pública exige autor identificável e categoria. Camada oficial exige data, fonte e expiração.
Preferência privada e afirmação publicada são objetos sociais diferentes, mesmo sendo o mesmo polígono no banco.
Descartado: exigir evento datado em toda área — regra boa para camada pública, errada para área própria.

### 008 — Vocabulário separado e proibição de agregar
Área do usuário se chama "área que eu evito"; a palavra *risco* só aparece na camada oficial. Áreas privadas nunca são somadas em mapa de calor, ranking ou estatística.
As duas regras juntas substituem qualquer exigência de expiração nas áreas próprias e impedem que o app vire lista de CEP negado.
Descartado: mapa de calor comunitário das áreas mais evitadas.

### 009 — Android primeiro, iOS depois
A v1 é só Android.
A Share Extension do iOS exige criar um target no Xcode, e não há Mac disponível.
Descartado: lançamento simultâneo.

### 010 — Corredor seguro vai para o backlog
Função de definir por qual via atravessar quando atravessar é inevitável, via polígono com anel interior.
É boa ideia e enquadramento afirmativo, mas não é v1: geometria cabe na Fase 1, interface na Fase 3.
Descartado: implementar agora. Depende de confirmar que o ORS respeita anel interior (Fase 0, item 2).

### 011 — Escopo de segurança definido pelo que o app é
Checklist própria na seção 12 do plano, adaptada a app offline-first sem conta, sem banco remoto e com um único proxy.
Metade das listas de segurança de app web (RLS, cookie, senha, sessão, chave pública de banco) não tem objeto neste projeto; incluir esses itens geraria trabalho falso e falsa sensação de cobertura.
Descartados por decisão, não por esquecimento: certificate pinning (quebra na rotação de certificado e mata o app em campo), captcha (proxy não tem navegador onde apresentar desafio), telemetria e crash reporting (contradizem a política de privacidade).

### 012 — Sem telemetria, em definitivo
Nenhum SDK de analytics ou crash reporting entra no pubspec.
A política de privacidade vai dizer que nada sai do aparelho, e isso precisa ser verdade literal — é o argumento mais forte do app num tema sensível.
Descartado: Firebase Crashlytics, Sentry e similares. Bug chega por relato do usuário.

### 013 — Endpoint de versão mínima no Worker
O Worker expõe a versão mínima suportada do app, e o app avisa quando está abaixo dela.
O domínio do ORS já migrou uma vez (api.openrouteservice.org → api.heigit.org, agosto de 2026); na próxima mudança, APK antigo falharia em silêncio e o usuário culparia o app.
Descartado: atualização forçada obrigatória — aviso basta, e não deixa ninguém sem o app na estrada.

### 014 — App web instalável (PWA) no lugar de Flutter
O app é HTML + JavaScript puro, instalado pelo Chrome no Android (que gera um WebAPK: ícone, tela cheia, menu Compartilhar).
Flutter exigia o toolchain no notebook para cada mudança; a versão web é construída e testada inteira na nuvem, em Chromium de verdade, e publicada sem intervenção.
Descartado: Flutter nesta fase. O núcleo Dart escrito antes fica como referência; a lógica foi portada para `js/core.js` com os mesmos testes.

### 015 — Valhalla público no lugar do OpenRouteService
Motor de rota: Valhalla da FOSSGIS (o mesmo do openstreetmap.org), com `exclude_polygons`, sem chave de API.
Tira o passo de criar conta e o servidor proxy; nenhuma chave existe, então nenhuma vaza. Rota real Zona Oeste → BRT Morro do Outeiro conferida: 32,61 km, 700 pontos, bate com o servidor.
Descartado por ora: ORS + Worker. Volta quando o volume exigir instância própria — o motor está isolado em `js/rede.js`.

### 016 — Orçamento de perímetro no pré-filtro
O Valhalla limita a soma dos perímetros dos polígonos de exclusão por requisição (padrão ~10 km). O pré-filtro prioriza as áreas que a rota direta cruza e para no orçamento.
Áreas que ficam de fora não somem: a rota alternativa é sempre reconferida no aparelho contra TODAS as áreas, e o veredito diz a verdade (estado "parcial" ou "sem desvio").
Descartado: prometer desvio sem conferir.

### 017 — Link curto do Maps fica para o Worker
`maps.app.goo.gl` só se expande seguindo o redirecionamento, o que o navegador não pode fazer (CORS). Até existir o Worker, o app reconhece o link curto, explica e cai na entrada manual; links longos (`/maps/dir/`, `api=1`) funcionam.
Descartado: usar serviço público de terceiros para expandir — mandaria a rota do usuário para quem não conhecemos.

### 018 — Paradas do Maps escolhidas por desvio e conferidas
O Maps só recebe paradas, e entre duas paradas escolhe o caminho que quiser. O app agora põe uma parada em cada trecho em que a rota segura se afasta da direta (até 9, o teto do link) e confere: pede ao motor o caminho mais curto passando por elas, sem as áreas. Se esse caminho entra numa área, ganha parada no trecho; se dá uma volta grande perto de uma parada (retorno), a parada anda 300 m. No máximo 4 conferências; o veredito diz se ficou conferido, não garantido ou não conferido.
Motivo: teste real do Marcelo (23/09/2026), em que o Maps fez retorno numa parada e cortou caminho por baixo entre outras duas; o critério antigo (3 pontos mais afastados) deixava áreas separadas sem parada. Ele aceitou até 9 paradas.
Descartado: aumentar o número de pontos sem conferir (mais paradas, mais retornos); navegação dentro do app (fora do escopo). A conferência usa o Valhalla sem trânsito como aproximação do Maps — não garante o trajeto exato.

### 019 — Área grande demais: contorno por pontos de passagem e motivo honesto
Área que não cabe no orçamento de perímetro do Valhalla (9,5 km somados) não vai como exclusão. O app agora tenta dar a volta nela pelos dois lados, com pontos de passagem nos cantos do casco convexo folgado em 300 m (`ladosDoContorno`, tipo `through`), e fica com o lado mais curto que passa por fora — conferido no aparelho como qualquer desvio. Até 2 áreas grandes por verificação, 2 pedidos cada.
Motivo: teste real do Marcelo — área grande no caminho, e o veredito dizia "não há caminho por fora" sem nunca ter perguntado ao motor. Agora o veredito diz o motivo de verdade (`MOTIVO`: área grande, origem/destino dentro, motor devolveu por dentro, motor sem caminho, falha de rede).
Descartado: ORS com chave (aceita áreas grandes, mas exige conta e proxy — volta junto com a decisão 015); cortar a área em pedaços (a soma dos perímetros só aumenta).
