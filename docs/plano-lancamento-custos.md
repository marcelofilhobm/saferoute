# Contorno — Plano de Lançamento e Custos

> Escrito em 23/09/2026. Complementa o `plano-contorno.md`; não substitui.

---

## 1. Calendário real

O gargalo não é código. É a exigência de teste fechado da Play Store.

**Regra:** conta pessoal criada depois de 13/11/2023 precisa de teste fechado com no mínimo **12 testadores opt-in contínuo por 14 dias** antes de poder pedir acesso à produção. O pedido ainda passa por análise do Google, normalmente até 7 dias. Testador que sai antes do dia 14 zera o contador. Contas de organização são isentas, mas exigem D-U-N-S e documentação de empresa — indisponível para você.

### Linha do tempo mínima a partir de hoje

| Quando | O quê |
|---|---|
| **Hoje** | Criar conta no Play Console (US$ 25) e iniciar verificação de identidade — leva dias e bloqueia tudo |
| **Hoje** | Começar a recrutar os 12 testadores. Recrute **15**, não 12: é a decisão tática mais importante do processo, porque desistência zera o contador |
| Esta semana | Fase 0 — o teste do `avoid_polygons` |
| Semanas 1–2 de outubro | Fases 1 e 2 comprimidas: núcleo + tela de veredito, áreas hardcoded |
| ~7 a 10 de outubro | Subir APK para o teste fechado. **A partir daqui o relógio de 14 dias começa** |
| ~24 de outubro | Fim dos 14 dias. Pedir acesso à produção |
| Fim de outubro / início de novembro | Aprovação, se tudo correr bem |

**Veredito honesto:** lançar em setembro é impossível. Fim de outubro é possível só com a versão mínima — Fase 2 e nada mais, sem mapa, sem áreas próprias, sem camadas. Data realista com folga: **meados de novembro**.

### O atalho que existe

Distribuição por **APK direto**, fora da Play Store. Zero custo, zero espera, zero burocracia. Serve para colocar o app na mão de dez pessoas ainda em outubro e descobrir se ele presta antes de gastar os 14 dias de teste fechado. Não é lançamento, é validação — e é exatamente o que o critério de encerramento da seção 10 do plano pede.

Bônus: essas mesmas pessoas viram seus testadores na Play Store depois.

---

## 2. Custos

### 2.1 — Lançar a v1 (sem cobrança)

| Item | Custo |
|---|---|
| Conta Google Play Console | **US$ 25, uma vez** (~R$ 135) |
| OpenRouteService | R$ 0 — cota gratuita |
| Cloudflare Worker | R$ 0 — plano gratuito |
| Tiles do mapa (OpenFreeMap) | R$ 0 |
| Hospedagem da política de privacidade (GitHub Pages) | R$ 0 |
| Ferramentas de desenvolvimento | R$ 0 |
| **Total para estar publicado** | **~R$ 135** |

Esse é o projeto inteiro. Um desembolso único, e nenhum custo recorrente.

### 2.2 — Custo que aparece se der certo

| Gatilho | Item | Custo |
|---|---|---|
| Cota do ORS estourada (~300 a 500 usuários ativos) | VPS com Valhalla self-hosted | US$ 5 a 12/mês (~R$ 30 a 70) |
| Domínio próprio, se quiser | Registro .com.br | ~R$ 40/ano |

**Atenção ao ponto de ruptura:** cada verificação gasta 2 requisições (rota base + rota desviada). Com ~2.500/dia, o teto fica em torno de 1.250 verificações diárias. Se o app viralizar, ele **para de funcionar antes de gerar receita**. A VPS resolve, mas é gasto que vem antes do retorno — e é o único custo recorrente do projeto até a Fase 6.

### 2.3 — Custo de adicionar assinatura (Fase 6)

| Item | Custo |
|---|---|
| Comissão do Google Play | 15% da receita |
| Backend com estado (Supabase ou equivalente) | R$ 0 no início, ~US$ 25/mês depois |
| Tempo de manutenção | Sobe muito: suporte, cancelamento, reembolso, uptime |
| Obrigações de LGPD | Você deixa de não coletar nada e vira controlador de dados |

---

## 3. Os modelos de monetização

### A) Pagar para seguir, com divisão de receita ao criador — **não fazer**

A ideia tem lógica: criador ganha, faz marketing por você, incentivos alinhados. Quatro problemas, e os dois primeiros são impeditivos.

1. **Você não pode operar isso.** Dividir receita faz de você intermediário de pagamento. Na prática exige CNPJ para nota fiscal, retenção e repasse. O estatuto militar te barra de MEI e de administrar empresa. Pagar dezenas de pessoas como PF não é só trabalhoso — é irregular.
2. **Conflito direto com a seção 2.1 do plano.** Pagar por publicação de "áreas a evitar" cria incentivo financeiro para marcar mais área e de forma mais dramática. Monetizar afirmação territorial transforma o principal risco reputacional do projeto no motor do negócio.
3. O Google Play Billing não divide receita nativamente. Seria coleta e repasse manual, um a um.
4. Marketplace de criadores é o modelo mais difícil de arrancar que existe: criador não entra sem público, público não paga sem criador.

**Descartado por escrito, não adiado.**

### B) Assinatura geral para seguir quem quiser — **depois, se houver base**

Legalmente simples: você só recebe, não repassa. O Google cuida da cobrança. Mas puxa junto conta de usuário, servidor com estado, LGPD, cancelamento, reembolso e compromisso de disponibilidade. É um segundo produto, não uma função.

Ordem de grandeza: 300 assinantes a R$ 9,90/mês, com 15% de comissão, dá cerca de R$ 2.500/mês. É aqui que mora renda de verdade — e é aqui que mora o custo de verdade.

### C) Grátis com desbloqueio único — **o caminho recomendado para a v1**

A propriedade que torna isso decisivo: **desbloqueio único não precisa de servidor nem de conta.** O Google Play guarda a compra, o app consulta a biblioteca do usuário, pronto. Sem backend, sem cadastro, sem LGPD nova, sem obrigação de uptime. Recebimento cai na sua conta como pessoa física.

Ordem de grandeza: 10 mil instalações com 2% de conversão a R$ 14,90 dá cerca de R$ 2.500 — uma vez, não por mês.

### D) B2B — melhor razão entre renda e esforço, mas exige o que você evita

Frota de motoboy, transportadora, cooperativa de motorista de app no Rio. Uma empresa pagando R$ 500/mês vale mais que 5 mil usuários grátis, e o comprador tem dor real e orçamento. Custo: prospecção e reunião, que você já disse não gostar. Fica registrado como opção, não como plano.

### O que nenhum modelo resolve

Nenhum desses caminhos é passivo. Consumidor em escala exige marketing e presença. B2B exige prospecção. Em algum momento você vai ter que escolher qual desconforto topa encarar — app bom sem distribuição não fatura, e isso não é problema de código.

---

## 4. Recomendação

**Fronteira grátis/pago, decidida agora porque muda o desenho das telas:**

| Grátis | Pago (desbloqueio único) |
|---|---|
| Verificação de rota | Camadas assinadas de terceiros |
| Áreas próprias, ilimitadas | Corredor seguro |
| Camada oficial (Fogo Cruzado) | Exportação e importação em lote |
| Handoff para o Maps | |

O núcleo — que é o diferencial e o que faz o app valer a pena para uma pessoa sozinha — fica grátis. Isso preserva a viralização. O que se paga é conveniência e conteúdo de terceiro.

**Sequência:**

1. **v1 (outubro/novembro):** grátis, sem cobrança nenhuma, sem conta. Publicar e descobrir se alguém usa.
2. **v1.1 (dezembro):** desbloqueio único, se a v1 tiver retenção. Nenhuma infraestrutura nova.
3. **Fase 6 (2027, se houver base):** conta de usuário e assinatura, só depois que existirem pelo menos três pessoas além de você usando toda semana.

---

## 5. Viralização sem gastar

O vetor já está no plano e é gratuito: **camada em GeoJSON compartilhada por WhatsApp.** Alguém manda "as áreas que eu evito na Zona Oeste" para o grupo, e o arquivo só abre em quem tem o app. Distribuição embutida no produto, sem campanha, sem custo, sem você aparecer.

Isso vale mais que qualquer verba de marketing que você não tem — e é mais um motivo para a importação de camadas ser prioridade alta na Fase 4.

---

## 6. Pendência bloqueante

**Antes de gastar os US$ 25 ou escrever qualquer linha sobre cobrança:** verificar no estatuto do CBMERJ se há vedação a receber renda de aplicativo como pessoa física. Você já sabe do impedimento de MEI e de administração de empresa. Receita recorrente de app sobre segurança pública, feito por oficial da ativa, merece essa checagem antes de virar plano — não depois.

Isso é anterior a qualquer decisão técnica deste documento.

---

## Fontes

- [App testing requirements for new personal developer accounts — Play Console Help](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Google Play 12 Testers Policy Explained (2026)](https://www.testerscommunity.com/blog/google-play-12-testers-policy)
