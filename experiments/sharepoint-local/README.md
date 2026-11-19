# Consulta local da entrega pelo SharePoint

Protótipo separado do painel SC9. Consulta a planilha configurada e informa se um pedido de Cambuci está na entrega. O servidor principal e suas telas não carregam este experimento. A confirmação ainda não é aplicada ao Resumo da operação publicado.

## Configurar e executar

1. Neste diretório, execute `npm ci`.
2. Crie `data/config.json` a partir de `config.example.json` e preencha os identificadores do aplicativo Microsoft Entra e do arquivo, host do SharePoint, nome do arquivo, aba e link de abertura. `loginHint` é opcional.
3. No aplicativo Entra restrito à empresa, configure o retorno de cliente público `http://localhost:3003/auth/callback` e a permissão delegada `Files.Read`.
4. Execute `npm start`, abra `http://localhost:3003` e conecte uma conta autorizada a ler o arquivo.

A pasta `data`, as dependências e `.env` são ignorados pelo Git. Não versionar planilhas reais, configuração da empresa, tokens ou credenciais. Este fluxo não utiliza segredo de cliente.

## Regras e limites

- A presença de um número válido na coluna Pedidos confirma a saída na unidade configurada, mesmo sem NF ou informações antigas de separação/conferência.
- A projeção de auditoria aplica essa confirmação somente a Cambuci. Pedidos de outras unidades mantêm sua classificação.
- Números repetidos não duplicam pedidos nem peças; zeros à esquerda são normalizados.
- A leitura ocorre a cada 60 segundos na configuração de exemplo. Atualizações simultâneas compartilham a consulta; arquivo com o mesmo eTag não é baixado novamente.
- Uma falha mantém a última leitura válida e informa o erro. A pausa solicitada pela Microsoft é respeitada.
- Conta Microsoft, tokens, sessões e cache ficam na memória deste processo. Um reinício exige reconectar e consultar novamente.
- O servidor aceita somente localhost e usa sessão, proteção de origem e token contra requisições indevidas. Esses controles não substituem os perfis de acesso do SC9 em uma integração futura.

## Verificação

`npm test` executa nove testes de leitura e projeção, sem conta Microsoft ou configuração real. Eles também são descobertos por `npm test` na raiz do projeto.

A auditoria ampliada usa o bundle e os módulos reais da raiz do SC9, dados fictícios e respostas Microsoft simuladas. Para executar os 13 cenários, disponibilize a distribuição CommonJS do SheetJS 0.20.3 usada na auditoria e defina `SC9_XLSX_LIBRARY` com seu caminho absoluto; em seguida, execute `npm run test:audit`. Se a variável estiver ausente, tenta carregar o pacote `xlsx` instalado pelo executor. O caminho e a versão devem ser conferidos pelo executor. A biblioteca de leitura ExcelJS já está na raiz do projeto.

A auditoria gera somente `data/exportacao-simulada-63-pedidos.xlsx`, reabre seus bytes e confere os 63 pedidos enviados e suas quantidades numéricas. Não lê a planilha real nem altera a base SC9. Os pontos extraídos do bundle são deliberadamente explícitos: mudanças nos nomes das funções exigem revisar `audit/sc9-functions.cjs`.

Ver também [revisão das conexões](../../docs/sharepoint-delivery-review.md).
