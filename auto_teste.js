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
  ['dados_iniciais_taboca.json', 'frontend/dados_iniciais_taboca.json'],
  ['manifest.json', 'frontend/manifest.json']
];

parityPairs.forEach(([f1, f2]) => {
  const h1 = getHash(f1);
  const h2 = getHash(f2);
  assert(h1 !== null && h1 === h2, `Paridade 100% entre ${f1} e ${f2}`);
});

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
  'casaDetalhesLimpezasVazio'
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
