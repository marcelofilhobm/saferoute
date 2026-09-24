# Projeto Contorno — Plano de Desenvolvimento

> *Contorno* é codinome de trabalho. Trocar depois; não gastar tempo com nome agora.

---

> ## ⚠ Revisão de 23/09/2026 — troca de stack
>
> Este plano foi escrito para Flutter + OpenRouteService. **O app foi construído como app web instalável (PWA) + Valhalla público.** Onde este documento fala em Flutter, Dart, `flutter_map`, ORS, Cloudflare Worker ou `lib/core/`, leia com esta tabela:
>
> | Antes (plano) | Agora (construído) | Por quê |
> |---|---|---|
> | Flutter / Dart | HTML + JS puro, instalável pelo Chrome (PWA → WebAPK) | Dá para construir e testar inteiro sem o notebook; o Chrome gera o APK na instalação |
> | `lib/core/` em Dart | `js/core.js`, sem DOM e sem rede, 23 testes no Node | Mesma regra: núcleo puro e testável |
> | OpenRouteService + chave + Worker | Valhalla público da FOSSGIS (`exclude_polygons`), sem chave | Tira o passo de criar conta e o servidor; a chave não existe, então não vaza |
> | Limites do ORS (200 km², 20 km) | Mantidos como validação de área **+** orçamento de perímetro do Valhalla (~10 km somando todos os polígonos por requisição) | Limite novo e mais apertado; o pré-filtro respeita |
> | Share Intent (Android) | `share_target` do manifest (funciona no app instalado) | Mesmo efeito |
> | Tela de veredito com 4 estados | 4 estados + **parcial** (desvia de parte) | A rota alternativa é sempre reconferida no aparelho |
>
> O que **não** mudou: as regras de área (seção 2.1), o vocabulário, a proibição de agregar, o processamento no aparelho, e a checklist de segurança (seção 12) no que se aplica.
>
> **Pendências novas:** (1) o Valhalla público é para teste e poucos usuários — para lançar em escala, instância própria ou ORS com proxy; (2) link curto `maps.app.goo.gl` precisa de um expansor no servidor (Worker) — até lá, o app explica e cai na entrada manual; (3) o portão da Fase 0 (`exclude_polygons` respeitado no Rio) é verificado na primeira rota real com área no caminho.

## 1. O que é o app

Um verificador de rota. O usuário tem uma rota (montada no Google Maps ou no próprio app) e o Contorno responde a uma pergunta: **essa rota atravessa alguma área que eu marquei para evitar?** Se atravessa, oferece uma alternativa que passa por fora e entrega essa alternativa ao Google Maps para a navegação.

O que o app **não** é: não é navegador, não é rede social, não é app de denúncia em tempo real.

Diferencial real: Google Maps e Waze não permitem excluir áreas do cálculo de rota. O ORS permite. Esse é o produto inteiro.

---

## 2. Decisões já tomadas (não reabrir)

Esta seção existe para evitar redecidir tudo em cada sessão de trabalho.

| Decisão | Escolha | Por quê | Alternativa rejeitada |
|---|---|---|---|
| Modo de operação | Verificação pré-viagem | Zero permissão de background, zero bateria, MVP de 1 tela | Geofencing ao vivo (iOS limita a 20 regiões; consumo de bateria) |
| Navegação | Handoff via deeplink | Construir turn-by-turn é projeto de meses e competiria com o Waze | Mapbox Navigation SDK (cobra por MAU + cláusulas de licenciamento de dados) |
| Destino do handoff | Google Maps (aceita `waypoints`) | Waze só aceita destino → ignoraria o desvio e destruiria a função | Waze como principal |
| Entrada da rota | Share Intent (Android) / Share Extension (iOS) | Carona num hábito existente; zero digitação | Só formulário de origem/destino |
| Motor de rota | OpenRouteService (`avoid_polygons`) | Único gratuito com exclusão de polígono documentada | Valhalla self-hosted (servidor = custo + manutenção) |
| Mapa | `flutter_map` + tiles OpenFreeMap | Dart puro, sem setup nativo, R$0, sem API key | MapLibre nativo (só se performance exigir); Google Maps SDK (exige cartão) |
| Processamento | Tudo no device | Localização nunca sai do telefone; custo de servidor ~zero; funciona offline | Backend fazendo o matching |
| Chave de API | Proxy em Cloudflare Worker | Chave embutida no APK é extraída e a cota é queimada | Chave no cliente |
| Base de dados de áreas | Camadas assináveis + áreas próprias | Usuário não depende de moderação alheia | Moderação humana (viraria plantão diário) |
| Natureza da área | **Três níveis com regras distintas** (ver 2.1) | Preferência privada e afirmação publicada são objetos sociais diferentes, mesmo sendo o mesmo polígono | Tratar toda área igual; agregar áreas privadas |

### 2.1 — Os três níveis de área

O mesmo polígono significa coisas diferentes conforme o alcance. As regras acompanham o alcance, não a geometria.

| Nível | O que é | Regras |
|---|---|---|
| **Própria, privada** | Preferência do usuário | Livre. Sem validade obrigatória, sem fonte, sem moderação, sem justificativa. "Não quero passar aqui" basta. Nunca sai do aparelho salvo exportação explícita |
| **Compartilhada com contatos** | Preferência entre pessoas que se conhecem | Livre. Escopo pequeno e contexto conhecido |
| **Camada pública seguida** | Afirmação publicada | Precisa de autor identificável e categoria declarada. Quando um polígono é consumido por estranhos que não sabem por que foi desenhado, deixa de ser preferência e passa a ser classificação |
| **Camada oficial importada** | Fato | Datada, com fonte, expira |

**Duas regras de implementação que valem por toda a política:**

1. **Vocabulário.** Área desenhada pelo usuário se chama **"área que eu evito"**. A palavra *risco* aparece exclusivamente na camada oficial, onde há fonte e data. Mesmo objeto no banco, nome diferente na interface — e isso muda o que o app é.

2. **Nunca agregar.** Não somar as áreas privadas dos usuários em mapa de calor, ranking, estatística ou "áreas mais evitadas". Vai parecer crescimento e vai ser tentador. É o caminho direto para virar lista de CEP negado, e é a regra que substitui qualquer exigência de expiração nas áreas próprias.

---

## 3. Escopo da v1

**Dentro:**
1. Receber link compartilhado do Google Maps e extrair origem, destino, paradas e modal
2. Entrada manual de origem/destino como alternativa
3. Calcular rota normal e rota com exclusão
4. Tela de veredito: quantas áreas cruzadas, quais, custo do desvio em tempo e km
5. Handoff para Google Maps com waypoints injetados
6. Desenhar e editar áreas próprias no mapa
7. Uma camada pré-carregada de dados de evento
8. Persistência local

**Fora da v1** (registrar e não fazer): alerta em tempo real, conta de usuário, publicação de camadas para terceiros, seguir criadores, comentários, notificações push, versão iOS.

**iOS fica para depois.** A Share Extension exige um target no Xcode, e você não tem Mac. Android primeiro, sem culpa.

---

## 4. Restrições técnicas duras

Confirmadas na documentação. Desenhar contra elas desde o começo.

**OpenRouteService:**
- Rota com áreas de exclusão: máx. **150 km** (RMRJ cabe folgado)
- Área máxima por polígono de exclusão: **200 km²**
- Extensão máxima do polígono: **20 km** em altura ou largura
- Máximo de rotas alternativas: **3**
- Waypoints por rota: **50**
- Cota gratuita: aproximadamente 2.500 requisições/dia (verificar no painel — pode ter mudado)

**Consequência de projeto:** você não pode enviar todas as áreas assinadas na requisição. É obrigatório pré-filtrar (ver algoritmo 3) e validar cada polígono contra os limites de área e extensão antes de enviar — polígono grande demais precisa ser recusado na criação, com mensagem clara, não na hora do cálculo.

**Deeplinks:**
- Google Maps aceita `waypoints`; Waze aceita **só destino**
- O formato de URL do Maps é interno e não documentado → o parser tem que degradar para entrada manual, nunca quebrar

**Plataforma:**
- Android 11+ exige declarar `<queries>` no manifest para o `url_launcher` conseguir abrir outros apps

---

## 5. Stack

```yaml
# Dependências principais do pubspec.yaml
flutter_map: ^8.x              # mapa
latlong2: ^0.9.x               # tipos de coordenada
flutter_map_polygon_editor     # editor de polígono com alças de arraste
http: ^1.x                     # chamadas ao proxy
receive_sharing_intent: ^1.x   # receber o link compartilhado
url_launcher: ^6.x             # abrir Maps/Waze
drift: ^2.x                    # SQLite local (ou isar, se preferir)
freezed + json_serializable    # modelos imutáveis e (de)serialização
```

**Backend:** um único Cloudflare Worker (TypeScript, plano gratuito) que guarda a chave do ORS, repassa a chamada e cacheia respostas idênticas. Cerca de 60 linhas. É o único componente de servidor do projeto.

**Geometria:** o pacote `turf` para Dart é uma porta parcial. Se faltar função, implementar à mão — ray casting para ponto-em-polígono e Cohen–Sutherland ou teste de segmentos para linha-cruza-polígono são meia página de código cada e vale escrever, porque são os testes unitários que sustentam a confiança no app.

---

## 6. Modelo de dados

```dart
Camada {
  id, nome, autor, descricao,
  escopo: enum {privada, contatos, publica, oficial},  // define as regras (ver 2.1)
  atualizadaEm, ativa: bool
}

Area {
  id, camadaId,
  geometria: List<LatLng>,      // polígono fechado
  rotulo,                       // texto livre do usuário nas camadas privadas
  categoria,                    // obrigatória só em escopo publica/oficial
  severidade: 1..3,             // idem
  validaDe, validaAte,          // null = permanente. Obrigatórias só em escopo oficial
  fonte,                        // obrigatória só em escopo oficial
  areaKm2, extensaoMaxKm        // calculados na criação; validam contra limites do ORS
}

Assinatura { camadaId, ativa, ordemPrioridade }

Consulta {  // histórico local, opcional
  id, origem, destino, criadaEm,
  areasAtingidas: List<areaId>,
  custoDesvioMin, custoDesvioKm, escolha
}
```

Formato de intercâmbio: **GeoJSON com FeatureCollection**, propriedades no `properties`. Assim as camadas são arquivos, importáveis e exportáveis sem servidor — e você pode compartilhar uma camada por WhatsApp antes de existir qualquer infraestrutura.

---

## 7. Os quatro algoritmos centrais

**7.1 — Expansão e parsing do link**

```
GET no link curto seguindo redirects → ler a URL final (não o corpo HTML, que vem vazio)
Path após /maps/dir/ → segmentos = [origem, ...paradas, destino]
Segmento no formato "lat,lng" → coordenada direta
Segmento com nome → buscar par !3d<lat>!4d<lng> no blob "data"
                  → se não achar, geocodificar (Nominatim/Photon)
!3e[0-3] → modal
Falha em qualquer etapa → cair na entrada manual
```

**7.2 — Interseção rota × áreas**

Rota vem como LineString. Para cada área: teste de interseção segmento-a-segmento contra as arestas do polígono, mais teste de ponto-em-polígono para o caso de a rota estar inteiramente dentro. Retornar não só *se* cruza, mas **onde** e **por quantos metros** — "atravessa 1,4 km dentro da área" é informação muito mais útil que "atravessa".

**7.3 — Pré-filtro de polígonos (obrigatório)**

```
1. Bounding box de origem+destino, com folga de ~5 km
2. Descartar áreas cujo bbox não intersecta
3. Descartar áreas expiradas (validaAte < hoje)
4. Ordenar por severidade, cortar no limite do ORS
5. Agregar as restantes num MultiPolygon
```

Sem isso você estoura os limites do ORS em qualquer rota real.

**7.4 — Extração de waypoints para o deeplink**

```
1. Amostrar a rota segura a cada N metros
2. Para cada amostra, medir a distância até a rota padrão
3. Achar os máximos locais dessa distância = os "gargalos" do desvio
4. Pegar de 2 a 3 desses pontos
5. Snap ao ponto mais próximo na malha viária
6. Montar: /maps/dir/?api=1&origin=..&destination=..&waypoints=A|B|C&travelmode=driving
```

Três waypoints bem escolhidos forçam o corredor sem engessar a rota inteira.

---

## 8. Roadmap

Orçamento: 6–10h por semana. Total estimado ~50h → 6 a 8 semanas.

### Fase 0 — Validação (4h15, zero código de app) — **fazer primeiro, inteira**

Esta fase existe porque seu padrão de abandono é perda de convicção, não falta de tempo. Ela compra convicção antes de você gastar 50 horas.

1. **[30 min — o mais importante do projeto]** Testar `avoid_polygons` na mão, via curl, com uma rota real da Zona Oeste atravessando um polígono desenhado sobre uma via específica. O Rio tem geometria de rota difícil: poucos eixos, morro, água, vias expressas. Se o ORS devolver rota absurda ou ignorar o polígono, **o produto não existe** e você descobriu isso na primeira meia hora em vez de na quadragésima.
2. **[15 min — no mesmo script]** Testar se o ORS respeita **anel interior** (polígono com furo). É o que viabiliza o corredor seguro do backlog. Se respeitar, a função sai quase de graça na Fase 3; se não respeitar, o corredor precisa ser feito por waypoint forçado e isso muda o desenho. Barato saber agora.
3. **[1h]** Ler as avaliações de 1 e 5 estrelas dos apps existentes de segurança do Rio na Play Store, procurando uma reclamação específica: alguém pedindo aviso sobre a *rota*, não sobre o *ponto*. Se ninguém pede isso, a premissa é fraca e vale saber agora.
4. **[30 min]** Solicitar autorização da API do Instituto Fogo Cruzado. Leva dias, então dispara já — é o item de maior prazo do projeto.
5. **[2h]** Escrever à mão, em papel ou markdown, a tela de veredito com números reais do teste 1. Se ela não te parecer útil, pare aqui.

**Portão:** só passe para a Fase 1 se o item 1 funcionou.

### Fase 1 — Núcleo sem interface (8–10h)

Pacote Dart puro, nenhuma tela. Parser de link, cliente do proxy, interseção, pré-filtro, extração de waypoints. **Tudo com teste unitário** — inclusive com rotas reais do Rio como fixtures. Rodável por CLI.

Motivo de separar: você consegue avançar nisso num plantão de 24h com o celular, sem emulador. E se um dia o app morrer, este pacote é conhecimento reaproveitável.

### Fase 2 — Tela de veredito (10–12h) → **primeira versão utilizável**

Share Intent → análise → resultado → botão de handoff. Áreas ainda hardcoded num GeoJSON de exemplo. No fim desta fase o app **resolve o problema de verdade** para você mesmo. Instale no seu celular e use por duas semanas antes de continuar.

### Fase 3 — Mapa e áreas próprias (10–12h)

`flutter_map`, desenho e edição de polígono, validação contra os limites do ORS, persistência no SQLite, importação e exportação de GeoJSON.

### Fase 4 — Camadas (8h)

Ingestão da API do Fogo Cruzado convertendo ocorrências em polígonos com buffer e validade. Seletor de camadas ativas. Importar camada de arquivo GeoJSON recebido por WhatsApp.

### Fase 5 — Publicação (8h)

Ícone, política de privacidade (curta e verdadeira: "nada sai do seu aparelho"), ficha da Play Store, formulário de Segurança de Dados, conta de desenvolvedor.

**Portão obrigatório:** a checklist de segurança da seção 12.4 precisa estar inteira marcada. Não publique com item aberto.

**Nota sobre a conta:** a Play Store custa US$ 25 uma vez. Contra seu R$0, é o único desembolso do projeto — decida se vale antes da Fase 5, não durante. Você pode distribuir por APK direto até lá.

---

## 8.1 — Backlog (registrado, fora da v1)

Ideias boas que **não entram agora**. Existem aqui para não ficarem soltas na cabeça nem invadirem o escopo.

| Ideia | O que é | Onde caberia | Custo |
|---|---|---|---|
| **Corredor seguro** | Quando atravessar é inevitável, definir por qual via atravessar. Implementação: `área menos buffer_da_via` → polígono com furo enviado no `avoid_polygons`. Enquadramento afirmativo ("por onde eu passo"), que combina com a regra de vocabulário | Geometria na Fase 1, interface na Fase 3 | Baixo, **se** a Fase 0 item 2 confirmar que o ORS respeita anel interior. Exige que a via atravesse a área de ponta a ponta |
| **Verificação de ponto** | Colar um endereço e responder se ele cai dentro de alguma área evitada. Sem rota, sem ORS, sem cota, offline | Botão a mais na Fase 2 | Quase zero — o código de ponto-em-polígono já existe na Fase 1 |
| Comparação por horário | Mesma rota, horários diferentes, usando o timestamp das ocorrências | Fase 4+ | Médio, depende de volume de dados |
| Publicação de camadas | Seguir criadores, assinar camadas de terceiros | Fase 6+ | Alto — exige servidor, conta de usuário e as regras de 2.1 |
| Waze em duas etapas | O Waze só aceita destino: navegar primeiro até o ponto do desvio, depois até o destino (decisão 020) | Só se muita gente pedir Waze | Baixo no código, alto no uso — duas navegações por viagem |

**Regra:** item do backlog só é promovido quando a fase atual estiver fechada e usada por duas semanas. A verificação de ponto é a candidata mais provável a subir logo depois da Fase 2.

---

## 9. Riscos e como matar cada um

| Risco | Gravidade | Como resolver |
|---|---|---|
| ORS não roteia bem no Rio | Fatal | Fase 0, item 1 |
| Formato do link do Maps muda | Média | Parser com fallback para entrada manual; nunca dependência única |
| Termos de uso do Google | Média | Processar no device e descartar; não montar dataset derivado no servidor |
| Estigmatização territorial via camada pública | **Alta — reputacional e jurídica** | Regras de 2.1: vocabulário separado ("área que eu evito" vs. "risco"), nunca agregar áreas privadas, autor identificável em camada pública. Áreas privadas são livres |
| Cota do ORS estourada | Baixa | Cache no Worker; rate limit por dispositivo |
| Cold start sem usuários | Média | O app tem que servir a **um** usuário sozinho. Camada oficial + áreas próprias entregam isso. Comunidade é Fase 6+, opcional |
| Seu vínculo com o CBMERJ | A avaliar | Publicar como autor pessoa física, sem menção à corporação, sem usar dado interno. Vale conferir se há vedação estatutária além do impedimento de MEI e administração de empresa |

---

## 10. Critérios de encerramento (definidos agora, a frio)

Decidir isso antes de se apegar ao projeto é o que separa parar bem de abandonar mal.

- **Fase 0 item 1 falha** → encerra. Custo: 30 minutos.
- **Fase 2 concluída e você não usa o app por duas semanas seguidas** → encerra. O app não resolveu nem o seu problema.
- **Fogo Cruzado nega a API** → não encerra. Degrada para áreas próprias.
- **Ninguém além de você usa depois de 3 meses** → não encerra automaticamente. A pergunta certa é se *você* ainda usa.

**Residual garantido se falhar:** geometria computacional aplicada, arquitetura offline-first, share intents e deeplinks entre apps, um pacote Dart testado e reaproveitável, e um Worker em produção. Nada disso se perde.

---

## 12. Segurança

Lista adaptada ao que este app realmente é: offline-first, sem conta de usuário, sem banco remoto, com um único proxy. Metade das checklists de segurança de app web não se aplica aqui — e fingir que se aplica só gera trabalho falso.

### 12.1 — O que NÃO se aplica na v1

Registrado para não voltar como dúvida: chave pública de banco, RLS, autenticação server side, proteção de cookie, hash de senha e controle de sessão. Não existe banco remoto, conta, sessão nem senha. Isso passa a valer na Fase 6, se houver publicação de camadas.

Também descartados por decisão, não por esquecimento:
- **Certificate pinning** — quebra sozinho na rotação de certificado e deixa app morto em campo. O ganho não paga o risco operacional num projeto de um desenvolvedor só.
- **Captcha / bot protection** — proxy sem navegador, não há onde apresentar desafio. Rate limit por dispositivo resolve o problema real.
- **Telemetria e crash reporting** — Crashlytics ou equivalente contradiz a política de privacidade. Decisão firme: **nenhum SDK de analytics no app.** Bug reportado é bug contado pelo usuário.

### 12.2 — Worker (o único servidor)

| Item | Regra |
|---|---|
| Chave do ORS | Só como variável de ambiente do Cloudflare. Nunca no repositório, nunca no APK |
| Superfície | Aceita **um** caminho e **um** método. Qualquer outro → 404 |
| SSRF | Nunca aceitar URL de destino como parâmetro. O endpoint do ORS é constante no código do Worker |
| Rate limit | Por identificador de dispositivo e por IP. Teto diário abaixo da cota do ORS, com folga |
| Validação de entrada | Rejeitar antes de repassar: mais de 150 km, polígono acima de 200 km² ou 20 km, coordenadas fora do bbox da RMRJ, corpo acima de N KB |
| Vazamento em erro | Nunca repassar o corpo bruto do erro do ORS nem cabeçalhos upstream. Mensagem própria, genérica |
| Log | Não registrar coordenadas. Só contadores agregados e código de erro |
| Resposta | Devolver só os campos que o app usa, não o payload inteiro do ORS |
| Cabeçalhos | `Content-Type: application/json`, `X-Content-Type-Options: nosniff`, CORS restrito (sem `*`) |
| HTTPS | Forçado pelo Cloudflare. Não expor rota HTTP |
| Versão mínima | Endpoint que devolve a versão mínima suportada do app. O domínio do ORS já mudou uma vez; quando mudar de novo, APK antigo precisa avisar o usuário em vez de falhar em silêncio |

### 12.3 — App

| Item | Regra |
|---|---|
| Segredos | Nada no código. `PROXY_URL` por `--dart-define` |
| Git | `.gitignore` completo desde o primeiro commit. Varredura de segredo (gitleaks ou similar) antes do primeiro push público. Segredo que entrou no histórico só se resolve rotacionando a chave |
| GeoJSON importado | **Entrada hostil.** Teto de arquivo (~2 MB), teto de vértices por polígono, teto de features, faixa de coordenada válida, anel fechado, rejeitar NaN/Infinity, profundidade máxima de JSON, parsing em isolate com timeout, e whitelist de propriedades — nunca aceitar campo arbitrário do arquivo direto no modelo |
| Link compartilhado | Também é entrada não confiável. Teto de comprimento, host permitido apenas Google, máximo de 3 redirects, timeout curto |
| SQL | Só consultas parametrizadas. Nada de interpolar string em `customSelect`, inclusive nome de camada vindo de arquivo importado |
| Banco local | `android:allowBackup="false"` — as áreas evitadas revelam onde a pessoa mora e por onde circula; não devem subir para o backup do Google. Avaliar SQLCipher se for barato no drift |
| Cleartext | `android:usesCleartextTraffic="false"` |
| Build | `flutter build apk --obfuscate --split-debug-info=...` |
| Dependências | `flutter pub outdated` antes de cada release; Dependabot ou OSV-Scanner no `pubspec.lock` |
| Keystore | Gerar uma vez, **guardar backup offline em dois lugares**. Perdeu o `.jks` e nunca mais atualiza o app na Play Store. Este é o erro mais caro e mais comum do roadmap inteiro |
| Permissões | Só `INTERNET`. Nenhuma permissão de localização na v1 — o modo é pré-viagem |

### 12.4 — Portão da Fase 5 (checklist de lançamento)

Nada disso é opcional para publicar:

- [ ] Varredura de segredo no histórico do git, limpa
- [ ] Rate limit do Worker testado com abuso simulado
- [ ] Worker recusa corpo malformado, polígono fora dos limites e caminho desconhecido
- [ ] Importação de GeoJSON testada com arquivo gigante, malformado e malicioso
- [ ] `allowBackup` e `usesCleartextTraffic` em `false` no manifest de release
- [ ] Build de release ofuscado e testado em aparelho real
- [ ] Keystore com backup offline em dois lugares
- [ ] `flutter pub outdated` sem vulnerabilidade conhecida
- [ ] Política de privacidade publicada e verdadeira
- [ ] Formulário de Segurança de Dados da Play Store preenchido de acordo com a política
- [ ] Nenhum SDK de telemetria no `pubspec.yaml`

### 12.5 — LGPD

Enquanto nada sair do aparelho, você não é controlador de dado pessoal de ninguém — não há coleta, não há tratamento, não há transferência. Isso não é sorte, é consequência da decisão de processar tudo local, e é o argumento mais forte do app num tema sensível. **No dia em que a Fase 6 colocar camadas publicadas num servidor, isso muda por completo** e precisa ser reavaliado antes de uma linha de código, não depois.

---

## 13. Configurações

### A) Onde trabalhar

Notebook disponível, então a divisão é por natureza da tarefa:

| Onde | Para quê |
|---|---|
| **Projeto no Claude** (celular ou notebook) | Fase 0 inteira. Depois: revisar arquitetura, decidir se função entra, planejar a fase seguinte. Trabalho de plantão |
| **Claude Code** (notebook) | Fase 1 em diante. Escrever, editar, rodar `flutter test`, corrigir |

O motivo de migrar: em chat, o ciclo é eu devolver código → você copiar → rodar → colar o erro de volta. São minutos que se repetem centenas de vezes. No Claude Code eu edito, rodo o teste, leio a falha e corrijo sem você no meio. Com 6 a 10h por semana, esse atrito é metade do seu tempo.

**Um único texto, dois lugares:** o `CLAUDE.md` é canônico e fica na raiz do repositório — o Claude Code lê esse arquivo automaticamente em toda sessão. O mesmo texto vai colado no campo Instruções do Projeto aqui no chat. Quando uma decisão mudar, edite o `CLAUDE.md` e recole. Não mantenha duas versões diferentes.

### A.1) Projeto no Claude

**Nome:** Contorno — app de rotas

**Instruções do projeto:** colar o conteúdo do `CLAUDE.md`.

**Adicionar ao conhecimento do projeto:**
1. Este arquivo (`plano-contorno.md`)
2. Um `decisoes.md` que você atualiza ao fim de cada sessão — só as decisões novas, 3 linhas cada. Este é o arquivo que mais rende ao longo do tempo.
3. Quando existirem: `pubspec.yaml` e os modelos de dados, para as respostas de código saírem coerentes com o que já está escrito.

**Não** colocar no conhecimento: código-fonte inteiro (fica obsoleto e polui), chaves de API.

### A.2) Projeto Flutter

**`android/app/src/main/AndroidManifest.xml`** — dentro de `<activity>`, o filtro que faz seu app aparecer no menu Compartilhar do Maps:

```xml
<intent-filter>
    <action android:name="android.intent.action.SEND" />
    <category android:name="android.intent.category.DEFAULT" />
    <data android:mimeType="text/plain" />
</intent-filter>
```

Fora de `<application>`, no nível do `<manifest>`:

```xml
<uses-permission android:name="android.permission.INTERNET" />

<queries>
    <package android:name="com.google.android.apps.maps" />
    <package android:name="com.waze" />
</queries>
```

O bloco `<queries>` é obrigatório no Android 11+ — sem ele o `url_launcher` não consegue nem verificar se o Maps está instalado, e o botão de handoff falha silenciosamente.

**`android/app/build.gradle`:** `minSdkVersion 21`.

**Chaves e segredos:** nada de chave no código. A URL do Worker entra por `--dart-define`:

```bash
flutter run --dart-define=PROXY_URL=https://seu-worker.workers.dev
```

E no código: `const String.fromEnvironment('PROXY_URL')`. A chave do ORS existe **só** dentro do Worker, como variável de ambiente do Cloudflare.

**`.gitignore`:** acrescentar `*.env`, `**/local.properties`, `*.jks`, `key.properties`, `/build`.

**Estrutura de pastas:**

```
lib/
  core/          # o pacote da Fase 1 — sem import de flutter
    parsing/     # link do Maps
    geo/         # interseção, pré-filtro, waypoints
    routing/     # cliente do proxy
    models/
  data/          # drift, repositórios, GeoJSON
  features/
    veredito/
    mapa/
    camadas/
  main.dart
test/
  fixtures/      # rotas reais do Rio como JSON
```

A regra que importa: **`lib/core/` não importa nada do Flutter.** Isso mantém tudo testável sem emulador e é o que permite você trabalhar de plantão.
