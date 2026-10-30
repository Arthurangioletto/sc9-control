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

## Integridade e compatibilidade dos dados

- Lotes duplicados entre produtos continuam agrupados pelo lote, para análise.
- Ocorrências individuais de vencimento e saldo negativo usam uma chave v2 com
  filial, armazém, produto, lote e validade. A mesma função é usada no navegador
  e no servidor (`inventory-integrity.js`). Tipos de achados têm namespaces distintos.
- Notas antigas são vinculadas automaticamente somente quando o achado salvo
  permite identificar uma única ocorrência. As demais ficam preservadas na seção
  de observações antigas sem vínculo único; não são copiadas para várias filiais.
- A sincronização do navegador usa a base completa, sem filtros de filial,
  armazém ou prazo. Filtros afetam a visualização e a exportação. Clientes antigos
  que enviarem grupos parciais têm seus registros mesclados pelo servidor; o
  front atual identifica seus grupos completos com `completeGroups`.
- Falhas de leitura do armazenamento não são convertidas em listas vazias no
  cadastro. Isso evita tratar uma indisponibilidade como ausência de dados.
- Dashboard exige o perfil `geral`. Consulta de pedido permite `geral`, `saida`,
  `alteracoes`, `recebimento` ou `despacho`, além do administrador.
- O índice normaliza os números dos pedidos tanto nos pedidos quanto nos itens
  e transportadoras, preservando os vínculos quando existem zeros à esquerda.

Após publicar, recarregue o navegador. Reimporte o SC9 para reconstruir o índice
já salvo e o SB8 completo para recompor ocorrências que versões anteriores tenham
sobrescrito. A correção preserva os dados disponíveis; não recupera registros que
já deixaram de existir sem uma fonte ou backup.

Execute `npm test`: inclui testes de identidade/migração/filtros e integração
HTTP em um diretório temporário, com Supabase desativado e dados fictícios.


## Completar filiais sem refazer revisões

O administrador pode importar, em Importações → Carregar SB8, um JSON no formato `sc9-sb8-filiais-v1`. Ele contém `entries` com produto, lote, armazém e filial. Vínculos que exigem desambiguação também incluem saldo e validade.

Essa operação preenche somente filiais ausentes nos achados existentes. Registros com qualquer observação, marcação, escolha de produto correto, conferência física, finalização ou outra nota permanecem intactos. Ela não recalcula análises nem modifica saldos, datas ou históricos. Correspondências ambíguas permanecem sem filial.

Antes da gravação, uma cópia dos achados e lembretes é salva no armazenamento privado, com nome `cadastro-filiais-backup-<data>.json`. A operação exige administrador e protege os achados e as notas com as mesmas filas usadas nas atualizações normais. É possível validar sem gravar enviando `preview: true` com a ação `completarFiliais`.

## Vencimentos por estado e saldo atual

A tela Vencimento mantém busca e filtros, sem o antigo resumo de volume e faixas. Os cards abaixo da filial agrupam RJ+RT, DF+DT, ES+ET, CE+CT e BH+BT, sempre dentro da filial selecionada. Somam apenas saldos positivos e mostram vencidos e vencimentos nos próximos 90 dias, contados a partir do dia da consulta (prazo de retirada preventiva). Os cards incluem todos os status; a lista continua respeitando o filtro de acompanhamento. As demais análises mantêm seu comportamento.

Em Importações, administradores e usuários com perfil Cadastro encontram **Atualizar saldo atual do SB8**. A atualização aceita apenas os registros presentes no arquivo e preserva os ausentes. A substituição total e a substituição por filial/armazém foram bloqueadas no servidor. Para zerar um registro, é necessário enviá-lo explicitamente com saldo 0. Somente **Aplicar atualização do saldo**, depois da prévia, grava a posição.

A identidade inclui filial, armazém, produto, lote e validade; linhas físicas com a mesma identidade são somadas dentro do arquivo. A importação substitui a quantidade anterior, sem acumular dois arquivos. Linhas zero novas não precisam ser armazenadas, e saldos que zeraram deixam de entrar nos vencidos. Na primeira atualização, achados antigos inequívocos fornecem a posição anterior para a prévia; referências repetidas não multiplicam saldo e saldos conflitantes são sinalizados.

A posição é armazenada separadamente em `cadastro-sb8-atual.json`. Os arquivos de achados e lembretes não são escritos por essa operação: históricos, status, produto correto e campos físicos permanecem intactos. Cada aplicação salva antes uma cópia privada da posição anterior em `cadastro-saldos-backup-<id>.json`. A tela de Importações exibe apenas o novo bloco de atualização do saldo SB8; o carregamento antigo foi removido da interface. As importações complementares de endereços e valores permanecem disponíveis.

O envio ocorre em lotes de até 2.000 linhas, com validação e sequência. Nenhum lote altera a posição publicada. A publicação é feita numa fila única após a prévia; uma importação concorrente invalida a versão anterior. Preparações expiram após 30 minutos ou reinício. Falhas anteriores à publicação mantêm a posição anterior. O endpoint exige sessão e o cabeçalho anti-CSRF; gravar exige administrador. O limite é 500 mil linhas.

Saldos iguais entre importações mostram desde quando foram observados iguais. Isso não comprova estoque sem movimentação: entradas e saídas entre exportações podem se compensar. Para medir dias sem movimento, ainda é necessário integrar o histórico de movimentação.

A lista de vencimentos é organizada em cards por produto, com código, descrição, quantidades e indicação de vencimento no cabeçalho. Cada card inicia recolhido e reúne os lotes do produto no recorte atual. Ao abrir, cada registro identifica filial, armazém, saldo e validade e mantém suas próprias marcações, nota e finalização. São dez produtos por página e até dez registros por página dentro do card. A busca abre o produto e a página do lote encontrado. Exportações continuam incluindo todos os registros do recorte, sem depender dos cards abertos ou da página.

O armazém 16, destinado aos produtos vencidos já segregados, é desconsiderado na análise de vencimentos em todas as filiais: contagens, cards, lista, prazo de 90 dias, seletores de armazém e exportação. Os registros do SB8 e os trabalhos salvos permanecem guardados; as demais análises continuam considerando esse armazém.

O aviso global de observações antigas não é mais exibido nas telas do cadastro. As observações permanecem salvas e as notas e ações de cada registro continuam disponíveis.

Na análise de vencimentos, a primeira etapa de evolução visual acrescenta a alternância Cards/Tabela e a identificação do recorte aplicado. Ambas as visualizações usam os mesmos registros filtrados e as mesmas ações de acompanhamento. A tabela mostra até 30 registros por página, com produto, descrição, lote, filial, armazém, saldo, validade e situação. A busca por lote e a exportação continuam usando o recorte completo. Alternar a visualização não modifica o saldo, os filtros ou os rascunhos de notas mantidos na sessão.

A segunda etapa acrescenta a ficha lateral do produto. Ela é aberta por **Ver ficha** nos cards ou pelo código do produto na tabela. Reúne saldo, lotes, locais, validade e acompanhamento exclusivamente no recorte atual; não representa todo o estoque fora desses filtros. As ações e os rascunhos usam os registros originais. Abrir e fechar a ficha mantém a visualização, a página e os filtros da lista. Se um registro sair do recorte após marcação ou finalização, a ficha reflete essa mudança sem manter cópias antigas para edição.

O componente `SC9UI.Sheet`, em `navigation.js`, e os estilos `sc9-sheet`, `sc9-ui-button` e `sc9-detail-*` formam uma base visual reutilizável para outras abas. O painel usa diálogo modal nativo, ciclo de foco por teclado, fechamento por Escape, botão ou área externa, bloqueio temporário da rolagem de fundo e restauração do foco ao controle de origem. Nenhuma dependência ou serviço foi acrescentado nesta etapa.

## Navegação compartilhada

A navegação geral oferece busca por nome ou função da tela, sem diferenciar acentos. A busca considera apenas as telas permitidas ao perfil atual; Enter abre a tela quando há um único resultado e Escape limpa a consulta. Os identificadores das rotas e as permissões existentes são preservados.

Os cabeçalhos identificam a área, a tela e seu objetivo. O menu usa ícones e mantém atalhos acessíveis quando recolhido no computador. Em telas menores, apresenta busca e nomes completos no menu expansível, independentemente da preferência de recolhimento do computador. O título da navegação interna do cadastro é Estoque e lotes; as análises e ações permanecem disponíveis.

Validação: `node --test tests/navigation-visual.test.cjs tests/detail-sheet.test.cjs tests/operator-navigation.test.cjs tests/analysis-followup.test.cjs` (14 testes), além de conferência local no navegador em computador e viewport de 390 px. Essa etapa não modifica saldos, importações ou registros de acompanhamento.

## Resumo gerencial da operação

O Resumo da operação apresenta pedidos no recorte, em aberto, enviados e peças liberadas, com a identificação dos filtros e da data de corte. Em aberto significa status diferente de Enviado. O percentual enviado é calculado sobre os pedidos do mesmo recorte; não mede atendimento dentro do prazo. Quando não há pedidos, não se apresenta percentual calculado.

As filas de atenção preservam a classificação existente: atrasados excluindo os classificados como aguardando faturamento, pedidos sem nota com indicação de separação e conferência, e pedidos do Cambuci com nota e conclusão física sem confirmação na Entrega. Os critérios aparecem nos cards. As filas são sinais operacionais, não etapas exclusivas para soma. A confirmação por Entrega aplica-se ao Cambuci; os demais armazéns seguem a classificação por nota fiscal da base atual.

Indicadores e linhas do comparativo abrem os pedidos correspondentes no painel lateral compartilhado. A tabela existente mantém paginação, ordenação, exportação de toda a lista e acesso à timeline. Quantidades decimais são preservadas na exibição dos detalhes do resumo. Peças liberadas abre a análise de produtos. O comparativo por armazém e as observações automáticas usam o mesmo recorte dos indicadores. A tabela comparativa antiga foi substituída para evitar duplicação e divergência de filtros.

O módulo legível `operation-overview.js` recebe os pedidos já classificados e filtrados pelo aplicativo. Não grava dados nem altera a classificação, o prazo de corte ou os perfis de acesso. A interface é responsiva e reutiliza os componentes atuais, sem acrescentar dependências.

Validação desta etapa: 20 testes de resumo, navegação, permissões, painel lateral e acompanhamento, mais 24 verificações de integração do servidor, incluindo a entrega do novo arquivo JavaScript. Conferência local com dados fictícios em computador e viewport de 390 px.

## Fluxo da operação

A aba Fluxo utiliza os mesmos pedidos classificados e filtrados do Resumo. Oferece filtros por armazém, data de corte, dia de liberação e status, com indicação do produto quando houver filtro herdado da análise. Alterar o armazém preserva os demais filtros; Limpar recorte volta a todos os armazéns e remove os filtros de seleção. A data de corte vazia não é aplicada.

Os quatro registros de etapas preservam os critérios do fluxo anterior: todos os pedidos liberados, fim de pick informado, conferente preenchido diferente de zero e nota fiscal informada. As contagens são independentes, não exigem uma sequência completa e não devem ser somadas. Os rótulos distinguem conferente informado de término de conferência e nota fiscal de despacho.

As filas repartem os pedidos sem status Enviado em separação, conferência/validação, faturamento e confirmação de despacho. A prioridade de enquadramento é confirmação de despacho, faturamento segundo a classificação atual, conferência quando existe fim de pick e separação nos demais casos. Cada pedido em aberto aparece uma única vez. Os cards mostram pedidos e peças; a maior fila é indicada pelo número de pedidos, incluindo empates, sem inferir produtividade ou atraso por SLA.

Os tempos decorrem desde o registro disponível até a gravação da base: início de separação ou liberação com horário, fim de pick, fim de conferência ou fim de pick para faturamento, e fim de conferência para despacho. Datas ausentes, inválidas e posteriores à referência não entram na média nem no máximo. A cobertura informa quantos pedidos possuem data utilizável. Sem data válida de gravação, não se calculam tempos. Datas sem hora tornam a medida aproximada; tempo decorrido não comprova inatividade.

Etapas e filas abrem a tabela de pedidos no painel lateral compartilhado, mantendo paginação, ordenação, exportação da lista completa, quantidades decimais e acesso à timeline. O retorno da timeline identifica a aba Fluxo e preserva o recorte. O módulo `operation-flow.js` não grava dados nem altera as regras de classificação ou permissões.

Validação: 21 testes de Fluxo, Resumo, navegação, permissões e painel lateral, mais 24 verificações de integração do servidor. Conferência local com dados fictícios dos filtros combinados, armazém vazio, detalhes, timeline e layout em computador e viewport de 390 px.

## Expedição: conferência, SF2 e Entrega

A aba Expedição apresenta quatro indicadores clicáveis para pedidos com conferência finalizada: conferidos no SC9, notas vinculadas à SF2, pedidos presentes na Entrega e notas na SF2 sem presença na Entrega. Os grupos podem se sobrepor. Os detalhes usam os pedidos originais identificados por armazém e pedido, com quantidades decimais, tabela paginada, exportação e timeline. O retorno da timeline preserva o recorte e identifica a Expedição.

Os filtros de armazém, data de corte, dia de liberação, status e produto herdado são os mesmos do Resumo e do Fluxo. O comparativo, os gráficos diários, a tabela por transportadora e o gráfico de mercadoria/faturamento respeitam o recorte de pedidos. O dia de liberação filtra os pedidos; os gráficos diários continuam usando as datas dos eventos. Alterar o armazém mantém os demais filtros e Limpar recorte remove a seleção.

A interface identifica as fontes: SC9 pelo término de conferência, SF2 pelo número da nota e Entrega pelo número do pedido. Fontes ausentes aparecem como indisponíveis e desabilitam os indicadores correspondentes; uma fonte disponível sem correspondências mostra zero. A conferência permanece consultável mesmo sem SF2. O vínculo da Entrega continua usando o número do pedido, sem validação de unidade nessa associação; a lista identifica o armazém. As regras existentes não foram alteradas.

O tempo médio entre fim de conferência e faturamento mantém o cálculo existente: notas anteriores ao término contam como zero minuto. Um atalho permite consultar esses pedidos. A timeline passa a distinguir nota já existente sem confirmação na Entrega de pedido sem nota, corrigindo apenas o texto apresentado.

O módulo `operation-shipping.js` reutiliza o painel lateral, a tabela e os estilos das etapas anteriores, sem dependências novas. Dados de produção, importações e perfis permanecem preservados. Validação: 28 testes de Expedição, Fluxo, Resumo, navegação, permissões e painel lateral, mais 24 verificações de integração do servidor; conferência local com dados fictícios em computador e viewport de 390 px.

## Saída e Recebimento: apresentação operacional

As telas de Saída para expedição e Recebimento identificam o dia consultado, a consulta histórica, o carregamento e falhas de atualização. O contexto informa a atualização automática apenas durante a consulta do dia, após o carregamento e sem erro. Na Saída histórica, avisa que os novos bipes continuam sendo registrados no dia atual. No Recebimento histórico, informa o modo de consulta e o retorno a Hoje para bipar.

A Saída apresenta resumo de registros, registros sem alteração pendente, alterações pendentes e registros sem dado SC9. A contagem usa registros, incluindo reenvios; não pressupõe pedidos únicos. O grupo sem dado SC9 pode se sobrepor aos demais. O resumo é somente leitura.

Os indicadores de Recebimento mantêm as contagens e os identificadores de filtro existentes. Os cards distinguem recebidos, recebidos sem saída registrada, saída sem recebimento, pedidos que não saem hoje, sem confirmação na Entrega e confirmados na Entrega. As contagens usam o dia consultado; transportadora e busca filtram a lista de recebidos. Saída sem recebimento permanece informativa e a lista de divergências continua disponível. Os indicadores podem se sobrepor.

As áreas de bipagem ganham destaque e identificação acessível, com campo em largura adequada no celular. Tabelas e cabeçalhos usam o padrão visual compartilhado. Regras de bipagem, Enter, duplicidade, reenvio, desfazer, alterações, volumes, confirmação na Entrega, exportação, retenção e permissões permanecem as mesmas. O módulo legível `operation-handoff.js` não faz requisições nem grava dados.

Validação: 33 testes de apresentação operacional, Expedição, Fluxo, Resumo, navegação, permissões e painel lateral, além de 24 verificações de integração. Conferência local com registros fictícios de correspondência e divergência, bipes duplicados nas duas telas, filtro de recebimento e celular de 390 px sem extravasamento horizontal.

## Controle 02 → 01: prioridade e navegação

O Controle apresenta os indicadores existentes em cards, com identificação explícita de que consideram todos os registros. Pessoa e divergência continuam sendo filtros do histórico. O resumo usa a função original de totais, preservando critérios de status, observação, recebimentos e prazo de atenção (4 horas) e atraso (24 horas). A quantidade enviada pendente exibe também valores decimais.

Os atalhos permitem ir à fila de conferência, abrir o histórico completo e mostrar divergências/observações. Os atalhos do histórico removem a seleção de pessoa para apresentar o conjunto indicado pelos totais, preservando o bloqueio de acesso existente. Nenhum resumo permite contornar esse bloqueio.

A prioridade destaca a entrega pendente mais antiga com data válida até a consulta. Datas ausentes, inválidas e futuras não são usadas nessa prioridade; as pendências continuam na fila existente. O botão Localizar lote para conferir leva ao card e foca o campo original de quantidade recebida, sem preencher ou confirmar valores. O tempo é contado desde o registro e não comprova paralisação física.

A movimentação de apoio dos armazéns 01 e 02 permanece disponível em seção expansível para os mesmos perfis. O formulário de nova transferência, os cards da fila, os cabeçalhos e as tabelas seguem o padrão visual compartilhado e se adaptam ao celular. Registro, bipagem, validação de quantidade e saldo, conferência com SD3, confirmação, persistência, filtros originais, exportação, exclusão e permissões mantêm as mesmas funções.

O módulo legível `operation-transfers.js` apresenta o resumo e a prioridade sem gravar dados. Validação: 37 testes de Controle e telas já evoluídas, além de 24 verificações de integração do servidor. Conferência local com transferências fictícias de pendência, confirmação e divergência, recebimento decimal preservado após recarregar, foco na pendência mais antiga, atalhos, bloqueio do histórico e viewport móvel de 390 px.

## Cadastro de lotes: contexto e cards de análise

Duplicados, validade inconsistente, saldo negativo e filiais identificam a unidade, o armazém, a prioridade de ordenação, a origem e a quantidade de grupos ou registros do recorte. As contagens não representam peças. O botão Limpar recorte remove os seletores da análise, sem modificar observações ou achados. Prioridade de armazém continua distinta do filtro que exige saldo nesse local.

Validade inconsistente e filiais apresentam grupos de lotes expansíveis, reutilizando a navegação pela busca. Dentro dos grupos, e na análise de saldo negativo, cada registro aparece em um card com produto, lote, descrição, saldo e os campos originais de filial, armazém, endereço e datas. Marcações, rascunhos, salvamento, finalização e demais ações continuam usando os elementos e registros originais. Saldos fracionados são exibidos com até seis casas decimais, inclusive nas prioridades e nos duplicados.

O módulo `inventory-presentation.js` organiza a apresentação sem gravar dados. Regras de classificação, filtros, paginação, exportação, vencimentos, importação do SB8 e permissões permanecem preservados. Validação: 54 testes de apresentação, acompanhamento, filtros e regressão, mais 24 verificações de integração do servidor. Conferência local com dados fictícios, incluindo saldo −0,25, rascunho preservado após recolher o lote, filtro de filial e layout de celular de 390 px sem extravasamento horizontal.

## Monitor ao vivo: contexto e prioridades

O Monitor identifica o Cambuci como recorte próprio, independente dos filtros das outras telas. A data da base SC9 aparece separada da data de cálculo da consulta. A atualização automática existente a cada seis segundos, enquanto a tela está visível, continua consultando o servidor sem importar outro SC9. A apresentação distingue carregamento, base ausente, erro com nova tentativa e consulta sem atualização recente (mais de 30 segundos). Uma pequena diferença de até cinco segundos entre os relógios é tolerada. Em falhas posteriores ao carregamento, os números da última consulta permanecem identificados.

Os quatro indicadores preservam os valores calculados pelo servidor: em processo, liberados hoje, pendências de fora de hoje ou com data não identificada e expedidos hoje com bipe. Este último exige classificação como expedido e bipe de saída do dia; a nova descrição esclarece o critério existente. Os indicadores não devem ser somados.

As prioridades distinguem os prazos de separação, conferência, envio à expedição e faturamento do atraso pela regra de nota/Entrega/corte do SC9. Os totais continuam usando os agregados do servidor. As listas recebidas têm até 30 registros por motivo; o painel informa essa limitação, reúne os motivos da mesma combinação de pedido e etapa e oferece busca, filtro de motivo e paginação de dez registros. A seleção é preservada durante as atualizações. Os tempos desde o marco da etapa e desde a liberação aparecem separados; tempo decorrido não comprova paralisação.

O título do ranking identifica corretamente a mediana da fila atual, que pode incluir pedidos de outros dias. O módulo legível `operation-live.js` não grava dados nem reclassifica pedidos. Modo TV, metas, transportadoras, gráficos e permissões conservam suas funções. Validação: 49 testes do Monitor e das telas já evoluídas, além de 24 verificações de integração do servidor. Conferência local com dados fictícios de motivos sobrepostos, busca combinada, paginação, filtro sem resultados, atualização preservando o recorte, abertura/saída do Modo TV e celular de 390 px sem extravasamento da página.

## Produtividade: separadores e conferência

As duas telas passam a identificar o recorte, a data da base, as pessoas, os pedidos e as peças atribuídas e os elegíveis segundo a regra existente. Os filtros de armazém, corte de status, dia de liberação, status e produto herdado usam o estado original da aplicação. O corte altera a classificação de status e não limita automaticamente o período. Os dias da elegibilidade são dias de liberação com pedidos, sem representar presença ou jornada. Pedidos sem responsável identificado aparecem separadamente.

A cobertura da separação informa quantos pedidos atribuídos possuem duração válida. Na conferência, distingue pedidos com início/fim, sem o par completo mas com fim de pick como referência alternativa e sem essas referências. A presença do par não garante duração válida. Os tempos, taxas e aproveitamento conservam os cálculos existentes; sua janela pode abranger vários dias e intervalos fora da jornada. O antigo rótulo Ocioso da tabela de separadores passa a Intervalo sem duração, com explicação na metodologia.

Os textos do índice passam a refletir a função existente: volumes de pedidos 20%, linhas 50% e peças 30%, normalizados pelo maior valor por pessoa no recorte, incluindo não elegíveis. Não se trata de taxas por hora. Os valores e as faixas não foram recalculados. Os TOP 5 iniciais continuam incluindo todas as pessoas com dados para cada indicador. A carga dos separadores permanece relativa à média do índice dos elegíveis, sem comprovar capacidade ociosa. A classificação de carga dos conferentes foi retirada da apresentação porque o agregado dessa função não possui índice ponderado; não foi criado um novo cálculo.

As tabelas da equipe recebem busca por nome, participação, ordenação e paginação de dez pessoas. Esses controles afetam somente a tabela, mantendo os gráficos e indicadores no recorte principal. Os registros e a abertura da página pelo nome são os originais. Peças fracionadas são preservadas nos TOP 5, na carga e nas tabelas; taxas da tabela usam vírgula decimal. O módulo `operation-productivity.js` não grava dados. O bloqueio adicional, a comparação de pessoas, os gráficos e as funções de acompanhamento permanecem disponíveis.

Validação: 56 testes de produtividade e das telas já evoluídas, além de 24 verificações de integração do servidor. Conferência local com 134 pedidos fictícios e 13 pessoas por função: paginação, busca, elegibilidade, ordenação, abertura da pessoa, filtro por armazém, datas e status combinados, recorte vazio e celular de 390 px sem extravasamento horizontal da página. A prévia usa credenciais exclusivas de teste; nenhuma credencial de produção foi modificada.

## Card Atrasados no resumo

O card Atrasados volta aos indicadores principais com o critério anterior: status Atrasado em separação/conferência, excluindo os pedidos que aguardam faturamento. Ele substitui o card de prioridade Separação/conferência, evitando duplicar a mesma contagem. Aguardando faturamento e Confirmar despacho continuam disponíveis.

Ao selecionar Atrasados, a lista aparece na própria página, abaixo dos indicadores, sem abrir o painel lateral. A tabela original mantém a coluna de dias desde a liberação até o corte, ordenação, paginação de 50 pedidos, exportação da lista completa e acesso à timeline. Trocar o recorte atualiza a lista e reinicia sua paginação. O botão de recolher devolve o foco ao card. As demais consultas do resumo mantêm seu comportamento.

Validação final: 58 testes de resumo, produtividade e telas já evoluídas. Conferência local adicional com 55 pedidos fictícios de atraso: contagem, segunda página, quantidades fracionadas, filtro de armazém reiniciando a lista e celular de 390 px sem extravasamento da página ou abertura de painel lateral.

## Listas dos indicadores na própria página

Pedidos no recorte, Atrasados, Em aberto, Enviados, Aguardando faturamento, Confirmar despacho e o comparativo por armazém passam a usar uma única lista na própria página. Selecionar outro indicador substitui a lista; selecionar novamente o indicador ativo ou Recolher lista fecha a consulta. O foco volta ao controle de origem ao recolher. Peças liberadas mantém o atalho direto para Produtos · Curva ABC.

A tabela original mostra até 50 pedidos por página, conservando ordenação, exportação da lista completa, quantidades fracionadas e acesso à timeline. Atrasados mantém sua coluna de dias de atraso e os critérios anteriores. Os demais indicadores exibem o status. A paginação reinicia ao trocar de indicador, armazém, corte, dia, status, produto ou quantidade de resultados, evitando páginas vazias após reduzir o recorte. Não há mudança de classificação nem gravação de dados.

Validação: 58 testes das telas já evoluídas. Conferência local com dados fictícios: limite de 50 linhas, segunda página, troca de indicador reiniciando a lista, recorte vazio, filas e comparativo sem painel lateral, atalho direto de peças e celular de 390 px com controles ajustados e rolagem da tabela sem alargar a página.

## Consultas operacionais sem painel lateral

Fluxo e Expedição passam a apresentar seus detalhes na própria página, usando o componente compartilhado `SC9UI.InlineDetails`. Isso conclui a retirada dos painéis laterais operacionais: o Resumo já utiliza listas na página, e a ficha do produto no Cadastro de lotes permanece como exceção, com o painel lateral original preservado.

A consulta rola até a lista e recebe foco, sem bloquear a rolagem ou prender a navegação por Tab. Recolher lista ou Escape fecha a consulta e restaura o foco quando apropriado. Selecionar novamente o indicador ativo também recolhe a lista. Filtros, critérios, registros originais, quantidades fracionadas, exportação completa e timeline continuam disponíveis. A tabela mantém até 50 pedidos por página e reinicia a paginação ao mudar a seleção, o contexto ou a quantidade de resultados. O cadastro e suas ações não foram alterados.

Validação: 61 testes das telas já evoluídas, incluindo o comportamento original da ficha lateral do produto e a verificação de que nenhum outro módulo usa esse painel. Conferência local com dados fictícios em Fluxo e Expedição: consultas sem dialog aberto, 50 linhas, segunda página, troca de indicador retornando à primeira página, fechamento por Escape e celular de 390 px sem extravasamento horizontal da página.

## Importação do SB8 pelo perfil Cadastro

Em Cadastro de Lotes → Importações, Atualizar saldo atual do SB8 fica disponível para administradores e usuários com perfil Cadastro, inclusive quem combina Saída e Cadastro. A posição atualizada é compartilhada entre os usuários autorizados. A liberação não concede acesso à administração nem às ações exclusivas de administrador.

O fluxo mantém a prévia obrigatória, backup, proteção contra atualizações concorrentes e isolamento da importação por usuário. Os achados, marcações e observações anteriores permanecem preservados; a atualização atua na posição de saldos utilizada pelos vencimentos.

## Revisão conjunta das análises e administração

Performance, Horários, Clientes, Produtos · Curva ABC e Tendências compartilham o contexto de armazém, corte de status, dia de liberação, status e produto herdado. O corte classifica o status e não limita automaticamente o período. Horários, clientes e tendências passam a usar a mesma lista filtrada dos indicadores; antes parte dessas análises utilizava somente o armazém. O histórico consolidado de tendência continua disponível no geral sem filtros adicionais; ao aplicar dia, status ou produto, utiliza apenas o recorte atual, evitando misturar o histórico global com uma seleção específica.

Performance distingue ausência de dado de taxa zero, identifica a cobertura e substitui a repetição da taxa enviada por tempo médio de separação. Aproveitamento continua sendo a média existente dos separadores com dados, cuja janela pode abranger intervalos fora da jornada. Horários identifica data e hora do primeiro início e último fim de pick; o indicador por transportadora é liberação até o corte, sem afirmar cumprimento de prazo de despacho. Tendências conserva os cálculos originais e apresenta a referência como estimativa histórica de volume, sem inferir presença ou capacidade disponível. O histórico diário tem tabela paginada, com o atraso de separação/conferência separado conceitualmente de faturamento.

Clientes usa o mesmo agrupamento por nome e oferece todos os clientes, busca, ordenação por volume/pedidos/atrasos e consulta dos pedidos na própria página. Produtos apresenta todos os resultados em páginas de 50, mantendo a classificação ABC e o giro recebidos do cálculo original. Busca e classe afetam somente a tabela. A coluna de quantidade passa a dizer peças liberadas, sem afirmar expedição física. Quantidades fracionadas são preservadas.

Movimentação identifica a base completa independente dos filtros de pedidos. Os gráficos e os indicadores de apoio conservam o conjunto original. O novo explorador consulta todas as linhas com busca por lote/produto/documento/usuário, armazém, tipo e intervalo de datas, em páginas de 50; esses filtros afetam somente a tabela. Saídas do armazém 59 são identificadas como indicador de devolução, sem afirmar que houve uma entrada correspondente no 01. Saldo e estimativa são referentes à base, sem indicar estoque em tempo real.

Revisão de alterações organiza as duas filas em seções com atalhos, preservando Fi, Mi e a exportação original; somente a exibição de quantidades dessas filas e do título da análise passa a conservar as frações. Acessos separa o contexto de usuários e de registros no Controle 02 → 01, com busca e paginação das tabelas. Os elementos e callbacks de criação, perfil, senha, ativação e exclusão são os originais; o resumo de atividade conta apenas pessoas com registros. Nenhuma permissão ou credencial foi modificada.

O módulo legível `ui-workspaces.js` contém os componentes compartilhados de contexto, tabela, paginação e exploração. Não faz requisições nem grava dados. O adaptador de tabela mantém os elementos de ação originais e não lê valores de inputs na busca. As consultas permanecem na página; a ficha lateral do produto no cadastro permanece como exceção. Não há novas dependências.

Validação final desta etapa: suíte completa com 166 testes, incluindo as verificações de integração do servidor, permissões, saldo atual SB8 e proteção de histórico. Conferência local nas oito telas com 253 pedidos, 66 produtos, 117 movimentos e 53 usuários fictícios: segunda página, busca, filtros combinados, recorte vazio, horários, ABC, consulta de cliente, formulário de acesso, campos e rascunho de revisão com quantidade 62,125, além de celular de 390 px sem extravasamento horizontal da página. As funções nativas de classificação, curva ABC, referência de volume, movimento, corte de transportadora e os callbacks de acesso foram comparados com a versão principal e preservados. Dados e credenciais de produção não foram usados na prévia.


## Recuperação dos saldos SB8

Administradores podem consultar os backups em Cadastro de Lotes → Importações → Recuperar posição anterior. Conferir backup mostra a data e os registros com saldo positivo antes da restauração. A restauração exige a versão da posição conferida, rejeita atualizações concorrentes, salva uma cópia de segurança da posição atual e invalida importações pendentes. Não modifica a base global, achados ou observações. Um backup anterior à primeira posição separada retorna à leitura dos achados preservados. A importação seguinte continua preservando os registros ausentes dessa base anterior.


## Informações do pedido ao selecionar a linha

A timeline original do pedido usa a consulta na própria página, com rolagem e foco automáticos. Antes, no Resumo, as informações apareciam abaixo da lista e podiam ficar fora da tela. O número do pedido passa a ser um botão acessível por teclado; o restante da linha continua aceitando clique. Voltar à lista de pedidos ou Escape fecha os detalhes e restaura o foco quando o controle de origem permanece disponível. A lista do Resumo conserva sua seleção, ordenação e página. A ficha lateral do produto permanece como exceção do Cadastro de Lotes.

Validação: testes da tabela original e da integração da timeline, foco, Escape e preservação da paginação. Conferência local com 87 pedidos fictícios atrasados: abertura na segunda página, conteúdo original visível, retorno à segunda página e operação por Enter/Escape. Nenhuma base ou regra de classificação foi alterada.
