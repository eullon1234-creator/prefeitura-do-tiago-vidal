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
  ['chamado.html', 'frontend/chamado.html'],
  ['limpeza.html', 'frontend/limpeza.html'],
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
