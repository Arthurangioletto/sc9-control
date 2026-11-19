# Revisão local das conexões da entrega

## Resultado

O leitor SharePoint funciona no protótipo local. Ainda falta ligar essa leitura ao Resumo da operação do SC9. O experimento tem entrada própria e não altera o servidor, os acessos ou as telas do painel publicado.

A análise Graphify de 19/11/2026 mapeou 2.288 nós e 9.163 relações em 102 comunidades. A revisão combinou o mapa com leitura do código e testes locais. Os 64 arquivos originais analisados foram conferidos por hash e preservados.

## Conexões verificadas

| Caminho | Evidência | Situação |
| --- | --- | --- |
| Sessão Microsoft → Graph → Excel → Pedidos | `experiments/sharepoint-local/server.cjs`, `delivery.cjs` | Implementado no experimento |
| Presença na entrega → Enviado | `audit/delivery-view.js` e testes | Validado em simulação |
| Unidade e pedido → classificação | `audit/projection.test.cjs` | Cambuci não altera outra unidade |
| Classificação → filtros → Resumo → Excel | `audit/scenarios.cjs` e funções reais da raiz | Validado em simulação |
| Mudança da leitura → indicadores e paginação | `audit/scenarios.cjs` | Totais preservados; paginação reiniciada pelo caminho real do Resumo |
| Falhas, eTag, intervalo e consultas concorrentes | `audit/scenarios.cjs` | Validado com rede simulada |
| Retém, Transferência e Cadastro de lotes | Fluxos, acessos e armazenamentos próprios | Sem nova dependência do leitor SharePoint |

A execução anterior aprovou 356 testes existentes e 13 cenários de entrega. Na preparação deste commit sobre a main preservada, passaram 361 testes, incluindo nove testes do experimento, além dos 13 cenários da auditoria ampliada executados separadamente. A planilha de simulação foi reaberta com 63 pedidos Enviado, sem duplicação e com quantidades numéricas. Isso não representa uma integração já ativa no Resumo nem uma garantia de todas as regras do sistema.

## Pendências para integrar ao Resumo

1. Aplicar a confirmação da entrega antes dos filtros de situação, dia, produto e unidade.
2. Alimentar indicadores, listas e exportação com a mesma lista resultante, preservando os totais e as peças.
3. Usar as sessões e permissões existentes do SC9 para compartilhar a consulta com os usuários autorizados.
4. Atualizar a explicação que ainda exige NF no Cambuci, quando a nova regra entrar em uso.
5. Definir continuidade da sessão Microsoft e apresentação da última leitura válida após reinícios. O cache local atual existe somente na memória.

## Limites do mapa

O diagnóstico registrou uma referência de teste sem nó declarado, 46 autorrelações e 1.628 relações condensadas. Nomes repetidos nos scripts compilados podem produzir ligações ambíguas; caminhos automáticos entre testes e módulos não comprovam uma ligação em execução. Os caminhos relevantes foram conferidos diretamente no código e nos testes.

Arquivos vendor separados ficaram fora da análise da aplicação. Scripts já incorporados nas telas foram extraídos estruturalmente. O custo em tokens da extração semântica não foi informado pela ferramenta e permanece indisponível; o custo não deve ser tratado como zero.

O mapa completo permanece como artefato local da auditoria. Este relatório registra as conclusões úteis, sem publicar caminhos pessoais, dados reais da planilha ou configuração corporativa.
