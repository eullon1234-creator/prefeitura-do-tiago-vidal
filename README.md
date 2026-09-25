# 🏗️ Prefeitura de Canteiro - Controle de Alojamentos (Tiago Vidal)

> 🌐 **Link do Sistema Online (GitHub Pages):**  
> 👉 **[https://eullon1234-creator.github.io/prefeitura-do-tiago-vidal/](https://eullon1234-creator.github.io/prefeitura-do-tiago-vidal/)**

Sistema web completo para gestão, controle e fiscalização de alojamentos em canteiro de obras (baseado na estrutura oficial da **Obra Taboca 2**).

---

## 📱 Como Baixar / Instalar o Aplicativo (Celular e PC)
O sistema funciona como um **aplicativo nativo (PWA)** instalável com 1 clique:

* 🤖 **No Android (Google Chrome):**
  1. Abra o link do sistema no Chrome.
  2. Clique no botão **"Baixar App"** no topo da tela ou toque nos **3 pontinhos (⋮)** do Chrome.
  3. Escolha **"Instalar aplicativo"** ou **"Adicionar à tela inicial"**.
  4. O app terá seu próprio ícone na tela inicial e abrirá em tela cheia sem barras de navegador!

* 🍎 **No iPhone / iPad (Apple Safari):**
  1. Abra o link no Safari.
  2. Toque no botão de **Compartilhar** (ícone do quadrado com a seta para cima 📤).
  3. Role para cima e selecione **"Adicionar à Tela de Início"** ➕.
  4. Toque em **"Adicionar"**. O aplicativo funcionará como app nativo!

* 💻 **No Computador (PC / Windows / Mac):**
  1. Abra no Chrome ou Edge.
  2. Clique no botão **"Baixar App"** no topo ou no ícone de instalar na barra de endereços (ao lado dos favoritos).
  3. O aplicativo criará um atalho na área de trabalho e abrirá em janela própria e dedicada.

---

## ⚡ Economia Extrema de Dados e Modo Offline
* ⚡ **Cache Local no Aparelho (IndexedDB)**: As fotos e dados carregam com cache inteligente local no aparelho consumindo **0 KB** de dados após a visualização inicial.
* ☁️ **Nuvem Permanente ImgBB & Firebase**: Fotos salvas gratuitamente via ImgBB e dados sincronizados no Firebase Firestore (`prefeitura-cc71b`).
* 📶 **Offline First**: O Service Worker mantém o aplicativo utilizável mesmo em locais do canteiro de obras com sinal fraco ou sem internet.

## 💻 Como Iniciar no Computador Local (PC do Prefeito)

### Método Rápido (1 Clique):
Basta dar dois cliques no arquivo:
👉 **`iniciar_sistema.bat`**

O servidor Python/FastAPI será iniciado e seu navegador abrirá automaticamente em:
🔗 **http://localhost:8000**

### Ou via Linha de Comando (PowerShell / Terminal):
```bash
python -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

---

## 📊 Dados Iniciais do Canteiro (Planilha Taboca 2)

O banco de dados SQLite relacional (`alojamento.db`) e o snapshot estático contêm:

- **Total de Vagas/Camas:** 880
- **Alojados Ativos:** 387
- **Vagas Disponíveis:** 493 (44% de ocupação)
- **Quartos Cadastrados:** 220
- **Blocos Estruturados:** 10 blocos
  - *Alojamento Alvenaria:* Bloco 1, Bloco 2, Bloco 3, Bloco 4, Bloco 5
  - *Blocos ADM:* Bloco 1 ADM, Bloco 2 ADM, Bloco 3 ADM
  - *Módulos Contêiner:* Contêiner 1, Contêiner 2
- **Empresas Ativas:** GEL, FJ TERRAPLANAGEM, NUTRIVALE, ESTRELA DE MINAS, LUPATINI, ALPHASEG, CONCREQUALI, CARNEIRO METALÚRGICA, BRASILGUINDASTE.
- **Padrão Obrigatório dos Quartos:** Todos os 220 quartos com **2 Beliches**, **4 Armários com chave**, **1 Ar-Condicionado**, **4 Colchões D33**, lâmpadas LED e tomadas.

---

## 🛠️ Funcionalidades Principais

### 1. 📸 Edição e Recorte de Fotos (Cropper.js 1:1)
- Corte quadrado (1:1) com zoom, rotação e enquadramento automático do rosto do colaborador.
- Upload duplo: salvo localmente no PC (`uploads/fotos_alojados/`) e na nuvem gratuita do **ImgBB** (chave ativa, fotos permanentes).
- **Cache Local no Aparelho**: As fotos ficam salvas na memória interna do celular/PC para carregar em 0ms sem gastar internet no 4G/5G.

### 2. 🔠 Ajuste do Tamanho das Letras
- Seletor rápido de tipografia: **Pequeno (13.5px)**, **Padrão (15px)**, **Grande (17px)** e **Extra Grande (19px)**.
- Persistência no navegador via `localStorage`.

### 3. 📑 Exportação da Planilha Oficial (Modelo 100% Idêntico)
- Exporta a planilha com as **4 abas originais**: `BLOCOS ALOJAMENTO`, `BLOCOS ADM`, `RESUMO (2)` e `BLOCOS CONTÊINER`.
- Mesmas cores, fontes, larguras, colunas lado a lado e fórmulas originais com dados atualizados do banco.

### 4. 🔥 Integração Firebase Firestore com Economia Máxima de Dados
- **Documento Snapshot Único**: O canteiro inteiro é lido em 1 único documento (`canteiro_metadata/snapshot_canteiro`), consumindo apenas 1 leitura de 50.000 diárias (0,002% da cota gratuita).
- **Cache Offline Ativo**: IndexedDB mantém as informações no celular para acesso sem sinal de internet.

### 5. 🛏️ Gestão de Móveis, Bens & Vistorias
- Controle de estado de conservação: **Bom**, **Regular**, **Ruim** ou **Danificado**.
- Botão rápido para marcar reparos resolvidos.

---

## 📁 Estrutura do Projeto

```
prefeitura/
├── index.html                  # Interface Web Principal (GitHub Pages & Local)
├── app.js                      # Lógica do Frontend, Cache, ImgBB e Firebase
├── dados_iniciais_taboca.json  # Snapshot estático dos 387 alojados e 220 quartos
├── app.py                      # Backend FastAPI / Servidor REST Local
├── export_oficial.py           # Gerador da Planilha Oficial Taboca 2 (4 abas)
├── template_alojamento.xlsx    # Modelo original da planilha com formatação
├── import_data.py              # Script de importação e sincronização
├── init_db.py                  # Inicialização do banco SQLite
├── alojamento.db               # Banco de dados relacional
├── iniciar_sistema.bat         # Executável de 1 clique para iniciar no Windows
└── uploads/
    └── fotos_alojados/         # Armazenamento local das fotos no PC
```
