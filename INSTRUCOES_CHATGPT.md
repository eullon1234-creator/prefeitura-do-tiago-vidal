# 🤖 Manual de Instruções e Contexto Técnico para o ChatGPT
## Projeto: Sistema Prefeitura de Canteiro — Obra Taboca 2 (GEL Engenharia)

> **Dica para o Usuário:** Você pode enviar este arquivo diretamente para o ChatGPT Plus (anexando no chat ou adicionando na base de conhecimento de um *Custom GPT / Project*) ou copiar e colar a mensagem pronta da **Seção 8** no início da sua conversa com ele.

---

## 1. 📌 Visão Geral do Projeto

Este software é um **ERP / Sistema de Gestão de Canteiro de Obras (Camp Management)** desenvolvido para a obra pesada **Taboca 2** da **GEL Engenharia**, sob gestão do Prefeito de Canteiro **Tiago Vidal**.

* **Capacidade Operacional:** 880 a 900+ leitos, 220+ quartos, 10 blocos de canteiro + rede de Casas Alugadas na Cidade para liderança/engenharia.
* **Stack Tecnológico:**
  * **Frontend:** HTML5 Single Page Application (SPA), Tailwind CSS (via CDN), Vanilla JavaScript moderno (ES6+ modular e reativo), FontAwesome 6, Chart.js, SheetJS (`xlsx.bundle.js` com estilos profissionais), Cropper.js.
  * **Sincronização & Nuvem:** Firebase Firestore em modo **Snapshot Único Consolidado** (`canteiro_metadata/snapshot_canteiro`), minimizando leituras e custos, com motor offline-first completo (LocalStorage e IndexedDB).
  * **PWA (Progressive Web App):** Service Worker (`sw.js`) e `manifest.json` com cache inteligente para funcionamento 100% offline no canteiro.
  * **Backend Opcional / Utilitários Locais:** Python 3 (`app.py`, Flask/SQLite `alojamento.db`, scripts de importação e exportação de planilhas).

---

## 2. ⚠️ AS 3 REGRAS DE OURO (NÃO QUEBRE NUNCA)

Ao programar, editar ou sugerir código para este projeto, o ChatGPT **DEVE** seguir estas 3 regras rigorosamente:

### 1ª Regra: Paridade Obrigatória de 100% entre Raiz e `frontend/`
* Toda vez que você editar qualquer arquivo na raiz (`index.html`, `app.js`, `chamado.html`, `limpeza.html`, `ronda.html`, `sw.js`), o arquivo correspondente dentro da pasta `frontend/` **DEVE ser atualizado identicamente**.
* A pasta `frontend/` é usada para publicação/deploy. Se houver divergência de código, o sistema em produção falhará.

### 2ª Regra: Preservação da Arquitetura Vanilla JS (Sem Frameworks Pesados)
* **NÃO** tente converter o projeto para React, Vue, Angular, TypeScript ou empacotadores (Vite/Webpack).
* O projeto foi arquitetado em **Vanilla JavaScript puro** para carregar instantaneamente no canteiro sem necessidade de build e para rodar perfeitamente offline em celulares de operários.

### 3ª Regra: Execução do Auto-Teste
* O projeto possui uma suíte de testes com **mais de 260 testes automatizados** em `auto_teste.js`.
* Qualquer nova lógica ou alteração não pode quebrar testes existentes. Sempre oriente o usuário a rodar `node auto_teste.js` após qualquer modificação.

---

## 3. 📂 Arquitetura de Arquivos

```text
prefeitura/
├── index.html                   # Dashboard Principal (SPA com abas, modais, gráficos e KPIs)
├── app.js                       # Cérebro do sistema (>750 KB, lógica de negócios, Firestore e Excel)
├── chamado.html                 # Portal público mobile de chamado via QR Code (Canteiro e Casas)
├── limpeza.html                 # Portal público duplo de limpeza (com PIN da equipe e ouvidoria de operários)
├── ronda.html                   # Painel mobile de ronda para fiscais (banheiros e bebedouros com metas)
├── auto_teste.js                # Suíte de testes automatizados (Node.js) com 15 seções e 264+ asserções
├── sw.js                        # Service Worker para suporte PWA offline
├── manifest.json                # Manifesto PWA para instalação no celular
├── frontend/                    # ESPELHO OBRIGATÓRIO de deploy (index, app, chamado, limpeza, ronda, etc.)
│   ├── index.html
│   ├── app.js
│   ├── chamado.html
│   ├── limpeza.html
│   └── ronda.html
├── .agents/skills/              # Habilidades e agentes especializados do projeto
│   ├── agente-visual/SKILL.md
│   └── agente-funcionalidade/SKILL.md
└── GUIA_AGENTES_ESPECIALIZADOS.md
```

---

## 4. 🧠 Principais Módulos do Sistema

### A. Alojamentos e Leitos do Canteiro
* **Divisão Física:** Blocos 1 a 5 (Alvenaria com 2 andares, 48 quartos cada = 96 quartos/bloco), Prédios ADM e Blocos de Contêineres.
* **Padronização:** Quartos com capacidade padrão de 4 camas D33, armários individuais e ar-condicionado.
* **Gestão de Capacidade:** Permite desativar quartos para manutenção e alterar capacidades, recalculando automaticamente os KPIs.

### B. Casas na Cidade (Imóveis Urbanos Alugados)
* Cadastro de casas para liderança/engenharia com endereço, bairro, responsável e valor de aluguel.
* Divisão por cômodos (quartos, salas, etc.) e distribuição de camas.
* **Gestão de Contas & Concessionárias:**
  * Integração nativa com concessionárias de energia (Energisa, Enel, CPFL, etc.) e água (Sanesul, Sabesp, etc.).
  * Armazenamento de Código de Instalação/UC e Matrícula de Água com botão de cópia rápida em 1 clique e links diretos para agências virtuais de 2ª via de fatura.

### C. Rondas do Canteiro (Banheiros e Bebedouros)
* Controle de higienização de pontos com metas diárias (Banheiros: 2x/dia; Bebedouros: 1x/dia).
* Cálculo dinâmico de status: `PENDENTE`, `EM ANDAMENTO`, `EM DIA` e `PRECISA REPARO`.
* Geração e impressão de placas QR Code padrão A4 institucional.

### D. Chamados e Ouvidoria Pública
* Chamados abertos via celular sem necessidade de login.
* Suporte híbrido: chamado pode ser de Bloco/Quarto do canteiro ou Casa/Cômodo da cidade.
* Modo duplo de limpeza com barreira por PIN numérico para a equipe e formulário livre para reclamação do morador.

### E. Relatórios Oficiais em Excel (`.xlsx`)
* Função principal: `exportarPlanilhaOficial()`.
* Gera arquivo `controle_alojamento_oficial_taboca2.xlsx` com **6 abas executivas consolidadas**:
  1. `RESUMO DE OCUPAÇÃO`: Subtotal Canteiro + Subtotal Casas + Total Geral Consolidado (com fórmulas reais `SUM`, `+`, `-`, `/`).
  2. `MAPA DE CAMAS`: Todos os leitos físicos (canteiro + casas).
  3. `ALOJADOS ATIVOS`: Relação nominal completa dos moradores.
  4. `MÓVEIS E VISTORIAS`: Inventário patrimonial de quartos e casas.
  5. `DISTRIBUIÇÃO POR EMPRESA`: Participação percentual de cada terceirizada.
  6. `CASAS NA CIDADE`: Cadastro completo dos imóveis, aluguéis, cômodos e concessionárias de água/luz.
* Resumo Executivo: `exportarResumoExcel()` gerando `resumo_executivo_ocupacao_canteiro.xlsx`.

### F. Termos Oficiais em Folha A4 Institucional
* `gerarTermoAcomodacaoA4()`: Gera Ficha de Acomodação e Termo de Responsabilidade com layout oficial da GEL Engenharia, relação dos móveis entregues, regras de convivência e campos de assinatura.

---

## 5. 🗄️ Modelos de Dados (Estrutura do `dbState`)

O estado global fica centralizado em `StaticApiEngine.dbState` no `app.js`:

```javascript
// Estrutura simplificada do banco de dados na memória / Firestore:
dbState = {
  blocos: [
    { id: 1, nome: "Bloco 1", tipo: "alojamento", capacidade_total: 384 }
  ],
  quartos: [
    { id: 101, bloco_id: 1, numero: "01", capacidade: 4, ativo: true, status: "ativo" }
  ],
  vagas: [
    { id: 1011, quarto_id: 101, numero_cama: 1, status: "ocupada", alojado_id: "m_1" }
  ],
  alojados: [
    {
      id: "m_1",
      nome: "Carlos Eduardo",
      matricula: "10542",
      funcao: "Armador",
      empresa_id: 1,
      empresa_nome: "GEL Engenharia",
      quarto_id: 101,
      cama_numero: 1,
      status: "alojado",
      foto: "data:image/jpeg;base64,..."
    }
  ],
  empresas: [
    { id: 1, nome: "GEL Engenharia", cnpj: "..." }
  ],
  casas: [
    {
      id: "casa_1",
      nome: "Casa Engenharia 01",
      endereco: "Rua das Palmeiras, 120",
      bairro: "Centro",
      responsavel: "Eng. Marcos",
      aluguel_valor: 3500.00,
      energia_concessionaria: "energisa",
      energia_uc: "10/248590-2",
      agua_concessionaria: "sanesul",
      agua_matricula: "45892-01",
      comodos: [
        {
          id: "com_1",
          nome: "Quarto 1",
          tipo: "quarto",
          camas: 3,
          moradores: [ { id: "m_2", nome: "Marcos Lima", funcao: "Engenheiro" } ],
          moveis: [ { id: "mov_1", nome: "Ar-Condicionado 12.000 BTUs", estado: "Ótimo" } ]
        }
      ],
      despesas: [
        { id: "desp_1", categoria: "energia", valor: 450.00, vencimento: "2026-11-10", status: "pago" }
      ]
    }
  ],
  ronda_pontos: [
    { id: "p1", nome: "Banheiro KM 14", tipo: "banheiro", frequencia_diaria: 2 }
  ],
  ronda_registros: [
    { id: "reg_1", ponto_id: "p1", data: "2026-10-18", hora: "08:30", avaliacao: "Excelente" }
  ]
};
```

---

## 6. 🎨 Padrão de Design (Tailwind CSS)

* **Paleta Semântica:**
  * `slate-900` / `slate-950`: Fundo escuro padrão, headers e elementos corporativos.
  * `emerald-500` / `emerald-600`: Verde institucional da GEL Engenharia, botões de sucesso e exportações Excel.
  * `amber-500`: Ações executivas do Prefeito de Canteiro (cadastros principais).
  * `sky-600` / `blue-600`: Navegação, mapas e informações de quartos.
  * `rose-600` / `red-500`: Alertas de reparo urgente e exclusões.
* **Ergonomia de Campo:**
  * Botões mobile com altura mínima de 48px (`min-h-[48px]`).
  * Alto contraste em textos e badges.
  * Modais com cabeçalho e rodapé fixos (`sticky top` e `sticky bottom`) para evitar que botões sumam na rolagem em telas pequenas.

---

## 7. 🛠️ Como o ChatGPT Deve Sugerir Códigos

1. **Sempre indicar os dois arquivos:** Ao sugerir qualquer código para `app.js` ou `index.html`, lembre o usuário de replicar exatamente para `frontend/app.js` ou `frontend/index.html`.
2. **Fornecer trechos precisos com referências de busca:** Indique em qual função ou linha de código a alteração deve entrar (ex: *"Dentro da função `exportarPlanilhaOficial()`, procure pela linha X..."*).
3. **Preservar Comentários e Fórmulas:** Não apague fórmulas do Excel nem blocos existentes desnecessariamente.
4. **Validar com o Auto-Teste:** Finalize a instrução lembrando de executar:
   ```bash
   node auto_teste.js
   ```

---

## 8. 💬 Mensagem Pronta para Colar no ChatGPT

Copie e cole o texto abaixo no início da conversa com o ChatGPT para contextualizá-lo de imediato:

```text
Olá ChatGPT! Estou trabalhando no sistema "Prefeitura de Canteiro" da empresa GEL Engenharia (Obra Taboca 2), gerido pelo Tiago Vidal.
O sistema é um ERP em Vanilla JavaScript puro (sem React/Vue), HTML5 e Tailwind CSS, sincronizado com Firebase Firestore e rodando 100% offline-first.

Regras fundamentais do projeto que você DEVE respeitar:
1. PARIDADE DE CÓDIGO: Toda alteração feita na raiz (index.html, app.js, chamado.html, limpeza.html, ronda.html) deve ser replicada identicamente na pasta "frontend/" (frontend/app.js, frontend/index.html, etc.).
2. SEM FRAMEWORKS: Mantenha tudo em Vanilla JS puro e Tailwind CSS.
3. TESTES OBRIGATÓRIOS: O projeto possui uma suíte de testes em "auto_teste.js" com mais de 260 testes que devem passar sempre (node auto_teste.js).
4. Consulte sempre o arquivo INSTRUCOES_CHATGPT.md do projeto se precisar de detalhes de schemas ou funções existentes.

Estou pronto para enviar o que precisamos fazer agora. Confirme se entendeu as regras acima!
```
