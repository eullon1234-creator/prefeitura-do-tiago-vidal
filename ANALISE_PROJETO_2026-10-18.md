# Análise do projeto Prefeitura de Canteiro

Data: 18/10/2026. Escopo: revisão estática da cópia local, arquitetura, persistência, backend, portais, PWA, documentação e execução da suíte existente. Não houve acesso ao console Firebase, alteração de dados de produção nem validação visual em navegador. Não foi feita comparação com o HEAD remoto. O remoto local corresponde ao repositório informado pelo usuário.

## Resultado executivo

O projeto já possui uma base funcional extensa para alojamentos, casas, patrimônio, estoque, chamados, limpeza, rondas, despesas e relatórios. Pode continuar em HTML/Tailwind/JavaScript puro. As prioridades são proteger as operações, garantir persistência e tornar a restauração confiável antes de acrescentar módulos.

`node auto_teste.js`: 264 testes aprovados, zero falhas e zero avisos. As oito duplas verificadas de arquivos raiz/frontend estão idênticas. Esse resultado comprova as verificações executadas, não a operação completa do sistema em produção.

## Achados prioritários

### Alta — Controle de acesso administrativo insuficiente

- app.js:7 inicia com perfil prefeito; app.js:3011 permite alternar para prefeito sem autenticação.
- app.py:150–165 valida credenciais e retorna mock-token, mas as rotas administrativas não verificam esse token. Não há dependência de autenticação aplicada às operações de alteração e exclusão.
- iniciar_sistema.bat publica o backend em 0.0.0.0, permitindo acesso pela rede quando o firewall permitir.
- Impacto: quem consegue acessar o backend pode chamar operações administrativas sem passar por uma sessão autenticada. No site estático, o perfil visual não constitui autorização; a proteção efetiva depende das regras do Firestore, que não foram verificadas.
- Ação: implementar identidade e autorização nas operações; manter formulários públicos com permissões específicas e limitadas.

### Alta — Conteúdo de chamados entra diretamente em HTML

- app.js:9394–9407 interpola descricao e nome_solicitante em templates de HTML. Há outros usos em alertas de quartos e casas.
- chamado.html coleta esses valores de formulários públicos e os grava sem neutralização de HTML no trecho analisado.
- Impacto: caminho de injeção de HTML e possível XSS persistente no painel ao exibir conteúdo recebido. Não foi executada exploração.
- Ação: usar textContent para texto e criar uma política consistente para atributos e URLs; testar entradas maliciosas sem atingir produção.

### Alta — Restauração não corresponde a uma recuperação integral da nuvem

- app.js:2237 grava o snapshot em canteiro_metadata/snapshot_canteiro; app.js:2283 lê desse mesmo local.
- app.js:8396 restaura em configuracoes/snapshot_canteiro com outro formato.
- O batch da restauração inclui casas e despesas, mas não repõe na nuvem todos os módulos restaurados em cache, como rondas, limpezas, estoque e chamados. Tampouco remove registros extras ausentes no backup.
- Erros de sincronização são capturados e o fluxo ainda anuncia restauração com 100% de sucesso.
- Impacto: outros aparelhos podem continuar com dados antigos ou repovoar o cache com registros que o usuário acreditava ter substituído.
- Ação: definir formato e destino únicos, restauração por módulo, política de substituição e confirmação verificável por etapa. No modo SQLite, validar também como o banco local será restaurado: o fluxo atual manipula sobretudo estado do navegador e Firestore.

### Alta — Migração antiga pode apagar novos alertas de manutenção

- app.js:144–160 contém uma lista fixa de 12 IDs de móveis. Na inicialização com cache local, força estado Bom, precisa_manutencao=0 e data 2026-09-26 sempre que esses itens divergirem.
- Impacto: um defeito novo em um desses móveis pode desaparecer no próximo carregamento do cache.
- Ação: substituir correção permanente por migração versionada e executada uma vez, preservando alterações posteriores.

### Média/alta — Sucesso exibido após gravação recusada

- chamado.html:549–564 captura falha de gravação, continua e armazena cópia no navegador.
- limpeza.html:1002–1041 também continua até a tela de sucesso depois de erros.
- Os portais ativam a persistência offline do SDK, o que ajuda em interrupções transitórias, mas não resolve escritas recusadas por permissão. Cache local sozinho não comprova entrega ao gestor.
- Ação: distinguir recebido pelo servidor, pendente de envio e falha; manter fila durável com identificadores estáveis, confirmação e reenvio controlado.

### Média — PIN da equipe está disponível no cliente

- limpeza.html:597 usa padrão 1234, lê a senha da configuração e a compara no navegador; ronda.html:569 e 655 seguem padrão equivalente.
- Impacto: a barreira da tela pode ser contornada. O PIN não substitui autenticação nem autorização nas regras de escrita.
- Ação: identidade de equipe e validação no serviço que autoriza a operação, com estratégia explícita para trabalho offline.

### Média — Offline depende de recursos externos não garantidos no cache

- index.html:27–42 carrega Tailwind, ícones, gráficos, planilhas, recorte, scanner e Firebase por CDN; há também fonte remota.
- sw.js não inclui ronda.html no pré-cache. Respostas de origens externas não são armazenadas pelo ramo de cache que exige response.type=basic.
- Impacto: visitar o painel online uma vez não garante que todos os portais e recursos estarão disponíveis numa abertura posterior sem rede. Uma navegação sem cache específico pode cair no index.html.
- Ação: distribuir dependências necessárias localmente, completar o pré-cache e testar instalação, reinício, navegação e operação com a rede desligada.

### Média — Datas operacionais usam UTC em diversos fluxos

- app.js usa new Date().toISOString().split('T')[0] em entradas, saídas, vistorias e formulários.
- Impacto: no fuso de São Paulo, após 21h o dia UTC já é o seguinte. Datas de rotina podem ficar adiantadas.
- Ação: centralizar data civil local para operação; preservar UTC para timestamps de eventos.

## Arquitetura e manutenção

- Existem dois caminhos de execução: FastAPI/SQLite e motor estático no navegador com Firestore. São fontes distintas, com regras de negócios parcialmente duplicadas. É necessário documentar a autoridade de cada dado e o comportamento de sincronização em cada modo.
- O sistema não opera apenas com uma leitura de snapshot. app.js contém listeners de coleções de alojados, blocos, empresas, quartos, móveis, chamados, casas, despesas, limpezas e estoque. Portanto as promessas de uma leitura ou zero leituras não descrevem todo o funcionamento.
- app.js tem aproximadamente 763 KB e index.html 442 KB. Separar responsabilidades em arquivos JavaScript menores é viável sem React, TypeScript ou build. Deve-se preservar a ordem de carregamento e a paridade de deploy.
- Há banco SQLite, JSON inicial e fotos rastreados pelo Git. Revisar a necessidade de distribuir dados operacionais e imagens; confirmar a visibilidade do repositório e o conteúdo antes de concluir o alcance de exposição. Não foram reproduzidos dados pessoais neste relatório.
- Não foi encontrado manifesto de dependências Python entre os arquivos listados. A instalação depende de FastAPI, uvicorn, openpyxl e suporte a multipart, entre outras dependências usadas. Registrar versões e instruções de instalação reproduzíveis.

## Produto e interface

Pontos positivos: integração entre quartos e casas; rotina por QR; inventário e manutenção; despesas; exportações e documentos institucionais; configuração de tipografia e componentes responsivos presentes no código.

Prioridades de usabilidade: mostrar se cada registro está salvo na nuvem ou apenas no aparelho; impedir que conexão inicializada seja confundida com entrega confirmada; padronizar os estados de carregamento e falha; revisar botões compactos e textos de 10–11 px nos fluxos de celular. A revisão visual foi feita pelo código: contraste real, área de toque, câmera, teclado, impressão e rolagem ainda precisam de navegador e aparelhos representativos.

Antes de novos módulos, consolidar o fluxo ocorrência → atendimento → material utilizado → conclusão → histórico. Depois disso, alertas de vencimento e manutenção preventiva tendem a aproveitar melhor a base existente do que ampliar imediatamente a quantidade de telas.

## Limites dos testes atuais

A suíte valida sintaxe, paridade, estrutura, presença de funções/elementos, dados iniciais e simulações. Várias regras são simuladas separadamente em vez de executar a implementação completa. Não comprova autenticação, regras do Firestore, concorrência entre aparelhos, entrega offline, restauração entre dispositivos ou renderização em navegador. A mensagem final da suíte que chama o projeto de 100% operacional excede o alcance dessas verificações.

Testes de maior valor: impedir escrita sem autorização; renderizar chamado com texto contendo HTML como texto; restaurar backup e recarregar em outro cliente; registrar offline e confirmar envio uma única vez; preservar novo defeito nos IDs migrados; datas locais após 21h; disputa pela mesma cama; carga de cada portal sem rede.

## Ordem recomendada

1. Autorização administrativa e renderização segura de conteúdo público.
2. Remoção das sobrescritas permanentes de manutenção.
3. Recuperação por backup e feedback confiável de persistência.
4. Offline completo, sincronização entre aparelhos e datas locais.
5. Modularização Vanilla JS, instalação reproduzível e documentação alinhada.
6. Refinamento de interface e evoluções funcionais.

Nenhum arquivo de funcionamento do sistema foi alterado nesta análise.
