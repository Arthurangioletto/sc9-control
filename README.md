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
