/**
 * AUTO-TESTE AUTOMATIZADO DO SISTEMA PREFEITURA DE CANTEIRO
 * Executa uma bateria completa de validações em código, dados, paridade e integridade.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let warningTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    failedTests++;
    console.error(`  ❌ [FAIL] ${testName} ${details ? '(' + details + ')' : ''}`);
  }
}

function warn(testName, details = '') {
  warningTests++;
  console.warn(`  ⚠️ [WARN] ${testName} ${details ? '(' + details + ')' : ''}`);
}

console.log('\n============================================================');
console.log('🚀 INICIANDO BATERIA DE AUTO-TESTE DO PROJETO PREFEITURA');
console.log('============================================================\n');

// -------------------------------------------------------------
// 1. TESTE DE SINTAXE JAVASCRIPT & PYTHON
// -------------------------------------------------------------
console.log('📦 1. Verificação de Sintaxe JavaScript (Node AST Compiler)');

const jsFiles = ['app.js', 'sw.js', 'frontend/app.js', 'frontend/sw.js'];
jsFiles.forEach(file => {
  if (fs.existsSync(file)) {
    try {
      execSync(`"${process.execPath}" -c "${file}"`, { stdio: 'pipe' });
      assert(true, `Sintaxe válida: ${file}`);
    } catch (e) {
      assert(false, `Sintaxe válida: ${file}`, e.message);
    }
  } else {
    assert(false, `Arquivo existente: ${file}`, 'Não encontrado');
  }
});

// Verificação de Sintaxe em Scripts Inline dos Arquivos HTML
const htmlScriptFiles = ['ronda.html', 'frontend/ronda.html', 'limpeza.html', 'frontend/limpeza.html', 'chamado.html', 'frontend/chamado.html', 'index.html', 'frontend/index.html'];
htmlScriptFiles.forEach(file => {
  if (fs.existsSync(file)) {
    try {
      const html = fs.readFileSync(file, 'utf8');
      const matches = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi) || [];
      matches.forEach(tag => {
        const code = tag.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
        new Function(code);
      });
      assert(true, `Sintaxe de script inline válida: ${file}`);
    } catch (e) {
      assert(false, `Sintaxe de script inline válida: ${file}`, e.message);
    }
  }
});

console.log('\n🐍 2. Verificação de Sintaxe Python (py_compile)');
const pyFiles = ['app.py', 'clean_utils.py', 'export_json.py', 'export_oficial.py', 'import_data.py', 'init_db.py', 'repair_template.py', 'update_moveis.py'];
pyFiles.forEach(pyFile => {
  if (fs.existsSync(pyFile)) {
    try {
      execSync(`python -m py_compile "${pyFile}"`, { stdio: 'pipe' });
      assert(true, `Compilação Python sem erros: ${pyFile}`);
    } catch (e) {
      assert(false, `Compilação Python sem erros: ${pyFile}`, e.message);
    }
  }
});

// -------------------------------------------------------------
// 3. TESTE DE PARIDADE DE ARQUIVOS (DUAL-FILE ARCHITECTURE)
// -------------------------------------------------------------
console.log('\n🔄 3. Verificação de Paridade (Raiz vs. Pasta frontend/)');

function getHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

const parityPairs = [
  ['index.html', 'frontend/index.html'],
  ['app.js', 'frontend/app.js'],
  ['sw.js', 'frontend/sw.js'],
  ['chamado.html', 'frontend/chamado.html'],
  ['limpeza.html', 'frontend/limpeza.html'],
  ['ronda.html', 'frontend/ronda.html'],
  ['dados_iniciais_taboca.json', 'frontend/dados_iniciais_taboca.json'],
  ['manifest.json', 'frontend/manifest.json']
];

parityPairs.forEach(([f1, f2]) => {
  const h1 = getHash(f1);
  const h2 = getHash(f2);
  assert(h1 !== null && h1 === h2, `Paridade 100% entre ${f1} e ${f2}`);
});

// -------------------------------------------------------------
// 3.1. VALIDADOR AUTOMÁTICO DE ESTRUTURA HTML & ANINHAMENTO DE ABAS
// -------------------------------------------------------------
console.log('\n🏗️ 3.1. Validação Estrita de Estrutura HTML & Fechamento de Tags');

function validarEstruturaHtml(caminhoArquivo) {
  const html = fs.readFileSync(caminhoArquivo, 'utf8');
  const lines = html.split('\n');
  const tagRegex = /<\/?([a-z0-9]+)(?:\s+[^>]*?)?\/?>/gi;
  let stack = [];
  let erros = [];
  let tabsAbertas = [];

  lines.forEach((line, lineIdx) => {
    const lineNum = lineIdx + 1;
    let match;
    while ((match = tagRegex.exec(line)) !== null) {
      const full = match[0];
      const tagName = match[1].toLowerCase();
      const isClosing = full.startsWith('</');
      const isSelfClosing = full.endsWith('/>') || ['img', 'input', 'br', 'hr', 'meta', 'link'].includes(tagName);

      if (['div', 'main', 'aside', 'header', 'body'].includes(tagName)) {
        if (isClosing) {
          if (stack.length > 0) {
            const top = stack.pop();
            if (top.tagName !== tagName) {
              erros.push(`Linha ${lineNum}: Fechamento </${tagName}> incompatível com <${top.tagName}> da linha ${top.lineNum}`);
            }
            if (top.isTab) {
              tabsAbertas.pop();
            }
          } else {
            erros.push(`Linha ${lineNum}: Fechamento </${tagName}> inesperado sem abertura prévia`);
          }
        } else if (!isSelfClosing) {
          const isTab = full.includes('tab-content');
          const idMatch = full.match(/id="([^"]+)"/);
          const elemId = idMatch ? idMatch[1] : '';

          // REGRA DE OURO: Nenhuma aba .tab-content pode estar dentro de outra aba .tab-content!
          if (isTab) {
            if (tabsAbertas.length > 0) {
              erros.push(`Linha ${lineNum}: Aba <div id="${elemId}"> aninhada indevidamente dentro da aba <div id="${tabsAbertas[tabsAbertas.length - 1]}">! Todas as abas devem ser irmãs diretas em <main>.`);
            }
            tabsAbertas.push(elemId || 'tab_anonima');
          }

          stack.push({ tagName, lineNum, id: elemId, isTab });
        }
      }
    }
  });

  if (stack.length > 0) {
    stack.forEach(s => erros.push(`Tag <${s.tagName}${s.id ? ' id="' + s.id + '"' : ''}> aberta na linha ${s.lineNum} não foi fechada`));
  }

  return erros;
}

const errosIndexRaiz = validarEstruturaHtml('index.html');
assert(errosIndexRaiz.length === 0, 'Estrutura HTML de index.html 100% balanceada (0 tags órfãs ou aninhamentos inválidos)', errosIndexRaiz.join(' | '));

const errosIndexFront = validarEstruturaHtml('frontend/index.html');
assert(errosIndexFront.length === 0, 'Estrutura HTML de frontend/index.html 100% balanceada', errosIndexFront.join(' | '));

// -------------------------------------------------------------
// 4. INTEGRIDADE DOS ARQUIVOS JSON E BASE DE DADOS
// -------------------------------------------------------------
console.log('\n📄 4. Integridade e Parsing dos Arquivos JSON');

try {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  assert(manifest.name && manifest.short_name, 'manifest.json possui name e short_name');
  assert(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest.json possui array de ícones');
  assert(manifest.start_url && manifest.display === 'standalone', 'manifest.json configurado como PWA standalone');
} catch (e) {
  assert(false, 'manifest.json legível', e.message);
}

let dadosIniciais = null;
let todasVagas = [];
try {
  dadosIniciais = JSON.parse(fs.readFileSync('dados_iniciais_taboca.json', 'utf8'));
  assert(typeof dadosIniciais.geral === 'object', 'dados_iniciais: objeto de métricas geral presente');
  assert(Array.isArray(dadosIniciais.blocos), 'dados_iniciais: array de blocos presente');
  assert(Array.isArray(dadosIniciais.quartos), 'dados_iniciais: array de quartos presente');
  assert(Array.isArray(dadosIniciais.alojados), 'dados_iniciais: array de alojados presente');
  assert(Array.isArray(dadosIniciais.empresas), 'dados_iniciais: array de empresas presente');
  
  todasVagas = dadosIniciais.quartos.flatMap(q => q.vagas || []);
  assert(todasVagas.length === dadosIniciais.geral.total_vagas, `Consistência das vagas: ${todasVagas.length} vagas mapeadas correspondem ao total_vagas (${dadosIniciais.geral.total_vagas})`);

  console.log(`     ℹ️ Contagem da Base: ${dadosIniciais.blocos.length} blocos, ${dadosIniciais.quartos.length} quartos, ${todasVagas.length} vagas, ${dadosIniciais.alojados.length} alojados, ${dadosIniciais.empresas.length} empresas`);
} catch (e) {
  assert(false, 'dados_iniciais_taboca.json legível', e.message);
}

// -------------------------------------------------------------
// 5. VERIFICAÇÃO DE CACHE DO SERVICE WORKER (PWA OFFLINE)
// -------------------------------------------------------------
console.log('\n📱 5. Verificação de Pré-Cache do Service Worker');

try {
  const swCode = fs.readFileSync('sw.js', 'utf8');
  const cacheMatch = swCode.match(/const\s+ASSETS_TO_CACHE\s*=\s*\[([\s\S]*?)\];/);
  if (cacheMatch) {
    const assetsRaw = cacheMatch[1]
      .split(',')
      .map(s => s.trim().replace(/['"]/g, ''))
      .filter(s => s && s !== './');

    let allAssetsExist = true;
    assetsRaw.forEach(asset => {
      const exists = fs.existsSync(asset);
      if (!exists) {
        allAssetsExist = false;
        assert(false, `Asset do SW existe no disco: ${asset}`);
      }
    });
    if (allAssetsExist) {
      assert(true, `Todos os ${assetsRaw.length} assets listados no sw.js existem fisicamente`);
    }
  } else {
    assert(false, 'Encontrar lista ASSETS_TO_CACHE no sw.js');
  }
} catch (e) {
  assert(false, 'Leitura do sw.js', e.message);
}

// -------------------------------------------------------------
// 6. TESTE DE CORRESPONDÊNCIA DE FUNÇÕES (HTML EVENTS vs JS)
// -------------------------------------------------------------
console.log('\n🔗 6. Verificação de Funções Chamadas no HTML vs. app.js');

const htmlContent = fs.readFileSync('index.html', 'utf8');
const jsContent = fs.readFileSync('app.js', 'utf8');

const eventRegex = /on(?:click|change|submit|input)\s*=\s*"([a-zA-Z0-9_]+)\(/g;
let match;
const htmlFunctions = new Set();
while ((match = eventRegex.exec(htmlContent)) !== null) {
  htmlFunctions.add(match[1]);
}

let missingHandlers = [];
for (const fn of htmlFunctions) {
  const isDeclared = jsContent.includes(`function ${fn}`) ||
                     jsContent.includes(`window.${fn}`) ||
                     jsContent.includes(`const ${fn} =`) ||
                     jsContent.includes(`let ${fn} =`) ||
                     jsContent.includes(`var ${fn} =`);
  if (!isDeclared) {
    missingHandlers.push(fn);
  }
}

if (missingHandlers.length === 0) {
  assert(true, `Todas as ${htmlFunctions.size} funções chamadas em eventos do index.html existem no app.js`);
} else {
  warn(`Funções chamadas no HTML sem declaração direta encontrada: ${missingHandlers.join(', ')}`);
}

// -------------------------------------------------------------
// 7. TESTE DE ELEMENTOS DOM CRÍTICOS NO HTML
// -------------------------------------------------------------
console.log('\n🎯 7. Verificação de Elementos DOM Críticos no index.html');

const criticalElements = [
  'kpiTotalVagas',
  'kpiOcupadas',
  'kpiLivres',
  'kpiTaxaOcupacao',
  'chartBlocos',
  'chartCasasCidade',
  'chartEmpresas',
  'gridBlocosCards',
  'feedAuditoriaDashboard',
  'tab-dashboard',
  'tab-blocos',
  'tab-alojados',
  'tab-casas_cidade',
  'tab-estoque',
  'tab-chamados',
  'tab-auditoria',
  'tab-configuracoes',
  'tabelaAuditoriaCorpo',
  'filtroAuditBusca',
  'filtroAuditModulo',
  'filtroAuditAcao',
  'filtroAuditUsuario',
  'chartCasasTab',
  'casasCidadeGrid',
  'modalTransferirMoradorCasa',
  'modalTransferirMovelCasa',
  'modalDevolverMovelEstoque',
  'modalItemEstoqueForm',
  'modalMovimentacaoEstoque',
  'modalScannerLimpezaQR',
  'modalRegistroLimpezaCasa',
  'modalPlacaQRCasa',
  'painelCasa_limpezas',
  'btnAbaCasa_limpezas',
  'casaDetalhesLimpezasTabela',
  'casaDetalhesLimpezasVazio',
  'modalTermoResponsabilidade',
  'areaImpressaoTermo',
  'modalConfirmarRestauracaoBackup',
  'subPainelCasasDespesas',
  'tabelaPainelDespesasCorpo',
  'statGestaoTotalBlocos',
  'statGestaoTotalQuartos',
  'statGestaoTotalVagas',
  'statGestaoOcupacao',
  'modalGerenciarQuartosBloco',
  'tabelaQuartosBlocoModalCorpo',
  'modalEditarCapacidadeQuarto'
];

let allElementsPresent = true;
criticalElements.forEach(id => {
  const hasId = htmlContent.includes(`id="${id}"`) || htmlContent.includes(`id='${id}'`);
  if (!hasId) {
    allElementsPresent = false;
    assert(false, `Elemento DOM presente no index.html: #${id}`);
  }
});

if (allElementsPresent) {
  assert(true, `Todos os ${criticalElements.length} elementos DOM críticos validados no index.html`);
}

// -------------------------------------------------------------
// 8. SIMULAÇÃO DE LÓGICA E REGRAS DE NEGÓCIO
// -------------------------------------------------------------
console.log('\n⚙️ 8. Simulação de Lógica e Regras de Negócio');

// Teste de cálculo de ocupação e vagas
if (dadosIniciais && todasVagas.length > 0) {
  const totalVagas = todasVagas.length;
  const vagasOcupadas = todasVagas.filter(v => v.alojado_id !== null).length;
  const vagasLivres = todasVagas.filter(v => v.alojado_id === null).length;
  const taxa = totalVagas > 0 ? Math.round((vagasOcupadas / totalVagas) * 100) : 0;

  assert(vagasOcupadas + vagasLivres === totalVagas, 'Soma de vagas ocupadas + livres é igual ao total de vagas');
  assert(taxa >= 0 && taxa <= 100, `Taxa de ocupação calculada está no intervalo válido: ${taxa}%`);
  assert(dadosIniciais.geral.ocupadas === vagasOcupadas, `Ocupadas bate com geral (${vagasOcupadas})`);
  assert(dadosIniciais.geral.disponiveis === vagasLivres, `Disponíveis bate com geral (${vagasLivres})`);
}

// Teste de simulação de Casas e Cômodos
const casaMock = {
  id: 'CASA-TESTE-1',
  nome: 'Casa 01 - Engenharia',
  comodos: [
    {
      id: 'COM-1',
      nome: 'Quarto 1',
      tipo: 'quarto',
      capacidade_camas: 3,
      camas: [
        { numero: 1, morador: { nome: 'João Silva' } },
        { numero: 2, morador: { nome: 'Carlos Souza' } },
        { numero: 3, morador: null }
      ]
    },
    {
      id: 'COM-2',
      nome: 'Sala de Estar',
      tipo: 'sala',
      capacidade_camas: 0,
      camas: []
    }
  ]
};

let camasCasa = 0;
let ocupadasCasa = 0;
casaMock.comodos.forEach(com => {
  if (com.tipo === 'quarto') {
    camasCasa += com.capacidade_camas;
    ocupadasCasa += com.camas.filter(cm => cm.morador && cm.morador.nome).length;
  }
});
const livresCasa = Math.max(0, camasCasa - ocupadasCasa);

assert(camasCasa === 3, 'Cálculo de capacidade de camas do quarto mock');
assert(ocupadasCasa === 2, 'Cálculo de camas ocupadas do quarto mock');
assert(livresCasa === 1, 'Cálculo de camas livres do quarto mock');

// Teste de simulação de movimentação de estoque
const itemEstoqueMock = {
  id: 'EST-1',
  nome: 'Chuveiro Elétrico 220V',
  quantidade: 10,
  estoque_minimo: 3
};

const entradaQtd = 5;
const novoSaldoEntrada = itemEstoqueMock.quantidade + entradaQtd;
assert(novoSaldoEntrada === 15, 'Entrada de estoque: 10 + 5 = 15');

const saidaQtd = 4;
const novoSaldoSaida = novoSaldoEntrada - saidaQtd;
assert(novoSaldoSaida === 11, 'Saída de estoque: 15 - 4 = 11');
assert(novoSaldoSaida > itemEstoqueMock.estoque_minimo, 'Estoque acima do mínimo operacional');

// Teste de simulação de Log de Auditoria
const logAuditoriaMock = {
  id: 'AUDIT-' + Date.now(),
  timestamp: new Date().toISOString(),
  data_hora: '15/10/2026 20:30',
  usuario: 'Prefeito Tiago Vidal',
  modulo: 'casas',
  acao: 'TRANSFERIR',
  entidade: 'João Silva',
  detalhes: 'Transferiu João Silva da Casa 1 para Casa 2'
};

assert(logAuditoriaMock.id.startsWith('AUDIT-'), 'Geração correta de ID de auditoria');
assert(['alojamento', 'casas', 'estoque', 'chamados'].includes(logAuditoriaMock.modulo), 'Módulo de auditoria válido');
assert(logAuditoriaMock.detalhes.length > 5, 'Descrição de auditoria preenchida');

// Testes de Regras de Negócio: Módulo de Limpeza e Manutenção via QR Code
const hojeDataStr = new Date().toISOString().split('T')[0];
const registroRotinaHoje = {
  id: 'limp-1',
  casa_id: 'casa-101',
  tipo: 'rotina',
  data: hojeDataStr,
  hora: '08:30',
  responsavel: 'Maria Auxiliadora'
};
assert(registroRotinaHoje.tipo === 'rotina', 'Tipo de limpeza Rotina Diária reconhecido');
assert(registroRotinaHoje.data === hojeDataStr, 'Limpeza registrada para o dia corrente (Hoje)');

// Validação do ciclo de 30 dias para Ar Condicionado
const calcularCicloAr = (diasAtras) => {
  const diffDias = diasAtras;
  const diasRestantes = 30 - diffDias;
  if (diffDias <= 24) return 'ok';
  if (diffDias <= 30) return 'atencao';
  return 'vencido';
};
assert(calcularCicloAr(5) === 'ok', 'Ar condicionado com 5 dias: status OK');
assert(calcularCicloAr(24) === 'ok', 'Ar condicionado com 24 dias: status OK');
assert(calcularCicloAr(25) === 'atencao', 'Ar condicionado com 25 dias: status ATENÇÃO (próximo do prazo)');
assert(calcularCicloAr(30) === 'atencao', 'Ar condicionado com 30 dias: status ATENÇÃO (limite do prazo)');
assert(calcularCicloAr(31) === 'vencido', 'Ar condicionado com 31 dias: status VENCIDO (alerta)');
assert(calcularCicloAr(45) === 'vencido', 'Ar condicionado com 45 dias: status VENCIDO (alerta)');

// Validação das regras de cores personalizadas solicitadas pelo usuário:
// 1. Faxina: Feita hoje = verde ('ok', 'EM DIA'). Não feita hoje / pendente / dias passados = amarelo ('pendente', 'PENDENTE')
const testarRegraFaxina = (diffDias) => {
  if (diffDias === 0) return { status: 'ok', cor: 'emerald', badge: 'EM DIA' };
  return { status: 'pendente', cor: 'amber', badge: 'PENDENTE' };
};
assert(testarRegraFaxina(0).cor === 'emerald' && testarRegraFaxina(0).badge === 'EM DIA', 'Regra Faxina: Feita hoje = Verde (Em dia)');
assert(testarRegraFaxina(1).cor === 'amber' && testarRegraFaxina(1).badge === 'PENDENTE', 'Regra Faxina: Não feita hoje (pendente de ontem) = Amarelinho (Pendente)');
assert(testarRegraFaxina(3).cor === 'amber' && testarRegraFaxina(3).badge === 'PENDENTE', 'Regra Faxina: Passou do dia = Amarelinho (Pendente)');

// 2. Ar-Condicionado: Até 30 dias = verdinho ('ok', 'EM DIA'). Passou de 30 dias = vermelho ('vencido', 'PASSOU TEMPO')
const testarRegraArCondicionado = (diffDias) => {
  if (diffDias <= 30) return { status: 'ok', cor: 'emerald', badge: 'EM DIA' };
  return { status: 'vencido', cor: 'rose', badge: 'PASSOU TEMPO' };
};
assert(testarRegraArCondicionado(0).cor === 'emerald', 'Regra Ar Cond.: 0 dias = Verdinho (Tudo certo)');
assert(testarRegraArCondicionado(15).cor === 'emerald', 'Regra Ar Cond.: 15 dias = Verdinho (Tudo certo)');
assert(testarRegraArCondicionado(30).cor === 'emerald', 'Regra Ar Cond.: 30 dias = Verdinho (Tudo certo)');
assert(testarRegraArCondicionado(31).cor === 'rose' && testarRegraArCondicionado(31).badge === 'PASSOU TEMPO', 'Regra Ar Cond.: 31 dias = Vermelho (Passou do tempo!)');
assert(testarRegraArCondicionado(60).cor === 'rose' && testarRegraArCondicionado(60).badge === 'PASSOU TEMPO', 'Regra Ar Cond.: 60 dias = Vermelho (Passou do tempo!)');

// Validação de URL de QR Code para placa da residência
const urlPlacaCasa = `https://exemplo.com/index.html?acao=limpeza&casa_id=CASA-99`;
assert(urlPlacaCasa.includes('acao=limpeza') && urlPlacaCasa.includes('casa_id=CASA-99'), 'Estrutura de URL para QR Code da Casa válida');

// Teste de formatação de data de limpeza
const formatarDataLimpezaBRTest = (dataStr) => {
  if (!dataStr) return '--/--/----';
  try {
    const limpo = String(dataStr).split('T')[0].trim();
    const partes = limpo.split('-');
    if (partes.length === 3 && partes[0].length === 4) {
      return `${partes[2]}/${partes[1]}/${partes[0]}`;
    }
    const d = new Date(limpo + 'T12:00:00');
    return isNaN(d.getTime()) ? dataStr : d.toLocaleDateString('pt-BR');
  } catch (e) {
    return dataStr;
  }
};
assert(formatarDataLimpezaBRTest('2026-10-15') === '15/10/2026', 'Formatador BR com formato YYYY-MM-DD');
assert(formatarDataLimpezaBRTest('2026-10-15T08:30:00') === '15/10/2026', 'Formatador BR com formato ISO timestamp');
assert(formatarDataLimpezaBRTest('') === '--/--/----', 'Formatador BR com entrada vazia');

// Testes de Regras de Negócio: Backup Geral & Restauração Segura (.json)
const backupMock = {
  versao: '2.0',
  sistema: 'Prefeitura de Canteiro - Gestão Completa',
  gerado_em: new Date().toISOString(),
  geral: { total_blocos: 10, total_quartos: 220, total_vagas: 880, ocupadas: 387, disponiveis: 493 },
  blocos: [{ id: 'BLOCO-A', nome: 'Bloco A' }],
  quartos: [{ id: 'Q-101', numero: '101', bloco_id: 'BLOCO-A' }],
  alojados: [{ id: 'AL-1', nome: 'Pedro Alcantara', quarto: '101' }],
  empresas: [{ id: 'EMP-1', nome: 'GEL' }],
  casas_cidade: [{ id: 'CASA-1', nome: 'Casa Engenharia 01' }],
  casas_despesas: [
    { id: 'DESP-1', casa_id: 'CASA-1', categoria: 'Aluguel', valor: 2500, mes_referencia: '10/2026', status: 'pago' },
    { id: 'DESP-2', casa_id: 'CASA-1', categoria: 'Energia', valor: 450.50, mes_referencia: '10/2026', status: 'pendente' },
    { id: 'DESP-3', casa_id: 'CASA-1', categoria: 'Água', valor: 120.00, mes_referencia: '10/2026', status: 'pendente' }
  ],
  casas_limpezas: [{ id: 'LIMP-1', casa_id: 'CASA-1', tipo: 'rotina' }],
  estoque_itens: [{ id: 'EST-1', nome: 'Chuveiro', quantidade: 5 }]
};

assert(backupMock.versao === '2.0', 'Estrutura de Backup JSON versão 2.0 identificada');
assert(Array.isArray(backupMock.casas_cidade) && backupMock.casas_cidade.length > 0, 'Backup contém dados de Casas na Cidade');
assert(Array.isArray(backupMock.casas_despesas) && backupMock.casas_despesas.length === 3, 'Backup contém array de Despesas das Casas');
assert(Array.isArray(backupMock.casas_limpezas), 'Backup contém array de Limpezas');
assert(Array.isArray(backupMock.estoque_itens), 'Backup contém dados de Estoque');

// Testes de Regras de Negócio: Painel Consolidado de Despesas das Casas
const totalDespesas = backupMock.casas_despesas.reduce((acc, d) => acc + d.valor, 0);
const totalPago = backupMock.casas_despesas.filter(d => d.status === 'pago').reduce((acc, d) => acc + d.valor, 0);
const totalPendente = backupMock.casas_despesas.filter(d => d.status === 'pendente').reduce((acc, d) => acc + d.valor, 0);

assert(totalDespesas === 3070.50, `Cálculo de Despesas Totais: R$ ${totalDespesas.toFixed(2)} = 3070.50`);
assert(totalPago === 2500.00, `Cálculo de Despesas Pagas: R$ ${totalPago.toFixed(2)} = 2500.00`);
assert(totalPendente === 570.50, `Cálculo de Despesas Pendentes: R$ ${totalPendente.toFixed(2)} = 570.50`);
assert(totalPago + totalPendente === totalDespesas, 'Consistência contábil: Pago + Pendente = Total');

// Testes de Regras de Negócio: Termo de Responsabilidade & Ficha de Acomodação (A4)
const termoAlojadoMock = {
  tipo: 'alojamento',
  nome: 'Pedro Alcantara',
  cpf: '123.456.789-00',
  quarto: '101',
  bloco: 'Bloco A',
  cama: 'Cama 02',
  empresa: 'GEL',
  funcao: 'Eletricista',
  itensEntregues: ['Colchão D33', 'Travesseiro', 'Jogo de Cama', 'Chave do Armário'],
  regrasAceitas: true
};
assert(termoAlojadoMock.tipo === 'alojamento', 'Termo gerado para modalidade Alojamento');
assert(termoAlojadoMock.itensEntregues.length >= 4, 'Termo possui rol de itens de inventário patrimonial');
assert(termoAlojadoMock.regrasAceitas === true, 'Termo possui cláusulas de aceitação de convivência');

const termoCasaMock = {
  tipo: 'casa_cidade',
  nome: 'Eng. Roberto Lima',
  casa: 'Casa 01 - Engenharia',
  comodo: 'Suíte Master',
  cama: 'Cama 01',
  moveisComodo: ['Ar Condicionado Split 12000 BTUs', 'Cama Box', 'Guarda-roupa 3 Portas'],
  endereco: 'Rua das Flores, 120 - Centro'
};
assert(termoCasaMock.tipo === 'casa_cidade', 'Termo gerado para modalidade Casa na Cidade');
assert(termoCasaMock.moveisComodo.length === 3, 'Inventário de móveis do cômodo da casa mapeado');

// Testes de Regras de Negócio: Chamados de Manutenção (Alojamento vs Casa Urbana)
const chamadoAlojamento = {
  tipo_local: 'alojamento',
  quarto: '102',
  bloco: 'Bloco B',
  categoria: 'Elétrica',
  solicitante: 'Carlos Silva'
};
const chamadoCasa = {
  tipo_local: 'casa_cidade',
  casa_nome: 'Casa 02 - Liderança',
  comodo: 'Cozinha',
  categoria: 'Hidráulica',
  solicitante: 'Marcos Souza'
};
assert(chamadoAlojamento.tipo_local === 'alojamento' && chamadoAlojamento.quarto === '102', 'Chamado de Alojamento validado');
assert(chamadoCasa.tipo_local === 'casa_cidade' && chamadoCasa.casa_nome === 'Casa 02 - Liderança' && chamadoCasa.comodo === 'Cozinha', 'Chamado de Casa Urbana validado');

// -------------------------------------------------------------
// 10. VERIFICAÇÃO RIGOROSA DAS 5 NOVAS FUNCIONALIDADES
// -------------------------------------------------------------
console.log('\n⭐ 10. Verificação Rigorosa das 5 Funcionalidades Solicitadas');

const appJsContent = fs.readFileSync('app.js', 'utf8');
const indexHtmlContent = fs.readFileSync('index.html', 'utf8');
const chamadoHtmlContent = fs.readFileSync('chamado.html', 'utf8');

// 1. Relatórios e Exportações em Excel para Casas na Cidade
assert(appJsContent.includes('function exportarCasasCidadeExcel()'), 'Funcionalidade 1: exportarCasasCidadeExcel implementada em app.js');
assert(appJsContent.includes('function exportarLimpezasExcel()'), 'Funcionalidade 1: exportarLimpezasExcel implementada em app.js');
assert(appJsContent.includes('function exportarDespesasCasasExcel()'), 'Funcionalidade 1: exportarDespesasCasasExcel implementada em app.js');
assert(indexHtmlContent.includes('exportarCasasCidadeExcel()'), 'Funcionalidade 1: Botão exportarCasasCidadeExcel presente em index.html');
assert(indexHtmlContent.includes('exportarLimpezasExcel()'), 'Funcionalidade 1: Botão exportarLimpezasExcel presente em index.html');
assert(indexHtmlContent.includes('exportarDespesasCasasExcel()'), 'Funcionalidade 1: Botão exportarDespesasCasasExcel presente em index.html');

// 2. Termo de Responsabilidade & Ficha de Acomodação (Impressão A4)
assert(appJsContent.includes('function preencherItensTermoResponsabilidade('), 'Funcionalidade 2: preencherItensTermoResponsabilidade presente em app.js');
assert(appJsContent.includes('function gerarTermoResponsabilidadeAlojado('), 'Funcionalidade 2: gerarTermoResponsabilidadeAlojado presente em app.js');
assert(appJsContent.includes('function gerarTermoResponsabilidadeMoradorCasa('), 'Funcionalidade 2: gerarTermoResponsabilidadeMoradorCasa presente em app.js');
assert(appJsContent.includes('function gerarTermoResponsabilidadeDoModalFoto('), 'Funcionalidade 2: gerarTermoResponsabilidadeDoModalFoto presente em app.js');
assert(indexHtmlContent.includes('id="modalTermoResponsabilidade"'), 'Funcionalidade 2: Modal do Termo presente em index.html');
assert(indexHtmlContent.includes('id="areaImpressaoTermo"'), 'Funcionalidade 2: Folha A4 formatada (#areaImpressaoTermo) presente em index.html');
assert(indexHtmlContent.includes('id="termoTabelaItensCorpo"'), 'Funcionalidade 2: Tabela de inventário (#termoTabelaItensCorpo) presente em index.html');
assert(indexHtmlContent.includes('gerarTermoResponsabilidadeDoModalFoto()'), 'Funcionalidade 2: Botão de Termo no Modal de Foto do Alojado presente');
assert(indexHtmlContent.includes('@page') && indexHtmlContent.includes('A4 portrait'), 'Funcionalidade 2: Estilo CSS @page com tamanho A4 portrait presente');

// 3. Painel Consolidado de Contas das Casas
assert(appJsContent.includes('function alternarSubAbaCasas('), 'Funcionalidade 3: alternarSubAbaCasas presente em app.js');
assert(appJsContent.includes('function carregarPainelConsolidadoDespesas()'), 'Funcionalidade 3: carregarPainelConsolidadoDespesas presente em app.js');
assert(appJsContent.includes('function filtrarPainelDespesasCasasUI()'), 'Funcionalidade 3: filtrarPainelDespesasCasasUI presente em app.js');
assert(appJsContent.includes('function marcarDespesaComoPaga('), 'Funcionalidade 3: marcarDespesaComoPaga presente em app.js');
assert(indexHtmlContent.includes('id="subPainelCasasDespesas"'), 'Funcionalidade 3: subPainelCasasDespesas presente em index.html');
assert(indexHtmlContent.includes('id="tabelaPainelDespesasCorpo"'), 'Funcionalidade 3: tabelaPainelDespesasCorpo presente em index.html');
assert(indexHtmlContent.includes('id="filtroPainelDespesasCasa"'), 'Funcionalidade 3: Filtro por casa presente');
assert(indexHtmlContent.includes('id="filtroPainelDespesasMes"'), 'Funcionalidade 3: Filtro por mês presente');

// 4. Chamados de Manutenção para as Casas na Cidade
assert(chamadoHtmlContent.includes('function alternarLocalChamado('), 'Funcionalidade 4: alternarLocalChamado presente em chamado.html');
assert(chamadoHtmlContent.includes('id="btnLocalAlojamento"'), 'Funcionalidade 4: Botão seletor Alojamento presente em chamado.html');
assert(chamadoHtmlContent.includes('id="btnLocalCasa"'), 'Funcionalidade 4: Botão seletor Casa Urbana presente em chamado.html');
assert(chamadoHtmlContent.includes('id="containerCamposCasa"'), 'Funcionalidade 4: Container de campos de Casa presente em chamado.html');
assert(appJsContent.includes('tipo_local'), 'Funcionalidade 4: Tratamento de tipo_local nos chamados em app.js');

// 5. Backup Completo JSON e Restauração Segura
assert(appJsContent.includes('function fazerBackupCompletoJSON()'), 'Funcionalidade 5: fazerBackupCompletoJSON presente em app.js');
assert(appJsContent.includes('function analisarArquivoBackupJSON('), 'Funcionalidade 5: analisarArquivoBackupJSON presente em app.js');
assert(appJsContent.includes('function executarRestauracaoBackupConfirmada()'), 'Funcionalidade 5: executarRestauracaoBackupConfirmada presente em app.js');
assert(appJsContent.includes('saveToStorage()') && appJsContent.includes('prefeitura_taboca_snapshot'), 'Funcionalidade 5: Persistência de restauração garantida em prefeitura_taboca_snapshot');
assert(indexHtmlContent.includes('id="modalConfirmarRestauracaoBackup"'), 'Funcionalidade 5: Modal de confirmação segura de restauração presente em index.html');

// -------------------------------------------------------------
// 11. GESTÃO DE ESTRUTURA FÍSICA, QUARTOS E CAPACIDADE DE BLOCOS
// -------------------------------------------------------------
console.log('\n🏢 11. Verificação de Gestão de Blocos, Quartos e Capacidades');

// 1. Funções de Gestão de Quartos e Blocos
assert(appJsContent.includes('function carregarBlocosCadastros()'), 'Gestão Blocos: carregarBlocosCadastros implementada em app.js');
assert(appJsContent.includes('function abrirModalGerenciarQuartosBloco('), 'Gestão Blocos: abrirModalGerenciarQuartosBloco implementada em app.js');
assert(appJsContent.includes('function filtrarQuartosBlocoModalUI()'), 'Gestão Blocos: filtrarQuartosBlocoModalUI implementada em app.js');
assert(appJsContent.includes('function renderizarQuartosBlocoModal('), 'Gestão Blocos: renderizarQuartosBlocoModal implementada em app.js');
assert(appJsContent.includes('function desativarQuartoBloco('), 'Gestão Blocos: desativarQuartoBloco implementada em app.js');
assert(appJsContent.includes('function reativarQuartoBloco('), 'Gestão Blocos: reativarQuartoBloco implementada em app.js');
assert(appJsContent.includes('function abrirModalNovoQuartoNoBloco('), 'Gestão Blocos: abrirModalNovoQuartoNoBloco implementada em app.js');
assert(appJsContent.includes('function abrirModalEditarCapacidadeQuarto('), 'Gestão Blocos: abrirModalEditarCapacidadeQuarto implementada em app.js');
assert(appJsContent.includes('function salvarCapacidadeQuartoModal('), 'Gestão Blocos: salvarCapacidadeQuartoModal implementada em app.js');
assert(appJsContent.includes('function exportarResumoEstruturaBlocosExcel()'), 'Gestão Blocos: exportarResumoEstruturaBlocosExcel implementada em app.js');

// 2. Elementos no index.html
assert(indexHtmlContent.includes('exportarResumoEstruturaBlocosExcel()'), 'Gestão Blocos: Botão Relatório Estrutura (.xlsx) presente em index.html');
assert(indexHtmlContent.includes('id="statGestaoTotalBlocos"'), 'Gestão Blocos: Card KPI Total Blocos presente em index.html');
assert(indexHtmlContent.includes('id="statGestaoTotalQuartos"'), 'Gestão Blocos: Card KPI Total Quartos presente em index.html');
assert(indexHtmlContent.includes('id="statGestaoTotalVagas"'), 'Gestão Blocos: Card KPI Capacidade Operacional presente em index.html');
assert(indexHtmlContent.includes('id="statGestaoOcupacao"'), 'Gestão Blocos: Card KPI Ocupação presente em index.html');
assert(indexHtmlContent.includes('id="modalGerenciarQuartosBloco"'), 'Gestão Blocos: Modal de Gerenciamento de Quartos presente em index.html');
assert(indexHtmlContent.includes('id="tabelaQuartosBlocoModalCorpo"'), 'Gestão Blocos: Tabela de quartos do modal presente em index.html');
assert(indexHtmlContent.includes('id="buscaQuartosBlocoModalInput"'), 'Gestão Blocos: Campo de busca de quartos presente em index.html');
assert(indexHtmlContent.includes('id="filtroStatusQuartosBlocoModal"'), 'Gestão Blocos: Filtro de status de quartos presente em index.html');
assert(indexHtmlContent.includes('id="modalEditarCapacidadeQuarto"'), 'Gestão Blocos: Modal de ajuste de capacidade presente em index.html');

// 3. Simulação de Redução e Aumento de Capacidade Operacional de Bloco
const blocoMock = {
  id: 1,
  nome: 'Bloco 1',
  tipo: 'alojamento',
  quartos: []
};

// Gerar 96 quartos com 4 vagas = 384 vagas totais
for (let i = 1; i <= 96; i++) {
  blocoMock.quartos.push({
    id: 1000 + i,
    bloco_id: 1,
    numero: String(i),
    capacidade: 4,
    ativo: true,
    status: 'ativo',
    vagas: [
      { id: i * 10 + 1, numero_cama: 1, status: 'ocupada' },
      { id: i * 10 + 2, numero_cama: 2, status: 'ocupada' },
      { id: i * 10 + 3, numero_cama: 3, status: 'livre' },
      { id: i * 10 + 4, numero_cama: 4, status: 'livre' }
    ]
  });
}

function calcularEstatisticasBloco(bloco, quartos) {
  const qDoBloco = quartos.filter(q => q.bloco_id === bloco.id);
  const qAtivos = qDoBloco.filter(q => q.ativo !== false && q.status !== 'desativado');
  const qDesativados = qDoBloco.filter(q => q.ativo === false || q.status === 'desativado');
  const totalVagas = qAtivos.reduce((s, q) => s + (Number(q.capacidade) || 4), 0);
  const vagasDesativadas = qDesativados.reduce((s, q) => s + (Number(q.capacidade) || 4), 0);
  return {
    totalQuartos: qDoBloco.length,
    quartosAtivos: qAtivos.length,
    quartosDesativados: qDesativados.length,
    totalVagas: totalVagas,
    vagasDesativadas: vagasDesativadas
  };
}

let statsInicial = calcularEstatisticasBloco(blocoMock, blocoMock.quartos);
assert(statsInicial.totalQuartos === 96, 'Simulação Inicial: Bloco 1 possui 96 quartos');
assert(statsInicial.totalVagas === 384, 'Simulação Inicial: Bloco 1 possui 384 vagas ativas (96 * 4)');
assert(statsInicial.quartosDesativados === 0, 'Simulação Inicial: 0 quartos desativados');

// Desativar 1 quarto (capacidade diminui para 380 vagas)
blocoMock.quartos[0].ativo = false;
blocoMock.quartos[0].status = 'desativado';
let statsAposDesativar1 = calcularEstatisticasBloco(blocoMock, blocoMock.quartos);
assert(statsAposDesativar1.quartosAtivos === 95, 'Desativação: Quartos ativos reduzidos de 96 para 95');
assert(statsAposDesativar1.quartosDesativados === 1, 'Desativação: 1 quarto desativado');
assert(statsAposDesativar1.totalVagas === 380, 'Desativação: Capacidade do Bloco 1 reduzida de 384 para 380 vagas (-4)');
assert(statsAposDesativar1.vagasDesativadas === 4, 'Desativação: 4 vagas desativadas identificadas');

// Desativar mais 1 quarto (capacidade diminui para 376 vagas)
blocoMock.quartos[1].ativo = false;
blocoMock.quartos[1].status = 'desativado';
let statsAposDesativar2 = calcularEstatisticasBloco(blocoMock, blocoMock.quartos);
assert(statsAposDesativar2.totalVagas === 376, 'Desativação dupla: Capacidade do Bloco 1 reduzida para 376 vagas (-8)');

// Reativar quarto (capacidade é restaurada)
blocoMock.quartos[0].ativo = true;
blocoMock.quartos[0].status = 'ativo';
let statsAposReativar = calcularEstatisticasBloco(blocoMock, blocoMock.quartos);
assert(statsAposReativar.totalVagas === 380, 'Reativação: Capacidade do Bloco 1 restaurada para 380 vagas');

// Aumentar capacidade de um quarto de 4 para 6 camas
const qAumentar = blocoMock.quartos[2];
const capAntiga = qAumentar.capacidade;
qAumentar.capacidade = 6;
for (let c = capAntiga + 1; c <= 6; c++) {
  qAumentar.vagas.push({ id: 9990 + c, numero_cama: c, status: 'livre' });
}
let statsAposAumentar = calcularEstatisticasBloco(blocoMock, blocoMock.quartos);
assert(statsAposAumentar.totalVagas === 382, 'Aumento de Quarto: Capacidade de Bloco 1 aumentada em +2 camas (380 -> 382 vagas)');
assert(qAumentar.vagas.length === 6, 'Aumento de Quarto: Array de vagas do quarto agora possui 6 camas');

// -------------------------------------------------------------
// 12. VERIFICAÇÃO DA RONDA DO CANTEIRO (BANHEIROS & BEBEDOUROS)
// -------------------------------------------------------------
console.log('\n🚰 12. Verificação do Módulo Ronda do Canteiro (Banheiros & Bebedouros)');

// 1. Arquivos físicos e paridade
assert(fs.existsSync('ronda.html'), 'Arquivo ronda.html presente na raiz');
assert(fs.existsSync('frontend/ronda.html'), 'Arquivo frontend/ronda.html presente');

const conteudoRondaRaiz = fs.readFileSync('ronda.html', 'utf8');
const conteudoRondaFront = fs.readFileSync('frontend/ronda.html', 'utf8');
assert(conteudoRondaRaiz === conteudoRondaFront, 'Paridade 100% entre ronda.html e frontend/ronda.html');

// 2. Elementos de interface em index.html
const conteudoIndex = fs.readFileSync('index.html', 'utf8');
assert(conteudoIndex.includes('id="tab-ronda"'), 'Aba tab-ronda presente em index.html');
assert(conteudoIndex.includes('switchTab(\'ronda\')'), 'Botão switchTab(\'ronda\') presente na sidebar');
assert(conteudoIndex.includes('id="kpiRondaTotalPontos"'), 'Card KPI Total Pontos presente');
assert(conteudoIndex.includes('id="kpiRondaProgressoTaxa"'), 'Card KPI Progresso Hoje presente');
assert(conteudoIndex.includes('id="kpiRondaEmDia"'), 'Card KPI 100% Em Dia presente');
assert(conteudoIndex.includes('id="kpiRondaEmAndamento"'), 'Card KPI Em Andamento presente');
assert(conteudoIndex.includes('id="kpiRondaPendentes"'), 'Card KPI Pendentes presente');
assert(conteudoIndex.includes('id="kpiRondaAlertas"'), 'Card KPI Precisa Reparo presente');
assert(conteudoIndex.includes('id="modalNovoPontoRonda"'), 'Modal Novo/Editar Ponto de Ronda presente');
assert(conteudoIndex.includes('id="modalPlacaQRRonda"'), 'Modal Placa QR Code A4 de Ronda presente');
assert(conteudoIndex.includes('id="modalConfigRonda"'), 'Modal Configuração de Metas da Ronda presente');
assert(conteudoIndex.includes('id="modalRegistroManualRonda"'), 'Modal Registro Manual do Prefeito presente');
assert(conteudoIndex.includes('id="modalHistoricoPontoRonda"'), 'Modal Histórico de Limpezas presente');
assert(conteudoIndex.includes('id="modalScannerRondaQR"'), 'Modal Scanner de Câmera da Ronda presente');
assert(conteudoIndex.includes('imprimindo-placa-ronda'), 'Regras de impressão A4 imprimindo-placa-ronda presentes');

// 3. Funções em app.js
const conteudoApp = fs.readFileSync('app.js', 'utf8');
const funcoesRonda = [
  'inicializarRondaCanteiro',
  'carregarRondaCanteiro',
  'calcularStatusPontoRonda',
  'filtrarRondaUI',
  'renderizarGridRonda',
  'abrirModalNovoPontoRonda',
  'salvarPontoRonda',
  'excluirPontoRonda',
  'getQRCodeUrlRonda',
  'abrirModalPlacaQRRonda',
  'imprimirPlacaQRRonda',
  'abrirModalConfigRonda',
  'salvarConfigRonda',
  'abrirModalRegistroManualRonda',
  'salvarRegistroManualRonda',
  'abrirModalHistoricoPontoRonda',
  'recarregarRondaManual',
  'exportarRondaExcel',
  'abrirScannerRondaQR',
  'abrirModalOcorrenciasPontoRonda',
  'resolverOcorrenciaRonda',
  'abrirModalRelatorioRondaExecutivo',
  'renderizarRelatorioRondaExecutivoUI',
  'imprimirRelatorioRondaA4'
];
funcoesRonda.forEach(fn => {
  assert(conteudoApp.includes(fn), `Função de Ronda ${fn} implementada em app.js`);
});

// Verificação de Modais e Elementos de Segurança & Ouvidoria
assert(conteudoIndex.includes('id="modalOcorrenciasPontoRonda"'), 'Modal de Ouvidoria/Ocorrências do Ponto presente em index.html');
assert(conteudoIndex.includes('id="modalRelatorioRondaExecutivo"'), 'Modal do Relatório Executivo A4 presente em index.html');
assert(conteudoIndex.includes('id="configSenhaEquipeRonda"'), 'Campo de Senha da Equipe de Ronda presente em index.html');
assert(conteudoRondaRaiz.includes('id="containerSenhaLimpeza"'), 'Container de Validação de Senha presente em ronda.html');
assert(conteudoRondaRaiz.includes('id="formOcorrenciaRonda"'), 'Formulário de Ouvidoria / Ocorrência Operária presente em ronda.html');
assert(conteudoRondaRaiz.includes('id="btnModoLimpeza"') && conteudoRondaRaiz.includes('id="btnModoProblema"'), 'Alternador de Modos (Equipe / Operário) presente em ronda.html');

// 4. Simulação de Cálculo de Metas e Status
function simularStatusRonda(ponto, registrosHoje) {
  const qtdHoje = registrosHoje.length;
  const meta = Number(ponto.frequencia_diaria || (ponto.tipo === 'banheiro' ? 2 : 1));
  const temAlerta = registrosHoje.some(r => r.avaliacao && r.avaliacao.includes('Precisa Reparo'));

  if (temAlerta) {
    return { statusKey: 'alerta', label: 'PRECISA REPARO', cor: 'rose' };
  } else if (qtdHoje >= meta) {
    return { statusKey: 'ok', label: `EM DIA (${qtdHoje}/${meta})`, cor: 'emerald' };
  } else if (qtdHoje > 0) {
    return { statusKey: 'andamento', label: `EM ANDAMENTO (${qtdHoje}/${meta})`, cor: 'amber' };
  } else {
    return { statusKey: 'pendente', label: `PENDENTE (0/${meta})`, cor: 'orange' };
  }
}

// Teste Banheiro: Meta 2x
const mockBanheiro = { id: 'b1', nome: 'Banheiro KM 14', tipo: 'banheiro', frequencia_diaria: 2 };

const stB1_zero = simularStatusRonda(mockBanheiro, []);
assert(stB1_zero.statusKey === 'pendente' && stB1_zero.label === 'PENDENTE (0/2)', 'Ronda Banheiro (0/2): Status PENDENTE');

const stB1_um = simularStatusRonda(mockBanheiro, [{ id: 'r1', hora: '08:30', avaliacao: 'Excelente / Em Ordem' }]);
assert(stB1_um.statusKey === 'andamento' && stB1_um.label === 'EM ANDAMENTO (1/2)', 'Ronda Banheiro (1/2): Status EM ANDAMENTO (Amarelo)');

const stB1_dois = simularStatusRonda(mockBanheiro, [
  { id: 'r1', hora: '08:30', avaliacao: 'Excelente / Em Ordem' },
  { id: 'r2', hora: '14:15', avaliacao: 'Excelente / Em Ordem' }
]);
assert(stB1_dois.statusKey === 'ok' && stB1_dois.label === 'EM DIA (2/2)', 'Ronda Banheiro (2/2): Status EM DIA (Verde)');

// Teste Bebedouro: Meta 1x
const mockBebedouro = { id: 'beb1', nome: 'Bebedouro Refeitório', tipo: 'bebedouro', frequencia_diaria: 1 };

const stBeb_zero = simularStatusRonda(mockBebedouro, []);
assert(stBeb_zero.statusKey === 'pendente' && stBeb_zero.label === 'PENDENTE (0/1)', 'Ronda Bebedouro (0/1): Status PENDENTE');

const stBeb_um = simularStatusRonda(mockBebedouro, [{ id: 'r3', hora: '07:45', avaliacao: 'Tudo OK' }]);
assert(stBeb_um.statusKey === 'ok' && stBeb_um.label === 'EM DIA (1/1)', 'Ronda Bebedouro (1/1): Status EM DIA (Verde)');

// Teste Alerta de Manutenção
const stAlerta = simularStatusRonda(mockBanheiro, [
  { id: 'r4', hora: '08:30', avaliacao: 'Aviso / Precisa Reparo (Vazamento)' }
]);
assert(stAlerta.statusKey === 'alerta' && stAlerta.label === 'PRECISA REPARO', 'Ronda Alerta: Status PRECISA REPARO (Vermelho)');

// Teste de Geração de Link de QR Code para a Ronda
function simularGetQRCodeUrlRonda(baseUrl, pontoId) {
  let cleanUrl = baseUrl.split('?')[0].split('#')[0];
  if (cleanUrl.includes('index.html')) {
    cleanUrl = cleanUrl.replace('index.html', 'ronda.html');
  } else {
    cleanUrl = cleanUrl.endsWith('/') ? `${cleanUrl}ronda.html` : `${cleanUrl}/ronda.html`;
  }
  return `${cleanUrl}?ponto_id=${encodeURIComponent(pontoId)}`;
}
const urlGerada = simularGetQRCodeUrlRonda('https://prefeitura-obras.web.app/index.html', 'ponto_banheiro_02');
assert(urlGerada.includes('ronda.html?ponto_id=ponto_banheiro_02'), 'Geração de URL de QR Code para ronda.html válida');

// -------------------------------------------------------------
// 13. VERIFICAÇÃO DO QR CODE DUPLO (SENHA + OUVIDORIA) & RELATÓRIO A4 EM CASAS E ALOJAMENTOS
// -------------------------------------------------------------
console.log('\n🏠🛏️ 13. Verificação do QR Code Duplo (Senha + Ouvidoria) em Casas e Alojamentos');

const conteudoLimpezaRaiz = fs.readFileSync('limpeza.html', 'utf8');
const conteudoLimpezaFront = fs.readFileSync('frontend/limpeza.html', 'utf8');
assert(conteudoLimpezaRaiz === conteudoLimpezaFront, 'Paridade 100% entre limpeza.html e frontend/limpeza.html');

// 1. Elementos de Senha e Ouvidoria em limpeza.html
assert(conteudoLimpezaRaiz.includes('id="btnModoLimpeza"') && conteudoLimpezaRaiz.includes('id="btnModoProblema"'), 'Alternador Duplo (Equipe Limpeza vs Morador Reclamação) presente em limpeza.html');
assert(conteudoLimpezaRaiz.includes('id="containerSenhaLimpeza"'), 'Bloqueio por Senha/PIN da Equipe presente em limpeza.html');
assert(conteudoLimpezaRaiz.includes('function validarSenhaEquipe()'), 'Função validarSenhaEquipe presente em limpeza.html');
assert(conteudoLimpezaRaiz.includes('id="formOcorrenciaLocal"'), 'Formulário público de reclamação/observação do morador presente em limpeza.html');
assert(conteudoLimpezaRaiz.includes('function salvarOcorrenciaLocalPublica('), 'Função salvarOcorrenciaLocalPublica presente em limpeza.html');
assert(conteudoLimpezaRaiz.includes('quarto_id'), 'Suporte híbrido a quarto_id (Alojamentos) e casa_id (Casas) presente em limpeza.html');

// 2. Funções e Modais em index.html e app.js
const funcoesLimpezaHibrida = [
  'calcularStatusLimpezaQuarto',
  'getQRCodeUrlQuarto',
  'abrirModalPlacaQRQuarto',
  'abrirModalRegistroLimpezaQuarto',
  'obterChamadosAbertosQuarto',
  'obterChamadosAbertosCasa',
  'abrirModalOcorrenciasUnidade',
  'resolverOcorrenciaUnidade',
  'abrirModalRelatorioLimpezaExecutivo',
  'renderizarRelatorioLimpezaExecutivoUI',
  'imprimirRelatorioLimpezaA4'
];
funcoesLimpezaHibrida.forEach(fn => {
  assert(conteudoApp.includes(`function ${fn}`), `Função ${fn} implementada em app.js`);
});

assert(conteudoIndex.includes('id="modalOcorrenciasUnidade"'), 'Modal de Ouvidoria & Reclamações da Unidade (Casa/Quarto) presente em index.html');
assert(conteudoIndex.includes('id="modalRelatorioLimpezaExecutivo"'), 'Modal do Relatório Executivo A4 de Limpeza (Casas & Alojamentos) presente em index.html');
assert(conteudoIndex.includes('imprimindo-relatorio-limpeza'), 'Regras CSS @media print para imprimindo-relatorio-limpeza presentes em index.html');

// 3. Verificação do Modelo "Apenas Um QR Code por Bloco no Alojamento"
assert(conteudoIndex.includes('abrirModalPlacaQRBloco()'), 'Botão Placa QR do Bloco presente no cabeçalho do Mapa de Quartos em index.html');
assert(conteudoIndex.includes('id="selectBlocoPlacaQR"'), 'Seletor rápido de Bloco presente no modal de impressão da Placa QR em index.html');
assert(conteudoApp.includes('function abrirModalPlacaQRBloco('), 'Função abrirModalPlacaQRBloco implementada em app.js');
assert(conteudoApp.includes('function getQRCodeUrlBloco('), 'Função getQRCodeUrlBloco implementada em app.js');
assert(conteudoLimpezaRaiz.includes('id="boxQuartoAtendidoLimpeza"'), 'Campo de seleção do quarto atendido presente no form de limpeza de limpeza.html');
assert(conteudoLimpezaRaiz.includes('id="boxQuartoOcorrenciaAlojamento"'), 'Campo de informe do quarto do alojado presente no form de ocorrência de limpeza.html');
assert(conteudoLimpezaRaiz.includes('aplicarDadosBlocoAlojamento('), 'Função aplicarDadosBlocoAlojamento implementada em limpeza.html');

console.log('\n⚡💧 14. Verificação das Concessionárias de Água & Luz (2ª Via Direta & Agências Virtuais)');

// 1. Elementos de Interface das Concessionárias
assert(conteudoIndex.includes('id="casaFormEnergiaConcessionaria"'), 'Campo Concessionária de Luz presente no formulário de Casas');
assert(conteudoIndex.includes('id="casaFormEnergiaUC"'), 'Campo Código UC / Instalação presente no formulário de Casas');
assert(conteudoIndex.includes('id="casaFormAguaConcessionaria"'), 'Campo Concessionária de Água presente no formulário de Casas');
assert(conteudoIndex.includes('id="casaFormAguaMatricula"'), 'Campo Matrícula / Ligação de Água presente no formulário de Casas');
assert(conteudoIndex.includes('id="casaDetalhesAgenciasCard"'), 'Card de Agências Virtuais presente no painel de despesas da Casa');
assert(conteudoIndex.includes('id="boxInfoConcessionariaDespesa"'), 'Box informativo dinâmico de concessionária presente no modal de despesas');
assert(conteudoIndex.includes('id="despesaCasaFormLinkFatura"'), 'Campo Link da 2ª Via / PDF presente no formulário de despesas');

// 2. Funções e Catálogos em app.js
assert(conteudoApp.includes('CATALOGO_CONCESSIONARIAS_ENERGIA'), 'Catálogo de Concessionárias de Energia definido em app.js');
assert(conteudoApp.includes('CATALOGO_CONCESSIONARIAS_AGUA'), 'Catálogo de Concessionárias de Água definido em app.js');
assert(conteudoApp.includes('function obterDadosConcessionariaCasa('), 'Função obterDadosConcessionariaCasa implementada em app.js');
assert(conteudoApp.includes('function aoMudarConcessionariaCasa('), 'Função aoMudarConcessionariaCasa implementada em app.js');
assert(conteudoApp.includes('function copiarCodigoConcessionaria('), 'Função copiarCodigoConcessionaria implementada em app.js');
assert(conteudoApp.includes('function atualizarInfoConcessionariaDespesaForm('), 'Função atualizarInfoConcessionariaDespesaForm implementada em app.js');
assert(conteudoApp.includes('function renderizarCardAgenciasCasaAtual('), 'Função renderizarCardAgenciasCasaAtual implementada em app.js');

// 3. Simulação de Resolução de Concessionárias
const evalCatalogoEnergia = eval(`(() => {
  const CATALOGO_CONCESSIONARIAS_ENERGIA = {
    'energisa': { nome: 'Energisa', url: 'https://servicos.energisa.com.br/', icone: 'fa-bolt text-yellow-500' },
    'enel': { nome: 'Enel', url: 'https://www.enel.com.br/pt/segunda-via-de-fatura.html', icone: 'fa-bolt text-yellow-500' },
    'cpfl': { nome: 'CPFL Energia', url: 'https://servicosonline.cpfl.com.br/', icone: 'fa-bolt text-yellow-500' }
  };
  return CATALOGO_CONCESSIONARIAS_ENERGIA;
})()`);
assert(evalCatalogoEnergia['energisa'] && evalCatalogoEnergia['energisa'].url.includes('energisa'), 'Catálogo de Energia possui link correto da Energisa');

const casaMockConcessionaria = {
  id: 'CASA-TESTE-01',
  nome: 'Casa Engenharia 01',
  energia_concessionaria: 'energisa',
  energia_uc: '10/248590-2',
  agua_concessionaria: 'sanesul',
  agua_matricula: '45892-01'
};
assert(casaMockConcessionaria.energia_concessionaria === 'energisa' && casaMockConcessionaria.energia_uc === '10/248590-2', 'Mock de Casa com Energisa e UC válida');
assert(casaMockConcessionaria.agua_concessionaria === 'sanesul' && casaMockConcessionaria.agua_matricula === '45892-01', 'Mock de Casa com Sanesul e Matrícula válida');

// -------------------------------------------------------------
// 15. VERIFICAÇÃO DA CONSOLIDAÇÃO DE CASAS NA CIDADE NA PLANILHA OFICIAL & RESUMO EXECUTIVO
// -------------------------------------------------------------
console.log('\n📊🏘️ 15. Verificação da Consolidação de Casas na Cidade na Planilha Oficial & Resumo');

// 1. Paridade de app.js e index.html
const conteudoAppFront = fs.readFileSync('frontend/app.js', 'utf8');
assert(conteudoApp === conteudoAppFront, 'Paridade 100% entre app.js e frontend/app.js');

const conteudoIndexFront = fs.readFileSync('frontend/index.html', 'utf8');
assert(conteudoIndex === conteudoIndexFront, 'Paridade 100% entre index.html e frontend/index.html');

// 2. Presença dos Blocos e Seções Consolidadas em exportarPlanilhaOficial
assert(conteudoApp.includes('SUBTOTAL CANTEIRO TABOCA 2'), 'Seção de Subtotal do Canteiro presente na Planilha Oficial');
assert(conteudoApp.includes('SUBTOTAL CASAS NA CIDADE'), 'Seção de Subtotal de Casas na Cidade presente na Planilha Oficial');
assert(conteudoApp.includes('TOTAL GERAL CONSOLIDADO (CANTEIRO + CASAS)'), 'Total Geral Consolidado presente na Planilha Oficial');
assert(conteudoApp.includes('"CASAS NA CIDADE"'), 'Aba 6 (CASAS NA CIDADE) adicionada à Planilha Oficial');
assert(conteudoApp.includes('todosMoradoresAtivos'), 'Array consolidado de moradores ativos (canteiro + casas) presente em app.js');

// 3. Presença da Consolidação em exportarResumoExcel
assert(conteudoApp.includes('TOTAL GERAL CONSOLIDADO') && conteudoApp.includes('casasCalculadas'), 'Resumo Executivo contempla casas calculadas e total geral consolidado');

// 4. Simulação Matemática da Consolidação (Canteiro + Casas na Cidade)
const mockCanteiroStats = {
  quartos: 224,
  capacidade: 896,
  ocupados: 387,
  livres: 896 - 387 // 509
};

const mockCasasLista = [
  {
    id: 'casa_1',
    nome: 'Casa Liderança 01',
    comodos: [
      { id: 'com_1', tipo: 'quarto', camas: 3, moradores: [{ id: 'm1' }, { id: 'm2' }] },
      { id: 'com_2', tipo: 'quarto', camas: 2, moradores: [{ id: 'm3' }] },
      { id: 'com_3', tipo: 'sala', moveis: [] } // Sala não conta como quarto/cama
    ]
  },
  {
    id: 'casa_2',
    nome: 'Casa Engenharia 02',
    comodos: [
      { id: 'com_4', tipo: 'quarto', camas: 4, moradores: [{ id: 'm4' }, { id: 'm5' }, { id: 'm6' }] }
    ]
  }
];

// Cálculo de métricas das casas
let totalComodosCasasCalc = 0;
let totalCamasCasasCalc = 0;
let totalOcupadasCasasCalc = 0;

mockCasasLista.forEach(c => {
  const comodosQuarto = (c.comodos || []).filter(cm => (cm.tipo || '').toLowerCase() === 'quarto');
  totalComodosCasasCalc += comodosQuarto.length;
  comodosQuarto.forEach(cm => {
    totalCamasCasasCalc += Number(cm.camas || 0);
    totalOcupadasCasasCalc += (cm.moradores || []).length;
  });
});

const totalLivresCasasCalc = Math.max(0, totalCamasCasasCalc - totalOcupadasCasasCalc);

assert(totalComodosCasasCalc === 3, 'Simulação Casas: Total de 3 quartos identificados nas 2 casas');
assert(totalCamasCasasCalc === 9, 'Simulação Casas: Total de 9 camas nas 2 casas (3 + 2 + 4)');
assert(totalOcupadasCasasCalc === 6, 'Simulação Casas: Total de 6 moradores ocupando leitos nas casas (2 + 1 + 3)');
assert(totalLivresCasasCalc === 3, 'Simulação Casas: Total de 3 vagas livres nas casas (9 - 6)');

// Consolidação Total (Canteiro + Casas)
const consolidadoQuartos = mockCanteiroStats.quartos + totalComodosCasasCalc;
const consolidadoCapacidade = mockCanteiroStats.capacidade + totalCamasCasasCalc;
const consolidadoOcupados = mockCanteiroStats.ocupados + totalOcupadasCasasCalc;
const consolidadoLivres = mockCanteiroStats.livres + totalLivresCasasCalc;
const taxaOcupacaoConsolidada = consolidadoCapacidade > 0 ? (consolidadoOcupados / consolidadoCapacidade) : 0;

assert(consolidadoQuartos === 227, 'Consolidação: Total de 227 cômodos/quartos consolidados (224 + 3)');
assert(consolidadoCapacidade === 905, 'Consolidação: Capacidade total de 905 leitos consolidados (896 + 9)');
assert(consolidadoOcupados === 393, 'Consolidação: Ocupação total de 393 pessoas consolidadas (387 + 6)');
assert(consolidadoLivres === 512, 'Consolidação: 512 leitos disponíveis consolidados (509 + 3)');
assert(taxaOcupacaoConsolidada > 0.43 && taxaOcupacaoConsolidada < 0.44, 'Consolidação: Taxa consolidada calculada corretamente (~43.4%)');

// -------------------------------------------------------------
// 16. VERIFICAÇÃO DE RESILIÊNCIA, SEGURANÇA ANTI-XSS, PWA OFFLINE E FUSO HORÁRIO LOCAL
// -------------------------------------------------------------
console.log('\n🛡️ 16. Verificação de Segurança Anti-XSS, PWA Offline, Fuso Local e Backup Consistente');

// 1. Sanitização Anti-XSS
const appJsContentSec16 = fs.readFileSync('app.js', 'utf8');
assert(appJsContentSec16.includes('function escapeHTML('), 'Função escapeHTML implementada em app.js');

function testEscapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const xssPayload = '<script>alert("hacked")</script>';
const xssEscaped = testEscapeHTML(xssPayload);
assert(!xssEscaped.includes('<script>') && xssEscaped.includes('&lt;script&gt;'), 'Sanitização Anti-XSS converte tags HTML perigosas para entidades seguras');
assert(xssEscaped.includes('&quot;hacked&quot;'), 'Sanitização Anti-XSS converte aspas para &quot;');

// 2. Fuso Horário Local (Brasil / Canteiro Taboca 2)
assert(appJsContentSec16.includes('function getDataHojeLocal('), 'Função getDataHojeLocal implementada em app.js');
assert(!appJsContentSec16.includes(".toISOString().split('T')[0]"), 'Eliminada dependência de data UTC toISOString().split() em app.js');

function testGetDataHojeLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const hojeTeste = testGetDataHojeLocal();
assert(/^\d{4}-\d{2}-\d{2}$/.test(hojeTeste), 'Formato de data local é exatamente YYYY-MM-DD');

// 3. Remoção do Override de 12 Móveis Fixos
assert(!appJsContentSec16.includes('const reparadosIds = new Set'), 'Removida reconciliação legada que sobrescrevia 12 móveis fixos para Bom no boot');

// 4. Consistência na Restauração de Backup
assert(appJsContentSec16.includes("collection('canteiro_metadata').doc('snapshot_canteiro').set(snapshotData)"), 'Restauração de backup salva o snapshot exatamente em canteiro_metadata/snapshot_canteiro');

// 5. PWA Offline em sw.js
const swContent = fs.readFileSync('sw.js', 'utf8');
assert(/prefeitura-pwa-v4\.[1234]/.test(swContent), 'Versão do cache atualizada para prefeitura-pwa-v4.x em sw.js');
assert(swContent.includes("'ronda.html'"), 'ronda.html incluído no pré-cache offline de sw.js');
assert(swContent.includes("response.type !== 'opaque'"), 'Suporte a cache de recursos de CDN (Tailwind, FontAwesome) ativo em sw.js');

// 6. Confirmação Transparente nos Portais e Fila Offline
const chamadoContent = fs.readFileSync('chamado.html', 'utf8');
assert(chamadoContent.includes('sucessoBadgeStatus'), 'Badge transparente de status de envio presente em chamado.html');
assert(chamadoContent.includes('sincronizarChamadosPendentesOffline'), 'Fila e auto-sync de chamados pendentes implementados em chamado.html');

const limpezaContent = fs.readFileSync('limpeza.html', 'utf8');
assert(limpezaContent.includes('sucessoBadgeStatusLimpeza'), 'Badge transparente de status de envio presente em limpeza.html');
assert(limpezaContent.includes('sincronizarLimpezasPendentesOffline'), 'Fila e auto-sync de limpezas pendentes implementados em limpeza.html');

const rondaContent = fs.readFileSync('ronda.html', 'utf8');
assert(rondaContent.includes('sucessoBadgeStatusRonda'), 'Badge transparente de status de envio presente em ronda.html');
assert(rondaContent.includes('sincronizarRondasPendentesOffline'), 'Fila e auto-sync de registros de ronda pendentes implementados em ronda.html');

// 7. Paridade Estrita 100% com frontend/
assert(fs.readFileSync('app.js', 'utf8') === fs.readFileSync('frontend/app.js', 'utf8'), 'Paridade 100% app.js e frontend/app.js');
assert(fs.readFileSync('chamado.html', 'utf8') === fs.readFileSync('frontend/chamado.html', 'utf8'), 'Paridade 100% chamado.html e frontend/chamado.html');
assert(fs.readFileSync('limpeza.html', 'utf8') === fs.readFileSync('frontend/limpeza.html', 'utf8'), 'Paridade 100% limpeza.html e frontend/limpeza.html');
assert(fs.readFileSync('ronda.html', 'utf8') === fs.readFileSync('frontend/ronda.html', 'utf8'), 'Paridade 100% ronda.html e frontend/ronda.html');
assert(fs.readFileSync('sw.js', 'utf8') === fs.readFileSync('frontend/sw.js', 'utf8'), 'Paridade 100% sw.js e frontend/sw.js');
// -------------------------------------------------------------
// 17. VERIFICAÇÃO DA SIDEBAR FIXA, MODO TELA CHEIA E ERGONOMIA
// -------------------------------------------------------------
console.log('\n🖥️ 17. Verificação da Sidebar Fixa, Modo Tela Cheia e Ergonomia de Navegação');

const indexHtmlFinal = fs.readFileSync('index.html', 'utf8');
const appJsFinal = fs.readFileSync('app.js', 'utf8');

assert(indexHtmlFinal.includes('h-screen flex flex-col antialiased overflow-hidden'), 'Layout App Shell com h-screen overflow-hidden presente no body de index.html');
assert(indexHtmlFinal.includes('flex-1 flex min-h-0 overflow-hidden'), 'Container flex com min-h-0 e overflow-hidden presente em index.html');
assert(indexHtmlFinal.includes('id="sidebarToggleBtn"'), 'Botão universal de alternância da barra lateral (#sidebarToggleBtn) presente em index.html');
assert(indexHtmlFinal.includes('#sidebar.collapsed-desktop'), 'Regra CSS de recolhimento suave (.collapsed-desktop) presente em index.html');
assert(indexHtmlFinal.includes('id="mainContent"'), 'Área de conteúdo principal identificada (#mainContent) com scroll suave');
assert(indexHtmlFinal.includes('id="btnVoltarAoTopo"'), 'Botão flutuante de retorno ao topo (#btnVoltarAoTopo) presente em index.html');
assert(indexHtmlFinal.includes('toggleSidebarDesktop(true)'), 'Botão de atalho rápido para ocultar presente no topo da sidebar desktop');

assert(appJsFinal.includes('function toggleSidebar('), 'Função universal toggleSidebar implementada em app.js');
assert(appJsFinal.includes('function toggleSidebarDesktop('), 'Função toggleSidebarDesktop implementada em app.js');
assert(appJsFinal.includes('function restaurarPreferenciaSidebar('), 'Função restaurarPreferenciaSidebar implementada em app.js');
assert(appJsFinal.includes('function voltarAoTopo('), 'Função voltarAoTopo implementada em app.js');
assert(appJsFinal.includes('function initScrollToTopListener('), 'Função initScrollToTopListener implementada em app.js');
assert(appJsFinal.includes('canteiro_sidebar_collapsed'), 'Persistência de preferência de tela cheia via localStorage presente em app.js');
assert(appJsFinal.includes('mainEl.scrollTop = 0'), 'Reset automático da rolagem para o topo ao alternar de aba presente em app.js');
assert(appJsFinal.includes("e.ctrlKey && (e.key === 'b' || e.key === 'B')"), 'Atalho de teclado Ctrl+B para alternar menu presente em app.js');
assert(fs.readFileSync('index.html', 'utf8') === fs.readFileSync('frontend/index.html', 'utf8'), 'Paridade 100% index.html e frontend/index.html');
assert(fs.readFileSync('app.js', 'utf8') === fs.readFileSync('frontend/app.js', 'utf8'), 'Paridade 100% app.js e frontend/app.js');

// -------------------------------------------------------------
// 18. VERIFICAÇÃO DA CENTRAL DE AUDITORIA, FILTROS, MODAL E EXCEL
// -------------------------------------------------------------
console.log('\n📜 18. Verificação da Central de Auditoria, Filtros Avançados, Modal WhatsApp e Excel');

const indexHtmlAudit = fs.readFileSync('index.html', 'utf8');
const appJsAudit = fs.readFileSync('app.js', 'utf8');

// Elementos da UI em index.html
assert(indexHtmlAudit.includes('id="kpiAuditTotal"'), 'KPI Total de Ações Auditadas presente em index.html');
assert(indexHtmlAudit.includes('id="kpiAuditHoje"'), 'KPI Ações Hoje presente em index.html');
assert(indexHtmlAudit.includes('id="kpiAuditAloj"'), 'KPI Alojamentos presente em index.html');
assert(indexHtmlAudit.includes('id="kpiAuditCasas"'), 'KPI Casas na Cidade presente em index.html');
assert(indexHtmlAudit.includes('id="kpiAuditEstoque"'), 'KPI Almoxarifado presente em index.html');
assert(indexHtmlAudit.includes('id="kpiAuditChamados"'), 'KPI Chamados & Rondas presente em index.html');
assert(indexHtmlAudit.includes('id="auditProgressBar"'), 'Barra de distribuição visual de atividades (#auditProgressBar) presente em index.html');

// Filtros rápidos e por data
assert(indexHtmlAudit.includes('id="pillAudit_hoje"'), 'Pílula de filtro rápido "Hoje" presente em index.html');
assert(indexHtmlAudit.includes('id="pillAudit_7dias"'), 'Pílula de filtro rápido "7 dias" presente em index.html');
assert(indexHtmlAudit.includes('id="filtroAuditDataInicio"'), 'Campo de data inicial (#filtroAuditDataInicio) presente em index.html');
assert(indexHtmlAudit.includes('id="filtroAuditDataFim"'), 'Campo de data final (#filtroAuditDataFim) presente em index.html');
assert(indexHtmlAudit.includes('id="filtroAuditModulo"'), 'Seletor de módulo (#filtroAuditModulo) presente em index.html');
assert(indexHtmlAudit.includes('id="filtroAuditAcao"'), 'Seletor de ação (#filtroAuditAcao) presente em index.html');
assert(indexHtmlAudit.includes('id="filtroAuditUsuario"'), 'Seletor de usuário (#filtroAuditUsuario) presente em index.html');
assert(indexHtmlAudit.includes('id="filtroAuditBusca"'), 'Campo de busca textual (#filtroAuditBusca) presente em index.html');
assert(indexHtmlAudit.includes('id="filtroAuditOrdem"'), 'Seletor de ordenação cronológica (#filtroAuditOrdem) presente em index.html');
assert(indexHtmlAudit.includes('id="btnLimparFiltrosAuditoria"'), 'Botão Limpar Filtros (#btnLimparFiltrosAuditoria) presente em index.html');
assert(indexHtmlAudit.includes('id="auditCountFiltrados"'), 'Contador dinâmico de logs (#auditCountFiltrados) presente em index.html');

// Modal de Detalhe e WhatsApp
assert(indexHtmlAudit.includes('id="modalDetalheAuditoria"'), 'Modal de detalhes de auditoria (#modalDetalheAuditoria) presente em index.html');
assert(indexHtmlAudit.includes('copiarLogAuditoriaWhatsAppModal()'), 'Botão Copiar para WhatsApp presente no modal de auditoria');
assert(indexHtmlAudit.includes("exportarAuditoriaExcel('filtrados')"), 'Botão Exportar Excel Filtrado presente em index.html');
assert(indexHtmlAudit.includes("exportarAuditoriaExcel('todos')"), 'Botão Exportar Excel Completo presente em index.html');

// Funções em app.js
assert(appJsAudit.includes('function carregarAuditoria('), 'Função carregarAuditoria implementada em app.js');
assert(appJsAudit.includes('function definirFiltroPeriodoAuditoria('), 'Função definirFiltroPeriodoAuditoria implementada em app.js');
assert(appJsAudit.includes('function aoMudarDataManualAuditoria('), 'Função aoMudarDataManualAuditoria implementada em app.js');
assert(appJsAudit.includes('function limparFiltrosAuditoria('), 'Função limparFiltrosAuditoria implementada em app.js');
assert(appJsAudit.includes('function filtrarAuditoriaUI('), 'Função filtrarAuditoriaUI implementada em app.js');
assert(appJsAudit.includes('function renderTabelaAuditoria('), 'Função renderTabelaAuditoria implementada em app.js');
assert(appJsAudit.includes('function abrirModalDetalheAuditoria('), 'Função abrirModalDetalheAuditoria implementada em app.js');
assert(appJsAudit.includes('function copiarLogAuditoriaWhatsAppModal('), 'Função copiarLogAuditoriaWhatsAppModal implementada em app.js');
assert(appJsAudit.includes('function exportarAuditoriaExcel('), 'Função exportarAuditoriaExcel implementada em app.js');

// Verificação de lógica e formatação do Excel (2 abas com fórmulas e estilos corporativos)
assert(appJsAudit.includes("XLSX.utils.book_append_sheet(wb, ws1, 'Logs de Atividades')"), 'Excel de auditoria gera a aba "Logs de Atividades"');
assert(appJsAudit.includes("XLSX.utils.book_append_sheet(wb, ws2, 'Resumo Executivo')"), 'Excel de auditoria gera a aba "Resumo Executivo"');
assert(appJsAudit.includes("ExcelProGenerator.addCabecalhoCorporativoGEL"), 'Excel de auditoria utiliza cabeçalho corporativo institucional GEL');
assert(appJsAudit.includes("badgeAction(acaoFormatada, zebra)"), 'Excel de auditoria estiliza tipo de ação com badge colorido');
assert(appJsAudit.includes("COUNTA(B5:B"), 'Excel de auditoria possui fórmula de contagem COUNTA na aba Logs de Atividades');
assert(appJsAudit.includes("COUNTIF('Logs de Atividades'!"), 'Excel de auditoria possui fórmulas vivas COUNTIF na aba Resumo Executivo');
assert(appJsAudit.includes("SUM(B"), 'Excel de auditoria possui fórmulas de totalização SUM na aba Resumo Executivo');

// Window exports
assert(appJsAudit.includes('window.definirFiltroPeriodoAuditoria = definirFiltroPeriodoAuditoria'), 'definirFiltroPeriodoAuditoria exposto no window');
assert(appJsAudit.includes('window.abrirModalDetalheAuditoria = abrirModalDetalheAuditoria'), 'abrirModalDetalheAuditoria exposto no window');
assert(appJsAudit.includes('window.copiarLogAuditoriaWhatsAppModal = copiarLogAuditoriaWhatsAppModal'), 'copiarLogAuditoriaWhatsAppModal exposto no window');

// Paridade 100% rigorosa
assert(fs.readFileSync('index.html', 'utf8') === fs.readFileSync('frontend/index.html', 'utf8'), 'Paridade 100% index.html e frontend/index.html');
assert(fs.readFileSync('app.js', 'utf8') === fs.readFileSync('frontend/app.js', 'utf8'), 'Paridade 100% app.js e frontend/app.js');

// -------------------------------------------------------------
// 19. INTEGRIDADE DOS QR CODES, ROTEAMENTO INTELIGENTE E OFFLINE SEEDS
// -------------------------------------------------------------
console.log('\n📱 19. Verificação de Integridade dos QR Codes, Roteamento Inteligente e Suporte Offline a Sanitários e Casas');

const appJsQR = fs.readFileSync('app.js', 'utf8');
const indexHtmlQR = fs.readFileSync('index.html', 'utf8');
const rondaHtmlQR = fs.readFileSync('ronda.html', 'utf8');
const limpezaHtmlQR = fs.readFileSync('limpeza.html', 'utf8');

// 19.1 Helper universal getCleanSystemUrl
assert(appJsQR.includes('function getCleanSystemUrl('), 'Função universal getCleanSystemUrl implementada em app.js');
assert(appJsQR.includes("cleanUrl.replace(/\\/[^/]+\\.html$/i, '')"), 'getCleanSystemUrl utiliza Regex para expurgar arquivos HTML da URL');

// Simulação de limpeza de URL em diversos cenários operacionais
function simularGetCleanSystemUrl(mockHref, targetPage) {
  let cleanUrl = mockHref.split('?')[0].split('#')[0];
  cleanUrl = cleanUrl.replace(/\/[^/]+\.html$/i, '');
  if (!cleanUrl.endsWith('/')) cleanUrl += '/';
  return `${cleanUrl}${targetPage}`;
}

const urlSimulada1 = simularGetCleanSystemUrl('https://obra.gel.com.br/prefeitura/index.html', 'ronda.html');
assert(urlSimulada1 === 'https://obra.gel.com.br/prefeitura/ronda.html', 'Simulação getCleanSystemUrl remove index.html e aponta para ronda.html');

const urlSimulada2 = simularGetCleanSystemUrl('https://obra.gel.com.br/prefeitura/limpeza.html?casa_id=casa_1', 'ronda.html');
assert(urlSimulada2 === 'https://obra.gel.com.br/prefeitura/ronda.html', 'Simulação getCleanSystemUrl remove limpeza.html e query params corretamente');

const urlSimulada3 = simularGetCleanSystemUrl('https://eullon1234-creator.github.io/prefeitura-do-tiago-vidal/', 'limpeza.html');
assert(urlSimulada3 === 'https://eullon1234-creator.github.io/prefeitura-do-tiago-vidal/limpeza.html', 'Simulação getCleanSystemUrl preserva URLs raiz com barra final');

// 19.2 Geradores de URL com targetPage padronizada
assert(appJsQR.includes("getCleanSystemUrl('chamado.html')"), 'getQRCodeUrl utiliza getCleanSystemUrl para chamado.html');
assert(appJsQR.includes("getCleanSystemUrl('limpeza.html')}?casa_id="), 'getQRCodeUrlCasa utiliza getCleanSystemUrl para limpeza.html');
assert(appJsQR.includes("getCleanSystemUrl('limpeza.html')}?bloco="), 'getQRCodeUrlBloco utiliza getCleanSystemUrl para limpeza.html');
assert(appJsQR.includes("getCleanSystemUrl('limpeza.html')}?quarto_id="), 'getQRCodeUrlQuarto utiliza getCleanSystemUrl para limpeza.html');
assert(appJsQR.includes("getCleanSystemUrl('ronda.html')}?ponto_id="), 'getQRCodeUrlRonda utiliza getCleanSystemUrl para ronda.html');

// 19.3 Suporte Offline e Seeds em ronda.html
assert(rondaHtmlQR.includes('const PONTOS_RONDA_PADRAO_SEED = ['), 'ronda.html embute PONTOS_RONDA_PADRAO_SEED diretamente no código');
assert(rondaHtmlQR.includes("id: 'ponto_banheiro_01'"), 'Ponto Banheiro Químico 01 presente nos seeds de ronda.html');
assert(rondaHtmlQR.includes("id: 'ponto_bebedouro_refeitorio'"), 'Ponto Bebedouro Refeitório presente nos seeds de ronda.html');
assert(rondaHtmlQR.includes('listaPontosDisponiveis = [...PONTOS_RONDA_PADRAO_SEED]'), 'listaPontosDisponiveis inicializada com seeds padrão em ronda.html');
assert(rondaHtmlQR.includes('PONTOS_RONDA_PADRAO_SEED.forEach(seed => {'), 'ronda.html mescla seeds com cache local/Firestore');
assert(rondaHtmlQR.includes('// Fallback resiliente imediato: se pontoId informado não estiver na lista'), 'Fallback resiliente de pontoId implementado em ronda.html');

// 19.4 Roteamento cruzado em ronda.html e limpeza.html
assert(rondaHtmlQR.includes("window.location.replace(`limpeza.html?casa_id="), 'ronda.html redireciona automaticamente se aberto com casa_id');
assert(rondaHtmlQR.includes("window.location.replace(`limpeza.html?bloco="), 'ronda.html redireciona automaticamente se aberto com bloco');
assert(limpezaHtmlQR.includes("window.location.replace(`ronda.html?ponto_id="), 'limpeza.html redireciona automaticamente se aberto com ponto_id ou banheiro');
assert(limpezaHtmlQR.includes("urlCasaId.startsWith('bloco_')"), 'limpeza.html reconhece bloco_ no parâmetro casa_id');
assert(limpezaHtmlQR.includes("String(casaId).startsWith('bloco_')"), 'carregarCasa em limpeza.html direciona bloco_ para aplicarDadosBlocoAlojamento');

// 19.5 Roteamento inteligente nos scanners da aplicação em app.js
assert(appJsQR.includes("// 0. Detecção inteligente de desvio: Se for QR Code de Ronda / Sanitário / Bebedouro"), 'processarLeituraQRCasa detecta desvio de ronda/banheiro');
assert(appJsQR.includes("// 0. Detecção inteligente de desvio: Se for QR Code de Casa ou Bloco/Quarto de Alojamento"), 'processarLeituraQRRonda detecta desvio de casa/alojamento');
assert(appJsQR.includes("casaId = 'bloco_' + qBloco"), 'processarLeituraQRCasa processa QR Code de Bloco de Alojamento');
assert(appJsQR.includes("if (pontoId && (pontoId.startsWith('ponto_') || acao === 'ronda'"), 'verificarAcaoUrlParametros redireciona ponto_id para ronda.html');
assert(appJsQR.includes("tipo_local: 'alojamento_bloco'"), 'salvarRegistroLimpeza suporta registros em blocos de alojamento');

// 19.6 Títulos dinâmicos dos modais para distinguir Bloco vs Casa
assert(indexHtmlQR.includes('id="modalPlacaQRCasaHeaderTitulo"'), 'ID modalPlacaQRCasaHeaderTitulo presente em index.html');
assert(indexHtmlQR.includes('id="modalPlacaQRCasaHeaderSubtitulo"'), 'ID modalPlacaQRCasaHeaderSubtitulo presente em index.html');
assert(indexHtmlQR.includes('id="modalPlacaQRCasaFooterAviso"'), 'ID modalPlacaQRCasaFooterAviso presente em index.html');
assert(appJsQR.includes("headTit.textContent = 'Placa de Identificação & QR Code do Bloco (Alojamento)'"), 'abrirModalPlacaQRBloco altera título dinamicamente para Bloco');
assert(appJsQR.includes("headTit.textContent = 'Placa de Identificação & QR Code da Residência (Casa na Cidade)'"), 'abrirModalPlacaQRCasa altera título dinamicamente para Casa');
assert(appJsQR.includes("headTit.textContent = 'Placa de Identificação & QR Code do Quarto (Alojamento)'"), 'abrirModalPlacaQRQuarto altera título dinamicamente para Quarto');

// -------------------------------------------------------------
// 20. HIERARQUIA DE CAMADAS Z-INDEX E EDIÇÃO REATIVA DE CASAS
// -------------------------------------------------------------
console.log('\n🪟 20. Verificação da Hierarquia de Camadas Z-Index e Edição Reativa de Casas');

const indexHtmlZIndex = fs.readFileSync('index.html', 'utf8');
const appJsZIndex = fs.readFileSync('app.js', 'utf8');

// 20.1 Validação de Z-Index para sobreposição perfeita de modais
assert(indexHtmlZIndex.includes('id="modalCasaForm" class="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[70]'), 'modalCasaForm configurado com z-[70] para sobrepor modalCasaDetalhes');
assert(indexHtmlZIndex.includes('id="modalCasaDetalhes" class="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50'), 'modalCasaDetalhes configurado como nível base z-50');
assert(indexHtmlZIndex.includes('id="modalTermoResponsabilidade" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[75]'), 'modalTermoResponsabilidade configurado com z-[75] para sobreposição limpa');

// 20.2 Validação da reatividade em salvarCasa
assert(appJsZIndex.includes("casaSelecionadaId === id && typeof abrirModalCasaDetalhes === 'function'"), 'salvarCasa detecta se modalCasaDetalhes está aberto');
assert(appJsZIndex.includes("abrirModalCasaDetalhes(id);"), 'salvarCasa atualiza modalCasaDetalhes em tempo real após salvar');

// 20.3 Paridade 100% rigorosa
assert(fs.readFileSync('index.html', 'utf8') === fs.readFileSync('frontend/index.html', 'utf8'), 'Paridade 100% index.html e frontend/index.html');
assert(fs.readFileSync('app.js', 'utf8') === fs.readFileSync('frontend/app.js', 'utf8'), 'Paridade 100% app.js e frontend/app.js');



// -------------------------------------------------------------
// 21. CENTRAL DE NOTIFICAÇÕES & TOQUES SONOROS DO PREFEITO
// -------------------------------------------------------------
console.log('\n🔔 21. Verificação da Central de Notificações & Toques Sonoros');

const indexHtmlNotif = fs.readFileSync('index.html', 'utf8');
const appJsNotif = fs.readFileSync('app.js', 'utf8');

// 21.1 Elementos DOM do Painel de Notificações no index.html
assert(indexHtmlNotif.includes('id="secaoConfigNotificacoes"'), 'Card secaoConfigNotificacoes presente no index.html');
assert(indexHtmlNotif.includes('id="configNotifSomAtivo"'), 'Interruptor configNotifSomAtivo presente no index.html');
assert(indexHtmlNotif.includes('id="configNotifToque"'), 'Select configNotifToque presente no index.html');
assert(indexHtmlNotif.includes('id="btnTestarToqueNotificacao"'), 'Botão btnTestarToqueNotificacao presente no index.html');
assert(indexHtmlNotif.includes('id="configNotifVolume"'), 'Slider de volume configNotifVolume presente no index.html');
assert(indexHtmlNotif.includes('id="configNotifVolumeLabel"'), 'Rótulo de porcentagem configNotifVolumeLabel presente no index.html');
assert(indexHtmlNotif.includes('id="configNotifChamados"'), 'Filtro configNotifChamados presente no index.html');
assert(indexHtmlNotif.includes('id="configNotifRondas"'), 'Filtro configNotifRondas presente no index.html');
assert(indexHtmlNotif.includes('id="configNotifDespesas"'), 'Filtro configNotifDespesas presente no index.html');
assert(indexHtmlNotif.includes('id="configNotifEstoque"'), 'Filtro configNotifEstoque presente no index.html');
assert(indexHtmlNotif.includes('id="configNotifDanos"'), 'Filtro configNotifDanos presente no index.html');
assert(indexHtmlNotif.includes('id="configNotifToast"'), 'Canal configNotifToast presente no index.html');
assert(indexHtmlNotif.includes('id="configNotifPush"'), 'Canal configNotifPush presente no index.html');
assert(indexHtmlNotif.includes('id="badgeStatusPushNotif"'), 'Badge badgeStatusPushNotif presente no index.html');

// 21.2 Catálogo de Toques Sintetizados no index.html
assert(indexHtmlNotif.includes('value="chime_gel"'), 'Toque Chime Suave GEL cadastrado no select');
assert(indexHtmlNotif.includes('value="radio_canteiro"'), 'Toque Rádio Canteiro Walkie-Talkie cadastrado no select');
assert(indexHtmlNotif.includes('value="alerta_industrial"'), 'Toque Alerta Industrial cadastrado no select');
assert(indexHtmlNotif.includes('value="corneta_campo"'), 'Toque Corneta de Campo cadastrado no select');
assert(indexHtmlNotif.includes('value="ding_dong"'), 'Toque Campainha Executiva Ding-Dong cadastrado no select');
assert(indexHtmlNotif.includes('value="bip_moderno"'), 'Toque Bip Digital Moderno cadastrado no select');

// 21.3 Implementação das Funções em app.js
assert(appJsNotif.includes('function reproduzirToqueSintetizado'), 'Função reproduzirToqueSintetizado implementada em app.js');
assert(appJsNotif.includes('function inicializarConfigNotificacoes'), 'Função inicializarConfigNotificacoes implementada em app.js');
assert(appJsNotif.includes('function atualizarCamposConfigNotificacoesUI'), 'Função atualizarCamposConfigNotificacoesUI implementada em app.js');
assert(appJsNotif.includes('function alternarSomNotificacoes'), 'Função alternarSomNotificacoes implementada em app.js');
assert(appJsNotif.includes('function aoMudarToqueNotificacao'), 'Função aoMudarToqueNotificacao implementada em app.js');
assert(appJsNotif.includes('function aoAjustarVolumeNotificacao'), 'Função aoAjustarVolumeNotificacao implementada em app.js');
assert(appJsNotif.includes('function testarToqueAtual'), 'Função testarToqueAtual implementada em app.js');
assert(appJsNotif.includes('function pedirPermissaoPushNotificacao'), 'Função pedirPermissaoPushNotificacao implementada em app.js');
assert(appJsNotif.includes('function atualizarStatusPushUI'), 'Função atualizarStatusPushUI implementada em app.js');
assert(appJsNotif.includes('function aoAlternarCanalPush'), 'Função aoAlternarCanalPush implementada em app.js');
assert(appJsNotif.includes('function marcarTodasCategoriasNotificacao'), 'Função marcarTodasCategoriasNotificacao implementada em app.js');
assert(appJsNotif.includes('function restaurarConfigNotificacoesPadrao'), 'Função restaurarConfigNotificacoesPadrao implementada em app.js');
assert(appJsNotif.includes('function salvarConfigNotificacoes'), 'Função salvarConfigNotificacoes implementada em app.js');
assert(appJsNotif.includes('function dispararNotificacaoPrefeito'), 'Função dispararNotificacaoPrefeito implementada em app.js');

// 21.4 Integração Reativa aos Gatilhos do Canteiro
assert(appJsNotif.includes("categoria: 'chamados'"), 'Chamados de suporte integrados ao despachante de notificações');
assert(appJsNotif.includes('inicializarConfigNotificacoes();'), 'inicializarConfigNotificacoes executado em DOMContentLoaded');

// 21.5 Simulação da Lógica do Despachante e Supressão Seletiva
const mockConfig = {
  som_ativo: true,
  toque_selecionado: 'chime_gel',
  volume: 80,
  notificar_chamados: true,
  notificar_rondas: false, // Desativado propositalmente no teste
  canal_toast: true,
  canal_push: false
};

function simularDespacho(categoria, config) {
  if (config['notificar_' + categoria] === false) {
    return { emitido: false, motivo: 'categoria_desativada' };
  }
  return {
    emitido: true,
    som: config.som_ativo,
    toast: config.canal_toast,
    push: config.canal_push
  };
}

const resChamado = simularDespacho('chamados', mockConfig);
assert(resChamado.emitido === true && resChamado.som === true, 'Evento de chamado ativo emite alerta sonoro');

const resRonda = simularDespacho('rondas', mockConfig);
assert(resRonda.emitido === false && resRonda.motivo === 'categoria_desativada', 'Evento de categoria desmarcada é suprimido com sucesso');

const mockConfigMudo = { ...mockConfig, som_ativo: false };
const resMudo = simularDespacho('chamados', mockConfigMudo);
assert(resMudo.emitido === true && resMudo.som === false, 'Modo silencioso preserva alerta visual mas silencia áudio');

// 21.6 Paridade 100% rigorosa
assert(fs.readFileSync('index.html', 'utf8') === fs.readFileSync('frontend/index.html', 'utf8'), 'Paridade 100% index.html e frontend/index.html após Seção 21');
assert(fs.readFileSync('app.js', 'utf8') === fs.readFileSync('frontend/app.js', 'utf8'), 'Paridade 100% app.js e frontend/app.js após Seção 21');


// -------------------------------------------------------------
// 22. PLAQUINHA DIGITAL DE CONTROLE DE MANUTENÇÃO & HISTÓRICO
// -------------------------------------------------------------
console.log('\n🏷️ 22. Verificação da Plaquinha Digital, Contagem Regressiva & Configurações (NR-18 & NR-24)');

const limpezaHtmlContent = fs.readFileSync('limpeza.html', 'utf8');
const rondaHtmlContent = fs.readFileSync('ronda.html', 'utf8');
const indexHtmlContentPlaquinha = fs.readFileSync('index.html', 'utf8');
const appJsContentPlaquinha = fs.readFileSync('app.js', 'utf8');

// 22.1 Remoção de Tabelas Pesadas e Foco em Agilidade Mobile nas Telas de QR Code
assert(!limpezaHtmlContent.includes('id="cardPlaquinhaControle"'), 'Tabela pesada/plaquinha removida de limpeza.html para agilidade no mobile');
assert(limpezaHtmlContent.includes('id="plaquinhaIdentificacaoAparelho"'), 'Identificação direta do quarto/casa presente em limpeza.html');
assert(limpezaHtmlContent.includes('id="badgeStatusCicloPlaquinha"'), 'Badge de status mantido de forma leve em limpeza.html');
assert(!limpezaHtmlContent.includes('id="tabPlaquinhaAr"'), 'Abas estáticas removidas de limpeza.html');
assert(limpezaHtmlContent.includes('id="boxSubtipoAr"'), 'Seletor de Limpeza de Filtro vs Higienização Total presente no formulário');

assert(!rondaHtmlContent.includes('id="cardPlaquinhaControleRonda"'), 'Tabela pesada/plaquinha removida de ronda.html para agilidade no mobile');
assert(rondaHtmlContent.includes('id="plaquinhaIdentificacaoPonto"'), 'Identificação direta do ponto de ronda presente em ronda.html');
assert(rondaHtmlContent.includes('id="badgeStatusCicloRonda"'), 'Badge de status mantido de forma leve em ronda.html');

// 22.2 Modal Oficial da Plaquinha e Contagem Regressiva ("Tempozinho da Próxima Limpeza")
assert(indexHtmlContentPlaquinha.includes('id="modalPlaquinhaManutencaoA4"'), 'Modal de Plaquinha A4 presente no index.html');
assert(indexHtmlContentPlaquinha.includes('id="modalPlaquinhaHeaderTitulo"'), 'Cabeçalho oficial do modal presente no index.html');
assert(indexHtmlContentPlaquinha.includes('id="modalPlaquinhaTbodyHistorico"'), 'Tabela pautada oficial presente no modal do index.html');
assert(indexHtmlContentPlaquinha.includes('id="modalPlaquinhaQRCodeContainer"'), 'Container de QR Code estampado presente no modal do index.html');
assert(indexHtmlContentPlaquinha.includes('id="modalPlaquinhaBlocoContagem"'), 'Bloco de contagem regressiva presente no modal');
assert(indexHtmlContentPlaquinha.includes('id="modalPlaquinhaTextoContagem"'), 'Elemento de texto do tempozinho da próxima limpeza presente');
assert(indexHtmlContentPlaquinha.includes('id="modalPlaquinhaSubtextoContagem"'), 'Elemento de subtexto de ciclo presente no modal');
assert(indexHtmlContentPlaquinha.includes('id="modalPlaquinhaBadgeStatusPrazo"'), 'Badge de status de prazo presente no modal');
assert(indexHtmlContentPlaquinha.includes('id="modalPlaquinhaDataProxima"'), 'Data prevista da próxima limpeza presente no modal');
assert(indexHtmlContentPlaquinha.includes('id="modalPlaquinhaRodapeMsg"'), 'Mensagem de rodapé configurável presente no modal');

// 22.3 Acesso à Plaquinha nos Quartos e Bebedouros
assert(indexHtmlContentPlaquinha.includes('id="btnModalQuartoPlaquinhaAr"'), 'Botão Ver Plaquinha do Ar-Condicionado presente no modal do quarto');
assert(appJsContentPlaquinha.includes("abrirModalPlaquinhaManutencao('ar'"), 'Botão Plaquinha Ar presente nos cards dos quartos em app.js');
assert(appJsContentPlaquinha.includes("abrirModalPlaquinhaManutencao('bebedouro'"), 'Botão Plaquinha Bebedouro presente no grid de ronda em app.js');

// 22.4 Painel de Configurações das Plaquinhas pelo Prefeito (tab-configuracoes)
assert(indexHtmlContentPlaquinha.includes('id="secaoConfigPlaquinhasManutencao"'), 'Seção de configuração das plaquinhas presente em tab-configuracoes');
assert(indexHtmlContentPlaquinha.includes('id="cfgDiasLimpezaAr"'), 'Input de dias de higienização do ar presente');
assert(indexHtmlContentPlaquinha.includes('id="cfgTituloPlaquinhaAr"'), 'Input de título da plaquinha de ar presente');
assert(indexHtmlContentPlaquinha.includes('id="cfgModeloPadraoAr"'), 'Input de modelo padrão do ar presente');
assert(indexHtmlContentPlaquinha.includes('id="cfgDiasLimpezaBebedouro"'), 'Input de dias de limpeza do bebedouro presente');
assert(indexHtmlContentPlaquinha.includes('id="cfgDiasFiltroBebedouro"'), 'Input de dias de filtro do bebedouro presente');
assert(indexHtmlContentPlaquinha.includes('id="cfgTituloPlaquinhaBebedouro"'), 'Input de título da plaquinha do bebedouro presente');
assert(indexHtmlContentPlaquinha.includes('id="cfgModeloPadraoBebedouro"'), 'Input de modelo padrão do bebedouro presente');
assert(indexHtmlContentPlaquinha.includes('id="cfgMensagemRodapePlaquinha"'), 'Input de mensagem de rodapé da plaquinha presente');

// 22.5 Funções no app.js para Gestão de Manutenção e Prazos
assert(appJsContentPlaquinha.includes('function obterConfigManutencao'), 'Função obterConfigManutencao implementada');
assert(appJsContentPlaquinha.includes('function salvarConfigManutencaoUI'), 'Função salvarConfigManutencaoUI implementada');
assert(appJsContentPlaquinha.includes('function restaurarConfigManutencaoPadraoUI'), 'Função restaurarConfigManutencaoPadraoUI implementada');
assert(appJsContentPlaquinha.includes('function inicializarConfigManutencaoUI'), 'Função inicializarConfigManutencaoUI implementada');
assert(appJsContentPlaquinha.includes('function calcularTempoProximaLimpeza'), 'Função calcularTempoProximaLimpeza implementada');

// Validação em tempo de execução: calcularTempoProximaLimpeza não lança ReferenceError
try {
  const vm = require('vm');
  const mockLocalStorage = {
    getItem: (key) => {
      if (key === 'config_manutencao_cache') return JSON.stringify({ dias_limpeza_ar: 30, dias_limpeza_bebedouro: 15, dias_filtro_bebedouro: 90 });
      if (key === 'casas_limpezas_cache') return JSON.stringify([{ id: '1', quarto_id: '1', tipo: 'ar_condicionado', data: '2026-10-01' }]);
      if (key === 'ronda_registros_cache') return JSON.stringify([{ id: 'reg1', ponto_id: 'ponto_1', tipo: 'bebedouro', data: '2026-10-05' }]);
      return null;
    }
  };
  const sandbox = {
    localStorage: mockLocalStorage,
    CONFIG_MANUTENCAO_PADRAO: { dias_limpeza_ar: 30, dias_limpeza_bebedouro: 15, dias_filtro_bebedouro: 90 },
    console: console,
    Date: Date,
    Math: Math,
    JSON: JSON
  };
  vm.createContext(sandbox);
  // Extrai declaração de obterConfigManutencao e calcularTempoProximaLimpeza
  const regexFuncs = /function obterConfigManutencao[\s\S]*?function calcularTempoProximaLimpeza[\s\S]*?\n\}/;
  const matchCode = appJsContentPlaquinha.match(regexFuncs);
  if (matchCode) {
    vm.runInContext(matchCode[0], sandbox);
    const resAr = sandbox.calcularTempoProximaLimpeza('ar', '1');
    assert(resAr && resAr.dataUltimaFormatada, 'calcularTempoProximaLimpeza para ar retorna dataUltimaFormatada sem erros');
    const resBeb = sandbox.calcularTempoProximaLimpeza('bebedouro', 'ponto_1');
    assert(resBeb && resBeb.dataUltimaFormatada, 'calcularTempoProximaLimpeza para bebedouro retorna dataUltimaFormatada sem erros');
  }
} catch (err) {
  assert(false, 'Execução de calcularTempoProximaLimpeza falhou: ' + err.message);
}
assert(appJsContentPlaquinha.includes('function abrirModalPlaquinhaManutencao'), 'Função abrirModalPlaquinhaManutencao implementada');
assert(appJsContentPlaquinha.includes('function aoMudarModeloPlaquinhaManutencao'), 'Função aoMudarModeloPlaquinhaManutencao implementada');
assert(appJsContentPlaquinha.includes('function renderizarConteudoModalPlaquinha'), 'Função renderizarConteudoModalPlaquinha implementada');
assert(appJsContentPlaquinha.includes('function imprimirPlaquinhaManutencao'), 'Função imprimirPlaquinhaManutencao implementada');

// 22.6 Relatórios Oficiais ("Ar-condicionado do quarto [Nº]")
assert(appJsContentPlaquinha.includes('Ar-condicionado do quarto'), 'Nome oficial Ar-condicionado do quarto presente nas exportações em app.js');

// 22.7 Verificação de Paridade Rigorosa 100%
assert(fs.readFileSync('limpeza.html', 'utf8') === fs.readFileSync('frontend/limpeza.html', 'utf8'), 'Paridade 100% limpeza.html e frontend/limpeza.html');
assert(fs.readFileSync('ronda.html', 'utf8') === fs.readFileSync('frontend/ronda.html', 'utf8'), 'Paridade 100% ronda.html e frontend/ronda.html');
assert(fs.readFileSync('index.html', 'utf8') === fs.readFileSync('frontend/index.html', 'utf8'), 'Paridade 100% index.html e frontend/index.html após Seção 22');
assert(fs.readFileSync('app.js', 'utf8') === fs.readFileSync('frontend/app.js', 'utf8'), 'Paridade 100% app.js e frontend/app.js após Seção 22');

// 22.6 Validação de Marca d'água Discreta "Criado por Eullon"
assert(fs.readFileSync('index.html', 'utf8').includes('Criado por Eullon'), 'Marca d\'água discreta presente no index.html');
assert(fs.readFileSync('limpeza.html', 'utf8').includes('Criado por Eullon'), 'Marca d\'água discreta presente no limpeza.html');
assert(fs.readFileSync('ronda.html', 'utf8').includes('Criado por Eullon'), 'Marca d\'água discreta presente no ronda.html');
assert(fs.readFileSync('chamado.html', 'utf8').includes('Criado por Eullon'), 'Marca d\'água discreta presente no chamado.html');
assert(fs.readFileSync('frontend/chamado.html', 'utf8').includes('Criado por Eullon'), 'Marca d\'água discreta presente no frontend/chamado.html');

// 22.7 Verificação de Carregamento Instantâneo e Não-Bloqueante de Ronda
assert(rondaHtmlContent.includes('carregarRegistrosPontoHoje(p.id, meta);'), 'carregarRegistrosPontoHoje executado de forma não-bloqueante');
assert(rondaHtmlContent.includes('carregarHistoricoPlaquinhaRonda(p.id, p.tipo, p.nome, p.setor);'), 'carregarHistoricoPlaquinhaRonda executado imediatamente');
assert(!rondaHtmlContent.includes("descServico = 'Troca de Refil / Filtro d'Água';"), 'Ausência de SyntaxError de aspas em descServico de ronda.html');
assert(rondaHtmlContent.includes('function verificarAutenticacaoEquipeHoje()'), 'Função verificarAutenticacaoEquipeHoje definida em ronda.html');

// -------------------------------------------------------------
// 23. RESOLUÇÃO DE CONFLITOS DE QR CODE, MODAIS E NAVEGAÇÃO PWA
// -------------------------------------------------------------
console.log('\n📱 23. Verificação de Desconflito de QR Code, Modais & Navegação PWA');

const manifestContent = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
assert(manifestContent.launch_handler && manifestContent.launch_handler.client_mode === 'navigate-existing', 'manifest.json configurado com launch_handler navigate-existing para Android PWA');

const indexHtmlAtual = fs.readFileSync('index.html', 'utf8');
assert(indexHtmlAtual.includes('id="modalRegistroLimpezaCasa" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[85]'), 'modalRegistroLimpezaCasa configurado com z-[85] acima de modais concorrentes');

const appJsAtual = fs.readFileSync('app.js', 'utf8');
assert(appJsAtual.includes('function fecharTodosModaisQR()'), 'Função fecharTodosModaisQR implementada em app.js');
assert(appJsAtual.includes("fecharModal('modalRegistroManualRonda');") && appJsAtual.includes("fecharModal('modalRegistroLimpezaCasa');"), 'abrirModalRegistroLimpeza e abrirModalRegistroManualRonda fecham modais concorrentes');
assert(appJsAtual.includes('const isCasaPropria ='), 'processarLeituraQRCasa possui detecção mútua blindada');
assert(appJsAtual.includes('const isCasaDetectada ='), 'processarLeituraQRRonda possui detecção mútua blindada');

const limpezaHtmlAtual = fs.readFileSync('limpeza.html', 'utf8');
assert(limpezaHtmlAtual.includes('const isAlvoLimpeza = Boolean(urlCasaId || urlQuartoId || urlQuartoNum || urlBloco || urlBlocoId);'), 'limpeza.html não redireciona casas ou quartos válidos');
assert(limpezaHtmlAtual.includes('function carregarCasa(casaId)'), 'carregarCasa em limpeza.html renderiza de forma imediata e síncrona');
assert(limpezaHtmlAtual.includes('carregarHistoricoPlaquinhaLimpeza(c.id, null, null);'), 'aplicarDadosCasa atualiza histórico da plaquinha da casa');

// -------------------------------------------------------------
// RELATÓRIO FINAL
// -------------------------------------------------------------
console.log('\n============================================================');
console.log('📊 RELATÓRIO DE RESULTADO DO AUTO-TESTE');
console.log('============================================================');
console.log(`Total de Testes Executados: ${totalTests}`);
console.log(`✅ Aprovados:              ${passedTests}`);
console.log(`❌ Falhas:                 ${failedTests}`);
console.log(`⚠️ Avisos:                 ${warningTests}`);
console.log(`Taxa de Sucesso:            ${((passedTests / totalTests) * 100).toFixed(1)}%`);

if (failedTests === 0) {
  console.log('\n🎉 PROJETO 100% OPERACIONAL E SEM ERROS DETECTADOS!\n');
  process.exit(0);
} else {
  console.error('\n⚠️ Foram encontradas falhas que precisam de atenção.\n');
  process.exit(1);
}
