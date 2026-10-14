# SC9 Control — versão hospedada

Isso aqui é o mesmo painel que já vínhamos usando, só que agora roda num servidor
com endereço fixo (uma URL) que qualquer supervisor/gerente/diretor pode abrir —
sem precisar do Claude nem do arquivo Excel em mãos. Quem tem o Excel sobe uma vez;
todo mundo mais só acessa o link e vê os dados prontos.

## Como funciona (resumo sincero)

- O navegador de quem sobe o Excel faz a leitura e os cálculos (exatamente como
  já validamos, nada mudou nas regras de negócio).
- Só o resultado final (um JSON pequeno) é enviado pro servidor.
- O servidor guarda esse resultado e devolve pra quem só quer visualizar.
- **Isso não é tempo real.** Atualiza quando alguém sobe um Excel novo — não sozinho.
- No plano gratuito do Render, o servidor "dorme" depois de 15 min sem uso e
  demora uns 30-50 segundos pra acordar no primeiro acesso do dia. É normal.

## O que você precisa (tudo gratuito, sem cartão de crédito)

1. Uma conta no [Supabase](https://supabase.com) — é onde os dados ficam guardados
   de verdade (o Render sozinho apaga tudo quando o servidor dorme e acorda).
2. Uma conta no [GitHub](https://github.com) — pra guardar o código e o Render
   conseguir "puxar" ele.
3. Uma conta no [Render](https://render.com) — é quem efetivamente hospeda e te
   dá a URL final.

## Passo 1 — Supabase (guardar os dados)

1. Crie uma conta e um novo projeto no Supabase (escolha uma senha de banco
   qualquer, não vamos usar banco SQL — só o "Storage").
2. No menu lateral, vá em **Storage** → **New bucket**. Nome: `sc9-data`.
   Pode deixar como **privado** (não marque "Public").
3. Vá em **Project Settings → API**. Copie dois valores:
   - **Project URL** (algo como `https://xxxxx.supabase.co`)
   - **service_role key** (em "Project API keys" — é a chave secreta, NÃO a "anon")

Guarde os dois — vai usar no Passo 3.

## Passo 2 — Colocar o código no GitHub

1. Crie um repositório novo no GitHub (pode ser privado), por exemplo `sc9-control`.
2. Suba todos os arquivos desta pasta pra esse repositório (pelo site mesmo,
   arrastando os arquivos em "Add file → Upload files", sem precisar de linha
   de comando).

## Passo 3 — Render (hospedar)

1. Crie uma conta no Render e clique em **New → Web Service**.
2. Conecte o repositório do GitHub que você criou no Passo 2.
3. Configure:
   - **Build Command:** (deixe em branco ou `echo ok` — não tem build, é Node puro)
   - **Start Command:** `node server.js`
   - **Plan:** Free
4. Em **Environment Variables**, adicione:
   | Nome | Valor |
   |---|---|
   | `APP_PASSWORD` | uma senha que só vocês saibam (ex: `cambuci2026`) |
   | `SUPABASE_URL` | a Project URL do Passo 1 |
   | `SUPABASE_SERVICE_KEY` | a service_role key do Passo 1 |
   | `NODE_ENV` | `production` |
5. Clique em **Create Web Service**. Em 1-2 minutos o Render te dá uma URL tipo
   `https://sc9-control.onrender.com` — é esse link que vocês vão usar e compartilhar.

## Testando

1. Abra a URL do Render. Vai pedir a senha (`APP_PASSWORD` que você definiu).
2. Depois de entrar, suba o Excel normalmente, do jeito que já fazíamos.
3. Abra o mesmo link em outro navegador (ou peça pra outra pessoa abrir) —
   deve aparecer o painel pronto, sem precisar subir arquivo de novo.

## Estrutura dos arquivos

```
server-app/
├── package.json          # sem dependências externas (Node puro)
├── server.js              # servidor HTTP: login, salvar/carregar snapshot
├── storage.js             # grava no Supabase Storage (ou arquivo local se não configurar)
└── public/
    ├── index.html         # carrega React/Recharts/XLSX via CDN + o bundle
    └── bundle.js           # o painel já compilado, pronto pro navegador
```

Se um dia você quiser mudar alguma regra do painel, me pede o código-fonte
(`App.jsx`) que eu recompilo o `bundle.js` e te mando os arquivos atualizados.

## Limitações que você deve saber

- **Sem tempo real de verdade.** Atualiza só quando alguém sobe um Excel.
- **Plano gratuito "dorme".** Primeiro acesso do dia pode demorar uns 30-50s.
- **Uma senha só, compartilhada.** Não tem usuário/permissão por pessoa — todo
  mundo que tem a senha vê e pode atualizar os dados. Se precisar de controle
  de acesso por pessoa (supervisor vê X, diretor vê Y), isso é um projeto à parte.
- **O CDN do Recharts/XLSX precisa estar acessível.** Se a rede da empresa
  bloquear `unpkg.com` ou `cdn.sheetjs.com`, o painel não carrega. Teste numa
  rede sem bloqueios primeiro.
- Não testei esse deploy "ao vivo" (não tenho acesso à internet daqui pra
  criar as contas e subir de verdade) — testei cada peça separada (servidor
  com requisições HTTP reais, o painel renderizando, a lógica de negócio) mas
  a integração final Render+Supabase+CDN só se prova no primeiro deploy real.
  Se algo não subir, me manda a mensagem de erro exata que eu conserto.

## Navegação por áreas

O painel agrupa as telas em Visão geral, Operação, Produtividade, Análises e
Administração. No computador, a navegação aparece na lateral; abaixo de 1024 px,
o botão **Abrir menu** revela os grupos. Cada grupo pode ser expandido ou recolhido.
Os filtros de armazém e os controles existentes continuam disponíveis.

A visão geral mantém a paleta original, distribui os indicadores em até quatro
colunas e permite expandir **Consultar pedidos** para acessar a tabela detalhada.

- `navigation.js`: componente React legível de navegação; recebe a lista de abas
  já filtrada pelo aplicativo e não concede permissões adicionais.
- `navigation.css`: estilos do menu, cabeçalho, indicadores e layout responsivo.
- `index.html`: carrega os estilos e o componente antes de `bundle.js`.
- `server.js`: permite servir esses dois arquivos estáticos adicionais.

O `App.jsx` original ainda não está disponível neste repositório. A integração
no `bundle.js` é limitada à navegação, ao grid de indicadores e à tabela recolhível.
Se o bundle for recompilado a partir do fonte original, essas três integrações
precisam ser levadas para o JSX antes da compilação.

Validação local: `node --check navigation.js`, `node --check bundle.js` e
`node --check server.js`. Inicie com `npm start`, importe uma base de teste e
verifique a troca de telas, os filtros de armazém, a expansão da tabela e o menu
em uma janela estreita. Não inclua planilhas reais nem arquivos de `data/` no PR.

### Filtro de unidade no cadastro de lotes

O seletor **Unidade** separa Cambuci (01), Santa Catarina (02), Tamboré (03) e Paraíso (04), conforme a
coluna Filial do SB8. **Todas as unidades** mantém também registros de outras
filiais ou sem filial informada. Esse seletor é independente de **Só o armazém**
e da prioridade de saldo. Listas, indicadores, busca e exportações seguem a unidade
selecionada, tanto com o SB8 carregado quanto com os achados salvos. Achados sem
filial identificável só aparecem em Todas as unidades.

A sincronização mantém a análise completa: mudar a seleção não grava uma versão
parcial sobre os achados existentes. A lógica de normalização e o seletor ficam
em `lot-filters.js`. Execute `node --test tests/lot-filters.test.cjs` para validar
os códigos e a filtragem sem alterar os dados originais.

### Registros de lotes em duas linhas

Na análise de lotes associados a mais de um produto, cada registro aparece em um
bloco: a primeira linha reúne lote, ação, filial, produto, descrição, armazém,
endereço e saldo; a segunda reúne as datas de referência, fabricação/validade
físicas editáveis e registro ANVISA. Em telas menores, os campos se distribuem em
mais linhas para evitar rolagem lateral. Os valores financeiros, quando
carregados, ficam em uma seção expansível do registro.

O componente `lot-records.js` reaproveita os campos e callbacks existentes; a
exportação continua usando os mesmos dados. Datas físicas também são confirmadas
ao sair do campo. As datas do sistema e a data de entrada permanecem referências.

### Visão de vencidos

A aba de vencimento utiliza `expiry-panel.js` para organizar o estoque em filial,
armazém, ano e mês da validade, com filtros de período e faixas de envelhecimento.
As filiais são Cambuci (01), Santa Catarina (02), Tamboré (03) e Paraíso (04).
O seletor de armazéns usa todos os códigos disponíveis para a filial no SB8; sem
o arquivo carregado, a cobertura depende dos achados salvos disponíveis.

O volume é a soma dos saldos positivos. Lotes/produtos são contados pela combinação
filial + produto + lote, evitando contar duas vezes o mesmo lote distribuído em
armazéns diferentes. As datas determinam dias de calendário desde o vencimento.
Não há prazo de resolução nem afirmação de dias sem movimentação: isso depende
de dados de movimentação que o cadastro de validade não comprova.

A leitura da referência `BASE (SB8)` motivou aceitar os cabeçalhos abreviados
`Data Validad` e `Data Fabric`. Nenhum dado da referência integra o código/PR.
A exportação do recorte inclui filial, unidade, armazém, produto, lote, saldo,
ano/mês, dias vencidos e faixa de tempo. Os controles de marcação e notas são
os existentes. Testes: `node --test tests/*.test.cjs`.
