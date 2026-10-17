// ========================================================
// PREFEITURA DE CANTEIRO - CONTROLE DE ALOJAMENTOS
// Frontend Client Logic
// ========================================================

const API_BASE = ''; // Same origin
let currentUserRole = 'prefeito'; // 'prefeito' ou 'consulta'
let currentUserName = 'Prefeito da Obra';
let activeTab = 'dashboard';

// Cache de Dados
let globalStats = null;
let globalBlocos = [];
let globalEmpresas = [];
let globalQuartos = [];
let globalVagasLivres = [];
let chartBlocosInstance = null;
let chartEmpresasInstance = null;
let chartCasasCidadeInstance = null;
let chartCasasTabInstance = null;
let modoVisualizacaoChartBlocos = 'todos'; // 'todos' | 'casas' | 'blocos'

// Filtros atuais do mapa de quartos
let filtroBlocoAtivo = '';
let debounceTimerAlojados = null;
let quartoSelecionadoId = null;

// ========================================================
// ENGINE CLIENTE ESTÁTICO (GITHUB PAGES & NUVEM SEM BACKEND)
// ========================================================
const originalFetch = window.fetch.bind(window);
const IS_GITHUB_PAGES = window.location.hostname.includes('github.io') || window.location.hostname.includes('github.dev') || window.location.protocol === 'file:' || !window.location.port || window.location.port === '5500';
let staticModeActive = IS_GITHUB_PAGES;

// Sincronização leve de alteração individual com Firebase (Economia de dados)
function sincronizarAlteracaoLeveFirebase(colecao, docId, dados) {
  if (typeof firebaseInitialized !== 'undefined' && firebaseInitialized && typeof firestoreDb !== 'undefined' && firestoreDb) {
    try {
      firestoreDb.collection(colecao).doc(String(docId)).set({
        id: Number(docId) || docId,
        ...dados,
        atualizado_em: new Date().toISOString()
      }, { merge: true }).catch(err => {
        if (err && (err.code === 'permission-denied' || (err.message && err.message.toLowerCase().includes('permission')))) {
          console.warn("⚠️ Firebase Firestore: Permissão negada nas regras de segurança do console.");
          if (typeof atualizarBadgeFirebaseUI === 'function') atualizarBadgeFirebaseUI(false, "Permissões Pendentes");
          const alertEl = document.getElementById('firebaseRulesAlert');
          if (alertEl) alertEl.classList.remove('hidden');
        }
      });
    } catch (e) {
      // Offline fallback silencioso
    }
  }
}

const StaticApiEngine = {
  dbState: {
    geral: null,
    blocos: [],
    empresas: [],
    quartos: [],
    alojados: [],
    auditoria: []
  },
  initialized: false,
  initPromise: null,

  async init() {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        // 1. Tentar ler do localStorage primeiro (para manter edições do usuário no navegador)
        const localSaved = localStorage.getItem('prefeitura_taboca_snapshot');
        if (localSaved) {
          try {
            const parsed = JSON.parse(localSaved);
            if (parsed && parsed.quartos && parsed.quartos.length > 0) {
              this.dbState = parsed;
              
              // LIMPEZA AUTOMÁTICA: Purgar registros fantasmas sem nome gerados acidentalmente
              const antesAlojados = (this.dbState.alojados || []).length;
              this.dbState.alojados = (this.dbState.alojados || []).filter(a => {
                if (!a || !a.nome_completo) return false;
                const n = a.nome_completo.trim();
                return n !== '' && n !== '??' && n !== '?' && n !== 'SEM NOME' && n !== 'N/A';
              });
              if (this.dbState.alojados.length !== antesAlojados) {
                console.log(`[LIMPEZA] Removidos ${antesAlojados - this.dbState.alojados.length} registros fantasmas do cache local.`);
                const validIds = new Set(this.dbState.alojados.map(a => a.id));
                (this.dbState.quartos || []).forEach(q => {
                  (q.vagas || []).forEach(v => {
                    if (v.alojado && (!validIds.has(v.alojado.id) || !v.alojado.nome_completo || v.alojado.nome_completo.trim() === '')) {
                      v.status = 'livre';
                      v.alojado = null;
                    }
                  });
                });
                this.saveToStorage();
              }

              // Migração de fotos antigas para ImgBB se existirem no snapshot local
              (this.dbState.alojados || []).forEach(a => {
                if (a.foto_url && a.foto_url.includes('alojado_1043_4d23f848.jpg')) {
                  a.foto_url = 'https://i.ibb.co/sppGW7kB/alojado-1043-4d23f848.jpg';
                }
              });
              (this.dbState.quartos || []).forEach(q => {
                (q.vagas || []).forEach(v => {
                  if (v.alojado && v.alojado.foto_url && v.alojado.foto_url.includes('alojado_1043_4d23f848.jpg')) {
                    v.alojado.foto_url = 'https://i.ibb.co/sppGW7kB/alojado-1043-4d23f848.jpg';
                  }
                });
              });

              // Migração: Garantir que todos os quartos possuam 'Fechadura' cadastrada em seus móveis
              let fechadurasAdicionadas = 0;
              const hojeData = new Date().toISOString().split('T')[0];
              (this.dbState.quartos || []).forEach(q => {
                if (!q.moveis) q.moveis = [];
                const temFechadura = q.moveis.some(m => m.tipo_item === 'Fechadura' || m.tipo_item === 'Trinco / Fechadura');
                if (!temFechadura) {
                  q.moveis.push({
                    id: (q.id * 100) + 13,
                    tipo_item: 'Fechadura',
                    quantidade: 1,
                    estado_conservacao: 'Bom',
                    precisa_manutencao: 0,
                    data_vistoria: hojeData,
                    observacoes: 'Fechadura da porta funcionando'
                  });
                  fechadurasAdicionadas++;
                }
              });
              if (fechadurasAdicionadas > 0) {
                console.log(`[MIGRAÇÃO] Fechadura adicionada em ${fechadurasAdicionadas} quartos no cache local.`);
                this.saveToStorage();
              }

              // Reconciliação imediata dos 12 reparos concluídos pelo prefeito na nuvem
              const reparadosIds = new Set([2650, 2668, 2709, 2728, 2866, 2908, 3057, 3208, 3585, 3598, 3634, 3694]);
              let reparosLocaisAplicados = 0;
              (this.dbState.quartos || []).forEach(q => {
                (q.moveis || []).forEach(m => {
                  if (reparadosIds.has(Number(m.id)) && (Number(m.precisa_manutencao) === 1 || m.estado_conservacao !== 'Bom')) {
                    m.precisa_manutencao = 0;
                    m.estado_conservacao = 'Bom';
                    m.data_vistoria = '2026-09-26';
                    reparosLocaisAplicados++;
                  }
                });
              });
              if (reparosLocaisAplicados > 0) {
                console.log(`[REPAROS] ${reparosLocaisAplicados} móveis reparados reconciliados com sucesso do cache local.`);
                this.saveToStorage();
              }

              this.recomputeStats();
              this.initialized = true;
              console.log("StaticApiEngine: Estado carregado do localStorage com sucesso.");
              return;
            }
          } catch(e) { /* fallback */ }
        }

        // 2. Carregar do arquivo estático dados_iniciais_taboca.json
        const res = await originalFetch('dados_iniciais_taboca.json');
        if (!res.ok) throw new Error('Falha ao obter dados_iniciais_taboca.json');
        const data = await res.json();
        
        this.dbState.geral = data.geral;
        this.dbState.blocos = data.blocos || [];
        this.dbState.empresas = data.empresas || [];
        this.dbState.quartos = data.quartos || [];
        this.dbState.alojados = data.alojados || [];
        this.dbState.auditoria = [];

        this.recomputeStats();
        this.saveToStorage();
        this.initialized = true;
        console.log("StaticApiEngine: Banco de dados em memória inicializado (387 alojados, 220 quartos, 10 blocos).");
      } catch (err) {
        console.error("StaticApiEngine init falhou:", err);
      }
    })();

    return this.initPromise;
  },

  saveToStorage() {
    try {
      localStorage.setItem('prefeitura_taboca_snapshot', JSON.stringify(this.dbState));
    } catch(e) {
      console.warn("Storage quota excedida ou erro ao salvar snapshot:", e);
    }
  },

  recomputeStats() {
    const quartos = this.dbState.quartos || [];
    const alojados = this.dbState.alojados || [];
    const blocos = this.dbState.blocos || [];
    const empresas = this.dbState.empresas || [];

    // Reconciliar vagas com alojados para garantir consistência de ID e metadados
    const activeAlojados = alojados.filter(a => a.status === 'ativo');
    const alojadoMapByVaga = new Map();
    const alojadoMapByQuartoCama = new Map();
    activeAlojados.forEach(a => {
      if (a.vaga_id) alojadoMapByVaga.set(Number(a.vaga_id), a);
      if (a.quarto_numero && a.numero_cama) {
        const key = `${(a.bloco_nome || '').trim().toLowerCase()}_${String(a.quarto_numero).trim()}_${Number(a.numero_cama)}`;
        alojadoMapByQuartoCama.set(key, a);
      }
    });

    // Recalcular status por quarto
    quartos.forEach(q => {
      const vagas = q.vagas || [];
      vagas.forEach(v => {
        if (!v.vaga_id && v.id) v.vaga_id = v.id;
        if (!v.id && v.vaga_id) v.id = v.vaga_id;

        // Blindagem: Se a vaga ainda aponta para um alojado, verificar se esse alojado não foi mudado ou desligado
        if (v.alojado_id) {
          const alAtual = activeAlojados.find(x => Number(x.id) === Number(v.alojado_id));
          if (!alAtual || (Number(alAtual.vaga_id) !== Number(v.id) && (String(alAtual.quarto_numero).trim() !== String(q.numero).trim() || Number(alAtual.numero_cama) !== Number(v.numero_cama)))) {
            // Este colaborador não pertence mais a esta vaga (foi movido ou desligado) -> Liberar vaga antiga imediatamente
            v.status = 'livre';
            v.alojado = null;
            v.alojado_id = null;
            v.nome_completo = null;
            v.matricula = null;
            v.funcao = null;
            v.empresa_nome = null;
            v.empresa_cor = null;
            v.foto_url = null;
            v.whatsapp = null;
          }
        }

        let a = null;
        if (v.id) {
          a = alojadoMapByVaga.get(Number(v.id));
        }
        if (!a && q.numero && v.numero_cama) {
          const key = `${(q.bloco_nome || '').trim().toLowerCase()}_${String(q.numero).trim()}_${Number(v.numero_cama)}`;
          a = alojadoMapByQuartoCama.get(key);
        }
        if (!a && v.alojado_id) {
          a = activeAlojados.find(x => Number(x.id) === Number(v.alojado_id));
        }

        if (a && a.status === 'ativo') {
          v.status = 'ocupada';
          v.alojado_id = a.id;
          v.nome_completo = a.nome_completo;
          v.matricula = a.matricula || '';
          v.funcao = a.funcao || '';
          v.empresa_nome = a.empresa_nome || '';
          v.empresa_cor = a.empresa_cor || '#2563eb';
          v.foto_url = a.foto_url || null;
          v.whatsapp = a.whatsapp || '';
          v.alojado = { ...a };
          a.vaga_id = v.id;
          a.quarto_numero = q.numero;
          a.bloco_nome = q.bloco_nome;
          a.numero_cama = v.numero_cama;
        } else if (v.status === 'ocupada' && !a && !v.alojado && !v.nome_completo) {
          v.status = 'livre';
          v.alojado = null;
          v.alojado_id = null;
        }
      });

      const cap = q.capacidade || vagas.length || 4;
      const oc = vagas.filter(v => v.status === 'ocupada').length;
      const liv = cap - oc;
      q.total_camas = cap;
      q.vagas_ocupadas = oc;
      q.vagas_livres = liv >= 0 ? liv : 0;
      
      const moveisAlerta = (q.moveis || []).filter(m => m.precisa_manutencao === 1 || m.estado_conservacao === 'Ruim' || m.estado_conservacao === 'Danificado').length;
      const isDesativado = q.ativo === false || q.status === 'desativado';
      if (isDesativado) {
        q.ativo = false;
        q.status = 'desativado';
        q.status_visual = 'desativado';
        q.cor_status = 'slate';
      } else {
        q.ativo = true;
        if (q.status !== 'desativado') q.status = 'ativo';
        if (liv <= 0) {
          q.status_visual = 'lotado';
          q.cor_status = 'red';
        } else if (oc >= cap - 1 && liv > 0) {
          q.status_visual = 'quase_cheio';
          q.cor_status = 'amber';
        } else if (oc === 0) {
          q.status_visual = 'vazio';
          q.cor_status = 'slate';
        } else {
          q.status_visual = 'com_vagas';
          q.cor_status = 'emerald';
        }
      }
    });

    // Recalcular blocos
    blocos.forEach(b => {
      const qBloco = quartos.filter(q => q.bloco_id == b.id);
      const qAtivos = qBloco.filter(q => q.ativo !== false && q.status !== 'desativado');
      const qDesativados = qBloco.filter(q => q.ativo === false || q.status === 'desativado');
      b.total_quartos = qBloco.length;
      b.quartos_ativos = qAtivos.length;
      b.quartos_desativados = qDesativados.length;
      b.total_vagas = qAtivos.reduce((s, q) => s + (Number(q.capacidade) || 4), 0);
      b.vagas_desativadas = qDesativados.reduce((s, q) => s + (Number(q.capacidade) || 4), 0);
      b.ocupadas = qAtivos.reduce((s, q) => s + (q.vagas_ocupadas || 0), 0);
      b.livres = Math.max(0, b.total_vagas - b.ocupadas);
      b.taxa_ocupacao = b.total_vagas > 0 ? Number(((b.ocupadas / b.total_vagas) * 100).toFixed(1)) : 0;
      b.itens_alerta = qBloco.reduce((s, q) => s + (q.itens_alerta || 0), 0);
    });

    // Recalcular empresas
    empresas.forEach(e => {
      e.total_alojados = alojados.filter(a => a.status === 'ativo' && (a.empresa_id == e.id || a.empresa_nome === e.nome)).length;
    });

    // Recalcular Geral
    const totVagas = blocos.reduce((s, b) => s + b.total_vagas, 0);
    const totVagasDesativadas = blocos.reduce((s, b) => s + (b.vagas_desativadas || 0), 0);
    const totQuartosAtivos = quartos.filter(q => q.ativo !== false && q.status !== 'desativado').length;
    const totQuartosDesativados = quartos.filter(q => q.ativo === false || q.status === 'desativado').length;
    const totOcup = alojados.filter(a => a.status === 'ativo').length;
    const totDesl = alojados.filter(a => a.status === 'desligado').length;
    const totAlertas = quartos.reduce((s, q) => s + (q.itens_alerta || 0), 0);

    this.dbState.geral = {
      total_vagas: totVagas,
      total_vagas_desativadas: totVagasDesativadas,
      ocupadas: totOcup,
      disponiveis: (totVagas - totOcup) >= 0 ? (totVagas - totOcup) : 0,
      taxa_ocupacao: totVagas > 0 ? Number(((totOcup / totVagas) * 100).toFixed(1)) : 0,
      total_blocos: blocos.length,
      total_quartos: quartos.length,
      total_quartos_ativos: totQuartosAtivos,
      total_quartos_desativados: totQuartosDesativados,
      total_alojados_ativos: totOcup,
      total_desligados: totDesl,
      total_alertas_manutencao: totAlertas
    };
  },

  async handle(url, init = {}) {
    await this.init();
    const method = (init.method || 'GET').toUpperCase();
    const u = new URL(url, window.location.href);
    const path = u.pathname;
    const params = u.searchParams;
    let body = null;
    if (init.body) {
      try { body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body; } catch(e) {}
    }

    // 1. Dashboard
    if (path.includes('/api/dashboard/stats')) {
      this.recomputeStats();
      const alertas = [];
      this.dbState.quartos.forEach(q => {
        (q.moveis || []).forEach(m => {
          if (m.precisa_manutencao === 1 || m.estado_conservacao === 'Ruim' || m.estado_conservacao === 'Danificado') {
            alertas.push({
              ...m,
              bloco_nome: q.bloco_nome,
              quarto_numero: q.numero
            });
          }
        });
      });
      return {
        geral: this.dbState.geral,
        blocos: this.dbState.blocos,
        empresas: this.dbState.empresas,
        alertas_moveis: alertas
      };
    }

    // 2. Blocos
    if (path.endsWith('/api/blocos') || path.includes('/api/blocos?')) {
      if (method === 'POST') {
        const novoBloco = {
          id: Date.now(),
          nome: body.nome.trim(),
          tipo: body.tipo || 'alojamento',
          ordem: Number(body.ordem) || 0,
          total_quartos: 0,
          total_vagas: 0,
          ocupadas: 0,
          livres: 0,
          taxa_ocupacao: 0,
          itens_alerta: 0
        };
        this.dbState.blocos.push(novoBloco);
        this.recomputeStats();
        this.saveToStorage();
        sincronizarAlteracaoLeveFirebase('blocos', novoBloco.id, novoBloco);
        return { id: novoBloco.id, message: "Bloco criado com sucesso" };
      }
      this.recomputeStats();
      return this.dbState.blocos;
    }
    const matchBlocoId = path.match(/\/api\/blocos\/(\d+)/);
    if (matchBlocoId) {
      const bId = Number(matchBlocoId[1]);
      if (method === 'PUT') {
        const b = this.dbState.blocos.find(x => x.id === bId);
        if (b) {
          b.nome = body.nome || b.nome;
          b.tipo = body.tipo || b.tipo;
          b.ordem = Number(body.ordem) || b.ordem;
          this.recomputeStats();
          this.saveToStorage();
          sincronizarAlteracaoLeveFirebase('blocos', b.id, b);
        }
        return { message: "Bloco atualizado" };
      }
      if (method === 'DELETE') {
        this.dbState.blocos = this.dbState.blocos.filter(x => x.id !== bId);
        this.recomputeStats();
        this.saveToStorage();
        sincronizarAlteracaoLeveFirebase('blocos', bId, { id: bId, excluido: true });
        return { message: "Bloco excluído" };
      }
    }

    // 3. Empresas
    if (path.endsWith('/api/empresas') || path.includes('/api/empresas?')) {
      if (method === 'POST') {
        const novaEmp = {
          id: Date.now(),
          nome: body.nome.trim(),
          cor: body.cor || '#3b82f6',
          total_alojados: 0
        };
        this.dbState.empresas.push(novaEmp);
        this.saveToStorage();
        sincronizarAlteracaoLeveFirebase('empresas', novaEmp.id, novaEmp);
        return { id: novaEmp.id, message: "Empresa criada com sucesso" };
      }
      this.recomputeStats();
      return this.dbState.empresas;
    }
    const matchEmpId = path.match(/\/api\/empresas\/(\d+)/);
    if (matchEmpId) {
      const eId = Number(matchEmpId[1]);
      if (method === 'PUT') {
        const e = this.dbState.empresas.find(x => x.id === eId);
        if (e) {
          e.nome = body.nome || e.nome;
          e.cor = body.cor || e.cor;
          this.saveToStorage();
          sincronizarAlteracaoLeveFirebase('empresas', e.id, e);
        }
        return { message: "Empresa atualizada" };
      }
      if (method === 'DELETE') {
        this.dbState.empresas = this.dbState.empresas.filter(x => x.id !== eId);
        this.saveToStorage();
        sincronizarAlteracaoLeveFirebase('empresas', eId, { id: eId, excluido: true });
        return { message: "Empresa excluída" };
      }
    }

    // 4. Vagas Livres
    if (path.includes('/api/vagas/livres')) {
      this.recomputeStats();
      const livres = [];
      this.dbState.quartos.forEach(q => {
        if (q.ativo === false || q.status === 'desativado') return; // Quartos desativados não ofertam vagas livres!
        (q.vagas || []).forEach(v => {
          if (v.status === 'livre') {
            livres.push({
              vaga_id: v.id,
              quarto_id: q.id,
              quarto_numero: q.numero,
              bloco_id: q.bloco_id,
              bloco_nome: q.bloco_nome,
              numero_cama: v.numero_cama
            });
          }
        });
      });
      return livres;
    }

    // 5. Quartos
    const matchQuartoDetalhe = path.match(/\/api\/quartos\/(\d+)$/);
    if (matchQuartoDetalhe && method === 'GET') {
      const qId = Number(matchQuartoDetalhe[1]);
      const q = this.dbState.quartos.find(x => x.id === qId);
      if (q) return q;
      throw new Error("Quarto não encontrado");
    }
    if (matchQuartoDetalhe && method === 'PUT') {
      const qId = Number(matchQuartoDetalhe[1]);
      const q = this.dbState.quartos.find(x => x.id === qId);
      if (q) {
        if (body.numero !== undefined) q.numero = String(body.numero);
        if (body.capacidade !== undefined) {
          const novaCap = Number(body.capacidade) || q.capacidade;
          const qtdAtual = (q.vagas || []).length;
          if (novaCap > qtdAtual) {
            for (let c = qtdAtual + 1; c <= novaCap; c++) {
              q.vagas.push({ id: Date.now() + c, numero_cama: c, status: q.status === 'desativado' ? 'desativada' : 'livre', alojado: null });
            }
          }
          q.capacidade = novaCap;
        }
        if (body.ativo !== undefined) {
          q.ativo = Boolean(body.ativo);
          q.status = q.ativo ? 'ativo' : 'desativado';
        }
        if (body.status !== undefined) {
          q.status = body.status;
          q.ativo = (body.status !== 'desativado');
        }
        if (body.observacoes !== undefined) q.observacoes = body.observacoes;
        
        // Ajustar status das vagas se desativado/ativado
        if (q.status === 'desativado') {
          (q.vagas || []).forEach(v => {
            if (v.status !== 'ocupada') v.status = 'desativada';
          });
        } else if (q.status === 'ativo') {
          (q.vagas || []).forEach(v => {
            if (v.status === 'desativada') v.status = 'livre';
          });
        }

        this.recomputeStats();
        this.saveToStorage();
        sincronizarAlteracaoLeveFirebase('quartos', q.id, {
          id: q.id,
          numero: q.numero,
          capacidade: q.capacidade,
          ativo: q.ativo,
          status: q.status,
          observacoes: q.observacoes,
          bloco_id: q.bloco_id,
          bloco_nome: q.bloco_nome
        });
      }
      return { message: "Quarto atualizado" };
    }
    if (matchQuartoDetalhe && method === 'DELETE') {
      const qId = Number(matchQuartoDetalhe[1]);
      this.dbState.quartos = this.dbState.quartos.filter(x => x.id !== qId);
      this.recomputeStats();
      this.saveToStorage();
      sincronizarAlteracaoLeveFirebase('quartos', qId, { id: qId, excluido: true });
      return { message: "Quarto excluído" };
    }
    if (path.includes('/api/quartos')) {
      if (method === 'POST') {
        const novoId = Date.now();
        const bloco = this.dbState.blocos.find(b => b.id == body.bloco_id) || { nome: 'Bloco', tipo: 'alojamento' };
        const cap = Number(body.capacidade) || 4;
        const isAtivo = body.ativo !== false && body.status !== 'desativado';
        const vagas = [];
        for (let i = 1; i <= cap; i++) {
          vagas.push({ id: novoId + i, numero_cama: i, status: isAtivo ? 'livre' : 'desativada', alojado: null });
        }
        const moveis = [
          { id: novoId + 10, tipo_item: 'Ar-Condicionado', quantidade: 1, estado_conservacao: 'Bom', precisa_manutencao: 0, data_vistoria: new Date().toISOString().split('T')[0], observacoes: 'Funcionando' },
          { id: novoId + 11, tipo_item: 'Beliche / Camas', quantidade: 2, estado_conservacao: 'Bom', precisa_manutencao: 0, data_vistoria: new Date().toISOString().split('T')[0], observacoes: 'Em bom estado' },
          { id: novoId + 12, tipo_item: 'Guarda-roupa / Armário', quantidade: 4, estado_conservacao: 'Bom', precisa_manutencao: 0, data_vistoria: new Date().toISOString().split('T')[0], observacoes: 'Em bom estado' },
          { id: novoId + 13, tipo_item: 'Fechadura', quantidade: 1, estado_conservacao: 'Bom', precisa_manutencao: 0, data_vistoria: new Date().toISOString().split('T')[0], observacoes: 'Fechadura da porta funcionando' }
        ];
        const novoQ = {
          id: novoId,
          bloco_id: Number(body.bloco_id),
          bloco_nome: bloco.nome,
          bloco_tipo: bloco.tipo,
          numero: String(body.numero),
          capacidade: cap,
          ativo: isAtivo,
          status: isAtivo ? 'ativo' : 'desativado',
          observacoes: body.observacoes || '',
          vagas: vagas,
          moveis: moveis
        };
        this.dbState.quartos.push(novoQ);
        this.recomputeStats();
        this.saveToStorage();
        sincronizarAlteracaoLeveFirebase('quartos', novoQ.id, novoQ);
        return { id: novoId, message: "Quarto criado com sucesso" };
      }
      this.recomputeStats();
      let res = [...this.dbState.quartos];
      const blocoId = params.get('bloco_id');
      const statusOcup = params.get('status_ocupacao');
      const filtroAlerta = params.get('filtro_alerta');
      const qQuery = params.get('q');

      if (blocoId) res = res.filter(q => q.bloco_id == blocoId);
      if (qQuery) {
        const s = qQuery.toLowerCase();
        res = res.filter(q => (q.numero && q.numero.toLowerCase().includes(s)) || (q.bloco_nome && q.bloco_nome.toLowerCase().includes(s)));
      }
      if (statusOcup) {
        if (statusOcup === 'com_vagas') res = res.filter(q => q.vagas_livres > 0);
        else if (statusOcup === 'lotado') res = res.filter(q => q.status_visual === 'lotado');
        else if (statusOcup === 'quase_cheio') res = res.filter(q => q.status_visual === 'quase_cheio');
        else if (statusOcup === 'vazio') res = res.filter(q => q.status_visual === 'vazio');
      }
      if (filtroAlerta === 'true') {
        res = res.filter(q => q.itens_alerta > 0);
      }
      return res;
    }

    // 6. Alojados
    // 6.1 Desligar
    const matchDesligar = path.match(/\/api\/alojados\/(\d+)\/desligar/);
    const isDesligarEndpoint = (path === '/api/alojados/desligar' || path.endsWith('/api/alojados/desligar'));
    if ((matchDesligar || isDesligarEndpoint) && method === 'POST') {
      const aId = matchDesligar ? Number(matchDesligar[1]) : Number(body.alojado_id);
      const alojado = this.dbState.alojados.find(x => x.id === aId);
      if (alojado) {
        alojado.status = 'desligado';
        alojado.data_saida = body.data_saida || new Date().toISOString().split('T')[0];
        const vagaAntigaId = alojado.vaga_id;
        alojado.vaga_id = null;
        alojado.quarto_numero = null;
        alojado.bloco_nome = null;
        alojado.numero_cama = null;

        // Liberar vaga
        this.dbState.quartos.forEach(q => {
          (q.vagas || []).forEach(v => {
            if (v.id === vagaAntigaId || v.alojado_id === aId || (v.alojado && v.alojado.id === aId)) {
              v.status = 'livre';
              v.alojado = null;
              v.alojado_id = null;
              v.nome_completo = null;
              v.matricula = null;
              v.funcao = null;
              v.empresa_nome = null;
              v.empresa_cor = null;
              v.foto_url = null;
            }
          });
        });
        this.recomputeStats();
        this.saveToStorage();
        sincronizarAlteracaoLeveFirebase('alojados', aId, {
          status: 'desligado',
          data_saida: alojado.data_saida,
          vaga_id: null,
          quarto_numero: null,
          bloco_nome: null,
          numero_cama: null
        });
      }
      return { message: "Alojado desligado e vaga liberada com sucesso" };
    }

    // 6.2 Realocar
    const matchRealocar = path.match(/\/api\/alojados\/(\d+)\/realocar/);
    const isRealocarEndpoint = (path === '/api/alojados/realocar' || path.endsWith('/api/alojados/realocar'));
    if ((matchRealocar || isRealocarEndpoint) && method === 'POST') {
      const aId = matchRealocar ? Number(matchRealocar[1]) : Number(body.alojado_id);
      const alojado = this.dbState.alojados.find(x => Number(x.id) === aId);
      const novaVagaId = Number(body.nova_vaga_id);
      if (!alojado) {
        throw new Error("Colaborador não encontrado para realocação.");
      }
      if (!novaVagaId) {
        throw new Error("Vaga de destino não informada.");
      }

      // 1. Liberar vaga antiga em todos os quartos (comparando por vaga_id anterior, ID do alojado e nome)
      const vagaAntigaId = Number(alojado.vaga_id);
      this.dbState.quartos.forEach(q => {
        (q.vagas || []).forEach(v => {
          const ehVagaAntiga = (vagaAntigaId && (Number(v.id) === vagaAntigaId || Number(v.vaga_id) === vagaAntigaId));
          const ehDesteAlojado = (Number(v.alojado_id) === aId || (v.alojado && Number(v.alojado.id) === aId) || (v.nome_completo && v.nome_completo.trim().toUpperCase() === alojado.nome_completo.trim().toUpperCase()));
          if (ehVagaAntiga || ehDesteAlojado) {
            v.status = 'livre';
            v.alojado = null;
            v.alojado_id = null;
            v.nome_completo = null;
            v.matricula = null;
            v.funcao = null;
            v.empresa_nome = null;
            v.empresa_cor = null;
            v.foto_url = null;
            v.whatsapp = null;
          }
        });
      });

      // 2. Localizar e ocupar nova vaga
      let foundRoom = null;
      let foundBed = null;
      this.dbState.quartos.forEach(q => {
        (q.vagas || []).forEach(v => {
          if (Number(v.id) === novaVagaId || Number(v.vaga_id) === novaVagaId) {
            foundRoom = q;
            foundBed = v;
          }
        });
      });

      if (!foundRoom || !foundBed) {
        throw new Error("A nova vaga selecionada não foi encontrada no canteiro.");
      }

      // Atualizar dados no alojado
      alojado.vaga_id = Number(foundBed.id || novaVagaId);
      alojado.bloco_nome = foundRoom.bloco_nome;
      alojado.quarto_numero = String(foundRoom.numero);
      alojado.numero_cama = Number(foundBed.numero_cama);
      alojado.status = 'ativo';

      // Atualizar dados na nova vaga
      foundBed.status = 'ocupada';
      foundBed.alojado_id = aId;
      foundBed.nome_completo = alojado.nome_completo;
      foundBed.matricula = alojado.matricula || '';
      foundBed.funcao = alojado.funcao || '';
      foundBed.empresa_nome = alojado.empresa_nome || '';
      foundBed.empresa_cor = alojado.empresa_cor || '#2563eb';
      foundBed.foto_url = alojado.foto_url || null;
      foundBed.whatsapp = alojado.whatsapp || '';
      foundBed.alojado = { ...alojado };

      // Auditoria
      if (!this.dbState.auditoria) this.dbState.auditoria = [];
      this.dbState.auditoria.unshift({
        id: Date.now(),
        acao: 'REALOCAR',
        usuario: body.usuario || currentUserName || 'Prefeito Vidal',
        data_hora: new Date().toLocaleString('pt-BR'),
        detalhes: `Colaborador '${alojado.nome_completo}' realocado para ${foundRoom.bloco_nome} - Quarto ${foundRoom.numero} (Cama ${foundBed.numero_cama}). Motivo: ${body.motivo || 'Administração'}`
      });

      this.recomputeStats();
      this.saveToStorage();

      sincronizarAlteracaoLeveFirebase('alojados', aId, {
        id: aId,
        vaga_id: alojado.vaga_id,
        bloco_nome: alojado.bloco_nome,
        quarto_numero: alojado.quarto_numero,
        numero_cama: alojado.numero_cama,
        status: 'ativo'
      });

      return { message: "Alojado realocado com sucesso" };
    }

    // 6.25 Reativar
    const matchReativar = path.match(/\/api\/alojados\/(\d+)\/reativar/);
    const isReativarEndpoint = (path === '/api/alojados/reativar' || path.endsWith('/api/alojados/reativar'));
    if ((matchReativar || isReativarEndpoint) && method === 'POST') {
      const aId = matchReativar ? Number(matchReativar[1]) : Number(body.alojado_id);
      const alojado = this.dbState.alojados.find(x => x.id === aId);
      const novaVagaId = Number(body.nova_vaga_id);
      if (!alojado) throw new Error("Colaborador não encontrado.");
      if (!novaVagaId) throw new Error("Vaga de destino não informada.");

      let foundRoom = null;
      let foundBed = null;
      this.dbState.quartos.forEach(q => {
        (q.vagas || []).forEach(v => {
          if (Number(v.id) === novaVagaId) {
            foundRoom = q;
            foundBed = v;
          }
        });
      });

      if (!foundRoom || !foundBed) {
        throw new Error("A vaga selecionada não foi encontrada.");
      }

      alojado.status = 'ativo';
      alojado.data_saida = null;
      alojado.data_entrada = body.data_entrada || new Date().toISOString().split('T')[0];
      alojado.vaga_id = novaVagaId;
      alojado.bloco_nome = foundRoom.bloco_nome;
      alojado.quarto_numero = foundRoom.numero;
      alojado.numero_cama = foundBed.numero_cama;

      foundBed.status = 'ocupada';
      foundBed.alojado_id = aId;
      foundBed.nome_completo = alojado.nome_completo;
      foundBed.matricula = alojado.matricula || '';
      foundBed.funcao = alojado.funcao || '';
      foundBed.empresa_nome = alojado.empresa_nome || '';
      foundBed.empresa_cor = alojado.empresa_cor || '#2563eb';
      foundBed.foto_url = alojado.foto_url || null;
      foundBed.alojado = { ...alojado };

      this.recomputeStats();
      this.saveToStorage();

      sincronizarAlteracaoLeveFirebase('alojados', aId, {
        status: 'ativo',
        data_saida: null,
        data_entrada: alojado.data_entrada,
        vaga_id: alojado.vaga_id,
        bloco_nome: alojado.bloco_nome,
        quarto_numero: alojado.quarto_numero,
        numero_cama: alojado.numero_cama
      });

      return { message: "Alojado reativado com sucesso" };
    }

    // 6.3 PUT / DELETE Alojado
    const matchAlojadoPut = path.match(/\/api\/alojados\/(\d+)$/);
    if (matchAlojadoPut && method === 'PUT') {
      const aId = Number(matchAlojadoPut[1]);
      const a = this.dbState.alojados.find(x => x.id === aId);
      if (a) {
        if (body.nome_completo) a.nome_completo = body.nome_completo.toUpperCase();
        if (body.matricula !== undefined) a.matricula = body.matricula;
        if (body.funcao !== undefined) a.funcao = body.funcao.toUpperCase();
        if (body.whatsapp !== undefined) a.whatsapp = body.whatsapp ? body.whatsapp.trim() : '';
        if (body.data_entrada !== undefined) a.data_entrada = body.data_entrada;
        if (body.observacoes !== undefined) a.observacoes = body.observacoes;
        if (body.foto_url !== undefined) a.foto_url = body.foto_url;
        if (body.empresa_id) {
          a.empresa_id = Number(body.empresa_id);
          const emp = this.dbState.empresas.find(e => e.id == a.empresa_id);
          if (emp) {
            a.empresa_nome = emp.nome;
            a.empresa_cor = emp.cor;
          }
        }
        // Atualiza na vaga
        this.dbState.quartos.forEach(q => {
          (q.vagas || []).forEach(v => {
            if (v.alojado && v.alojado.id === aId) {
              v.alojado = { ...a };
            }
          });
        });
        this.saveToStorage();
        sincronizarAlteracaoLeveFirebase('alojados', aId, a);
      }
      return { message: "Alojado atualizado com sucesso" };
    }
    if (matchAlojadoPut && method === 'DELETE') {
      const aId = Number(matchAlojadoPut[1]);
      const a = this.dbState.alojados.find(x => x.id === aId);
      if (a) {
        // Liberar vaga
        this.dbState.quartos.forEach(q => {
          (q.vagas || []).forEach(v => {
            if (v.alojado_id === aId || (v.alojado && v.alojado.id === aId)) {
              v.status = 'livre';
              v.alojado = null;
              v.alojado_id = null;
              v.nome_completo = null;
              v.matricula = null;
              v.funcao = null;
              v.empresa_nome = null;
              v.empresa_cor = null;
              v.foto_url = null;
              v.whatsapp = null;
            }
          });
        });
        this.dbState.alojados = this.dbState.alojados.filter(x => x.id !== aId);
        this.recomputeStats();
        this.saveToStorage();
        sincronizarAlteracaoLeveFirebase('alojados', aId, { id: aId, excluido: true });
      }
      return { message: "Alojado excluído permanentemente com sucesso" };
    }

    // 6.4 Foto do Alojado (POST / DELETE)
    const matchAlojadoFoto = path.match(/\/api\/alojados\/(\d+)\/foto/);
    if (matchAlojadoFoto) {
      const aId = Number(matchAlojadoFoto[1]);
      const a = this.dbState.alojados.find(x => x.id === aId);
      if (method === 'POST') {
        const fotoUrl = (body && body.foto_url) ? body.foto_url : null;
        if (a && fotoUrl) {
          a.foto_url = fotoUrl;
          this.dbState.quartos.forEach(q => {
            (q.vagas || []).forEach(v => {
              if (v.alojado && v.alojado.id === aId) {
                v.alojado.foto_url = fotoUrl;
              }
            });
          });
          this.saveToStorage();
          sincronizarAlteracaoLeveFirebase('alojados', aId, { foto_url: a.foto_url });
        }
        return { success: true, foto_url: a ? a.foto_url : fotoUrl, message: "Foto atualizada com sucesso" };
      }
      if (method === 'DELETE') {
        if (a) {
          a.foto_url = null;
          this.dbState.quartos.forEach(q => {
            (q.vagas || []).forEach(v => {
              if (v.alojado && v.alojado.id === aId) {
                v.alojado.foto_url = null;
              }
            });
          });
          this.saveToStorage();
          sincronizarAlteracaoLeveFirebase('alojados', aId, { foto_url: null });
        }
        return { success: true, message: "Foto removida com sucesso" };
      }
    }

    // 6.5 Cadastrar Novo Alojado (somente rota raiz /api/alojados)
    if (path.match(/\/api\/alojados\/?$/) && method === 'POST') {
      // VALIDAÇÃO: Bloquear cadastros sem nome ou fantasmas
      if (!body || !body.nome_completo || body.nome_completo.trim() === '' || body.nome_completo.trim() === '??') {
        throw new Error("Nome do colaborador é obrigatório para cadastrar.");
      }

      const novoId = Date.now();
      const emp = this.dbState.empresas.find(e => e.id == body.empresa_id) || { nome: 'N/A', cor: '#3b82f6' };
      let foundRoom = null;
      let foundBed = null;
      const vagaId = Number(body.vaga_id);
      this.dbState.quartos.forEach(q => {
        (q.vagas || []).forEach(v => {
          if (v.id === vagaId) {
            foundRoom = q;
            foundBed = v;
          }
        });
      });

      const novoAlojado = {
        id: novoId,
        vaga_id: vagaId,
        matricula: body.matricula || '',
        nome_completo: body.nome_completo.trim().toUpperCase(),
        empresa_id: Number(body.empresa_id),
        empresa_nome: emp.nome,
        empresa_cor: emp.cor,
        funcao: (body.funcao || '').toUpperCase(),
        whatsapp: body.whatsapp ? body.whatsapp.trim() : '',
        data_entrada: body.data_entrada || new Date().toISOString().split('T')[0],
        data_saida: null,
        status: 'ativo',
        observacoes: body.observacoes || '',
        foto_url: body.foto_url || null,
        bloco_nome: foundRoom ? foundRoom.bloco_nome : '',
        quarto_numero: foundRoom ? foundRoom.numero : '',
        numero_cama: foundBed ? foundBed.numero_cama : 1
      };

      if (foundBed) {
        foundBed.status = 'ocupada';
        foundBed.alojado_id = novoId;
        foundBed.nome_completo = novoAlojado.nome_completo;
        foundBed.matricula = novoAlojado.matricula || '';
        foundBed.funcao = novoAlojado.funcao || '';
        foundBed.empresa_nome = novoAlojado.empresa_nome || '';
        foundBed.empresa_cor = novoAlojado.empresa_cor || '#2563eb';
        foundBed.foto_url = novoAlojado.foto_url || null;
        foundBed.whatsapp = novoAlojado.whatsapp || '';
        foundBed.alojado = { ...novoAlojado };
      }

      this.dbState.alojados.unshift(novoAlojado);
      this.recomputeStats();
      this.saveToStorage();
      sincronizarAlteracaoLeveFirebase('alojados', novoAlojado.id, novoAlojado);
      return { id: novoId, message: "Alojado cadastrado com sucesso" };
    }

    // 6.6 Listar Alojados (GET)
    if (path.includes('/api/alojados') && method === 'GET') {
      let lista = [...this.dbState.alojados];
      const statusAlojado = params.get('status_alojado') || 'ativo';
      const blocoId = params.get('bloco_id');
      const empresaId = params.get('empresa_id');
      const qQuery = params.get('q');
      const page = parseInt(params.get('page') || '1', 10);
      const limit = parseInt(params.get('limit') || '50', 10);

      if (statusAlojado && statusAlojado !== 'todos') {
        lista = lista.filter(a => a.status === statusAlojado);
      }
      if (empresaId) {
        lista = lista.filter(a => a.empresa_id == empresaId);
      }
      if (blocoId) {
        const bloco = this.dbState.blocos.find(b => b.id == blocoId);
        if (bloco) {
          lista = lista.filter(a => a.bloco_nome === bloco.nome);
        }
      }
      if (qQuery) {
        const s = qQuery.toLowerCase();
        lista = lista.filter(a => 
          (a.nome_completo && a.nome_completo.toLowerCase().includes(s)) ||
          (a.matricula && a.matricula.toLowerCase().includes(s)) ||
          (a.funcao && a.funcao.toLowerCase().includes(s))
        );
      }

      const total = lista.length;
      const startIndex = (page - 1) * limit;
      const paginated = lista.slice(startIndex, startIndex + limit);

      return {
        items: paginated,
        total: total,
        page: page,
        limit: limit
      };
    }

    // 7. Móveis
    if (path.includes('/api/moveis')) {
      // 7.1 Resolver Manutenção (Marcar como Reparado)
      const matchResolver = path.match(/\/api\/moveis\/(\d+)\/resolver-manutencao/);
      if (matchResolver && method === 'POST') {
        const mId = Number(matchResolver[1]);
        const hoje = new Date().toISOString().split('T')[0];
        const dataFormatada = new Date().toLocaleDateString('pt-BR');
        const user = params.get('usuario') || currentUserName || 'Prefeito';
        let itemNome = 'Item';
        let quartoNum = '';
        let blocoNome = '';
        let found = false;

        this.dbState.quartos.forEach(q => {
          (q.moveis || []).forEach(m => {
            if (m.id === mId) {
              m.estado_conservacao = 'Bom';
              m.precisa_manutencao = 0;
              m.data_vistoria = hoje;
              m.observacoes = (m.observacoes && m.observacoes.trim() !== '' ? m.observacoes + ' • ' : '') + `[Reparado em ${dataFormatada} por ${user}]`;
              itemNome = m.tipo_item || 'Item';
              quartoNum = q.numero;
              blocoNome = q.bloco_nome;
              found = true;
            }
          });
        });

        if (found) {
          if (!this.dbState.auditoria) this.dbState.auditoria = [];
          this.dbState.auditoria.unshift({
            id: Date.now(),
            timestamp: new Date().toISOString(),
            usuario: user,
            acao: "RESOLVER_MANUTENCAO",
            entidade: "movel",
            entidade_id: mId,
            detalhes: `Manutenção resolvida no item '${itemNome}' do Quarto ${quartoNum} (${blocoNome})`
          });

          this.recomputeStats();
          this.saveToStorage();
          sincronizarAlteracaoLeveFirebase('moveis_vistorias', mId, {
            movel_id: mId,
            estado_conservacao: 'Bom',
            precisa_manutencao: 0,
            data_vistoria: hoje,
            observacoes: (this.dbState.quartos.flatMap(q => q.moveis || []).find(m => m.id === mId)?.observacoes || '')
          });
        }

        return { message: "Manutenção marcada como resolvida com sucesso" };
      }

      if (path.includes('/vistoria') && method === 'POST') {
        const movelId = Number(body.movel_id);
        this.dbState.quartos.forEach(q => {
          (q.moveis || []).forEach(m => {
            if (m.id === movelId) {
              m.estado_conservacao = body.estado_conservacao;
              m.precisa_manutencao = Number(body.precisa_manutencao);
              m.data_vistoria = body.data_vistoria || new Date().toISOString().split('T')[0];
              m.observacoes = body.observacoes || '';
            }
          });
        });
        this.recomputeStats();
        this.saveToStorage();
        sincronizarAlteracaoLeveFirebase('moveis_vistorias', movelId, body);
        return { message: "Vistoria atualizada com sucesso" };
      }

      if ((path.endsWith('/api/moveis') || path.endsWith('/api/moveis/')) && method === 'POST') {
        const novoMId = Date.now();
        const quartoId = Number(body.quarto_id);
        const q = this.dbState.quartos.find(x => x.id === quartoId);
        if (q) {
          if (!q.moveis) q.moveis = [];
          q.moveis.push({
            id: novoMId,
            quarto_id: quartoId,
            tipo_item: body.tipo_item,
            quantidade: Number(body.quantidade) || 1,
            estado_conservacao: body.estado_conservacao || 'Bom',
            precisa_manutencao: Number(body.precisa_manutencao) || 0,
            data_vistoria: body.data_vistoria || new Date().toISOString().split('T')[0],
            observacoes: body.observacoes || ''
          });
          this.recomputeStats();
          this.saveToStorage();
        }
        return { id: novoMId, message: "Móvel cadastrado com sucesso" };
      }

      const matchMovelId = path.match(/\/api\/moveis\/(\d+)$/);
      if (matchMovelId) {
        const mId = Number(matchMovelId[1]);
        if (method === 'PUT') {
          this.dbState.quartos.forEach(q => {
            (q.moveis || []).forEach(m => {
              if (m.id === mId) {
                m.tipo_item = body.tipo_item || m.tipo_item;
                m.quantidade = Number(body.quantidade) || m.quantidade;
                m.estado_conservacao = body.estado_conservacao || m.estado_conservacao;
                m.precisa_manutencao = Number(body.precisa_manutencao) || 0;
                m.data_vistoria = body.data_vistoria || m.data_vistoria;
                m.observacoes = body.observacoes || m.observacoes;
              }
            });
          });
          this.recomputeStats();
          this.saveToStorage();
          return { message: "Móvel atualizado" };
        }
        if (method === 'DELETE') {
          this.dbState.quartos.forEach(q => {
            if (q.moveis) q.moveis = q.moveis.filter(m => m.id !== mId);
          });
          this.recomputeStats();
          this.saveToStorage();
          sincronizarAlteracaoLeveFirebase('moveis_vistorias', mId, {
            movel_id: mId,
            excluido: true
          });
          return { message: "Móvel excluído" };
        }
      }

      // GET móveis
      const allMoveis = [];
      this.dbState.quartos.forEach(q => {
        (q.moveis || []).forEach(m => {
          allMoveis.push({
            ...m,
            bloco_id: q.bloco_id,
            bloco_nome: q.bloco_nome,
            quarto_id: q.id,
            quarto_numero: q.numero
          });
        });
      });

      let filtrados = allMoveis;
      const bId = params.get('bloco_id');
      const tipo = params.get('tipo_item');
      const estado = params.get('estado');
      const precisaM = params.get('precisa_manutencao');
      const qQuery = params.get('q');

      if (bId) filtrados = filtrados.filter(m => m.bloco_id == bId);
      if (tipo) filtrados = filtrados.filter(m => m.tipo_item === tipo);
      if (estado) filtrados = filtrados.filter(m => m.estado_conservacao === estado);
      if (precisaM !== null && precisaM !== '') filtrados = filtrados.filter(m => String(m.precisa_manutencao) === String(precisaM));
      if (qQuery) {
        const s = qQuery.toLowerCase();
        filtrados = filtrados.filter(m => 
          (m.tipo_item && m.tipo_item.toLowerCase().includes(s)) ||
          (m.bloco_nome && m.bloco_nome.toLowerCase().includes(s)) ||
          (m.quarto_numero && m.quarto_numero.toLowerCase().includes(s))
        );
      }
      return filtrados;
    }

    // 8. Relatórios Resumo Geral
    if (path.includes('/api/relatorios/resumo-geral')) {
      this.recomputeStats();
      const linhas = this.dbState.blocos.map(b => ({
        alojamento: b.nome,
        tipo: b.tipo,
        descricao: b.tipo === 'alojamento' ? 'PRODUÇÃO' : (b.tipo === 'adm' ? 'ADMINISTRAÇÃO' : 'CONTÊINERES'),
        total_vagas: b.total_vagas,
        ocupadas: b.ocupadas,
        vagas_livres: b.livres,
        taxa_ocupacao: b.taxa_ocupacao
      }));
      return {
        linhas,
        totais: this.dbState.geral
      };
    }

    // 9. Auditoria
    if (path.includes('/api/auditoria')) {
      return this.dbState.auditoria || [];
    }

    // 10. Restaurar Padrão
    if (path.includes('/api/restaurar-padrao')) {
      localStorage.removeItem('prefeitura_taboca_snapshot');
      this.initialized = false;
      this.initPromise = null;
      await this.init();
      return { message: "Dados restaurados para o padrão original da obra com sucesso!" };
    }

    return { message: "OK" };
  }
};
window.StaticApiEngine = StaticApiEngine;

// INTERCEPTOR UNIVERSAL FETCH: Impede qualquer 404 de API no GitHub Pages
window.fetch = async function(resource, init = {}) {
  const url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
  
  // Requisições externas ou arquivos estáticos passam direto
  if (url.includes('dados_iniciais_taboca.json') || url.includes('.json') || url.includes('api.imgbb.com') || url.includes('firestore.googleapis.com')) {
    return originalFetch.apply(this, arguments);
  }

  // Se o modo estático estiver ativo e a URL for uma rota da API (/api/...)
  if (staticModeActive && (url.includes('/api/') || url.startsWith('api/'))) {
    try {
      const responseData = await StaticApiEngine.handle(url, init);
      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      console.warn("StaticApiEngine erro na rota:", url, err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  return originalFetch.apply(this, arguments);
};

// ========================================================
// CACHE INTELIGENTE DE FOTOS NO APARELHO (IndexedDB)
// ========================================================
class LocalPhotoCache {
  constructor() {
    this.dbName = 'PrefeituraAlojamentoFotos';
    this.storeName = 'fotos_cache';
    this.db = null;
    this.initPromise = this.init();
    this.memCache = new Map(); // Cache em memória RAM imediato
  }

  init() {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        return resolve(null);
      }
      try {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: 'url' });
          }
        };
        req.onsuccess = (e) => {
          this.db = e.target.result;
          resolve(this.db);
        };
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  }

  async getPhoto(url) {
    if (!url) return null;
    if (this.memCache.has(url)) return this.memCache.get(url);
    await this.initPromise;
    if (!this.db) return null;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const req = store.get(url);
        req.onsuccess = () => {
          if (req.result && req.result.dataUrl) {
            this.memCache.set(url, req.result.dataUrl);
            resolve(req.result.dataUrl);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  }

  async savePhoto(url, dataUrl) {
    if (!url || !dataUrl) return;
    this.memCache.set(url, dataUrl);
    await this.initPromise;
    if (!this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        store.put({ url, dataUrl, savedAt: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (err) {
        resolve(false);
      }
    });
  }

  async clearAll() {
    this.memCache.clear();
    await this.initPromise;
    if (!this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (err) {
        resolve(false);
      }
    });
  }

  async countCached() {
    await this.initPromise;
    if (!this.db) return 0;

    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(this.storeName, 'readonly');
        const req = tx.objectStore(this.storeName).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      } catch (err) {
        resolve(0);
      }
    });
  }
}

const photoCacheManager = new LocalPhotoCache();

async function handleAvatarImgLoaded(img) {
  const originalUrl = img.getAttribute('data-cache-url');
  if (!originalUrl || originalUrl.startsWith('data:')) return;

  const inCache = await photoCacheManager.getPhoto(originalUrl);
  if (inCache) return;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 100;
    canvas.height = img.naturalHeight || 100;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    await photoCacheManager.savePhoto(originalUrl, dataUrl);
    atualizarContadorCacheUI();
  } catch (e) {
    // Ignora se restrição CORS em domínios externos
  }
}

async function aplicarCacheEmFotosNaTela() {
  const images = document.querySelectorAll('img[data-cache-url]');
  for (const img of images) {
    const url = img.getAttribute('data-cache-url');
    if (!url) continue;
    const cached = await photoCacheManager.getPhoto(url);
    if (cached && img.src !== cached) {
      img.src = cached;
    }
  }
}

async function atualizarContadorCacheUI() {
  const count = await photoCacheManager.countCached();
  const el = document.getElementById('cacheFotosCountText');
  if (el) {
    el.textContent = `${count} fotos salvas (Instantâneo)`;
  }
}

async function baixarTodasFotosParaCache() {
  const btn = document.getElementById('btnPreloadFotos');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Baixando Fotos...';
  }
  showToast('Iniciando salvamento das fotos na memória local...', 'info');

  try {
    const res = await fetch(`${API_BASE}/api/alojados`);
    const alojados = await res.json();
    const comFoto = alojados.filter(a => a.foto_url && a.foto_url.trim() !== '');

    let salvas = 0;
    for (const a of comFoto) {
      try {
        const url = a.foto_url;
        const jaSalva = await photoCacheManager.getPhoto(url);
        if (jaSalva) {
          salvas++;
          continue;
        }

        const resp = await fetch(url);
        if (resp.ok) {
          const blob = await resp.blob();
          const reader = new FileReader();
          await new Promise((resolve) => {
            reader.onload = async () => {
              await photoCacheManager.savePhoto(url, reader.result);
              salvas++;
              resolve();
            };
            reader.onerror = resolve;
            reader.readAsDataURL(blob);
          });
        }
      } catch (err) {
        // Ignora falha individual
      }
    }

    await atualizarContadorCacheUI();
    showToast(`✅ ${salvas} fotos salvas na memória deste aparelho! Carregamento offline ativado.`, 'success');
  } catch (err) {
    showToast(`Erro ao baixar fotos: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-download"></i> Salvar Todas Fotos no Aparelho';
    }
  }
}

async function limparCacheFotos() {
  if (!confirm('Deseja limpar as fotos armazenadas na memória deste aparelho?')) return;
  await photoCacheManager.clearAll();
  await atualizarContadorCacheUI();
  showToast('Cache de fotos deste aparelho limpo com sucesso!', 'info');
}

// Helpers de Avatar e Foto
function getInitials(name) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatFotoUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('/uploads/')) {
    return '.' + trimmed;
  }
  return trimmed;
}

function renderAvatarHtml(nome, fotoUrl, sizeClass = 'w-9 h-9', textSize = 'text-xs', clickCall = '') {
  const cursor = clickCall ? 'cursor-pointer hover:ring-2 hover:ring-amber-500 transition' : '';
  const onclickAttr = clickCall ? `onclick="${clickCall}" title="Ver / alterar foto de ${nome.replace(/"/g, '&quot;')}"` : '';
  const initials = getInitials(nome);
  const formattedUrl = formatFotoUrl(fotoUrl);

  if (formattedUrl && formattedUrl.trim() !== '') {
    const cachedUrl = photoCacheManager.memCache.get(formattedUrl) || formattedUrl;
    return `
      <div class="${sizeClass} rounded-full overflow-hidden flex-shrink-0 relative ${cursor}" ${onclickAttr}>
        <img src="${cachedUrl}" data-cache-url="${formattedUrl}" onload="handleAvatarImgLoaded(this)" onerror="this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.classList.remove('hidden');" alt="${nome.replace(/"/g, '&quot;')}" class="w-full h-full object-cover border border-slate-300 shadow-xs">
        <div class="hidden w-full h-full bg-slate-800 text-amber-300 font-bold ${textSize} flex items-center justify-center border border-slate-700">
          ${initials}
        </div>
      </div>
    `;
  }

  return `
    <div ${onclickAttr} class="${sizeClass} rounded-full bg-slate-800 text-amber-300 font-bold ${textSize} flex items-center justify-center flex-shrink-0 shadow-xs border border-slate-700 ${cursor}">
      ${initials}
    </div>
  `;
}

// ========================================================
// 0. FIREBASE FIRESTORE INTEGRATION (prefeitura-cc71b)
// ========================================================
const firebaseConfig = {
  apiKey: "AIzaSyCd1Uu_dRx8k4EcgifWUmsmfeqnAcB4PHw",
  authDomain: "prefeitura-cc71b.firebaseapp.com",
  projectId: "prefeitura-cc71b",
  storageBucket: "prefeitura-cc71b.firebasestorage.app",
  messagingSenderId: "395936672533",
  appId: "1:395936672533:web:d7d17537d2c38c47bc971c",
  measurementId: "G-YYXMDWCM4Q"
};

function sincronizarVagaAlojadoEmMemoria(alojadoId) {
  if (!window.StaticApiEngine || !window.StaticApiEngine.dbState || !window.StaticApiEngine.dbState.quartos) return;
  const aId = Number(alojadoId);
  const al = (window.StaticApiEngine.dbState.alojados || []).find(x => Number(x.id) === aId);
  if (!al) return;

  // 1. Limpar de QUALQUER vaga onde ele não deveria estar
  window.StaticApiEngine.dbState.quartos.forEach(q => {
    (q.vagas || []).forEach(v => {
      const ehDesteAlojado = (Number(v.alojado_id) === aId || (v.alojado && Number(v.alojado.id) === aId) || (v.nome_completo && v.nome_completo.trim().toUpperCase() === al.nome_completo.trim().toUpperCase()));
      if (ehDesteAlojado) {
        const mesmoQuarto = String(q.numero).trim() === String(al.quarto_numero).trim();
        const mesmaCama = Number(v.numero_cama) === Number(al.numero_cama);
        const mesmoBloco = !al.bloco_nome || (q.bloco_nome && q.bloco_nome.trim().toLowerCase() === al.bloco_nome.trim().toLowerCase());
        
        if (al.status === 'desligado' || !mesmoQuarto || !mesmaCama || !mesmoBloco) {
          v.status = 'livre';
          v.alojado = null;
          v.alojado_id = null;
          v.nome_completo = null;
          v.matricula = null;
          v.funcao = null;
          v.empresa_nome = null;
          v.empresa_cor = null;
          v.foto_url = null;
          v.whatsapp = null;
        } else {
          v.nome_completo = al.nome_completo;
          v.matricula = al.matricula || '';
          v.funcao = al.funcao || '';
          v.empresa_nome = al.empresa_nome || '';
          v.empresa_cor = al.empresa_cor || '#2563eb';
          v.foto_url = al.foto_url || null;
          v.whatsapp = al.whatsapp || '';
          v.alojado = { ...al };
        }
      }
    });
  });

  // 2. Se estiver ativo e com quarto/cama definidos, ocupar na vaga correta de destino
  if (al.status !== 'desligado' && al.quarto_numero && al.numero_cama) {
    window.StaticApiEngine.dbState.quartos.forEach(q => {
      const matchBloco = !al.bloco_nome || (q.bloco_nome && q.bloco_nome.trim().toLowerCase() === al.bloco_nome.trim().toLowerCase());
      if (String(q.numero).trim() === String(al.quarto_numero).trim() && matchBloco) {
        (q.vagas || []).forEach(v => {
          if (Number(v.numero_cama) === Number(al.numero_cama)) {
            v.status = 'ocupada';
            v.alojado_id = aId;
            v.nome_completo = al.nome_completo;
            v.matricula = al.matricula || '';
            v.funcao = al.funcao || '';
            v.empresa_nome = al.empresa_nome || '';
            v.empresa_cor = al.empresa_cor || '#2563eb';
            v.foto_url = al.foto_url || null;
            v.whatsapp = al.whatsapp || '';
            v.alojado = { ...al };
            al.vaga_id = v.id;
          }
        });
      }
    });
  }
}

// Sincronizar alteração individual de móvel (reparo, manutenção, vistoria ou exclusão) na memória local
function sincronizarMovelEmMemoria(movelId, dados) {
  if (!window.StaticApiEngine || !window.StaticApiEngine.dbState || !window.StaticApiEngine.dbState.quartos) return false;
  if (!movelId || !dados) return false;
  const idNum = Number(movelId);
  let alterou = false;

  // Se o item foi excluído
  if (dados.excluido) {
    (window.StaticApiEngine.dbState.quartos || []).forEach(q => {
      if (q.moveis && q.moveis.length > 0) {
        const antes = q.moveis.length;
        q.moveis = q.moveis.filter(m => Number(m.id) !== idNum);
        if (q.moveis.length !== antes) alterou = true;
      }
    });
    return alterou;
  }

  // Atualizar propriedades do móvel (como estado_conservacao e precisa_manutencao)
  (window.StaticApiEngine.dbState.quartos || []).forEach(q => {
    (q.moveis || []).forEach(m => {
      if (Number(m.id) === idNum) {
        if (dados.estado_conservacao !== undefined && m.estado_conservacao !== dados.estado_conservacao) {
          m.estado_conservacao = dados.estado_conservacao;
          alterou = true;
        }
        if (dados.precisa_manutencao !== undefined && Number(m.precisa_manutencao) !== Number(dados.precisa_manutencao)) {
          m.precisa_manutencao = Number(dados.precisa_manutencao);
          alterou = true;
        }
        if (dados.data_vistoria !== undefined && m.data_vistoria !== dados.data_vistoria) {
          m.data_vistoria = dados.data_vistoria;
          alterou = true;
        }
        if (dados.observacoes !== undefined && m.observacoes !== dados.observacoes) {
          m.observacoes = dados.observacoes;
          alterou = true;
        }
        if (dados.quantidade !== undefined && Number(m.quantidade) !== Number(dados.quantidade)) {
          m.quantidade = Number(dados.quantidade);
          alterou = true;
        }
      }
    });
  });

  return alterou;
}

// Sincronizar alteração de bloco em memória
function sincronizarBlocoEmMemoria(blocoId, dados) {
  if (!window.StaticApiEngine || !window.StaticApiEngine.dbState || !window.StaticApiEngine.dbState.blocos) return false;
  if (!blocoId || !dados) return false;
  const bId = Number(blocoId);
  let alterou = false;

  if (dados.excluido) {
    const antes = window.StaticApiEngine.dbState.blocos.length;
    window.StaticApiEngine.dbState.blocos = window.StaticApiEngine.dbState.blocos.filter(b => Number(b.id) !== bId);
    return window.StaticApiEngine.dbState.blocos.length !== antes;
  }

  const b = window.StaticApiEngine.dbState.blocos.find(x => Number(x.id) === bId);
  if (b) {
    if (dados.nome && b.nome !== dados.nome) { b.nome = dados.nome; alterou = true; }
    if (dados.tipo && b.tipo !== dados.tipo) { b.tipo = dados.tipo; alterou = true; }
    if (dados.ordem !== undefined && Number(b.ordem) !== Number(dados.ordem)) { b.ordem = Number(dados.ordem); alterou = true; }
  } else if (dados.nome) {
    window.StaticApiEngine.dbState.blocos.push({
      id: bId,
      nome: dados.nome,
      tipo: dados.tipo || 'alojamento',
      ordem: Number(dados.ordem) || 0,
      total_quartos: 0,
      total_vagas: 0,
      ocupadas: 0,
      livres: 0,
      taxa_ocupacao: 0,
      itens_alerta: 0
    });
    alterou = true;
  }
  return alterou;
}

// Sincronizar alteração de empresa em memória
function sincronizarEmpresaEmMemoria(empId, dados) {
  if (!window.StaticApiEngine || !window.StaticApiEngine.dbState || !window.StaticApiEngine.dbState.empresas) return false;
  if (!empId || !dados) return false;
  const eId = Number(empId);
  let alterou = false;

  if (dados.excluido) {
    const antes = window.StaticApiEngine.dbState.empresas.length;
    window.StaticApiEngine.dbState.empresas = window.StaticApiEngine.dbState.empresas.filter(e => Number(e.id) !== eId);
    return window.StaticApiEngine.dbState.empresas.length !== antes;
  }

  const e = window.StaticApiEngine.dbState.empresas.find(x => Number(x.id) === eId);
  if (e) {
    if (dados.nome && e.nome !== dados.nome) { e.nome = dados.nome; alterou = true; }
    if (dados.cor && e.cor !== dados.cor) { e.cor = dados.cor; alterou = true; }
  } else if (dados.nome) {
    window.StaticApiEngine.dbState.empresas.push({
      id: eId,
      nome: dados.nome,
      cor: dados.cor || '#3b82f6',
      total_alojados: 0
    });
    alterou = true;
  }
  return alterou;
}

// Sincronizar alteração de quarto em memória
function sincronizarQuartoEmMemoria(quartoId, dados) {
  if (!window.StaticApiEngine || !window.StaticApiEngine.dbState || !window.StaticApiEngine.dbState.quartos) return false;
  if (!quartoId || !dados) return false;
  const qId = Number(quartoId);
  let alterou = false;

  if (dados.excluido) {
    const antes = window.StaticApiEngine.dbState.quartos.length;
    window.StaticApiEngine.dbState.quartos = window.StaticApiEngine.dbState.quartos.filter(q => Number(q.id) !== qId);
    return window.StaticApiEngine.dbState.quartos.length !== antes;
  }

  const q = window.StaticApiEngine.dbState.quartos.find(x => Number(x.id) === qId);
  if (q) {
    if (dados.numero && q.numero !== dados.numero) { q.numero = dados.numero; alterou = true; }
    if (dados.capacidade && Number(q.capacidade) !== Number(dados.capacidade)) { q.capacidade = Number(dados.capacidade); alterou = true; }
    if (dados.observacoes !== undefined && q.observacoes !== dados.observacoes) { q.observacoes = dados.observacoes; alterou = true; }
    if (dados.bloco_nome && q.bloco_nome !== dados.bloco_nome) { q.bloco_nome = dados.bloco_nome; alterou = true; }
    if (dados.bloco_id && Number(q.bloco_id) !== Number(dados.bloco_id)) { q.bloco_id = Number(dados.bloco_id); alterou = true; }
  } else if (dados.numero) {
    const cap = Number(dados.capacidade) || 4;
    const vagas = [];
    for (let i = 1; i <= cap; i++) {
      vagas.push({ id: qId + i, numero_cama: i, status: 'livre', alojado: null });
    }
    window.StaticApiEngine.dbState.quartos.push({
      id: qId,
      bloco_id: Number(dados.bloco_id) || 1,
      bloco_nome: dados.bloco_nome || 'Bloco',
      bloco_tipo: dados.bloco_tipo || 'alojamento',
      numero: dados.numero,
      capacidade: cap,
      observacoes: dados.observacoes || '',
      vagas: dados.vagas || vagas,
      moveis: dados.moveis || []
    });
    alterou = true;
  }
  return alterou;
}

function initFirebase() {
  try {
    if (typeof firebase !== 'undefined') {
      if (!firebase.apps.length) {
        firebaseApp = firebase.initializeApp(firebaseConfig);
      } else {
        firebaseApp = firebase.app();
      }
      firestoreDb = firebaseApp.firestore();

      // PARTE 1: Ativar Persistência Offline (Cache Local no Celular e PC para ZERO Leituras)
      firestoreDb.enablePersistence({ synchronizeTabs: true })
        .then(() => {
          console.log("Firebase Offline Persistence (Cache Local) ativada com sucesso!");
          const el = document.getElementById('firebaseCacheStatusBadge');
          if (el) el.innerHTML = '<i class="fa-solid fa-bolt text-amber-500 mr-1"></i> Cache Offline Ativo (0 Leituras)';
        })
        .catch((err) => {
          if (err.code === 'failed-precondition') {
            console.warn("Persistência offline falhou: múltiplas abas abertas.");
          } else if (err.code === 'unimplemented') {
            console.warn("Persistência offline não suportada neste navegador.");
          }
        });

      firebaseInitialized = true;
      atualizarBadgeFirebaseUI(true, "Firebase Conectado");
      console.log("Firebase Firestore inicializado com sucesso:", firebaseConfig.projectId);
      iniciarListenerTempoRealFirebase();
    } else {
      console.warn("SDK do Firebase não detectado.");
      atualizarBadgeFirebaseUI(false, "Offline");
    }
  } catch (err) {
    console.error("Erro ao inicializar Firebase:", err);
    atualizarBadgeFirebaseUI(false, "Erro Firebase");
  }
}

let listenerTempoRealAtivo = false;

// Sincronização em tempo real entre Celular e PC via Firebase Firestore
function iniciarListenerTempoRealFirebase() {
  if (!firebaseInitialized || !firestoreDb || listenerTempoRealAtivo) return;
  listenerTempoRealAtivo = true;

  console.log("🔥 [FIREBASE] Iniciando listener em tempo real entre celular e PC...");

  // Ouvir alterações em tempo real na coleção de alojados (fotos, check-in, realocação, status)
  firestoreDb.collection('alojados').onSnapshot(async (snapshot) => {
    try {
      if (!window.StaticApiEngine || !window.StaticApiEngine.initialized) {
        await window.StaticApiEngine.init();
      }

      let alteracoes = 0;
      snapshot.docChanges().forEach((change) => {
        const data = change.doc.data();
        if (!data) return;
        const rawId = data.id || change.doc.id;
        if (!rawId) return;
        
        const aId = Number(rawId);
        data.id = aId;

        // Se foi removido na nuvem ou marcado como excluído
        if (change.type === 'removed' || data.excluido) {
          const antes = (window.StaticApiEngine.dbState.alojados || []).length;
          window.StaticApiEngine.dbState.alojados = (window.StaticApiEngine.dbState.alojados || []).filter(x => Number(x.id) !== aId);
          window.StaticApiEngine.dbState.quartos.forEach(q => {
            (q.vagas || []).forEach(v => {
              if (Number(v.alojado_id) === aId || (v.alojado && Number(v.alojado.id) === aId)) {
                v.status = 'livre';
                v.alojado = null;
                v.alojado_id = null;
                v.nome_completo = null;
                v.matricula = null;
                v.funcao = null;
                v.empresa_nome = null;
                v.empresa_cor = null;
                v.foto_url = null;
                v.whatsapp = null;
              }
            });
          });
          if (window.StaticApiEngine.dbState.alojados.length !== antes) {
            alteracoes++;
          }
          return;
        }

        const al = (window.StaticApiEngine.dbState.alojados || []).find(x => Number(x.id) === aId);
        if (al) {
          let mudou = false;
          ['foto_url', 'nome_completo', 'funcao', 'status', 'vaga_id', 'quarto_numero', 'bloco_nome', 'numero_cama', 'whatsapp', 'matricula', 'empresa_id', 'empresa_nome', 'empresa_cor', 'data_entrada', 'data_saida', 'observacoes'].forEach(k => {
            if (data[k] !== undefined && data[k] !== al[k]) {
              al[k] = data[k];
              mudou = true;
            }
          });

          if (mudou) {
            alteracoes++;
            sincronizarVagaAlojadoEmMemoria(aId);
          }
        } else if (change.type === 'added' && data.nome_completo) {
          window.StaticApiEngine.dbState.alojados.unshift(data);
          alteracoes++;
          sincronizarVagaAlojadoEmMemoria(aId);
        }
      });

      if (alteracoes > 0) {
        console.log(`⚡ [FIREBASE] ${alteracoes} colaborador(es) sincronizado(s) em tempo real da nuvem!`);
        window.StaticApiEngine.recomputeStats();
        window.StaticApiEngine.saveToStorage();
        if (typeof carregarDashboard === 'function') carregarDashboard();
        if (typeof carregarAlojados === 'function') carregarAlojados();
        if (typeof carregarQuartos === 'function' && activeTab === 'blocos') carregarQuartos();
        if (typeof carregarBlocosLista === 'function') carregarBlocosLista();
        if (typeof carregarVagasLivresLista === 'function') carregarVagasLivresLista();
        showToast(`⚡ Nuvem: ${alteracoes} alteração(ões) de colaboradores sincronizada(s)!`, 'info');
      }
    } catch (err) {
      console.warn("Aviso ao processar atualização em tempo real:", err);
    }
  }, (err) => {
    if (err && (err.code === 'permission-denied' || (err.message && err.message.toLowerCase().includes('permission')))) {
      console.warn("⚠️ Firebase Firestore: Permissões de leitura negadas pelas Regras.");
      atualizarBadgeFirebaseUI(false, "Permissões Pendentes");
    }
  });

  // Ouvinte em tempo real para Blocos (criar, editar, excluir)
  try {
    firestoreDb.collection('blocos').onSnapshot(async (snapshot) => {
      try {
        if (!window.StaticApiEngine || !window.StaticApiEngine.initialized) {
          await window.StaticApiEngine.init();
        }
        let alteracoesBlocos = 0;
        snapshot.docChanges().forEach((change) => {
          const data = change.doc.data();
          if (data) {
            const bId = Number(change.doc.id) || Number(data.id);
            if (change.type === 'removed') data.excluido = true;
            if (sincronizarBlocoEmMemoria(bId, data)) alteracoesBlocos++;
          }
        });
        if (alteracoesBlocos > 0) {
          console.log(`⚡ [FIREBASE] ${alteracoesBlocos} bloco(s) sincronizados em tempo real!`);
          window.StaticApiEngine.recomputeStats();
          window.StaticApiEngine.saveToStorage();
          if (typeof carregarDashboard === 'function') carregarDashboard();
          if (typeof carregarBlocosLista === 'function') carregarBlocosLista();
          if (typeof carregarQuartos === 'function' && activeTab === 'blocos') carregarQuartos();
          if (typeof carregarGestaoCadastros === 'function' && activeTab === 'cadastros') carregarGestaoCadastros();
        }
      } catch (errB) { console.warn("Aviso ao sincronizar blocos:", errB); }
    }, (err) => { console.warn("Aviso listener blocos:", err); });
  } catch (errBl) { console.warn("Aviso snapshot blocos:", errBl); }

  // Ouvinte em tempo real para Empresas (criar, editar, excluir)
  try {
    firestoreDb.collection('empresas').onSnapshot(async (snapshot) => {
      try {
        if (!window.StaticApiEngine || !window.StaticApiEngine.initialized) {
          await window.StaticApiEngine.init();
        }
        let alteracoesEmp = 0;
        snapshot.docChanges().forEach((change) => {
          const data = change.doc.data();
          if (data) {
            const eId = Number(change.doc.id) || Number(data.id);
            if (change.type === 'removed') data.excluido = true;
            if (sincronizarEmpresaEmMemoria(eId, data)) alteracoesEmp++;
          }
        });
        if (alteracoesEmp > 0) {
          console.log(`⚡ [FIREBASE] ${alteracoesEmp} empresa(s) sincronizadas em tempo real!`);
          window.StaticApiEngine.recomputeStats();
          window.StaticApiEngine.saveToStorage();
          if (typeof carregarDashboard === 'function') carregarDashboard();
          if (typeof carregarEmpresasLista === 'function') carregarEmpresasLista();
          if (typeof carregarGestaoCadastros === 'function' && activeTab === 'cadastros') carregarGestaoCadastros();
        }
      } catch (errE) { console.warn("Aviso ao sincronizar empresas:", errE); }
    }, (err) => { console.warn("Aviso listener empresas:", err); });
  } catch (errEm) { console.warn("Aviso snapshot empresas:", errEm); }

  // Ouvinte em tempo real para Quartos (criar, editar, excluir)
  try {
    firestoreDb.collection('quartos').onSnapshot(async (snapshot) => {
      try {
        if (!window.StaticApiEngine || !window.StaticApiEngine.initialized) {
          await window.StaticApiEngine.init();
        }
        let alteracoesQuartos = 0;
        snapshot.docChanges().forEach((change) => {
          const data = change.doc.data();
          if (data) {
            const qId = Number(change.doc.id) || Number(data.id);
            if (change.type === 'removed') data.excluido = true;
            if (sincronizarQuartoEmMemoria(qId, data)) alteracoesQuartos++;
          }
        });
        if (alteracoesQuartos > 0) {
          console.log(`⚡ [FIREBASE] ${alteracoesQuartos} quarto(s) sincronizados em tempo real!`);
          window.StaticApiEngine.recomputeStats();
          window.StaticApiEngine.saveToStorage();
          if (typeof carregarDashboard === 'function') carregarDashboard();
          if (typeof carregarQuartos === 'function' && activeTab === 'blocos') carregarQuartos();
          if (typeof carregarVagasLivresLista === 'function') carregarVagasLivresLista();
          if (typeof carregarGestaoCadastros === 'function' && activeTab === 'cadastros') carregarGestaoCadastros();
        }
      } catch (errQ) { console.warn("Aviso ao sincronizar quartos:", errQ); }
    }, (err) => { console.warn("Aviso listener quartos:", err); });
  } catch (errQu) { console.warn("Aviso snapshot quartos:", errQu); }

  // Ouvinte em tempo real para Identidade Visual e Logomarca
  try {
    firestoreDb.collection('configuracoes').doc('identidade_visual').onSnapshot((doc) => {
      if (doc && doc.exists) {
        const data = doc.data();
        if (data) {
          if (data.logo_url) localStorage.setItem('appCustomLogo', data.logo_url);
          if (data.empresa_nome) localStorage.setItem('appCustomEmpresaNome', data.empresa_nome);
          if (data.obra_nome) localStorage.setItem('appCustomObraNome', data.obra_nome);
          aplicarIdentidadeVisual(data);
          if (typeof activeTab !== 'undefined' && activeTab === 'configuracoes') {
            carregarConfigIdentidadeVisual();
          }
        }
      }
    }, (err) => {
      console.warn("Aviso ao escutar identidade visual no Firestore:", err);
    });
  } catch (errSnap) {
    console.warn("Aviso ao iniciar snapshot da identidade visual:", errSnap);
  }

  // Ouvinte em tempo real para Móveis, Vistorias e Manutenções Resolvidas/Reparadas
  try {
    firestoreDb.collection('moveis_vistorias').onSnapshot(async (snapshot) => {
      try {
        if (!window.StaticApiEngine || !window.StaticApiEngine.initialized) {
          await window.StaticApiEngine.init();
        }
        let alteracoesMoveis = 0;
        snapshot.docs.forEach((doc) => {
          const data = doc.data();
          if (data) {
            const mId = Number(doc.id) || Number(data.id) || Number(data.movel_id);
            if (sincronizarMovelEmMemoria(mId, data)) {
              alteracoesMoveis++;
            }
          }
        });

        if (alteracoesMoveis > 0) {
          console.log(`⚡ [FIREBASE] ${alteracoesMoveis} vistoria(s)/manutenção(ões) atualizada(s) em tempo real da nuvem!`);
          window.StaticApiEngine.recomputeStats();
          window.StaticApiEngine.saveToStorage();
          if (typeof carregarDashboard === 'function') carregarDashboard();
          if (typeof carregarMoveis === 'function') carregarMoveis();
          if (typeof carregarQuartos === 'function' && activeTab === 'blocos') carregarQuartos();
          if (quartoSelecionadoId && typeof abrirModalQuartoDetalhes === 'function') {
            const modalEl = document.getElementById('modalQuartoDetalhes');
            if (modalEl && !modalEl.classList.contains('hidden')) {
              abrirModalQuartoDetalhes(quartoSelecionadoId);
            }
          }
          showToast(`⚡ Nuvem: Manutenção(ões) atualizada(s) com sucesso!`, 'info');
        }
      } catch (errM) {
        console.warn("Aviso ao processar atualização de vistorias/móveis:", errM);
      }
    }, (err) => {
      console.warn("Aviso ao escutar moveis_vistorias no Firestore:", err);
    });
  } catch (errMov) {
    console.warn("Aviso ao iniciar snapshot de móveis:", errMov);
  }

  // Ouvir chamados de manutenção enviados via QR Code pelos alojados
  try {
    iniciarListenerChamados();
    carregarConfigWhatsappPrefeito();
    iniciarListenerCasasCidade();
    iniciarListenerEstoque();
  } catch (errCham) {
    console.warn("Aviso ao iniciar listener de chamados QR Code / Casas / Estoque:", errCham);
  }
}

// Botão Sincronizar Nuvem no Header (Força verificação e atualização mútua)
async function sincronizarComNuvemHeader() {
  const icon = document.getElementById('iconSyncNuvemHeader');
  if (icon) icon.classList.add('fa-spin');
  showToast('🔄 Verificando e sincronizando dados da nuvem...', 'info');

  try {
    if (!firebaseInitialized || !firestoreDb) {
      initFirebase();
      if (!firebaseInitialized || !firestoreDb) {
        showToast('⚠️ Firebase não conectado. Verifique sua conexão com a internet.', 'warning');
        return;
      }
    }

    await window.StaticApiEngine.init();

    let atualizados = 0;

    // 1. Puxar todos os registros de alojados que já estão na nuvem
    const snap = await firestoreDb.collection('alojados').get();
    if (!snap.empty) {
      snap.forEach(doc => {
        const data = doc.data();
        if (data && data.id) {
          const aId = Number(data.id);
          if (data.excluido) {
            window.StaticApiEngine.dbState.alojados = (window.StaticApiEngine.dbState.alojados || []).filter(x => Number(x.id) !== aId);
            atualizados++;
            return;
          }
          const al = (window.StaticApiEngine.dbState.alojados || []).find(x => x.id === aId);
          if (al) {
            let mudou = false;
            ['foto_url', 'nome_completo', 'funcao', 'status', 'quarto_numero', 'bloco_nome', 'numero_cama', 'whatsapp', 'matricula', 'empresa_id', 'empresa_nome', 'empresa_cor', 'data_entrada', 'data_saida', 'observacoes'].forEach(k => {
              if (data[k] !== undefined && data[k] !== null && data[k] !== al[k]) {
                al[k] = data[k];
                mudou = true;
              }
            });
            if (mudou) {
              atualizados++;
              sincronizarVagaAlojadoEmMemoria(aId);
            }
          }
        }
      });
    }

    // 2. Puxar todas as vistorias/reparos de móveis da nuvem
    try {
      const snapMoveis = await firestoreDb.collection('moveis_vistorias').get();
      if (!snapMoveis.empty) {
        snapMoveis.forEach(doc => {
          const data = doc.data();
          if (data) {
            const mId = Number(doc.id) || Number(data.id) || Number(data.movel_id);
            if (sincronizarMovelEmMemoria(mId, data)) {
              atualizados++;
            }
          }
        });
      }
    } catch (eMoveis) {
      console.warn("Aviso ao puxar moveis_vistorias na sincronização:", eMoveis);
    }

    // 3. Puxar blocos da nuvem
    try {
      const snapBlocos = await firestoreDb.collection('blocos').get();
      if (!snapBlocos.empty) {
        snapBlocos.forEach(doc => {
          const data = doc.data();
          if (data) {
            const bId = Number(doc.id) || Number(data.id);
            if (sincronizarBlocoEmMemoria(bId, data)) atualizados++;
          }
        });
      }
    } catch (eB) { console.warn("Aviso ao puxar blocos:", eB); }

    // 4. Puxar empresas da nuvem
    try {
      const snapEmp = await firestoreDb.collection('empresas').get();
      if (!snapEmp.empty) {
        snapEmp.forEach(doc => {
          const data = doc.data();
          if (data) {
            const eId = Number(doc.id) || Number(data.id);
            if (sincronizarEmpresaEmMemoria(eId, data)) atualizados++;
          }
        });
      }
    } catch (eEmp) { console.warn("Aviso ao puxar empresas:", eEmp); }

    // 5. Puxar quartos da nuvem
    try {
      const snapQ = await firestoreDb.collection('quartos').get();
      if (!snapQ.empty) {
        snapQ.forEach(doc => {
          const data = doc.data();
          if (data) {
            const qId = Number(doc.id) || Number(data.id);
            if (sincronizarQuartoEmMemoria(qId, data)) atualizados++;
          }
        });
      }
    } catch (eQ) { console.warn("Aviso ao puxar quartos:", eQ); }

    if (atualizados > 0) {
      window.StaticApiEngine.recomputeStats();
      window.StaticApiEngine.saveToStorage();
      refreshAllData();
      showToast(`✅ ${atualizados} alteração(ões) sincronizada(s) com sucesso da nuvem!`, 'success');
    } else {
      showToast('✅ Seus dados já estão 100% sincronizados com a nuvem!', 'success');
    }
  } catch (err) {
    console.error("Erro ao sincronizar com nuvem:", err);
    if (err && (err.code === 'permission-denied' || (err.message && err.message.toLowerCase().includes('permission')))) {
      showToast("⚠️ Firebase: Permissão negada no Firestore. Ajuste as Regras no Console do Firebase.", "warning");
    } else {
      showToast(`Erro na sincronização: ${err.message}`, 'error');
    }
  } finally {
    if (icon) icon.classList.remove('fa-spin');
  }
}

// PARTE 1.1: Gerar Documento Snapshot Único (1 Leitura carrega todo o canteiro)
async function gerarSnapshotConsolidadoFirebase(manual = false) {
  if (!firebaseInitialized || !firestoreDb) {
    if (manual) showToast('Firebase Firestore não está conectado.', 'warning');
    return;
  }

  const btn = document.getElementById('btnGerarSnapshot');
  if (btn && manual) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Gerando Snapshot...';
  }

  try {
    const [resDashboard, resBlocos, resAlojados] = await Promise.all([
      fetch(`${API_BASE}/api/dashboard/stats`).then(r => r.json()),
      fetch(`${API_BASE}/api/blocos`).then(r => r.json()),
      fetch(`${API_BASE}/api/alojados`).then(r => r.json())
    ]);

    const snapshotData = {
      obra: "Canteiro Taboca 2",
      atualizado_em: new Date().toISOString(),
      atualizado_por: currentUserName,
      resumo: {
        total_vagas: resDashboard.geral?.total_vagas || 880,
        ocupadas: resDashboard.geral?.ocupadas || 0,
        disponiveis: resDashboard.geral?.disponiveis || 0,
        taxa_ocupacao: resDashboard.geral?.taxa_ocupacao || 0,
        total_blocos: resDashboard.geral?.total_blocos || 10,
        total_quartos: resDashboard.geral?.total_quartos || 220
      },
      blocos: resBlocos.map(b => ({
        id: b.id,
        nome: b.nome,
        tipo: b.tipo,
        total_vagas: b.total_vagas,
        ocupadas: b.ocupadas,
        livres: b.livres,
        taxa_ocupacao: b.taxa_ocupacao
      })),
      alojados: (Array.isArray(resAlojados) ? resAlojados : (resAlojados?.items || [])).map(a => ({
        id: a.id,
        mat: a.matricula || '',
        nome: a.nome_completo || '',
        func: a.funcao || '',
        emp: a.empresa_nome || '',
        emp_cor: a.empresa_cor || '',
        bloco: a.bloco_nome || '',
        q: a.quarto_numero || '',
        cama: a.numero_cama || 0,
        foto: a.foto_url || '',
        entrada: a.data_entrada || ''
      }))
    };

    // Grava exatamente em 1 ÚNICO documento consolidado
    await firestoreDb.collection('canteiro_metadata').doc('snapshot_canteiro').set(snapshotData);

    const nowStr = new Date().toLocaleTimeString('pt-BR');
    localStorage.setItem('ultimo_snapshot_firebase', nowStr);
    
    const snapEl = document.getElementById('firebaseSnapshotTimeText');
    if (snapEl) snapEl.textContent = `Hoje às ${nowStr} (Consome 1 leitura no celular)`;

    if (manual) {
      showToast('⚡ Snapshot único gerado com sucesso! Apenas 1 leitura necessária no celular (economia de 99%).', 'success');
    }
  } catch (err) {
    const isPermissionError = err && (err.code === 'permission-denied' || 
      (err.message && (err.message.toLowerCase().includes('permission') || err.message.toLowerCase().includes('insufficient'))));
    if (isPermissionError) {
      console.warn("⚠️ Firebase Firestore: Permissão negada para gerar snapshot no Console.");
      atualizarBadgeFirebaseUI(false, "Permissões Pendentes");
      const alertEl = document.getElementById('firebaseRulesAlert');
      if (alertEl) alertEl.classList.remove('hidden');
    } else {
      console.error("Erro ao gerar snapshot:", err);
    }
    if (manual) {
      if (isPermissionError) {
        showToast("⚠️ Firebase: Permissões insuficientes no Firestore. Acesse o Console e configure as Regras (veja na aba Configurações).", "warning");
      } else {
        showToast(`Erro ao gerar snapshot: ${err.message}`, 'error');
      }
    }
  } finally {
    if (btn && manual) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-bolt mr-1"></i> Atualizar Snapshot na Nuvem';
    }
  }
}

// PARTE 1.2: Testar Leitura por Snapshot Consolidado (Gasta somente 1 leitura!)
async function carregarDadosDoSnapshotFirebase() {
  if (!firebaseInitialized || !firestoreDb) {
    showToast('Firebase não conectado.', 'warning');
    return;
  }
  showToast('Lendo snapshot consolidado do Firebase (custo: 1 leitura)...', 'info');

  try {
    const doc = await firestoreDb.collection('canteiro_metadata').doc('snapshot_canteiro').get();
    if (!doc.exists) {
      showToast('Nenhum snapshot encontrado. Clique em "Atualizar Snapshot na Nuvem" primeiro.', 'warning');
      return;
    }
    const data = doc.data();
    showToast(`✅ Sucesso! 1 leitura consumida. Carregados ${data.alojados?.length || 0} operários e ${data.blocos?.length || 0} blocos da nuvem!`, 'success');
  } catch (err) {
    const isPermissionError = err && (err.code === 'permission-denied' || 
      (err.message && (err.message.toLowerCase().includes('permission') || err.message.toLowerCase().includes('insufficient'))));
    if (isPermissionError) {
      showToast("⚠️ Firebase: Leitura negada pelas Regras do Firestore. Configure as regras no Console.", "warning");
      atualizarBadgeFirebaseUI(false, "Permissões Pendentes");
      const alertEl = document.getElementById('firebaseRulesAlert');
      if (alertEl) alertEl.classList.remove('hidden');
    } else {
      showToast(`Erro ao ler snapshot: ${err.message}`, 'error');
    }
  }
}

function atualizarBadgeFirebaseUI(conectado, texto) {
  const dot = document.getElementById('firebaseDot');
  const txt = document.getElementById('firebaseStatusText');
  const cardBadge = document.getElementById('firebaseStatusBadgeCard');
  if (dot) {
    dot.className = conectado 
      ? 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse' 
      : 'w-2 h-2 rounded-full bg-amber-400';
  }
  if (txt) {
    txt.textContent = texto || (conectado ? 'Firebase Conectado' : 'Offline');
  }
  if (cardBadge) {
    cardBadge.className = conectado 
      ? 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300' 
      : 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300';
  }
}

// Sincronizar dados tabulares com Firebase Firestore (fotos ficam no PC local)
async function sincronizarTudoComFirebase(manual = true) {
  if (!firebaseInitialized || !firestoreDb) {
    if (manual) showToast('Firebase Firestore não está pronto ou indisponível.', 'warning');
    return;
  }

  const btnSync = document.getElementById('btnSyncFirebase');
  if (btnSync) {
    btnSync.disabled = true;
    btnSync.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Sincronizando com Firestore...';
  }

  if (manual) showToast('Iniciando sincronização completa com Firebase Firestore...', 'info');

  try {
    const [resDashboard, resBlocos, resAlojados] = await Promise.all([
      fetch(`${API_BASE}/api/dashboard/stats`).then(r => r.json()),
      fetch(`${API_BASE}/api/blocos`).then(r => r.json()),
      fetch(`${API_BASE}/api/alojados`).then(r => r.json())
    ]);

    const batch = firestoreDb.batch();

    const resumoRef = firestoreDb.collection('canteiro_metadata').doc('resumo_obra');
    batch.set(resumoRef, {
      obra: "Canteiro Taboca 2",
      total_vagas: resDashboard.geral?.total_vagas || resDashboard.total_vagas || 880,
      vagas_ocupadas: resDashboard.geral?.ocupadas || resDashboard.vagas_ocupadas || 0,
      vagas_disponiveis: resDashboard.geral?.disponiveis || resDashboard.vagas_disponiveis || 0,
      taxa_ocupacao: resDashboard.geral?.taxa_ocupacao || resDashboard.taxa_ocupacao || 0,
      ultima_sincronizacao: new Date().toISOString(),
      sincronizado_por: currentUserName,
      padrao_moveis: "2 Beliches, 4 Armários e 1 Ar-Condicionado por quarto",
      armazenamento_fotos: "Disco Local do Prefeito (uploads/fotos_alojados/)"
    }, { merge: true });

    resBlocos.forEach(b => {
      const bRef = firestoreDb.collection('blocos').doc(String(b.id));
      batch.set(bRef, {
        id: b.id,
        nome: b.nome,
        tipo: b.tipo,
        total_vagas: b.total_vagas,
        ocupadas: b.ocupadas,
        livres: b.livres,
        taxa_ocupacao: b.taxa_ocupacao,
        atualizado_em: new Date().toISOString()
      }, { merge: true });
    });

    await batch.commit();

    let batchAlojados = firestoreDb.batch();
    let countInBatch = 0;
    for (const a of resAlojados) {
      const aRef = firestoreDb.collection('alojados').doc(String(a.id));
      batchAlojados.set(aRef, {
        id: a.id,
        matricula: a.matricula || '',
        nome_completo: a.nome_completo || '',
        funcao: a.funcao || '',
        empresa_id: a.empresa_id,
        empresa_nome: a.empresa_nome || '',
        bloco_nome: a.bloco_nome || '',
        quarto_numero: a.quarto_numero || '',
        numero_cama: a.numero_cama || 0,
        status: a.status || 'ativo',
        data_entrada: a.data_entrada || '',
        tem_foto_local: !!(a.foto_url && a.foto_url.trim() !== ''),
        atualizado_em: new Date().toISOString()
      }, { merge: true });
      countInBatch++;
      if (countInBatch >= 350) {
        await batchAlojados.commit();
        batchAlojados = firestoreDb.batch();
        countInBatch = 0;
      }
    }
    if (countInBatch > 0) {
      await batchAlojados.commit();
    }

    // Gerar snapshot consolidado de 1 leitura
    await gerarSnapshotConsolidadoFirebase(false);

    const nowStr = new Date().toLocaleTimeString('pt-BR');
    localStorage.setItem('ultimo_sync_firebase', nowStr);
    const syncTimeEl = document.getElementById('firebaseLastSyncText');
    if (syncTimeEl) syncTimeEl.textContent = `Hoje às ${nowStr}`;

    if (manual) {
      showToast(`🔥 Sucesso! ${resAlojados.length} colaboradores e ${resBlocos.length} blocos sincronizados no Firebase!`, 'success');
    }
  } catch (err) {
    const isPermissionError = err && (err.code === 'permission-denied' || 
      (err.message && (err.message.toLowerCase().includes('permission') || err.message.toLowerCase().includes('insufficient'))));
    
    if (isPermissionError) {
      console.warn("⚠️ Firebase Firestore: Permissões insuficientes no Firestore. As regras no Console do Firebase precisam ser configuradas.");
      atualizarBadgeFirebaseUI(false, "Permissões Pendentes");
      const alertEl = document.getElementById('firebaseRulesAlert');
      if (alertEl) alertEl.classList.remove('hidden');
    } else {
      console.error("Erro na sincronização Firebase:", err);
    }
    
    if (manual) {
      if (isPermissionError) {
        showToast("⚠️ Firebase: Permissão negada no Firestore. Ajuste as Regras no Console do Firebase (veja instruções na aba Configurações).", "warning");
      } else {
        showToast(`Erro ao sincronizar com Firebase: ${err.message}`, "error");
      }
    }
  } finally {
    if (btnSync) {
      btnSync.disabled = false;
      btnSync.innerHTML = '<i class="fa-solid fa-cloud-arrow-up mr-2"></i> Sincronizar Tudo com Firebase Agora';
    }
  }
}

// ========================================================
// 0.1 CONFIGURAÇÃO DE TAMANHO DAS LETRAS (FONTS)
// ========================================================
const FONT_SIZES = {
  'sm': { label: 'Pequeno (13.5px)', size: '13.5px' },
  'md': { label: 'Padrão / Normal (15px)', size: '15px' },
  'lg': { label: 'Grande (17px)', size: '17px' },
  'xl': { label: 'Extra Grande (19px)', size: '19px' }
};

function alterarTamanhoFonte(key) {
  const cfg = FONT_SIZES[key] || FONT_SIZES['md'];
  document.documentElement.style.fontSize = cfg.size;
  localStorage.setItem('canteiro_font_size', key);

  ['sm', 'md', 'lg', 'xl'].forEach(k => {
    const btnNav = document.getElementById(`btnFontNav_${k}`);
    if (btnNav) {
      if (k === key) {
        btnNav.className = "px-1.5 py-0.5 text-xs font-bold rounded bg-amber-500 text-slate-950 transition";
      } else {
        btnNav.className = "px-1.5 py-0.5 text-xs font-bold rounded text-slate-400 hover:text-white transition";
      }
    }
    const cardConf = document.getElementById(`cardFontConfig_${k}`);
    if (cardConf) {
      if (k === key) {
        cardConf.className = "cursor-pointer p-4 rounded-xl border-2 border-amber-500 bg-amber-50/40 transition-all flex flex-col justify-between";
      } else {
        cardConf.className = "cursor-pointer p-4 rounded-xl border border-slate-200 hover:border-amber-500 transition-all flex flex-col justify-between";
      }
    }
  });
}

function inicializarTamanhoFonte() {
  const salvo = localStorage.getItem('canteiro_font_size') || 'md';
  alterarTamanhoFonte(salvo);
}

// ========================================================
// 0.15 IDENTIDADE VISUAL E GESTÃO DA EMPRESA / LOGO
// ========================================================
const DEFAULT_APP_LOGO = 'logo_gel_cropped.png';
const DEFAULT_EMPRESA_NOME = 'GEL • Goetze Lobato Engenharia S.A.';
const DEFAULT_EMPRESA_CURTO = 'Goetze Lobato Eng. S.A.';
const DEFAULT_OBRA_NOME = 'Taboca 2';

let windowTempCustomLogoFile = null;

function aplicarIdentidadeVisual(config = null) {
  const customLogo = (config && config.logo_url) || localStorage.getItem('appCustomLogo') || DEFAULT_APP_LOGO;
  const customEmpresa = (config && config.empresa_nome) || localStorage.getItem('appCustomEmpresaNome') || DEFAULT_EMPRESA_NOME;
  const customObra = (config && config.obra_nome) || localStorage.getItem('appCustomObraNome') || DEFAULT_OBRA_NOME;

  // 1. Atualizar todas as instâncias da Logomarca
  document.querySelectorAll('.app-logo-img').forEach(img => {
    img.src = customLogo;
  });

  // 2. Atualizar o preview na aba de configurações se existir
  const previewImg = document.getElementById('configLogoPreview');
  if (previewImg && !windowTempCustomLogoFile) {
    previewImg.src = customLogo;
  }

  // 3. Atualizar o nome da empresa
  document.querySelectorAll('.app-empresa-nome').forEach(el => {
    el.textContent = customEmpresa;
  });

  // 4. Atualizar versão curta do nome da empresa no footer da sidebar
  let curto = customEmpresa;
  if (curto.length > 26) {
    const parts = curto.split(/[•\-|]/);
    curto = (parts.length > 1 ? parts[1] : parts[0]).trim();
    if (curto.length > 26) curto = curto.substring(0, 24) + '...';
  }
  document.querySelectorAll('.app-empresa-curto').forEach(el => {
    el.textContent = curto;
  });

  // 5. Atualizar tag/nome da obra
  document.querySelectorAll('.app-obra-tag').forEach(el => {
    el.textContent = customObra;
  });

  // 6. Atualizar título da aba do navegador
  try {
    const empresaPrefix = customEmpresa.split('•')[0].trim();
    document.title = `Prefeitura de Canteiro • ${customObra} (${empresaPrefix})`;
  } catch (e) {}
}

function carregarConfigIdentidadeVisual() {
  const customLogo = localStorage.getItem('appCustomLogo') || DEFAULT_APP_LOGO;
  const customEmpresa = localStorage.getItem('appCustomEmpresaNome') || DEFAULT_EMPRESA_NOME;
  const customObra = localStorage.getItem('appCustomObraNome') || DEFAULT_OBRA_NOME;

  const inputEmpresa = document.getElementById('configEmpresaNome');
  if (inputEmpresa) inputEmpresa.value = customEmpresa;

  const inputObra = document.getElementById('configObraNome');
  if (inputObra) inputObra.value = customObra;

  const preview = document.getElementById('configLogoPreview');
  if (preview && !windowTempCustomLogoFile) preview.src = customLogo;

  const statusMsg = document.getElementById('identidadeVisualStatusMsg');
  if (statusMsg) statusMsg.textContent = 'Pronto para salvar alterações';
}

function previewLogoConfig(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];

  if (!file.type.startsWith('image/')) {
    showToast('Por favor, selecione um arquivo de imagem válido (PNG, JPG, WebP).', 'warning');
    return;
  }

  windowTempCustomLogoFile = file;

  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById('configLogoPreview');
    if (preview) {
      preview.src = e.target.result;
    }
    const statusMsg = document.getElementById('identidadeVisualStatusMsg');
    if (statusMsg) {
      statusMsg.innerHTML = '<span class="text-amber-600 font-semibold"><i class="fa-solid fa-circle-exclamation"></i> Nova logo selecionada. Clique em "Salvar Identidade Visual" para confirmar.</span>';
    }
    showToast('Prévia carregada! Clique em "Salvar Identidade Visual" para gravar.', 'info');
  };
  reader.readAsDataURL(file);
}

function redimensionarImagemLogo(file, maxDimension = 500) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/png');
        canvas.toBlob((blob) => {
          resolve({ blob, dataUrl });
        }, 'image/png');
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function salvarConfigIdentidadeVisual(event) {
  if (event && event.preventDefault) event.preventDefault();
  if (!checkPrefeitoAccess()) return;

  const btn = document.getElementById('btnSalvarIdentidadeVisual');
  const originalBtnHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Salvando na nuvem...';
  }

  const statusMsg = document.getElementById('identidadeVisualStatusMsg');
  if (statusMsg) statusMsg.textContent = 'Processando identidade visual...';

  try {
    let finalLogoUrl = localStorage.getItem('appCustomLogo') || DEFAULT_APP_LOGO;

    // 1. Se o usuário selecionou uma nova foto de logo
    if (windowTempCustomLogoFile) {
      if (statusMsg) statusMsg.textContent = 'Otimizando imagem da logomarca...';
      const { blob, dataUrl } = await redimensionarImagemLogo(windowTempCustomLogoFile, 500);

      // Tenta upload para ImgBB para URL global e leve
      let uploadSucesso = false;
      try {
        if (statusMsg) statusMsg.textContent = 'Enviando logo para servidor em nuvem...';
        const formData = new FormData();
        formData.append('image', blob, `logo_custom_${Date.now()}.png`);
        const resImgbb = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
          method: 'POST',
          body: formData
        });
        const imgbbData = await resImgbb.json();
        if (imgbbData && imgbbData.success && imgbbData.data && imgbbData.data.display_url) {
          finalLogoUrl = imgbbData.data.display_url;
          uploadSucesso = true;
          console.log("Logo customizada salva no ImgBB com sucesso:", finalLogoUrl);
        }
      } catch (errUpload) {
        console.warn("Falha no upload do ImgBB para a logo (usando fallback dataURL):", errUpload);
      }

      // Se o upload falhou ou sem internet, usa base64 comprimido
      if (!uploadSucesso) {
        finalLogoUrl = dataUrl;
      }

      windowTempCustomLogoFile = null;
    }

    // 2. Obter textos digitados
    const inputEmpresa = document.getElementById('configEmpresaNome');
    const inputObra = document.getElementById('configObraNome');

    const empresaNome = (inputEmpresa && inputEmpresa.value.trim()) ? inputEmpresa.value.trim() : DEFAULT_EMPRESA_NOME;
    const obraNome = (inputObra && inputObra.value.trim()) ? inputObra.value.trim() : DEFAULT_OBRA_NOME;

    // 3. Persistir localmente
    localStorage.setItem('appCustomLogo', finalLogoUrl);
    localStorage.setItem('appCustomEmpresaNome', empresaNome);
    localStorage.setItem('appCustomObraNome', obraNome);

    // 4. Aplicar imediatamente na UI de todas as abas e componentes
    aplicarIdentidadeVisual({
      logo_url: finalLogoUrl,
      empresa_nome: empresaNome,
      obra_nome: obraNome
    });

    // 5. Sincronizar com Firebase Firestore (para todos os aparelhos receberem em tempo real)
    if (typeof firestoreDb !== 'undefined' && firestoreDb) {
      if (statusMsg) statusMsg.textContent = 'Sincronizando com Firestore...';
      try {
        await firestoreDb.collection('configuracoes').doc('identidade_visual').set({
          logo_url: finalLogoUrl,
          empresa_nome: empresaNome,
          obra_nome: obraNome,
          atualizado_em: firebase.firestore.FieldValue.serverTimestamp(),
          atualizado_por: (typeof currentUserName !== 'undefined' ? currentUserName : 'Prefeito')
        }, { merge: true });
        console.log("Identidade visual salva e sincronizada com sucesso no Firestore!");
      } catch (errFs) {
        console.warn("Aviso ao salvar identidade visual no Firestore:", errFs);
      }
    }

    if (statusMsg) {
      statusMsg.innerHTML = '<span class="text-emerald-600 font-semibold"><i class="fa-solid fa-circle-check"></i> Alterações salvas e sincronizadas!</span>';
    }

    showToast('Identidade visual atualizada com sucesso em todo o sistema!', 'success');
  } catch (error) {
    console.error("Erro ao salvar identidade visual:", error);
    showToast('Erro ao salvar identidade visual: ' + error.message, 'error');
    if (statusMsg) {
      statusMsg.innerHTML = '<span class="text-rose-600 font-semibold"><i class="fa-solid fa-triangle-exclamation"></i> Erro ao salvar alterações.</span>';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalBtnHtml;
    }
  }
}

async function restaurarLogoPadrao() {
  if (!checkPrefeitoAccess()) return;

  if (!confirm("Deseja realmente restaurar a logomarca e nomes oficiais padrão da GEL?")) {
    return;
  }

  windowTempCustomLogoFile = null;
  const fileInput = document.getElementById('configLogoFileInput');
  if (fileInput) fileInput.value = '';

  localStorage.removeItem('appCustomLogo');
  localStorage.removeItem('appCustomEmpresaNome');
  localStorage.removeItem('appCustomObraNome');

  const inputEmpresa = document.getElementById('configEmpresaNome');
  if (inputEmpresa) inputEmpresa.value = DEFAULT_EMPRESA_NOME;

  const inputObra = document.getElementById('configObraNome');
  if (inputObra) inputObra.value = DEFAULT_OBRA_NOME;

  const preview = document.getElementById('configLogoPreview');
  if (preview) preview.src = DEFAULT_APP_LOGO;

  aplicarIdentidadeVisual({
    logo_url: DEFAULT_APP_LOGO,
    empresa_nome: DEFAULT_EMPRESA_NOME,
    obra_nome: DEFAULT_OBRA_NOME
  });

  if (typeof firestoreDb !== 'undefined' && firestoreDb) {
    try {
      await firestoreDb.collection('configuracoes').doc('identidade_visual').set({
        logo_url: DEFAULT_APP_LOGO,
        empresa_nome: DEFAULT_EMPRESA_NOME,
        obra_nome: DEFAULT_OBRA_NOME,
        atualizado_em: firebase.firestore.FieldValue.serverTimestamp(),
        atualizado_por: (typeof currentUserName !== 'undefined' ? currentUserName : 'Prefeito')
      }, { merge: true });
    } catch (e) {
      console.warn("Erro ao restaurar no Firestore:", e);
    }
  }

  const statusMsg = document.getElementById('identidadeVisualStatusMsg');
  if (statusMsg) {
    statusMsg.innerHTML = '<span class="text-emerald-600 font-semibold"><i class="fa-solid fa-circle-check"></i> Padrões da GEL restaurados com sucesso!</span>';
  }

  showToast('Padrão da GEL restaurado com sucesso!', 'info');
}

// ========================================================
// 0.2 CROPPER.JS - CORTE E EDIÇÃO DE FOTOS 1:1
// ========================================================
let currentCropper = null;
let currentCropAlojadoId = null;
let currentCropMoradorCasa = null; // { casaId, comodoId, camaNum }

function iniciarCropFoto(file, alojadoId) {
  if (!file) return;
  currentCropAlojadoId = alojadoId;

  const reader = new FileReader();
  reader.onload = function(e) {
    const imageToCrop = document.getElementById('imageToCrop');
    imageToCrop.src = e.target.result;

    abrirModal('modalCropFoto');

    if (currentCropper) {
      currentCropper.destroy();
      currentCropper = null;
    }

    setTimeout(() => {
      currentCropper = new Cropper(imageToCrop, {
        aspectRatio: 1,
        viewMode: 1,
        autoCropArea: 0.9,
        responsive: true,
        background: false,
        zoomable: true,
        rotatable: true,
        scalable: false,
        guides: true,
        highlight: true,
        cropBoxMovable: true,
        cropBoxResizable: true
      });
    }, 120);
  };
  reader.readAsDataURL(file);
}

function cropperRotate(degrees) {
  if (currentCropper) currentCropper.rotate(degrees);
}

function cropperZoom(ratio) {
  if (currentCropper) currentCropper.zoom(ratio);
}

function cropperReset() {
  if (currentCropper) currentCropper.reset();
}

function cancelarCropFoto() {
  if (currentCropper) {
    currentCropper.destroy();
    currentCropper = null;
  }
  fecharModal('modalCropFoto');
  const input = document.getElementById('modalFotoInputFile');
  if (input) input.value = '';
}

const IMGBB_API_KEY = '655783f08b2e45a3cd6b1b7a7e6ce91b';

async function confirmarCropFoto() {
  if (!currentCropper) return;
  const btn = document.getElementById('btnConfirmarCrop');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Enviando para nuvem...';
  }

  try {
    const canvas = currentCropper.getCroppedCanvas({
      width: 400,
      height: 400,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });

    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);

    canvas.toBlob(async (blob) => {
      if (!blob) {
        showToast('Erro ao processar recorte da foto', 'error');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-check"></i> Cortar & Salvar Foto';
        }
        return;
      }

      const alojadoId = currentCropAlojadoId || document.getElementById('modalFotoAlojadoId').value;
      let finalFotoUrl = null;

      // 1. Upload direto para ImgBB com chave oficial da API
      try {
        const formData = new FormData();
        formData.append('image', blob, `alojado_${alojadoId}.jpg`);
        const resImgbb = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
          method: 'POST',
          body: formData
        });
        const imgbbData = await resImgbb.json();
        if (imgbbData && imgbbData.success && imgbbData.data && imgbbData.data.display_url) {
          finalFotoUrl = imgbbData.data.display_url;
          console.log("Foto salva no ImgBB com sucesso:", finalFotoUrl);
        } else {
          console.warn("Retorno ImgBB não foi sucesso:", imgbbData);
        }
      } catch (errImgbb) {
        console.warn("Falha no upload do ImgBB (usando fallback local):", errImgbb);
      }

      // Fallback: se falhar ou estiver offline, usa dataUrl base64
      if (!finalFotoUrl) {
        finalFotoUrl = dataUrl;
      }

      // 2. Salvar no cache local do dispositivo (IndexedDB) para nunca mais gastar dados ao abrir
      try {
        await photoCacheManager.savePhoto(finalFotoUrl, dataUrl);
        atualizarContadorCacheUI();
      } catch (e) {
        console.warn("Erro ao salvar no cache IndexedDB:", e);
      }

      // 3. Atualizar no banco de dados local da aplicação (StaticApiEngine)
      await StaticApiEngine.init();
      const alojado = (StaticApiEngine.dbState.alojados || []).find(x => x.id == alojadoId);
      if (alojado) {
        alojado.foto_url = finalFotoUrl;
        (StaticApiEngine.dbState.quartos || []).forEach(q => {
          (q.vagas || []).forEach(v => {
            if (v.alojado && v.alojado.id == alojadoId) {
              v.alojado.foto_url = finalFotoUrl;
            }
          });
        });
        StaticApiEngine.saveToStorage();
      }

      // 3.1 Se for morador de Casa Urbana
      if (currentCropMoradorCasa) {
        const { casaId, comodoId, camaNum } = currentCropMoradorCasa;
        const casa = (listaCasasCidade || []).find(c => c.id === casaId);
        if (casa) {
          const com = (casa.comodos || []).find(x => x.id === comodoId);
          const cm = com ? (com.camas || []).find(x => Number(x.numero) === Number(camaNum)) : null;
          if (cm && cm.morador) {
            cm.morador.foto_url = finalFotoUrl;
          }
          try {
            localStorage.setItem('casas_cidade_cache', JSON.stringify(listaCasasCidade));
          } catch (e) {}
          if (firestoreDb) {
            try {
              firestoreDb.collection('casas_cidade').doc(casaId).update({
                comodos: casa.comodos,
                atualizado_em: new Date().toISOString()
              });
            } catch (e) {}
          }
          if (typeof atualizarDadosModalCasaDetalhes === 'function') {
            atualizarDadosModalCasaDetalhes(casa);
          }
          if (activeTab === 'casas_cidade' && typeof filtrarCasasCidadeUI === 'function') {
            filtrarCasasCidadeUI();
          }
        }
      }

      // 4. Salvar no Firestore se conectado
      if (firebaseInitialized && firestoreDb && !currentCropMoradorCasa) {
        firestoreDb.collection('alojados').doc(String(alojadoId)).set({
          foto_url: finalFotoUrl,
          atualizado_em: new Date().toISOString()
        }, { merge: true }).catch(() => {});
      }

      // 5. Atualizar imagem no modal de foto se aberto
      const imgEl = document.getElementById('modalFotoImg');
      if (imgEl) {
        imgEl.src = dataUrl;
        imgEl.classList.remove('hidden');
      }
      const vazioEl = document.getElementById('modalFotoVazio');
      if (vazioEl) vazioEl.classList.add('hidden');
      const btnRem = document.getElementById('modalFotoBtnRemover');
      if (btnRem) btnRem.classList.remove('hidden');

      showToast(`📸 Foto salva com sucesso e armazenada neste aparelho!`, 'success');

      cancelarCropFoto();
      
      if (activeTab === 'alojados') carregarAlojados();
      if (activeTab === 'blocos') carregarQuartos();
      if (activeTab === 'dashboard') carregarDashboard();
      aplicarCacheEmFotosNaTela();

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Cortar & Salvar Foto';
      }
    }, 'image/jpeg', 0.88);
  } catch (err) {
    showToast(err.message, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> Cortar & Salvar Foto';
    }
  }
}

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  aplicarIdentidadeVisual();
  inicializarTamanhoFonte();
  initFirebase();
  initMobileMenu();
  loadInitialData();
  updateUserRoleUI();
  inicializarAuditoria();
  inicializarRondaCanteiro();
  verificarAcaoUrlParametros();
});

// Alternar entre modo Prefeito (Admin) e Consulta
function toggleUserMode() {
  if (currentUserRole === 'prefeito') {
    currentUserRole = 'consulta';
    currentUserName = 'Fiscal / Consulta (Leitura)';
    showToast('Modo Consulta ativado (Somente Leitura)', 'info');
  } else {
    currentUserRole = 'prefeito';
    currentUserName = 'Prefeito da Obra (Admin)';
    showToast('Modo Prefeito ativado (Acesso Total de Edição)', 'success');
  }
  updateUserRoleUI();
}

function updateUserRoleUI() {
  const userRoleIcon = document.getElementById('userRoleIcon');
  const userRoleText = document.getElementById('userRoleText');
  const roleBadgeInPage = document.getElementById('roleBadgeInPage');

  if (currentUserRole === 'prefeito') {
    userRoleIcon.className = 'fa-solid fa-shield-halved text-amber-400';
    userRoleText.textContent = 'PREFEITO';
    userRoleText.className = 'text-amber-300 font-bold';
    if (roleBadgeInPage) {
      roleBadgeInPage.textContent = 'Acesso: Prefeito (Total)';
      roleBadgeInPage.className = 'px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300';
    }
    // Habilitar botões de prefeito
    document.querySelectorAll('.btn-prefeito').forEach(btn => {
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
      btn.removeAttribute('disabled');
    });
  } else {
    userRoleIcon.className = 'fa-solid fa-eye text-sky-400';
    userRoleText.textContent = 'CONSULTA';
    userRoleText.className = 'text-sky-300 font-medium';
    if (roleBadgeInPage) {
      roleBadgeInPage.textContent = 'Acesso: Consulta (Somente Leitura)';
      roleBadgeInPage.className = 'px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-300';
    }
    // Desabilitar botões de edição para modo consulta
    document.querySelectorAll('.btn-prefeito').forEach(btn => {
      btn.style.opacity = '0.5';
      btn.style.pointerEvents = 'none';
      btn.setAttribute('disabled', 'true');
    });
  }
}

function checkPrefeitoAccess() {
  if (currentUserRole !== 'prefeito') {
    showToast('Ação restrita! Mude para o modo Prefeito para editar ou excluir dados.', 'warning');
    return false;
  }
  return true;
}

// Navegação de Abas
function switchTab(tabId) {
  activeTab = tabId;
  
  // Atualiza botões da sidebar
  document.querySelectorAll('.nav-item').forEach(el => {
    if (el.getAttribute('data-tab') === tabId) {
      el.className = 'nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition text-white bg-slate-800/80 border-l-4 border-amber-500';
    } else {
      el.className = 'nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition text-slate-300 hover:bg-slate-800 hover:text-white';
    }
  });

  // Atualiza botões da barra inferior mobile (celular)
  document.querySelectorAll('.mobile-nav-btn').forEach(el => {
    const mobTab = el.getAttribute('data-mob-tab');
    if (mobTab === tabId) {
      el.className = 'mobile-nav-btn flex flex-col items-center justify-center flex-1 py-1 text-amber-400 transition font-bold scale-105';
    } else if (mobTab) {
      el.className = 'mobile-nav-btn flex flex-col items-center justify-center flex-1 py-1 text-slate-400 hover:text-white transition font-medium';
    }
  });

  // Esconde todas as abas e mostra a ativa
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  const activeEl = document.getElementById(`tab-${tabId}`);
  if (activeEl) {
    activeEl.classList.remove('hidden');
  }

  // Fecha menu mobile se aberto
  toggleSidebarMobile(false);

  // Executa carregamento sob demanda
  if (tabId === 'dashboard') {
    carregarDashboard();
  } else if (tabId === 'blocos') {
    carregarQuartos();
  } else if (tabId === 'alojados') {
    carregarAlojados();
  } else if (tabId === 'moveis') {
    carregarMoveis();
  } else if (tabId === 'chamados') {
    carregarChamados();
  } else if (tabId === 'casas_cidade') {
    carregarCasasCidade();
  } else if (tabId === 'ronda') {
    carregarRondaCanteiro();
  } else if (tabId === 'estoque') {
    carregarEstoque();
  } else if (tabId === 'gestao_cadastros') {
    carregarGestaoCadastros();
  } else if (tabId === 'relatorios') {
    carregarRelatoriosPreview();
  } else if (tabId === 'auditoria') {
    carregarAuditoria();
  } else if (tabId === 'configuracoes') {
    carregarConfigIdentidadeVisual();
    carregarConfigWhatsappPrefeito();
    const salvo = localStorage.getItem('canteiro_font_size') || 'md';
    alterarTamanhoFonte(salvo);
    atualizarContadorCacheUI();
    const syncTime = localStorage.getItem('ultimo_sync_firebase');
    if (syncTime) {
      const syncEl = document.getElementById('firebaseLastSyncText');
      if (syncEl) syncEl.textContent = `Hoje às ${syncTime}`;
    }
    const snapTime = localStorage.getItem('ultimo_snapshot_firebase');
    if (snapTime) {
      const snapEl = document.getElementById('firebaseSnapshotTimeText');
      if (snapEl) snapEl.textContent = `Hoje às ${snapTime} (1 doc = 1 leitura)`;
    }
  }

  updateUserRoleUI();
}

function toggleSidebarMobile(forceState) {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!sidebar) return;

  const isClosed = sidebar.classList.contains('-translate-x-full');
  const shouldOpen = forceState !== undefined ? forceState : isClosed;

  if (shouldOpen) {
    sidebar.classList.remove('-translate-x-full');
    if (backdrop) backdrop.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  } else {
    sidebar.classList.add('-translate-x-full');
    if (backdrop) backdrop.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }
}

function initMobileMenu() {
  const btn = document.getElementById('mobileMenuBtn');
  if (btn) {
    btn.onclick = (e) => {
      e.stopPropagation();
      toggleSidebarMobile();
    };
  }
}

// Carregamento de dados para Modo GitHub Pages / Offline
async function carregarDadosSnapshotEstatico() {
  await StaticApiEngine.init();
  globalStats = StaticApiEngine.dbState.geral;
  globalBlocos = StaticApiEngine.dbState.blocos || [];
  globalEmpresas = StaticApiEngine.dbState.empresas || [];
  globalQuartos = StaticApiEngine.dbState.quartos || [];
  globalAlojados = StaticApiEngine.dbState.alojados || [];
  
  const banner = document.getElementById('firebaseCacheStatusBadge');
  if (banner) banner.textContent = 'Modo GitHub Pages / Nuvem Ativo';
}

// Carregar Dados Iniciais
async function loadInitialData() {
  setRefreshAnimation(true);
  try {
    if (staticModeActive) {
      console.log("Ambiente GitHub Pages ou nuvem estática detectado. Inicializando dados da obra...");
      await StaticApiEngine.init();
      const banner = document.getElementById('firebaseCacheStatusBadge');
      if (banner) banner.textContent = 'Modo GitHub Pages / Nuvem Ativo';
    } else {
      // Testar se backend local responde
      try {
        const probe = await originalFetch(`${API_BASE}/api/dashboard/stats`);
        if (!probe.ok) {
          staticModeActive = true;
          await StaticApiEngine.init();
        }
      } catch (e) {
        staticModeActive = true;
        await StaticApiEngine.init();
      }
    }

    await Promise.all([
      carregarDashboard(),
      carregarEmpresasLista(),
      carregarBlocosLista(),
      carregarVagasLivresLista()
    ]);
  } catch (err) {
    console.error('Erro ao carregar dados iniciais:', err);
    showToast('Erro ao carregar dados da obra', 'error');
  } finally {
    setRefreshAnimation(false);
  }
}

async function refreshAllData() {
  setRefreshAnimation(true);
  try {
    await Promise.all([
      carregarDashboard(),
      carregarEmpresasLista(),
      carregarBlocosLista(),
      carregarVagasLivresLista()
    ]);
    if (activeTab === 'blocos') carregarQuartos();
    if (activeTab === 'alojados') carregarAlojados();
    if (activeTab === 'moveis') carregarMoveis();
    if (activeTab === 'gestao_cadastros') carregarGestaoCadastros();
    if (activeTab === 'relatorios') carregarRelatoriosPreview();
    if (activeTab === 'auditoria') carregarAuditoria();
    if (typeof atualizarContadoresCasasUI === 'function') atualizarContadoresCasasUI();
    if (activeTab === 'casas_cidade' && typeof filtrarCasasCidadeUI === 'function') filtrarCasasCidadeUI();
    if (typeof atualizarContadoresRondaUI === 'function') atualizarContadoresRondaUI();
    if (activeTab === 'ronda' && typeof carregarRondaCanteiro === 'function') carregarRondaCanteiro();
    if (activeTab === 'estoque' && typeof carregarEstoqueUI === 'function') carregarEstoqueUI();
    if (activeTab === 'chamados' && typeof filtrarChamadosUI === 'function') filtrarChamadosUI();
    showToast('Dados atualizados com sucesso!', 'success');
  } catch (err) {
    showToast('Erro ao atualizar dados', 'error');
  } finally {
    setRefreshAnimation(false);
  }
}

function setRefreshAnimation(spinning) {
  const icon = document.getElementById('refreshIcon');
  if (icon) {
    if (spinning) icon.classList.add('animate-spin');
    else icon.classList.remove('animate-spin');
  }
}

// ========================================================
// 1. DASHBOARD & ESTATÍSTICAS
// ========================================================

async function carregarDashboard() {
  try {
    const res = await fetch(`${API_BASE}/api/dashboard/stats`);
    const data = await res.json();
    globalStats = data;

    // Calcular estatísticas completas das Casas Urbanas
    const totCasas = (listaCasasCidade || []).length;
    let totQuartosCasas = 0;
    let totCamasCasas = 0;
    let totMoradoresCasas = 0;

    (listaCasasCidade || []).forEach(c => {
      (c.comodos || []).forEach(com => {
        if (com.tipo === 'quarto') {
          totQuartosCasas++;
          totCamasCasas += Number(com.capacidade_camas || 0);
          totMoradoresCasas += (com.camas || []).filter(cm => cm.morador && cm.morador.nome).length;
        }
      });
    });
    const livresCasas = Math.max(0, totCamasCasas - totMoradoresCasas);

    // Totais Consolidados (Alojamento Taboca 2 + Casas Urbanas)
    const alojVagas = Number(data.geral.total_vagas || 0);
    const alojOcupadas = Number(data.geral.ocupadas || 0);
    const alojLivres = Number(data.geral.disponiveis || 0);

    const totalVagasGeral = alojVagas + totCamasCasas;
    const totalOcupadasGeral = alojOcupadas + totMoradoresCasas;
    const totalLivresGeral = alojLivres + livresCasas;
    const taxaOcupacaoGeral = totalVagasGeral > 0 ? Math.round((totalOcupadasGeral / totalVagasGeral) * 100) : 0;

    // Atualiza KPIs do Topo com Valores Consolidados e Detalhamento
    const elKpiTotalVagas = document.getElementById('kpiTotalVagas');
    if (elKpiTotalVagas) elKpiTotalVagas.textContent = totalVagasGeral;
    const elKpiAlojVagas = document.getElementById('kpiAlojVagas');
    if (elKpiAlojVagas) elKpiAlojVagas.textContent = `${alojVagas} vagas`;
    const elKpiCasasVagas = document.getElementById('kpiCasasVagas');
    if (elKpiCasasVagas) elKpiCasasVagas.textContent = `${totCamasCasas} vagas`;

    const elKpiOcupadas = document.getElementById('kpiOcupadas');
    if (elKpiOcupadas) elKpiOcupadas.textContent = totalOcupadasGeral;
    const elKpiAlojOcupadas = document.getElementById('kpiAlojOcupadas');
    if (elKpiAlojOcupadas) elKpiAlojOcupadas.textContent = `${alojOcupadas} pessoas`;
    const elKpiCasasOcupadas = document.getElementById('kpiCasasOcupadas');
    if (elKpiCasasOcupadas) elKpiCasasOcupadas.textContent = `${totMoradoresCasas} pessoas`;

    const elKpiLivres = document.getElementById('kpiLivres');
    if (elKpiLivres) elKpiLivres.textContent = totalLivresGeral;
    const elKpiAlojLivres = document.getElementById('kpiAlojLivres');
    if (elKpiAlojLivres) elKpiAlojLivres.textContent = `${alojLivres} livres`;
    const elKpiCasasLivres = document.getElementById('kpiCasasLivres');
    if (elKpiCasasLivres) elKpiCasasLivres.textContent = `${livresCasas} livres`;

    const elKpiTaxa = document.getElementById('kpiTaxaOcupacao');
    if (elKpiTaxa) elKpiTaxa.textContent = `${taxaOcupacaoGeral}%`;

    const elKpiAlertas = document.getElementById('kpiAlertasManut');
    if (elKpiAlertas) elKpiAlertas.textContent = data.geral.total_alertas_manutencao;

    const elKpiQuartos = document.getElementById('kpiTotalQuartos');
    if (elKpiQuartos) elKpiQuartos.textContent = data.geral.total_quartos;
    const elKpiBlocos = document.getElementById('kpiTotalBlocos');
    if (elKpiBlocos) elKpiBlocos.textContent = data.geral.total_blocos;

    // Sidebar counts
    const elSideCountVagas = document.getElementById('sideCountVagas');
    if (elSideCountVagas) elSideCountVagas.textContent = totalVagasGeral;

    const sideBadge = document.getElementById('sideCountAlertas');
    if (sideBadge) {
      sideBadge.textContent = data.geral.total_alertas_manutencao;
      if (data.geral.total_alertas_manutencao > 0) {
        sideBadge.classList.remove('hidden');
      } else {
        sideBadge.classList.add('hidden');
      }
    }

    // Badge Alertas Top Navbar
    const badgeAlertas = document.getElementById('badgeAlertasNav');
    if (badgeAlertas) {
      if (data.geral.total_alertas_manutencao > 0) {
        badgeAlertas.textContent = data.geral.total_alertas_manutencao;
        badgeAlertas.classList.remove('hidden');
      } else {
        badgeAlertas.classList.add('hidden');
      }
    }

    // Banner de Alerta de Manutenção
    const banner = document.getElementById('bannerAlertaManutencao');
    if (banner) {
      if (data.geral.total_alertas_manutencao > 0) {
        banner.classList.remove('hidden');
        document.getElementById('bannerAlertaTexto').textContent = 
          `Foram identificados ${data.geral.total_alertas_manutencao} itens ou móveis necessitando de manutenção ou em estado ruim/danificado nas vistorias.`;
      } else {
        banner.classList.add('hidden');
      }
    }

    // Renderiza Cards dos Blocos no Dashboard (incluindo card de Casas Urbanas)
    renderBlocosCards(data.blocos);

    // Renderiza Gráficos
    renderChartBlocos(data.blocos);
    renderChartCasasCidade();
    renderChartEmpresas(data.empresas);

  } catch (err) {
    console.error('Erro dashboard:', err);
  }
}

function renderBlocosCards(blocos) {
  const container = document.getElementById('gridBlocosCards');
  if (!container) return;

  let htmlCards = (blocos || []).map(b => {
    let badgeTipo = 'bg-slate-100 text-slate-700';
    if (b.tipo === 'adm') badgeTipo = 'bg-indigo-100 text-indigo-700';
    if (b.tipo === 'conteiner') badgeTipo = 'bg-orange-100 text-orange-700';

    let barColor = 'bg-blue-600';
    if (b.taxa_ocupacao >= 95) barColor = 'bg-red-600';
    else if (b.taxa_ocupacao >= 70) barColor = 'bg-amber-500';

    return `
      <div onclick="filtrarBlocoEIrParaQuartos(${b.id})" class="bg-white p-4 rounded-xl border border-slate-200 hover:border-sky-400 hover:shadow-md transition cursor-pointer flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between gap-1 mb-1.5">
            <h4 class="font-bold text-slate-900 text-sm truncate">${b.nome}</h4>
            <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded ${badgeTipo}">${b.tipo.toUpperCase()}</span>
          </div>
          <div class="text-xs text-slate-500">
            ${b.total_quartos} quartos • ${b.total_vagas} vagas
          </div>
        </div>

        <div class="mt-3">
          <div class="flex items-center justify-between text-xs mb-1">
            <span class="font-semibold text-slate-700">${b.ocupadas} ocupadas</span>
            <span class="text-emerald-600 font-bold">${b.livres} livres</span>
          </div>
          <div class="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
            <div class="${barColor} h-full rounded-full transition-all" style="width: ${b.taxa_ocupacao}%"></div>
          </div>
          <div class="flex items-center justify-between mt-1 text-[11px] text-slate-400">
            <span>${b.taxa_ocupacao}% ocupação</span>
            ${b.itens_alerta > 0 ? `<span class="text-red-500 font-bold flex items-center gap-0.5"><i class="fa-solid fa-triangle-exclamation text-[10px]"></i> ${b.itens_alerta}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Adicionar Card Especial de Casas Urbanas ao Grid
  const totCasas = (listaCasasCidade || []).length;
  let totQuartosCasas = 0;
  let totCamasCasas = 0;
  let totMoradoresCasas = 0;

  (listaCasasCidade || []).forEach(c => {
    (c.comodos || []).forEach(com => {
      if (com.tipo === 'quarto') {
        totQuartosCasas++;
        totCamasCasas += Number(com.capacidade_camas || 0);
        totMoradoresCasas += (com.camas || []).filter(cm => cm.morador && cm.morador.nome).length;
      }
    });
  });
  const livresCasas = Math.max(0, totCamasCasas - totMoradoresCasas);
  const taxaCasas = totCamasCasas > 0 ? Math.round((totMoradoresCasas / totCamasCasas) * 100) : 0;

  let barColorCasas = 'bg-indigo-600';
  if (taxaCasas >= 95) barColorCasas = 'bg-red-600';
  else if (taxaCasas >= 70) barColorCasas = 'bg-amber-500';

  htmlCards += `
    <div onclick="switchTab('casas_cidade')" class="bg-gradient-to-br from-white to-indigo-50/50 p-4 rounded-xl border-2 border-indigo-200 hover:border-indigo-500 hover:shadow-lg transition cursor-pointer flex flex-col justify-between" title="Clique para gerenciar as Casas na Cidade">
      <div>
        <div class="flex items-center justify-between gap-1 mb-1.5">
          <h4 class="font-bold text-slate-900 text-sm truncate flex items-center gap-1.5">
            <i class="fa-solid fa-house-chimney text-indigo-600"></i> Casas na Cidade
          </h4>
          <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800">URBANO</span>
        </div>
        <div class="text-xs text-slate-500">
          ${totCasas} casas • ${totQuartosCasas} quartos • ${totCamasCasas} camas
        </div>
      </div>

      <div class="mt-3">
        <div class="flex items-center justify-between text-xs mb-1">
          <span class="font-semibold text-slate-700">${totMoradoresCasas} ocupadas</span>
          <span class="text-emerald-600 font-bold">${livresCasas} livres</span>
        </div>
        <div class="w-full h-2 rounded-full bg-indigo-100 overflow-hidden">
          <div class="${barColorCasas} h-full rounded-full transition-all" style="width: ${taxaCasas}%"></div>
        </div>
        <div class="flex items-center justify-between mt-1 text-[11px] text-slate-400">
          <span class="text-indigo-600 font-bold">${taxaCasas}% ocupação</span>
          <span class="text-indigo-600 font-bold flex items-center gap-0.5">Gerenciar <i class="fa-solid fa-arrow-right text-[10px]"></i></span>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = htmlCards;
}

function alternarModoGraficoBlocos(modo) {
  modoVisualizacaoChartBlocos = modo;

  const btnTodos = document.getElementById('btnChartModoTodos');
  const btnCasas = document.getElementById('btnChartModoCasas');
  const btnBlocos = document.getElementById('btnChartModoBlocos');

  [btnTodos, btnCasas, btnBlocos].forEach(b => {
    if (b) {
      b.className = 'px-2 py-1 rounded-md transition text-slate-500 hover:text-slate-800';
    }
  });

  const titEl = document.getElementById('tituloGraficoVagas');
  const subEl = document.getElementById('subtituloGraficoVagas');

  if (modo === 'todos') {
    if (btnTodos) btnTodos.className = 'px-2 py-1 rounded-md transition shadow-xs bg-white text-slate-800 font-bold';
    if (titEl) titEl.innerHTML = '<i class="fa-solid fa-chart-column text-sky-500 mr-2"></i>Vagas Ocupadas vs. Disponíveis (Blocos & Casas)';
    if (subEl) subEl.textContent = 'Canteiro Taboca 2 + Casas Urbanas';
  } else if (modo === 'casas') {
    if (btnCasas) btnCasas.className = 'px-2 py-1 rounded-md transition shadow-xs bg-white text-indigo-700 font-bold';
    if (titEl) titEl.innerHTML = '<i class="fa-solid fa-house text-indigo-600 mr-2"></i>Vagas Ocupadas vs. Disponíveis por Casa na Cidade';
    if (subEl) subEl.textContent = 'Detalhamento Casa a Casa';
  } else if (modo === 'blocos') {
    if (btnBlocos) btnBlocos.className = 'px-2 py-1 rounded-md transition shadow-xs bg-white text-sky-700 font-bold';
    if (titEl) titEl.innerHTML = '<i class="fa-solid fa-hotel text-sky-600 mr-2"></i>Vagas Ocupadas vs. Disponíveis por Bloco';
    if (subEl) subEl.textContent = 'Apenas Canteiro Taboca 2';
  }

  renderChartBlocos(globalStats?.blocos || []);
}

function renderChartBlocos(blocos) {
  const ctx = document.getElementById('chartBlocos');
  if (!ctx) return;

  if (chartBlocosInstance) {
    chartBlocosInstance.destroy();
  }

  // Estatísticas das Casas Urbanas
  const totCasas = (listaCasasCidade || []).length;
  let totQuartosCasas = 0;
  let totCamasCasas = 0;
  let totMoradoresCasas = 0;

  (listaCasasCidade || []).forEach(c => {
    (c.comodos || []).forEach(com => {
      if (com.tipo === 'quarto') {
        totQuartosCasas++;
        totCamasCasas += Number(com.capacidade_camas || 0);
        totMoradoresCasas += (com.camas || []).filter(cm => cm.morador && cm.morador.nome).length;
      }
    });
  });
  const livresCasas = Math.max(0, totCamasCasas - totMoradoresCasas);
  const taxaCasas = totCamasCasas > 0 ? Math.round((totMoradoresCasas / totCamasCasas) * 100) : 0;

  let labels = [];
  let ocupadas = [];
  let livres = [];
  let bgOcupadas = [];
  let bgLivres = [];
  let metaInfo = [];

  if (modoVisualizacaoChartBlocos === 'casas') {
    // Modo Casa a Casa
    if (!listaCasasCidade || listaCasasCidade.length === 0) {
      labels = ['Nenhuma casa'];
      ocupadas = [0];
      livres = [0];
      bgOcupadas = ['#6366f1'];
      bgLivres = ['#10b981'];
      metaInfo = [{ total: 0, taxa: 0, quartos: 0 }];
    } else {
      listaCasasCidade.forEach(c => {
        let camasCasa = 0;
        let ocupadasCasa = 0;
        let quartosCasa = 0;
        (c.comodos || []).forEach(com => {
          if (com.tipo === 'quarto') {
            quartosCasa++;
            camasCasa += Number(com.capacidade_camas || 0);
            ocupadasCasa += (com.camas || []).filter(cm => cm.morador && cm.morador.nome).length;
          }
        });
        const livresCasa = Math.max(0, camasCasa - ocupadasCasa);
        const taxaCasa = camasCasa > 0 ? Math.round((ocupadasCasa / camasCasa) * 100) : 0;

        labels.push(c.nome || 'Casa');
        ocupadas.push(ocupadasCasa);
        livres.push(livresCasa);
        bgOcupadas.push('#6366f1');
        bgLivres.push('#10b981');
        metaInfo.push({ total: camasCasa, taxa: taxaCasa, quartos: quartosCasa });
      });
    }
  } else if (modoVisualizacaoChartBlocos === 'blocos') {
    // Apenas blocos do canteiro
    labels = (blocos || []).map(b => b.nome);
    ocupadas = (blocos || []).map(b => b.ocupadas);
    livres = (blocos || []).map(b => b.livres);
    bgOcupadas = (blocos || []).map(() => '#2563eb');
    bgLivres = (blocos || []).map(() => '#10b981');
    metaInfo = (blocos || []).map(b => ({ total: b.total_vagas, taxa: b.taxa_ocupacao }));
  } else {
    // 'todos' (Padrão): Blocos do Canteiro + Barra Especial de Casas na Cidade
    labels = (blocos || []).map(b => b.nome);
    ocupadas = (blocos || []).map(b => b.ocupadas);
    livres = (blocos || []).map(b => b.livres);
    bgOcupadas = (blocos || []).map(() => '#2563eb');
    bgLivres = (blocos || []).map(() => '#10b981');
    metaInfo = (blocos || []).map(b => ({ total: b.total_vagas, taxa: b.taxa_ocupacao }));

    // Coluna Especial de Casas na Cidade
    labels.push('🏠 Casas na Cidade');
    ocupadas.push(totMoradoresCasas);
    livres.push(livresCasas);
    bgOcupadas.push('#6366f1'); // Destaque Indigo para Casas
    bgLivres.push('#34d399');   // Verde menta suave
    metaInfo.push({
      total: totCamasCasas,
      taxa: taxaCasas,
      detalhesExtra: `${totCasas} casas • ${totQuartosCasas} quartos`
    });
  }

  chartBlocosInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Vagas Ocupadas',
          data: ocupadas,
          backgroundColor: bgOcupadas,
          borderRadius: 4,
        },
        {
          label: 'Vagas Disponíveis',
          data: livres,
          backgroundColor: bgLivres,
          borderRadius: 4,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { font: { size: 10 } }
        },
        y: {
          stacked: true,
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 10 } }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: { font: { size: 11, family: 'Inter' }, usePointStyle: true, boxWidth: 8 }
        },
        tooltip: {
          callbacks: {
            footer: (items) => {
              const idx = items[0].dataIndex;
              const meta = metaInfo[idx];
              if (!meta) return '';
              let txt = `Capacidade: ${meta.total} vagas | Ocupação: ${meta.taxa}%`;
              if (meta.detalhesExtra) txt += ` (${meta.detalhesExtra})`;
              if (meta.quartos) txt += ` | ${meta.quartos} quartos`;
              return txt;
            }
          }
        }
      }
    }
  });
}

function renderChartCasasCidade() {
  const ctx = document.getElementById('chartCasasCidade');
  if (!ctx) return;

  if (chartCasasCidadeInstance) {
    chartCasasCidadeInstance.destroy();
  }

  const totCasas = (listaCasasCidade || []).length;
  let totQuartosCasas = 0;
  let totCamasCasas = 0;
  let totMoradoresCasas = 0;

  (listaCasasCidade || []).forEach(c => {
    (c.comodos || []).forEach(com => {
      if (com.tipo === 'quarto') {
        totQuartosCasas++;
        totCamasCasas += Number(com.capacidade_camas || 0);
        totMoradoresCasas += (com.camas || []).filter(cm => cm.morador && cm.morador.nome).length;
      }
    });
  });
  const livresCasas = Math.max(0, totCamasCasas - totMoradoresCasas);
  const taxaCasas = totCamasCasas > 0 ? Math.round((totMoradoresCasas / totCamasCasas) * 100) : 0;

  // Atualizar textos e contadores no card
  const elOcup = document.getElementById('chartCasasOcupadasNum');
  if (elOcup) elOcup.textContent = `${totMoradoresCasas} camas`;
  const elLivres = document.getElementById('chartCasasLivresNum');
  if (elLivres) elLivres.textContent = `${livresCasas} vagas`;
  const elTaxa = document.getElementById('chartCasasTaxaTexto');
  if (elTaxa) elTaxa.textContent = `${taxaCasas}%`;
  const elSub = document.getElementById('chartCasasSubInfo');
  if (elSub) elSub.textContent = `${totCasas} casa${totCasas === 1 ? '' : 's'} • ${totQuartosCasas} quarto${totQuartosCasas === 1 ? '' : 's'}`;

  const dataVals = totCamasCasas === 0 ? [0, 1] : [totMoradoresCasas, livresCasas];
  const bgColors = totCamasCasas === 0 ? ['#cbd5e1', '#f1f5f9'] : ['#6366f1', '#10b981'];

  chartCasasCidadeInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Camas Ocupadas', 'Camas Livres'],
      datasets: [
        {
          data: dataVals,
          backgroundColor: bgColors,
          borderWidth: 2,
          borderColor: '#ffffff',
          hoverOffset: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: (item) => {
              if (totCamasCasas === 0) return ' Nenhuma cama cadastrada';
              const val = item.raw;
              const pct = Math.round((val / totCamasCasas) * 100);
              return ` ${item.label}: ${val} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

function renderChartEmpresas(empresas) {
  const ctx = document.getElementById('chartEmpresas');
  if (!ctx) return;

  if (chartEmpresasInstance) {
    chartEmpresasInstance.destroy();
  }

  document.getElementById('totalEmpresasCount').textContent = `${empresas.length} empresas com alojados`;

  const labels = empresas.map(e => e.nome);
  const dataVals = empresas.map(e => e.total_alojados);
  const colors = empresas.map(e => e.cor || '#3b82f6');

  chartEmpresasInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: dataVals,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#ffffff',
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 10,
            font: { size: 9, family: 'Inter' }
          }
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const label = context.label || '';
              const val = context.raw || 0;
              const total = context.chart._metasets[0].total;
              const pct = ((val / total) * 100).toFixed(1);
              return ` ${label}: ${val} alojados (${pct}%)`;
            }
          }
        }
      },
      cutout: '62%'
    }
  });
}

function goToAlertas() {
  switchTab('moveis');
  const selManut = document.getElementById('filtroMovelManut');
  if (selManut) {
    selManut.value = '1';
    carregarMoveis();
  }
}

function filtrarBlocoEIrParaQuartos(blocoId) {
  filtroBlocoAtivo = blocoId;
  switchTab('blocos');
}

// ========================================================
// 2. VISÃO DE BLOCOS E QUARTOS (MAPA DE CAMAS)
// ========================================================

async function carregarBlocosBotoesFiltro() {
  const container = document.getElementById('filtroBlocosBotoes');
  if (!container) return;

  let html = `
    <button onclick="selecionarFiltroBloco('')" class="btn-filtro-bloco px-3 py-1 rounded-full text-xs font-semibold transition ${filtroBlocoAtivo === '' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">
      Todos os Blocos
    </button>
  `;

  globalBlocos.forEach(b => {
    const isSelected = String(filtroBlocoAtivo) === String(b.id);
    html += `
      <button onclick="selecionarFiltroBloco(${b.id})" class="btn-filtro-bloco px-3 py-1 rounded-full text-xs font-semibold transition ${isSelected ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">
        ${b.nome}
      </button>
    `;
  });

  container.innerHTML = html;
}

function selecionarFiltroBloco(blocoId) {
  filtroBlocoAtivo = blocoId;
  carregarBlocosBotoesFiltro();
  carregarQuartos();
}

async function carregarQuartos() {
  await carregarBlocosBotoesFiltro();

  const busca = document.getElementById('filtroQuartoBusca').value.trim();
  const statusOcup = document.getElementById('filtroQuartoStatus').value;
  const alerta = document.getElementById('filtroQuartoAlerta').value;

  let url = `${API_BASE}/api/quartos?`;
  if (filtroBlocoAtivo) url += `bloco_id=${filtroBlocoAtivo}&`;
  if (statusOcup) url += `status_ocupacao=${statusOcup}&`;
  if (alerta === '1') url += `filtro_alerta=true&`;
  if (busca) url += `q=${encodeURIComponent(busca)}&`;

  try {
    const res = await fetch(url);
    let data = await res.json();
    globalQuartos = data;

    if (alerta && alerta !== '1') {
      data = data.filter(q => {
        if (q.status === 'desativado' || q.ativo === false) return false;
        const stLimp = typeof calcularStatusLimpezaQuarto === 'function' ? calcularStatusLimpezaQuarto(q) : null;
        const recs = typeof obterChamadosAbertosQuarto === 'function' ? obterChamadosAbertosQuarto(q) : [];
        if (alerta === 'limpeza_hoje') return stLimp && stLimp.rotina.status === 'ok';
        if (alerta === 'limpeza_pendente') return stLimp && stLimp.rotina.status !== 'ok';
        if (alerta === 'ar_vencido') return stLimp && stLimp.ar.status !== 'ok';
        if (alerta === 'com_reclamacao') return recs.length > 0;
        return true;
      });
    }

    renderQuartosCards(data);
  } catch (err) {
    console.error('Erro quartos:', err);
  }
}

function aplicarFiltrosQuartos() {
  carregarQuartos();
}

// ========================================================
// FUNÇÕES UTILITÁRIAS DE TELEFONE E WHATSAPP
// ========================================================
function formatarTelefoneInput(input) {
  if (!input) return;
  let v = input.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 10) {
    input.value = `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
  } else if (v.length > 6) {
    input.value = `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
  } else if (v.length > 2) {
    input.value = `(${v.slice(0, 2)}) ${v.slice(2)}`;
  } else if (v.length > 0) {
    input.value = `(${v}`;
  } else {
    input.value = '';
  }
}

function formatarTelefoneTexto(val) {
  if (!val) return '';
  const digits = String(val).replace(/\D/g, '').slice(-11);
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  } else if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return val;
}

function getWhatsappUrl(telefone) {
  if (!telefone) return null;
  let digits = String(telefone).replace(/\D/g, '');
  if (!digits || digits.length < 10) return null;
  if (digits.length === 10 || digits.length === 11) {
    digits = '55' + digits;
  }
  return `https://wa.me/${digits}`;
}

function renderQuartosCards(quartos) {
  const container = document.getElementById('gridQuartos');
  const vazioEl = document.getElementById('quartosVazio');
  if (!container) return;

  if (quartos.length === 0) {
    container.innerHTML = '';
    vazioEl.classList.remove('hidden');
    return;
  }
  vazioEl.classList.add('hidden');

  container.innerHTML = quartos.map(q => {
    // Determina badge de ocupação
    const isDesativado = q.status === 'desativado' || q.ativo === false;
    let borderClass = 'bg-white border-emerald-300 hover:border-emerald-500';
    let badgeColor = 'bg-emerald-100 text-emerald-800 border-emerald-300';
    let statusTexto = `${q.vagas_livres} Vaga(s) Livre(s)`;

    if (isDesativado) {
      borderClass = 'bg-slate-50/80 border-slate-300 border-dashed opacity-90';
      badgeColor = 'bg-slate-200 text-slate-700 border-slate-400 font-bold';
      statusTexto = '⚫ Quarto Desativado';
    } else if (q.status_visual === 'lotado') {
      borderClass = 'bg-white border-red-300 hover:border-red-500';
      badgeColor = 'bg-red-100 text-red-800 border-red-300';
      statusTexto = 'Lotado (100%)';
    } else if (q.status_visual === 'quase_cheio') {
      borderClass = 'bg-white border-amber-300 hover:border-amber-500';
      badgeColor = 'bg-amber-100 text-amber-800 border-amber-300';
      statusTexto = 'Quase Cheio (1 livre)';
    }

    // Camas dentro do quarto
    const camasHtml = q.vagas.map(v => {
      const alId = v.alojado_id || (v.alojado && v.alojado.id);
      const isOcupada = (v.status === 'ocupada') && (alId || v.nome_completo || v.alojado);
      if (isOcupada) {
        const nomeAl = v.nome_completo || (v.alojado && v.alojado.nome_completo) || 'Colaborador';
        let finalId = alId || (v.alojado && v.alojado.id) || 0;
        if ((!finalId || finalId === 0) && window.StaticApiEngine && window.StaticApiEngine.dbState && window.StaticApiEngine.dbState.alojados) {
          const alFound = window.StaticApiEngine.dbState.alojados.find(a => a.nome_completo && a.nome_completo.trim().toUpperCase() === nomeAl.trim().toUpperCase());
          if (alFound) finalId = alFound.id;
        }
        const safeNome = nomeAl.replace(/'/g, "\\'");
        const empNome = v.empresa_nome || (v.alojado && v.alojado.empresa_nome) || 'GEL';
        const safeEmpresa = empNome.replace(/'/g, "\\'");
        const funcaoAl = v.funcao || (v.alojado && v.alojado.funcao) || '';
        const safeFuncao = funcaoAl.replace(/'/g, "\\'");
        const fotoAl = v.foto_url || (v.alojado && v.alojado.foto_url) || '';
        const matAl = v.matricula || (v.alojado && v.alojado.matricula) || '';
        const corEmp = v.empresa_cor || (v.alojado && v.alojado.empresa_cor) || '#2563eb';
        const clickFoto = `abrirModalFotoAlojado(${finalId}, '${safeNome}', '${fotoAl}', '${safeEmpresa}', '${corEmp}', '${safeFuncao}', '${matAl}', '${q.bloco_nome}', '${q.numero}', ${v.numero_cama})`;

        // Buscar telefone atualizado
        const alObj = (window.StaticApiEngine && window.StaticApiEngine.dbState && window.StaticApiEngine.dbState.alojados)
          ? window.StaticApiEngine.dbState.alojados.find(x => Number(x.id) === Number(finalId))
          : null;
        const zapNum = (alObj && alObj.whatsapp) ? alObj.whatsapp : (v.whatsapp || '');
        const waUrl = getWhatsappUrl(zapNum);

        return `
          <div class="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-col justify-between text-xs">
            <div class="flex items-center justify-between gap-1 mb-1.5">
              <span class="font-bold text-slate-800 flex items-center gap-1">
                <i class="fa-solid fa-bed text-blue-600"></i> Cama ${v.numero_cama}
              </span>
              <span class="text-[9px] font-bold px-1.5 py-0.5 rounded text-white truncate max-w-[100px]" style="background-color: ${corEmp}">
                ${empNome}
              </span>
            </div>
            
            <div class="flex items-center gap-2 mb-1">
              ${renderAvatarHtml(nomeAl, fotoAl, 'w-8 h-8', 'text-[11px]', clickFoto)}
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span class="font-bold text-slate-900 truncate cursor-pointer hover:text-sky-600" onclick="${clickFoto}" title="Ver perfil e WhatsApp">${nomeAl}</span>
                  ${waUrl ? `
                    <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 hover:bg-emerald-200 text-emerald-600 text-[11px] flex-shrink-0 transition" title="Conversar no WhatsApp (${zapNum})">
                      <i class="fa-brands fa-whatsapp"></i>
                    </a>
                  ` : ''}
                </div>
                <div class="text-[11px] text-slate-500 truncate">${funcaoAl || 'Alojado'} • Reg: ${matAl || '-'}</div>
              </div>
            </div>

            <!-- Ações rápidas na cama -->
            <div class="mt-2 pt-1.5 border-t border-slate-200 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <button onclick="${clickFoto}" class="text-[10px] font-semibold text-slate-500 hover:text-amber-600 flex items-center gap-1" title="Foto do trabalhador">
                  <i class="fa-solid fa-camera"></i> Foto
                </button>
                ${waUrl ? `
                  <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="text-[10px] font-bold text-emerald-600 hover:text-emerald-800 flex items-center gap-1 transition" title="Conversar no WhatsApp">
                    <i class="fa-brands fa-whatsapp"></i> Zap
                  </a>
                ` : ''}
              </div>
              <div class="flex items-center gap-2">
                <button onclick="abrirModalRealocar(${finalId}, '${safeNome}', '${q.bloco_nome}', '${q.numero}', ${v.numero_cama})" class="btn-prefeito text-[10px] font-semibold text-sky-600 hover:text-sky-800 flex items-center gap-1">
                  <i class="fa-solid fa-arrows-turn-to-dots"></i> Mover
                </button>
                <button onclick="abrirModalDesligar(${finalId}, '${safeNome}')" class="btn-prefeito text-[10px] font-semibold text-red-600 hover:text-red-800 flex items-center gap-1">
                  <i class="fa-solid fa-person-walking-arrow-right"></i> Liberar
                </button>
              </div>
            </div>
          </div>
        `;
      } else {
        const idVaga = v.id || v.vaga_id || '';
        if (isDesativado) {
          return `
            <div class="p-2.5 rounded-lg bg-slate-200/50 border border-dashed border-slate-300 flex flex-col justify-between text-xs">
              <div class="flex items-center justify-between">
                <span class="font-bold text-slate-600 flex items-center gap-1">
                  <i class="fa-solid fa-bed text-slate-400"></i> Cama ${v.numero_cama}
                </span>
                <span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-300 text-slate-700">DESATIVADA</span>
              </div>
              <div class="my-2 text-center text-slate-500 text-[11px] italic">
                Quarto fora de operação
              </div>
              <button onclick="reativarQuartoBloco(${q.id})" class="btn-prefeito w-full py-1 rounded bg-slate-700 hover:bg-slate-800 text-white text-[10px] font-semibold flex items-center justify-center gap-1 transition">
                <i class="fa-solid fa-rotate-left"></i> Reativar Quarto
              </button>
            </div>
          `;
        }
        return `
          <div class="p-2.5 rounded-lg bg-emerald-50/60 border border-dashed border-emerald-300 flex flex-col justify-between text-xs">
            <div class="flex items-center justify-between">
              <span class="font-bold text-emerald-800 flex items-center gap-1">
                <i class="fa-solid fa-bed text-emerald-500"></i> Cama ${v.numero_cama}
              </span>
              <span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-800">LIVRE</span>
            </div>
            
            <div class="my-2 text-center text-emerald-700 text-[11px] italic">
              Disponível para alojar
            </div>

            <button onclick="openModalNovoAlojadoComVaga(${idVaga})" class="btn-prefeito w-full py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold flex items-center justify-center gap-1 transition">
              <i class="fa-solid fa-plus"></i> Alojar
            </button>
          </div>
        `;
      }
    }).join('');

    const stLimpQuarto = (!isDesativado && typeof calcularStatusLimpezaQuarto === 'function')
      ? calcularStatusLimpezaQuarto(q)
      : null;
    const chamadosQuarto = (!isDesativado && typeof obterChamadosAbertosQuarto === 'function')
      ? obterChamadosAbertosQuarto(q)
      : [];

    return `
      <div class="rounded-xl border ${chamadosQuarto.length > 0 ? 'bg-white border-rose-400 ring-1 ring-rose-200' : borderClass} shadow-sm transition p-4 flex flex-col justify-between space-y-3">
        <!-- Topo do Card do Quarto -->
        <div class="flex items-start justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-lg font-extrabold text-slate-900">Quarto ${q.numero}</span>
              <span class="text-xs px-2 py-0.5 rounded font-semibold bg-slate-100 text-slate-700">${q.bloco_nome}</span>
            </div>
            <div class="text-xs text-slate-500 mt-0.5">
              ${isDesativado ? '<span class="text-rose-600 font-bold">Quarto desativado da capacidade</span>' : `Capacidade: ${q.capacidade} vagas (${q.vagas_ocupadas} ocupadas)`}
            </div>
          </div>

          <div class="flex flex-col items-end gap-1">
            <span class="text-[11px] font-bold px-2 py-0.5 rounded border ${badgeColor}">
              ${statusTexto}
            </span>
            ${q.itens_alerta > 0 ? `
              <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-300 flex items-center gap-1" title="Móveis/Itens precisando de reparo">
                <i class="fa-solid fa-wrench"></i> ${q.itens_alerta} Alerta(s)
              </span>
            ` : ''}
          </div>
        </div>

        ${chamadosQuarto.length > 0 ? `
          <!-- Tarja Pulsante de Reclamação / Chamado via QR Code -->
          <div onclick="abrirModalOcorrenciasUnidade('alojamento', ${q.id})" class="p-2.5 rounded-xl bg-rose-50 border border-rose-300 flex items-center justify-between gap-2 cursor-pointer hover:bg-rose-100 transition shadow-2xs">
            <div class="flex items-center gap-2 min-w-0">
              <span class="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping flex-shrink-0"></span>
              <div class="truncate">
                <span class="text-[10px] font-black uppercase text-rose-800 block">🚨 ${chamadosQuarto.length} Reclamação(ões) em Aberto</span>
                <span class="text-[11px] text-rose-700 font-semibold truncate block">${chamadosQuarto[0].categoria}: ${chamadosQuarto[0].descricao}</span>
              </div>
            </div>
            <span class="px-2 py-1 rounded-lg bg-rose-600 text-white font-bold text-[10px] whitespace-nowrap flex-shrink-0">Ver / Resolver</span>
          </div>
        ` : ''}

        <!-- Grade de Camas -->
        <div class="grid grid-cols-2 gap-2">
          ${camasHtml}
        </div>

        ${(!isDesativado && stLimpQuarto) ? `
          <!-- Indicadores de Limpeza Diária & Ar Condicionado (30d) do Quarto -->
          <div class="grid grid-cols-2 gap-2 text-xs pt-1">
            <div 
              onclick="abrirModalRegistroLimpezaQuarto(${q.id}, 'rotina')" 
              class="p-2 rounded-xl border transition cursor-pointer select-none ${stLimpQuarto.rotina.cardBg || 'bg-slate-50 border-slate-200'} hover:shadow-xs" 
              title="${stLimpQuarto.rotina.tooltip} — Clique para registrar faxina"
            >
              <div class="flex items-center justify-between gap-1 mb-0.5">
                <span class="text-[9px] uppercase font-bold text-slate-500 flex items-center gap-1 truncate">
                  <i class="fa-solid fa-broom ${stLimpQuarto.rotina.cor === 'emerald' ? 'text-emerald-600' : 'text-amber-500'}"></i> Faxina
                </span>
                <span class="px-1.5 py-0.2 rounded text-[8px] font-extrabold uppercase border ${stLimpQuarto.rotina.badgeClass}">
                  ${stLimpQuarto.rotina.badgeLabel}
                </span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full flex-shrink-0 ${stLimpQuarto.rotina.badgeDot}"></span>
                <span class="font-extrabold text-[10px] truncate block ${stLimpQuarto.rotina.cor === 'emerald' ? 'text-emerald-900' : 'text-amber-900'}">
                  ${stLimpQuarto.rotina.textoCurto}
                </span>
              </div>
            </div>

            <div 
              onclick="abrirModalRegistroLimpezaQuarto(${q.id}, 'ar_condicionado')" 
              class="p-2 rounded-xl border transition cursor-pointer select-none ${stLimpQuarto.ar.cardBg || 'bg-slate-50 border-slate-200'} hover:shadow-xs" 
              title="${stLimpQuarto.ar.tooltip} — Clique para registrar higienização do ar"
            >
              <div class="flex items-center justify-between gap-1 mb-0.5">
                <span class="text-[9px] uppercase font-bold text-slate-500 flex items-center gap-1 truncate">
                  <i class="fa-solid fa-snowflake ${stLimpQuarto.ar.cor === 'emerald' ? 'text-emerald-600' : 'text-rose-600'}"></i> Ar (30d)
                </span>
                <span class="px-1.5 py-0.2 rounded text-[8px] font-extrabold uppercase border ${stLimpQuarto.ar.badgeClass}">
                  ${stLimpQuarto.ar.badgeLabel}
                </span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full flex-shrink-0 ${stLimpQuarto.ar.badgeDot}"></span>
                <span class="font-extrabold text-[10px] truncate block ${stLimpQuarto.ar.cor === 'emerald' ? 'text-emerald-900' : 'text-rose-900'}">
                  ${stLimpQuarto.ar.textoCurto}
                </span>
              </div>
            </div>
          </div>
        ` : ''}

        <!-- Rodapé do Card: Ações do Quarto -->
        <div class="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
          <div class="flex items-center gap-2">
            <button onclick="abrirModalQuartoDetalhes(${q.id})" class="text-sky-600 hover:text-sky-800 font-semibold flex items-center gap-1">
              <i class="fa-solid fa-list-check"></i> Detalhes
            </button>
            ${!isDesativado ? `
              <button onclick="abrirModalPlacaQRQuarto(${q.id})" class="px-2 py-1 rounded bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 font-bold text-[10px] flex items-center gap-1 transition" title="Imprimir Placa QR Code do Quarto">
                <i class="fa-solid fa-qrcode"></i> QR Code
              </button>
              <button onclick="abrirModalRegistroLimpezaQuarto(${q.id}, 'rotina')" class="p-1.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[10px] transition" title="Registrar Limpeza ou Ar Condicionado">
                <i class="fa-solid fa-broom"></i>
              </button>
            ` : ''}
          </div>
          <div class="flex items-center gap-1">
            ${isDesativado ? `
              <button onclick="reativarQuartoBloco(${q.id})" class="btn-prefeito px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 transition shadow-xs">
                <i class="fa-solid fa-rotate-left"></i> Reativar
              </button>
            ` : `
              <button onclick="desativarQuartoBloco(${q.id})" class="btn-prefeito px-2 py-1 rounded bg-slate-100 hover:bg-amber-100 text-slate-600 hover:text-amber-800 font-semibold text-[11px] transition" title="Desativar este quarto para diminuir capacidade">
                <i class="fa-solid fa-power-off"></i>
              </button>
            `}
            <button onclick="abrirModalEditarQuarto(${q.id}, '${q.numero}', ${q.capacidade}, '${q.observacoes || ''}')" class="btn-prefeito text-slate-400 hover:text-slate-700 p-1" title="Editar Quarto">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button onclick="confirmarExcluirQuarto(${q.id}, '${q.numero}', ${q.vagas_ocupadas})" class="btn-prefeito text-slate-400 hover:text-red-600 p-1" title="Excluir Quarto">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  updateUserRoleUI();
  aplicarCacheEmFotosNaTela();
}

// Abrir Modal de Detalhes do Quarto & Móveis
async function abrirModalQuartoDetalhes(quartoId) {
  quartoSelecionadoId = quartoId;
  try {
    const res = await fetch(`${API_BASE}/api/quartos/${quartoId}`);
    const q = await res.json();

    document.getElementById('modalQuartoTitulo').textContent = `Quarto ${q.numero}`;
    document.getElementById('modalQuartoBadgeBloco').textContent = `${q.bloco_nome} (${q.bloco_tipo.toUpperCase()})`;
    document.getElementById('modalQuartoSubtitulo').textContent = `Capacidade: ${q.capacidade} vagas • Observações: ${q.observacoes || 'Nenhuma'}`;
    document.getElementById('modalQuartoQtdCamas').textContent = q.vagas.length;

    // Renderiza camas no modal
    const camasGrid = document.getElementById('modalQuartoGridCamas');
    camasGrid.innerHTML = q.vagas.map(v => {
      const alId = v.alojado_id || (v.alojado && v.alojado.id);
      const isOcupada = (v.status === 'ocupada') && (alId || v.nome_completo || v.alojado);
      if (isOcupada) {
        const nomeAl = v.nome_completo || (v.alojado && v.alojado.nome_completo) || 'Colaborador';
        let finalId = alId || (v.alojado && v.alojado.id) || 0;
        if ((!finalId || finalId === 0) && window.StaticApiEngine && window.StaticApiEngine.dbState && window.StaticApiEngine.dbState.alojados) {
          const alFound = window.StaticApiEngine.dbState.alojados.find(a => a.nome_completo && a.nome_completo.trim().toUpperCase() === nomeAl.trim().toUpperCase());
          if (alFound) finalId = alFound.id;
        }
        const safeNome = nomeAl.replace(/'/g, "\\'");
        const empNome = v.empresa_nome || (v.alojado && v.alojado.empresa_nome) || 'GEL';
        const safeEmpresa = empNome.replace(/'/g, "\\'");
        const funcaoAl = v.funcao || (v.alojado && v.alojado.funcao) || '';
        const safeFuncao = funcaoAl.replace(/'/g, "\\'");
        const fotoAl = v.foto_url || (v.alojado && v.alojado.foto_url) || '';
        const matAl = v.matricula || (v.alojado && v.alojado.matricula) || '';
        const corEmp = v.empresa_cor || (v.alojado && v.alojado.empresa_cor) || '#2563eb';
        const clickFoto = `abrirModalFotoAlojado(${finalId}, '${safeNome}', '${fotoAl}', '${safeEmpresa}', '${corEmp}', '${safeFuncao}', '${matAl}', '${q.bloco_nome}', '${q.numero}', ${v.numero_cama})`;

        // Buscar telefone atualizado
        const alObj = (window.StaticApiEngine && window.StaticApiEngine.dbState && window.StaticApiEngine.dbState.alojados)
          ? window.StaticApiEngine.dbState.alojados.find(x => Number(x.id) === Number(finalId))
          : null;
        const zapNum = (alObj && alObj.whatsapp) ? alObj.whatsapp : (v.whatsapp || '');
        const waUrl = getWhatsappUrl(zapNum);

        return `
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-bold text-slate-900"><i class="fa-solid fa-bed text-blue-600 mr-1"></i> Cama ${v.numero_cama}</span>
              <span class="text-[9px] font-bold px-1.5 py-0.5 rounded text-white" style="background-color: ${corEmp}">${empNome}</span>
            </div>
            
            <div class="flex items-center gap-3">
              ${renderAvatarHtml(nomeAl, fotoAl, 'w-11 h-11', 'text-xs', clickFoto)}
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span class="font-bold text-slate-900 text-sm truncate cursor-pointer hover:text-sky-600" onclick="${clickFoto}" title="Ver perfil e WhatsApp">${nomeAl}</span>
                  ${waUrl ? `
                    <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 hover:bg-emerald-200 text-emerald-600 text-xs flex-shrink-0 transition" title="Conversar no WhatsApp (${zapNum})">
                      <i class="fa-brands fa-whatsapp"></i>
                    </a>
                  ` : ''}
                </div>
                <div class="text-slate-500">Matrícula: <b>${matAl || '-'}</b> • Função: <b>${funcaoAl || '-'}</b></div>
                <div class="text-slate-400 text-[10px]">Entrada: ${v.data_entrada || (alObj && alObj.data_entrada) || '-'} ${zapNum ? `• <span class="text-emerald-700 font-mono font-medium">${formatarTelefoneTexto(zapNum)}</span>` : ''}</div>
              </div>
            </div>

            <div class="pt-2 border-t border-slate-200 flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-2">
                ${waUrl ? `
                  <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-[11px] font-bold transition">
                    <i class="fa-brands fa-whatsapp text-emerald-600 text-sm"></i> WhatsApp
                  </a>
                ` : ''}
                <button onclick="${clickFoto}" class="text-[11px] font-semibold text-slate-500 hover:text-amber-600 flex items-center gap-1">
                  <i class="fa-solid fa-camera"></i> Foto
                </button>
              </div>
              <div class="flex items-center gap-1.5">
                <button onclick="abrirModalRealocar(${finalId}, '${safeNome}', '${q.bloco_nome}', '${q.numero}', ${v.numero_cama})" class="btn-prefeito px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-[11px] flex items-center gap-1" title="Mover para outro quarto">
                  <i class="fa-solid fa-arrows-turn-to-dots"></i> Mover
                </button>
                <button onclick="abrirModalDesligar(${finalId}, '${safeNome}')" class="btn-prefeito px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-semibold text-[11px] flex items-center gap-1" title="Liberar vaga">
                  <i class="fa-solid fa-person-walking-arrow-right"></i> Liberar
                </button>
              </div>
            </div>
          </div>
        `;
      } else {
        const idVaga = v.id || v.vaga_id || '';
        return `
          <div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs flex items-center justify-between">
            <div>
              <span class="font-bold text-emerald-900"><i class="fa-solid fa-bed text-emerald-600 mr-1"></i> Cama ${v.numero_cama}</span>
              <div class="text-emerald-700 text-[11px]">Vaga Livre</div>
            </div>
            <button onclick="fecharModal('modalQuartoDetalhes'); openModalNovoAlojadoComVaga(${idVaga})" class="btn-prefeito px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold">
              Alojar
            </button>
          </div>
        `;
      }
    }).join('');

    // Renderiza tabela de móveis
    renderTabelaMoveisModal(q.moveis);

    abrirModal('modalQuartoDetalhes');
    aplicarCacheEmFotosNaTela();
  } catch (err) {
    console.error('Erro detalhes quarto:', err);
    showToast('Erro ao carregar detalhes do quarto', 'error');
  }
}

function renderTabelaMoveisModal(moveis) {
  const tbody = document.getElementById('modalQuartoTabelaMoveis');
  if (!tbody) return;

  if (moveis.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-slate-400">Nenhum móvel cadastrado para este quarto.</td></tr>`;
    return;
  }

  tbody.innerHTML = moveis.map(m => {
    let estadoClass = 'bg-emerald-100 text-emerald-800';
    if (m.estado_conservacao === 'Regular') estadoClass = 'bg-amber-100 text-amber-800';
    if (m.estado_conservacao === 'Ruim' || m.estado_conservacao === 'Danificado') estadoClass = 'bg-red-100 text-red-800';

    return `
      <tr class="hover:bg-slate-50">
        <td class="py-2.5 px-3 font-semibold text-slate-800">${m.tipo_item}</td>
        <td class="py-2.5 px-3 text-center">${m.quantidade}</td>
        <td class="py-2.5 px-3">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${estadoClass}">${m.estado_conservacao}</span>
        </td>
        <td class="py-2.5 px-3 text-center">
          ${m.precisa_manutencao ? '<span class="text-red-600 font-bold">⚠️ SIM</span>' : '<span class="text-slate-400">Não</span>'}
        </td>
        <td class="py-2.5 px-3 text-slate-500">${m.data_vistoria || '-'}</td>
        <td class="py-2.5 px-3 text-slate-500 text-[11px] max-w-xs truncate">${m.observacoes || '-'}</td>
        <td class="py-2.5 px-3 text-right whitespace-nowrap">
          ${m.precisa_manutencao || m.estado_conservacao === 'Ruim' || m.estado_conservacao === 'Danificado' ? `
            <button onclick="resolverManutencaoMovel(${m.id})" class="btn-prefeito text-emerald-600 hover:text-emerald-800 mr-2" title="Marcar Manutenção como Resolvida">
              <i class="fa-solid fa-circle-check"></i> Reparado
            </button>
          ` : ''}
          <button onclick="abrirModalEditarMovel(${m.id}, '${m.tipo_item}', ${m.quantidade}, '${m.estado_conservacao}', ${m.precisa_manutencao}, '${m.data_vistoria || ''}', '${m.observacoes || ''}')" class="btn-prefeito text-slate-500 hover:text-sky-600 mr-2">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button onclick="confirmarExcluirMovel(${m.id})" class="btn-prefeito text-slate-400 hover:text-red-600">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  updateUserRoleUI();
}

function abrirNovoMovelNoQuartoAtual() {
  fecharModal('modalQuartoDetalhes');
  openModalNovoMovel(quartoSelecionadoId);
}

// ========================================================
// 3. GESTÃO DE ALOJADOS (CRUD COMPLETO)
// ========================================================

let paginaAlojadosAtual = 1;

function debounceCarregarAlojados() {
  clearTimeout(debounceTimerAlojados);
  debounceTimerAlojados = setTimeout(() => {
    paginaAlojadosAtual = 1;
    carregarAlojados();
  }, 300);
}

async function carregarAlojados() {
  // Purga proativa de registros fantasmas antes de ler
  if (window.StaticApiEngine && window.StaticApiEngine.dbState && window.StaticApiEngine.dbState.alojados) {
    const antes = window.StaticApiEngine.dbState.alojados.length;
    window.StaticApiEngine.dbState.alojados = window.StaticApiEngine.dbState.alojados.filter(a => {
      if (!a || !a.nome_completo) return false;
      const n = a.nome_completo.trim();
      return n !== '' && n !== '??' && n !== '?' && n !== 'SEM NOME' && n !== 'N/A';
    });
    if (window.StaticApiEngine.dbState.alojados.length !== antes) {
      window.StaticApiEngine.saveToStorage();
    }
  }

  const busca = document.getElementById('filtroAlojadosBusca').value.trim();
  const blocoId = document.getElementById('filtroAlojadosBloco').value;
  const empresaId = document.getElementById('filtroAlojadosEmpresa').value;
  const status = document.getElementById('filtroAlojadosStatus').value;

  let url = `${API_BASE}/api/alojados?page=${paginaAlojadosAtual}&limit=50&`;
  if (status) url += `status_alojado=${status}&`;
  if (blocoId) url += `bloco_id=${blocoId}&`;
  if (empresaId) url += `empresa_id=${empresaId}&`;
  if (busca) url += `q=${encodeURIComponent(busca)}&`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    renderTabelaAlojados(data);
  } catch (err) {
    console.error('Erro ao carregar alojados:', err);
  }
}

function renderTabelaAlojados(data) {
  const tbody = document.getElementById('tabelaAlojadosCorpo');
  const mobileList = document.getElementById('listaAlojadosMobile');
  const contador = document.getElementById('alojadosContadorTexto');
  const paginacao = document.getElementById('alojadosPaginacao');
  if (!tbody && !mobileList) return;

  const items = (data.items || []).filter(a => a && a.nome_completo && a.nome_completo.trim() !== '' && a.nome_completo.trim() !== '??');
  const total = items.length;

  if (contador) contador.textContent = `Mostrando ${items.length} de ${total} registros (Página ${data.page})`;

  if (items.length === 0) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400">Nenhum trabalhador alojado encontrado com os filtros aplicados.</td></tr>`;
    if (mobileList) mobileList.innerHTML = `<div class="p-8 text-center text-slate-400 text-xs">Nenhum trabalhador alojado encontrado com os filtros aplicados.</div>`;
    if (paginacao) paginacao.innerHTML = '';
    return;
  }

  // Render para Tabela (Computador / Tablet)
  if (tbody) {
    tbody.innerHTML = items.map(a => {
      const isAtivo = a.status === 'ativo';
      const statusBadge = isAtivo 
        ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">ATIVO</span>'
        : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">DESLIGADO</span>';

      const localizacao = isAtivo 
        ? `<b>${a.bloco_nome}</b> • Quarto ${a.quarto_numero} (Cama ${a.numero_cama})`
        : `<span class="text-slate-400 italic">Desocupado (Saída: ${a.data_saida || '-'})</span>`;

      const safeNome = (a.nome_completo || '').replace(/'/g, "\\'");
      const safeEmpresa = (a.empresa_nome || '').replace(/'/g, "\\'");
      const safeFuncao = (a.funcao || '').replace(/'/g, "\\'");
      const waUrl = getWhatsappUrl(a.whatsapp);
      const clickFoto = `abrirModalFotoAlojado(${a.id}, '${safeNome}', '${a.foto_url || ''}', '${safeEmpresa}', '${a.empresa_cor || ''}', '${safeFuncao}', '${a.matricula || ''}', '${a.bloco_nome || ''}', '${a.quarto_numero || ''}', ${a.numero_cama || 0})`;

      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="py-3 px-4 font-mono font-semibold text-slate-700">${a.matricula || '-'}</td>
          <td class="py-3 px-4">
            <div class="flex items-center gap-3">
              ${renderAvatarHtml(a.nome_completo, a.foto_url, 'w-10 h-10', 'text-xs', clickFoto)}
              <div>
                <div class="flex items-center gap-1.5">
                  <span class="font-bold text-slate-900 cursor-pointer hover:text-sky-600" onclick="${clickFoto}" title="Ver detalhes e foto">${a.nome_completo}</span>
                  ${waUrl ? `
                    <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 hover:bg-emerald-200 text-emerald-600 text-xs transition" title="Conversar no WhatsApp (${a.whatsapp})">
                      <i class="fa-brands fa-whatsapp"></i>
                    </a>
                  ` : ''}
                </div>
                <div class="text-[11px] text-slate-400">Entrada: ${a.data_entrada || '-'} ${a.whatsapp ? `• <span class="text-emerald-700 font-mono font-medium">${formatarTelefoneTexto(a.whatsapp)}</span>` : ''}</div>
              </div>
            </div>
          </td>
          <td class="py-3 px-4 text-slate-600 font-medium">${a.funcao || '-'}</td>
          <td class="py-3 px-4">
            <span class="px-2 py-0.5 rounded text-xs font-bold text-white shadow-xs" style="background-color: ${a.empresa_cor || '#475569'}">
              ${a.empresa_nome || '-'}
            </span>
          </td>
          <td class="py-3 px-4 text-xs text-slate-800">${localizacao}</td>
          <td class="py-3 px-4">${statusBadge}</td>
          <td class="py-3 px-4 text-right whitespace-nowrap">
            ${isAtivo ? `
              <button onclick="gerarTermoResponsabilidadeAlojado(${a.id})" class="btn-prefeito px-2 py-1 rounded bg-amber-50 text-amber-800 hover:bg-amber-100 font-semibold text-xs mr-1" title="Imprimir Termo de Responsabilidade A4">
                <i class="fa-solid fa-file-contract"></i> Termo
              </button>
              <button onclick="abrirModalRealocar(${a.id}, '${a.nome_completo}', '${a.bloco_nome}', '${a.quarto_numero}', ${a.numero_cama})" class="btn-prefeito px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold text-xs mr-1" title="Realocar para outra vaga">
                <i class="fa-solid fa-arrows-turn-to-dots"></i> Mover
              </button>
              <button onclick="abrirModalDesligar(${a.id}, '${a.nome_completo}')" class="btn-prefeito px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 font-semibold text-xs mr-1" title="Registrar Saída / Desligamento">
                <i class="fa-solid fa-person-walking-arrow-right"></i> Saída
              </button>
            ` : `
              <button onclick="abrirModalReativar(${a.id}, '${a.nome_completo}')" class="btn-prefeito px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-semibold text-xs mr-1" title="Reativar colaborador">
                <i class="fa-solid fa-rotate-left"></i> Reativar
              </button>
            `}
            <button onclick="abrirModalEditarAlojado(${a.id})" class="btn-prefeito text-slate-500 hover:text-sky-600 p-1 mr-1" title="Editar Dados">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button onclick="confirmarExcluirAlojado(${a.id}, '${a.nome_completo}')" class="btn-prefeito text-slate-400 hover:text-red-600 p-1" title="Excluir Registro">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Render para Cards no Celular (Mobile Touch View)
  if (mobileList) {
    mobileList.innerHTML = items.map(a => {
      const isAtivo = a.status === 'ativo';
      const statusBadge = isAtivo 
        ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">ATIVO</span>'
        : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">DESLIGADO</span>';

      const safeNome = (a.nome_completo || '').replace(/'/g, "\\'");
      const safeEmpresa = (a.empresa_nome || '').replace(/'/g, "\\'");
      const safeFuncao = (a.funcao || '').replace(/'/g, "\\'");
      const waUrl = getWhatsappUrl(a.whatsapp);
      const clickFoto = `abrirModalFotoAlojado(${a.id}, '${safeNome}', '${a.foto_url || ''}', '${safeEmpresa}', '${a.empresa_cor || ''}', '${safeFuncao}', '${a.matricula || ''}', '${a.bloco_nome || ''}', '${a.quarto_numero || ''}', ${a.numero_cama || 0})`;

      return `
        <div class="p-3.5 bg-white hover:bg-slate-50 transition flex items-center justify-between gap-3 border-b border-slate-100">
          <div class="flex items-center gap-3 min-w-0 flex-1">
            ${renderAvatarHtml(a.nome_completo, a.foto_url, 'w-11 h-11 flex-shrink-0', 'text-xs', clickFoto)}
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="font-bold text-slate-900 text-sm leading-tight truncate cursor-pointer hover:text-sky-600" onclick="${clickFoto}">${a.nome_completo}</span>
                ${waUrl ? `
                  <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 hover:bg-emerald-200 text-emerald-600 text-xs flex-shrink-0 transition" title="Conversar no WhatsApp (${a.whatsapp})">
                    <i class="fa-brands fa-whatsapp"></i>
                  </a>
                ` : ''}
              </div>
              <div class="text-xs text-slate-500 font-medium truncate mt-0.5">
                ${a.funcao || 'Sem função'} • <span class="font-bold" style="color: ${a.empresa_cor || '#475569'}">${a.empresa_nome || '-'}</span>
              </div>
              <div class="text-[11px] text-slate-600 mt-1 flex items-center gap-1.5 flex-wrap">
                ${isAtivo ? `<span class="bg-slate-100 px-1.5 py-0.5 rounded font-semibold text-slate-700 text-[10px]">🏢 ${a.bloco_nome} • Q.${a.quarto_numero} (Cama ${a.numero_cama})</span>` : '<span class="text-slate-400 italic text-[10px]">Desocupado</span>'}
                <span class="text-[10px] text-slate-400 font-mono">Reg: ${a.matricula || '-'}</span>
                ${a.whatsapp ? `<span class="text-[10px] text-emerald-700 font-mono font-semibold">📞 ${formatarTelefoneTexto(a.whatsapp)}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="flex flex-col items-end gap-1.5 flex-shrink-0">
            ${statusBadge}
            <div class="flex items-center gap-1 mt-0.5">
              ${waUrl ? `
                <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="p-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-600 text-xs shadow-xs flex items-center justify-center transition" title="Conversar no WhatsApp (${a.whatsapp})">
                  <i class="fa-brands fa-whatsapp text-sm"></i>
                </a>
              ` : ''}
              <button onclick="${clickFoto}" class="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs shadow-xs" title="Ver foto">
                <i class="fa-solid fa-camera"></i>
              </button>
              ${isAtivo ? `
                <button onclick="gerarTermoResponsabilidadeAlojado(${a.id})" class="btn-prefeito p-2 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs shadow-xs" title="Imprimir Termo de Responsabilidade A4">
                  <i class="fa-solid fa-file-contract"></i>
                </button>
              ` : ''}
              <button onclick="abrirModalEditarAlojado(${a.id})" class="btn-prefeito p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs shadow-xs" title="Editar">
                <i class="fa-solid fa-pen"></i>
              </button>
              ${isAtivo ? `
                <button onclick="abrirModalRealocar(${a.id}, '${safeNome}', '${a.bloco_nome}', '${a.quarto_numero}', ${a.numero_cama})" class="btn-prefeito p-2 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs shadow-xs" title="Mover vaga">
                  <i class="fa-solid fa-arrows-turn-to-dots"></i>
                </button>
                <button onclick="abrirModalDesligar(${a.id}, '${safeNome}')" class="btn-prefeito p-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs shadow-xs" title="Saída">
                  <i class="fa-solid fa-person-walking-arrow-right"></i>
                </button>
              ` : `
                <button onclick="abrirModalReativar(${a.id}, '${safeNome}')" class="btn-prefeito p-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs shadow-xs" title="Reativar">
                  <i class="fa-solid fa-rotate-left"></i>
                </button>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Botoes de paginação
  const totalPages = Math.ceil(total / 50);
  let pagHtml = '';
  if (totalPages > 1) {
    pagHtml += `
      <button onclick="mudarPaginaAlojados(${paginaAlojadosAtual - 1})" ${paginaAlojadosAtual === 1 ? 'disabled class="opacity-40 cursor-not-allowed"' : 'class="hover:bg-slate-200"'} class="px-2 py-1 rounded border border-slate-300">
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <span class="px-2 font-medium">${paginaAlojadosAtual} / ${totalPages}</span>
      <button onclick="mudarPaginaAlojados(${paginaAlojadosAtual + 1})" ${paginaAlojadosAtual >= totalPages ? 'disabled class="opacity-40 cursor-not-allowed"' : 'class="hover:bg-slate-200"'} class="px-2 py-1 rounded border border-slate-300">
        <i class="fa-solid fa-chevron-right"></i>
      </button>
    `;
  }
  paginacao.innerHTML = pagHtml;

  updateUserRoleUI();
  aplicarCacheEmFotosNaTela();
}

function mudarPaginaAlojados(novaPag) {
  paginaAlojadosAtual = novaPag;
  carregarAlojados();
}

async function openModalNovoAlojado(vagaPreId = null) {
  if (!checkPrefeitoAccess()) return;
  document.getElementById('modalAlojadoTitulo').textContent = 'Cadastrar Novo Alojado';
  document.getElementById('formAlojado').reset();
  document.getElementById('alojadoFormId').value = '';
  document.getElementById('secaoSelecaoVaga').classList.remove('hidden');
  const secaoLocalNovo = document.getElementById('secaoLocalAtualEdicao');
  if (secaoLocalNovo) secaoLocalNovo.classList.add('hidden');
  limparFotoForm();

  // Limpa campo de WhatsApp
  const zapInput = document.getElementById('alojadoFormWhatsapp');
  if (zapInput) zapInput.value = '';

  // Carrega opções de empresas
  preencherSelectEmpresas('alojadoFormEmpresa');

  // Carrega opções de vagas livres
  await preencherSelectVagasLivres('alojadoFormVagaId', vagaPreId);

  // Data de entrada default hoje
  document.getElementById('alojadoFormDataEntrada').value = new Date().toISOString().split('T')[0];

  abrirModal('modalAlojadoForm');
}

function openModalNovoAlojadoComVaga(vagaId) {
  openModalNovoAlojado(vagaId);
}

function atalhoMudarQuartoDoForm() {
  const id = document.getElementById('alojadoFormId').value;
  if (!id) return;
  const al = (window.StaticApiEngine && window.StaticApiEngine.dbState && window.StaticApiEngine.dbState.alojados)
    ? window.StaticApiEngine.dbState.alojados.find(x => x.id == id) : null;
  fecharModal('modalAlojadoForm');
  if (al) {
    abrirModalRealocar(al.id, al.nome_completo, al.bloco_nome || '', al.quarto_numero || '', al.numero_cama || 1);
  }
}

function abrirModalEditarAlojado(id, matricula = '', nome = '', empresaId = null, funcao = '', dataEntrada = '', obs = '', fotoUrl = '', whatsapp = '') {
  if (!checkPrefeitoAccess()) return;

  let al = null;
  if (window.StaticApiEngine && window.StaticApiEngine.dbState && window.StaticApiEngine.dbState.alojados) {
    al = window.StaticApiEngine.dbState.alojados.find(x => x.id == id);
  }

  document.getElementById('modalAlojadoTitulo').textContent = 'Editar Dados do Alojado';
  document.getElementById('alojadoFormId').value = id;
  document.getElementById('secaoSelecaoVaga').classList.add('hidden'); // Vaga é alterada por realocação

  const secaoLocal = document.getElementById('secaoLocalAtualEdicao');
  const txtLocal = document.getElementById('alojadoFormLocalAtualTexto');
  if (secaoLocal && txtLocal) {
    secaoLocal.classList.remove('hidden');
    if (al && al.bloco_nome && al.quarto_numero) {
      txtLocal.textContent = `${al.bloco_nome} • Quarto ${al.quarto_numero} (Cama ${al.numero_cama || 1})`;
    } else {
      txtLocal.textContent = 'Não alocado em quarto no momento';
    }
  }

  const empIdFinal = (al && al.empresa_id) ? al.empresa_id : empresaId;
  preencherSelectEmpresas('alojadoFormEmpresa', empIdFinal);

  document.getElementById('alojadoFormNome').value = (al && al.nome_completo) ? al.nome_completo : (nome || '');
  document.getElementById('alojadoFormMatricula').value = (al && al.matricula) ? al.matricula : (matricula || '');
  document.getElementById('alojadoFormFuncao').value = (al && al.funcao) ? al.funcao : (funcao || '');
  document.getElementById('alojadoFormDataEntrada').value = (al && al.data_entrada) ? al.data_entrada : (dataEntrada || '');
  document.getElementById('alojadoFormObs').value = (al && al.observacoes) ? al.observacoes : (obs || '');

  const zapInput = document.getElementById('alojadoFormWhatsapp');
  if (zapInput) {
    const rawZap = (al && al.whatsapp) ? al.whatsapp : (whatsapp || '');
    zapInput.value = formatarTelefoneTexto(rawZap);
  }

  // Foto atual
  const imgPreview = document.getElementById('alojadoFormFotoPreview');
  const placeholder = document.getElementById('alojadoFormFotoPlaceholder');
  const btnRemover = document.getElementById('btnRemoverFotoForm');
  const urlInput = document.getElementById('alojadoFormFotoUrl');
  document.getElementById('alojadoFormFotoInput').value = '';

  const fotoAtualFinal = (al && al.foto_url) ? al.foto_url : fotoUrl;
  if (fotoAtualFinal && fotoAtualFinal.trim() !== '') {
    imgPreview.src = fotoAtualFinal;
    imgPreview.classList.remove('hidden');
    placeholder.classList.add('hidden');
    btnRemover.classList.remove('hidden');
    urlInput.value = fotoAtualFinal;
  } else {
    limparFotoForm();
  }

  abrirModal('modalAlojadoForm');
}

function previewFotoAlojado(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = function(e) {
      const imgPreview = document.getElementById('alojadoFormFotoPreview');
      const placeholder = document.getElementById('alojadoFormFotoPlaceholder');
      const btnRemover = document.getElementById('btnRemoverFotoForm');
      imgPreview.src = e.target.result;
      imgPreview.classList.remove('hidden');
      placeholder.classList.add('hidden');
      btnRemover.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  }
}

function limparFotoForm() {
  const input = document.getElementById('alojadoFormFotoInput');
  if (input) input.value = '';
  const imgPreview = document.getElementById('alojadoFormFotoPreview');
  if (imgPreview) {
    imgPreview.src = '';
    imgPreview.classList.add('hidden');
  }
  const placeholder = document.getElementById('alojadoFormFotoPlaceholder');
  if (placeholder) placeholder.classList.remove('hidden');
  const btnRemover = document.getElementById('btnRemoverFotoForm');
  if (btnRemover) btnRemover.classList.add('hidden');
  const urlInput = document.getElementById('alojadoFormFotoUrl');
  if (urlInput) urlInput.value = '';
}

async function salvarAlojado(e) {
  e.preventDefault();
  if (!checkPrefeitoAccess()) return;

  const id = document.getElementById('alojadoFormId').value;
  const nome = document.getElementById('alojadoFormNome').value.trim();
  const matricula = document.getElementById('alojadoFormMatricula').value.trim();
  const empresaId = document.getElementById('alojadoFormEmpresa').value;
  const funcao = document.getElementById('alojadoFormFuncao').value.trim();
  const dataEntrada = document.getElementById('alojadoFormDataEntrada').value;
  const obs = document.getElementById('alojadoFormObs').value.trim();
  const zapInput = document.getElementById('alojadoFormWhatsapp');
  const whatsapp = zapInput ? zapInput.value.trim() : '';
  const fotoUrlAtual = document.getElementById('alojadoFormFotoUrl').value;
  const fotoInput = document.getElementById('alojadoFormFotoInput');

  let targetAlojadoId = id;

  if (!id) {
    // Criação
    const vagaId = document.getElementById('alojadoFormVagaId').value;
    if (!vagaId) {
      showToast('Por favor, selecione uma vaga livre disponível', 'warning');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/alojados`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vaga_id: parseInt(vagaId),
          nome_completo: nome,
          matricula: matricula,
          empresa_id: empresaId ? parseInt(empresaId) : null,
          funcao: funcao,
          whatsapp: whatsapp,
          data_entrada: dataEntrada,
          observacoes: obs,
          foto_url: fotoUrlAtual,
          usuario: currentUserName
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Erro ao cadastrar alojado');
      targetAlojadoId = data.id;

      // Se selecionou arquivo de foto, enviar upload para ImgBB
      if (fotoInput && fotoInput.files && fotoInput.files[0]) {
        try {
          const file = fotoInput.files[0];
          const formData = new FormData();
          formData.append('image', file);
          const resImgbb = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
            method: 'POST',
            body: formData
          });
          const imgbbData = await resImgbb.json();
          if (imgbbData && imgbbData.success && imgbbData.data && imgbbData.data.display_url) {
            const novaUrl = imgbbData.data.display_url;
            const al = (StaticApiEngine.dbState.alojados || []).find(x => x.id == targetAlojadoId);
            if (al) {
              al.foto_url = novaUrl;
              StaticApiEngine.saveToStorage();
            }
            if (firebaseInitialized && firestoreDb) {
              firestoreDb.collection('alojados').doc(String(targetAlojadoId)).set({
                foto_url: novaUrl,
                atualizado_em: new Date().toISOString()
              }, { merge: true }).catch(() => {});
            }
          }
        } catch (e) {
          console.warn("Erro upload foto no cadastro:", e);
        }
      }

      showToast('Alojado cadastrado com sucesso!', 'success');
      registrarAuditoria(
        'alojamento',
        'ALOCAR',
        nome,
        `Cadastrou e alocou colaborador "${nome}" no alojamento`,
        currentUserName
      );
      fecharModal('modalAlojadoForm');
      fecharModal('modalQuartoDetalhes');
      await refreshAllData();
      carregarQuartos();
      carregarAlojados();
    } catch (err) {
      showToast(err.message, 'error');
    }
  } else {
    // Edição
    try {
      const res = await fetch(`${API_BASE}/api/alojados/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome_completo: nome,
          matricula: matricula,
          empresa_id: empresaId ? parseInt(empresaId) : null,
          funcao: funcao,
          whatsapp: whatsapp,
          data_entrada: dataEntrada,
          observacoes: obs,
          foto_url: fotoUrlAtual,
          usuario: currentUserName
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Erro ao atualizar dados');

      // Se selecionou arquivo de foto nova, enviar upload para ImgBB
      if (fotoInput && fotoInput.files && fotoInput.files[0]) {
        try {
          const file = fotoInput.files[0];
          const formData = new FormData();
          formData.append('image', file);
          const resImgbb = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
            method: 'POST',
            body: formData
          });
          const imgbbData = await resImgbb.json();
          if (imgbbData && imgbbData.success && imgbbData.data && imgbbData.data.display_url) {
            const novaUrl = imgbbData.data.display_url;
            const al = (StaticApiEngine.dbState.alojados || []).find(x => x.id == id);
            if (al) {
              al.foto_url = novaUrl;
              StaticApiEngine.saveToStorage();
            }
            if (firebaseInitialized && firestoreDb) {
              firestoreDb.collection('alojados').doc(String(id)).set({
                foto_url: novaUrl,
                atualizado_em: new Date().toISOString()
              }, { merge: true }).catch(() => {});
            }
          }
        } catch (e) {
          console.warn("Erro upload foto na edição:", e);
        }
      }

      showToast('Dados e foto do alojado atualizados!', 'success');
      registrarAuditoria(
        'alojamento',
        'EDITAR',
        nome,
        `Atualizou cadastro/dados do colaborador "${nome}"`,
        currentUserName
      );
      fecharModal('modalAlojadoForm');
      carregarAlojados();
      if (activeTab === 'blocos') carregarQuartos();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
}

// Modal Foto Dedicado
function abrirModalFotoAlojado(alojadoId, nome, fotoUrl, empresaNome, empresaCor, cargo, matricula, blocoNome, quartoNum, camaNum) {
  document.getElementById('modalFotoAlojadoId').value = alojadoId;
  document.getElementById('modalFotoNome').textContent = nome;
  document.getElementById('modalFotoSub').textContent = `Matrícula: ${matricula || '-'} • Quarto ${quartoNum} (Cama ${camaNum})`;
  
  const empBadge = document.getElementById('modalFotoInfoEmpresa');
  empBadge.textContent = empresaNome || 'CONTRATADA';
  empBadge.style.backgroundColor = empresaCor || '#3b82f6';
  
  document.getElementById('modalFotoInfoCargo').textContent = `${cargo || 'Alojado'}`;
  document.getElementById('modalFotoInfoLocal').textContent = `${blocoNome || 'Alojamento'} • Quarto ${quartoNum} • Cama ${camaNum}`;
  
  const imgEl = document.getElementById('modalFotoImg');
  const vazioEl = document.getElementById('modalFotoVazio');
  const btnRemover = document.getElementById('modalFotoBtnRemover');
  
  // Buscar os dados atualizados do colaborador no banco em memória
  let al = null;
  if (window.StaticApiEngine && window.StaticApiEngine.dbState && window.StaticApiEngine.dbState.alojados) {
    al = window.StaticApiEngine.dbState.alojados.find(x => x.id == alojadoId);
  }

  let fotoAtual = (al && al.foto_url) ? al.foto_url : fotoUrl;

  if (fotoAtual && fotoAtual.trim() !== '') {
    photoCacheManager.getPhoto(fotoAtual).then(cached => {
      if (cached && imgEl) imgEl.src = cached;
    });
    imgEl.src = fotoAtual;
    imgEl.classList.remove('hidden');
    vazioEl.classList.add('hidden');
    btnRemover.classList.remove('hidden');
  } else {
    imgEl.src = '';
    imgEl.classList.add('hidden');
    vazioEl.classList.remove('hidden');
    btnRemover.classList.add('hidden');
  }

  // Configuração do botão direto para WhatsApp
  const btnZap = document.getElementById('modalFotoBtnWhatsapp');
  const txtZap = document.getElementById('modalFotoWhatsappTexto');
  const zapNum = (al && al.whatsapp) ? al.whatsapp : '';
  const waUrl = getWhatsappUrl(zapNum);

  if (btnZap) {
    if (waUrl) {
      btnZap.href = waUrl;
      const zapFormatado = formatarTelefoneTexto(zapNum);
      if (txtZap) txtZap.textContent = `Conversar no WhatsApp (${zapFormatado})`;
      btnZap.classList.remove('hidden');
    } else {
      btnZap.href = '#';
      btnZap.classList.add('hidden');
    }
  }
  
  abrirModal('modalFotoAlojado');
  updateUserRoleUI();
}

function editarAlojadoDoModalFoto() {
  if (currentCropMoradorCasa) {
    const { casaId, comodoId, camaNum } = currentCropMoradorCasa;
    fecharModal('modalFotoAlojado');
    openModalEditarMoradorCasa(casaId, comodoId, camaNum);
    return;
  }
  const alojadoId = document.getElementById('modalFotoAlojadoId').value;
  if (!alojadoId) return;
  fecharModal('modalFotoAlojado');
  abrirModalEditarAlojado(Number(alojadoId));
}

function uploadFotoModalAlojado(input) {
  if (!checkPrefeitoAccess()) return;
  if (!input.files || !input.files[0]) return;
  if (currentCropMoradorCasa) {
    iniciarCropFoto(input.files[0], 'morador_casa');
    return;
  }
  const alojadoId = document.getElementById('modalFotoAlojadoId').value;
  iniciarCropFoto(input.files[0], alojadoId);
}

async function removerFotoModalAlojado() {
  if (!checkPrefeitoAccess()) return;
  if (!confirm('Deseja realmente remover a foto deste colaborador?')) return;

  // Se for morador de casa
  if (currentCropMoradorCasa) {
    const { casaId, comodoId, camaNum } = currentCropMoradorCasa;
    const casa = (listaCasasCidade || []).find(c => c.id === casaId);
    if (casa) {
      const com = (casa.comodos || []).find(x => x.id === comodoId);
      const cm = com ? (com.camas || []).find(x => Number(x.numero) === Number(camaNum)) : null;
      if (cm && cm.morador) {
        cm.morador.foto_url = null;
      }
      try {
        localStorage.setItem('casas_cidade_cache', JSON.stringify(listaCasasCidade));
      } catch (e) {}
      if (firestoreDb) {
        try {
          firestoreDb.collection('casas_cidade').doc(casaId).update({
            comodos: casa.comodos,
            atualizado_em: new Date().toISOString()
          });
        } catch (e) {}
      }
      atualizarDadosModalCasaDetalhes(casa);
      if (activeTab === 'casas_cidade' && typeof filtrarCasasCidadeUI === 'function') {
        filtrarCasasCidadeUI();
      }
    }
    showToast('Foto do morador removida!', 'success');
    const imgEl = document.getElementById('modalFotoImg');
    if (imgEl) {
      imgEl.src = '';
      imgEl.classList.add('hidden');
    }
    const vazioEl = document.getElementById('modalFotoVazio');
    if (vazioEl) vazioEl.classList.remove('hidden');
    const btnRem = document.getElementById('modalFotoBtnRemover');
    if (btnRem) btnRem.classList.add('hidden');
    return;
  }

  const alojadoId = document.getElementById('modalFotoAlojadoId').value;
  try {
    await StaticApiEngine.init();
    const alojado = (StaticApiEngine.dbState.alojados || []).find(x => x.id == alojadoId);
    if (alojado) {
      alojado.foto_url = null;
      (StaticApiEngine.dbState.quartos || []).forEach(q => {
        (q.vagas || []).forEach(v => {
          if (v.alojado && v.alojado.id == alojadoId) {
            v.alojado.foto_url = null;
          }
        });
      });
      StaticApiEngine.saveToStorage();
    }

    if (firebaseInitialized && firestoreDb) {
      firestoreDb.collection('alojados').doc(String(alojadoId)).set({
        foto_url: null,
        atualizado_em: new Date().toISOString()
      }, { merge: true }).catch(() => {});
    }

    showToast('Foto removida!', 'success');
    const imgEl = document.getElementById('modalFotoImg');
    if (imgEl) {
      imgEl.src = '';
      imgEl.classList.add('hidden');
    }
    const vazioEl = document.getElementById('modalFotoVazio');
    if (vazioEl) vazioEl.classList.remove('hidden');
    const btnRem = document.getElementById('modalFotoBtnRemover');
    if (btnRem) btnRem.classList.add('hidden');

    if (activeTab === 'alojados') carregarAlojados();
    if (activeTab === 'blocos') carregarQuartos();
    if (activeTab === 'dashboard') carregarDashboard();
    aplicarCacheEmFotosNaTela();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Modal Realocação
async function abrirModalRealocar(alojadoId, nome, blocoNome, quartoNum, camaNum) {
  if (!checkPrefeitoAccess()) return;
  document.getElementById('realocarAlojadoId').value = alojadoId;
  document.getElementById('realocarNome').textContent = nome;
  document.getElementById('realocarLocalAtual').textContent = `${blocoNome} - Quarto ${quartoNum} (Cama ${camaNum})`;
  document.getElementById('realocarMotivo').value = 'Realocação solicitada pela administração do canteiro';

  await preencherSelectVagasLivres('realocarNovaVaga');
  abrirModal('modalRealocar');
}

async function confirmarRealocacao(e) {
  e.preventDefault();
  if (!checkPrefeitoAccess()) return;

  const alojadoId = document.getElementById('realocarAlojadoId').value;
  const novaVagaId = document.getElementById('realocarNovaVaga').value;
  const motivo = document.getElementById('realocarMotivo').value.trim();

  if (!novaVagaId) {
    showToast('Selecione uma vaga livre de destino', 'warning');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalBtnText = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Mudando de quarto...';
  }

  try {
    const res = await fetch(`${API_BASE}/api/alojados/${alojadoId}/realocar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alojado_id: parseInt(alojadoId),
        nova_vaga_id: parseInt(novaVagaId),
        motivo: motivo,
        usuario: currentUserName
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.message || 'Erro na realocação');

    showToast('Colaborador mudado de quarto com sucesso!', 'success');
    registrarAuditoria(
      'alojamento',
      'TRANSFERIR',
      document.getElementById('realocarNome')?.textContent || 'Colaborador',
      `Mudou de quarto colaborador "${document.getElementById('realocarNome')?.textContent || 'Colaborador'}" (${motivo || 'Realocação administrativa'})`,
      currentUserName
    );
    fecharModal('modalRealocar');
    fecharModal('modalQuartoDetalhes');
    await refreshAllData();
    carregarQuartos();
    carregarAlojados();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }
  }
}

// Modal Desligamento / Saída
function abrirModalDesligar(alojadoId, nome) {
  if (!checkPrefeitoAccess()) return;
  document.getElementById('desligarAlojadoId').value = alojadoId;
  document.getElementById('desligarNome').textContent = nome;
  document.getElementById('desligarData').value = new Date().toISOString().split('T')[0];
  document.getElementById('desligarMotivo').value = 'Conclusão de atividades no canteiro';
  abrirModal('modalDesligar');
}

async function confirmarDesligamento(e) {
  e.preventDefault();
  if (!checkPrefeitoAccess()) return;

  const alojadoId = document.getElementById('desligarAlojadoId').value;
  const dataSaida = document.getElementById('desligarData').value;
  const motivo = document.getElementById('desligarMotivo').value.trim();

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalBtnText = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Registrando saída...';
  }

  try {
    const res = await fetch(`${API_BASE}/api/alojados/${alojadoId}/desligar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alojado_id: parseInt(alojadoId),
        data_saida: dataSaida,
        motivo: motivo,
        usuario: currentUserName
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.message || 'Erro no desligamento');

    showToast('Saída registrada e vaga liberada com sucesso!', 'success');
    registrarAuditoria(
      'alojamento',
      'DESALOJAR',
      document.getElementById('desligarNome')?.textContent || 'Colaborador',
      `Registrou saída/desligamento de colaborador "${document.getElementById('desligarNome')?.textContent || 'Colaborador'}" (${motivo || 'Conclusão de atividades'})`,
      currentUserName
    );
    fecharModal('modalDesligar');
    fecharModal('modalQuartoDetalhes');
    await refreshAllData();
    carregarQuartos();
    carregarAlojados();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }
  }
}

// Reativar Alojado
async function abrirModalReativar(alojadoId, nome) {
  if (!checkPrefeitoAccess()) return;
  const vagaId = prompt(`Selecione uma vaga livre para reativar ${nome}.\nDigite o ID da vaga (consulte a aba Quartos ou crie um novo cadastro):`);
  if (!vagaId) return;

  try {
    const res = await fetch(`${API_BASE}/api/alojados/${alojadoId}/reativar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alojado_id: parseInt(alojadoId),
        nova_vaga_id: parseInt(vagaId),
        data_entrada: new Date().toISOString().split('T')[0],
        usuario: currentUserName
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.message || 'Erro ao reativar');

    showToast('Alojado reativado com sucesso!', 'success');
    await refreshAllData();
    carregarQuartos();
    carregarAlojados();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function confirmarExcluirAlojado(id, nome) {
  if (!checkPrefeitoAccess()) return;
  if (!confirm(`Deseja realmente excluir permanentemente o cadastro de ${nome}?`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/alojados/${id}?usuario=${encodeURIComponent(currentUserName)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro ao excluir');

    showToast('Cadastro removido com sucesso!', 'success');
    refreshAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ========================================================
// 4. MÓVEIS, ITENS & VISTORIAS
// ========================================================

async function carregarMoveis() {
  const busca = document.getElementById('filtroMovelBusca').value.trim();
  const blocoId = document.getElementById('filtroMovelBloco').value;
  const estado = document.getElementById('filtroMovelEstado').value;
  const precisaManut = document.getElementById('filtroMovelManut').value;

  let url = `${API_BASE}/api/moveis?`;
  if (blocoId) url += `bloco_id=${blocoId}&`;
  if (estado) url += `estado=${estado}&`;
  if (precisaManut !== '') url += `precisa_manutencao=${precisaManut}&`;
  if (busca) url += `q=${encodeURIComponent(busca)}&`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    renderTabelaMoveisGeral(data);
  } catch (err) {
    console.error('Erro moveis:', err);
  }
}

function renderTabelaMoveisGeral(itens) {
  const tbody = document.getElementById('tabelaMoveisCorpo');
  if (!tbody) return;

  // Atualiza métricas rápidas de conservação
  let tot = itens.length;
  let bom = itens.filter(i => i.estado_conservacao === 'Bom').length;
  let reg = itens.filter(i => i.estado_conservacao === 'Regular').length;
  let ruim = itens.filter(i => i.estado_conservacao === 'Ruim' || i.estado_conservacao === 'Danificado' || i.precisa_manutencao === 1).length;

  document.getElementById('kpiMoveisTotal').textContent = tot;
  document.getElementById('kpiMoveisBom').textContent = bom;
  document.getElementById('kpiMoveisRegular').textContent = reg;
  document.getElementById('kpiMoveisRuim').textContent = ruim;

  if (itens.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-slate-400">Nenhum item ou móvel encontrado com os filtros selecionados.</td></tr>`;
    return;
  }

  tbody.innerHTML = itens.map(m => {
    let estadoClass = 'bg-emerald-100 text-emerald-800';
    if (m.estado_conservacao === 'Regular') estadoClass = 'bg-amber-100 text-amber-800';
    if (m.estado_conservacao === 'Ruim' || m.estado_conservacao === 'Danificado') estadoClass = 'bg-red-100 text-red-800';

    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="py-3 px-4 font-semibold text-slate-800">
          <div>${m.bloco_nome}</div>
          <div class="text-xs text-sky-600 font-bold">Quarto ${m.quarto_numero}</div>
        </td>
        <td class="py-3 px-4 font-bold text-slate-900">${m.tipo_item}</td>
        <td class="py-3 px-4 text-center font-bold text-slate-800">${m.quantidade}</td>
        <td class="py-3 px-4">
          <span class="px-2 py-0.5 rounded text-xs font-bold ${estadoClass}">${m.estado_conservacao}</span>
        </td>
        <td class="py-3 px-4">
          ${m.precisa_manutencao 
            ? '<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-700 border border-red-300">⚠️ MANUTENÇÃO</span>' 
            : '<span class="text-xs text-slate-400">Em Ordem</span>'}
        </td>
        <td class="py-3 px-4 text-xs text-slate-500">${m.data_vistoria || '-'}</td>
        <td class="py-3 px-4 text-xs text-slate-600 max-w-xs truncate" title="${m.observacoes || ''}">${m.observacoes || '-'}</td>
        <td class="py-3 px-4 text-right whitespace-nowrap">
          ${m.precisa_manutencao || m.estado_conservacao === 'Ruim' || m.estado_conservacao === 'Danificado' ? `
            <button onclick="resolverManutencaoMovel(${m.id})" class="btn-prefeito px-2 py-1 rounded bg-emerald-100 text-emerald-800 font-semibold text-xs mr-1 hover:bg-emerald-200" title="Marcar como reparado">
              <i class="fa-solid fa-circle-check"></i> Reparado
            </button>
          ` : ''}
          <button onclick="abrirModalEditarMovel(${m.id}, '${m.tipo_item}', ${m.quantidade}, '${m.estado_conservacao}', ${m.precisa_manutencao}, '${m.data_vistoria || ''}', '${m.observacoes || ''}')" class="btn-prefeito text-slate-500 hover:text-sky-600 p-1 mr-1">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button onclick="confirmarExcluirMovel(${m.id})" class="btn-prefeito text-slate-400 hover:text-red-600 p-1">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  updateUserRoleUI();
}

function openModalNovoMovel(quartoPreId = null) {
  if (!checkPrefeitoAccess()) return;
  document.getElementById('modalMovelTitulo').textContent = 'Cadastrar Novo Item / Móvel';
  document.getElementById('formMovel').reset();
  document.getElementById('movelFormId').value = '';

  preencherSelectQuartosParaMovel('movelFormQuartoId', quartoPreId);
  document.getElementById('movelFormDataVistoria').value = new Date().toISOString().split('T')[0];

  abrirModal('modalMovelForm');
}

function abrirModalEditarMovel(id, tipo, qtd, estado, manut, dataVistoria, obs) {
  if (!checkPrefeitoAccess()) return;
  document.getElementById('modalMovelTitulo').textContent = 'Editar Item / Vistoria';
  document.getElementById('movelFormId').value = id;
  document.getElementById('secaoMovelQuarto').classList.add('hidden'); // quarto não muda na edição

  document.getElementById('movelFormTipo').value = tipo;
  document.getElementById('movelFormQtd').value = qtd;
  document.getElementById('movelFormEstado').value = estado;
  document.getElementById('movelFormPrecisaManut').checked = !!manut;
  document.getElementById('movelFormDataVistoria').value = dataVistoria || '';
  document.getElementById('movelFormObs').value = obs || '';

  abrirModal('modalMovelForm');
}

async function salvarMovel(e) {
  e.preventDefault();
  if (!checkPrefeitoAccess()) return;

  const id = document.getElementById('movelFormId').value;
  const tipo = document.getElementById('movelFormTipo').value;
  const qtd = parseInt(document.getElementById('movelFormQtd').value);
  const estado = document.getElementById('movelFormEstado').value;
  const manut = document.getElementById('movelFormPrecisaManut').checked ? 1 : 0;
  const dataVistoria = document.getElementById('movelFormDataVistoria').value;
  const obs = document.getElementById('movelFormObs').value.trim();

  if (!id) {
    const quartoId = document.getElementById('movelFormQuartoId').value;
    if (!quartoId) {
      showToast('Selecione o quarto de destino', 'warning');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/moveis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quarto_id: parseInt(quartoId),
          tipo_item: tipo,
          quantidade: qtd,
          estado_conservacao: estado,
          precisa_manutencao: manut,
          data_vistoria: dataVistoria,
          observacoes: obs,
          usuario: currentUserName
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Erro ao cadastrar móvel');

      showToast('Item cadastrado com sucesso!', 'success');
      fecharModal('modalMovelForm');
      carregarMoveis();
      carregarDashboard();
      if (quartoSelecionadoId) abrirModalQuartoDetalhes(quartoSelecionadoId);
    } catch (err) {
      showToast(err.message, 'error');
    }
  } else {
    try {
      const res = await fetch(`${API_BASE}/api/moveis/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo_item: tipo,
          quantidade: qtd,
          estado_conservacao: estado,
          precisa_manutencao: manut,
          data_vistoria: dataVistoria,
          observacoes: obs,
          usuario: currentUserName
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Erro ao atualizar');

      showToast('Item atualizado com sucesso!', 'success');
      fecharModal('modalMovelForm');
      carregarMoveis();
      carregarDashboard();
      if (quartoSelecionadoId) abrirModalQuartoDetalhes(quartoSelecionadoId);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
}

async function resolverManutencaoMovel(movelId) {
  if (!checkPrefeitoAccess()) return;
  try {
    const res = await fetch(`${API_BASE}/api/moveis/${movelId}/resolver-manutencao?usuario=${encodeURIComponent(currentUserName)}`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro');

    showToast('Manutenção marcada como resolvida e item restaurado!', 'success');
    carregarMoveis();
    carregarDashboard();
    if (quartoSelecionadoId) abrirModalQuartoDetalhes(quartoSelecionadoId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function confirmarExcluirMovel(id) {
  if (!checkPrefeitoAccess()) return;
  if (!confirm('Deseja realmente excluir este móvel/item do quarto?')) return;

  try {
    const res = await fetch(`${API_BASE}/api/moveis/${id}?usuario=${encodeURIComponent(currentUserName)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro ao excluir');

    showToast('Item removido com sucesso!', 'success');
    carregarMoveis();
    carregarDashboard();
    if (quartoSelecionadoId) abrirModalQuartoDetalhes(quartoSelecionadoId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ========================================================
// 5. GESTÃO DE CADASTROS (ESTRUTURA & EMPRESAS)
// ========================================================

async function carregarGestaoCadastros() {
  await carregarBlocosCadastros();
  await carregarEmpresasCadastros();
}

let blocoGerenciandoId = null;

async function carregarBlocosCadastros() {
  const tbody = document.getElementById('tabelaBlocosCadastros');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_BASE}/api/blocos`);
    const blocos = await res.json();
    globalBlocos = blocos;

    // Atualizar Métricas / Relatóriozinho de Estrutura Física no Topo
    const elTotBlocos = document.getElementById('statGestaoTotalBlocos');
    const elTotQuartos = document.getElementById('statGestaoTotalQuartos');
    const elQuartosSub = document.getElementById('statGestaoQuartosSub');
    const elTotVagas = document.getElementById('statGestaoTotalVagas');
    const elVagasSub = document.getElementById('statGestaoVagasSub');
    const elOcupacao = document.getElementById('statGestaoOcupacao');
    const elOcupacaoSub = document.getElementById('statGestaoOcupacaoSub');

    let somaQuartos = 0;
    let somaQuartosAtivos = 0;
    let somaQuartosDesativados = 0;
    let somaVagasAtivas = 0;
    let somaVagasDesativadas = 0;
    let somaOcupadas = 0;

    blocos.forEach(b => {
      somaQuartos += Number(b.total_quartos || 0);
      somaQuartosAtivos += Number(b.quartos_ativos !== undefined ? b.quartos_ativos : b.total_quartos || 0);
      somaQuartosDesativados += Number(b.quartos_desativados || 0);
      somaVagasAtivas += Number(b.total_vagas || 0);
      somaVagasDesativadas += Number(b.vagas_desativadas || 0);
      somaOcupadas += Number(b.ocupadas || 0);
    });

    const somaLivres = Math.max(0, somaVagasAtivas - somaOcupadas);
    const taxaGeral = somaVagasAtivas > 0 ? ((somaOcupadas / somaVagasAtivas) * 100).toFixed(1) : '0.0';

    if (elTotBlocos) elTotBlocos.textContent = blocos.length;
    if (elTotQuartos) elTotQuartos.textContent = somaQuartos;
    if (elQuartosSub) elQuartosSub.textContent = `${somaQuartosAtivos} ativos • ${somaQuartosDesativados} desativados`;
    if (elTotVagas) elTotVagas.textContent = somaVagasAtivas;
    if (elVagasSub) elVagasSub.textContent = somaVagasDesativadas > 0 ? `Capacidade ativa (-${somaVagasDesativadas} vagas desativadas)` : 'Capacidade total em operação';
    if (elOcupacao) elOcupacao.textContent = `${taxaGeral}%`;
    if (elOcupacaoSub) elOcupacaoSub.textContent = `${somaOcupadas} ocupadas • ${somaLivres} livres`;

    tbody.innerHTML = blocos.map(b => {
      let badgeTipo = 'bg-slate-100 text-slate-700 border-slate-300';
      if (b.tipo === 'adm') badgeTipo = 'bg-indigo-100 text-indigo-700 border-indigo-300';
      if (b.tipo === 'conteiner') badgeTipo = 'bg-orange-100 text-orange-700 border-orange-300';

      const qAtivos = b.quartos_ativos !== undefined ? b.quartos_ativos : b.total_quartos;
      const qDesat = b.quartos_desativados || 0;
      const taxa = b.taxa_ocupacao || 0;
      let barCor = 'bg-emerald-500';
      if (taxa >= 90) barCor = 'bg-rose-500';
      else if (taxa >= 70) barCor = 'bg-amber-500';

      return `
        <tr class="hover:bg-slate-50 transition border-b border-slate-100">
          <td class="py-3 px-3.5">
            <div class="flex items-center gap-2">
              <span class="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center text-sm font-bold border border-sky-200">
                <i class="fa-solid fa-hotel"></i>
              </span>
              <div>
                <span class="font-extrabold text-slate-900 text-sm block">${b.nome}</span>
                <span class="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded border ${badgeTipo}">
                  ${b.tipo}
                </span>
              </div>
            </div>
          </td>

          <td class="py-3 px-3 text-center">
            <span class="font-bold text-slate-900 text-sm">${b.total_quartos}</span>
            <div class="flex items-center justify-center gap-1 mt-0.5">
              <span class="text-[10px] px-1.5 py-0.2 rounded font-bold bg-emerald-50 text-emerald-700 border border-emerald-200" title="Quartos Ativos em Operação">
                ${qAtivos} ativos
              </span>
              ${qDesat > 0 ? `
                <span class="text-[10px] px-1.5 py-0.2 rounded font-bold bg-slate-100 text-slate-600 border border-slate-300" title="Quartos Desativados">
                  ${qDesat} desat.
                </span>
              ` : ''}
            </div>
          </td>

          <td class="py-3 px-3 text-center">
            <div class="font-extrabold text-slate-900 text-sm">${b.total_vagas}</div>
            <span class="text-[10px] text-slate-500">vagas ativas</span>
            ${(b.vagas_desativadas || 0) > 0 ? `
              <span class="block text-[10px] text-rose-600 font-semibold">(-${b.vagas_desativadas} vagas)</span>
            ` : ''}
          </td>

          <td class="py-3 px-3">
            <div class="max-w-[150px] mx-auto text-xs">
              <div class="flex items-center justify-between font-semibold mb-1">
                <span class="text-blue-600 font-bold">${b.ocupadas || 0} ocu.</span>
                <span class="text-slate-400">•</span>
                <span class="text-emerald-600 font-bold">${b.livres || 0} liv.</span>
                <span class="text-slate-700 font-bold ml-1">${taxa}%</span>
              </div>
              <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div class="${barCor} h-1.5 rounded-full" style="width: ${Math.min(100, taxa)}%"></div>
              </div>
            </div>
          </td>

          <td class="py-3 px-3 text-right whitespace-nowrap">
            <div class="inline-flex items-center gap-1.5">
              <button onclick="abrirModalGerenciarQuartosBloco(${b.id})" class="btn-prefeito px-2.5 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 font-bold text-xs flex items-center gap-1.5 transition shadow-2xs" title="Gerenciar quartos, desativar ou adicionar quartos">
                <i class="fa-solid fa-door-open text-sky-600"></i>
                <span>Quartos</span>
              </button>
              <button onclick="abrirModalNovoQuartoNoBloco(${b.id})" class="btn-prefeito px-2 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-xs transition" title="Adicionar Quarto no Bloco (Aumentar capacidade)">
                <i class="fa-solid fa-plus text-emerald-600"></i>
              </button>
              <button onclick="abrirModalEditarBloco(${b.id}, '${b.nome}', '${b.tipo}', ${b.ordem || 0})" class="btn-prefeito p-1.5 rounded-lg text-slate-400 hover:text-sky-600 transition" title="Editar Dados do Bloco">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button onclick="confirmarExcluirBloco(${b.id}, '${b.nome}')" class="btn-prefeito p-1.5 rounded-lg text-slate-400 hover:text-red-600 transition" title="Excluir Bloco">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    updateUserRoleUI();
  } catch (err) {
    console.error('Erro blocos cadastros:', err);
  }
}

// ========================================================
// GERENCIADOR DE QUARTOS DO BLOCO (DESATIVAR & AUMENTAR QUARTOS)
// ========================================================

function abrirModalGerenciarQuartosBloco(blocoId) {
  if (!checkPrefeitoAccess()) return;
  blocoGerenciandoId = blocoId;

  const bloco = (globalBlocos || []).find(b => b.id == blocoId) ||
                (window.StaticApiEngine?.dbState?.blocos || []).find(b => b.id == blocoId);

  if (!bloco) {
    showToast('Bloco não encontrado.', 'error');
    return;
  }

  const quartosBloco = (window.StaticApiEngine?.dbState?.quartos || globalQuartos || []).filter(q => q.bloco_id == blocoId);

  // Atualizar título e badges de topo do modal
  const elTitulo = document.getElementById('modalGerenciarQuartosTitulo');
  const elTot = document.getElementById('badgeModalTotalQuartos');
  const elAtivos = document.getElementById('badgeModalQuartosAtivos');
  const elDesat = document.getElementById('badgeModalQuartosDesativados');
  const elVagas = document.getElementById('badgeModalTotalVagasAtivas');

  const ativosQtd = quartosBloco.filter(q => q.ativo !== false && q.status !== 'desativado').length;
  const desatQtd = quartosBloco.filter(q => q.ativo === false || q.status === 'desativado').length;
  const vagasAtivas = quartosBloco.filter(q => q.ativo !== false && q.status !== 'desativado').reduce((s, q) => s + (Number(q.capacidade) || 4), 0);

  if (elTitulo) elTitulo.textContent = `Quartos & Capacidade — ${bloco.nome}`;
  if (elTot) elTot.textContent = `${quartosBloco.length} quartos`;
  if (elAtivos) elAtivos.textContent = `${ativosQtd} ativos`;
  if (elDesat) elDesat.textContent = `${desatQtd} desativados`;
  if (elVagas) elVagas.textContent = `${vagasAtivas} vagas ativas`;

  // Limpar busca e filtro
  const inputBusca = document.getElementById('buscaQuartosBlocoModalInput');
  const selectStatus = document.getElementById('filtroStatusQuartosBlocoModal');
  if (inputBusca) inputBusca.value = '';
  if (selectStatus) selectStatus.value = 'todos';

  renderizarQuartosBlocoModal(quartosBloco);
  abrirModal('modalGerenciarQuartosBloco');
}

function filtrarQuartosBlocoModalUI() {
  if (!blocoGerenciandoId) return;
  const quartosBloco = (window.StaticApiEngine?.dbState?.quartos || globalQuartos || []).filter(q => q.bloco_id == blocoGerenciandoId);
  const busca = (document.getElementById('buscaQuartosBlocoModalInput')?.value || '').toLowerCase().trim();
  const filtroStatus = document.getElementById('filtroStatusQuartosBlocoModal')?.value || 'todos';

  let filtrados = quartosBloco.filter(q => {
    const isDesativado = q.ativo === false || q.status === 'desativado';
    if (filtroStatus === 'ativos' && isDesativado) return false;
    if (filtroStatus === 'desativados' && !isDesativado) return false;

    if (busca) {
      const matchNum = String(q.numero || '').toLowerCase().includes(busca);
      const matchObs = String(q.observacoes || '').toLowerCase().includes(busca);
      const matchMorador = (q.vagas || []).some(v => v.nome_completo && v.nome_completo.toLowerCase().includes(busca));
      if (!matchNum && !matchObs && !matchMorador) return false;
    }
    return true;
  });

  renderizarQuartosBlocoModal(filtrados);
}

function renderizarQuartosBlocoModal(quartos) {
  const tbody = document.getElementById('tabelaQuartosBlocoModalCorpo');
  const vazioEl = document.getElementById('quartosBlocoModalVazio');
  if (!tbody) return;

  if (quartos.length === 0) {
    tbody.innerHTML = '';
    if (vazioEl) vazioEl.classList.remove('hidden');
    return;
  }
  if (vazioEl) vazioEl.classList.add('hidden');

  tbody.innerHTML = quartos.map(q => {
    const isDesativado = q.ativo === false || q.status === 'desativado';
    const ocupadas = q.vagas_ocupadas !== undefined ? q.vagas_ocupadas : (q.vagas || []).filter(v => v.status === 'ocupada').length;
    const livres = Math.max(0, (Number(q.capacidade) || 4) - ocupadas);
    
    // Lista de moradores atuais
    const moradores = (q.vagas || []).filter(v => (v.status === 'ocupada' || v.alojado) && (v.nome_completo || (v.alojado && v.alojado.nome_completo))).map(v => {
      const nome = v.nome_completo || (v.alojado && v.alojado.nome_completo);
      return `<span class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200" title="Cama ${v.numero_cama}"><i class="fa-solid fa-user text-[9px]"></i> ${nome}</span>`;
    }).join(' ');

    return `
      <tr class="hover:bg-slate-50 transition border-b border-slate-100 ${isDesativado ? 'bg-slate-50/70 opacity-80' : ''}">
        <td class="py-2.5 px-3">
          <div class="flex items-center gap-2">
            <span class="w-7 h-7 rounded-lg ${isDesativado ? 'bg-slate-200 text-slate-500' : 'bg-sky-100 text-sky-700'} flex items-center justify-center text-xs font-black">
              ${q.numero}
            </span>
            <div>
              <span class="font-bold text-slate-900 text-xs block">Quarto ${q.numero}</span>
              ${q.observacoes ? `<span class="text-[10px] text-slate-400 block truncate max-w-[160px]">${q.observacoes}</span>` : ''}
            </div>
          </div>
        </td>

        <td class="py-2.5 px-3 text-center">
          <div class="inline-flex items-center gap-1">
            <span class="font-extrabold text-slate-800 text-xs">${q.capacidade || 4} camas</span>
            <button onclick="abrirModalEditarCapacidadeQuarto(${q.id}, '${q.numero}', ${q.capacidade || 4}, '${q.observacoes || ''}')" class="btn-prefeito p-1 text-slate-400 hover:text-sky-600 transition" title="Alterar capacidade de camas deste quarto">
              <i class="fa-solid fa-pen text-[10px]"></i>
            </button>
          </div>
        </td>

        <td class="py-2.5 px-3">
          <div class="text-xs">
            <div class="font-semibold text-slate-700 mb-1">
              <span class="text-blue-700 font-bold">${ocupadas} ocupadas</span> • 
              <span class="${isDesativado ? 'text-slate-400' : 'text-emerald-700'} font-bold">${isDesativado ? '0 disponíveis' : `${livres} livres`}</span>
            </div>
            <div class="flex items-center gap-1 flex-wrap">
              ${moradores || '<span class="text-[11px] text-slate-400 italic">Quarto vazio</span>'}
            </div>
          </div>
        </td>

        <td class="py-2.5 px-3 text-center">
          ${isDesativado ? `
            <span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 border border-slate-300">
              <span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span> Desativado
            </span>
          ` : `
            <span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Ativo
            </span>
          `}
        </td>

        <td class="py-2.5 px-3 text-right whitespace-nowrap">
          <div class="inline-flex items-center gap-1.5">
            ${isDesativado ? `
              <button onclick="reativarQuartoBloco(${q.id})" class="btn-prefeito px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 transition shadow-xs" title="Reativar quarto e somar vagas na capacidade">
                <i class="fa-solid fa-rotate-left"></i> Reativar
              </button>
            ` : `
              <button onclick="desativarQuartoBloco(${q.id})" class="btn-prefeito px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 font-bold text-xs flex items-center gap-1 transition" title="Desativar quarto para diminuir a capacidade">
                <i class="fa-solid fa-power-off text-amber-600"></i> Desativar
              </button>
            `}
            <button onclick="confirmarExcluirQuarto(${q.id}, '${q.numero}', ${ocupadas})" class="btn-prefeito p-1.5 rounded-lg text-slate-400 hover:text-rose-600 transition" title="Excluir quarto permanentemente">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Desativar Quarto (Reduz Capacidade do Bloco)
async function desativarQuartoBloco(quartoId) {
  if (!checkPrefeitoAccess()) return;
  const q = (window.StaticApiEngine?.dbState?.quartos || globalQuartos || []).find(x => x.id == quartoId);
  if (!q) {
    showToast('Quarto não encontrado.', 'error');
    return;
  }

  const ocupadas = q.vagas_ocupadas !== undefined ? q.vagas_ocupadas : (q.vagas || []).filter(v => v.status === 'ocupada').length;
  let confirmMsg = `Deseja realmente DESATIVAR o Quarto ${q.numero} do ${q.bloco_nome}?\n\nA capacidade operacional do bloco será reduzida em ${q.capacidade || 4} vagas.`;
  if (ocupadas > 0) {
    confirmMsg += `\n\n⚠️ ATENÇÃO: Há ${ocupadas} trabalhador(es) alojado(s) neste quarto! As vagas continuarão com eles até que sejam transferidos ou liberados.`;
  }

  if (!confirm(confirmMsg)) return;

  try {
    if (window.StaticApiEngine && window.StaticApiEngine.dbState) {
      const qEngine = window.StaticApiEngine.dbState.quartos.find(x => x.id == quartoId);
      if (qEngine) {
        qEngine.ativo = false;
        qEngine.status = 'desativado';
        qEngine.status_visual = 'desativado';
        (qEngine.vagas || []).forEach(v => {
          if (v.status !== 'ocupada') {
            v.status = 'desativada';
          }
        });
      }
      window.StaticApiEngine.recomputeStats();
      window.StaticApiEngine.saveToStorage();
    }

    try {
      await fetch(`${API_BASE}/api/quartos/${quartoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ativo: false,
          status: 'desativado',
          usuario: currentUserName
        })
      });
    } catch(e) {}

    sincronizarAlteracaoLeveFirebase('quartos', quartoId, {
      id: quartoId,
      ativo: false,
      status: 'desativado'
    });

    registrarAuditoria(
      'alojamento',
      'DESATIVAR_QUARTO',
      q.bloco_nome || 'Alojamento',
      `Quarto ${q.numero} desativado. Capacidade do bloco ${q.bloco_nome} reduzida em ${q.capacidade || 4} vagas.`
    );

    showToast(`Quarto ${q.numero} desativado! Capacidade do bloco reduzida.`, 'success');

    await refreshAllData();
    if (blocoGerenciandoId) {
      abrirModalGerenciarQuartosBloco(blocoGerenciandoId);
    }
    carregarBlocosCadastros();
  } catch(err) {
    console.error('Erro ao desativar quarto:', err);
    showToast('Erro ao desativar quarto', 'error');
  }
}

// Reativar Quarto (Aumenta Capacidade do Bloco)
async function reativarQuartoBloco(quartoId) {
  if (!checkPrefeitoAccess()) return;
  const q = (window.StaticApiEngine?.dbState?.quartos || globalQuartos || []).find(x => x.id == quartoId);
  if (!q) {
    showToast('Quarto não encontrado.', 'error');
    return;
  }

  if (!confirm(`Deseja REATIVAR o Quarto ${q.numero} do ${q.bloco_nome}?\n\nA capacidade operacional do bloco será aumentada em ${q.capacidade || 4} vagas.`)) return;

  try {
    if (window.StaticApiEngine && window.StaticApiEngine.dbState) {
      const qEngine = window.StaticApiEngine.dbState.quartos.find(x => x.id == quartoId);
      if (qEngine) {
        qEngine.ativo = true;
        qEngine.status = 'ativo';
        (qEngine.vagas || []).forEach(v => {
          if (v.status === 'desativada') {
            v.status = 'livre';
          }
        });
      }
      window.StaticApiEngine.recomputeStats();
      window.StaticApiEngine.saveToStorage();
    }

    try {
      await fetch(`${API_BASE}/api/quartos/${quartoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ativo: true,
          status: 'ativo',
          usuario: currentUserName
        })
      });
    } catch(e) {}

    sincronizarAlteracaoLeveFirebase('quartos', quartoId, {
      id: quartoId,
      ativo: true,
      status: 'ativo'
    });

    registrarAuditoria(
      'alojamento',
      'REATIVAR_QUARTO',
      q.bloco_nome || 'Alojamento',
      `Quarto ${q.numero} reativado. Capacidade do bloco ${q.bloco_nome} restaurada em ${q.capacidade || 4} vagas.`
    );

    showToast(`Quarto ${q.numero} reativado! Capacidade do bloco restaurada.`, 'success');

    await refreshAllData();
    if (blocoGerenciandoId) {
      abrirModalGerenciarQuartosBloco(blocoGerenciandoId);
    }
    carregarBlocosCadastros();
  } catch(err) {
    console.error('Erro ao reativar quarto:', err);
    showToast('Erro ao reativar quarto', 'error');
  }
}

// Atalho para adicionar novo quarto já vinculado ao bloco
function abrirModalNovoQuartoNoBloco(blocoId) {
  if (!checkPrefeitoAccess()) return;
  openModalNovoQuarto();
  const sel = document.getElementById('quartoFormBlocoId');
  if (sel && blocoId) {
    sel.value = blocoId;
  }
}

// Modal Editar Capacidade de Camas do Quarto
function abrirModalEditarCapacidadeQuarto(quartoId, numeroAtual, capAtual, obsAtual) {
  if (!checkPrefeitoAccess()) return;
  const inputId = document.getElementById('editarCapacidadeQuartoId');
  const inputNum = document.getElementById('editarCapacidadeQuartoNumero');
  const inputCap = document.getElementById('editarCapacidadeQuartoQtd');
  const inputObs = document.getElementById('editarCapacidadeQuartoObs');
  const elTitulo = document.getElementById('editarCapacidadeQuartoTitulo');

  if (inputId) inputId.value = quartoId;
  if (inputNum) inputNum.value = numeroAtual || '';
  if (inputCap) inputCap.value = capAtual || 4;
  if (inputObs) inputObs.value = obsAtual || '';
  if (elTitulo) elTitulo.textContent = `Ajustar Capacidade — Quarto ${numeroAtual}`;

  abrirModal('modalEditarCapacidadeQuarto');
}

async function salvarCapacidadeQuartoModal(e) {
  if (e) e.preventDefault();
  if (!checkPrefeitoAccess()) return;

  const quartoId = document.getElementById('editarCapacidadeQuartoId').value;
  const numero = document.getElementById('editarCapacidadeQuartoNumero').value.trim();
  const capacidade = parseInt(document.getElementById('editarCapacidadeQuartoQtd').value) || 4;
  const obs = document.getElementById('editarCapacidadeQuartoObs').value.trim();

  if (!quartoId) return;

  try {
    if (window.StaticApiEngine && window.StaticApiEngine.dbState) {
      const qEngine = window.StaticApiEngine.dbState.quartos.find(x => x.id == quartoId);
      if (qEngine) {
        qEngine.numero = numero;
        const capAntiga = qEngine.capacidade || 4;
        qEngine.capacidade = capacidade;
        qEngine.observacoes = obs;

        // Se aumentou capacidade, gerar novas camas livres
        if (capacidade > (qEngine.vagas || []).length) {
          const vagasExistentes = (qEngine.vagas || []).length;
          for (let i = vagasExistentes + 1; i <= capacidade; i++) {
            qEngine.vagas.push({
              id: Date.now() + i,
              numero_cama: i,
              status: qEngine.status === 'desativado' ? 'desativada' : 'livre',
              alojado: null
            });
          }
        }

        window.StaticApiEngine.recomputeStats();
        window.StaticApiEngine.saveToStorage();
        sincronizarAlteracaoLeveFirebase('quartos', qEngine.id, qEngine);
      }
    }

    try {
      await fetch(`${API_BASE}/api/quartos/${quartoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          numero: numero,
          capacidade: capacidade,
          observacoes: obs,
          usuario: currentUserName
        })
      });
    } catch(e) {}

    showToast(`Quarto ${numero} atualizado para capacidade de ${capacidade} camas!`, 'success');
    fecharModal('modalEditarCapacidadeQuarto');

    await refreshAllData();
    if (blocoGerenciandoId) {
      abrirModalGerenciarQuartosBloco(blocoGerenciandoId);
    }
    carregarBlocosCadastros();
  } catch(err) {
    showToast('Erro ao atualizar capacidade do quarto', 'error');
  }
}

// Exportar Resumo Estrutura dos Blocos em Excel (.xlsx)
function exportarResumoEstruturaBlocosExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('Biblioteca SheetJS (XLSX) não encontrada.', 'error');
    return;
  }

  showToast('📊 Gerando Relatório de Estrutura dos Blocos em Excel...', 'info');
  const wb = XLSX.utils.book_new();
  const dataHora = new Date().toLocaleString('pt-BR');
  const empresaNome = localStorage.getItem('appCustomEmpresaNome') || 'GEL - Construtora';
  const obraNome = localStorage.getItem('appCustomObraNome') || 'Canteiro Taboca 2';

  const ws = {};
  ExcelProGenerator.addCabecalhoObra(
    ws,
    `${obraNome.toUpperCase()} — ESTRUTURA FÍSICA DOS BLOCOS DE ALOJAMENTO`,
    `${empresaNome} • Capacidade, Quartos Ativos/Desativados e Ocupação • Emissão: ${dataHora}`,
    9
  );

  const headers = [
    'Bloco de Alojamento',
    'Classificação / Tipo',
    'Total de Quartos',
    'Quartos Ativos',
    'Quartos Desativados',
    'Capacidade Ativa (Camas)',
    'Camas Ocupadas',
    'Camas Livres (Fórmula)',
    'Taxa Ocupação (Fórmula)'
  ];
  headers.forEach((h, col) => ExcelProGenerator.addCell(ws, 3, col, h, { s: ExcelProGenerator.estilos.th }));

  const blocos = globalBlocos || (window.StaticApiEngine?.dbState?.blocos) || [];
  let totQuartos = 0;
  let totAtivos = 0;
  let totDesat = 0;
  let totVagas = 0;
  let totOcupadas = 0;

  blocos.forEach((b, idx) => {
    const r = 4 + idx;
    const rowEx = r + 1;
    const zebra = idx % 2 === 1;

    const qTot = Number(b.total_quartos || 0);
    const qAtiv = Number(b.quartos_ativos !== undefined ? b.quartos_ativos : b.total_quartos || 0);
    const qDes = Number(b.quartos_desativados || 0);
    const vagas = Number(b.total_vagas || 0);
    const ocup = Number(b.ocupadas || 0);
    const livres = Math.max(0, vagas - ocup);
    const taxa = vagas > 0 ? (ocup / vagas) : 0;

    totQuartos += qTot;
    totAtivos += qAtiv;
    totDesat += qDes;
    totVagas += vagas;
    totOcupadas += ocup;

    ExcelProGenerator.addCell(ws, r, 0, b.nome || 'Bloco', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
    ExcelProGenerator.addCell(ws, r, 1, String(b.tipo || 'alojamento').toUpperCase(), { s: ExcelProGenerator.estilos.td(zebra, 'center') });
    ExcelProGenerator.addCell(ws, r, 2, qTot, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
    ExcelProGenerator.addCell(ws, r, 3, qAtiv, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
    ExcelProGenerator.addCell(ws, r, 4, qDes, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
    ExcelProGenerator.addCell(ws, r, 5, vagas, { s: ExcelProGenerator.estilos.td(zebra, 'right') });
    ExcelProGenerator.addCell(ws, r, 6, ocup, { s: ExcelProGenerator.estilos.td(zebra, 'right') });
    ExcelProGenerator.addCell(ws, r, 7, livres, { f: `F${rowEx}-G${rowEx}`, s: ExcelProGenerator.estilos.td(zebra, 'right') });
    ExcelProGenerator.addCell(ws, r, 8, taxa, { f: `IF(F${rowEx}>0,G${rowEx}/F${rowEx},0)`, z: '0.0%', s: ExcelProGenerator.estilos.td(zebra, 'center') });
  });

  const totRow = 4 + blocos.length;
  const totEx = totRow + 1;
  const firstRow = 5;
  const lastRow = totRow;

  ExcelProGenerator.addCell(ws, totRow, 0, 'TOTAL GERAL ESTRUTURA', { s: ExcelProGenerator.estilos.total('left') });
  ExcelProGenerator.addCell(ws, totRow, 1, `${blocos.length} Blocos`, { s: ExcelProGenerator.estilos.total('center') });
  ExcelProGenerator.addCell(ws, totRow, 2, totQuartos, { f: `SUM(C${firstRow}:C${lastRow})`, s: ExcelProGenerator.estilos.total('center') });
  ExcelProGenerator.addCell(ws, totRow, 3, totAtivos, { f: `SUM(D${firstRow}:D${lastRow})`, s: ExcelProGenerator.estilos.total('center') });
  ExcelProGenerator.addCell(ws, totRow, 4, totDesat, { f: `SUM(E${firstRow}:E${lastRow})`, s: ExcelProGenerator.estilos.total('center') });
  ExcelProGenerator.addCell(ws, totRow, 5, totVagas, { f: `SUM(F${firstRow}:F${lastRow})`, s: ExcelProGenerator.estilos.total('right') });
  ExcelProGenerator.addCell(ws, totRow, 6, totOcupadas, { f: `SUM(G${firstRow}:G${lastRow})`, s: ExcelProGenerator.estilos.total('right') });
  ExcelProGenerator.addCell(ws, totRow, 7, Math.max(0, totVagas - totOcupadas), { f: `F${totEx}-G${totEx}`, s: ExcelProGenerator.estilos.total('right') });
  ExcelProGenerator.addCell(ws, totRow, 8, totVagas > 0 ? (totOcupadas / totVagas) : 0, { f: `IF(F${totEx}>0,G${totEx}/F${totEx},0)`, z: '0.0%', s: ExcelProGenerator.estilos.total('center') });

  ws['!ref'] = `A1:I${totEx + 1}`;
  ws['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 24 }, { wch: 18 }, { wch: 22 }, { wch: 22 }];
  ws['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
  XLSX.utils.book_append_sheet(wb, ws, "ESTRUTURA BLOCOS");

  XLSX.writeFile(wb, `estrutura_blocos_${obraNome.toLowerCase().replace(/\s+/g, '_')}.xlsx`);
  showToast('Planilha de estrutura dos blocos baixada com sucesso!', 'success');
}

async function carregarEmpresasCadastros() {
  const tbody = document.getElementById('tabelaEmpresasCadastros');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_BASE}/api/empresas`);
    const empresas = await res.json();
    globalEmpresas = empresas;

    tbody.innerHTML = empresas.map(e => `
      <tr class="hover:bg-slate-50">
        <td class="py-2.5 px-3 font-bold text-slate-900">${e.nome}</td>
        <td class="py-2.5 px-3 text-center">
          <span class="inline-block w-6 h-6 rounded-full border border-slate-300 shadow-xs" style="background-color: ${e.cor || '#3b82f6'}"></span>
        </td>
        <td class="py-2.5 px-3 text-center font-bold text-slate-800">${e.total_alojados}</td>
        <td class="py-2.5 px-3 text-right whitespace-nowrap">
          <button onclick="abrirModalEditarEmpresa(${e.id}, '${e.nome}', '${e.cor || '#3b82f6'}')" class="btn-prefeito text-slate-500 hover:text-emerald-600 mr-2">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button onclick="confirmarExcluirEmpresa(${e.id}, '${e.nome}', ${e.total_alojados})" class="btn-prefeito text-slate-400 hover:text-red-600">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');

    updateUserRoleUI();
  } catch (err) {
    console.error('Erro empresas cadastros:', err);
  }
}

// Bloco Modais
function openModalNovoBloco() {
  if (!checkPrefeitoAccess()) return;
  document.getElementById('modalBlocoTitulo').textContent = 'Cadastrar Novo Bloco';
  document.getElementById('formBloco').reset();
  document.getElementById('blocoFormId').value = '';
  abrirModal('modalBlocoForm');
}

function abrirModalEditarBloco(id, nome, tipo, ordem) {
  if (!checkPrefeitoAccess()) return;
  document.getElementById('modalBlocoTitulo').textContent = 'Editar Bloco';
  document.getElementById('blocoFormId').value = id;
  document.getElementById('blocoFormNome').value = nome;
  document.getElementById('blocoFormTipo').value = tipo;
  abrirModal('modalBlocoForm');
}

async function salvarBloco(e) {
  e.preventDefault();
  if (!checkPrefeitoAccess()) return;

  const id = document.getElementById('blocoFormId').value;
  const nome = document.getElementById('blocoFormNome').value.trim();
  const tipo = document.getElementById('blocoFormTipo').value;

  const method = id ? 'PUT' : 'POST';
  const url = id ? `${API_BASE}/api/blocos/${id}` : `${API_BASE}/api/blocos`;

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: nome,
        tipo: tipo,
        usuario: currentUserName
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro ao salvar bloco');

    showToast('Bloco salvo com sucesso!', 'success');
    fecharModal('modalBlocoForm');
    refreshAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function confirmarExcluirBloco(id, nome) {
  if (!checkPrefeitoAccess()) return;
  if (!confirm(`Deseja realmente excluir o bloco '${nome}'? Só é permitido excluir se todas as vagas estiverem desocupadas.`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/blocos/${id}?usuario=${encodeURIComponent(currentUserName)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro ao excluir bloco');

    showToast('Bloco excluído!', 'success');
    refreshAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Quarto Modais
function openModalNovoQuarto() {
  if (!checkPrefeitoAccess()) return;
  document.getElementById('formQuarto').reset();
  preencherSelectBlocos('quartoFormBlocoId');
  abrirModal('modalQuartoForm');
}

async function salvarQuarto(e) {
  e.preventDefault();
  if (!checkPrefeitoAccess()) return;

  const blocoId = document.getElementById('quartoFormBlocoId').value;
  const numero = document.getElementById('quartoFormNumero').value.trim();
  const capacidade = parseInt(document.getElementById('quartoFormCapacidade').value);
  const obs = document.getElementById('quartoFormObs').value.trim();

  try {
    const res = await fetch(`${API_BASE}/api/quartos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bloco_id: parseInt(blocoId),
        numero: numero,
        capacidade: capacidade,
        observacoes: obs,
        usuario: currentUserName
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro ao cadastrar quarto');

    showToast('Quarto criado e camas geradas com sucesso!', 'success');
    fecharModal('modalQuartoForm');
    refreshAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function abrirModalEditarQuarto(id, numero, capacidade, obs) {
  if (!checkPrefeitoAccess()) return;
  const novoNum = prompt('Editar número do quarto:', numero);
  if (!novoNum) return;
  const novaCap = prompt('Editar capacidade de camas:', capacidade);
  if (!novaCap) return;

  fetch(`${API_BASE}/api/quartos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      numero: novoNum.trim(),
      capacidade: parseInt(novaCap),
      observacoes: obs,
      usuario: currentUserName
    })
  })
  .then(res => res.json())
  .then(data => {
    showToast('Quarto atualizado!', 'success');
    refreshAllData();
  })
  .catch(err => showToast('Erro ao atualizar quarto', 'error'));
}

async function confirmarExcluirQuarto(id, numero, ocupadas) {
  if (!checkPrefeitoAccess()) return;
  if (ocupadas > 0) {
    showToast(`Não é possível excluir o Quarto ${numero} pois há ${ocupadas} vaga(s) ocupada(s). Libere-as antes.`, 'warning');
    return;
  }
  if (!confirm(`Deseja realmente excluir o Quarto ${numero}?`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/quartos/${id}?usuario=${encodeURIComponent(currentUserName)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro ao excluir quarto');

    showToast('Quarto excluído!', 'success');
    refreshAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Empresa Modais
function openModalNovaEmpresa() {
  if (!checkPrefeitoAccess()) return;
  document.getElementById('modalEmpresaTitulo').textContent = 'Cadastrar Empresa / Contratada';
  document.getElementById('formEmpresa').reset();
  document.getElementById('empresaFormId').value = '';
  document.getElementById('empresaFormCor').value = '#2563eb';
  abrirModal('modalEmpresaForm');
}

function abrirModalEditarEmpresa(id, nome, cor) {
  if (!checkPrefeitoAccess()) return;
  document.getElementById('modalEmpresaTitulo').textContent = 'Editar Empresa';
  document.getElementById('empresaFormId').value = id;
  document.getElementById('empresaFormNome').value = nome;
  document.getElementById('empresaFormCor').value = cor || '#2563eb';
  abrirModal('modalEmpresaForm');
}

async function salvarEmpresa(e) {
  e.preventDefault();
  if (!checkPrefeitoAccess()) return;

  const id = document.getElementById('empresaFormId').value;
  const nome = document.getElementById('empresaFormNome').value.trim();
  const cor = document.getElementById('empresaFormCor').value;

  const method = id ? 'PUT' : 'POST';
  const url = id ? `${API_BASE}/api/empresas/${id}` : `${API_BASE}/api/empresas`;

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: nome,
        cor: cor,
        usuario: currentUserName
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro ao salvar empresa');

    showToast('Empresa salva com sucesso!', 'success');
    fecharModal('modalEmpresaForm');
    refreshAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function confirmarExcluirEmpresa(id, nome, alojados) {
  if (!checkPrefeitoAccess()) return;
  if (alojados > 0) {
    showToast(`Não é possível excluir '${nome}' pois há ${alojados} colaborador(es) ativo(s) vinculado(s).`, 'warning');
    return;
  }
  if (!confirm(`Deseja realmente excluir o cadastro da empresa '${nome}'?`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/empresas/${id}?usuario=${encodeURIComponent(currentUserName)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro ao excluir');

    showToast('Empresa excluída!', 'success');
    refreshAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ========================================================
// 6. RELATÓRIOS & EXPORTAÇÕES EXCEL
// ========================================================

async function carregarRelatoriosPreview() {
  const tbody = document.getElementById('tabelaResumoGeralAoVivo');
  const tfoot = document.getElementById('tabelaResumoGeralFooter');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_BASE}/api/relatorios/resumo-geral`);
    const data = await res.json();

    tbody.innerHTML = data.linhas.map(l => {
      const taxa = l.total_vagas > 0 ? ((l.ocupadas / l.total_vagas) * 100).toFixed(1) : 0;
      return `
        <tr class="hover:bg-slate-50">
          <td class="py-3 px-4 font-bold text-slate-900">${l.alojamento}</td>
          <td class="py-3 px-4 text-xs font-semibold text-slate-500">${l.descricao}</td>
          <td class="py-3 px-4 text-center font-bold text-slate-800">${l.total_vagas}</td>
          <td class="py-3 px-4 text-center font-bold text-blue-600">${l.ocupadas}</td>
          <td class="py-3 px-4 text-center font-bold text-emerald-600">${l.vagas_livres}</td>
          <td class="py-3 px-4 text-center">
            <span class="px-2 py-0.5 rounded text-xs font-bold ${taxa >= 90 ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-800'}">
              ${taxa}%
            </span>
          </td>
        </tr>
      `;
    }).join('');

    const tot = data.totais;
    tfoot.innerHTML = `
      <tr>
        <td class="py-3 px-4 uppercase text-slate-900">Total Geral</td>
        <td class="py-3 px-4 text-xs text-slate-500">${data.linhas.length} Blocos</td>
        <td class="py-3 px-4 text-center text-slate-900">${tot.total_vagas}</td>
        <td class="py-3 px-4 text-center text-blue-700">${tot.ocupadas}</td>
        <td class="py-3 px-4 text-center text-emerald-700">${tot.vagas_livres}</td>
        <td class="py-3 px-4 text-center text-slate-900">${tot.taxa_ocupacao}%</td>
      </tr>
    `;
  } catch (err) {
    console.error('Erro resumo:', err);
  }
}

// ========================================================
// 6. RELATÓRIOS & EXPORTAÇÕES EXCEL PROFISSIONAIS (COM FÓRMULAS E ESTILOS)
// ========================================================

const ExcelProGenerator = {
  estilos: {
    title: {
      font: { bold: true, color: { rgb: '0F172A' }, sz: 14, name: 'Calibri' },
      alignment: { horizontal: 'left', vertical: 'center' }
    },
    subtitle: {
      font: { italic: true, color: { rgb: '475569' }, sz: 10, name: 'Calibri' },
      alignment: { horizontal: 'left', vertical: 'center' }
    },
    th: {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Calibri' },
      fill: { fgColor: { rgb: '1E293B' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: {
        top: { style: 'thin', color: { rgb: '94A3B8' } },
        bottom: { style: 'medium', color: { rgb: '0F172A' } },
        left: { style: 'thin', color: { rgb: '94A3B8' } },
        right: { style: 'thin', color: { rgb: '94A3B8' } }
      }
    },
    td: (zebra = false, align = 'left') => ({
      font: { sz: 10, color: { rgb: '0F172A' }, name: 'Calibri' },
      fill: zebra ? { fgColor: { rgb: 'F8FAFC' } } : { fgColor: { rgb: 'FFFFFF' } },
      alignment: { horizontal: align, vertical: 'center' },
      border: {
        top: { style: 'thin', color: { rgb: 'E2E8F0' } },
        bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
        left: { style: 'thin', color: { rgb: 'E2E8F0' } },
        right: { style: 'thin', color: { rgb: 'E2E8F0' } }
      }
    }),
    total: (align = 'center') => ({
      font: { bold: true, sz: 11, color: { rgb: '0F172A' }, name: 'Calibri' },
      fill: { fgColor: { rgb: 'E2E8F0' } },
      alignment: { horizontal: align, vertical: 'center' },
      border: {
        top: { style: 'medium', color: { rgb: '475569' } },
        bottom: { style: 'double', color: { rgb: '0F172A' } },
        left: { style: 'thin', color: { rgb: 'CBD5E1' } },
        right: { style: 'thin', color: { rgb: 'CBD5E1' } }
      }
    }),
    statusLivre: {
      font: { bold: true, sz: 9, color: { rgb: '166534' }, name: 'Calibri' },
      fill: { fgColor: { rgb: 'DCFCE7' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'thin', color: { rgb: 'BBF7D0' } },
        bottom: { style: 'thin', color: { rgb: 'BBF7D0' } },
        left: { style: 'thin', color: { rgb: 'BBF7D0' } },
        right: { style: 'thin', color: { rgb: 'BBF7D0' } }
      }
    },
    statusOcupada: {
      font: { bold: true, sz: 9, color: { rgb: '1E40AF' }, name: 'Calibri' },
      fill: { fgColor: { rgb: 'DBEAFE' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'thin', color: { rgb: 'BFDBFE' } },
        bottom: { style: 'thin', color: { rgb: 'BFDBFE' } },
        left: { style: 'thin', color: { rgb: 'BFDBFE' } },
        right: { style: 'thin', color: { rgb: 'BFDBFE' } }
      }
    },
    statusAlerta: {
      font: { bold: true, sz: 9, color: { rgb: '991B1B' }, name: 'Calibri' },
      fill: { fgColor: { rgb: 'FEE2E2' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'thin', color: { rgb: 'FECACA' } },
        bottom: { style: 'thin', color: { rgb: 'FECACA' } },
        left: { style: 'thin', color: { rgb: 'FECACA' } },
        right: { style: 'thin', color: { rgb: 'FECACA' } }
      }
    }
  },

  addCell(ws, r, c, val, opts = {}) {
    const ref = XLSX.utils.encode_cell({ r, c });
    const cell = { v: val };
    if (opts.f) cell.f = opts.f;
    if (opts.z) cell.z = opts.z;
    if (opts.s) cell.s = opts.s;
    if (opts.t) cell.t = opts.t;
    else cell.t = typeof val === 'number' ? 'n' : 's';
    ws[ref] = cell;
  },

  addCabecalhoObra(ws, titulo, subtitulo, totalCols) {
    this.addCell(ws, 0, 0, titulo, { s: this.estilos.title });
    this.addCell(ws, 1, 0, subtitulo, { s: this.estilos.subtitle });
    if (!ws['!merges']) ws['!merges'] = [];
    ws['!merges'].push(
      { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } }
    );
  }
};

function exportarResumoExcel() {
  if (staticModeActive && typeof XLSX !== 'undefined') {
    showToast('📊 Gerando Resumo Executivo em Excel com fórmulas...', 'info');
    const wb = XLSX.utils.book_new();
    const db = StaticApiEngine.dbState;
    const dataHora = new Date().toLocaleString('pt-BR');
    const empresaNome = localStorage.getItem('appCustomEmpresaNome') || 'GEL - Construtora';
    const obraNome = localStorage.getItem('appCustomObraNome') || 'Canteiro Taboca 2';

    // 1. ABA RESUMO EXECUTIVO
    const ws1 = {};
    ExcelProGenerator.addCabecalhoObra(ws1, `${obraNome.toUpperCase()} — RESUMO EXECUTIVO DE OCUPAÇÃO`, `${empresaNome} • Responsável: Tiago Vidal (Prefeito de Canteiro) • Emissão: ${dataHora}`, 7);
    const h1 = ['Bloco / Alojamento', 'Finalidade', 'Total Quartos', 'Capacidade (Vagas)', 'Vagas Ocupadas', 'Vagas Livres (Fórmula)', 'Taxa de Ocupação (Fórmula)'];
    h1.forEach((h, col) => ExcelProGenerator.addCell(ws1, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    const blocos = db.blocos || [];
    const quartos = db.quartos || [];

    blocos.forEach((b, idx) => {
      const r = 4 + idx;
      const zebra = idx % 2 === 1;
      const rowEx = r + 1;
      const qtsBloco = quartos.filter(q => q.bloco_id === b.id);
      const cap = b.total_vagas || (qtsBloco.reduce((acc, q) => acc + (q.capacidade || 4), 0));
      const oc = b.ocupadas !== undefined ? b.ocupadas : (qtsBloco.reduce((acc, q) => acc + (q.vagas_ocupadas || 0), 0));
      const liv = cap - oc;
      const taxa = cap > 0 ? (oc / cap) : 0;

      ExcelProGenerator.addCell(ws1, r, 0, b.nome, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws1, r, 1, (b.tipo || 'alojamento').toUpperCase(), { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws1, r, 2, qtsBloco.length || 22, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws1, r, 3, cap, { s: ExcelProGenerator.estilos.td(zebra, 'right') });
      ExcelProGenerator.addCell(ws1, r, 4, oc, { s: ExcelProGenerator.estilos.td(zebra, 'right') });
      ExcelProGenerator.addCell(ws1, r, 5, liv, { f: `D${rowEx}-E${rowEx}`, s: ExcelProGenerator.estilos.td(zebra, 'right') });
      ExcelProGenerator.addCell(ws1, r, 6, taxa, { f: `E${rowEx}/D${rowEx}`, z: '0.0%', s: ExcelProGenerator.estilos.td(zebra, 'center') });
    });

    const totRow1 = 4 + blocos.length;
    const totEx1 = totRow1 + 1;
    const firstRow1 = 5;
    const lastRow1 = totRow1;
    const totalGeralCap = db.geral?.total_vagas || 880;
    const totalGeralOc = db.geral?.ocupadas || 387;
    const totalGeralLiv = totalGeralCap - totalGeralOc;

    ExcelProGenerator.addCell(ws1, totRow1, 0, 'TOTAL CANTEIRO TABOCA 2', { s: ExcelProGenerator.estilos.total('left') });
    ExcelProGenerator.addCell(ws1, totRow1, 1, 'OBRA GERAL', { s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws1, totRow1, 2, quartos.length || 220, { f: `SUM(C${firstRow1}:C${lastRow1})`, s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws1, totRow1, 3, totalGeralCap, { f: `SUM(D${firstRow1}:D${lastRow1})`, s: ExcelProGenerator.estilos.total('right') });
    ExcelProGenerator.addCell(ws1, totRow1, 4, totalGeralOc, { f: `SUM(E${firstRow1}:E${lastRow1})`, s: ExcelProGenerator.estilos.total('right') });
    ExcelProGenerator.addCell(ws1, totRow1, 5, totalGeralLiv, { f: `D${totEx1}-E${totEx1}`, s: ExcelProGenerator.estilos.total('right') });
    ExcelProGenerator.addCell(ws1, totRow1, 6, (totalGeralOc / totalGeralCap), { f: `E${totEx1}/D${totEx1}`, z: '0.0%', s: ExcelProGenerator.estilos.total('center') });

    ws1['!ref'] = `A1:G${totEx1}`;
    ws1['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 16 }, { wch: 20 }, { wch: 18 }, { wch: 24 }, { wch: 26 }];
    ws1['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws1, "RESUMO DE OCUPAÇÃO");

    // 2. ABA EMPRESAS
    const wsEmp = {};
    ExcelProGenerator.addCabecalhoObra(wsEmp, `${obraNome.toUpperCase()} — DISTRIBUIÇÃO POR EMPRESA`, `${empresaNome} • Alojados Ativos por Empreiteira / Parceira • Emissão: ${dataHora}`, 4);
    const hEmp = ['Empresa Parceira', 'Total Alojados', '% Participação na Obra (Fórmula)', 'Status'];
    hEmp.forEach((h, col) => ExcelProGenerator.addCell(wsEmp, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    const empresas = db.empresas || [];
    const alojadosAtivos = (db.alojados || []).filter(a => a.status === 'ativo');
    const totAtivos = alojadosAtivos.length || 387;

    empresas.forEach((emp, idx) => {
      const r = 4 + idx;
      const zebra = idx % 2 === 1;
      const rowEx = r + 1;
      const qtdEmp = alojadosAtivos.filter(a => Number(a.empresa_id) === Number(emp.id)).length;
      const part = totAtivos > 0 ? (qtdEmp / totAtivos) : 0;

      ExcelProGenerator.addCell(wsEmp, r, 0, emp.nome, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(wsEmp, r, 1, qtdEmp, { s: ExcelProGenerator.estilos.td(zebra, 'right') });
      ExcelProGenerator.addCell(wsEmp, r, 2, part, { f: `B${rowEx}/$B$${4 + empresas.length + 1}`, z: '0.0%', s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(wsEmp, r, 3, 'PARCEIRA ATIVA', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
    });

    const totRowEmp = 4 + empresas.length;
    const totExEmp = totRowEmp + 1;
    ExcelProGenerator.addCell(wsEmp, totRowEmp, 0, 'TOTAL GERAL DA OBRA', { s: ExcelProGenerator.estilos.total('left') });
    ExcelProGenerator.addCell(wsEmp, totRowEmp, 1, totAtivos, { f: `SUM(B5:B${totRowEmp})`, s: ExcelProGenerator.estilos.total('right') });
    ExcelProGenerator.addCell(wsEmp, totRowEmp, 2, 1.0, { f: `SUM(C5:C${totRowEmp})`, z: '0.0%', s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(wsEmp, totRowEmp, 3, '100% REGISTRADO', { s: ExcelProGenerator.estilos.total('center') });

    wsEmp['!ref'] = `A1:D${totExEmp}`;
    wsEmp['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 30 }, { wch: 20 }];
    wsEmp['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, wsEmp, "POR EMPRESA");

    XLSX.writeFile(wb, "resumo_executivo_ocupacao_canteiro.xlsx");
    showToast('Planilha executiva baixada com sucesso!', 'success');
    return;
  }
  window.open(`${API_BASE}/api/relatorios/exportar-resumo-excel`, '_blank');
}

function exportarAlojadosExcel() {
  if (staticModeActive && typeof XLSX !== 'undefined') {
    showToast('📋 Gerando Lista Completa de Alojados com fórmulas...', 'info');
    const blocoId = document.getElementById('filtroAlojadosBloco')?.value || '';
    const empresaId = document.getElementById('filtroAlojadosEmpresa')?.value || '';
    let lista = (StaticApiEngine.dbState.alojados || []).filter(a => a.status === 'ativo');
    if (empresaId) lista = lista.filter(a => Number(a.empresa_id) === Number(empresaId));
    if (blocoId) {
      const b = StaticApiEngine.dbState.blocos.find(x => Number(x.id) === Number(blocoId));
      if (b) lista = lista.filter(a => a.bloco_nome === b.nome);
    }

    const wb = XLSX.utils.book_new();
    const dataHora = new Date().toLocaleString('pt-BR');
    const empresaNome = localStorage.getItem('appCustomEmpresaNome') || 'GEL - Construtora';
    const obraNome = localStorage.getItem('appCustomObraNome') || 'Canteiro Taboca 2';

    const ws = {};
    ExcelProGenerator.addCabecalhoObra(ws, `${obraNome.toUpperCase()} — RELAÇÃO DE ALOJADOS ATIVOS`, `${empresaNome} • Total Listado: ${lista.length} colaboradores • Emissão: ${dataHora}`, 10);
    const headers = ['Matrícula', 'Nome Completo', 'Empresa', 'Função / Cargo', 'WhatsApp', 'Bloco', 'Quarto', 'Cama', 'Data de Entrada', 'Observações'];
    headers.forEach((h, col) => ExcelProGenerator.addCell(ws, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    lista.forEach((a, idx) => {
      const r = 4 + idx;
      const zebra = idx % 2 === 1;
      const zapFormatado = a.whatsapp ? formatarTelefoneTexto(a.whatsapp) : '-';

      ExcelProGenerator.addCell(ws, r, 0, a.matricula || '-', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws, r, 1, a.nome_completo, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws, r, 2, a.empresa_nome || '-', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws, r, 3, a.funcao || 'Alojado', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws, r, 4, zapFormatado, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws, r, 5, a.bloco_nome || '-', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws, r, 6, String(a.quarto_numero || '-'), { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws, r, 7, a.numero_cama || 1, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws, r, 8, a.data_entrada || '-', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws, r, 9, a.observacoes || '', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
    });

    const totRow = 4 + lista.length;
    const totEx = totRow + 1;
    ExcelProGenerator.addCell(ws, totRow, 0, 'TOTAL ATIVOS', { s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws, totRow, 1, lista.length, { f: `COUNTA(B5:B${totRow})`, s: ExcelProGenerator.estilos.total('left') });
    for (let c = 2; c < 10; c++) {
      ExcelProGenerator.addCell(ws, totRow, c, '-', { s: ExcelProGenerator.estilos.total('center') });
    }

    ws['!ref'] = `A1:J${totEx}`;
    ws['!cols'] = [{ wch: 14 }, { wch: 34 }, { wch: 22 }, { wch: 24 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 30 }];
    ws['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws, "ALOJADOS ATIVOS");

    XLSX.writeFile(wb, "alojados_ativos_canteiro_taboca2.xlsx");
    showToast('Planilha de alojados baixada com sucesso!', 'success');
    return;
  }
  const blocoId = document.getElementById('filtroAlojadosBloco')?.value || '';
  const empresaId = document.getElementById('filtroAlojadosEmpresa')?.value || '';
  let url = `${API_BASE}/api/relatorios/exportar-alojados-excel?`;
  if (blocoId) url += `bloco_id=${blocoId}&`;
  if (empresaId) url += `empresa_id=${empresaId}&`;
  window.open(url, '_blank');
}

function exportarMoveisDanificadosExcel() {
  if (staticModeActive && typeof XLSX !== 'undefined') {
    showToast('🛠️ Gerando Relatório de Móveis e Manutenções...', 'info');
    const danificados = [];
    (StaticApiEngine.dbState.quartos || []).forEach(q => {
      (q.moveis || []).forEach(m => {
        if (m.precisa_manutencao === 1 || m.estado_conservacao === 'Ruim' || m.estado_conservacao === 'Danificado') {
          danificados.push({
            bloco_nome: q.bloco_nome,
            quarto_numero: q.numero,
            tipo_item: m.tipo_item,
            quantidade: m.quantidade || 1,
            estado_conservacao: m.estado_conservacao || 'Ruim',
            precisa_manutencao: m.precisa_manutencao ? 'SIM (ALERTA)' : 'NÃO',
            data_vistoria: m.data_vistoria || '-',
            observacoes: m.observacoes || ''
          });
        }
      });
    });

    const wb = XLSX.utils.book_new();
    const dataHora = new Date().toLocaleString('pt-BR');
    const empresaNome = localStorage.getItem('appCustomEmpresaNome') || 'GEL - Construtora';
    const obraNome = localStorage.getItem('appCustomObraNome') || 'Canteiro Taboca 2';

    const ws = {};
    ExcelProGenerator.addCabecalhoObra(ws, `${obraNome.toUpperCase()} — MÓVEIS EM ALERTA & MANUTENÇÃO`, `${empresaNome} • Itens Danificados ou com Reparo Solicitado • Emissão: ${dataHora}`, 8);
    const headers = ['Bloco', 'Quarto', 'Item / Patrimônio', 'Qtd', 'Estado de Conservação', 'Necessita Manutenção', 'Data da Vistoria', 'Observações / Ação Necessária'];
    headers.forEach((h, col) => ExcelProGenerator.addCell(ws, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    danificados.forEach((m, idx) => {
      const r = 4 + idx;
      const zebra = idx % 2 === 1;
      ExcelProGenerator.addCell(ws, r, 0, m.bloco_nome, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws, r, 1, String(m.quarto_numero), { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws, r, 2, m.tipo_item, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws, r, 3, m.quantidade, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws, r, 4, m.estado_conservacao, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws, r, 5, m.precisa_manutencao, { s: ExcelProGenerator.estilos.statusAlerta });
      ExcelProGenerator.addCell(ws, r, 6, m.data_vistoria, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws, r, 7, m.observacoes, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
    });

    const totRow = 4 + danificados.length;
    const totEx = totRow + 1;
    ExcelProGenerator.addCell(ws, totRow, 0, 'TOTAL ITENS EM ALERTA', { s: ExcelProGenerator.estilos.total('left') });
    ExcelProGenerator.addCell(ws, totRow, 1, '-', { s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws, totRow, 2, `${danificados.length} itens com avaria`, { s: ExcelProGenerator.estilos.total('left') });
    ExcelProGenerator.addCell(ws, totRow, 3, danificados.reduce((a, b) => a + Number(b.quantidade || 1), 0), { f: `SUM(D5:D${totRow})`, s: ExcelProGenerator.estilos.total('center') });
    for (let c = 4; c < 8; c++) {
      ExcelProGenerator.addCell(ws, totRow, c, '-', { s: ExcelProGenerator.estilos.total('center') });
    }

    ws['!ref'] = `A1:H${totEx}`;
    ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 28 }, { wch: 10 }, { wch: 24 }, { wch: 24 }, { wch: 18 }, { wch: 36 }];
    ws['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws, "MOVEIS COM ALERTA");

    XLSX.writeFile(wb, "moveis_manutencao_canteiro_taboca2.xlsx");
    showToast('Planilha de manutenção baixada com sucesso!', 'success');
    return;
  }
  window.open(`${API_BASE}/api/relatorios/exportar-moveis-danificados-excel`, '_blank');
}

function exportarPlanilhaOficial() {
  if (staticModeActive && typeof XLSX !== 'undefined') {
    showToast('📗 Gerando Planilha Oficial Taboca 2 (5 abas com fórmulas e layout profissional)...', 'info');
    const wb = XLSX.utils.book_new();
    const db = StaticApiEngine.dbState;
    const dataHora = new Date().toLocaleString('pt-BR');
    const empresaNome = localStorage.getItem('appCustomEmpresaNome') || 'GEL - Construtora';
    const obraNome = localStorage.getItem('appCustomObraNome') || 'Canteiro Taboca 2';

    const blocos = db.blocos || [];
    const quartos = db.quartos || [];
    const alojados = db.alojados || [];
    const empresas = db.empresas || [];
    const alojadosAtivos = alojados.filter(a => a.status === 'ativo');

    // ==========================================
    // ABA 1: RESUMO DE OCUPAÇÃO (COM FÓRMULAS)
    // ==========================================
    const ws1 = {};
    ExcelProGenerator.addCabecalhoObra(ws1, `${obraNome.toUpperCase()} — CONTROLE OFICIAL DE HABITAÇÃO & OCUPAÇÃO`, `${empresaNome} • Responsável: Tiago Vidal (Prefeito de Canteiro) • Emissão: ${dataHora}`, 7);
    const h1 = ['Bloco / Alojamento', 'Finalidade', 'Total Quartos', 'Capacidade Total', 'Vagas Ocupadas', 'Vagas Livres (Fórmula)', 'Taxa de Ocupação (Fórmula)'];
    h1.forEach((h, col) => ExcelProGenerator.addCell(ws1, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    blocos.forEach((b, idx) => {
      const r = 4 + idx;
      const zebra = idx % 2 === 1;
      const rowEx = r + 1;
      const qtsBloco = quartos.filter(q => q.bloco_id === b.id);
      const cap = b.total_vagas || (qtsBloco.reduce((acc, q) => acc + (q.capacidade || 4), 0));
      const oc = b.ocupadas !== undefined ? b.ocupadas : (qtsBloco.reduce((acc, q) => acc + (q.vagas_ocupadas || 0), 0));
      const liv = cap - oc;
      const taxa = cap > 0 ? (oc / cap) : 0;

      ExcelProGenerator.addCell(ws1, r, 0, b.nome, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws1, r, 1, (b.tipo || 'alojamento').toUpperCase(), { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws1, r, 2, qtsBloco.length || 22, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws1, r, 3, cap, { s: ExcelProGenerator.estilos.td(zebra, 'right') });
      ExcelProGenerator.addCell(ws1, r, 4, oc, { s: ExcelProGenerator.estilos.td(zebra, 'right') });
      ExcelProGenerator.addCell(ws1, r, 5, liv, { f: `D${rowEx}-E${rowEx}`, s: ExcelProGenerator.estilos.td(zebra, 'right') });
      ExcelProGenerator.addCell(ws1, r, 6, taxa, { f: `E${rowEx}/D${rowEx}`, z: '0.0%', s: ExcelProGenerator.estilos.td(zebra, 'center') });
    });

    const totRow1 = 4 + blocos.length;
    const totEx1 = totRow1 + 1;
    const totalGeralCap = db.geral?.total_vagas || 880;
    const totalGeralOc = alojadosAtivos.length || 387;
    const totalGeralLiv = totalGeralCap - totalGeralOc;

    ExcelProGenerator.addCell(ws1, totRow1, 0, 'TOTAL CANTEIRO TABOCA 2', { s: ExcelProGenerator.estilos.total('left') });
    ExcelProGenerator.addCell(ws1, totRow1, 1, 'OBRA GERAL', { s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws1, totRow1, 2, quartos.length || 220, { f: `SUM(C5:C${totRow1})`, s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws1, totRow1, 3, totalGeralCap, { f: `SUM(D5:D${totRow1})`, s: ExcelProGenerator.estilos.total('right') });
    ExcelProGenerator.addCell(ws1, totRow1, 4, totalGeralOc, { f: `SUM(E5:E${totRow1})`, s: ExcelProGenerator.estilos.total('right') });
    ExcelProGenerator.addCell(ws1, totRow1, 5, totalGeralLiv, { f: `D${totEx1}-E${totEx1}`, s: ExcelProGenerator.estilos.total('right') });
    ExcelProGenerator.addCell(ws1, totRow1, 6, (totalGeralOc / totalGeralCap), { f: `E${totEx1}/D${totEx1}`, z: '0.0%', s: ExcelProGenerator.estilos.total('center') });

    ws1['!ref'] = `A1:G${totEx1}`;
    ws1['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 16 }, { wch: 20 }, { wch: 18 }, { wch: 24 }, { wch: 26 }];
    ws1['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws1, "RESUMO DE OCUPAÇÃO");

    // ==========================================
    // ABA 2: MAPA DE CAMAS
    // ==========================================
    const ws2 = {};
    ExcelProGenerator.addCabecalhoObra(ws2, `${obraNome.toUpperCase()} — MAPA DETALHADO DE LEITOS E VAGAS`, `${empresaNome} • Status Individual de Cada Cama dos 220 Quartos • Emissão: ${dataHora}`, 9);
    const h2 = ['Bloco', 'Quarto', 'Cama', 'Status da Vaga', 'Matrícula', 'Colaborador Alojado', 'Empresa', 'Função / Cargo', 'Telefone WhatsApp'];
    h2.forEach((h, col) => ExcelProGenerator.addCell(ws2, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    let r2 = 4;
    quartos.forEach(q => {
      (q.vagas || []).forEach(v => {
        const zebra = r2 % 2 === 1;
        const al = v.alojado || (v.alojado_id ? alojados.find(x => Number(x.id) === Number(v.alojado_id)) : null);
        const isOc = v.status === 'ocupada' && (al || v.nome_completo);
        const statusTexto = isOc ? 'OCUPADA' : 'LIVRE';
        const statusEstilo = isOc ? ExcelProGenerator.estilos.statusOcupada : ExcelProGenerator.estilos.statusLivre;
        const nomeAl = isOc ? (al?.nome_completo || v.nome_completo || 'Colaborador') : 'VAGA LIVRE';
        const matAl = isOc ? (al?.matricula || v.matricula || '-') : '-';
        const empAl = isOc ? (al?.empresa_nome || v.empresa_nome || '-') : '-';
        const funcAl = isOc ? (al?.funcao || v.funcao || '-') : '-';
        const zapAl = isOc && (al?.whatsapp || v.whatsapp) ? formatarTelefoneTexto(al?.whatsapp || v.whatsapp) : '-';

        ExcelProGenerator.addCell(ws2, r2, 0, q.bloco_nome, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
        ExcelProGenerator.addCell(ws2, r2, 1, String(q.numero), { s: ExcelProGenerator.estilos.td(zebra, 'center') });
        ExcelProGenerator.addCell(ws2, r2, 2, v.numero_cama, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
        ExcelProGenerator.addCell(ws2, r2, 3, statusTexto, { s: statusEstilo });
        ExcelProGenerator.addCell(ws2, r2, 4, matAl, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
        ExcelProGenerator.addCell(ws2, r2, 5, nomeAl, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
        ExcelProGenerator.addCell(ws2, r2, 6, empAl, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
        ExcelProGenerator.addCell(ws2, r2, 7, funcAl, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
        ExcelProGenerator.addCell(ws2, r2, 8, zapAl, { s: ExcelProGenerator.estilos.td(zebra, 'center') });

        r2++;
      });
    });

    const totEx2 = r2 + 1;
    ExcelProGenerator.addCell(ws2, r2, 0, 'TOTAL DE LEITOS', { s: ExcelProGenerator.estilos.total('left') });
    ExcelProGenerator.addCell(ws2, r2, 1, '-', { s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws2, r2, 2, r2 - 4, { f: `COUNTA(A5:A${r2})`, s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws2, r2, 3, '880 LEITOS', { s: ExcelProGenerator.estilos.total('center') });
    for (let c = 4; c < 9; c++) {
      ExcelProGenerator.addCell(ws2, r2, c, '-', { s: ExcelProGenerator.estilos.total('center') });
    }

    ws2['!ref'] = `A1:I${totEx2}`;
    ws2['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 34 }, { wch: 22 }, { wch: 24 }, { wch: 18 }];
    ws2['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws2, "MAPA DE CAMAS");

    // ==========================================
    // ABA 3: ALOJADOS ATIVOS
    // ==========================================
    const ws3 = {};
    ExcelProGenerator.addCabecalhoObra(ws3, `${obraNome.toUpperCase()} — LISTAGEM OFICIAL DE ALOJADOS ATIVOS`, `${empresaNome} • Cadastro Completo de Moradores do Canteiro • Emissão: ${dataHora}`, 10);
    const h3 = ['Matrícula', 'Nome Completo', 'Empresa', 'Função / Cargo', 'Telefone WhatsApp', 'Bloco', 'Quarto', 'Cama', 'Data de Entrada', 'Observações'];
    h3.forEach((h, col) => ExcelProGenerator.addCell(ws3, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    alojadosAtivos.forEach((a, idx) => {
      const r = 4 + idx;
      const zebra = idx % 2 === 1;
      const zapFormatado = a.whatsapp ? formatarTelefoneTexto(a.whatsapp) : '-';

      ExcelProGenerator.addCell(ws3, r, 0, a.matricula || '-', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws3, r, 1, a.nome_completo, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws3, r, 2, a.empresa_nome || '-', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws3, r, 3, a.funcao || 'Alojado', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws3, r, 4, zapFormatado, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws3, r, 5, a.bloco_nome || '-', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws3, r, 6, String(a.quarto_numero || '-'), { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws3, r, 7, a.numero_cama || 1, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws3, r, 8, a.data_entrada || '-', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws3, r, 9, a.observacoes || '', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
    });

    const totRow3 = 4 + alojadosAtivos.length;
    const totEx3 = totRow3 + 1;
    ExcelProGenerator.addCell(ws3, totRow3, 0, 'TOTAL ATIVOS', { s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws3, totRow3, 1, alojadosAtivos.length, { f: `COUNTA(B5:B${totRow3})`, s: ExcelProGenerator.estilos.total('left') });
    for (let c = 2; c < 10; c++) {
      ExcelProGenerator.addCell(ws3, totRow3, c, '-', { s: ExcelProGenerator.estilos.total('center') });
    }

    ws3['!ref'] = `A1:J${totEx3}`;
    ws3['!cols'] = [{ wch: 14 }, { wch: 34 }, { wch: 22 }, { wch: 24 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 30 }];
    ws3['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws3, "ALOJADOS ATIVOS");

    // ==========================================
    // ABA 4: MÓVEIS E VISTORIAS
    // ==========================================
    const ws4 = {};
    ExcelProGenerator.addCabecalhoObra(ws4, `${obraNome.toUpperCase()} — INVENTÁRIO DE MÓVEIS & VISTORIAS`, `${empresaNome} • Conservação do Patrimônio e Itens para Reparo • Emissão: ${dataHora}`, 8);
    const h4 = ['Bloco', 'Quarto', 'Item / Móvel', 'Quantidade', 'Estado de Conservação', 'Necessita Manutenção', 'Data da Vistoria', 'Observações'];
    h4.forEach((h, col) => ExcelProGenerator.addCell(ws4, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    let r4 = 4;
    quartos.forEach(q => {
      (q.moveis || []).forEach(m => {
        const zebra = r4 % 2 === 1;
        const alerta = m.precisa_manutencao === 1 || m.estado_conservacao === 'Ruim' || m.estado_conservacao === 'Danificado';
        const statusTexto = alerta ? 'SIM (ALERTA)' : 'NÃO';
        const statusEstilo = alerta ? ExcelProGenerator.estilos.statusAlerta : ExcelProGenerator.estilos.statusLivre;

        ExcelProGenerator.addCell(ws4, r4, 0, q.bloco_nome, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
        ExcelProGenerator.addCell(ws4, r4, 1, String(q.numero), { s: ExcelProGenerator.estilos.td(zebra, 'center') });
        ExcelProGenerator.addCell(ws4, r4, 2, m.tipo_item, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
        ExcelProGenerator.addCell(ws4, r4, 3, m.quantidade || 1, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
        ExcelProGenerator.addCell(ws4, r4, 4, m.estado_conservacao || 'Bom', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
        ExcelProGenerator.addCell(ws4, r4, 5, statusTexto, { s: statusEstilo });
        ExcelProGenerator.addCell(ws4, r4, 6, m.data_vistoria || '-', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
        ExcelProGenerator.addCell(ws4, r4, 7, m.observacoes || '', { s: ExcelProGenerator.estilos.td(zebra, 'left') });

        r4++;
      });
    });

    const totEx4 = r4 + 1;
    ExcelProGenerator.addCell(ws4, r4, 0, 'TOTAL ITENS', { s: ExcelProGenerator.estilos.total('left') });
    ExcelProGenerator.addCell(ws4, r4, 1, '-', { s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws4, r4, 2, `${r4 - 4} registros patrimoniais`, { s: ExcelProGenerator.estilos.total('left') });
    ExcelProGenerator.addCell(ws4, r4, 3, r4 - 4, { f: `SUM(D5:D${r4})`, s: ExcelProGenerator.estilos.total('center') });
    for (let c = 4; c < 8; c++) {
      ExcelProGenerator.addCell(ws4, r4, c, '-', { s: ExcelProGenerator.estilos.total('center') });
    }

    ws4['!ref'] = `A1:H${totEx4}`;
    ws4['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 28 }, { wch: 12 }, { wch: 24 }, { wch: 24 }, { wch: 18 }, { wch: 36 }];
    ws4['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws4, "MÓVEIS E VISTORIAS");

    // ==========================================
    // ABA 5: DISTRIBUIÇÃO POR EMPRESA (COM FÓRMULAS)
    // ==========================================
    const ws5 = {};
    ExcelProGenerator.addCabecalhoObra(ws5, `${obraNome.toUpperCase()} — OCUPAÇÃO POR EMPRESA PARCEIRA`, `${empresaNome} • Participação de Cada Contratada no Total de Leitos • Emissão: ${dataHora}`, 4);
    const h5 = ['Empresa Parceira', 'Total Alojados', '% Participação na Obra (Fórmula)', 'Situação'];
    h5.forEach((h, col) => ExcelProGenerator.addCell(ws5, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    const totAtivosOficial = alojadosAtivos.length || 387;

    empresas.forEach((emp, idx) => {
      const r = 4 + idx;
      const zebra = idx % 2 === 1;
      const rowEx = r + 1;
      const qtdEmp = alojadosAtivos.filter(a => Number(a.empresa_id) === Number(emp.id)).length;
      const part = totAtivosOficial > 0 ? (qtdEmp / totAtivosOficial) : 0;

      ExcelProGenerator.addCell(ws5, r, 0, emp.nome, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws5, r, 1, qtdEmp, { s: ExcelProGenerator.estilos.td(zebra, 'right') });
      ExcelProGenerator.addCell(ws5, r, 2, part, { f: `B${rowEx}/$B$${4 + empresas.length + 1}`, z: '0.0%', s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws5, r, 3, 'PARCEIRA ATIVA', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
    });

    const totRow5 = 4 + empresas.length;
    const totEx5 = totRow5 + 1;
    ExcelProGenerator.addCell(ws5, totRow5, 0, 'TOTAL GERAL DA OBRA', { s: ExcelProGenerator.estilos.total('left') });
    ExcelProGenerator.addCell(ws5, totRow5, 1, totAtivosOficial, { f: `SUM(B5:B${totRow5})`, s: ExcelProGenerator.estilos.total('right') });
    ExcelProGenerator.addCell(ws5, totRow5, 2, 1.0, { f: `SUM(C5:C${totRow5})`, z: '0.0%', s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws5, totRow5, 3, '100% REGISTRADO', { s: ExcelProGenerator.estilos.total('center') });

    ws5['!ref'] = `A1:D${totEx5}`;
    ws5['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 32 }, { wch: 20 }];
    ws5['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws5, "DISTRIBUIÇÃO POR EMPRESA");

    // Gerar e salvar arquivo XLSX oficial
    XLSX.writeFile(wb, "controle_alojamento_oficial_taboca2.xlsx");
    showToast('📗 Planilha Oficial baixada com sucesso (5 abas completas com fórmulas)!', 'success');
    return;
  }
  showToast('📗 Gerando Planilha Oficial Taboca 2...', 'info');
  window.open(`${API_BASE}/api/relatorios/exportar-planilha-oficial`, '_blank');
}

// ========================================================
// RELATÓRIOS & EXPORTAÇÕES EXCEL PARA CASAS NA CIDADE
// ========================================================

function exportarCasasCidadeExcel() {
  if (typeof XLSX !== 'undefined') {
    showToast('🏙️ Gerando Relatório de Casas na Cidade em Excel...', 'info');
    const wb = XLSX.utils.book_new();
    const dataHora = new Date().toLocaleString('pt-BR');
    const empresaNome = localStorage.getItem('appCustomEmpresaNome') || 'GEL - Construtora';
    const obraNome = localStorage.getItem('appCustomObraNome') || 'Canteiro Taboca 2';

    // 1. ABA RESUMO DAS CASAS
    const ws1 = {};
    ExcelProGenerator.addCabecalhoObra(ws1, `${obraNome.toUpperCase()} — CASAS URBANAS NA CIDADE (LIDERANÇA & ENGENHARIA)`, `${empresaNome} • Ocupação e Capacidade dos Imóveis Alugados • Emissão: ${dataHora}`, 10);
    const headers1 = ['Identificação da Casa', 'Endereço Completo', 'Bairro / Região', 'Responsável do Imóvel', 'Telefone Contato', 'Total Cômodos', 'Capacidade (Camas)', 'Camas Ocupadas', 'Camas Livres (Fórmula)', 'Taxa de Ocupação (Fórmula)'];
    headers1.forEach((h, col) => ExcelProGenerator.addCell(ws1, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    let totCapacidade = 0;
    let totOcupadas = 0;

    listaCasasCidade.forEach((c, idx) => {
      const r = 4 + idx;
      const zebra = idx % 2 === 1;
      const rowEx = r + 1;

      let comodosQtd = (c.comodos || []).length;
      let camas = 0;
      let ocup = 0;
      (c.comodos || []).forEach(com => {
        if (com.tipo === 'quarto') {
          camas += Number(com.capacidade_camas || 0);
          ocup += (com.camas || []).filter(cm => cm.morador && cm.morador.nome).length;
        }
      });
      totCapacidade += camas;
      totOcupadas += ocup;
      const livres = Math.max(0, camas - ocup);
      const taxa = camas > 0 ? (ocup / camas) : 0;

      ExcelProGenerator.addCell(ws1, r, 0, c.nome || 'Casa', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws1, r, 1, c.endereco || '-', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws1, r, 2, c.bairro || '-', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws1, r, 3, c.responsavel || '-', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws1, r, 4, c.telefone_responsavel ? (typeof formatarTelefoneTexto === 'function' ? formatarTelefoneTexto(c.telefone_responsavel) : c.telefone_responsavel) : '-', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws1, r, 5, comodosQtd, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws1, r, 6, camas, { s: ExcelProGenerator.estilos.td(zebra, 'right') });
      ExcelProGenerator.addCell(ws1, r, 7, ocup, { s: ExcelProGenerator.estilos.td(zebra, 'right') });
      ExcelProGenerator.addCell(ws1, r, 8, livres, { f: `G${rowEx}-H${rowEx}`, s: ExcelProGenerator.estilos.td(zebra, 'right') });
      ExcelProGenerator.addCell(ws1, r, 9, taxa, { f: `IF(G${rowEx}>0,H${rowEx}/G${rowEx},0)`, z: '0.0%', s: ExcelProGenerator.estilos.td(zebra, 'center') });
    });

    const totRow1 = 4 + listaCasasCidade.length;
    const totEx1 = totRow1 + 1;
    const firstRow1 = 5;
    const lastRow1 = totRow1;
    ExcelProGenerator.addCell(ws1, totRow1, 0, 'TOTAL GERAL CASAS', { s: ExcelProGenerator.estilos.total('left') });
    ExcelProGenerator.addCell(ws1, totRow1, 1, `${listaCasasCidade.length} imóveis`, { s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws1, totRow1, 2, '-', { s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws1, totRow1, 3, '-', { s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws1, totRow1, 4, '-', { s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws1, totRow1, 5, '-', { s: ExcelProGenerator.estilos.total('center') });

    if (listaCasasCidade.length > 0) {
      ExcelProGenerator.addCell(ws1, totRow1, 6, totCapacidade, { f: `SUM(G${firstRow1}:G${lastRow1})`, s: ExcelProGenerator.estilos.total('right') });
      ExcelProGenerator.addCell(ws1, totRow1, 7, totOcupadas, { f: `SUM(H${firstRow1}:H${lastRow1})`, s: ExcelProGenerator.estilos.total('right') });
      ExcelProGenerator.addCell(ws1, totRow1, 8, Math.max(0, totCapacidade - totOcupadas), { f: `G${totEx1}-H${totEx1}`, s: ExcelProGenerator.estilos.total('right') });
      ExcelProGenerator.addCell(ws1, totRow1, 9, totCapacidade > 0 ? (totOcupadas / totCapacidade) : 0, { f: `IF(G${totEx1}>0,H${totEx1}/G${totEx1},0)`, z: '0.0%', s: ExcelProGenerator.estilos.total('center') });
    } else {
      ExcelProGenerator.addCell(ws1, totRow1, 6, 0, { s: ExcelProGenerator.estilos.total('right') });
      ExcelProGenerator.addCell(ws1, totRow1, 7, 0, { s: ExcelProGenerator.estilos.total('right') });
      ExcelProGenerator.addCell(ws1, totRow1, 8, 0, { s: ExcelProGenerator.estilos.total('right') });
      ExcelProGenerator.addCell(ws1, totRow1, 9, 0, { z: '0.0%', s: ExcelProGenerator.estilos.total('center') });
    }

    ws1['!ref'] = `A1:J${totEx1}`;
    ws1['!cols'] = [{ wch: 25 }, { wch: 32 }, { wch: 20 }, { wch: 25 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 24 }];
    ws1['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws1, "RESUMO CASAS");

    // 2. ABA MORADORES DAS CASAS
    const ws2 = {};
    ExcelProGenerator.addCabecalhoObra(ws2, `${obraNome.toUpperCase()} — MORADORES ALOJADOS NAS CASAS URBANAS`, `${empresaNome} • Engenheiros, Mestres e Liderança Alocada • Emissão: ${dataHora}`, 8);
    const headers2 = ['Casa / Imóvel', 'Cômodo / Quarto', 'Cama Nº', 'Nome do Morador', 'Matrícula', 'Função / Cargo', 'Telefone / WhatsApp', 'Observações'];
    headers2.forEach((h, col) => ExcelProGenerator.addCell(ws2, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    const moradoresList = [];
    listaCasasCidade.forEach(c => {
      (c.comodos || []).forEach(com => {
        (com.camas || []).forEach(cm => {
          if (cm.morador && cm.morador.nome) {
            moradoresList.push({
              casa: c.nome,
              comodo: com.nome,
              cama: cm.numero,
              nome: cm.morador.nome,
              matricula: cm.morador.matricula || '-',
              funcao: cm.morador.funcao || 'Liderança',
              telefone: cm.morador.telefone || cm.morador.whatsapp || '-',
              obs: cm.morador.observacoes || ''
            });
          }
        });
      });
    });

    moradoresList.forEach((m, idx) => {
      const r = 4 + idx;
      const zebra = idx % 2 === 1;
      ExcelProGenerator.addCell(ws2, r, 0, m.casa, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws2, r, 1, m.comodo, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws2, r, 2, m.cama, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws2, r, 3, m.nome, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws2, r, 4, m.matricula, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws2, r, 5, m.funcao, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws2, r, 6, m.telefone, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws2, r, 7, m.obs, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
    });

    const totRow2 = 4 + moradoresList.length;
    const totEx2 = totRow2 + 1;
    ExcelProGenerator.addCell(ws2, totRow2, 0, 'TOTAL DE MORADORES', { s: ExcelProGenerator.estilos.total('left') });
    ExcelProGenerator.addCell(ws2, totRow2, 1, `${moradoresList.length} pessoas`, { s: ExcelProGenerator.estilos.total('center') });
    for (let col = 2; col < 8; col++) {
      ExcelProGenerator.addCell(ws2, totRow2, col, '-', { s: ExcelProGenerator.estilos.total('center') });
    }

    ws2['!ref'] = `A1:H${totEx2}`;
    ws2['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 10 }, { wch: 34 }, { wch: 16 }, { wch: 22 }, { wch: 20 }, { wch: 30 }];
    ws2['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws2, "MORADORES DAS CASAS");

    // 3. ABA INVENTÁRIO PATRIMONIAL
    const ws3 = {};
    ExcelProGenerator.addCabecalhoObra(ws3, `${obraNome.toUpperCase()} — INVENTÁRIO DE MÓVEIS DAS CASAS URBANAS`, `${empresaNome} • Bens Patrimoniais e Estado de Conservação • Emissão: ${dataHora}`, 7);
    const headers3 = ['Casa / Imóvel', 'Cômodo / Ambiente', 'Móvel / Equipamento', 'Quantidade', 'Estado de Conservação', 'Necessita Manutenção', 'Última Vistoria'];
    headers3.forEach((h, col) => ExcelProGenerator.addCell(ws3, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    const moveisList = [];
    listaCasasCidade.forEach(c => {
      (c.comodos || []).forEach(com => {
        (com.moveis || []).forEach(mv => {
          moveisList.push({
            casa: c.nome,
            comodo: com.nome,
            nome: mv.tipo || mv.nome || mv.tipo_item || 'Móvel',
            qtd: mv.quantidade || 1,
            estado: mv.estado_conservacao || mv.estado || 'Bom',
            manut: (mv.precisa_manutencao || mv.manutencao) ? 'SIM (ALERTA)' : 'NÃO',
            vistoria: mv.data_vistoria || (mv.patrimonio ? `Patr: ${mv.patrimonio}` : '-')
          });
        });
      });
    });

    moveisList.forEach((mv, idx) => {
      const r = 4 + idx;
      const zebra = idx % 2 === 1;
      ExcelProGenerator.addCell(ws3, r, 0, mv.casa, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws3, r, 1, mv.comodo, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws3, r, 2, mv.nome, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws3, r, 3, mv.qtd, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws3, r, 4, mv.estado, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws3, r, 5, mv.manut, { s: mv.manut.includes('SIM') ? ExcelProGenerator.estilos.statusAlerta : ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws3, r, 6, mv.vistoria, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
    });

    const totRow3 = 4 + moveisList.length;
    const totEx3 = totRow3 + 1;
    ExcelProGenerator.addCell(ws3, totRow3, 0, 'TOTAL BENS MAPEADOS', { s: ExcelProGenerator.estilos.total('left') });
    ExcelProGenerator.addCell(ws3, totRow3, 1, `${moveisList.length} itens`, { s: ExcelProGenerator.estilos.total('center') });
    for (let col = 2; col < 7; col++) {
      ExcelProGenerator.addCell(ws3, totRow3, col, '-', { s: ExcelProGenerator.estilos.total('center') });
    }

    ws3['!ref'] = `A1:G${totEx3}`;
    ws3['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 28 }, { wch: 12 }, { wch: 22 }, { wch: 22 }, { wch: 18 }];
    ws3['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws3, "INVENTARIO BENS");

    const dataArquivo = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `casas_urbanas_ocupacao_${dataArquivo}.xlsx`);
    showToast('Planilha de Casas na Cidade baixada com sucesso!', 'success');
    return;
  }
  showToast('Biblioteca SheetJS (XLSX) não carregada.', 'error');
}

function exportarLimpezasExcel() {
  if (typeof XLSX !== 'undefined') {
    showToast('🧹 Gerando Relatório de Limpezas em Excel...', 'info');
    const wb = XLSX.utils.book_new();
    const dataHora = new Date().toLocaleString('pt-BR');
    const empresaNome = localStorage.getItem('appCustomEmpresaNome') || 'GEL - Construtora';
    const obraNome = localStorage.getItem('appCustomObraNome') || 'Canteiro Taboca 2';

    // 1. ABA HISTÓRICO DE LIMPEZAS
    const ws1 = {};
    ExcelProGenerator.addCabecalhoObra(ws1, `${obraNome.toUpperCase()} — HISTÓRICO DE LIMPEZAS E VISTORIAS DAS CASAS`, `${empresaNome} • Registros de Manutenções e Higienização QR Code • Emissão: ${dataHora}`, 7);
    const headers1 = ['Data do Registro', 'Horário', 'Casa / Imóvel', 'Tipo de Serviço', 'Responsável pela Execução', 'Status', 'Observações'];
    headers1.forEach((h, col) => ExcelProGenerator.addCell(ws1, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    const limpezas = [...listaLimpezasCasas];
    limpezas.forEach((l, idx) => {
      const r = 4 + idx;
      const zebra = idx % 2 === 1;
      const casa = listaCasasCidade.find(c => c.id === l.casa_id);
      const casaNome = l.casa_nome || (casa ? casa.nome : 'Casa Urbana');
      const tipoLabel = l.tipo === 'rotina' ? 'Rotina Diária' : l.tipo === 'ar_condicionado' ? 'Limpeza de Ar-Condicionado' : (l.tipo || 'Limpeza Geral');
      const dataFormatada = l.data ? (l.data.includes('-') ? l.data.split('-').reverse().join('/') : l.data) : '--/--/----';

      ExcelProGenerator.addCell(ws1, r, 0, dataFormatada, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws1, r, 1, l.hora || '--:--', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws1, r, 2, casaNome, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws1, r, 3, tipoLabel, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws1, r, 4, l.responsavel || 'Equipe de Limpeza', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws1, r, 5, (l.status || 'CONCLUÍDO').toUpperCase(), { s: ExcelProGenerator.estilos.statusLivre });
      ExcelProGenerator.addCell(ws1, r, 6, l.observacoes || '-', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
    });

    const totRow1 = 4 + limpezas.length;
    const totEx1 = totRow1 + 1;
    ExcelProGenerator.addCell(ws1, totRow1, 0, 'TOTAL DE LIMPEZAS', { s: ExcelProGenerator.estilos.total('left') });
    ExcelProGenerator.addCell(ws1, totRow1, 1, `${limpezas.length} registros`, { s: ExcelProGenerator.estilos.total('center') });
    for (let c = 2; c < 7; c++) {
      ExcelProGenerator.addCell(ws1, totRow1, c, '-', { s: ExcelProGenerator.estilos.total('center') });
    }

    ws1['!ref'] = `A1:G${totEx1}`;
    ws1['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 28 }, { wch: 28 }, { wch: 25 }, { wch: 16 }, { wch: 35 }];
    ws1['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws1, "HISTORICO LIMPEZAS");

    // 2. ABA CICLO PREVENTIVO DE AR CONDICIONADO (30 DIAS)
    const ws2 = {};
    ExcelProGenerator.addCabecalhoObra(ws2, `${obraNome.toUpperCase()} — CONTROLE PREVENTIVO DE AR-CONDICIONADO (CICLO 30 DIAS)`, `${empresaNome} • Monitoramento do Prazo de Limpeza dos Filtros de Climatização • Emissão: ${dataHora}`, 6);
    const headers2 = ['Casa / Imóvel', 'Qtd Cômodos', 'Última Limpeza Realizada', 'Dias Decorridos', 'Prazo Restante (Fórmula)', 'Status do Ciclo'];
    headers2.forEach((h, col) => ExcelProGenerator.addCell(ws2, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    listaCasasCidade.forEach((c, idx) => {
      const r = 4 + idx;
      const zebra = idx % 2 === 1;
      const rowEx = r + 1;

      // Buscar última limpeza de ar-condicionado desta casa
      const limpsAr = limpezas.filter(l => l.casa_id === c.id && l.tipo === 'ar_condicionado');
      limpsAr.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
      const ultAr = limpsAr[0];

      let dias = 45;
      let dataUlt = 'NUNCA REGISTRADO';
      if (ultAr && ultAr.data) {
        dataUlt = ultAr.data.includes('-') ? ultAr.data.split('-').reverse().join('/') : ultAr.data;
        const diffMs = Date.now() - new Date(ultAr.data + 'T12:00:00').getTime();
        dias = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      }

      let stText = 'OK (REGULAR)';
      let stStyle = ExcelProGenerator.estilos.statusLivre;
      if (dias > 30) {
        stText = 'VENCIDO (URGENTE)';
        stStyle = ExcelProGenerator.estilos.statusAlerta;
      } else if (dias >= 25) {
        stText = 'ATENÇÃO (VENCE EM BREVE)';
        stStyle = ExcelProGenerator.estilos.td(zebra, 'center');
      }

      ExcelProGenerator.addCell(ws2, r, 0, c.nome, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws2, r, 1, (c.comodos || []).length, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws2, r, 2, dataUlt, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws2, r, 3, dias, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws2, r, 4, 30 - dias, { f: `30-D${rowEx}`, s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws2, r, 5, stText, { s: stStyle });
    });

    const totRow2 = 4 + listaCasasCidade.length;
    const totEx2 = totRow2 + 1;
    ExcelProGenerator.addCell(ws2, totRow2, 0, 'TOTAL DE CASAS MONITORADAS', { s: ExcelProGenerator.estilos.total('left') });
    ExcelProGenerator.addCell(ws2, totRow2, 1, `${listaCasasCidade.length} imóveis`, { s: ExcelProGenerator.estilos.total('center') });
    for (let c = 2; c < 6; c++) {
      ExcelProGenerator.addCell(ws2, totRow2, c, '-', { s: ExcelProGenerator.estilos.total('center') });
    }

    ws2['!ref'] = `A1:F${totEx2}`;
    ws2['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 22 }, { wch: 26 }];
    ws2['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws2, "CICLO AR CONDICIONADO");

    const dataArquivo = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `relatorio_limpezas_casas_${dataArquivo}.xlsx`);
    showToast('Planilha de limpezas baixada com sucesso!', 'success');
    return;
  }
  showToast('Biblioteca SheetJS (XLSX) não carregada.', 'error');
}

function exportarDespesasCasasExcel() {
  if (typeof XLSX !== 'undefined') {
    showToast('💵 Gerando Relatório Consolidado de Contas em Excel...', 'info');
    const wb = XLSX.utils.book_new();
    const dataHora = new Date().toLocaleString('pt-BR');
    const empresaNome = localStorage.getItem('appCustomEmpresaNome') || 'GEL - Construtora';
    const obraNome = localStorage.getItem('appCustomObraNome') || 'Canteiro Taboca 2';

    // 1. ABA CONTAS E DESPESAS
    const ws1 = {};
    ExcelProGenerator.addCabecalhoObra(ws1, `${obraNome.toUpperCase()} — CONTAS & DESPESAS CONSOLIDADAS DAS CASAS`, `${empresaNome} • Controle de Energia, Água, Aluguel e Internet • Emissão: ${dataHora}`, 8);
    const headers1 = ['Casa / Imóvel', 'Tipo de Despesa', 'Descrição / Detalhes', 'Mês Ref.', 'Data de Vencimento', 'Valor da Conta (R$)', 'Status', 'Data de Pagamento'];
    headers1.forEach((h, col) => ExcelProGenerator.addCell(ws1, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    const despesas = [...listaDespesasCasas];
    let totValor = 0;

    despesas.forEach((d, idx) => {
      const r = 4 + idx;
      const zebra = idx % 2 === 1;
      const ehPago = d.status === 'pago';
      const casa = listaCasasCidade.find(c => c.id === d.casa_id);
      const casaNome = d.casa_nome || (casa ? casa.nome : 'Casa Urbana');
      const vencFormatado = d.vencimento ? (d.vencimento.includes('-') ? d.vencimento.split('-').reverse().join('/') : d.vencimento) : '--/--/----';
      const valorNum = Number(d.valor) || 0;
      totValor += valorNum;

      ExcelProGenerator.addCell(ws1, r, 0, casaNome, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws1, r, 1, d.categoria || 'Despesa', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws1, r, 2, d.observacoes || '-', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws1, r, 3, d.mes_referencia || '-', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws1, r, 4, vencFormatado, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws1, r, 5, valorNum, { z: 'R$ #,##0.00', s: ExcelProGenerator.estilos.td(zebra, 'right') });
      ExcelProGenerator.addCell(ws1, r, 6, ehPago ? 'PAGO' : 'PENDENTE', { s: ehPago ? ExcelProGenerator.estilos.statusLivre : ExcelProGenerator.estilos.statusAlerta });
      ExcelProGenerator.addCell(ws1, r, 7, d.data_pagamento || (ehPago ? 'CONFIRMADO' : '-'), { s: ExcelProGenerator.estilos.td(zebra, 'center') });
    });

    const totRow1 = 4 + despesas.length;
    const totEx1 = totRow1 + 1;
    const firstRow1 = 5;
    const lastRow1 = totRow1;
    ExcelProGenerator.addCell(ws1, totRow1, 0, 'TOTAL GERAL DAS CONTAS', { s: ExcelProGenerator.estilos.total('left') });
    ExcelProGenerator.addCell(ws1, totRow1, 1, `${despesas.length} lançamentos`, { s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws1, totRow1, 2, '-', { s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws1, totRow1, 3, '-', { s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws1, totRow1, 4, '-', { s: ExcelProGenerator.estilos.total('center') });
    if (despesas.length > 0) {
      ExcelProGenerator.addCell(ws1, totRow1, 5, totValor, { f: `SUM(F${firstRow1}:F${lastRow1})`, z: 'R$ #,##0.00', s: ExcelProGenerator.estilos.total('right') });
    } else {
      ExcelProGenerator.addCell(ws1, totRow1, 5, 0, { z: 'R$ #,##0.00', s: ExcelProGenerator.estilos.total('right') });
    }
    ExcelProGenerator.addCell(ws1, totRow1, 6, '-', { s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws1, totRow1, 7, '-', { s: ExcelProGenerator.estilos.total('center') });

    ws1['!ref'] = `A1:H${totEx1}`;
    ws1['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 30 }, { wch: 14 }, { wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 20 }];
    ws1['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws1, "CONTAS E DESPESAS");

    // 2. ABA RESUMO POR CASA
    const ws2 = {};
    ExcelProGenerator.addCabecalhoObra(ws2, `${obraNome.toUpperCase()} — CONSOLIDADO DE GASTOS POR IMÓVEL`, `${empresaNome} • Totalização de Contas Pagas e Pendentes por Casa • Emissão: ${dataHora}`, 6);
    const headers2 = ['Casa / Imóvel', 'Total Lançamentos', 'Total Pago (R$)', 'Total Pendente (R$)', 'Total Geral (Fórmula)', '% Quitado (Fórmula)'];
    headers2.forEach((h, col) => ExcelProGenerator.addCell(ws2, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    listaCasasCidade.forEach((c, idx) => {
      const r = 4 + idx;
      const zebra = idx % 2 === 1;
      const rowEx = r + 1;
      const despsCasa = despesas.filter(d => d.casa_id === c.id);
      const pago = despsCasa.filter(d => d.status === 'pago').reduce((a, b) => a + (Number(b.valor) || 0), 0);
      const pend = despsCasa.filter(d => d.status !== 'pago').reduce((a, b) => a + (Number(b.valor) || 0), 0);
      const totCasa = pago + pend;
      const pct = totCasa > 0 ? (pago / totCasa) : 0;

      ExcelProGenerator.addCell(ws2, r, 0, c.nome, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws2, r, 1, despsCasa.length, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws2, r, 2, pago, { z: 'R$ #,##0.00', s: ExcelProGenerator.estilos.td(zebra, 'right') });
      ExcelProGenerator.addCell(ws2, r, 3, pend, { z: 'R$ #,##0.00', s: ExcelProGenerator.estilos.td(zebra, 'right') });
      ExcelProGenerator.addCell(ws2, r, 4, totCasa, { f: `C${rowEx}+D${rowEx}`, z: 'R$ #,##0.00', s: ExcelProGenerator.estilos.td(zebra, 'right') });
      ExcelProGenerator.addCell(ws2, r, 5, pct, { f: `IF(E${rowEx}>0,C${rowEx}/E${rowEx},0)`, z: '0.0%', s: ExcelProGenerator.estilos.td(zebra, 'center') });
    });

    const totRow2 = 4 + listaCasasCidade.length;
    const totEx2 = totRow2 + 1;
    const firstRow2 = 5;
    const lastRow2 = totRow2;
    ExcelProGenerator.addCell(ws2, totRow2, 0, 'TOTAL GERAL', { s: ExcelProGenerator.estilos.total('left') });
    if (listaCasasCidade.length > 0) {
      ExcelProGenerator.addCell(ws2, totRow2, 1, despesas.length, { f: `SUM(B${firstRow2}:B${lastRow2})`, s: ExcelProGenerator.estilos.total('center') });
      ExcelProGenerator.addCell(ws2, totRow2, 2, despesas.filter(d => d.status === 'pago').reduce((a, b) => a + (Number(b.valor) || 0), 0), { f: `SUM(C${firstRow2}:C${lastRow2})`, z: 'R$ #,##0.00', s: ExcelProGenerator.estilos.total('right') });
      ExcelProGenerator.addCell(ws2, totRow2, 3, despesas.filter(d => d.status !== 'pago').reduce((a, b) => a + (Number(b.valor) || 0), 0), { f: `SUM(D${firstRow2}:D${lastRow2})`, z: 'R$ #,##0.00', s: ExcelProGenerator.estilos.total('right') });
      ExcelProGenerator.addCell(ws2, totRow2, 4, totValor, { f: `C${totEx2}+D${totEx2}`, z: 'R$ #,##0.00', s: ExcelProGenerator.estilos.total('right') });
      ExcelProGenerator.addCell(ws2, totRow2, 5, totValor > 0 ? (despesas.filter(d => d.status === 'pago').reduce((a, b) => a + (Number(b.valor) || 0), 0) / totValor) : 0, { f: `IF(E${totEx2}>0,C${totEx2}/E${totEx2},0)`, z: '0.0%', s: ExcelProGenerator.estilos.total('center') });
    } else {
      ExcelProGenerator.addCell(ws2, totRow2, 1, 0, { s: ExcelProGenerator.estilos.total('center') });
      ExcelProGenerator.addCell(ws2, totRow2, 2, 0, { z: 'R$ #,##0.00', s: ExcelProGenerator.estilos.total('right') });
      ExcelProGenerator.addCell(ws2, totRow2, 3, 0, { z: 'R$ #,##0.00', s: ExcelProGenerator.estilos.total('right') });
      ExcelProGenerator.addCell(ws2, totRow2, 4, 0, { z: 'R$ #,##0.00', s: ExcelProGenerator.estilos.total('right') });
      ExcelProGenerator.addCell(ws2, totRow2, 5, 0, { z: '0.0%', s: ExcelProGenerator.estilos.total('center') });
    }

    ws2['!ref'] = `A1:F${totEx2}`;
    ws2['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 22 }, { wch: 18 }];
    ws2['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws2, "CONSOLIDADO POR CASA");

    const dataArquivo = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `despesas_contas_casas_${dataArquivo}.xlsx`);
    showToast('Planilha de despesas consolidada baixada com sucesso!', 'success');
    return;
  }
  showToast('Biblioteca SheetJS (XLSX) não carregada.', 'error');
}

// ========================================================
// TERMO DE RESPONSABILIDADE & FICHA DE ACOMODAÇÃO (A4)
// ========================================================

function preencherItensTermoResponsabilidade(itens) {
  const tbody = document.getElementById('termoTabelaItensCorpo');
  if (!tbody) return;

  let listaFinal = [];
  if (Array.isArray(itens) && itens.length > 0) {
    listaFinal = itens;
  } else {
    listaFinal = [
      { item: 'Cama individual metálica / Beliche', qtd: 1, estado: 'Bom / Em perfeitas condições', check: '[ X ] Recebido em ordem' },
      { item: 'Colchão Densidade D33 c/ Capa Protetora', qtd: 1, estado: 'Novo / Higienizado', check: '[ X ] Recebido em ordem' },
      { item: 'Travesseiro e Roupa de Cama', qtd: 1, estado: 'Limpo e lacrado', check: '[ X ] Recebido em ordem' },
      { item: 'Armário / Guarda-roupa c/ Fecho', qtd: 1, estado: 'Bom estado', check: '[ X ] Recebido em ordem' },
      { item: 'Chaves de Acesso à Acomodação', qtd: 1, estado: 'Funcional', check: '[ X ] Recebido em ordem' },
      { item: 'Ar-Condicionado / Climatizador', qtd: 1, estado: 'Operacional / Filtro Limpo', check: '[ X ] Conferido' }
    ];
  }

  tbody.innerHTML = listaFinal.map(i => `
    <tr>
      <td class="py-1 px-2 font-medium">${i.item || i.tipo || i.tipo_item || i.nome || 'Item'}</td>
      <td class="py-1 px-2 text-center">${i.qtd || i.quantidade || 1}</td>
      <td class="py-1 px-2">${i.estado || i.estado_conservacao || 'Bom / Operacional'}</td>
      <td class="py-1 px-2 font-bold text-emerald-700">${i.check || '[ X ] Conferido e Aceito'}</td>
    </tr>
  `).join('');
}

function abrirModalTermoResponsabilidadeGenerico() {
  const obraNome = localStorage.getItem('appCustomObraNome') || 'Taboca 2';
  const elObra = document.getElementById('termoCabecalhoObra');
  if (elObra) elObra.textContent = obraNome;
  const elData = document.getElementById('termoDataEmissao');
  if (elData) elData.textContent = new Date().toLocaleDateString('pt-BR');
  const elNome = document.getElementById('termoMoradorNome');
  if (elNome) elNome.textContent = 'COLABORADOR DA OBRA';
  const elMat = document.getElementById('termoMoradorMatricula');
  if (elMat) elMat.textContent = 'REG-0000';
  const elEmp = document.getElementById('termoMoradorEmpresa');
  if (elEmp) elEmp.textContent = localStorage.getItem('appCustomEmpresaNome') || 'GEL • Goetze Lobato Eng. S.A.';
  const elFunc = document.getElementById('termoMoradorFuncao');
  if (elFunc) elFunc.textContent = 'Colaborador';
  const elTel = document.getElementById('termoMoradorTelefone');
  if (elTel) elTel.textContent = '--';
  const elEnt = document.getElementById('termoDataEntrada');
  if (elEnt) elEnt.textContent = new Date().toLocaleDateString('pt-BR');
  const elTipo = document.getElementById('termoTipoLocal');
  if (elTipo) elTipo.textContent = 'Alojamento Canteiro / Casa Urbana';
  const elBloco = document.getElementById('termoBlocoOuCasa');
  if (elBloco) elBloco.textContent = 'Bloco / Casa Padrão';
  const elQuarto = document.getElementById('termoQuartoOuComodo');
  if (elQuarto) elQuarto.textContent = 'Quarto / Cômodo';
  const elCama = document.getElementById('termoCamaNumero');
  if (elCama) elCama.textContent = 'Leito 1';
  const elAss = document.getElementById('termoAssinaturaMorador');
  if (elAss) elAss.textContent = 'Assinatura do Colaborador';
  const elDoc = document.getElementById('termoDocMorador');
  if (elDoc) elDoc.textContent = 'CPF / Matrícula';

  preencherItensTermoResponsabilidade(null);
  abrirModal('modalTermoResponsabilidade');
}

function gerarTermoResponsabilidadeAlojado(alojadoId) {
  const alojados = (window.StaticApiEngine && window.StaticApiEngine.dbState && window.StaticApiEngine.dbState.alojados) || [];
  const a = alojados.find(x => String(x.id) === String(alojadoId));
  if (!a) {
    showToast('Colaborador não encontrado.', 'error');
    return;
  }

  const obraNome = localStorage.getItem('appCustomObraNome') || 'Taboca 2';
  const elObra = document.getElementById('termoCabecalhoObra');
  if (elObra) elObra.textContent = obraNome;
  const elData = document.getElementById('termoDataEmissao');
  if (elData) elData.textContent = new Date().toLocaleDateString('pt-BR');
  const elNome = document.getElementById('termoMoradorNome');
  if (elNome) elNome.textContent = a.nome_completo || a.nome || '--';
  const elMat = document.getElementById('termoMoradorMatricula');
  if (elMat) elMat.textContent = a.matricula || '--';
  const elEmp = document.getElementById('termoMoradorEmpresa');
  if (elEmp) elEmp.textContent = a.empresa_nome || 'GEL • Goetze Lobato';
  const elFunc = document.getElementById('termoMoradorFuncao');
  if (elFunc) elFunc.textContent = a.funcao || 'Colaborador';
  const elTel = document.getElementById('termoMoradorTelefone');
  if (elTel) elTel.textContent = a.whatsapp ? (typeof formatarTelefoneTexto === 'function' ? formatarTelefoneTexto(a.whatsapp) : a.whatsapp) : '--';
  const elEnt = document.getElementById('termoDataEntrada');
  if (elEnt) elEnt.textContent = a.data_entrada ? (a.data_entrada.includes('-') ? a.data_entrada.split('-').reverse().join('/') : a.data_entrada) : new Date().toLocaleDateString('pt-BR');
  const elTipo = document.getElementById('termoTipoLocal');
  if (elTipo) elTipo.textContent = 'Alojamento Canteiro';
  const elBloco = document.getElementById('termoBlocoOuCasa');
  if (elBloco) elBloco.textContent = a.bloco_nome || 'Bloco Alojamento';
  const elQuarto = document.getElementById('termoQuartoOuComodo');
  if (elQuarto) elQuarto.textContent = `Quarto ${a.quarto_numero || '--'}`;
  const elCama = document.getElementById('termoCamaNumero');
  if (elCama) elCama.textContent = `Cama / Leito ${a.numero_cama || 1}`;
  const elAss = document.getElementById('termoAssinaturaMorador');
  if (elAss) elAss.textContent = a.nome_completo || 'Colaborador';
  const elDoc = document.getElementById('termoDocMorador');
  if (elDoc) elDoc.textContent = `Matrícula: ${a.matricula || '--'}`;

  // Se houver móveis no quarto correspondente, incorporar ao inventário
  let itensAlojamento = null;
  const quartos = (window.StaticApiEngine && window.StaticApiEngine.dbState && window.StaticApiEngine.dbState.quartos) || [];
  const q = quartos.find(quarto => String(quarto.numero) === String(a.quarto_numero) && (!a.bloco_id || String(quarto.bloco_id) === String(a.bloco_id)));
  if (q && q.moveis && q.moveis.length > 0) {
    itensAlojamento = [
      { item: `Cama / Leito ${a.numero_cama || 1}`, qtd: 1, estado: 'Bom estado', check: '[ X ] Entregue' },
      { item: 'Colchão Densidade D33 c/ Capa', qtd: 1, estado: 'Higienizado', check: '[ X ] Entregue' },
      ...q.moveis.map(m => ({
        item: m.tipo_item || m.tipo || m.nome || 'Móvel Quarto',
        qtd: m.quantidade || 1,
        estado: m.estado_conservacao || 'Bom',
        check: '[ X ] Conferido'
      })),
      { item: 'Chaves de Acesso ao Quarto', qtd: 1, estado: 'Funcional', check: '[ X ] Entregue' }
    ];
  }
  preencherItensTermoResponsabilidade(itensAlojamento);

  abrirModal('modalTermoResponsabilidade');
}

function gerarTermoResponsabilidadeMoradorCasa(casaId, comodoId, camaNum, moradorNome) {
  const casa = listaCasasCidade.find(c => c.id === casaId);
  const obraNome = localStorage.getItem('appCustomObraNome') || 'Taboca 2';
  const elObra = document.getElementById('termoCabecalhoObra');
  if (elObra) elObra.textContent = obraNome;
  const elData = document.getElementById('termoDataEmissao');
  if (elData) elData.textContent = new Date().toLocaleDateString('pt-BR');

  let comodoNome = 'Quarto';
  let morador = null;
  let comodoObj = null;

  if (casa) {
    comodoObj = (casa.comodos || []).find(x => x.id === comodoId);
    if (comodoObj) {
      comodoNome = comodoObj.nome;
      const cm = (comodoObj.camas || []).find(x => Number(x.numero) === Number(camaNum));
      if (cm && cm.morador) morador = cm.morador;
    }
  }

  const nomeFinal = moradorNome || (morador ? morador.nome : 'Morador');
  const matFinal = morador ? (morador.matricula || '--') : '--';
  const empresaFinal = morador ? (morador.empresa || 'GEL • Goetze Lobato') : 'GEL • Goetze Lobato';
  const funcaoFinal = morador ? (morador.funcao || 'Liderança / Engenharia') : 'Liderança / Engenharia';
  const telFinal = morador ? (morador.telefone || morador.whatsapp || '--') : '--';

  const elNome = document.getElementById('termoMoradorNome');
  if (elNome) elNome.textContent = nomeFinal;
  const elMat = document.getElementById('termoMoradorMatricula');
  if (elMat) elMat.textContent = matFinal;
  const elEmp = document.getElementById('termoMoradorEmpresa');
  if (elEmp) elEmp.textContent = empresaFinal;
  const elFunc = document.getElementById('termoMoradorFuncao');
  if (elFunc) elFunc.textContent = funcaoFinal;
  const elTel = document.getElementById('termoMoradorTelefone');
  if (elTel) elTel.textContent = telFinal;
  const elEnt = document.getElementById('termoDataEntrada');
  if (elEnt) elEnt.textContent = new Date().toLocaleDateString('pt-BR');
  const elTipo = document.getElementById('termoTipoLocal');
  if (elTipo) elTipo.textContent = 'Casa Urbana na Cidade';
  const elBloco = document.getElementById('termoBlocoOuCasa');
  if (elBloco) elBloco.textContent = casa ? casa.nome : 'Casa na Cidade';
  const elQuarto = document.getElementById('termoQuartoOuComodo');
  if (elQuarto) elQuarto.textContent = comodoNome;
  const elCama = document.getElementById('termoCamaNumero');
  if (elCama) elCama.textContent = `Cama ${camaNum || 1}`;
  const elAss = document.getElementById('termoAssinaturaMorador');
  if (elAss) elAss.textContent = nomeFinal;
  const elDoc = document.getElementById('termoDocMorador');
  if (elDoc) elDoc.textContent = `Matrícula: ${matFinal}`;

  // Preencher inventário de bens com móveis reais do cômodo da casa
  let itensCasa = null;
  if (comodoObj && Array.isArray(comodoObj.moveis) && comodoObj.moveis.length > 0) {
    itensCasa = [
      { item: `Cama individual / Leito ${camaNum || 1}`, qtd: 1, estado: 'Bom estado', check: '[ X ] Recebido em ordem' },
      { item: 'Colchão com Capa Protetora', qtd: 1, estado: 'Higienizado / Bom', check: '[ X ] Recebido em ordem' },
      ...comodoObj.moveis.map(m => ({
        item: m.tipo || m.nome || m.tipo_item || 'Móvel',
        qtd: m.quantidade || 1,
        estado: m.estado_conservacao || 'Bom estado',
        check: '[ X ] Recebido em ordem'
      })),
      { item: 'Chaves de Acesso ao Imóvel / Cômodo', qtd: 1, estado: 'Funcional', check: '[ X ] Recebido em ordem' }
    ];
  }
  preencherItensTermoResponsabilidade(itensCasa);

  abrirModal('modalTermoResponsabilidade');
}

function gerarTermoResponsabilidadeDoModalFoto() {
  const alojadoId = document.getElementById('modalFotoAlojadoId')?.value;
  if (!alojadoId) {
    showToast('Identificador do colaborador não encontrado.', 'error');
    return;
  }
  fecharModal('modalFotoAlojado');
  gerarTermoResponsabilidadeAlojado(alojadoId);
}

function imprimirTermoResponsabilidadeAtual() {
  document.body.classList.add('imprimindo-termo');
  window.print();
  const removerClassePrint = () => {
    document.body.classList.remove('imprimindo-termo');
  };
  window.addEventListener('afterprint', removerClassePrint, { once: true });
  setTimeout(removerClassePrint, 2000);
}

// ========================================================
// PAINEL CONSOLIDADO DE CONTAS DAS CASAS (VISÃO GERAL)
// ========================================================

function alternarSubAbaCasas(aba) {
  const btnImoveis = document.getElementById('btnSubAbaCasasImoveis');
  const btnDespesas = document.getElementById('btnSubAbaCasasDespesas');
  const subImoveis = document.getElementById('subPainelCasasImoveis');
  const subDespesas = document.getElementById('subPainelCasasDespesas');

  if (aba === 'despesas') {
    if (btnDespesas) btnDespesas.className = "px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-indigo-600 text-white shadow-sm";
    if (btnImoveis) btnImoveis.className = "px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-white text-slate-700 hover:bg-slate-100 border border-slate-200";
    if (subImoveis) subImoveis.classList.add('hidden');
    if (subDespesas) subDespesas.classList.remove('hidden');
    carregarPainelConsolidadoDespesas();
  } else {
    if (btnImoveis) btnImoveis.className = "px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-indigo-600 text-white shadow-sm";
    if (btnDespesas) btnDespesas.className = "px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-white text-slate-700 hover:bg-slate-100 border border-slate-200";
    if (subDespesas) subDespesas.classList.add('hidden');
    if (subImoveis) subImoveis.classList.remove('hidden');
    filtrarCasasCidadeUI();
  }
}

function carregarPainelConsolidadoDespesas() {
  const selectCasa = document.getElementById('filtroPainelDespesasCasa');
  if (selectCasa) {
    const valAtual = selectCasa.value;
    selectCasa.innerHTML = '<option value="todas">Todas as Casas</option>' +
      listaCasasCidade.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
    if (valAtual) selectCasa.value = valAtual;
  }

  const inputMes = document.getElementById('filtroPainelDespesasMes');
  if (inputMes && !inputMes.value) {
    inputMes.value = getMesAtualStr();
  }

  filtrarPainelDespesasCasasUI();
}

function filtrarPainelDespesasCasasUI() {
  const casaFiltro = document.getElementById('filtroPainelDespesasCasa')?.value || 'todas';
  const tipoFiltro = document.getElementById('filtroPainelDespesasTipo')?.value || 'todas';
  const mesFiltro = document.getElementById('filtroPainelDespesasMes')?.value || '';
  const statusFiltro = document.getElementById('filtroPainelDespesasStatus')?.value || 'todos';

  let filtradas = [...listaDespesasCasas];

  if (casaFiltro !== 'todas') {
    filtradas = filtradas.filter(d => d.casa_id === casaFiltro);
  }

  if (tipoFiltro !== 'todas') {
    filtradas = filtradas.filter(d => (d.categoria || '').toLowerCase().includes(tipoFiltro.toLowerCase()));
  }

  if (mesFiltro) {
    filtradas = filtradas.filter(d => {
      if (!d.mes_referencia) return false;
      const ref = String(d.mes_referencia).trim();
      if (ref === mesFiltro || ref.startsWith(mesFiltro)) return true;
      if (mesFiltro.includes('-')) {
        const [ano, mes] = mesFiltro.split('-');
        const refInvertida = `${mes}/${ano}`;
        if (ref === refInvertida || ref.includes(refInvertida)) return true;
      }
      return false;
    });
  }

  if (statusFiltro !== 'todos') {
    filtradas = filtradas.filter(d => d.status === statusFiltro);
  }

  // Atualizar KPIs do painel
  const total = filtradas.reduce((a, b) => a + (Number(b.valor) || 0), 0);
  const pago = filtradas.filter(d => d.status === 'pago').reduce((a, b) => a + (Number(b.valor) || 0), 0);
  const pend = filtradas.filter(d => d.status !== 'pago').reduce((a, b) => a + (Number(b.valor) || 0), 0);
  const qtdPend = filtradas.filter(d => d.status !== 'pago').length;

  const elTot = document.getElementById('kpiPainelDespesasTotal');
  if (elTot) elTot.textContent = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const elPago = document.getElementById('kpiPainelDespesasPago');
  if (elPago) elPago.textContent = pago.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const elPend = document.getElementById('kpiPainelDespesasPendente');
  if (elPend) elPend.textContent = pend.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const elQtdPend = document.getElementById('kpiPainelDespesasQtdPendentes');
  if (elQtdPend) elQtdPend.textContent = qtdPend;

  // Renderizar tabela
  const tbody = document.getElementById('tabelaPainelDespesasCorpo');
  const vazio = document.getElementById('painelDespesasVazio');
  if (!tbody) return;

  if (filtradas.length === 0) {
    tbody.innerHTML = '';
    if (vazio) vazio.classList.remove('hidden');
    return;
  }
  if (vazio) vazio.classList.add('hidden');

  const iconeDespesa = (cat) => {
    const c = (cat || '').toLowerCase();
    if (c.includes('energia') || c.includes('luz')) return 'fa-solid fa-bolt text-yellow-500';
    if (c.includes('água') || c.includes('agua')) return 'fa-solid fa-droplet text-cyan-500';
    if (c.includes('aluguel')) return 'fa-solid fa-house text-emerald-500';
    if (c.includes('internet') || c.includes('wifi')) return 'fa-solid fa-wifi text-indigo-500';
    if (c.includes('gás') || c.includes('gas')) return 'fa-solid fa-fire text-amber-500';
    if (c.includes('limpeza') || c.includes('faxina')) return 'fa-solid fa-broom text-teal-500';
    return 'fa-solid fa-file-invoice-dollar text-slate-500';
  };

  tbody.innerHTML = filtradas.map(d => {
    const ehPago = d.status === 'pago';
    const vencFormatado = d.vencimento ? (d.vencimento.includes('-') ? d.vencimento.split('-').reverse().join('/') : d.vencimento) : '--/--/----';
    const casa = listaCasasCidade.find(c => c.id === d.casa_id);
    const casaNome = d.casa_nome || (casa ? casa.nome : 'Casa');

    let avisoVencida = false;
    if (!ehPago && d.vencimento) {
      const hojeStr = new Date().toISOString().split('T')[0];
      if (d.vencimento < hojeStr) avisoVencida = true;
    }

    return `
      <tr class="hover:bg-slate-50 transition border-b border-slate-100">
        <td class="py-3 px-4 font-bold text-slate-900 flex items-center gap-2">
          <i class="fa-solid fa-house text-indigo-600 text-xs"></i>
          <span>${casaNome}</span>
        </td>
        <td class="py-3 px-4">
          <span class="inline-flex items-center gap-1.5 font-semibold text-slate-800">
            <i class="${iconeDespesa(d.categoria)}"></i>
            <span>${d.categoria || 'Despesa'}</span>
          </span>
        </td>
        <td class="py-3 px-4">
          <div class="text-xs text-slate-700">${d.observacoes || '<span class="text-slate-400 italic">Sem observações</span>'}</div>
          <div class="text-[10px] ${avisoVencida ? 'text-red-600 font-bold' : 'text-slate-500'}">
            Vencimento: ${vencFormatado} ${avisoVencida ? '<span class="ml-1 px-1.5 py-0.2 rounded bg-red-100 text-red-700 font-bold">VENCIDA</span>' : ''}
          </div>
        </td>
        <td class="py-3 px-4 text-center font-mono font-semibold text-slate-700">
          ${d.mes_referencia || '--'}
        </td>
        <td class="py-3 px-4 text-right font-black text-slate-900 text-xs">
          ${(Number(d.valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
        </td>
        <td class="py-3 px-4 text-center">
          <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${ehPago ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-amber-100 text-amber-800 border border-amber-300'}">
            <i class="fa-solid ${ehPago ? 'fa-circle-check text-emerald-600' : 'fa-clock text-amber-600'}"></i>
            <span>${ehPago ? 'PAGO' : 'PENDENTE'}</span>
          </span>
        </td>
        <td class="py-3 px-4 text-center">
          ${d.comprovante_url ? `
            <a href="${d.comprovante_url}" target="_blank" class="text-indigo-600 hover:text-indigo-800 text-xs font-bold inline-flex items-center gap-1">
              <i class="fa-solid fa-paperclip"></i> Anexo
            </a>
          ` : '<span class="text-slate-400 text-[10px]">Sem anexo</span>'}
        </td>
        <td class="py-3 px-4 text-right">
          <div class="inline-flex items-center gap-1">
            <button onclick="marcarDespesaComoPaga('${d.id}', '${ehPago ? 'pendente' : 'pago'}')" class="px-2.5 py-1.5 rounded-lg ${ehPago ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-emerald-600 hover:bg-emerald-700 text-white'} text-[11px] font-bold transition flex items-center gap-1 shadow-xs" title="${ehPago ? 'Reabrir / Marcar Pendente' : 'Marcar como Paga'}">
              <i class="fa-solid ${ehPago ? 'fa-rotate-left' : 'fa-check'} text-[10px]"></i>
              <span>${ehPago ? 'Reabrir' : 'Marcar Paga'}</span>
            </button>
            <button onclick="excluirDespesaCasa('${d.id}')" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 text-xs transition" title="Excluir Despesa">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function marcarDespesaComoPaga(despesaId, novoStatus) {
  const d = listaDespesasCasas.find(x => x.id === despesaId);
  if (!d) return;

  d.status = novoStatus;
  d.data_pagamento = novoStatus === 'pago' ? new Date().toLocaleDateString('pt-BR') : '';
  d.atualizado_em = new Date().toISOString();

  localStorage.setItem('casas_despesas_cache', JSON.stringify(listaDespesasCasas));
  atualizarContadoresCasasUI();
  filtrarPainelDespesasCasasUI();
  if (casaSelecionadaId && abaAtivaCasaDetalhes === 'despesas') {
    carregarDespesasCasaAtual();
  }

  showToast(`Conta de ${d.categoria} marcada como "${novoStatus === 'pago' ? 'PAGA' : 'PENDENTE'}"!`, 'success');

  try {
    if (typeof registrarAuditoria === 'function') {
      registrarAuditoria({
        modulo: 'casas',
        acao: 'EDITAR',
        entidade: d.categoria,
        detalhes: `Conta de ${d.categoria} (${d.casa_nome}) marcada como ${novoStatus.toUpperCase()}`
      });
    }
  } catch (e) {}

  if (firestoreDb) {
    try {
      await firestoreDb.collection('casas_despesas').doc(despesaId).update({
        status: novoStatus,
        data_pagamento: d.data_pagamento,
        atualizado_em: d.atualizado_em
      });
    } catch (err) {
      console.warn("Erro ao atualizar status da conta no Firestore:", err);
    }
  }
}

function limparFiltrosPainelDespesas() {
  const c = document.getElementById('filtroPainelDespesasCasa');
  if (c) c.value = 'todas';
  const t = document.getElementById('filtroPainelDespesasTipo');
  if (t) t.value = 'todas';
  const m = document.getElementById('filtroPainelDespesasMes');
  if (m) m.value = '';
  const s = document.getElementById('filtroPainelDespesasStatus');
  if (s) s.value = 'todos';
  filtrarPainelDespesasCasasUI();
  showToast('Filtros do painel de contas limpos.', 'info');
}

// ========================================================
// BACKUP COMPLETO JSON & RESTAURAÇÃO SEGURA (1 CLIQUE)
// ========================================================

let backupPendenteRestauracao = null;

async function fazerBackupCompletoJSON() {
  try {
    showToast('💾 Gerando Backup Completo da base de dados...', 'info');

    if (window.StaticApiEngine && !window.StaticApiEngine.initialized) {
      await window.StaticApiEngine.init();
    }

    const db = (window.StaticApiEngine && window.StaticApiEngine.dbState) || {};
    const backupObj = {
      sistema: 'Prefeitura de Canteiro - Taboca 2 (GEL)',
      versao_schema: '3.0',
      data_backup: new Date().toISOString(),
      data_formatada: new Date().toLocaleString('pt-BR'),
      autor: 'Prefeito Tiago Vidal',
      empresa: localStorage.getItem('appCustomEmpresaNome') || 'GEL • Goetze Lobato Engenharia S.A.',
      obra: localStorage.getItem('appCustomObraNome') || 'Canteiro Taboca 2',
      dados: {
        geral: db.geral || {},
        blocos: db.blocos || [],
        quartos: db.quartos || [],
        alojados: db.alojados || [],
        empresas: db.empresas || [],
        casas_cidade: listaCasasCidade || [],
        casas_despesas: listaDespesasCasas || [],
        casas_limpezas: listaLimpezasCasas || [],
        ronda_pontos: typeof listaPontosRonda !== 'undefined' ? listaPontosRonda : [],
        ronda_registros: typeof listaRegistrosRonda !== 'undefined' ? listaRegistrosRonda : [],
        estoque_itens: typeof listaEstoqueItens !== 'undefined' ? listaEstoqueItens : [],
        estoque_movimentacoes: typeof listaEstoqueMovimentacoes !== 'undefined' ? listaEstoqueMovimentacoes : [],
        chamados: typeof listaChamados !== 'undefined' ? listaChamados : [],
        auditoria_logs: db.auditoria_logs || db.auditoria || []
      }
    };

    const jsonStr = JSON.stringify(backupObj, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const timestampStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `backup_completo_prefeitura_${timestampStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    try {
      if (typeof registrarAuditoria === 'function') {
        registrarAuditoria({
          modulo: 'alojamento',
          acao: 'CRIAR',
          entidade: 'Backup Geral',
          detalhes: 'Exportou arquivo JSON de backup completo com todas as bases do sistema'
        });
      }
    } catch (e) {}

    showToast('🎉 Backup completo baixado com sucesso em arquivo .json!', 'success');
  } catch (err) {
    console.error('Erro ao fazer backup:', err);
    showToast('Erro ao exportar backup: ' + err.message, 'error');
  }
}

function analisarArquivoBackupJSON(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const conteudo = JSON.parse(e.target.result);
      const dados = conteudo.dados || conteudo;

      if (!dados.blocos && !dados.quartos && !dados.alojados && !dados.casas_cidade) {
        throw new Error('O arquivo selecionado não contém uma estrutura de dados válida de backup da Prefeitura.');
      }

      backupPendenteRestauracao = {
        dados: dados,
        meta: {
          empresa: conteudo.empresa || dados.empresa,
          obra: conteudo.obra || dados.obra,
          data_formatada: conteudo.data_formatada || new Date().toLocaleString('pt-BR')
        }
      };

      const elData = document.getElementById('restaurarBackupData');
      if (elData) elData.textContent = conteudo.data_formatada || new Date().toLocaleString('pt-BR');
      const elBlocos = document.getElementById('restaurarBackupBlocos');
      if (elBlocos) elBlocos.textContent = (dados.blocos || []).length;
      const elQuartos = document.getElementById('restaurarBackupQuartos');
      if (elQuartos) elQuartos.textContent = (dados.quartos || []).length;
      const elAloj = document.getElementById('restaurarBackupAlojados');
      if (elAloj) elAloj.textContent = (dados.alojados || []).length;
      const elCasas = document.getElementById('restaurarBackupCasas');
      if (elCasas) elCasas.textContent = (dados.casas_cidade || []).length;
      const elDesp = document.getElementById('restaurarBackupDespesas');
      if (elDesp) elDesp.textContent = (dados.casas_despesas || []).length;
      const elLimp = document.getElementById('restaurarBackupLimpezas');
      if (elLimp) elLimp.textContent = (dados.casas_limpezas || []).length;
      const elEst = document.getElementById('restaurarBackupEstoque');
      if (elEst) elEst.textContent = (dados.estoque_itens || []).length;
      const elCham = document.getElementById('restaurarBackupChamados');
      if (elCham) elCham.textContent = (dados.chamados || []).length;

      const elCheck = document.getElementById('checkConfirmarRestauracaoBackup');
      if (elCheck) elCheck.checked = false;

      abrirModal('modalConfirmarRestauracaoBackup');
    } catch (err) {
      showToast('Arquivo de backup inválido: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

async function executarRestauracaoBackupConfirmada() {
  const check = document.getElementById('checkConfirmarRestauracaoBackup');
  if (!check || !check.checked) {
    showToast('Por favor, marque a caixa confirmando a substituição segura antes de prosseguir.', 'warning');
    return;
  }

  if (!backupPendenteRestauracao) {
    showToast('Nenhum dado de backup pendente para restaurar.', 'error');
    return;
  }

  const payload = backupPendenteRestauracao;
  const dados = payload.dados || payload;
  const meta = payload.meta || {};
  showToast('🔄 Restaurando banco de dados completo...', 'info');

  try {
    if (window.StaticApiEngine) {
      if (dados.blocos) StaticApiEngine.dbState.blocos = dados.blocos;
      if (dados.quartos) StaticApiEngine.dbState.quartos = dados.quartos;
      if (dados.alojados) StaticApiEngine.dbState.alojados = dados.alojados;
      if (dados.empresas) StaticApiEngine.dbState.empresas = dados.empresas;
      if (dados.geral) StaticApiEngine.dbState.geral = dados.geral;
      if (dados.auditoria_logs) StaticApiEngine.dbState.auditoria_logs = dados.auditoria_logs;
      if (dados.auditoria) StaticApiEngine.dbState.auditoria = dados.auditoria;

      StaticApiEngine.recomputeStats();
      StaticApiEngine.saveToStorage();
    }

    localStorage.setItem('dados_iniciais_taboca_custom', JSON.stringify(StaticApiEngine.dbState));
    if (meta.empresa) localStorage.setItem('appCustomEmpresaNome', meta.empresa);
    if (meta.obra) localStorage.setItem('appCustomObraNome', meta.obra);

    if (dados.casas_cidade) {
      listaCasasCidade = dados.casas_cidade;
      localStorage.setItem('casas_cidade_cache', JSON.stringify(listaCasasCidade));
    }
    if (dados.casas_despesas) {
      listaDespesasCasas = dados.casas_despesas;
      localStorage.setItem('casas_despesas_cache', JSON.stringify(listaDespesasCasas));
    }
    if (dados.casas_limpezas) {
      listaLimpezasCasas = dados.casas_limpezas;
      localStorage.setItem('casas_limpezas_cache', JSON.stringify(listaLimpezasCasas));
    }
    if (dados.ronda_pontos) {
      listaPontosRonda = dados.ronda_pontos;
      localStorage.setItem('ronda_pontos_cache', JSON.stringify(listaPontosRonda));
    }
    if (dados.ronda_registros) {
      listaRegistrosRonda = dados.ronda_registros;
      localStorage.setItem('ronda_registros_cache', JSON.stringify(listaRegistrosRonda));
    }

    if (dados.estoque_itens) {
      listaEstoqueItens = dados.estoque_itens;
      localStorage.setItem('estoque_itens_cache', JSON.stringify(listaEstoqueItens));
    }
    if (dados.estoque_movimentacoes) {
      listaEstoqueMovimentacoes = dados.estoque_movimentacoes;
      localStorage.setItem('estoque_movimentacoes_cache', JSON.stringify(listaEstoqueMovimentacoes));
    }

    if (dados.chamados) {
      listaChamados = dados.chamados;
      localStorage.setItem('chamados_suporte_cache', JSON.stringify(listaChamados));
    }

    if (firestoreDb) {
      try {
        const batch = firestoreDb.batch();
        const snapshotRef = firestoreDb.collection('configuracoes').doc('snapshot_canteiro');
        batch.set(snapshotRef, {
          dados_consolidados: JSON.stringify(StaticApiEngine.dbState),
          atualizado_em: new Date().toISOString()
        }, { merge: true });

        (listaCasasCidade || []).forEach(c => {
          if (c && c.id) {
            batch.set(firestoreDb.collection('casas_cidade').doc(String(c.id)), c);
          }
        });

        (listaDespesasCasas || []).forEach(d => {
          if (d && d.id) {
            batch.set(firestoreDb.collection('casas_despesas').doc(String(d.id)), d);
          }
        });

        await batch.commit();
        console.log('[FIREBASE] Restauração sincronizada na nuvem com sucesso.');
      } catch (err) {
        console.warn('Aviso ao sincronizar restauração no Firestore:', err);
      }
    }

    try {
      if (typeof registrarAuditoria === 'function') {
        registrarAuditoria({
          modulo: 'alojamento',
          acao: 'IMPORTACAO',
          entidade: 'Base Completa',
          detalhes: 'Restauração de backup seguro em arquivo JSON executada com sucesso pelo Prefeito'
        });
      }
    } catch (e) {}

    fecharModal('modalConfirmarRestauracaoBackup');
    backupPendenteRestauracao = null;

    showToast('🎉 Banco de dados e todas as abas restauradas com 100% de sucesso!', 'success');
    refreshAllData();
    if (typeof filtrarPainelDespesasCasasUI === 'function') filtrarPainelDespesasCasasUI();
  } catch (err) {
    console.error('Erro na restauração:', err);
    showToast('Erro ao restaurar banco: ' + err.message, 'error');
  }
}

// ========================================================
// 7. IMPORTAÇÃO & SINCRONIZAÇÃO
// ========================================================

function atualizarNomeArquivo(input) {
  const display = document.getElementById('nomeArquivoSelecionado');
  if (input.files && input.files[0]) {
    display.innerHTML = `Arquivo Selecionado: <b class="text-emerald-700">${input.files[0].name}</b> (${(input.files[0].size / 1024).toFixed(1)} KB)`;
  }
}

async function enviarPlanilhaUpload(e) {
  e.preventDefault();
  if (!checkPrefeitoAccess()) return;

  const fileInput = document.getElementById('inputArquivoExcel');
  if (!fileInput.files || !fileInput.files[0]) {
    showToast('Por favor, selecione uma planilha Excel (.xlsx)', 'warning');
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('usuario', currentUserName);

  const btn = document.getElementById('btnUploadSubmit');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> Processando importação...';

  try {
    const res = await fetch(`${API_BASE}/api/importar-planilha`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro na importação');

    showToast(data.message, 'success');
    fileInput.value = '';
    document.getElementById('nomeArquivoSelecionado').textContent = 'Selecione ou arraste a planilha aqui';
    refreshAllData();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-upload"></i> Processar e Importar Planilha';
  }
}

async function confirmarRestaurarPadrao() {
  if (!checkPrefeitoAccess()) return;
  if (!confirm('Deseja realmente restaurar os dados originais da planilha oficial Taboca 2? Quaisquer alterações locais manuais serão redefinidas para a base oficial.')) return;

  setRefreshAnimation(true);
  try {
    const res = await fetch(`${API_BASE}/api/restaurar-padrao?usuario=${encodeURIComponent(currentUserName)}`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro');

    showToast('Banco de dados restaurado com sucesso!', 'success');
    refreshAllData();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setRefreshAnimation(false);
  }
}

// ========================================================
// 8. AUDITORIA & REGISTRO DE ATIVIDADES ("QUEM FEZ O QUÊ")
// ========================================================

let listaAuditoriaGeral = [];

function registrarAuditoria(modulo, acao, entidade, detalhes, usuarioCustom = null) {
  const agora = new Date();
  const dataFormatada = agora.toLocaleDateString('pt-BR');
  const horaFormatada = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dataHoraTexto = `${dataFormatada} ${horaFormatada}`;

  const usuario = usuarioCustom || (typeof currentUserName !== 'undefined' && currentUserName ? currentUserName : 'Prefeito');
  const logId = 'LOG-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

  // Sanitização rigorosa para impedir campos undefined no Firestore
  const safeModulo = modulo || 'geral';
  const safeAcao = acao || 'INFO';
  let safeEntidade = entidade || 'Geral';
  let safeDetalhes = detalhes;

  if (safeDetalhes === undefined || safeDetalhes === null) {
    if (entidade) {
      safeDetalhes = String(entidade);
      safeEntidade = 'Sistema';
    } else {
      safeDetalhes = 'Ação registrada no sistema';
    }
  }

  const logObj = {
    id: logId,
    data_hora: dataHoraTexto,
    timestamp: agora.toISOString(),
    usuario: String(usuario),
    modulo: String(safeModulo),
    acao: String(safeAcao),
    entidade: String(safeEntidade),
    detalhes: String(safeDetalhes)
  };

  listaAuditoriaGeral.unshift(logObj);
  if (listaAuditoriaGeral.length > 500) {
    listaAuditoriaGeral = listaAuditoriaGeral.slice(0, 500);
  }

  try {
    localStorage.setItem('auditoria_logs_cache', JSON.stringify(listaAuditoriaGeral.slice(0, 200)));
  } catch (e) {}

  if (typeof StaticApiEngine !== 'undefined' && StaticApiEngine.dbState) {
    if (!StaticApiEngine.dbState.auditoria) StaticApiEngine.dbState.auditoria = [];
    StaticApiEngine.dbState.auditoria.unshift(logObj);
  }

  // Atualizar Feed no Dashboard
  renderizarFeedAuditoriaDashboard();

  // Se estiver visualizando a aba de auditoria, atualiza na hora
  if (typeof activeTab !== 'undefined' && activeTab === 'auditoria') {
    filtrarAuditoriaUI();
  }

  // Grava no Firestore se disponível
  if (typeof firestoreDb !== 'undefined' && firestoreDb) {
    firestoreDb.collection('auditoria_logs').doc(logId).set(logObj).catch(err => {
      console.warn("Erro ao salvar log de auditoria no Firestore:", err);
    });
  }
}

function inicializarAuditoria() {
  try {
    const salvo = localStorage.getItem('auditoria_logs_cache');
    if (salvo) {
      listaAuditoriaGeral = JSON.parse(salvo);
    }
  } catch (e) {}

  if (listaAuditoriaGeral.length === 0) {
    const agora = new Date();
    listaAuditoriaGeral = [
      {
        id: 'LOG-INIT',
        data_hora: agora.toLocaleDateString('pt-BR') + ' ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        timestamp: agora.toISOString(),
        usuario: 'Prefeito Tiago Vidal',
        modulo: 'alojamento',
        acao: 'SISTEMA',
        entidade: 'Canteiro',
        detalhes: 'Sistema de Linha do Tempo e Auditoria de Atividades ativado.'
      }
    ];
  }

  renderizarFeedAuditoriaDashboard();

  // Sincroniza do Firestore se houver registros salvos
  if (typeof firestoreDb !== 'undefined' && firestoreDb) {
    firestoreDb.collection('auditoria_logs').orderBy('timestamp', 'desc').limit(150).get()
      .then(snap => {
        if (!snap.empty) {
          const remotos = [];
          snap.forEach(doc => remotos.push({ id: doc.id, ...doc.data() }));
          listaAuditoriaGeral = remotos;
          try { localStorage.setItem('auditoria_logs_cache', JSON.stringify(listaAuditoriaGeral.slice(0, 200))); } catch (e) {}
          renderizarFeedAuditoriaDashboard();
          if (activeTab === 'auditoria') carregarAuditoria();
        }
      })
      .catch(e => console.warn("Firestore auditoria offline fallback:", e));
  }
}

function renderizarFeedAuditoriaDashboard() {
  const container = document.getElementById('feedAuditoriaDashboard');
  if (!container) return;

  const ultimos = listaAuditoriaGeral.slice(0, 6);
  if (ultimos.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-400 italic py-4 text-center">Nenhuma atividade recente registrada.</p>';
    return;
  }

  container.innerHTML = ultimos.map(l => {
    let modBadgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
    let modIcon = 'fa-clock';
    let modNome = 'Sistema';

    if (l.modulo === 'casas') {
      modBadgeClass = 'bg-indigo-50 text-indigo-700 border-indigo-200';
      modIcon = 'fa-house';
      modNome = 'Casas';
    } else if (l.modulo === 'estoque') {
      modBadgeClass = 'bg-teal-50 text-teal-700 border-teal-200';
      modIcon = 'fa-boxes-stacked';
      modNome = 'Almoxarifado';
    } else if (l.modulo === 'alojamento') {
      modBadgeClass = 'bg-sky-50 text-sky-700 border-sky-200';
      modIcon = 'fa-hotel';
      modNome = 'Alojamento';
    } else if (l.modulo === 'chamados') {
      modBadgeClass = 'bg-amber-50 text-amber-700 border-amber-200';
      modIcon = 'fa-wrench';
      modNome = 'Chamados';
    }

    return `
      <div class="py-2.5 flex items-start gap-3 hover:bg-slate-50/80 px-2 rounded-xl transition">
        <div class="w-8 h-8 rounded-lg flex items-center justify-center text-xs flex-shrink-0 border ${modBadgeClass} mt-0.5 shadow-2xs">
          <i class="fa-solid ${modIcon}"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-bold text-slate-900 truncate leading-snug">${l.detalhes}</span>
            <span class="text-[10px] text-slate-400 whitespace-nowrap font-medium">${l.data_hora}</span>
          </div>
          <div class="flex items-center gap-2 mt-1">
            <span class="text-[10px] font-semibold text-slate-500 flex items-center gap-1">
              <i class="fa-solid fa-user-check text-[9px] text-slate-400"></i> ${l.usuario || 'Prefeito'}
            </span>
            <span class="text-slate-300">•</span>
            <span class="text-[10px] font-bold px-1.5 py-0.2 rounded border ${modBadgeClass}">${modNome}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function carregarAuditoria() {
  const icone = document.getElementById('iconeReloadAuditoria');
  if (icone) icone.classList.add('fa-spin');

  // Popula select de usuários únicos
  const selectUser = document.getElementById('filtroAuditUsuario');
  if (selectUser) {
    const curVal = selectUser.value;
    const users = Array.from(new Set(listaAuditoriaGeral.map(l => l.usuario).filter(Boolean)));
    selectUser.innerHTML = '<option value="todos">👥 Todos os Usuários</option>' + users.map(u => `<option value="${u}">${u}</option>`).join('');
    if (curVal) selectUser.value = curVal;
  }

  // Atualiza KPIs
  const totGeral = listaAuditoriaGeral.length;
  const totCasas = listaAuditoriaGeral.filter(l => l.modulo === 'casas').length;
  const totEstoque = listaAuditoriaGeral.filter(l => l.modulo === 'estoque').length;
  const totAloj = listaAuditoriaGeral.filter(l => l.modulo === 'alojamento').length;

  const kTot = document.getElementById('kpiAuditTotal');
  const kCasas = document.getElementById('kpiAuditCasas');
  const kEstoque = document.getElementById('kpiAuditEstoque');
  const kAloj = document.getElementById('kpiAuditAloj');

  if (kTot) kTot.textContent = totGeral;
  if (kCasas) kCasas.textContent = totCasas;
  if (kEstoque) kEstoque.textContent = totEstoque;
  if (kAloj) kAloj.textContent = totAloj;

  filtrarAuditoriaUI();
  if (icone) setTimeout(() => icone.classList.remove('fa-spin'), 350);
}

function filtrarAuditoriaUI() {
  const termo = (document.getElementById('filtroAuditBusca')?.value || '').toLowerCase().trim();
  const filtroModulo = document.getElementById('filtroAuditModulo')?.value || 'todos';
  const filtroAcao = document.getElementById('filtroAuditAcao')?.value || 'todas';
  const filtroUsuario = document.getElementById('filtroAuditUsuario')?.value || 'todos';

  let filtrados = listaAuditoriaGeral.filter(l => {
    if (termo) {
      const matchDet = (l.detalhes || '').toLowerCase().includes(termo);
      const matchUser = (l.usuario || '').toLowerCase().includes(termo);
      const matchAcao = (l.acao || '').toLowerCase().includes(termo);
      const matchEnt = (l.entidade || '').toLowerCase().includes(termo);
      if (!matchDet && !matchUser && !matchAcao && !matchEnt) return false;
    }

    if (filtroModulo !== 'todos' && l.modulo !== filtroModulo) return false;

    if (filtroAcao !== 'todas') {
      const ac = (l.acao || '').toUpperCase();
      if (filtroAcao === 'ALOCAR' && !ac.includes('ALOCAR')) return false;
      if (filtroAcao === 'TRANSFERIR' && !ac.includes('TRANSF')) return false;
      if (filtroAcao === 'DESALOJAR' && !ac.includes('DESAL') && !ac.includes('SAIDA')) return false;
      if (filtroAcao === 'ENTRADA' && !ac.includes('ENTRADA')) return false;
      if (filtroAcao === 'SAIDA' && !ac.includes('SAIDA')) return false;
      if (filtroAcao === 'MOVEL' && !ac.includes('MOVEL')) return false;
      if (filtroAcao === 'CHAMADO' && !ac.includes('CHAMADO') && !ac.includes('MANUT')) return false;
    }

    if (filtroUsuario !== 'todos' && l.usuario !== filtroUsuario) return false;

    return true;
  });

  renderTabelaAuditoria(filtrados);
}

function renderTabelaAuditoria(logs) {
  const tbody = document.getElementById('tabelaAuditoriaCorpo');
  const vazio = document.getElementById('auditoriaVazio');
  if (!tbody) return;

  if (logs.length === 0) {
    tbody.innerHTML = '';
    if (vazio) vazio.classList.remove('hidden');
    return;
  }

  if (vazio) vazio.classList.add('hidden');

  tbody.innerHTML = logs.map(l => {
    let modBadgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
    let modIcon = 'fa-clock';
    let modNome = 'Sistema';

    if (l.modulo === 'casas') {
      modBadgeClass = 'bg-indigo-50 text-indigo-700 border-indigo-200';
      modIcon = 'fa-house';
      modNome = 'Casas na Cidade';
    } else if (l.modulo === 'estoque') {
      modBadgeClass = 'bg-teal-50 text-teal-700 border-teal-200';
      modIcon = 'fa-boxes-stacked';
      modNome = 'Almoxarifado';
    } else if (l.modulo === 'alojamento') {
      modBadgeClass = 'bg-sky-50 text-sky-700 border-sky-200';
      modIcon = 'fa-hotel';
      modNome = 'Alojamento';
    } else if (l.modulo === 'chamados') {
      modBadgeClass = 'bg-amber-50 text-amber-700 border-amber-200';
      modIcon = 'fa-wrench';
      modNome = 'Chamados QR';
    }

    let acaoBadgeClass = 'bg-slate-100 text-slate-700';
    const ac = (l.acao || '').toUpperCase();
    if (ac.includes('ALOCAR') || ac.includes('CRIAR') || ac.includes('ENTRADA')) {
      acaoBadgeClass = 'bg-emerald-100 text-emerald-800';
    } else if (ac.includes('TRANSF') || ac.includes('EDITAR')) {
      acaoBadgeClass = 'bg-indigo-100 text-indigo-800';
    } else if (ac.includes('DESAL') || ac.includes('SAIDA') || ac.includes('EXCLUIR')) {
      acaoBadgeClass = 'bg-rose-100 text-rose-800';
    } else if (ac.includes('CHAMADO') || ac.includes('CONTA')) {
      acaoBadgeClass = 'bg-amber-100 text-amber-800';
    }

    return `
      <tr class="hover:bg-slate-50/80 transition">
        <td class="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
          ${l.data_hora}
        </td>
        <td class="py-3 px-4 whitespace-nowrap">
          <span class="inline-flex items-center gap-1.5 font-bold text-slate-800">
            <i class="fa-solid fa-user-check text-[10px] text-slate-400"></i>
            ${l.usuario || 'Prefeito'}
          </span>
        </td>
        <td class="py-3 px-4 whitespace-nowrap">
          <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${modBadgeClass}">
            <i class="fa-solid ${modIcon} text-[9px]"></i> ${modNome}
          </span>
        </td>
        <td class="py-3 px-4 whitespace-nowrap">
          <span class="px-2 py-0.5 rounded text-[10px] font-extrabold ${acaoBadgeClass}">
            ${l.acao}
          </span>
        </td>
        <td class="py-3 px-4 text-slate-800 font-medium leading-relaxed">
          ${l.detalhes}
        </td>
      </tr>
    `;
  }).join('');
}

function exportarAuditoriaExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('Biblioteca SheetJS ainda carregando...', 'error');
    return;
  }

  try {
    const wb = XLSX.utils.book_new();
    const dados = listaAuditoriaGeral.map(l => ({
      'ID Registro': l.id || '',
      'Data & Hora': l.data_hora || '',
      'Usuário Responsável': l.usuario || '',
      'Módulo': l.modulo || '',
      'Ação': l.acao || '',
      'Entidade': l.entidade || '',
      'Detalhes da Alteração': l.detalhes || ''
    }));

    const ws = XLSX.utils.json_to_sheet(dados);
    XLSX.utils.book_append_sheet(wb, ws, 'Histórico de Auditoria');

    const dataHoje = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `RELATORIO_AUDITORIA_CANTEIRO_${dataHoje}.xlsx`);
    showToast('Histórico de auditoria exportado com sucesso em Excel (.xlsx)!', 'success');
  } catch (e) {
    showToast('Erro ao exportar logs de auditoria: ' + e.message, 'error');
  }
}

// ========================================================
// HELPERS, CARREGADORES DE SELECTS & MODAIS
// ========================================================

async function carregarEmpresasLista() {
  try {
    const res = await fetch(`${API_BASE}/api/empresas`);
    globalEmpresas = await res.json();
    preencherSelectEmpresas('filtroAlojadosEmpresa');
  } catch (err) {
    console.error('Erro empresas lista:', err);
  }
}

async function carregarBlocosLista() {
  try {
    const res = await fetch(`${API_BASE}/api/blocos`);
    globalBlocos = await res.json();
    preencherSelectBlocos('filtroAlojadosBloco');
    preencherSelectBlocos('filtroMovelBloco');
  } catch (err) {
    console.error('Erro blocos lista:', err);
  }
}

async function carregarVagasLivresLista() {
  try {
    const res = await fetch(`${API_BASE}/api/vagas/livres`);
    globalVagasLivres = await res.json();
  } catch (err) {
    console.error('Erro vagas livres:', err);
  }
}

function preencherSelectEmpresas(selectId, selectedId = null) {
  const el = document.getElementById(selectId);
  if (!el) return;
  const isFilter = selectId.startsWith('filtro');
  
  let html = isFilter ? '<option value="">Todas as Empresas</option>' : '<option value="">Selecione uma Empresa</option>';
  globalEmpresas.forEach(e => {
    const sel = String(selectedId) === String(e.id) ? 'selected' : '';
    html += `<option value="${e.id}" ${sel}>${e.nome} (${e.total_alojados} alojados)</option>`;
  });
  el.innerHTML = html;
}

function preencherSelectBlocos(selectId, selectedId = null) {
  const el = document.getElementById(selectId);
  if (!el) return;
  const isFilter = selectId.startsWith('filtro');

  let html = isFilter ? '<option value="">Todos os Blocos</option>' : '<option value="">Selecione um Bloco</option>';
  globalBlocos.forEach(b => {
    const sel = String(selectedId) === String(b.id) ? 'selected' : '';
    html += `<option value="${b.id}" ${sel}>${b.nome} (${b.tipo.toUpperCase()})</option>`;
  });
  el.innerHTML = html;
}

async function preencherSelectVagasLivres(selectId, selectedVagaId = null) {
  const el = document.getElementById(selectId);
  if (!el) return;

  await carregarVagasLivresLista();

  if (globalVagasLivres.length === 0) {
    el.innerHTML = '<option value="">Nenhuma vaga livre no momento!</option>';
    return;
  }

  let html = '<option value="">Selecione um Bloco / Quarto / Cama livre</option>';
  globalVagasLivres.forEach(v => {
    const sel = String(selectedVagaId) === String(v.vaga_id) ? 'selected' : '';
    html += `<option value="${v.vaga_id}" ${sel}>${v.bloco_nome} → Quarto ${v.quarto_numero} (Cama ${v.numero_cama})</option>`;
  });
  el.innerHTML = html;
}

function preencherSelectQuartosParaMovel(selectId, selectedQuartoId = null) {
  const el = document.getElementById(selectId);
  if (!el) return;

  let html = '<option value="">Selecione o Quarto</option>';
  globalQuartos.forEach(q => {
    const sel = String(selectedQuartoId) === String(q.id) ? 'selected' : '';
    html += `<option value="${q.id}" ${sel}>${q.bloco_nome} - Quarto ${q.numero}</option>`;
  });
  el.innerHTML = html;
}

function abrirModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
}

function fecharModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

// Toast Notificações
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  let bg = 'bg-slate-900 border-slate-700 text-white';
  let icon = 'fa-solid fa-circle-info text-sky-400';

  if (type === 'success') {
    bg = 'bg-emerald-900/95 border-emerald-700 text-white';
    icon = 'fa-solid fa-circle-check text-emerald-300';
  } else if (type === 'warning') {
    bg = 'bg-amber-900/95 border-amber-700 text-white';
    icon = 'fa-solid fa-triangle-exclamation text-amber-300';
  } else if (type === 'error') {
    bg = 'bg-red-900/95 border-red-700 text-white';
    icon = 'fa-solid fa-circle-exclamation text-red-300';
  }

  const toast = document.createElement('div');
  toast.className = `pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl text-xs font-medium transition-all transform duration-300 translate-y-2 opacity-0 ${bg}`;
  toast.innerHTML = `
    <i class="${icon} text-base"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  // Animar entrada
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  // Remover após 4s
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ========================================================
// PWA & INSTALAÇÃO DO APLICATIVO (CELULAR E PC)
// ========================================================
let deferredInstallPrompt = null;

// Registro do Service Worker para suporte PWA offline e instalação
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js?v=3.9')
      .then(reg => {
        console.log('[PWA] Service Worker registrado com sucesso:', reg.scope);
        // Garante que o novo service worker seja verificado imediatamente
        if (reg.update) reg.update();
      })
      .catch(err => console.log('[PWA] Erro ao registrar Service Worker:', err));
  });
}

// Capturar evento de instalação do Chrome / Edge / Android
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  console.log('[PWA] Pronto para instalar o aplicativo.');
  const btnHeader = document.getElementById('btnInstalarAppHeader');
  if (btnHeader) btnHeader.classList.remove('hidden');
});

// App instalado com sucesso
window.addEventListener('appinstalled', () => {
  console.log('[PWA] Aplicativo instalado com sucesso na tela inicial!');
  deferredInstallPrompt = null;
  showToast('Aplicativo instalado com sucesso na tela inicial!', 'success');
  fecharModalInstalacao();
  const btnHeader = document.getElementById('btnInstalarAppHeader');
  if (btnHeader) btnHeader.classList.add('hidden');
});

function iniciarInstalacaoApp() {
  abrirModalInstalacao();
}

function abrirModalInstalacao() {
  abrirModal('modalInstalarApp');
}

function fecharModalInstalacao() {
  fecharModal('modalInstalarApp');
}

async function executarPromptInstalacao() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    console.log('[PWA] Resposta instalação:', outcome);
    if (outcome === 'accepted') {
      showToast('Instalando o aplicativo...', 'info');
      deferredInstallPrompt = null;
      fecharModalInstalacao();
    }
  } else {
    showToast('Siga o passo a passo ilustrado na tela para adicionar!', 'info');
  }
}

// ========================================================
// MENU MOBILE "MAIS" (DRAWER INFERIOR NO CELULAR)
// ========================================================
function toggleMenuMobileMais() {
  const drawer = document.getElementById('drawerMobileMais');
  if (drawer) {
    if (drawer.classList.contains('hidden')) {
      drawer.classList.remove('hidden');
      drawer.classList.add('flex');
    } else {
      drawer.classList.add('hidden');
      drawer.classList.remove('flex');
    }
  }
}

function fecharMenuMobileMais(e) {
  if (e && e.target && e.target !== e.currentTarget && e.target.closest && e.target.closest('#drawerMobileMais > div')) {
    return;
  }
  const drawer = document.getElementById('drawerMobileMais');
  if (drawer) {
    drawer.classList.add('hidden');
    drawer.classList.remove('flex');
  }
}

// ========================================================
// MÓDULO DE CHAMADOS QR CODE & MANUTENÇÃO DE ALOJAMENTOS
// ========================================================
let listaChamados = [];
let chamadosListenerAtivo = false;
let chamadosPrimeiraCarga = true;

// Som sutil de notificação para novo chamado (Web Audio API nativa sem arquivo externo)
function playNotificacaoChamado() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    
    // Tom 1
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    // Tom 2
    osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.12); // A5

    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.38);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.38);
  } catch (e) {
    console.log("Notificação sonora não suportada ou não permitida pelo navegador:", e);
  }
}

// Ouvinte em tempo real para os chamados vindos do celular dos trabalhadores
function iniciarListenerChamados() {
  try {
    const cached = localStorage.getItem('chamados_suporte_cache');
    if (cached && listaChamados.length === 0) {
      listaChamados = JSON.parse(cached);
      atualizarContadoresChamadosUI();
    }
  } catch (e) {}

  if (!firestoreDb || chamadosListenerAtivo) return;
  chamadosListenerAtivo = true;

  console.log("🔥 [FIREBASE] Iniciando listener de chamados_suporte QR Code...");

  try {
    firestoreDb.collection('chamados_suporte').onSnapshot((snapshot) => {
      const novosChamados = [];
      let novosPendentes = 0;

      snapshot.forEach(doc => {
        const d = doc.data();
        novosChamados.push({
          id: doc.id,
          protocolo: d.protocolo || doc.id,
          tipo_local: d.tipo_local || (d.casa_nome || (d.bloco && d.bloco.toLowerCase().includes('casa')) ? 'casa_cidade' : 'alojamento'),
          unidade_id: d.unidade_id || '',
          casa_id: d.casa_id || '',
          quarto_id: d.quarto_id || '',
          casa_nome: d.casa_nome || '',
          comodo: d.comodo || '',
          local_formatado: d.local_formatado || '',
          quarto: d.quarto || 'N/A',
          bloco: d.bloco || 'Não informado',
          nome_solicitante: d.nome_solicitante || 'Colaborador',
          whatsapp_solicitante: d.whatsapp_solicitante || '',
          categoria: d.categoria || 'Manutenção Geral',
          descricao: d.descricao || '',
          foto_url: d.foto_url || null,
          status: d.status || 'pendente', // pendente | em_atendimento | concluido
          origem: d.origem || 'QR Code',
          criado_em: d.criado_em || new Date().toISOString(),
          data_formatada: d.data_formatada || ''
        });
      });

      // Ordenar por data de criação mais recente primeiro
      novosChamados.sort((a, b) => new Date(b.criado_em || 0) - new Date(a.criado_em || 0));

      // Se não for a primeira carga, alertar o Prefeito
      if (!chamadosPrimeiraCarga) {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const data = change.doc.data();
            novosPendentes++;
            playNotificacaoChamado();
            showToast(`🚨 Nova Solicitação (${data.local_formatado || ('Quarto ' + (data.quarto || ''))}): ${data.categoria || 'Manutenção'}`, 'warning');
          }
        });
      }
      chamadosPrimeiraCarga = false;

      listaChamados = novosChamados;
      try {
        localStorage.setItem('chamados_suporte_cache', JSON.stringify(listaChamados.slice(0, 150)));
      } catch (e) {}

      atualizarContadoresChamadosUI();

      if (activeTab === 'chamados') {
        filtrarChamadosUI();
      } else if (activeTab === 'blocos') {
        carregarQuartos();
      } else if (activeTab === 'casas_cidade') {
        filtrarCasasCidadeUI();
      }
    }, (err) => {
      console.warn("Aviso ao escutar chamados_suporte no Firestore:", err);
    });
  } catch (err) {
    console.warn("Erro ao iniciar listener de chamados_suporte:", err);
  }
}

// Atualizar contadores e badges de chamados na UI
function atualizarContadoresChamadosUI() {
  const tot = listaChamados.length;
  const pend = listaChamados.filter(c => !c.status || c.status === 'pendente').length;
  const emAtend = listaChamados.filter(c => c.status === 'em_atendimento').length;
  const concl = listaChamados.filter(c => c.status === 'concluido').length;

  const elTot = document.getElementById('statTotalChamados');
  const elPend = document.getElementById('statPendentesChamados');
  const elEmAtend = document.getElementById('statEmAtendimentoChamados');
  const elConcl = document.getElementById('statConcluidosChamados');

  if (elTot) elTot.textContent = tot;
  if (elPend) elPend.textContent = pend;
  if (elEmAtend) elEmAtend.textContent = emAtend;
  if (elConcl) elConcl.textContent = concl;

  // Badge na sidebar
  const sideBadge = document.getElementById('sideCountChamados');
  if (sideBadge) {
    if (pend > 0) {
      sideBadge.textContent = pend;
      sideBadge.classList.remove('hidden');
    } else {
      sideBadge.classList.add('hidden');
    }
  }

  // Badge no drawer mobile
  const drawerBadge = document.getElementById('drawerBadgeChamados');
  if (drawerBadge) {
    drawerBadge.textContent = `${pend} pendente${pend === 1 ? '' : 's'}`;
  }
}

// Carregar e filtrar chamados
function carregarChamados() {
  atualizarContadoresChamadosUI();
  filtrarChamadosUI();
}

function filtrarChamadosUI() {
  const busca = (document.getElementById('buscaChamadosInput')?.value || '').toLowerCase().trim();
  const st = document.getElementById('filtroStatusChamados')?.value || 'todos';
  const cat = document.getElementById('filtroCategoriaChamados')?.value || 'todas';
  const local = document.getElementById('filtroLocalChamados')?.value || 'todos';

  let filtrados = [...listaChamados];

  if (local !== 'todos') {
    if (local === 'casa_cidade') {
      filtrados = filtrados.filter(c => c.tipo_local === 'casa_cidade' || c.casa_nome || (c.bloco && c.bloco.toLowerCase().includes('casa')));
    } else if (local === 'alojamento') {
      filtrados = filtrados.filter(c => c.tipo_local !== 'casa_cidade' && !c.casa_nome && !(c.bloco && c.bloco.toLowerCase().includes('casa')));
    }
  }

  if (st !== 'todos') {
    if (st === 'pendente') {
      filtrados = filtrados.filter(c => !c.status || c.status === 'pendente');
    } else {
      filtrados = filtrados.filter(c => c.status === st);
    }
  }

  if (cat !== 'todas') {
    filtrados = filtrados.filter(c => c.categoria && c.categoria.toLowerCase().includes(cat.toLowerCase()));
  }

  if (busca) {
    filtrados = filtrados.filter(c => 
      (c.quarto && String(c.quarto).toLowerCase().includes(busca)) ||
      (c.bloco && String(c.bloco).toLowerCase().includes(busca)) ||
      (c.casa_nome && String(c.casa_nome).toLowerCase().includes(busca)) ||
      (c.comodo && String(c.comodo).toLowerCase().includes(busca)) ||
      (c.local_formatado && String(c.local_formatado).toLowerCase().includes(busca)) ||
      (c.nome_solicitante && c.nome_solicitante.toLowerCase().includes(busca)) ||
      (c.descricao && c.descricao.toLowerCase().includes(busca)) ||
      (c.protocolo && c.protocolo.toLowerCase().includes(busca)) ||
      (c.categoria && c.categoria.toLowerCase().includes(busca))
    );
  }

  renderizarGridChamados(filtrados);
}

// Renderização dos cards de chamados na tela
function renderizarGridChamados(chamados) {
  const grid = document.getElementById('chamadosGrid');
  const vazio = document.getElementById('chamadosVazio');
  if (!grid) return;

  if (chamados.length === 0) {
    grid.innerHTML = '';
    if (vazio) vazio.classList.remove('hidden');
    return;
  }

  if (vazio) vazio.classList.add('hidden');

  const iconePorCategoria = (cat) => {
    const c = (cat || '').toLowerCase();
    if (c.includes('lâmpada') || c.includes('lampada') || c.includes('ilumina')) return 'fa-solid fa-lightbulb text-amber-500';
    if (c.includes('ar') || c.includes('ar-condicionado') || c.includes('clima')) return 'fa-solid fa-snowflake text-sky-500';
    if (c.includes('chuveiro') || c.includes('torneira') || c.includes('hidr') || c.includes('banheiro')) return 'fa-solid fa-faucet-drip text-cyan-500';
    if (c.includes('tomada') || c.includes('elétr') || c.includes('eletr')) return 'fa-solid fa-plug text-yellow-500';
    if (c.includes('porta') || c.includes('fechadura') || c.includes('chave')) return 'fa-solid fa-key text-rose-500';
    if (c.includes('cama') || c.includes('beliche') || c.includes('colch')) return 'fa-solid fa-bed text-indigo-500';
    if (c.includes('armário') || c.includes('guarda') || c.includes('móvel')) return 'fa-solid fa-warehouse text-emerald-500';
    return 'fa-solid fa-triangle-exclamation text-slate-500';
  };

  const badgeStatus = (status) => {
    if (status === 'concluido') {
      return '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300"><i class="fa-solid fa-circle-check"></i> Concluído</span>';
    }
    if (status === 'em_atendimento') {
      return '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-sky-800 border border-sky-300"><i class="fa-solid fa-person-digging"></i> Em Atendimento</span>';
    }
    return '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300"><i class="fa-solid fa-clock"></i> Pendente</span>';
  };

  grid.innerHTML = chamados.map(c => {
    const dataDisplay = c.data_formatada || (c.criado_em ? new Date(c.criado_em).toLocaleString('pt-BR') : '');
    const isCasa = c.tipo_local === 'casa_cidade' || c.casa_nome || (c.bloco && c.bloco.toLowerCase().includes('casa'));

    let tituloLocal = '';
    let subtituloLocal = '';
    let iconeLocal = '';
    let corIcone = '';

    if (isCasa) {
      const nomeCasa = c.casa_nome || c.bloco || 'Casa Urbana';
      const comodo = c.comodo || c.quarto || 'Cômodo Geral';
      tituloLocal = nomeCasa;
      subtituloLocal = ` • ${comodo}`;
      iconeLocal = 'fa-solid fa-house-chimney';
      corIcone = c.status === 'pendente' ? 'bg-indigo-500/10 text-indigo-600 border border-indigo-300' : 'bg-indigo-50 text-indigo-700';
    } else {
      const blocoTexto = c.bloco && c.bloco !== 'Não especificado' ? ` • ${c.bloco}` : '';
      tituloLocal = `Quarto ${c.quarto}`;
      subtituloLocal = blocoTexto;
      iconeLocal = 'fa-solid fa-door-open';
      corIcone = c.status === 'pendente' ? 'bg-amber-500/10 text-amber-600 border border-amber-300' : 'bg-slate-100 text-slate-700';
    }

    const badgeTipo = isCasa 
      ? '<span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200"><i class="fa-solid fa-city text-[9px]"></i> Casa Urbana</span>'
      : '<span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200"><i class="fa-solid fa-hotel text-[9px]"></i> Alojamento Obra</span>';

    const textoLocalMsg = isCasa ? `${tituloLocal} (${c.comodo || 'Geral'})` : `${tituloLocal} ${subtituloLocal}`;

    return `
      <div class="bg-white rounded-2xl border ${c.status === 'pendente' ? 'border-amber-300 shadow-md ring-1 ring-amber-100' : 'border-slate-200 shadow-sm'} p-4 flex flex-col justify-between transition hover:shadow-md">
        
        <!-- Topo do Card -->
        <div>
          <div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
            <div class="flex items-center gap-2.5">
              <div class="w-10 h-10 rounded-xl ${corIcone} flex items-center justify-center text-base font-extrabold flex-shrink-0">
                <i class="${iconeLocal}"></i>
              </div>
              <div>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <h4 class="text-sm font-extrabold text-slate-900 leading-tight">
                    ${tituloLocal}<span class="text-xs font-semibold text-slate-500">${subtituloLocal}</span>
                  </h4>
                  ${badgeTipo}
                </div>
                <p class="text-[10px] font-mono text-slate-400 mt-0.5">#${c.protocolo}</p>
              </div>
            </div>
            <div>
              ${badgeStatus(c.status)}
            </div>
          </div>

          <!-- Problema e Solicitante -->
          <div class="pt-3 space-y-2">
            
            <div class="flex items-center gap-2">
              <i class="${iconePorCategoria(c.categoria)} text-sm"></i>
              <span class="text-xs font-bold text-slate-800">${c.categoria}</span>
            </div>

            <div class="bg-slate-50 rounded-xl p-2.5 text-xs text-slate-700 leading-relaxed border border-slate-100">
              ${c.descricao || '<span class="text-slate-400 italic">Sem descrição informada</span>'}
            </div>

            <!-- Dados do Solicitante -->
            <div class="pt-1 flex flex-col gap-1 text-[11px] text-slate-500">
              <div class="flex items-center justify-between">
                <span class="flex items-center gap-1 font-medium text-slate-700">
                  <i class="fa-solid fa-user text-slate-400"></i> ${c.nome_solicitante}
                </span>
                <span class="text-[10px] text-slate-400">${dataDisplay}</span>
              </div>

              ${c.whatsapp_solicitante ? `
                <div class="flex items-center justify-between pt-0.5">
                  <span class="text-slate-500">Contato: ${c.whatsapp_solicitante}</span>
                  <a href="https://wa.me/55${c.whatsapp_solicitante.replace(/\D/g, '')}?text=${encodeURIComponent('Olá ' + c.nome_solicitante + ', sobre seu chamado de manutenção no ' + textoLocalMsg + ':')}" target="_blank" class="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 hover:text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                    <i class="fa-brands fa-whatsapp"></i> Responder
                  </a>
                </div>
              ` : ''}
            </div>

          </div>
        </div>

        <!-- Botões de Ação do Prefeito -->
        <div class="pt-4 border-t border-slate-100 flex items-center justify-between gap-1.5 mt-3">
          <button onclick="excluirChamado('${c.protocolo}')" class="btn-prefeito p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 text-xs transition" title="Excluir Chamado">
            <i class="fa-solid fa-trash-can"></i>
          </button>

          <div class="flex items-center gap-1.5">
            ${c.status === 'pendente' ? `
              <button onclick="alterarStatusChamado('${c.protocolo}', 'em_atendimento')" class="btn-prefeito px-3 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 font-semibold text-xs transition">
                <i class="fa-solid fa-play text-[10px] mr-1"></i> Atender
              </button>
              <button onclick="abrirModalConcluirChamadoEstoque('${c.protocolo}')" class="btn-prefeito px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition">
                <i class="fa-solid fa-check text-[10px] mr-1"></i> Concluir
              </button>
            ` : c.status === 'em_atendimento' ? `
              <button onclick="abrirModalConcluirChamadoEstoque('${c.protocolo}')" class="btn-prefeito px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition">
                <i class="fa-solid fa-check text-[10px] mr-1"></i> Marcar Concluído
              </button>
            ` : `
              <button onclick="alterarStatusChamado('${c.protocolo}', 'pendente')" class="btn-prefeito px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition" title="Reabrir Chamado">
                <i class="fa-solid fa-rotate-left mr-1"></i> Reabrir
              </button>
            `}
          </div>
        </div>

      </div>
    `;
  }).join('');
}

// Alterar Status do Chamado
async function alterarStatusChamado(protocolo, novoStatus) {
  const ch = listaChamados.find(c => c.protocolo === protocolo || c.id === protocolo);
  if (!ch) return;

  const statusAnterior = ch.status;
  ch.status = novoStatus;
  atualizarContadoresChamadosUI();
  filtrarChamadosUI();

  if (firestoreDb) {
    try {
      await firestoreDb.collection('chamados_suporte').doc(protocolo).update({
        status: novoStatus,
        atualizado_em: firebase.firestore.FieldValue.serverTimestamp(),
        atualizado_por: (typeof currentUserName !== 'undefined' ? currentUserName : 'Prefeito')
      });
      showToast(`Chamado #${protocolo} atualizado para "${novoStatus === 'concluido' ? 'Concluído' : novoStatus === 'em_atendimento' ? 'Em Atendimento' : 'Pendente'}"!`, 'success');
    } catch (err) {
      console.warn("Erro ao atualizar status no Firestore:", err);
      // reverter se falhou
      ch.status = statusAnterior;
      atualizarContadoresChamadosUI();
      filtrarChamadosUI();
      showToast('Erro ao atualizar chamado no Firebase: ' + err.message, 'error');
    }
  } else {
    showToast(`Chamado #${protocolo} atualizado localmente!`, 'info');
  }
}

// Excluir Chamado
async function excluirChamado(protocolo) {
  if (!confirm(`Tem certeza que deseja remover o chamado #${protocolo}?`)) return;

  listaChamados = listaChamados.filter(c => c.protocolo !== protocolo && c.id !== protocolo);
  atualizarContadoresChamadosUI();
  filtrarChamadosUI();

  if (firestoreDb) {
    try {
      await firestoreDb.collection('chamados_suporte').doc(protocolo).delete();
      showToast(`Chamado #${protocolo} removido com sucesso.`, 'info');
    } catch (err) {
      console.warn("Erro ao excluir chamado no Firestore:", err);
    }
  }
}

// Obter link público do chamado para o QR Code
function getQRCodeUrl() {
  const href = window.location.href;
  // Se estiver rodando localmente ou em domínio com barra
  if (href.includes('index.html')) {
    return href.replace('index.html', 'chamado.html');
  }
  const cleanUrl = href.split('?')[0].split('#')[0];
  return cleanUrl.endsWith('/') ? `${cleanUrl}chamado.html` : `${cleanUrl}/chamado.html`;
}

// Plaquinha QR Code
function abrirModalPlaquinhaQR() {
  const qrUrl = getQRCodeUrl();
  const imgEl = document.getElementById('imgPlaquinhaQRCode');
  const txtEl = document.getElementById('textoPlaquinhaUrl');
  const configDisplay = document.getElementById('configQrLinkDisplay');

  // Gerador de QR Code em alta resolução com API confiável
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qrUrl)}&format=png`;
  if (imgEl) imgEl.src = qrApiUrl;
  if (txtEl) txtEl.textContent = qrUrl;
  if (configDisplay) configDisplay.value = qrUrl;

  abrirModal('modalPlaquinhaQR');
}

function imprimirPlaquinhaQR() {
  document.body.classList.add('imprimindo-plaquinha');
  window.print();
  setTimeout(() => {
    document.body.classList.remove('imprimindo-plaquinha');
  }, 1000);
}

function copiarLinkQRCode() {
  const qrUrl = getQRCodeUrl();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(qrUrl).then(() => {
      showToast('Link do QR Code copiado com sucesso!', 'success');
    }).catch(() => {
      prompt('Copie o link abaixo:', qrUrl);
    });
  } else {
    prompt('Copie o link abaixo:', qrUrl);
  }
}

function recarregarChamadosManual() {
  const icone = document.getElementById('iconeReloadChamados');
  if (icone) icone.classList.add('fa-spin');
  showToast('Recarregando chamados da nuvem...', 'info');

  if (firestoreDb) {
    firestoreDb.collection('chamados_suporte').get().then(snap => {
      const novos = [];
      snap.forEach(doc => {
        const d = doc.data();
        novos.push({
          id: doc.id,
          protocolo: d.protocolo || doc.id,
          tipo_local: d.tipo_local || (d.casa_nome || (d.bloco && d.bloco.toLowerCase().includes('casa')) ? 'casa_cidade' : 'alojamento'),
          casa_nome: d.casa_nome || '',
          comodo: d.comodo || '',
          local_formatado: d.local_formatado || '',
          quarto: d.quarto || 'N/A',
          bloco: d.bloco || 'Não informado',
          nome_solicitante: d.nome_solicitante || 'Colaborador',
          whatsapp_solicitante: d.whatsapp_solicitante || '',
          categoria: d.categoria || 'Manutenção Geral',
          descricao: d.descricao || '',
          foto_url: d.foto_url || null,
          status: d.status || 'pendente',
          origem: d.origem || 'QR Code',
          criado_em: d.criado_em || new Date().toISOString(),
          data_formatada: d.data_formatada || ''
        });
      });
      novos.sort((a, b) => new Date(b.criado_em || 0) - new Date(a.criado_em || 0));
      listaChamados = novos;
      atualizarContadoresChamadosUI();
      filtrarChamadosUI();
      if (icone) icone.classList.remove('fa-spin');
      showToast('Lista de chamados atualizada com sucesso!', 'success');
    }).catch(err => {
      if (icone) icone.classList.remove('fa-spin');
      showToast('Erro ao recarregar: ' + err.message, 'error');
    });
  } else {
    if (icone) icone.classList.remove('fa-spin');
    filtrarChamadosUI();
  }
}

// Configurações do WhatsApp do Prefeito
function carregarConfigWhatsappPrefeito() {
  const qrUrl = getQRCodeUrl();
  const configDisplay = document.getElementById('configQrLinkDisplay');
  if (configDisplay) configDisplay.value = qrUrl;

  const salvoLocal = localStorage.getItem('prefeitura_whatsapp_prefeito') || '67 8187-7277';
  const inpZap = document.getElementById('configWhatsappPrefeito');
  if (inpZap) inpZap.value = salvoLocal;

  if (firestoreDb) {
    firestoreDb.collection('configuracoes').doc('prefeitura_contato').get().then(doc => {
      if (doc.exists && doc.data().whatsapp_prefeito) {
        if (inpZap) inpZap.value = doc.data().whatsapp_prefeito;
        localStorage.setItem('prefeitura_whatsapp_prefeito', doc.data().whatsapp_prefeito);
      }
    }).catch(e => console.log('Config contato load:', e));
  }
}

async function salvarConfigWhatsappPrefeito(event) {
  if (event) event.preventDefault();
  const inpZap = document.getElementById('configWhatsappPrefeito');
  const statusMsg = document.getElementById('configWhatsappStatusMsg');
  const btn = document.getElementById('btnSalvarWhatsappPrefeito');
  if (!inpZap) return;

  const valor = inpZap.value.trim();
  if (!valor) {
    showToast('Informe o número de WhatsApp do Prefeito.', 'warning');
    return;
  }

  localStorage.setItem('prefeitura_whatsapp_prefeito', valor);

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
  }

  if (firestoreDb) {
    try {
      await firestoreDb.collection('configuracoes').doc('prefeitura_contato').set({
        whatsapp_prefeito: valor,
        atualizado_em: firebase.firestore.FieldValue.serverTimestamp(),
        atualizado_por: (typeof currentUserName !== 'undefined' ? currentUserName : 'Prefeito')
      }, { merge: true });
    } catch (e) {
      console.warn("Aviso ao salvar contato no Firestore:", e);
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar Número do Prefeito';
  }
  if (statusMsg) {
    statusMsg.innerHTML = '<span class="text-emerald-600 font-semibold"><i class="fa-solid fa-circle-check"></i> Número do Prefeito atualizado e sincronizado!</span>';
  }
  showToast('WhatsApp do Prefeito atualizado com sucesso!', 'success');
}

// ========================================================
// MÓDULO DE CASAS NA CIDADE (LIDERANÇA & ENGENHARIA)
// ========================================================
let listaCasasCidade = [];
let listaDespesasCasas = [];
let listaLimpezasCasas = [];
let casaSelecionadaId = null;
let abaAtivaCasaDetalhes = 'comodos';
let listenerCasasAtivo = false;
let html5QrScannerInstance = null;

// Variaveis Globais de Estoque
var listaEstoqueItens = [];
var listaEstoqueMovimentacoes = [];
var listaEstoqueLocais = ['Galpão 1 (Cidade)', 'Galpão 2 (Alojamento Obra)', 'Almoxarifado Central'];
var listenerEstoqueAtivo = false;
var itemEstoqueSelecionadoId = null;
function abrirDetalhesCasa(id) { if (typeof abrirModalCasaDetalhes === 'function') abrirModalCasaDetalhes(id); }


// Obter mês atual formatado YYYY-MM para filtros de despesas
function getMesAtualStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}`;
}

// Inicializar ouvinte em tempo real do Firestore para Casas, Despesas e Limpezas
function iniciarListenerCasasCidade() {
  if (!firestoreDb || listenerCasasAtivo) return;
  listenerCasasAtivo = true;

  console.log("🏙️ [CASAS CIDADE] Inicializando sincronização em tempo real das Casas Urbanas...");

  // 1. Carregar cache local imediato
  try {
    const cachedCasas = localStorage.getItem('casas_cidade_cache');
    if (cachedCasas) {
      listaCasasCidade = JSON.parse(cachedCasas);
    }
    const cachedDespesas = localStorage.getItem('casas_despesas_cache');
    if (cachedDespesas) {
      listaDespesasCasas = JSON.parse(cachedDespesas);
    }
    const cachedLimpezas = localStorage.getItem('casas_limpezas_cache');
    if (cachedLimpezas) {
      listaLimpezasCasas = JSON.parse(cachedLimpezas);
    }
    atualizarContadoresCasasUI();
  } catch (e) {}

  // 2. Ouvir coleção de casas_cidade
  try {
    firestoreDb.collection('casas_cidade').onSnapshot((snapshot) => {
      const novasCasas = [];
      snapshot.forEach(doc => {
        novasCasas.push({ id: doc.id, ...doc.data() });
      });

      // Ordenar alfabeticamente pelo nome da casa
      novasCasas.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

      listaCasasCidade = novasCasas;
      try {
        localStorage.setItem('casas_cidade_cache', JSON.stringify(listaCasasCidade));
      } catch (e) {}

      atualizarContadoresCasasUI();

      if (activeTab === 'casas_cidade') {
        filtrarCasasCidadeUI();
      }

      // Se o modal de detalhes estiver aberto para a casa atual, atualizar
      if (casaSelecionadaId) {
        const casaAtualizada = listaCasasCidade.find(c => c.id === casaSelecionadaId);
        if (casaAtualizada) {
          atualizarDadosModalCasaDetalhes(casaAtualizada);
        }
      }
    }, (err) => {
      console.warn("Aviso ao escutar casas_cidade no Firestore:", err);
    });
  } catch (err) {
    console.warn("Erro ao registrar snapshot de casas_cidade:", err);
  }

  // 3. Ouvir coleção de casas_despesas
  try {
    firestoreDb.collection('casas_despesas').onSnapshot((snapshot) => {
      const novasDespesas = [];
      snapshot.forEach(doc => {
        novasDespesas.push({ id: doc.id, ...doc.data() });
      });

      // Ordenar por data de vencimento mais próxima
      novasDespesas.sort((a, b) => new Date(b.vencimento || 0) - new Date(a.vencimento || 0));

      listaDespesasCasas = novasDespesas;
      try {
        localStorage.setItem('casas_despesas_cache', JSON.stringify(listaDespesasCasas));
      } catch (e) {}

      atualizarContadoresCasasUI();

      if (casaSelecionadaId && abaAtivaCasaDetalhes === 'despesas') {
        carregarDespesasCasaAtual();
      }
    }, (err) => {
      console.warn("Aviso ao escutar casas_despesas no Firestore:", err);
    });
  } catch (err) {
    console.warn("Erro ao registrar snapshot de casas_despesas:", err);
  }

  // 4. Ouvir coleção de casas_limpezas (Controle de Limpeza e Manutenção via QR Code)
  try {
    firestoreDb.collection('casas_limpezas').onSnapshot((snapshot) => {
      const novasLimpezas = [];
      snapshot.forEach(doc => {
        novasLimpezas.push({ id: doc.id, ...doc.data() });
      });

      // Ordenar por data e hora decrescente
      novasLimpezas.sort((a, b) => new Date(b.data_hora || (b.data + 'T' + (b.hora || '00:00'))) - new Date(a.data_hora || (a.data + 'T' + (a.hora || '00:00'))));

      listaLimpezasCasas = novasLimpezas;
      try {
        localStorage.setItem('casas_limpezas_cache', JSON.stringify(listaLimpezasCasas));
      } catch (e) {}

      if (activeTab === 'casas_cidade') {
        filtrarCasasCidadeUI();
      } else if (activeTab === 'blocos') {
        carregarQuartos();
      }

      if (casaSelecionadaId && abaAtivaCasaDetalhes === 'limpezas') {
        renderizarHistoricoLimpezasCasa(casaSelecionadaId);
      }
    }, (err) => {
      console.warn("Aviso ao escutar casas_limpezas no Firestore:", err);
    });
  } catch (err) {
    console.warn("Erro ao registrar snapshot de casas_limpezas:", err);
  }
}

// Atualizar métricas, contadores e badges de Casas na Cidade
function atualizarContadoresCasasUI() {
  const totCasas = listaCasasCidade.length;
  let totMoradores = 0;
  let totCamas = 0;

  listaCasasCidade.forEach(c => {
    (c.comodos || []).forEach(com => {
      if (com.tipo === 'quarto') {
        totCamas += Number(com.capacidade_camas || 0);
        totMoradores += (com.camas || []).filter(cm => cm.morador && cm.morador.nome).length;
      }
    });
  });

  const vagasLivres = Math.max(0, totCamas - totMoradores);

  // Despesas do mês corrente
  const mesAtual = getMesAtualStr();
  const despesasMes = listaDespesasCasas.filter(d => (d.mes_referencia || '').startsWith(mesAtual));
  const totGastoMes = despesasMes.reduce((acc, curr) => acc + (Number(curr.valor) || 0), 0);
  const pendentesMes = despesasMes.filter(d => d.status === 'pendente').length;

  const elTotCasas = document.getElementById('statTotalCasas');
  const elMoradores = document.getElementById('statMoradoresCasas');
  const elVagasLivres = document.getElementById('statVagasLivresCasas');
  const elDespesasMes = document.getElementById('statDespesasMesCasas');
  const elPendentesSub = document.getElementById('statDespesasPendentesSub');

  if (elTotCasas) elTotCasas.textContent = totCasas;
  if (elMoradores) elMoradores.textContent = totMoradores;
  if (elVagasLivres) elVagasLivres.textContent = vagasLivres;
  if (elDespesasMes) elDespesasMes.textContent = totGastoMes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (elPendentesSub) elPendentesSub.textContent = `${pendentesMes} conta${pendentesMes === 1 ? '' : 's'} pendente${pendentesMes === 1 ? '' : 's'}`;

  // Badge na sidebar
  const sideBadge = document.getElementById('sideCountCasas');
  if (sideBadge) {
    if (totCasas > 0) {
      sideBadge.textContent = `${totCasas} casa${totCasas === 1 ? '' : 's'}`;
      sideBadge.classList.remove('hidden');
    } else {
      sideBadge.classList.add('hidden');
    }
  }

  // Badge no drawer mobile
  const drawerBadge = document.getElementById('drawerBadgeCasas');
  if (drawerBadge) {
    drawerBadge.textContent = `${totCasas} casa${totCasas === 1 ? '' : 's'} (${totMoradores} hab)`;
  }

  // Sincronizar KPIs do Dashboard Inicial se estiverem visíveis
  const elKpiCasasVagas = document.getElementById('kpiCasasVagas');
  if (elKpiCasasVagas) elKpiCasasVagas.textContent = `${totCamas} vagas`;
  const elKpiCasasOcupadas = document.getElementById('kpiCasasOcupadas');
  if (elKpiCasasOcupadas) elKpiCasasOcupadas.textContent = `${totMoradores} pessoas`;
  const elKpiCasasLivres = document.getElementById('kpiCasasLivres');
  if (elKpiCasasLivres) elKpiCasasLivres.textContent = `${vagasLivres} livres`;

  if (typeof globalStats !== 'undefined' && globalStats && globalStats.geral) {
    const alojV = Number(globalStats.geral.total_vagas || 0);
    const alojO = Number(globalStats.geral.ocupadas || 0);
    const alojL = Number(globalStats.geral.disponiveis || 0);

    const elKpiTotV = document.getElementById('kpiTotalVagas');
    if (elKpiTotV) elKpiTotV.textContent = alojV + totCamas;
    const elKpiTotO = document.getElementById('kpiOcupadas');
    if (elKpiTotO) elKpiTotO.textContent = alojO + totMoradores;
    const elKpiTotL = document.getElementById('kpiLivres');
    if (elKpiTotL) elKpiTotL.textContent = alojL + vagasLivres;
    const elKpiTaxa = document.getElementById('kpiTaxaOcupacao');
    const totGeral = alojV + totCamas;
    if (elKpiTaxa && totGeral > 0) {
      elKpiTaxa.textContent = `${Math.round(((alojO + totMoradores) / totGeral) * 100)}%`;
    }
  }

  // Atualiza gráficos de Casas se presentes no DOM
  if (typeof renderChartCasasCidade === 'function' && document.getElementById('chartCasasCidade')) {
    renderChartCasasCidade();
  }
  if (typeof renderChartCasasTab === 'function' && document.getElementById('chartCasasTab')) {
    renderChartCasasTab();
  }
  if (typeof renderChartBlocos === 'function' && typeof globalStats !== 'undefined' && globalStats?.blocos && document.getElementById('chartBlocos')) {
    renderChartBlocos(globalStats.blocos);
  }
}

// Carregar e filtrar casas
function carregarCasasCidade() {
  if (typeof sanitizarDatasLimpezasCache === 'function') {
    sanitizarDatasLimpezasCache();
  }
  atualizarContadoresCasasUI();
  filtrarCasasCidadeUI();
  renderChartCasasTab();
}

function renderChartCasasTab() {
  const ctx = document.getElementById('chartCasasTab');
  if (!ctx) return;

  if (chartCasasTabInstance) {
    chartCasasTabInstance.destroy();
  }

  if (!listaCasasCidade || listaCasasCidade.length === 0) {
    return;
  }

  const labels = [];
  const ocupadas = [];
  const livres = [];
  const meta = [];

  listaCasasCidade.forEach(c => {
    let camas = 0;
    let ocup = 0;
    let quartos = 0;
    (c.comodos || []).forEach(com => {
      if (com.tipo === 'quarto') {
        quartos++;
        camas += Number(com.capacidade_camas || 0);
        ocup += (com.camas || []).filter(cm => cm.morador && cm.morador.nome).length;
      }
    });
    labels.push(c.nome || 'Casa');
    ocupadas.push(ocup);
    livres.push(Math.max(0, camas - ocup));
    meta.push({ camas, ocup, quartos, taxa: camas > 0 ? Math.round((ocup / camas) * 100) : 0 });
  });

  chartCasasTabInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Camas Ocupadas',
          data: ocupadas,
          backgroundColor: '#6366f1',
          borderRadius: 4
        },
        {
          label: 'Camas Livres',
          data: livres,
          backgroundColor: '#10b981',
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { font: { size: 11, family: 'Inter' } }
        },
        y: {
          stacked: true,
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 10 }, stepSize: 1 }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: { font: { size: 11, family: 'Inter' }, usePointStyle: true, boxWidth: 8 }
        },
        tooltip: {
          callbacks: {
            footer: (items) => {
              const idx = items[0].dataIndex;
              const m = meta[idx];
              return m ? `Capacidade: ${m.camas} camas | ${m.quartos} quartos | ${m.taxa}% ocupação` : '';
            }
          }
        }
      }
    }
  });
}

function filtrarCasasCidadeUI() {
  const busca = (document.getElementById('buscaCasasInput')?.value || '').toLowerCase().trim();
  const filtroOcup = document.getElementById('filtroOcupacaoCasas')?.value || 'todas';

  let filtradas = [...listaCasasCidade];

  if (filtroOcup !== 'todas') {
    filtradas = filtradas.filter(c => {
      let camas = 0;
      let ocupadas = 0;
      (c.comodos || []).forEach(com => {
        if (com.tipo === 'quarto') {
          camas += Number(com.capacidade_camas || 0);
          ocupadas += (com.camas || []).filter(cm => cm.morador && cm.morador.nome).length;
        }
      });
      if (filtroOcup === 'vagas_livres') return camas > ocupadas;
      if (filtroOcup === 'lotadas') return camas > 0 && camas === ocupadas;
      const stLimp = calcularStatusLimpezasCasa(c.id);
      const recs = typeof obterChamadosAbertosCasa === 'function' ? obterChamadosAbertosCasa(c) : [];
      if (filtroOcup === 'limpeza_hoje') return stLimp && stLimp.rotina.status === 'ok';
      if (filtroOcup === 'limpeza_pendente') return stLimp && stLimp.rotina.status !== 'ok';
      if (filtroOcup === 'ar_vencido') return stLimp && stLimp.ar.status !== 'ok';
      if (filtroOcup === 'com_reclamacao') return recs.length > 0;
      return true;
    });
  }

  if (busca) {
    filtradas = filtradas.filter(c => {
      const matchNome = (c.nome || '').toLowerCase().includes(busca);
      const matchEnd = (c.endereco || '').toLowerCase().includes(busca);
      const matchBairro = (c.bairro || '').toLowerCase().includes(busca);
      const matchResp = (c.responsavel || '').toLowerCase().includes(busca);
      
      // Moradores dentro dos cômodos
      const matchMorador = (c.comodos || []).some(com => 
        (com.camas || []).some(cm => cm.morador && (cm.morador.nome || '').toLowerCase().includes(busca))
      );

      // Móveis dentro dos cômodos
      const matchMovel = (c.comodos || []).some(com => 
        (com.moveis || []).some(m => (m.tipo || '').toLowerCase().includes(busca) || (m.marca || '').toLowerCase().includes(busca))
      );

      return matchNome || matchEnd || matchBairro || matchResp || matchMorador || matchMovel;
    });
  }

  renderizarCasasCidadeGrid(filtradas);
}

// Renderização dos cards de casas
function renderizarCasasCidadeGrid(casas) {
  if (typeof sanitizarDatasLimpezasCache === 'function') {
    sanitizarDatasLimpezasCache();
  }
  const grid = document.getElementById('casasCidadeGrid');
  const vazio = document.getElementById('casasCidadeVazio');
  if (!grid) return;

  if (casas.length === 0) {
    grid.innerHTML = '';
    if (vazio) vazio.classList.remove('hidden');
    return;
  }

  if (vazio) vazio.classList.add('hidden');

  const mesAtual = getMesAtualStr();

  grid.innerHTML = casas.map(c => {
    let totCamas = 0;
    let totMoradores = 0;
    let totQuartos = 0;
    const nomesMoradores = [];

    (c.comodos || []).forEach(com => {
      if (com.tipo === 'quarto') {
        totQuartos++;
        totCamas += Number(com.capacidade_camas || 0);
        (com.camas || []).forEach(cm => {
          if (cm.morador && cm.morador.nome) {
            totMoradores++;
            nomesMoradores.push(cm.morador.nome);
          }
        });
      }
    });

    const vagasLivres = Math.max(0, totCamas - totMoradores);
    const taxaOcupacao = totCamas > 0 ? Math.round((totMoradores / totCamas) * 100) : 0;

    // Despesas da casa no mês
    const despCasaMes = listaDespesasCasas.filter(d => d.casa_id === c.id && (d.mes_referencia || '').startsWith(mesAtual));
    const totalGastoCasa = despCasaMes.reduce((acc, curr) => acc + (Number(curr.valor) || 0), 0);
    const pendentesCount = despCasaMes.filter(d => d.status === 'pendente').length;

    // Status de Limpeza & Manutenção (QR)
    const stLimpeza = calcularStatusLimpezasCasa(c.id);
    const chamadosCasaAbertos = typeof obterChamadosAbertosCasa === 'function' ? obterChamadosAbertosCasa(c) : [];

    // Foto da casa com fallback
    const fotoHtml = c.foto_url 
      ? `<img src="${c.foto_url}" alt="${c.nome}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">`
      : `<div class="w-full h-full bg-gradient-to-br from-indigo-900 via-slate-800 to-slate-900 flex items-center justify-center text-indigo-400/40">
           <i class="fa-solid fa-house-chimney text-5xl"></i>
         </div>`;

    const mapsBtn = c.maps_url 
      ? `<a href="${c.maps_url}" target="_blank" onclick="event.stopPropagation()" class="px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-[11px] font-bold inline-flex items-center gap-1 transition" title="Abrir localização no Google Maps">
           <i class="fa-solid fa-location-arrow text-emerald-600"></i> Maps
         </a>`
      : '';

    return `
      <div class="bg-white rounded-2xl border ${chamadosCasaAbertos.length > 0 ? 'border-rose-400 ring-1 ring-rose-200' : 'border-slate-200'} shadow-sm hover:shadow-lg transition flex flex-col justify-between overflow-hidden group">
        
        <!-- Topo com Imagem da Fachada -->
        <div class="relative h-44 w-full overflow-hidden cursor-pointer" onclick="abrirModalCasaDetalhes('${c.id}')">
          ${fotoHtml}
          
          <div class="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-black/30"></div>

          <!-- Badges no Topo da Foto -->
          <div class="absolute top-3 left-3 right-3 flex items-center justify-between">
            <span class="px-2.5 py-1 rounded-lg bg-slate-950/80 backdrop-blur text-white text-[11px] font-bold border border-white/20">
              <i class="fa-solid fa-bed text-sky-400 mr-1"></i> ${totMoradores}/${totCamas} Ocupados
            </span>

            ${vagasLivres > 0 ? `
              <span class="px-2 py-0.5 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-extrabold uppercase shadow-sm">
                ${vagasLivres} Vaga${vagasLivres === 1 ? '' : 's'} Livre${vagasLivres === 1 ? '' : 's'}
              </span>
            ` : `
              <span class="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-bold uppercase shadow-sm">
                Lotada
              </span>
            `}
          </div>

          <!-- Nome da Casa sobreposto na foto -->
          <div class="absolute bottom-3 left-3 right-3 text-white">
            <h3 class="text-base font-black truncate leading-tight drop-shadow-sm">${c.nome}</h3>
            <p class="text-xs text-slate-300 truncate mt-0.5 flex items-center gap-1">
              <i class="fa-solid fa-location-dot text-rose-400 text-[10px]"></i> ${c.endereco || 'Endereço não informado'}
            </p>
          </div>
        </div>

        <!-- Conteúdo do Card -->
        <div class="p-4 space-y-3 flex-1 flex flex-col justify-between">
          
          <div class="space-y-2.5">
            ${chamadosCasaAbertos.length > 0 ? `
              <!-- Tarja Pulsante de Reclamação / Observação do Morador via QR Code -->
              <div onclick="event.stopPropagation(); abrirModalOcorrenciasUnidade('casa', '${c.id}')" class="p-2.5 rounded-xl bg-rose-50 border border-rose-300 flex items-center justify-between gap-2 cursor-pointer hover:bg-rose-100 transition shadow-2xs">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping flex-shrink-0"></span>
                  <div class="truncate">
                    <span class="text-[10px] font-black uppercase text-rose-800 block">🚨 ${chamadosCasaAbertos.length} Reclamação(ões) em Aberto</span>
                    <span class="text-[11px] text-rose-700 font-semibold truncate block">${chamadosCasaAbertos[0].categoria}: ${chamadosCasaAbertos[0].descricao}</span>
                  </div>
                </div>
                <span class="px-2 py-1 rounded-lg bg-rose-600 text-white font-bold text-[10px] whitespace-nowrap flex-shrink-0">Ver / Resolver</span>
              </div>
            ` : ''}

            <!-- Barra de Progresso de Ocupação -->
            <div>
              <div class="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                <span>Ocupação dos Quartos</span>
                <span class="font-bold text-slate-700">${taxaOcupacao}%</span>
              </div>
              <div class="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                <div class="h-full ${taxaOcupacao >= 100 ? 'bg-rose-500' : 'bg-indigo-600'}" style="width: ${taxaOcupacao}%"></div>
              </div>
            </div>

            <!-- Resumo de Cômodos e Moradores -->
            <div class="flex items-center gap-2 text-xs text-slate-600 flex-wrap">
              <span class="px-2 py-1 rounded bg-slate-100 font-semibold flex items-center gap-1">
                <i class="fa-solid fa-door-open text-indigo-500"></i> ${totQuartos} Quartos
              </span>
              <span class="px-2 py-1 rounded bg-slate-100 font-semibold flex items-center gap-1">
                <i class="fa-solid fa-border-all text-amber-500"></i> ${(c.comodos || []).length} Cômodos
              </span>
              ${c.responsavel ? `
                <span class="px-2 py-1 rounded bg-slate-100 font-semibold text-slate-600 truncate max-w-[140px]" title="Responsável: ${c.responsavel}">
                  <i class="fa-solid fa-user-tie text-emerald-500"></i> ${c.responsavel}
                </span>
              ` : ''}
            </div>

            <!-- Moradores Listados -->
            <div class="bg-slate-50 rounded-xl p-2.5 border border-slate-100 text-xs text-slate-700">
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1">
                  <i class="fa-solid fa-users text-indigo-500"></i> Moradores Alojados
                  <span class="font-normal text-slate-400">(${totMoradores}/${totCamas})</span>
                </span>
                ${vagasLivres > 0 ? `
                  <button onclick="event.stopPropagation(); abrirModalCasaDetalhes('${c.id}')" class="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 transition flex items-center gap-1" title="Abrir casa para alocar morador">
                    <i class="fa-solid fa-user-plus text-[9px]"></i> + Alocar
                  </button>
                ` : ''}
              </div>

              ${nomesMoradores.length > 0 ? `
                <div class="flex items-center gap-1.5 flex-wrap">
                  ${nomesMoradores.slice(0, 3).map(n => `
                    <span class="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-800 text-[11px] font-medium truncate max-w-[140px] inline-flex items-center gap-1 shadow-2xs" title="${n}">
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0"></span>
                      <span class="truncate">${n.split(' ')[0]} ${n.split(' ')[1] || ''}</span>
                    </span>
                  `).join('')}
                  ${nomesMoradores.length > 3 ? `
                    <span class="px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-600 font-bold text-[10px]">+${nomesMoradores.length - 3}</span>
                  ` : ''}
                </div>
              ` : `
                <div class="flex items-center justify-between gap-2 py-0.5">
                  <span class="text-slate-400 italic text-[11px] flex items-center gap-1.5">
                    <i class="fa-solid fa-user-slash text-slate-300"></i> Nenhum morador alocado
                  </span>
                  <button onclick="event.stopPropagation(); abrirModalCasaDetalhes('${c.id}')" class="btn-prefeito px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[10px] border border-indigo-200 flex items-center gap-1 transition" title="Alocar primeiro morador">
                    <i class="fa-solid fa-user-plus text-[9px]"></i> Alocar Morador
                  </button>
                </div>
              `}
            </div>

            <!-- Indicadores de Limpeza & Manutenção (QR Code / Interativos) -->
            <div class="grid grid-cols-2 gap-2 text-xs">
              
              <!-- Card Faxina Diária: Verde se feita hoje, Amarelo se pendente -->
              <div 
                onclick="event.stopPropagation(); abrirModalRegistroLimpeza('${c.id}', 'rotina')" 
                class="p-2.5 rounded-xl border transition cursor-pointer select-none ${stLimpeza.rotina.cardBg || 'bg-slate-50 border-slate-200'} hover:shadow-xs group/limp" 
                title="${stLimpeza.rotina.tooltip} — Clique para registrar faxina"
              >
                <div class="flex items-center justify-between gap-1 mb-1">
                  <span class="text-[9px] uppercase font-bold text-slate-500 flex items-center gap-1 truncate">
                    <i class="fa-solid fa-broom ${stLimpeza.rotina.cor === 'emerald' ? 'text-emerald-600' : 'text-amber-500'}"></i> Faxina Casa
                  </span>
                  <span class="px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase border ${stLimpeza.rotina.badgeClass}">
                    ${stLimpeza.rotina.badgeLabel}
                  </span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full flex-shrink-0 ${stLimpeza.rotina.badgeDot}"></span>
                  <span class="font-extrabold text-[11px] truncate block ${stLimpeza.rotina.cor === 'emerald' ? 'text-emerald-900' : 'text-amber-900'}">
                    ${stLimpeza.rotina.textoCurto}
                  </span>
                </div>
              </div>

              <!-- Card Ar Condicionado: Verde até 30d, Vermelho se passou de 30d -->
              <div 
                onclick="event.stopPropagation(); abrirModalRegistroLimpeza('${c.id}', 'ar_condicionado')" 
                class="p-2.5 rounded-xl border transition cursor-pointer select-none ${stLimpeza.ar.cardBg || 'bg-slate-50 border-slate-200'} hover:shadow-xs group/ar" 
                title="${stLimpeza.ar.tooltip} — Clique para registrar higienização"
              >
                <div class="flex items-center justify-between gap-1 mb-1">
                  <span class="text-[9px] uppercase font-bold text-slate-500 flex items-center gap-1 truncate">
                    <i class="fa-solid fa-snowflake ${stLimpeza.ar.cor === 'emerald' ? 'text-emerald-600' : 'text-rose-600'}"></i> Ar Cond. (30d)
                  </span>
                  <span class="px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase border ${stLimpeza.ar.badgeClass}">
                    ${stLimpeza.ar.badgeLabel}
                  </span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full flex-shrink-0 ${stLimpeza.ar.badgeDot}"></span>
                  <span class="font-extrabold text-[11px] truncate block ${stLimpeza.ar.cor === 'emerald' ? 'text-emerald-900' : 'text-rose-900'}">
                    ${stLimpeza.ar.textoCurto}
                  </span>
                </div>
              </div>

            </div>

            <!-- Resumo Financeiro do Mês -->
            <div class="flex items-center justify-between p-2 rounded-xl bg-amber-50/40 border border-amber-200/60 text-xs">
              <div>
                <span class="text-[10px] uppercase font-bold text-amber-700 block">Despesas (${mesAtual.split('-')[1]}/${mesAtual.split('-')[0]}):</span>
                <span class="font-extrabold text-slate-900">${totalGastoCasa.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
              </div>
              <div class="text-right">
                ${pendentesCount > 0 ? `
                  <span class="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-300">
                    ${pendentesCount} conta${pendentesCount === 1 ? '' : 's'} a pagar
                  </span>
                ` : `
                  <span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                    Tudo em dia
                  </span>
                `}
              </div>
            </div>

          </div>

          <!-- Rodapé com Botões de Ação -->
          <div class="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 mt-2">
            <div>
              ${mapsBtn}
            </div>

            <div class="flex items-center gap-1.5">
              <button onclick="abrirModalPlacaQRCasa('${c.id}')" class="btn-prefeito p-2 rounded-lg text-slate-500 hover:text-teal-600 hover:bg-slate-100 text-xs transition" title="Ver Placa QR Code da Casa">
                <i class="fa-solid fa-qrcode text-teal-600"></i>
              </button>
              <button onclick="abrirModalRegistroLimpeza('${c.id}')" class="btn-prefeito p-2 rounded-lg text-slate-500 hover:text-emerald-600 hover:bg-slate-100 text-xs transition" title="Registrar Limpeza">
                <i class="fa-solid fa-broom text-emerald-600"></i>
              </button>
              <button onclick="editarCasa('${c.id}')" class="btn-prefeito p-2 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-slate-100 text-xs transition" title="Editar Casa">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              <button onclick="excluirCasa('${c.id}')" class="btn-prefeito p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 text-xs transition" title="Excluir Casa">
                <i class="fa-solid fa-trash-can"></i>
              </button>
              <button onclick="abrirModalCasaDetalhes('${c.id}')" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-1 shadow-xs transition">
                <span>Abrir Casa</span> <i class="fa-solid fa-chevron-right text-[10px]"></i>
              </button>
            </div>
          </div>

        </div>

      </div>
    `;
  }).join('');
}

// Criar / Editar Casa
function openModalNovaCasa() {
  const form = document.getElementById('formCasa');
  if (form) form.reset();
  const idEl = document.getElementById('casaFormId');
  if (idEl) idEl.value = '';
  const titEl = document.getElementById('casaFormTitulo') || document.getElementById('modalCasaFormTitulo');
  if (titEl) titEl.textContent = 'Cadastrar Casa na Cidade';
  const imgEl = document.getElementById('casaFormFotoPreview');
  if (imgEl) { imgEl.src = ''; imgEl.classList.add('hidden'); }
  const iconEl = document.getElementById('casaFormFotoIcon');
  if (iconEl) iconEl.classList.remove('hidden');
  abrirModal('modalCasaForm');
}

function editarCasa(id) {
  const c = listaCasasCidade.find(x => x.id === id);
  if (!c) return;

  const form = document.getElementById('formCasa');
  if (form) form.reset();
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  setVal('casaFormId', c.id);
  setVal('casaFormNome', c.nome || '');
  setVal('casaFormEndereco', c.endereco || '');
  setVal('casaFormBairro', c.bairro || '');
  setVal('casaFormMapsUrl', c.maps_url || '');
  setVal('casaFormResponsavel', c.responsavel || '');
  setVal('casaFormAluguelValor', c.aluguel_valor || '');
  setVal('casaFormObs', c.observacoes || '');
  setVal('casaFormFotoUrl', c.foto_url || '');
  
  atualizarPreviewFotoCasaInput(c.foto_url);
  const titEl = document.getElementById('casaFormTitulo') || document.getElementById('modalCasaFormTitulo');
  if (titEl) titEl.textContent = 'Editar Casa na Cidade';
  abrirModal('modalCasaForm');
}

function editarCasaAtual() {
  if (casaSelecionadaId) {
    editarCasa(casaSelecionadaId);
  }
}

function atualizarPreviewFotoCasaInput(url) {
  const imgEl = document.getElementById('casaFormFotoPreview');
  const iconEl = document.getElementById('casaFormFotoIcon');
  if (url && url.trim() !== '') {
    imgEl.src = url;
    imgEl.classList.remove('hidden');
    iconEl.classList.add('hidden');
  } else {
    imgEl.src = '';
    imgEl.classList.add('hidden');
    iconEl.classList.remove('hidden');
  }
}

// Upload de foto da fachada (Canvas para compactar)
function uploadFotoFachadaCasa(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;
      const maxDim = 1200;

      if (w > h && w > maxDim) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else if (h > maxDim) {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.80);
      document.getElementById('casaFormFotoUrl').value = compressedDataUrl;
      atualizarPreviewFotoCasaInput(compressedDataUrl);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// Salvar Casa
async function salvarCasa(event) {
  event.preventDefault();

  const id = document.getElementById('casaFormId').value || ('CASA-' + Date.now());
  const nome = document.getElementById('casaFormNome').value.trim();
  const endereco = document.getElementById('casaFormEndereco').value.trim();
  const bairro = document.getElementById('casaFormBairro').value.trim();
  const mapsUrl = document.getElementById('casaFormMapsUrl').value.trim();
  const responsavel = document.getElementById('casaFormResponsavel').value.trim();
  const aluguelValor = parseFloat(document.getElementById('casaFormAluguelValor').value) || 0;
  const observacoes = document.getElementById('casaFormObs').value.trim();
  const fotoUrl = document.getElementById('casaFormFotoUrl').value.trim();

  // Buscar se já existia cômodos para não perder
  const casaExistente = listaCasasCidade.find(x => x.id === id);
  const comodosExistentes = casaExistente ? (casaExistente.comodos || []) : [];

  const casaData = {
    nome: nome,
    endereco: endereco,
    bairro: bairro,
    maps_url: mapsUrl,
    responsavel: responsavel,
    aluguel_valor: aluguelValor,
    observacoes: observacoes,
    foto_url: fotoUrl || null,
    comodos: comodosExistentes,
    atualizado_em: new Date().toISOString(),
    atualizado_por: (typeof currentUserName !== 'undefined' ? currentUserName : 'Prefeito')
  };

  // 1. Atualizar localmente
  const index = listaCasasCidade.findIndex(x => x.id === id);
  if (index >= 0) {
    listaCasasCidade[index] = { id: id, ...casaData };
  } else {
    listaCasasCidade.push({ id: id, ...casaData });
  }

  localStorage.setItem('casas_cidade_cache', JSON.stringify(listaCasasCidade));
  atualizarContadoresCasasUI();
  filtrarCasasCidadeUI();
  fecharModal('modalCasaForm');
  showToast(`Casa "${nome}" salva com sucesso!`, 'success');

  // 2. Sincronizar com Firestore
  if (firestoreDb) {
    try {
      await firestoreDb.collection('casas_cidade').doc(id).set(casaData, { merge: true });
    } catch (err) {
      console.warn("Aviso ao salvar casa no Firestore:", err);
    }
  }
}

// Excluir Casa
async function excluirCasa(id) {
  const c = listaCasasCidade.find(x => x.id === id);
  if (!c) return;

  if (!confirm(`Tem certeza que deseja excluir a casa "${c.nome}" e todo o seu histórico de cômodos e moradores?`)) return;

  listaCasasCidade = listaCasasCidade.filter(x => x.id !== id);
  localStorage.setItem('casas_cidade_cache', JSON.stringify(listaCasasCidade));
  atualizarContadoresCasasUI();
  filtrarCasasCidadeUI();

  if (casaSelecionadaId === id) {
    fecharModal('modalCasaDetalhes');
  }

  showToast(`Casa "${c.nome}" excluída com sucesso.`, 'info');

  if (firestoreDb) {
    try {
      await firestoreDb.collection('casas_cidade').doc(id).delete();
    } catch (err) {
      console.warn("Erro ao excluir casa no Firestore:", err);
    }
  }
}

// Abrir Modal de Detalhes da Casa
function abrirModalCasaDetalhes(id) {
  casaSelecionadaId = id;
  const c = listaCasasCidade.find(x => x.id === id);
  if (!c) return;

  atualizarDadosModalCasaDetalhes(c);
  trocarAbaCasaDetalhes('comodos');
  abrirModal('modalCasaDetalhes');
}

function atualizarDadosModalCasaDetalhes(c) {
  document.getElementById('modalCasaDetalhesTitulo').textContent = c.nome;
  document.getElementById('modalCasaDetalhesEndereco').innerHTML = `<i class="fa-solid fa-location-dot text-rose-400"></i> ${c.endereco || 'Endereço não informado'} ${c.bairro ? '• ' + c.bairro : ''}`;
  document.getElementById('modalCasaDetalhesResponsavel').textContent = c.responsavel ? `Resp: ${c.responsavel}` : 'Sem resp. definido';

  const mapsLinkEl = document.getElementById('modalCasaDetalhesMapsLink');
  if (c.maps_url && c.maps_url.trim() !== '') {
    mapsLinkEl.href = c.maps_url;
    mapsLinkEl.classList.remove('hidden');
  } else {
    // Gerar link de busca no Google Maps pelo endereço
    const endEncoded = encodeURIComponent((c.endereco || '') + ' ' + (c.bairro || ''));
    mapsLinkEl.href = `https://www.google.com/maps/search/?api=1&query=${endEncoded}`;
    mapsLinkEl.classList.remove('hidden');
  }

  // Foto
  const imgEl = document.getElementById('modalCasaDetalhesFoto');
  const iconEl = document.getElementById('modalCasaDetalhesFotoIcon');
  if (c.foto_url) {
    imgEl.src = c.foto_url;
    imgEl.classList.remove('hidden');
    iconEl.classList.add('hidden');
  } else {
    imgEl.src = '';
    imgEl.classList.add('hidden');
    iconEl.classList.remove('hidden');
  }

  // Estatísticas rápidas da casa
  let totCamas = 0;
  let totMoradores = 0;
  (c.comodos || []).forEach(com => {
    if (com.tipo === 'quarto') {
      totCamas += Number(com.capacidade_camas || 0);
      totMoradores += (com.camas || []).filter(cm => cm.morador && cm.morador.nome).length;
    }
  });

  document.getElementById('modalCasaDetalhesOcupacaoBadge').textContent = `${totMoradores} de ${totCamas} vagas ocupadas`;
  document.getElementById('modalCasaDetalhesComodosCount').textContent = `${(c.comodos || []).length} cômodos cadastrados`;

  // Renderizar cômodos
  renderizarComodosCasaDetalhes(c);
}

// Trocar aba interna no modal da casa
function trocarAbaCasaDetalhes(aba) {
  abaAtivaCasaDetalhes = aba;

  const btnComodos = document.getElementById('btnAbaCasa_comodos');
  const btnDespesas = document.getElementById('btnAbaCasa_despesas');
  const btnLimpezas = document.getElementById('btnAbaCasa_limpezas');
  const painelComodos = document.getElementById('painelCasa_comodos');
  const painelDespesas = document.getElementById('painelCasa_despesas');
  const painelLimpezas = document.getElementById('painelCasa_limpezas');

  if (btnComodos) btnComodos.className = 'px-4 py-2.5 text-xs font-medium border-b-2 border-transparent text-slate-400 hover:text-white transition flex items-center gap-1.5';
  if (btnDespesas) btnDespesas.className = 'px-4 py-2.5 text-xs font-medium border-b-2 border-transparent text-slate-400 hover:text-white transition flex items-center gap-1.5';
  if (btnLimpezas) btnLimpezas.className = 'px-4 py-2.5 text-xs font-medium border-b-2 border-transparent text-slate-400 hover:text-white transition flex items-center gap-1.5';

  if (painelComodos) painelComodos.classList.add('hidden');
  if (painelDespesas) painelDespesas.classList.add('hidden');
  if (painelLimpezas) painelLimpezas.classList.add('hidden');

  if (aba === 'comodos') {
    if (btnComodos) btnComodos.className = 'px-4 py-2.5 text-xs font-bold border-b-2 border-indigo-500 text-white transition flex items-center gap-1.5';
    if (painelComodos) painelComodos.classList.remove('hidden');
  } else if (aba === 'despesas') {
    if (btnDespesas) btnDespesas.className = 'px-4 py-2.5 text-xs font-bold border-b-2 border-amber-500 text-white transition flex items-center gap-1.5';
    if (painelDespesas) painelDespesas.classList.remove('hidden');

    const inputMes = document.getElementById('filtroMesDespesaCasaInput');
    if (inputMes && !inputMes.value) {
      inputMes.value = getMesAtualStr();
    }
    carregarDespesasCasaAtual();
  } else if (aba === 'limpezas') {
    if (btnLimpezas) btnLimpezas.className = 'px-4 py-2.5 text-xs font-bold border-b-2 border-teal-500 text-white transition flex items-center gap-1.5';
    if (painelLimpezas) painelLimpezas.classList.remove('hidden');

    if (casaSelecionadaId) {
      renderizarHistoricoLimpezasCasa(casaSelecionadaId);
    }
  }
}

// Renderizar cômodos da casa no modal
function renderizarComodosCasaDetalhes(c) {
  const container = document.getElementById('casaDetalhesComodosGrid');
  const vazio = document.getElementById('casaDetalhesComodosVazio');
  if (!container) return;

  const comodos = c.comodos || [];

  if (comodos.length === 0) {
    container.innerHTML = '';
    vazio.classList.remove('hidden');
    return;
  }
  vazio.classList.add('hidden');

  const iconeComodo = (tipo) => {
    if (tipo === 'quarto') return 'fa-solid fa-bed text-sky-500';
    if (tipo === 'sala') return 'fa-solid fa-couch text-amber-500';
    if (tipo === 'cozinha') return 'fa-solid fa-kitchen-set text-emerald-500';
    if (tipo === 'banheiro') return 'fa-solid fa-shower text-cyan-500';
    if (tipo === 'lavanderia') return 'fa-solid fa-soap text-indigo-500';
    if (tipo === 'externa') return 'fa-solid fa-warehouse text-slate-500';
    return 'fa-solid fa-door-open text-slate-500';
  };

  container.innerHTML = comodos.map(com => {
    const ehQuarto = com.tipo === 'quarto';
    const camas = com.camas || [];
    const moveis = com.moveis || [];

    return `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
        
        <!-- Topo do Cômodo -->
        <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-sm">
              <i class="${iconeComodo(com.tipo)}"></i>
            </div>
            <div>
              <h5 class="text-sm font-bold text-slate-900 leading-tight">${com.nome}</h5>
              <span class="text-[10px] uppercase font-bold text-slate-400">
                ${ehQuarto ? `${com.capacidade_camas || 2} Vagas de Alojamento` : 'Área de Convivência'}
              </span>
            </div>
          </div>

          <div class="flex items-center gap-1">
            <button onclick="openModalNovoMovelComodo('${c.id}', '${com.id}')" class="btn-prefeito px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs flex items-center gap-1 transition" title="Adicionar móvel/eletro neste cômodo">
              <i class="fa-solid fa-plus text-[10px]"></i> Móvel/Eletro
            </button>
            <button onclick="excluirComodo('${c.id}', '${com.id}')" class="btn-prefeito p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 text-xs transition" title="Excluir este cômodo">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>

        <!-- Se for Quarto: Camas e Moradores -->
        ${ehQuarto ? `
          <div class="space-y-2">
            <span class="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
              <i class="fa-solid fa-users text-sky-500"></i> Camas & Moradores Alocados:
            </span>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              ${Array.from({ length: Number(com.capacidade_camas || 2) }).map((_, idx) => {
                const camaNum = idx + 1;
                const camaObj = camas.find(cm => Number(cm.numero) === camaNum);
                const morador = camaObj ? camaObj.morador : null;

                if (morador && morador.nome) {
                  const clickFoto = `abrirModalFotoMoradorCasa('${c.id}', '${com.id}', ${camaNum})`;
                  const safeNome = (morador.nome || '').replace(/'/g, "\\'");
                  return `
                    <div class="p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/40 flex items-center justify-between gap-2 shadow-2xs hover:border-emerald-300 transition">
                      <div class="flex items-center gap-2.5 min-w-0">
                        ${renderAvatarHtml(morador.nome, morador.foto_url, 'w-10 h-10', 'text-xs', clickFoto)}
                        <div class="min-w-0">
                          <p class="text-xs font-bold text-slate-900 truncate leading-tight">${morador.nome}</p>
                          <p class="text-[10px] text-emerald-800 font-medium truncate">${morador.funcao || 'Liderança'}${morador.empresa ? ` • ${morador.empresa}` : ''}</p>
                          ${morador.whatsapp ? `
                            <a href="https://wa.me/55${morador.whatsapp.replace(/\D/g, '')}" target="_blank" class="text-[10px] text-emerald-600 font-bold hover:underline flex items-center gap-1">
                              <i class="fa-brands fa-whatsapp"></i> ${morador.whatsapp}
                            </a>
                          ` : ''}
                        </div>
                      </div>
                      <div class="flex items-center gap-1">
                        <button onclick="${clickFoto}" class="btn-prefeito p-1.5 rounded-lg text-slate-500 hover:text-sky-600 hover:bg-sky-50 text-xs transition" title="Ver / alterar foto de ${safeNome}">
                          <i class="fa-solid fa-camera"></i>
                        </button>
                        <button onclick="gerarTermoResponsabilidadeMoradorCasa('${c.id}', '${com.id}', ${camaNum}, '${safeNome}')" class="btn-prefeito p-1.5 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 text-xs transition" title="Imprimir Termo de Responsabilidade A4 de ${safeNome}">
                          <i class="fa-solid fa-file-contract"></i>
                        </button>
                        <button onclick="openModalEditarMoradorCasa('${c.id}', '${com.id}', ${camaNum})" class="btn-prefeito p-1.5 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 text-xs transition" title="Editar dados do morador">
                          <i class="fa-solid fa-pen"></i>
                        </button>
                        <button onclick="openModalTransferirMoradorCasa('${c.id}', '${com.id}', ${camaNum})" class="btn-prefeito p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 text-xs transition" title="Mover / Transferir para outra Casa ou Quarto">
                          <i class="fa-solid fa-right-left"></i>
                        </button>
                        <button onclick="desocuparCamaCasa('${c.id}', '${com.id}', ${camaNum})" class="btn-prefeito p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-100 text-xs transition" title="Liberar Cama / Desalojar">
                          <i class="fa-solid fa-user-xmark"></i>
                        </button>
                      </div>
                    </div>
                  `;
                } else {
                  return `
                    <div class="p-2.5 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex items-center justify-between gap-2">
                      <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-full bg-slate-200 text-slate-400 text-xs flex items-center justify-center flex-shrink-0">
                          ${camaNum}
                        </div>
                        <div>
                          <p class="text-xs font-semibold text-slate-500">Cama ${camaNum} (Livre)</p>
                          <span class="text-[10px] text-slate-400">Vaga disponível</span>
                        </div>
                      </div>
                      <button onclick="openModalNovoMoradorCasa('${c.id}', '${com.id}', ${camaNum})" class="btn-prefeito px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs border border-indigo-200 transition">
                        <i class="fa-solid fa-user-plus mr-1"></i> Alocar
                      </button>
                    </div>
                  `;
                }
              }).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Móveis e Eletrodomésticos deste cômodo -->
        <div class="pt-1">
          <span class="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">
            Inventário de Móveis & Equipamentos:
          </span>

          ${moveis.length > 0 ? `
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              ${moveis.map(m => `
                <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs flex flex-col justify-between gap-1.5 text-slate-800 shadow-2xs hover:border-slate-300 transition">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5">
                        <span class="font-extrabold text-indigo-600">${m.quantidade || 1}x</span>
                        <span class="font-bold text-slate-900 truncate">${m.tipo}</span>
                      </div>
                      <div class="flex items-center gap-1.5 flex-wrap mt-0.5">
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold">${m.estado || 'Bom'}</span>
                        ${m.marca ? `<span class="text-[10px] text-slate-500 font-medium">${m.marca}</span>` : ''}
                        ${m.patrimonio ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 font-mono font-bold border border-indigo-200" title="Plaqueta de Patrimônio"><i class="fa-solid fa-tag text-[9px] mr-0.5"></i>${m.patrimonio}</span>` : ''}
                        ${m.valor ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold" title="Valor do Bem">${Number(m.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>` : ''}
                      </div>
                    </div>
                  </div>
                  <div class="flex items-center justify-end gap-1 pt-1 border-t border-slate-100 btn-prefeito">
                    <button onclick="openModalTransferirMovelCasa('${c.id}', '${com.id}', '${m.id}')" class="px-2 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-[11px] font-bold flex items-center gap-1 transition" title="Transferir este móvel para outro cômodo ou casa">
                      <i class="fa-solid fa-right-left text-[10px]"></i> Transferir
                    </button>
                    <button onclick="openModalDevolverMovelEstoque('${c.id}', '${com.id}', '${m.id}')" class="px-2 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 text-[11px] font-bold flex items-center gap-1 transition" title="Devolver móvel para o estoque / galpão">
                      <i class="fa-solid fa-boxes-stacked text-[10px]"></i> Devolver ao Estoque
                    </button>
                    <button onclick="excluirMovelComodo('${c.id}', '${com.id}', '${m.id}')" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 text-[11px] transition" title="Excluir item">
                      <i class="fa-solid fa-trash-can"></i>
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : `
            <p class="text-[11px] text-slate-400 italic">Nenhum móvel ou equipamento registrado neste cômodo.</p>
          `}
        </div>

      </div>
    `;
  }).join('');
}

// Ações de Cômodo
function openModalNovoComodo(casaId) {
  document.getElementById('formComodo').reset();
  document.getElementById('comodoFormCasaId').value = casaId;
  document.getElementById('comodoFormId').value = '';
  document.getElementById('comodoFormTipo').value = 'quarto';
  toggleComodoCapacidadeCamas('quarto');
  abrirModal('modalComodoForm');
}

function toggleComodoCapacidadeCamas(tipo) {
  const container = document.getElementById('comodoFormCamasContainer');
  if (tipo === 'quarto') {
    container.classList.remove('hidden');
  } else {
    container.classList.add('hidden');
  }
}

async function salvarComodo(event) {
  event.preventDefault();

  const casaId = document.getElementById('comodoFormCasaId').value;
  const casa = listaCasasCidade.find(c => c.id === casaId);
  if (!casa) return;

  const tipo = document.getElementById('comodoFormTipo').value;
  const nome = document.getElementById('comodoFormNome').value.trim();
  const camas = tipo === 'quarto' ? (parseInt(document.getElementById('comodoFormCamas').value) || 2) : 0;

  const comodoId = 'COM-' + Date.now();
  const novoComodo = {
    id: comodoId,
    tipo: tipo,
    nome: nome,
    capacidade_camas: camas,
    camas: [],
    moveis: []
  };

  casa.comodos = casa.comodos || [];
  casa.comodos.push(novoComodo);

  localStorage.setItem('casas_cidade_cache', JSON.stringify(listaCasasCidade));
  atualizarContadoresCasasUI();
  atualizarDadosModalCasaDetalhes(casa);
  fecharModal('modalComodoForm');
  showToast(`Cômodo "${nome}" adicionado com sucesso!`, 'success');

  if (firestoreDb) {
    try {
      await firestoreDb.collection('casas_cidade').doc(casaId).update({
        comodos: casa.comodos,
        atualizado_em: new Date().toISOString()
      });
    } catch (err) {
      console.warn("Erro ao atualizar cômodos no Firestore:", err);
    }
  }
}

async function excluirComodo(casaId, comodoId) {
  const casa = listaCasasCidade.find(c => c.id === casaId);
  if (!casa) return;

  if (!confirm('Tem certeza que deseja excluir este cômodo e seu inventário?')) return;

  casa.comodos = (casa.comodos || []).filter(cm => cm.id !== comodoId);

  localStorage.setItem('casas_cidade_cache', JSON.stringify(listaCasasCidade));
  atualizarContadoresCasasUI();
  atualizarDadosModalCasaDetalhes(casa);
  showToast('Cômodo removido com sucesso.', 'info');

  if (firestoreDb) {
    try {
      await firestoreDb.collection('casas_cidade').doc(casaId).update({
        comodos: casa.comodos,
        atualizado_em: new Date().toISOString()
      });
    } catch (err) {
      console.warn("Erro ao excluir cômodo no Firestore:", err);
    }
  }
}

// Funções de Foto do Morador da Casa
function previewFotoMoradorCasa(input) {
  const file = input.files && input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;
      const maxDim = 800;

      if (w > h && w > maxDim) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else if (h > maxDim) {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const urlInput = document.getElementById('moradorCasaFormFotoUrl');
      const preview = document.getElementById('moradorCasaFormFotoPreview');
      const placeholder = document.getElementById('moradorCasaFormFotoPlaceholder');
      const btnRem = document.getElementById('btnRemoverFotoMoradorCasaForm');

      if (urlInput) urlInput.value = compressedDataUrl;
      if (preview) {
        preview.src = compressedDataUrl;
        preview.classList.remove('hidden');
      }
      if (placeholder) placeholder.classList.add('hidden');
      if (btnRem) btnRem.classList.remove('hidden');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function limparFotoMoradorCasaForm() {
  const inp = document.getElementById('moradorCasaFormFotoInput');
  const urlInput = document.getElementById('moradorCasaFormFotoUrl');
  const preview = document.getElementById('moradorCasaFormFotoPreview');
  const placeholder = document.getElementById('moradorCasaFormFotoPlaceholder');
  const btnRem = document.getElementById('btnRemoverFotoMoradorCasaForm');

  if (inp) inp.value = '';
  if (urlInput) urlInput.value = '';
  if (preview) {
    preview.src = '';
    preview.classList.add('hidden');
  }
  if (placeholder) placeholder.classList.remove('hidden');
  if (btnRem) btnRem.classList.add('hidden');
}

// Alocar Morador na Cama
function openModalNovoMoradorCasa(casaId, comodoId, camaNum) {
  document.getElementById('formMoradorCasa').reset();
  limparFotoMoradorCasaForm();
  document.getElementById('moradorCasaFormCasaId').value = casaId;
  document.getElementById('moradorCasaFormComodoId').value = comodoId;
  document.getElementById('moradorCasaFormCamaNum').value = camaNum;

  const titulo = document.getElementById('modalMoradorCasaTitulo');
  if (titulo) titulo.textContent = 'Alocar Morador na Cama';
  const btnSubmit = document.getElementById('btnSalvarMoradorCasaSubmit');
  if (btnSubmit) btnSubmit.textContent = 'Alocar na Cama';

  const c = (listaCasasCidade || []).find(x => x.id === casaId);
  const com = c ? (c.comodos || []).find(cm => cm.id === comodoId) : null;
  const comNome = com ? com.nome : 'Quarto';

  document.getElementById('modalMoradorCasaSubtitulo').textContent = `${comNome} • Cama Nº ${camaNum}`;
  document.getElementById('moradorCasaFormDataEntrada').value = new Date().toISOString().split('T')[0];
  abrirModal('modalMoradorCasaForm');
}

// Editar Morador existente da Casa
function openModalEditarMoradorCasa(casaId, comodoId, camaNum) {
  document.getElementById('formMoradorCasa').reset();
  limparFotoMoradorCasaForm();
  document.getElementById('moradorCasaFormCasaId').value = casaId;
  document.getElementById('moradorCasaFormComodoId').value = comodoId;
  document.getElementById('moradorCasaFormCamaNum').value = camaNum;

  const titulo = document.getElementById('modalMoradorCasaTitulo');
  if (titulo) titulo.textContent = 'Editar Cadastro do Morador';
  const btnSubmit = document.getElementById('btnSalvarMoradorCasaSubmit');
  if (btnSubmit) btnSubmit.textContent = 'Salvar Alterações';

  const c = (listaCasasCidade || []).find(x => x.id === casaId);
  const com = c ? (c.comodos || []).find(cm => cm.id === comodoId) : null;
  const camaObj = com ? (com.camas || []).find(cm => Number(cm.numero) === Number(camaNum)) : null;
  const morador = camaObj ? camaObj.morador : null;

  if (morador) {
    document.getElementById('moradorCasaFormNome').value = morador.nome || '';
    document.getElementById('moradorCasaFormFuncao').value = morador.funcao || '';
    document.getElementById('moradorCasaFormEmpresa').value = morador.empresa || 'GEL';
    document.getElementById('moradorCasaFormWhatsapp').value = morador.whatsapp || '';
    document.getElementById('moradorCasaFormDataEntrada').value = morador.data_entrada || new Date().toISOString().split('T')[0];

    if (morador.foto_url) {
      document.getElementById('moradorCasaFormFotoUrl').value = morador.foto_url;
      const preview = document.getElementById('moradorCasaFormFotoPreview');
      const placeholder = document.getElementById('moradorCasaFormFotoPlaceholder');
      const btnRem = document.getElementById('btnRemoverFotoMoradorCasaForm');
      if (preview) {
        preview.src = morador.foto_url;
        preview.classList.remove('hidden');
      }
      if (placeholder) placeholder.classList.add('hidden');
      if (btnRem) btnRem.classList.remove('hidden');
    }
  }

  const comNome = com ? com.nome : 'Quarto';
  document.getElementById('modalMoradorCasaSubtitulo').textContent = `${comNome} • Cama Nº ${camaNum}`;
  abrirModal('modalMoradorCasaForm');
}

// Abrir Modal de Foto dedicado para Morador da Casa (mesmo comportamento do alojamento)
function abrirModalFotoMoradorCasa(casaId, comodoId, camaNum) {
  const c = (listaCasasCidade || []).find(x => x.id === casaId);
  const com = c ? (c.comodos || []).find(cm => cm.id === comodoId) : null;
  const camaObj = com ? (com.camas || []).find(cm => Number(cm.numero) === Number(camaNum)) : null;
  const morador = camaObj ? camaObj.morador : null;

  if (!morador) return;

  currentCropMoradorCasa = { casaId, comodoId, camaNum };
  currentCropAlojadoId = null;

  document.getElementById('modalFotoAlojadoId').value = `casa_${casaId}_${comodoId}_${camaNum}`;
  document.getElementById('modalFotoNome').textContent = morador.nome;
  document.getElementById('modalFotoSub').textContent = `Casa: ${c ? c.nome : 'Cidade'} • ${com ? com.nome : 'Quarto'} (Cama ${camaNum})`;

  const empBadge = document.getElementById('modalFotoInfoEmpresa');
  if (empBadge) {
    empBadge.textContent = morador.empresa || 'GEL';
    empBadge.style.backgroundColor = '#4f46e5';
  }

  document.getElementById('modalFotoInfoCargo').textContent = `${morador.funcao || 'Morador'}`;
  document.getElementById('modalFotoInfoLocal').textContent = `${c ? c.nome : 'Casa'} • ${com ? com.nome : 'Quarto'} • Cama Nº ${camaNum}`;

  const imgEl = document.getElementById('modalFotoImg');
  const vazioEl = document.getElementById('modalFotoVazio');
  const btnRemover = document.getElementById('modalFotoBtnRemover');

  const fotoAtual = morador.foto_url;
  if (fotoAtual && fotoAtual.trim() !== '') {
    if (typeof photoCacheManager !== 'undefined' && photoCacheManager.getPhoto) {
      photoCacheManager.getPhoto(fotoAtual).then(cached => {
        if (cached && imgEl) imgEl.src = cached;
      });
    }
    if (imgEl) {
      imgEl.src = fotoAtual;
      imgEl.classList.remove('hidden');
    }
    if (vazioEl) vazioEl.classList.add('hidden');
    if (btnRemover) btnRemover.classList.remove('hidden');
  } else {
    if (imgEl) {
      imgEl.src = '';
      imgEl.classList.add('hidden');
    }
    if (vazioEl) vazioEl.classList.remove('hidden');
    if (btnRemover) btnRemover.classList.add('hidden');
  }

  // Botão direto WhatsApp
  const btnZap = document.getElementById('modalFotoBtnWhatsapp');
  const txtZap = document.getElementById('modalFotoWhatsappTexto');
  const zapNum = morador.whatsapp || '';
  const waUrl = getWhatsappUrl(zapNum);

  if (btnZap) {
    if (waUrl) {
      btnZap.href = waUrl;
      const zapFormatado = formatarTelefoneTexto(zapNum);
      if (txtZap) txtZap.textContent = `Conversar no WhatsApp (${zapFormatado})`;
      btnZap.classList.remove('hidden');
    } else {
      btnZap.href = '#';
      btnZap.classList.add('hidden');
    }
  }

  abrirModal('modalFotoAlojado');
  updateUserRoleUI();
}

async function salvarMoradorCasa(event) {
  event.preventDefault();

  const casaId = document.getElementById('moradorCasaFormCasaId').value;
  const comodoId = document.getElementById('moradorCasaFormComodoId').value;
  const camaNum = parseInt(document.getElementById('moradorCasaFormCamaNum').value);

  const casa = (listaCasasCidade || []).find(c => c.id === casaId);
  if (!casa) return;
  const comodo = (casa.comodos || []).find(cm => cm.id === comodoId);
  if (!comodo) return;

  const nome = document.getElementById('moradorCasaFormNome').value.trim();
  const funcao = document.getElementById('moradorCasaFormFuncao').value.trim();
  const empresa = document.getElementById('moradorCasaFormEmpresa').value.trim();
  const whatsapp = document.getElementById('moradorCasaFormWhatsapp').value.trim();
  const dataEntrada = document.getElementById('moradorCasaFormDataEntrada').value;
  let fotoUrl = document.getElementById('moradorCasaFormFotoUrl').value.trim();

  // Se tiver arquivo de imagem novo não convertido, usar DataURL ou tentar ImgBB
  const fotoInput = document.getElementById('moradorCasaFormFotoInput');
  if (fotoInput && fotoInput.files && fotoInput.files[0] && !fotoUrl.startsWith('http') && !fotoUrl.startsWith('data:image')) {
    try {
      const file = fotoInput.files[0];
      const formData = new FormData();
      formData.append('image', file);
      const resImgbb = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
        method: 'POST',
        body: formData
      });
      const imgbbData = await resImgbb.json();
      if (imgbbData && imgbbData.success && imgbbData.data && imgbbData.data.display_url) {
        fotoUrl = imgbbData.data.display_url;
      }
    } catch (e) {
      console.warn("Upload ImgBB falhou para morador da casa:", e);
    }
  }

  comodo.camas = comodo.camas || [];
  let camaObj = comodo.camas.find(cm => Number(cm.numero) === camaNum);
  if (!camaObj) {
    camaObj = { numero: camaNum };
    comodo.camas.push(camaObj);
  }

  camaObj.morador = {
    nome: nome,
    funcao: funcao,
    empresa: empresa,
    whatsapp: whatsapp,
    data_entrada: dataEntrada,
    foto_url: fotoUrl || null
  };

  localStorage.setItem('casas_cidade_cache', JSON.stringify(listaCasasCidade));
  atualizarContadoresCasasUI();
  atualizarDadosModalCasaDetalhes(casa);
  fecharModal('modalMoradorCasaForm');
  showToast(`Colaborador "${nome}" salvo com sucesso!`, 'success');

  // Registro de Auditoria
  if (typeof registrarAuditoria === 'function') {
    registrarAuditoria('casas', 'ALOCAR', 'Morador', `Alocou "${nome}" (${funcao || 'Colaborador'}) na Cama ${camaNum} da ${casa.nome} (${comodo.nome})`);
  }

  if (firestoreDb) {
    try {
      await firestoreDb.collection('casas_cidade').doc(casaId).update({
        comodos: casa.comodos,
        atualizado_em: new Date().toISOString()
      });
    } catch (err) {
      console.warn("Erro ao salvar morador no Firestore:", err);
    }
  }
}

async function desocuparCamaCasa(casaId, comodoId, camaNum) {
  const casa = (listaCasasCidade || []).find(c => c.id === casaId);
  if (!casa) return;
  const comodo = (casa.comodos || []).find(cm => cm.id === comodoId);
  if (!comodo) return;

  if (!confirm(`Deseja realmente desalojar o morador da Cama ${camaNum}?`)) return;

  const camaObj = (comodo.camas || []).find(cm => Number(cm.numero) === Number(camaNum));
  const nomeAntigo = camaObj?.morador?.nome || 'Morador';
  if (camaObj) {
    camaObj.morador = null;
  }

  localStorage.setItem('casas_cidade_cache', JSON.stringify(listaCasasCidade));
  atualizarContadoresCasasUI();
  atualizarDadosModalCasaDetalhes(casa);
  showToast(`Cama ${camaNum} liberada com sucesso!`, 'info');

  // Registro de Auditoria
  if (typeof registrarAuditoria === 'function') {
    registrarAuditoria('casas', 'DESALOJAR', 'Morador', `Desalojou "${nomeAntigo}" da Cama ${camaNum} da ${casa.nome} (${comodo.nome})`);
  }

  if (firestoreDb) {
    try {
      await firestoreDb.collection('casas_cidade').doc(casaId).update({
        comodos: casa.comodos,
        atualizado_em: new Date().toISOString()
      });
    } catch (err) {
      console.warn("Erro ao desocupar cama no Firestore:", err);
    }
  }
}

// ========================================================
// TRANSFERÊNCIA DE MORADOR ENTRE CASAS OU QUARTOS
// ========================================================

function openModalTransferirMoradorCasa(casaId, comodoId, camaNum) {
  const cOrigem = (listaCasasCidade || []).find(x => x.id === casaId);
  if (!cOrigem) return;
  const comOrigem = (cOrigem.comodos || []).find(x => x.id === comodoId);
  if (!comOrigem) return;
  const morador = (comOrigem.camas || []).find(x => x.numero === Number(camaNum));
  if (!morador) return;

  const form = document.getElementById('formTransferirMoradorCasa');
  if (form) form.reset();

  document.getElementById('transfMoradorCasaOrigemId').value = casaId;
  document.getElementById('transfMoradorComodoOrigemId').value = comodoId;
  document.getElementById('transfMoradorCamaOrigemNum').value = camaNum;

  // Renderizar avatar e informações do morador
  const avatarContainer = document.getElementById('transfMoradorAvatarContainer');
  if (avatarContainer) {
    avatarContainer.innerHTML = renderAvatarHtml(morador.nome, morador.foto_url, 'w-11 h-11', 'text-xs');
  }

  document.getElementById('transfMoradorInfoNome').textContent = morador.nome;
  document.getElementById('transfMoradorInfoFuncao').textContent = `${morador.funcao || 'Colaborador'}${morador.empresa ? ` • ${morador.empresa}` : ''}`;
  document.getElementById('transfMoradorInfoOrigem').textContent = `Origem: ${cOrigem.nome || cOrigem.identificador} • ${comOrigem.nome} (Cama ${camaNum})`;

  // Popula Casas de Destino
  const selectCasa = document.getElementById('transfMoradorCasaDestinoSelect');
  if (selectCasa) {
    selectCasa.innerHTML = listaCasasCidade.map(casa => {
      const isAtual = casa.id === casaId;
      return `<option value="${casa.id}" ${isAtual ? 'selected' : ''}>${casa.nome || casa.identificador} (${casa.endereco || 'Urbana'})${isAtual ? ' [Casa Atual]' : ''}</option>`;
    }).join('');
  }

  aoMudarCasaDestinoTransferenciaMorador(casaId);
  abrirModal('modalTransferirMoradorCasa');
}

function aoMudarCasaDestinoTransferenciaMorador(casaDestinoId) {
  const cDestino = (listaCasasCidade || []).find(x => x.id === casaDestinoId);
  const selectComodo = document.getElementById('transfMoradorComodoDestinoSelect');
  if (!selectComodo) return;

  if (!cDestino) {
    selectComodo.innerHTML = '<option value="">Nenhum quarto disponível</option>';
    aoMudarComodoDestinoTransferenciaMorador('');
    return;
  }

  // Filtrar cômodos do tipo quarto
  const quartos = (cDestino.comodos || []).filter(cm => cm.tipo === 'quarto');
  if (quartos.length === 0) {
    selectComodo.innerHTML = '<option value="">⚠️ Nenhum quarto nesta casa</option>';
    aoMudarComodoDestinoTransferenciaMorador('');
    return;
  }

  selectComodo.innerHTML = quartos.map(q => {
    const totalCamas = Number(q.capacidade_camas || 2);
    const ocupadas = (q.camas || []).length;
    const livres = Math.max(0, totalCamas - ocupadas);
    return `<option value="${q.id}">🚪 ${q.nome} (${livres} vaga${livres !== 1 ? 's' : ''} livre${livres !== 1 ? 's' : ''})</option>`;
  }).join('');

  aoMudarComodoDestinoTransferenciaMorador(selectComodo.value);
}

function aoMudarComodoDestinoTransferenciaMorador(comodoDestinoId) {
  const casaDestinoId = document.getElementById('transfMoradorCasaDestinoSelect')?.value;
  const cDestino = (listaCasasCidade || []).find(x => x.id === casaDestinoId);
  const comDestino = cDestino ? (cDestino.comodos || []).find(x => x.id === comodoDestinoId) : null;

  const casaOrigemId = document.getElementById('transfMoradorCasaOrigemId')?.value;
  const comodoOrigemId = document.getElementById('transfMoradorComodoOrigemId')?.value;
  const camaOrigemNum = Number(document.getElementById('transfMoradorCamaOrigemNum')?.value);

  const selectCama = document.getElementById('transfMoradorCamaDestinoSelect');
  const avisoSemVagas = document.getElementById('transfMoradorAvisoSemVagas');
  const btnConfirmar = document.getElementById('btnConfirmarTransfMorador');

  if (!comDestino) {
    if (selectCama) selectCama.innerHTML = '<option value="">-</option>';
    if (avisoSemVagas) avisoSemVagas.classList.remove('hidden');
    if (btnConfirmar) {
      btnConfirmar.disabled = true;
      btnConfirmar.classList.add('opacity-50', 'cursor-not-allowed');
    }
    return;
  }

  const cap = Number(comDestino.capacidade_camas || 2);
  const ocupadas = (comDestino.camas || []).map(x => x.numero);

  // Identifica camas livres
  const camasLivres = [];
  for (let i = 1; i <= cap; i++) {
    // Se for exatamente o mesmo cômodo de origem, não permite mover para a mesma cama
    if (casaOrigemId === casaDestinoId && comodoOrigemId === comodoDestinoId && i === camaOrigemNum) {
      continue;
    }
    if (!ocupadas.includes(i)) {
      camasLivres.push(i);
    }
  }

  if (camasLivres.length === 0) {
    if (selectCama) selectCama.innerHTML = '<option value="">Sem vagas neste quarto</option>';
    if (avisoSemVagas) avisoSemVagas.classList.remove('hidden');
    if (btnConfirmar) {
      btnConfirmar.disabled = true;
      btnConfirmar.classList.add('opacity-50', 'cursor-not-allowed');
    }
  } else {
    if (selectCama) {
      selectCama.innerHTML = camasLivres.map(num => `<option value="${num}">🛏️ Cama ${num} (Livre)</option>`).join('');
    }
    if (avisoSemVagas) avisoSemVagas.classList.add('hidden');
    if (btnConfirmar) {
      btnConfirmar.disabled = false;
      btnConfirmar.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }
}

async function confirmarTransferenciaMoradorCasa(event) {
  event.preventDefault();

  const casaOrigemId = document.getElementById('transfMoradorCasaOrigemId').value;
  const comodoOrigemId = document.getElementById('transfMoradorComodoOrigemId').value;
  const camaOrigemNum = Number(document.getElementById('transfMoradorCamaOrigemNum').value);

  const casaDestinoId = document.getElementById('transfMoradorCasaDestinoSelect').value;
  const comodoDestinoId = document.getElementById('transfMoradorComodoDestinoSelect').value;
  const camaDestinoNum = Number(document.getElementById('transfMoradorCamaDestinoSelect').value);
  const motivo = document.getElementById('transfMoradorMotivo').value.trim();

  if (!casaDestinoId || !comodoDestinoId || !camaDestinoNum) {
    showToast('Selecione uma casa, quarto e cama válidos para a transferência.', 'warning');
    return;
  }

  if (casaOrigemId === casaDestinoId && comodoOrigemId === comodoDestinoId && camaOrigemNum === camaDestinoNum) {
    showToast('O colaborador já está nesta mesma cama.', 'warning');
    return;
  }

  const cOrigem = (listaCasasCidade || []).find(x => x.id === casaOrigemId);
  if (!cOrigem) return;
  const comOrigem = (cOrigem.comodos || []).find(x => x.id === comodoOrigemId);
  if (!comOrigem) return;
  const moradorOrigem = (comOrigem.camas || []).find(x => x.numero === camaOrigemNum);
  if (!moradorOrigem) {
    showToast('Morador de origem não encontrado.', 'error');
    return;
  }

  const cDestino = (listaCasasCidade || []).find(x => x.id === casaDestinoId);
  if (!cDestino) return;
  const comDestino = (cDestino.comodos || []).find(x => x.id === comodoDestinoId);
  if (!comDestino) {
    showToast('Quarto de destino não encontrado.', 'error');
    return;
  }

  // Verifica se a cama de destino está realmente livre
  const jaOcupada = (comDestino.camas || []).some(x => x.numero === camaDestinoNum);
  if (jaOcupada) {
    showToast(`A cama ${camaDestinoNum} do quarto de destino já foi ocupada. Escolha outra.`, 'warning');
    return;
  }

  // 1. Remove da origem
  comOrigem.camas = (comOrigem.camas || []).filter(x => x.numero !== camaOrigemNum);

  // 2. Prepara e insere no destino
  const moradorTransferido = {
    ...moradorOrigem,
    numero: camaDestinoNum,
    remanejado_em: new Date().toISOString(),
    observacao_remanejamento: motivo ? `Remanejado de ${cOrigem.nome} (${comOrigem.nome} - Cama ${camaOrigemNum}): ${motivo}` : `Remanejado de ${cOrigem.nome} (${comOrigem.nome})`
  };

  comDestino.camas = comDestino.camas || [];
  comDestino.camas.push(moradorTransferido);

  // 3. Salva no localStorage e atualiza interface
  try {
    localStorage.setItem('casas_cidade_cache', JSON.stringify(listaCasasCidade));
  } catch (e) {}

  atualizarContadoresCasasUI();
  atualizarDadosModalCasaDetalhes(cOrigem);
  fecharModal('modalTransferirMoradorCasa');

  showToast(`"${moradorOrigem.nome}" transferido com sucesso para ${cDestino.nome} - ${comDestino.nome} (Cama ${camaDestinoNum})!`, 'success');

  registrarAuditoria(
    'casas',
    'TRANSFERIR',
    moradorOrigem.nome,
    `Transferiu ${moradorOrigem.nome} de "${cOrigem.nome} - ${comOrigem.nome}" para "${cDestino.nome} - ${comDestino.nome} (Cama ${camaDestinoNum})"${motivo ? ' - Motivo: ' + motivo : ''}`
  );

  // 4. Salva no Firestore
  if (firestoreDb) {
    try {
      await firestoreDb.collection('casas_cidade').doc(casaOrigemId).update({
        comodos: cOrigem.comodos,
        atualizado_em: new Date().toISOString()
      });
      if (casaDestinoId !== casaOrigemId) {
        await firestoreDb.collection('casas_cidade').doc(casaDestinoId).update({
          comodos: cDestino.comodos,
          atualizado_em: new Date().toISOString()
        });
      }
    } catch (e) {
      console.warn("Erro ao atualizar transferência de morador no Firestore:", e);
    }
  }
}

// ========================================================
// TRANSFERÊNCIA E DEVOLUÇÃO DE MÓVEIS DE CASAS
// ========================================================

function openModalTransferirMovelCasa(casaId, comodoId, movelId) {
  const c = (listaCasasCidade || []).find(x => x.id === casaId);
  if (!c) return;
  const com = (c.comodos || []).find(x => x.id === comodoId);
  if (!com) return;
  const m = (com.moveis || []).find(x => x.id === movelId);
  if (!m) return;

  document.getElementById('formTransferirMovelCasa').reset();
  document.getElementById('transfMovelCasaOrigemId').value = casaId;
  document.getElementById('transfMovelComodoOrigemId').value = comodoId;
  document.getElementById('transfMovelId').value = movelId;

  document.getElementById('modalTransferirMovelSubtitulo').textContent = `Origem: ${c.nome} • ${com.nome}`;
  document.getElementById('transfMovelInfoTipo').textContent = m.tipo;
  document.getElementById('transfMovelInfoQtdBadge').textContent = `Qtd atual: ${m.quantidade || 1}`;

  const infoText = [
    m.marca ? `Marca: ${m.marca}` : null,
    m.patrimonio ? `Patrimônio: ${m.patrimonio}` : null,
    `Estado: ${m.estado || 'Bom'}`,
    m.valor ? `Valor: ${Number(m.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : null
  ].filter(Boolean).join(' • ');
  document.getElementById('transfMovelInfoDetalhes').textContent = infoText;

  const inpQtd = document.getElementById('transfMovelQtd');
  inpQtd.max = m.quantidade || 1;
  inpQtd.value = m.quantidade || 1;

  // Popula Casas de Destino
  const selCasa = document.getElementById('transfMovelCasaDestinoSelect');
  selCasa.innerHTML = (listaCasasCidade || []).map(casa => `
    <option value="${casa.id}" ${casa.id === casaId ? 'selected' : ''}>
      🏡 ${casa.nome} (${(casa.comodos || []).length} cômodos)
    </option>
  `).join('');

  aoMudarCasaDestinoTransferencia(selCasa.value);
  abrirModal('modalTransferirMovelCasa');
}

function aoMudarCasaDestinoTransferencia(casaDestinoId) {
  const casaOrigemId = document.getElementById('transfMovelCasaOrigemId').value;
  const comodoOrigemId = document.getElementById('transfMovelComodoOrigemId').value;

  const cDest = (listaCasasCidade || []).find(x => x.id === casaDestinoId);
  const selComodo = document.getElementById('transfMovelComodoDestinoSelect');
  if (!selComodo) return;

  if (!cDest || !cDest.comodos || cDest.comodos.length === 0) {
    selComodo.innerHTML = '<option value="" disabled>⚠️ Esta casa não possui cômodos cadastrados</option>';
    return;
  }

  // Filtrar cômodos válidos (se for na mesma casa, não transferir pro mesmo cômodo)
  const comodosValidos = cDest.comodos.filter(com => !(casaDestinoId === casaOrigemId && com.id === comodoOrigemId));

  if (comodosValidos.length === 0) {
    selComodo.innerHTML = '<option value="" disabled>⚠️ Selecione outra casa ou crie um novo cômodo</option>';
    return;
  }

  selComodo.innerHTML = comodosValidos.map(com => `
    <option value="${com.id}">
      🚪 ${com.nome} (${com.tipo === 'quarto' ? 'Quarto' : 'Área'})
    </option>
  `).join('');
}

async function confirmarTransferenciaMovelCasa(event) {
  event.preventDefault();

  const casaOrigemId = document.getElementById('transfMovelCasaOrigemId').value;
  const comodoOrigemId = document.getElementById('transfMovelComodoOrigemId').value;
  const movelId = document.getElementById('transfMovelId').value;

  const casaDestinoId = document.getElementById('transfMovelCasaDestinoSelect').value;
  const comodoDestinoId = document.getElementById('transfMovelComodoDestinoSelect').value;
  const qtdTransf = parseInt(document.getElementById('transfMovelQtd').value) || 1;
  const motivo = document.getElementById('transfMovelMotivo').value.trim();

  if (!casaDestinoId || !comodoDestinoId) {
    showToast('Selecione uma casa e cômodo de destino válidos.', 'warning');
    return;
  }

  const cOrigem = (listaCasasCidade || []).find(x => x.id === casaOrigemId);
  if (!cOrigem) return;
  const comOrigem = (cOrigem.comodos || []).find(x => x.id === comodoOrigemId);
  if (!comOrigem) return;
  const movOrigem = (comOrigem.moveis || []).find(x => x.id === movelId);
  if (!movOrigem) return;

  const cDestino = (listaCasasCidade || []).find(x => x.id === casaDestinoId);
  if (!cDestino) return;
  const comDestino = (cDestino.comodos || []).find(x => x.id === comodoDestinoId);
  if (!comDestino) {
    showToast('Cômodo de destino não encontrado.', 'error');
    return;
  }

  const qtdDisponivel = movOrigem.quantidade || 1;
  if (qtdTransf > qtdDisponivel) {
    showToast(`Quantidade excede o disponível no cômodo (${qtdDisponivel}).`, 'warning');
    return;
  }

  // 1. Debita da origem
  if (qtdTransf === qtdDisponivel) {
    comOrigem.moveis = (comOrigem.moveis || []).filter(x => x.id !== movelId);
  } else {
    movOrigem.quantidade = qtdDisponivel - qtdTransf;
  }

  // 2. Credita no destino
  comDestino.moveis = comDestino.moveis || [];
  const movCopia = {
    ...movOrigem,
    id: 'MOV-' + Date.now(),
    quantidade: qtdTransf,
    observacoes_transf: motivo ? `Transferido de ${cOrigem.nome} (${comOrigem.nome}): ${motivo}` : `Transferido de ${cOrigem.nome} (${comOrigem.nome})`
  };
  comDestino.moveis.push(movCopia);

  // 3. Salva no localStorage e Firestore
  localStorage.setItem('casas_cidade_cache', JSON.stringify(listaCasasCidade));
  atualizarDadosModalCasaDetalhes(cOrigem);
  fecharModal('modalTransferirMovelCasa');
  showToast(`Móvel "${movOrigem.tipo}" (${qtdTransf}x) transferido para ${cDestino.nome} - ${comDestino.nome}!`, 'success');

  registrarAuditoria(
    'casas',
    'MOVEL',
    movOrigem.tipo,
    `Transferiu ${qtdTransf}x "${movOrigem.tipo}" de "${cOrigem.nome} - ${comOrigem.nome}" para "${cDestino.nome} - ${comDestino.nome}"${motivo ? ' - Motivo: ' + motivo : ''}`
  );

  if (firestoreDb) {
    try {
      await firestoreDb.collection('casas_cidade').doc(casaOrigemId).update({
        comodos: cOrigem.comodos,
        atualizado_em: new Date().toISOString()
      });
      if (casaDestinoId !== casaOrigemId) {
        await firestoreDb.collection('casas_cidade').doc(casaDestinoId).update({
          comodos: cDestino.comodos,
          atualizado_em: new Date().toISOString()
        });
      }
    } catch (e) {
      console.warn("Erro ao salvar transferência no Firestore:", e);
    }
  }
}

// Devolver Móvel ao Estoque
function openModalDevolverMovelEstoque(casaId, comodoId, movelId) {
  const c = (listaCasasCidade || []).find(x => x.id === casaId);
  if (!c) return;
  const com = (c.comodos || []).find(x => x.id === comodoId);
  if (!com) return;
  const m = (com.moveis || []).find(x => x.id === movelId);
  if (!m) return;

  document.getElementById('formDevolverMovelEstoque').reset();
  document.getElementById('devolverMovelCasaOrigemId').value = casaId;
  document.getElementById('devolverMovelComodoOrigemId').value = comodoId;
  document.getElementById('devolverMovelId').value = movelId;

  document.getElementById('modalDevolverMovelSubtitulo').textContent = `Origem: ${c.nome} • ${com.nome}`;
  document.getElementById('devolverMovelInfoTipo').textContent = m.tipo;
  document.getElementById('devolverMovelInfoQtdBadge').textContent = `Disponível: ${m.quantidade || 1}x`;

  const infoText = [
    m.marca ? `Marca: ${m.marca}` : null,
    m.patrimonio ? `Patrimônio: ${m.patrimonio}` : null,
    m.valor ? `Valor: ${Number(m.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : null,
    m.empresa ? `Empresa: ${m.empresa}` : null
  ].filter(Boolean).join(' • ');
  document.getElementById('devolverMovelInfoDetalhes').textContent = infoText;

  const inpQtd = document.getElementById('devolverMovelQtd');
  inpQtd.max = m.quantidade || 1;
  inpQtd.value = m.quantidade || 1;

  if (document.getElementById('devolverMovelEstadoConservacao')) {
    document.getElementById('devolverMovelEstadoConservacao').value = m.estado || 'Bom';
  }
  if (document.getElementById('devolverMovelResponsavel')) {
    document.getElementById('devolverMovelResponsavel').value = currentUserName || 'Prefeito';
  }

  // Popula locais de destino no estoque
  const selLocal = document.getElementById('devolverMovelLocalEstoqueSelect');
  if (selLocal) {
    selLocal.innerHTML = (listaEstoqueLocais || ['Almoxarifado Central']).map(loc => `
      <option value="${loc}">${loc}</option>
    `).join('');
  }

  // Popula itens compatíveis do estoque
  const selItemEstoque = document.getElementById('devolverMovelItemEstoqueSelect');
  if (selItemEstoque) {
    let optionsHtml = '';
    const itemVinculado = m.estoque_origem_id ? (listaEstoqueItens || []).find(x => x.id === m.estoque_origem_id) : null;

    if (itemVinculado) {
      optionsHtml += `<option value="${itemVinculado.id}" selected>⭐ [Origem Vinculada] ${itemVinculado.nome} (Saldo atual: ${itemVinculado.quantidade || 0})</option>`;
    }

    // Procura itens com mesmo nome/tipo no estoque
    const itensCompativeis = (listaEstoqueItens || []).filter(x => !itemVinculado || x.id !== itemVinculado.id);
    if (itensCompativeis.length > 0) {
      optionsHtml += '<optgroup label="📦 Itens Existentes no Estoque:">';
      itensCompativeis.forEach(item => {
        const isMatch = (item.nome || '').toLowerCase().includes((m.tipo || '').toLowerCase());
        const mark = isMatch ? '✓ ' : '';
        optionsHtml += `<option value="${item.id}" ${!itemVinculado && isMatch ? 'selected' : ''}>${mark}${item.nome} - Saldo: ${item.quantidade || 0} (${item.local || 'Almoxarifado'})</option>`;
      });
      optionsHtml += '</optgroup>';
    }

    optionsHtml += `<option value="__novo__" ${!itemVinculado && itensCompativeis.length === 0 ? 'selected' : ''}>➕ Criar novo item no Estoque para este móvel</option>`;
    selItemEstoque.innerHTML = optionsHtml;
  }

  abrirModal('modalDevolverMovelEstoque');
}

async function confirmarDevolucaoMovelEstoque(event) {
  event.preventDefault();

  const casaId = document.getElementById('devolverMovelCasaOrigemId').value;
  const comodoId = document.getElementById('devolverMovelComodoOrigemId').value;
  const movelId = document.getElementById('devolverMovelId').value;

  const c = (listaCasasCidade || []).find(x => x.id === casaId);
  if (!c) return;
  const com = (c.comodos || []).find(x => x.id === comodoId);
  if (!com) return;
  const mov = (com.moveis || []).find(x => x.id === movelId);
  if (!mov) return;

  const qtdDevolver = parseInt(document.getElementById('devolverMovelQtd').value) || 1;
  const localDestino = document.getElementById('devolverMovelLocalEstoqueSelect').value;
  const itemEstoqueEscolhido = document.getElementById('devolverMovelItemEstoqueSelect').value;
  const estadoConservacao = document.getElementById('devolverMovelEstadoConservacao').value;
  const responsavel = document.getElementById('devolverMovelResponsavel').value.trim() || currentUserName || 'Prefeito';
  const motivo = document.getElementById('devolverMovelMotivo').value.trim();

  const qtdDisponivel = mov.quantidade || 1;
  if (qtdDevolver > qtdDisponivel) {
    showToast(`Quantidade a devolver (${qtdDevolver}) excede a quantidade atual (${qtdDisponivel}).`, 'warning');
    return;
  }

  // 1. Atualizar / Remover do cômodo da Casa
  if (qtdDevolver === qtdDisponivel) {
    com.moveis = (com.moveis || []).filter(x => x.id !== movelId);
  } else {
    mov.quantidade = qtdDisponivel - qtdDevolver;
  }

  // 2. Atualizar ou Criar Item no Estoque
  let itemEstoque = null;
  let saldoAnterior = 0;
  let novoSaldo = qtdDevolver;

  if (itemEstoqueEscolhido === '__novo__' || !itemEstoqueEscolhido) {
    const novoItemId = 'EST-' + Date.now();
    itemEstoque = {
      id: novoItemId,
      nome: mov.tipo,
      categoria: 'Móveis & Eletrodomésticos',
      marca: mov.marca || '',
      patrimonio: mov.patrimonio || '',
      valor: mov.valor || 0,
      empresa: mov.empresa || 'GEL',
      estado: estadoConservacao,
      local: localDestino,
      quantidade: qtdDevolver,
      unidade: 'UN',
      estoque_minimo: 1,
      criado_em: new Date().toISOString()
    };
    listaEstoqueItens.push(itemEstoque);
    saldoAnterior = 0;
    novoSaldo = qtdDevolver;

    if (firestoreDb) {
      try {
        firestoreDb.collection('estoque_itens').doc(novoItemId).set(itemEstoque);
      } catch (e) {}
    }
  } else {
    itemEstoque = (listaEstoqueItens || []).find(x => x.id === itemEstoqueEscolhido);
    if (itemEstoque) {
      saldoAnterior = Number(itemEstoque.quantidade || 0);
      novoSaldo = saldoAnterior + qtdDevolver;
      itemEstoque.quantidade = novoSaldo;
      if (localDestino && !itemEstoque.local) itemEstoque.local = localDestino;

      if (firestoreDb) {
        try {
          firestoreDb.collection('estoque_itens').doc(itemEstoque.id).update({
            quantidade: novoSaldo,
            atualizado_em: new Date().toISOString()
          });
        } catch (e) {}
      }
    }
  }

  // 3. Registrar Movimentação de Entrada por Devolução no Estoque
  const movEstoqueId = 'MOV-' + Date.now();
  const movEstoqueObj = {
    id: movEstoqueId,
    item_id: itemEstoque ? itemEstoque.id : movelId,
    item_nome: itemEstoque ? itemEstoque.nome : mov.tipo,
    tipo: 'entrada',
    quantidade: qtdDevolver,
    saldo_anterior: saldoAnterior,
    novo_saldo: novoSaldo,
    data: new Date().toISOString().split('T')[0],
    motivo: `Devolução da Casa: ${c.nome} (${com.nome})${motivo ? ` - ${motivo}` : ''}`,
    responsavel: responsavel,
    local: localDestino,
    estado_item: estadoConservacao,
    origem_casa_id: c.id,
    criado_em: new Date().toISOString()
  };

  listaEstoqueMovimentacoes.unshift(movEstoqueObj);

  // 4. Salvar nos caches locais
  try {
    localStorage.setItem('casas_cidade_cache', JSON.stringify(listaCasasCidade));
    localStorage.setItem('estoque_itens_cache', JSON.stringify(listaEstoqueItens));
    localStorage.setItem('estoque_movimentacoes_cache', JSON.stringify(listaEstoqueMovimentacoes));
  } catch (e) {}

  if (firestoreDb) {
    try {
      await firestoreDb.collection('casas_cidade').doc(casaId).update({
        comodos: c.comodos,
        atualizado_em: new Date().toISOString()
      });
      firestoreDb.collection('estoque_movimentacoes').doc(movEstoqueId).set(movEstoqueObj);
    } catch (e) {}
  }

  // 5. Atualizar Interfaces
  atualizarDadosModalCasaDetalhes(c);
  if (typeof atualizarContadoresEstoqueUI === 'function') atualizarContadoresEstoqueUI();
  if (activeTab === 'estoque' && typeof filtrarEstoqueUI === 'function') filtrarEstoqueUI();

  fecharModal('modalDevolverMovelEstoque');
  showToast(`Móvel "${mov.tipo}" (${qtdDevolver}x) devolvido com sucesso ao ${localDestino}!`, 'success');

  registrarAuditoria(
    'casas',
    'MOVEL',
    mov.tipo,
    `Devolveu ${qtdDevolver}x "${mov.tipo}" de "${c.nome} - ${com.nome}" para o almoxarifado (${localDestino})`,
    responsavel
  );
}

// Ações de Móvel / Eletro
function popularSelectMovelEstoque() {
  const select = document.getElementById('movelComodoOrigemEstoqueSelect');
  if (!select) return;

  const aviso = document.getElementById('movelComodoOrigemEstoqueAviso');
  const checkBaixar = document.getElementById('movelComodoBaixarEstoqueCheckContainer');
  if (aviso) aviso.classList.add('hidden');
  if (checkBaixar) checkBaixar.classList.add('hidden');

  const itensDisponiveis = (listaEstoqueItens || []).filter(item => Number(item.quantidade || 0) > 0);

  if (itensDisponiveis.length === 0) {
    select.innerHTML = `
      <option value="">➕ Não, quero cadastrar móvel avulso diretamente na casa</option>
      <option value="" disabled>⚠️ Nenhum móvel com saldo disponível no estoque</option>
    `;
    return;
  }

  let optionsHtml = '<option value="">➕ Não, quero cadastrar móvel avulso diretamente na casa</option>';
  optionsHtml += '<optgroup label="📦 Itens disponíveis no Estoque / Galpões:">';
  
  itensDisponiveis.forEach(item => {
    const temPatrimonio = item.patrimonio ? ` [Patrimônio: ${item.patrimonio}]` : '';
    const local = item.local ? ` (${item.local})` : '';
    const qtd = `${item.quantidade} ${item.unidade || 'UN'} disponíveis`;
    optionsHtml += `<option value="${item.id}">📦 ${item.nome} - Saldo: ${qtd}${temPatrimonio}${local}</option>`;
  });

  optionsHtml += '</optgroup>';
  select.innerHTML = optionsHtml;
}

function aoSelecionarMovelOrigemEstoque(itemId) {
  const aviso = document.getElementById('movelComodoOrigemEstoqueAviso');
  const checkBaixar = document.getElementById('movelComodoBaixarEstoqueCheckContainer');

  if (!itemId) {
    if (aviso) aviso.classList.add('hidden');
    if (checkBaixar) checkBaixar.classList.add('hidden');
    return;
  }

  const item = (listaEstoqueItens || []).find(x => x.id === itemId);
  if (!item) return;

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  setVal('movelComodoFormTipo', item.nome || '');
  setVal('movelComodoFormMarca', item.marca || '');
  setVal('movelComodoFormPatrimonio', item.patrimonio || '');
  setVal('movelComodoFormValor', item.valor || '');
  setVal('movelComodoFormEmpresa', item.empresa || 'GEL');
  setVal('movelComodoFormQtd', 1);

  if (aviso) aviso.classList.remove('hidden');
  if (checkBaixar) checkBaixar.classList.remove('hidden');
}

function openModalNovoMovelComodo(casaId, comodoId) {
  const form = document.getElementById('formMovelComodo');
  if (form) form.reset();
  document.getElementById('movelComodoFormCasaId').value = casaId;
  document.getElementById('movelComodoFormComodoId').value = comodoId;
  document.getElementById('movelComodoFormId').value = '';
  document.getElementById('movelComodoFormEstado').value = 'Bom';
  document.getElementById('movelComodoFormQtd').value = 1;
  popularSelectMovelEstoque();
  abrirModal('modalMovelComodoForm');
}

async function salvarMovelComodo(event) {
  event.preventDefault();

  const casaId = document.getElementById('movelComodoFormCasaId').value;
  const comodoId = document.getElementById('movelComodoFormComodoId').value;

  const casa = listaCasasCidade.find(c => c.id === casaId);
  if (!casa) return;
  const comodo = (casa.comodos || []).find(cm => cm.id === comodoId);
  if (!comodo) return;

  const tipo = document.getElementById('movelComodoFormTipo').value.trim();
  const qtd = parseInt(document.getElementById('movelComodoFormQtd').value) || 1;
  const estado = document.getElementById('movelComodoFormEstado').value;
  const marca = document.getElementById('movelComodoFormMarca') ? document.getElementById('movelComodoFormMarca').value.trim() : '';
  const patrimonio = document.getElementById('movelComodoFormPatrimonio') ? document.getElementById('movelComodoFormPatrimonio').value.trim() : '';
  const valor = document.getElementById('movelComodoFormValor') ? (parseFloat(document.getElementById('movelComodoFormValor').value) || 0) : 0;
  const empresa = document.getElementById('movelComodoFormEmpresa') ? document.getElementById('movelComodoFormEmpresa').value.trim() : '';

  // Verificar se veio do estoque e se deve dar baixa
  const estoqueItemId = document.getElementById('movelComodoOrigemEstoqueSelect') ? document.getElementById('movelComodoOrigemEstoqueSelect').value : '';
  const deveBaixarEstoque = document.getElementById('movelComodoBaixarEstoqueCheck') && document.getElementById('movelComodoBaixarEstoqueCheck').checked;

  const movelId = 'MOV-' + Date.now();
  const novoMovel = {
    id: movelId,
    tipo: tipo,
    quantidade: qtd,
    estado: estado,
    marca: marca,
    patrimonio: patrimonio,
    valor: valor,
    empresa: empresa,
    estoque_origem_id: estoqueItemId || null
  };

  comodo.moveis = comodo.moveis || [];
  comodo.moveis.push(novoMovel);

  localStorage.setItem('casas_cidade_cache', JSON.stringify(listaCasasCidade));
  atualizarDadosModalCasaDetalhes(casa);
  fecharModal('modalMovelComodoForm');

  // Baixa automática no estoque se solicitado
  if (estoqueItemId && deveBaixarEstoque) {
    const itemEstoque = (listaEstoqueItens || []).find(x => x.id === estoqueItemId);
    if (itemEstoque) {
      const saldoAnterior = Number(itemEstoque.quantidade || 0);
      const novoSaldo = Math.max(0, saldoAnterior - qtd);
      itemEstoque.quantidade = novoSaldo;

      const movId = 'MOV-' + Date.now();
      const movObj = {
        id: movId,
        item_id: estoqueItemId,
        item_nome: itemEstoque.nome,
        tipo: 'saida',
        quantidade: qtd,
        saldo_anterior: saldoAnterior,
        novo_saldo: novoSaldo,
        data: new Date().toISOString().split('T')[0],
        motivo: `Alocado na Casa: ${casa.nome} (${comodo.nome})`,
        responsavel: 'Almoxarifado / Casas',
        local: itemEstoque.local || 'Almoxarifado',
        criado_em: new Date().toISOString()
      };

      listaEstoqueMovimentacoes.unshift(movObj);
      try {
        localStorage.setItem('estoque_itens_cache', JSON.stringify(listaEstoqueItens));
        localStorage.setItem('estoque_movimentacoes_cache', JSON.stringify(listaEstoqueMovimentacoes));
      } catch (e) {}

      atualizarContadoresEstoqueUI();
      filtrarEstoqueUI();

      if (firestoreDb) {
        try {
          firestoreDb.collection('estoque_itens').doc(estoqueItemId).update({
            quantidade: novoSaldo,
            atualizado_em: new Date().toISOString()
          });
          firestoreDb.collection('estoque_movimentacoes').doc(movId).set(movObj);
        } catch (e) {}
      }
    }
  }

  showToast(`Móvel "${tipo}" cadastrado com sucesso!`, 'success');

  registrarAuditoria(
    'casas',
    'MOVEL',
    tipo,
    `Adicionou móvel "${tipo}" (${qtd}x) no cômodo "${comodo.nome}" da casa "${casa.nome}"`
  );

  if (firestoreDb) {
    try {
      await firestoreDb.collection('casas_cidade').doc(casaId).update({
        comodos: casa.comodos,
        atualizado_em: new Date().toISOString()
      });
    } catch (err) {
      console.warn("Erro ao adicionar móvel no Firestore:", err);
    }
  }
}

async function excluirMovelComodo(casaId, comodoId, movelId) {
  const casa = listaCasasCidade.find(c => c.id === casaId);
  if (!casa) return;
  const comodo = (casa.comodos || []).find(cm => cm.id === comodoId);
  if (!comodo) return;

  if (!confirm('Deseja remover este item do cômodo?')) return;

  comodo.moveis = (comodo.moveis || []).filter(m => m.id !== movelId);

  localStorage.setItem('casas_cidade_cache', JSON.stringify(listaCasasCidade));
  atualizarDadosModalCasaDetalhes(casa);
  showToast('Item removido do cômodo.', 'info');

  registrarAuditoria(
    'casas',
    'MOVEL',
    comodo.nome,
    `Removeu item móvel do cômodo "${comodo.nome}" da casa "${casa.nome}"`
  );

  if (firestoreDb) {
    try {
      await firestoreDb.collection('casas_cidade').doc(casaId).update({
        comodos: casa.comodos,
        atualizado_em: new Date().toISOString()
      });
    } catch (err) {
      console.warn("Erro ao excluir móvel no Firestore:", err);
    }
  }
}

// Ações de Despesas / Contas de Consumo
function openModalNovaDespesaCasa(casaId) {
  popularSelectCasasDespesa(casaId);
  document.getElementById('formDespesaCasa').reset();
  document.getElementById('despesaCasaFormId').value = '';
  document.getElementById('despesaCasaFormCasaId').value = casaId;
  document.getElementById('despesaCasaFormMes').value = getMesAtualStr();
  document.getElementById('statusPendenteRadio').checked = true;
  abrirModal('modalDespesaCasaForm');
}

function openModalNovaDespesaCasaGlobal() {
  if (listaCasasCidade.length === 0) {
    showToast('Cadastre ao menos uma casa antes de lançar despesas.', 'warning');
    return;
  }
  const casaPadrao = casaSelecionadaId || listaCasasCidade[0].id;
  openModalNovaDespesaCasa(casaPadrao);
}

function popularSelectCasasDespesa(selectedId) {
  const select = document.getElementById('despesaCasaFormCasaId');
  if (!select) return;

  select.innerHTML = listaCasasCidade.map(c => `
    <option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.nome} (${c.bairro || c.endereco || ''})</option>
  `).join('');
}

async function salvarDespesaCasa(event) {
  event.preventDefault();

  const id = document.getElementById('despesaCasaFormId').value || ('DESP-' + Date.now());
  const casaId = document.getElementById('despesaCasaFormCasaId').value;
  const categoria = document.getElementById('despesaCasaFormCategoria').value;
  const mes = document.getElementById('despesaCasaFormMes').value;
  const valor = parseFloat(document.getElementById('despesaCasaFormValor').value) || 0;
  const vencimento = document.getElementById('despesaCasaFormVencimento').value;
  const status = document.getElementById('statusPagoRadio').checked ? 'pago' : 'pendente';
  const obs = document.getElementById('despesaCasaFormObs').value.trim();

  const casa = listaCasasCidade.find(c => c.id === casaId);
  const casaNome = casa ? casa.nome : 'Casa';

  const despesaData = {
    casa_id: casaId,
    casa_nome: casaNome,
    categoria: categoria,
    mes_referencia: mes,
    valor: valor,
    vencimento: vencimento,
    status: status,
    observacoes: obs,
    criado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString()
  };

  const idx = listaDespesasCasas.findIndex(x => x.id === id);
  if (idx >= 0) {
    listaDespesasCasas[idx] = { id: id, ...despesaData };
  } else {
    listaDespesasCasas.push({ id: id, ...despesaData });
  }

  localStorage.setItem('casas_despesas_cache', JSON.stringify(listaDespesasCasas));
  atualizarContadoresCasasUI();
  fecharModal('modalDespesaCasaForm');
  showToast(`Conta de ${categoria} salva com sucesso!`, 'success');

  if (casaSelecionadaId === casaId && abaAtivaCasaDetalhes === 'despesas') {
    carregarDespesasCasaAtual();
  }

  if (firestoreDb) {
    try {
      await firestoreDb.collection('casas_despesas').doc(id).set(despesaData, { merge: true });
    } catch (err) {
      console.warn("Erro ao salvar despesa no Firestore:", err);
    }
  }
}

// Carregar e renderizar despesas da casa atual
function carregarDespesasCasaAtual() {
  if (!casaSelecionadaId) return;

  const mesFiltro = document.getElementById('filtroMesDespesaCasaInput')?.value || getMesAtualStr();
  const container = document.getElementById('casaDetalhesDespesasTabela');
  const vazio = document.getElementById('casaDetalhesDespesasVazio');
  if (!container) return;

  const despesasCasa = listaDespesasCasas.filter(d => d.casa_id === casaSelecionadaId && (d.mes_referencia || '').startsWith(mesFiltro));

  const total = despesasCasa.reduce((acc, curr) => acc + (Number(curr.valor) || 0), 0);
  const totalPago = despesasCasa.filter(d => d.status === 'pago').reduce((acc, curr) => acc + (Number(curr.valor) || 0), 0);
  const totalPendente = despesasCasa.filter(d => d.status === 'pendente').reduce((acc, curr) => acc + (Number(curr.valor) || 0), 0);

  document.getElementById('modalCasaDespesaTotalMes').textContent = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  document.getElementById('modalCasaDespesaTotalPendente').textContent = totalPendente.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  document.getElementById('modalCasaDespesaTotalPago').textContent = totalPago.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  document.getElementById('modalCasaDespesaQtdContas').textContent = despesasCasa.length;

  if (despesasCasa.length === 0) {
    container.innerHTML = '';
    vazio.classList.remove('hidden');
    return;
  }
  vazio.classList.add('hidden');

  const iconeDespesa = (cat) => {
    if (cat.includes('Energia')) return 'fa-solid fa-bolt text-yellow-500';
    if (cat.includes('Água')) return 'fa-solid fa-droplet text-cyan-500';
    if (cat.includes('Aluguel')) return 'fa-solid fa-house text-emerald-500';
    if (cat.includes('Internet')) return 'fa-solid fa-wifi text-indigo-500';
    if (cat.includes('Gás')) return 'fa-solid fa-fire text-amber-500';
    return 'fa-solid fa-file-invoice-dollar text-slate-500';
  };

  container.innerHTML = despesasCasa.map(d => {
    const ehPago = d.status === 'pago';
    const vencFormatado = d.vencimento ? new Date(d.vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : '--';

    return `
      <div class="bg-white p-3.5 rounded-xl border ${ehPago ? 'border-slate-200' : 'border-amber-300 bg-amber-50/20'} flex items-center justify-between gap-3 shadow-xs">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-lg flex-shrink-0">
            <i class="${iconeDespesa(d.categoria)}"></i>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h5 class="text-xs font-bold text-slate-900">${d.categoria}</h5>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${ehPago ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800 border border-amber-300'}">
                ${ehPago ? '🟢 Pago' : '🟡 A Vencer / Pendente'}
              </span>
            </div>
            <p class="text-[11px] text-slate-500 mt-0.5">
              Vencimento: <strong class="text-slate-700">${vencFormatado}</strong> ${d.observacoes ? '• ' + d.observacoes : ''}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <span class="text-sm font-black text-slate-900">
            ${(Number(d.valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </span>

          <button onclick="alternarStatusDespesaCasa('${d.id}')" class="btn-prefeito px-2.5 py-1.5 rounded-lg ${ehPago ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-emerald-600 hover:bg-emerald-700 text-white'} text-xs font-bold transition flex items-center gap-1">
            <i class="fa-solid ${ehPago ? 'fa-rotate-left' : 'fa-check'} text-[10px]"></i>
            <span>${ehPago ? 'Reabrir' : 'Dar Baixa'}</span>
          </button>

          <button onclick="excluirDespesaCasa('${d.id}')" class="btn-prefeito p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 text-xs transition" title="Excluir Lançamento">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function alternarStatusDespesaCasa(despesaId) {
  const d = listaDespesasCasas.find(x => x.id === despesaId);
  if (!d) return;

  const novoStatus = d.status === 'pago' ? 'pendente' : 'pago';
  d.status = novoStatus;

  localStorage.setItem('casas_despesas_cache', JSON.stringify(listaDespesasCasas));
  atualizarContadoresCasasUI();
  if (typeof filtrarPainelDespesasCasasUI === 'function') filtrarPainelDespesasCasasUI();
  if (casaSelecionadaId && abaAtivaCasaDetalhes === 'despesas') {
    carregarDespesasCasaAtual();
  }
  showToast(`Conta de ${d.categoria} marcada como "${novoStatus === 'pago' ? 'Paga' : 'Pendente'}"!`, 'success');

  if (firestoreDb) {
    try {
      await firestoreDb.collection('casas_despesas').doc(despesaId).update({
        status: novoStatus,
        atualizado_em: new Date().toISOString()
      });
    } catch (err) {
      console.warn("Erro ao atualizar status da conta no Firestore:", err);
    }
  }
}

async function excluirDespesaCasa(despesaId) {
  if (!confirm('Deseja realmente excluir este lançamento de conta?')) return;

  listaDespesasCasas = listaDespesasCasas.filter(x => x.id !== despesaId);
  localStorage.setItem('casas_despesas_cache', JSON.stringify(listaDespesasCasas));
  atualizarContadoresCasasUI();
  if (typeof filtrarPainelDespesasCasasUI === 'function') filtrarPainelDespesasCasasUI();
  if (casaSelecionadaId && abaAtivaCasaDetalhes === 'despesas') {
    carregarDespesasCasaAtual();
  }
  showToast('Lançamento excluído com sucesso.', 'info');

  if (firestoreDb) {
    try {
      await firestoreDb.collection('casas_despesas').doc(despesaId).delete();
    } catch (err) {
      console.warn("Erro ao excluir conta no Firestore:", err);
    }
  }
}

function recarregarCasasCidadeManual() {
  const icone = document.getElementById('iconeReloadCasas');
  if (icone) icone.classList.add('fa-spin');
  showToast('Recarregando dados das casas...', 'info');

  if (firestoreDb) {
    Promise.all([
      firestoreDb.collection('casas_cidade').get(),
      firestoreDb.collection('casas_despesas').get(),
      firestoreDb.collection('casas_limpezas').get()
    ]).then(([snapCasas, snapDesp, snapLimp]) => {
      const novasCasas = [];
      snapCasas.forEach(doc => novasCasas.push({ id: doc.id, ...doc.data() }));
      novasCasas.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
      listaCasasCidade = novasCasas;

      const novasDesp = [];
      snapDesp.forEach(doc => novasDesp.push({ id: doc.id, ...doc.data() }));
      novasDesp.sort((a, b) => new Date(b.vencimento || 0) - new Date(a.vencimento || 0));
      listaDespesasCasas = novasDesp;

      const novasLimp = [];
      snapLimp.forEach(doc => novasLimp.push({ id: doc.id, ...doc.data() }));
      novasLimp.sort((a, b) => new Date(b.data_hora || (b.data + 'T' + (b.hora || '00:00'))) - new Date(a.data_hora || (a.data + 'T' + (a.hora || '00:00'))));
      listaLimpezasCasas = novasLimp;
      if (typeof sanitizarDatasLimpezasCache === 'function') {
        sanitizarDatasLimpezasCache();
      }

      localStorage.setItem('casas_cidade_cache', JSON.stringify(listaCasasCidade));
      localStorage.setItem('casas_despesas_cache', JSON.stringify(listaDespesasCasas));
      localStorage.setItem('casas_limpezas_cache', JSON.stringify(listaLimpezasCasas));

      atualizarContadoresCasasUI();
      filtrarCasasCidadeUI();
      if (icone) icone.classList.remove('fa-spin');
      showToast('Dados das Casas sincronizados com sucesso!', 'success');
    }).catch(err => {
      if (icone) icone.classList.remove('fa-spin');
      showToast('Erro ao recarregar: ' + err.message, 'error');
    });
  } else {
    if (icone) icone.classList.remove('fa-spin');
    filtrarCasasCidadeUI();
  }
}

// ========================================================
// MÓDULO DE CONTROLE DE LIMPEZA & MANUTENÇÃO VIA QR CODE
// ========================================================

// Formatador seguro de data sem problemas de fuso horário
function formatarDataLimpezaBR(dataStr) {
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
}

// Obter link público direto para o QR Code da Casa (Acesso exclusivo e isolado para a equipe de limpeza)
function getQRCodeUrlCasa(casaId) {
  const href = window.location.href;
  let cleanUrl = href.split('?')[0].split('#')[0];
  if (cleanUrl.includes('index.html')) {
    cleanUrl = cleanUrl.replace('index.html', 'limpeza.html');
  } else {
    cleanUrl = cleanUrl.endsWith('/') ? `${cleanUrl}limpeza.html` : `${cleanUrl}/limpeza.html`;
  }
  return `${cleanUrl}?casa_id=${encodeURIComponent(casaId)}`;
}

// Helper universal para obter data no fuso local (YYYY-MM-DD) sem problemas de fuso horário UTC
function getDataHojeLocal(dataObj = new Date()) {
  const d = dataObj instanceof Date ? dataObj : new Date(dataObj);
  if (isNaN(d.getTime())) return new Date().toLocaleDateString('en-CA');
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Obter data/hora efetiva do registro considerando fuso horário local e criado_em
function obterDataHoraEfetivaLimpeza(registro) {
  if (!registro) return null;

  const agora = new Date();
  const hojeZero = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());

  // 1. Se tem criado_em com ISO timestamp, converter para a data local real do Brasil
  if (registro.criado_em) {
    const dtCriado = new Date(registro.criado_em);
    if (!isNaN(dtCriado.getTime())) {
      const dataStr = getDataHojeLocal(dtCriado);
      const dataZero = new Date(dtCriado.getFullYear(), dtCriado.getMonth(), dtCriado.getDate());
      return {
        dataStr: dataStr,
        dataZero: dataZero,
        hora: registro.hora || dtCriado.toTimeString().slice(0, 5),
        diffDias: Math.max(0, Math.floor((hojeZero - dataZero) / (1000 * 60 * 60 * 24)))
      };
    }
  }

  // 2. Extrair data e hora dos campos
  const strData = String(registro.data || '').split('T')[0].trim();
  if (strData) {
    const partes = strData.split('-');
    if (partes.length === 3) {
      const ano = parseInt(partes[0], 10);
      const mes = parseInt(partes[1], 10) - 1;
      const dia = parseInt(partes[2], 10);
      let dt = new Date(ano, mes, dia);

      // Correção de timezone: Se a data foi salva como "hoje", mas o horário é no futuro em relação ao horário atual
      // (ex: hora 21:58 ou 22:26 e agora são 13:00): indica que o registro foi feito ontem à noite sob o bug do UTC!
      if (ano === agora.getFullYear() && mes === agora.getMonth() && dia === agora.getDate()) {
        if (registro.hora) {
          const [hReg, mReg] = String(registro.hora).split(':').map(Number);
          const minReg = (hReg || 0) * 60 + (mReg || 0);
          const minAgora = agora.getHours() * 60 + agora.getMinutes();
          if (minReg > minAgora + 30) {
            // Corrige para ontem
            dt = new Date(ano, mes, dia - 1);
          }
        }
      }

      const diff = Math.max(0, Math.floor((hojeZero - dt) / (1000 * 60 * 60 * 24)));
      return {
        dataStr: getDataHojeLocal(dt),
        dataZero: dt,
        hora: registro.hora || '--:--',
        diffDias: diff
      };
    }
  }

  return null;
}

// Sanitização automática de registros com data futura por fuso horário UTC
function sanitizarDatasLimpezasCache() {
  if (!Array.isArray(listaLimpezasCasas)) return;
  let alterado = false;
  const agora = new Date();
  listaLimpezasCasas.forEach(reg => {
    if (reg.criado_em) {
      const dtCriado = new Date(reg.criado_em);
      if (!isNaN(dtCriado.getTime())) {
        const dataReal = getDataHojeLocal(dtCriado);
        if (reg.data !== dataReal) {
          reg.data = dataReal;
          alterado = true;
        }
      }
    } else if (reg.data && reg.hora) {
      const partes = String(reg.data).split('-');
      if (partes.length === 3) {
        const y = parseInt(partes[0], 10);
        const m = parseInt(partes[1], 10) - 1;
        const d = parseInt(partes[2], 10);
        if (y === agora.getFullYear() && m === agora.getMonth() && d === agora.getDate()) {
          const [h, min] = String(reg.hora).split(':').map(Number);
          if ((h * 60 + min) > (agora.getHours() * 60 + agora.getMinutes() + 30)) {
            const dtOntem = new Date(y, m, d - 1);
            reg.data = getDataHojeLocal(dtOntem);
            alterado = true;
          }
        }
      }
    }
  });
  if (alterado) {
    try {
      localStorage.setItem('casas_limpezas_cache', JSON.stringify(listaLimpezasCasas));
    } catch(e) {}
    if (typeof firestoreDb !== 'undefined' && firestoreDb) {
      listaLimpezasCasas.forEach(reg => {
        if (reg.id) {
          firestoreDb.collection('casas_limpezas').doc(reg.id).update({ data: reg.data }).catch(() => {});
        }
      });
    }
  }
}

// Calcular status de limpeza da casa ou quarto (Rotina Diária e Ar Condicionado 30 dias)
function calcularStatusLimpezasCasa(casaId, quartoObj = null) {
  const limpezasCasa = (listaLimpezasCasas || []).filter(l => {
    if (l.casa_id === casaId) return true;
    if (quartoObj) {
      if (String(l.quarto_id) === String(quartoObj.id)) return true;
      if (l.tipo_local === 'alojamento' && String(l.quarto_numero) === String(quartoObj.numero) && (!l.bloco_nome || String(l.bloco_nome).toLowerCase() === String(quartoObj.bloco_nome || '').toLowerCase())) return true;
    }
    return false;
  });

  // Ordenar por data_hora decrescente
  const rotinas = limpezasCasa
    .filter(l => l.tipo === 'rotina' || !l.tipo)
    .sort((a, b) => new Date(b.data_hora || (b.data + 'T' + (b.hora || '00:00'))) - new Date(a.data_hora || (a.data + 'T' + (a.hora || '00:00'))));

  const arConds = limpezasCasa
    .filter(l => l.tipo === 'ar_condicionado')
    .sort((a, b) => new Date(b.data_hora || (b.data + 'T' + (b.hora || '00:00'))) - new Date(a.data_hora || (a.data + 'T' + (a.hora || '00:00'))));

  // 1. Status Faxina Diária (Rotina)
  // Regra do Usuário:
  // - Feita no dia (hoje): VERDE (Em dia)
  // - Não feita no dia (hoje pendente): AMARELINHO (Pendente)
  // - Se passou o dia: AMARELINHO (Pendente / Atrasada)
  // - Quando faz a faxina: fica VERDE
  let stRotina = {
    status: 'pendente',
    textoCurto: 'Pendente hoje',
    textoDetalhe: 'Pendente: nenhuma limpeza de rotina realizada hoje',
    subtexto: 'Aguardando faxina diária',
    badgeLabel: 'PENDENTE',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
    cardBg: 'bg-amber-50/80 border-amber-300 hover:border-amber-400',
    badgeDot: 'bg-amber-500 animate-pulse',
    cor: 'amber',
    tooltip: 'Faxina de hoje pendente. Clique para registrar.'
  };

  if (rotinas.length > 0) {
    const ultRotina = rotinas[0];
    const infoRotina = obterDataHoraEfetivaLimpeza(ultRotina);
    const diffDias = infoRotina ? infoRotina.diffDias : 1;
    const horaFormatada = (infoRotina && infoRotina.hora) || ultRotina.hora || '--:--';

    if (diffDias === 0) {
      // FEITA HOJE: VERDE
      stRotina = {
        status: 'ok',
        textoCurto: `Hoje às ${horaFormatada}`,
        textoDetalhe: `Realizada hoje às ${horaFormatada} (${ultRotina.responsavel || 'Equipe'})`,
        subtexto: `Hoje às ${horaFormatada} por ${ultRotina.responsavel || 'Equipe'}`,
        badgeLabel: 'EM DIA',
        badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
        cardBg: 'bg-emerald-50/80 border-emerald-200 hover:border-emerald-300',
        badgeDot: 'bg-emerald-500 shadow-xs',
        cor: 'emerald',
        tooltip: `Limpeza realizada hoje às ${horaFormatada} por ${ultRotina.responsavel || 'Equipe'}. Clique para ver histórico.`
      };
    } else if (diffDias === 1) {
      // NÃO FEITA HOJE (última ontem): AMARELINHO
      stRotina = {
        status: 'pendente',
        textoCurto: 'Pendente hoje',
        textoDetalhe: `Pendente: faxina de hoje ainda não realizada (última ontem às ${horaFormatada})`,
        subtexto: `Ontem às ${horaFormatada} por ${ultRotina.responsavel || 'Equipe'}`,
        badgeLabel: 'PENDENTE',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
        cardBg: 'bg-amber-50/80 border-amber-300 hover:border-amber-400',
        badgeDot: 'bg-amber-500 animate-pulse',
        cor: 'amber',
        tooltip: `Última faxina foi ontem às ${horaFormatada}. Faxina de hoje pendente!`
      };
    } else {
      // PASSOU DO DIA: AMARELINHO PENDENTE
      stRotina = {
        status: 'pendente',
        textoCurto: `Pendente (${diffDias}d)`,
        textoDetalhe: `Pendente: há ${diffDias} dias sem faxina diária`,
        subtexto: `Última há ${diffDias} dias (${formatarDataLimpezaBR(infoRotina ? infoRotina.dataStr : ultRotina.data)})`,
        badgeLabel: 'PENDENTE',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
        cardBg: 'bg-amber-50/80 border-amber-300 hover:border-amber-400',
        badgeDot: 'bg-amber-500 animate-pulse',
        cor: 'amber',
        tooltip: `Faxina pendente! Última realizada há ${diffDias} dias (${formatarDataLimpezaBR(infoRotina ? infoRotina.dataStr : ultRotina.data)}).`
      };
    }
  }

  // 2. Status Ar Condicionado (Ciclo 30 dias)
  // Regra do Usuário:
  // - Nos 30 dias: VERDINHO (Tudo certo)
  // - Passou dos 30 dias: VERMELHO (Passou do tempo)
  let stAr = {
    status: 'vencido',
    textoCurto: 'Passou do tempo!',
    textoDetalhe: 'Nenhuma higienização de ar condicionado registrada (prazo excedido)',
    subtexto: 'Ciclo de 30 dias pendente',
    badgeLabel: 'PASSOU TEMPO',
    badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
    cardBg: 'bg-rose-50/90 border-rose-300 hover:border-rose-400',
    badgeDot: 'bg-rose-500 animate-pulse',
    cor: 'rose',
    tooltip: 'Nenhuma higienização de ar registrada. Prazo de 30 dias excedido!'
  };

  if (arConds.length > 0) {
    const ultAr = arConds[0];
    const infoAr = obterDataHoraEfetivaLimpeza(ultAr);
    const diffDias = infoAr ? infoAr.diffDias : 0;
    const diasRestantes = Math.max(0, 30 - diffDias);
    const dataStrFormatada = formatarDataLimpezaBR(infoAr ? infoAr.dataStr : ultAr.data);

    if (diffDias <= 30) {
      // DENTRO DOS 30 DIAS: VERDINHO TUDO CERTO
      stAr = {
        status: 'ok',
        textoCurto: diffDias === 0 ? 'Em dia (hoje)' : `Em dia (${diffDias}d atrás)`,
        textoDetalhe: `Tudo certo: faltam ${diasRestantes} dias para o próximo ciclo de 30 dias`,
        subtexto: `Última há ${diffDias} dia${diffDias === 1 ? '' : 's'} (${dataStrFormatada})`,
        badgeLabel: 'EM DIA',
        badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
        cardBg: 'bg-emerald-50/80 border-emerald-200 hover:border-emerald-300',
        badgeDot: 'bg-emerald-500 shadow-xs',
        cor: 'emerald',
        tooltip: `Ar condicionado higienizado há ${diffDias} dia${diffDias === 1 ? '' : 's'}. Próxima manutenção em ${diasRestantes} dias.`
      };
    } else {
      // PASSOU DOS 30 DIAS: VERMELHO PASSOU DO TEMPO
      const diasVencido = diffDias - 30;
      stAr = {
        status: 'vencido',
        textoCurto: `Passou do tempo! (+${diasVencido}d)`,
        textoDetalhe: `PASSOU DO TEMPO: prazo de 30 dias ultrapassado em ${diasVencido} dia${diasVencido === 1 ? '' : 's'}!`,
        subtexto: `Última há ${diffDias} dias (${dataStrFormatada})`,
        badgeLabel: 'PASSOU TEMPO',
        badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
        cardBg: 'bg-rose-50/90 border-rose-300 hover:border-rose-400',
        badgeDot: 'bg-rose-500 animate-ping',
        cor: 'rose',
        tooltip: `Atenção: Prazo de 30 dias estourado há ${diasVencido} dia${diasVencido === 1 ? '' : 's'}! Agendar higienização urgente.`
      };
    }
  }

  const ultGeral = limpezasCasa.length > 0
    ? [...limpezasCasa].sort((a, b) => new Date(b.data_hora || (b.data + 'T' + (b.hora || '00:00'))) - new Date(a.data_hora || (a.data + 'T' + (a.hora || '00:00'))))[0]
    : null;

  return {
    rotina: stRotina,
    ar: stAr,
    totalRegistros: limpezasCasa.length,
    ultResponsavel: ultGeral ? (ultGeral.responsavel || 'Equipe') : '—'
  };
}

// Calcular status de limpeza para um Quarto do Alojamento
function calcularStatusLimpezaQuarto(q) {
  if (!q) return calcularStatusLimpezasCasa('quarto_invalido');
  return calcularStatusLimpezasCasa('quarto_' + q.id, q);
}

// Obter link público direto para o QR Code de um Quarto do Alojamento
function getQRCodeUrlQuarto(q) {
  const href = window.location.href;
  let cleanUrl = href.split('?')[0].split('#')[0];
  if (cleanUrl.includes('index.html')) {
    cleanUrl = cleanUrl.replace('index.html', 'limpeza.html');
  } else {
    cleanUrl = cleanUrl.endsWith('/') ? `${cleanUrl}limpeza.html` : `${cleanUrl}/limpeza.html`;
  }
  const qId = q ? q.id : '';
  const qNum = q ? q.numero : '';
  const qBloco = q ? (q.bloco_nome || 'Bloco') : 'Bloco';
  return `${cleanUrl}?quarto_id=${encodeURIComponent(qId)}&quarto_num=${encodeURIComponent(qNum)}&bloco=${encodeURIComponent(qBloco)}`;
}

// Abrir modal com placa QR Code da Casa (Impressão A4)
function abrirModalPlacaQRCasa(casaId) {
  const c = (listaCasasCidade || []).find(x => x.id === casaId);
  if (!c) {
    showToast('Casa não encontrada para gerar placa.', 'warning');
    return;
  }

  const qrUrl = getQRCodeUrlCasa(casaId);
  const imgEl = document.getElementById('imgPlacaQRCasa');
  const txtUrlEl = document.getElementById('textoPlacaQRCasaUrl');
  const titEl = document.getElementById('placaCasaTitulo');
  const endEl = document.getElementById('placaCasaEndereco');
  const catEl = document.getElementById('placaCasaCategoriaLabel');

  if (catEl) catEl.textContent = 'Prefeitura de Canteiro • Residência Urbana';
  if (titEl) titEl.textContent = (c.nome || 'Casa').toUpperCase();
  if (endEl) endEl.textContent = `Endereço: ${c.endereco || 'Endereço não informado'} ${c.bairro ? '• ' + c.bairro : ''}`;
  if (txtUrlEl) txtUrlEl.textContent = qrUrl;

  // Alta resolução para impressão
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qrUrl)}&format=png`;
  if (imgEl) imgEl.src = qrApiUrl;

  abrirModal('modalPlacaQRCasa');
}

// Abrir modal com placa QR Code do Quarto do Alojamento (Impressão A4)
function abrirModalPlacaQRQuarto(quartoId) {
  const q = (allQuartosData || []).find(x => String(x.id) === String(quartoId));
  if (!q) {
    showToast('Quarto não encontrado para gerar placa QR.', 'warning');
    return;
  }

  const qrUrl = getQRCodeUrlQuarto(q);
  const imgEl = document.getElementById('imgPlacaQRCasa');
  const txtUrlEl = document.getElementById('textoPlacaQRCasaUrl');
  const titEl = document.getElementById('placaCasaTitulo');
  const endEl = document.getElementById('placaCasaEndereco');
  const catEl = document.getElementById('placaCasaCategoriaLabel');

  if (catEl) catEl.textContent = 'Prefeitura de Canteiro • Alojamento da Obra';
  if (titEl) titEl.textContent = `QUARTO ${q.numero} — ${(q.bloco_nome || 'BLOCO').toUpperCase()}`;
  if (endEl) endEl.textContent = `Setor: Alojamento do Canteiro • Capacidade: ${q.capacidade || 4} vagas`;
  if (txtUrlEl) txtUrlEl.textContent = qrUrl;

  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qrUrl)}&format=png`;
  if (imgEl) imgEl.src = qrApiUrl;

  abrirModal('modalPlacaQRCasa');
}

function imprimirPlacaQRCasa() {
  document.body.classList.add('imprimindo-plaquinha-casa');
  window.print();
  setTimeout(() => {
    document.body.classList.remove('imprimindo-plaquinha-casa');
  }, 1000);
}

// Leitor de QR Code com a câmera do celular (html5-qrcode)
function abrirScannerLimpezaQR() {
  abrirModal('modalScannerLimpezaQR');

  // Preencher seleção manual de casas e quartos
  const sel = document.getElementById('selectCasaScannerManual');
  if (sel) {
    const opcoesCasas = (listaCasasCidade || []).map(c => `<option value="${c.id}">🏡 ${c.nome} - ${c.endereco || ''}</option>`).join('');
    const opcoesQuartos = (allQuartosData || []).map(q => `<option value="quarto_${q.id}">🛏️ Quarto ${q.numero} (${q.bloco_nome || 'Bloco'})</option>`).join('');
    sel.innerHTML = '<option value="">Selecione uma casa ou quarto...</option>' +
      (opcoesCasas ? `<optgroup label="Casas na Cidade">${opcoesCasas}</optgroup>` : '') +
      (opcoesQuartos ? `<optgroup label="Quartos do Alojamento">${opcoesQuartos}</optgroup>` : '');
  }

  setTimeout(() => {
    iniciarCameraScannerQR();
  }, 350);
}

function fecharScannerLimpezaQR() {
  pararCameraScannerQR();
  fecharModal('modalScannerLimpezaQR');
}

function iniciarCameraScannerQR() {
  const qrArea = document.getElementById('qrReaderCameraArea');
  if (!qrArea) return;

  if (typeof Html5Qrcode === 'undefined') {
    console.warn("Html5Qrcode não carregado");
    qrArea.innerHTML = `
      <div class="h-full flex flex-col items-center justify-center p-4 text-center text-slate-400">
        <i class="fa-solid fa-triangle-exclamation text-2xl text-amber-400 mb-2"></i>
        <p class="text-xs text-slate-300">Biblioteca do leitor QR não carregada</p>
        <p class="text-[10px] text-slate-500 mt-1">Utilize a seleção manual abaixo.</p>
      </div>
    `;
    return;
  }

  if (html5QrScannerInstance) {
    try {
      html5QrScannerInstance.stop().catch(() => {}).finally(() => {
        html5QrScannerInstance.clear();
        html5QrScannerInstance = null;
      });
    } catch (e) {}
  }

  try {
    html5QrScannerInstance = new Html5Qrcode("qrReaderCameraArea");
    const config = { fps: 10, qrbox: { width: 220, height: 220 } };

    html5QrScannerInstance.start(
      { facingMode: "environment" },
      config,
      (decodedText) => {
        fecharScannerLimpezaQR();
        processarLeituraQRCasa(decodedText);
      },
      (error) => {
        // Ignorar erros de quadro individual
      }
    ).catch(err => {
      console.warn("Aviso ao abrir câmera:", err);
      if (qrArea) {
        qrArea.innerHTML = `
          <div class="h-full flex flex-col items-center justify-center p-4 text-center text-slate-400">
            <i class="fa-solid fa-camera-slash text-3xl mb-2 text-rose-400"></i>
            <p class="text-xs font-semibold text-slate-300">Câmera indisponível ou permissão negada</p>
            <p class="text-[10px] text-slate-500 mt-1">Selecione a unidade na lista manual logo abaixo.</p>
          </div>
        `;
      }
    });
  } catch (err) {
    console.warn("Erro ao iniciar Html5Qrcode:", err);
  }
}

function pararCameraScannerQR() {
  if (html5QrScannerInstance) {
    try {
      html5QrScannerInstance.stop().then(() => {
        html5QrScannerInstance.clear();
        html5QrScannerInstance = null;
      }).catch(() => {
        html5QrScannerInstance = null;
      });
    } catch (e) {
      html5QrScannerInstance = null;
    }
  }
}

function confirmarCasaManualScanner() {
  const sel = document.getElementById('selectCasaScannerManual');
  const casaId = sel ? sel.value : null;
  if (!casaId) {
    showToast('Selecione uma casa ou quarto para registrar o serviço', 'warning');
    return;
  }
  fecharScannerLimpezaQR();
  abrirModalRegistroLimpeza(casaId);
}

// Processador inteligente do texto decodificado do QR Code
function processarLeituraQRCasa(texto) {
  if (!texto) return;
  texto = String(texto).trim();

  let casaId = null;
  let tipoPadrao = 'rotina';

  // 1. Formato URL: ?acao=limpeza&casa_id=... ou ?quarto_id=...
  try {
    let urlObj = null;
    if (texto.startsWith('http://') || texto.startsWith('https://')) {
      urlObj = new URL(texto);
    } else if (texto.startsWith('?') || texto.includes('casa_id=') || texto.includes('quarto_id=')) {
      urlObj = new URL(`https://dummy.local/${texto.startsWith('?') ? texto : '?' + texto}`);
    }

    if (urlObj) {
      const qCasaId = urlObj.searchParams.get('casa_id');
      const qQuartoId = urlObj.searchParams.get('quarto_id');
      const qTipo = urlObj.searchParams.get('tipo');
      if (qCasaId) casaId = qCasaId;
      else if (qQuartoId) casaId = 'quarto_' + qQuartoId;
      if (qTipo && (qTipo === 'ar_condicionado' || qTipo === 'rotina')) tipoPadrao = qTipo;
    }
  } catch (e) {}

  // 2. Formato JSON
  if (!casaId && texto.startsWith('{') && texto.endsWith('}')) {
    try {
      const parsed = JSON.parse(texto);
      if (parsed.casa_id || parsed.id) casaId = parsed.casa_id || parsed.id;
      else if (parsed.quarto_id) casaId = 'quarto_' + parsed.quarto_id;
      if (parsed.tipo) tipoPadrao = parsed.tipo;
    } catch (e) {}
  }

  // 3. Formato casa:ID ou quarto:ID
  if (!casaId && texto.toLowerCase().startsWith('casa:')) {
    casaId = texto.split(':')[1].trim();
  } else if (!casaId && texto.toLowerCase().startsWith('quarto:')) {
    casaId = 'quarto_' + texto.split(':')[1].trim();
  }

  // 4. ID direto ou busca por nome
  if (!casaId) {
    const achou = (listaCasasCidade || []).find(c => c.id === texto || (c.nome && c.nome.toLowerCase() === texto.toLowerCase()));
    if (achou) casaId = achou.id;
  }

  if (!casaId) {
    casaId = texto;
  }

  abrirModalRegistroLimpeza(casaId, tipoPadrao);
}

// Atalho direto para abrir modal de limpeza de Quarto do Alojamento
function abrirModalRegistroLimpezaQuarto(quartoId, tipoPadrao = 'rotina') {
  abrirModalRegistroLimpeza('quarto_' + quartoId, tipoPadrao);
}

// Abrir formulário para registrar limpeza ou manutenção (Suporta Casa e Quarto)
function abrirModalRegistroLimpeza(casaId, tipoPadrao = 'rotina') {
  let nomeUnidade = '';
  let enderecoHtml = '';
  let subTituloTxt = '';

  if (String(casaId).startsWith('quarto_')) {
    const qId = String(casaId).replace('quarto_', '');
    const q = (allQuartosData || []).find(x => String(x.id) === String(qId));
    if (!q) {
      showToast('Quarto não encontrado para registrar limpeza', 'error');
      return;
    }
    nomeUnidade = `Quarto ${q.numero} (${q.bloco_nome || 'Bloco'})`;
    enderecoHtml = `<i class="fa-solid fa-bed text-indigo-500"></i> Alojamento do Canteiro • ${q.bloco_nome || 'Bloco'}`;
    subTituloTxt = `Alojamento: ${nomeUnidade}`;
  } else {
    const c = (listaCasasCidade || []).find(x => x.id === casaId);
    if (!c) {
      showToast('Casa não encontrada para registrar limpeza', 'error');
      return;
    }
    nomeUnidade = c.nome;
    enderecoHtml = `<i class="fa-solid fa-location-dot text-rose-500"></i> ${c.endereco || 'Endereço não informado'} ${c.bairro ? '• ' + c.bairro : ''}`;
    subTituloTxt = `Casa: ${c.nome}`;
  }

  const idInput = document.getElementById('registroLimpezaCasaId');
  const nomeEl = document.getElementById('registroLimpezaCasaNome');
  const endEl = document.getElementById('registroLimpezaCasaEndereco');
  const subTit = document.getElementById('modalRegistroLimpezaCasaSubtitulo');

  if (idInput) idInput.value = casaId;
  if (nomeEl) nomeEl.textContent = nomeUnidade;
  if (endEl) endEl.innerHTML = enderecoHtml;
  if (subTit) subTit.textContent = subTituloTxt;

  // Data e hora atuais
  const agora = new Date();
  const dataHojeStr = getDataHojeLocal(agora);
  const horaHojeStr = agora.toTimeString().slice(0, 5);

  const dtEl = document.getElementById('registroLimpezaData');
  const hrEl = document.getElementById('registroLimpezaHora');
  if (dtEl) dtEl.value = dataHojeStr;
  if (hrEl) hrEl.value = horaHojeStr;

  // Responsável
  const respEl = document.getElementById('registroLimpezaResponsavel');
  if (respEl) {
    respEl.value = (currentUserName && currentUserName !== 'Prefeito da Obra') ? currentUserName : '';
  }

  // Obs
  const obsEl = document.getElementById('registroLimpezaObservacoes');
  if (obsEl) obsEl.value = '';

  // Selecionar tipo de serviço
  const radio = document.querySelector(`input[name="registroLimpezaTipo"][value="${tipoPadrao}"]`);
  if (radio) radio.checked = true;
  atualizarEstiloTipoLimpeza();

  abrirModal('modalRegistroLimpezaCasa');
}

// Alternar estilo visual dos seletores de tipo de serviço
function atualizarEstiloTipoLimpeza() {
  const tipo = document.querySelector('input[name="registroLimpezaTipo"]:checked')?.value || 'rotina';
  const lblRotina = document.getElementById('labelTipoLimpezaRotina');
  const lblAr = document.getElementById('labelTipoLimpezaAr');

  if (tipo === 'rotina') {
    if (lblRotina) lblRotina.className = 'cursor-pointer border-2 border-emerald-500 bg-emerald-50/60 rounded-xl p-3 flex flex-col items-center text-center transition select-none shadow-xs';
    if (lblAr) lblAr.className = 'cursor-pointer border-2 border-slate-200 bg-white rounded-xl p-3 flex flex-col items-center text-center transition select-none hover:bg-slate-50 opacity-70';
  } else {
    if (lblRotina) lblRotina.className = 'cursor-pointer border-2 border-slate-200 bg-white rounded-xl p-3 flex flex-col items-center text-center transition select-none hover:bg-slate-50 opacity-70';
    if (lblAr) lblAr.className = 'cursor-pointer border-2 border-sky-500 bg-sky-50/60 rounded-xl p-3 flex flex-col items-center text-center transition select-none shadow-xs';
  }
}

// Salvar registro de limpeza no estado local, auditoria e Firestore (Suporta Casa e Quarto)
async function salvarRegistroLimpeza(e) {
  if (e && e.preventDefault) e.preventDefault();

  const casaId = document.getElementById('registroLimpezaCasaId').value;
  const tipo = document.querySelector('input[name="registroLimpezaTipo"]:checked')?.value || 'rotina';
  const data = document.getElementById('registroLimpezaData').value;
  const hora = document.getElementById('registroLimpezaHora').value;
  const responsavel = document.getElementById('registroLimpezaResponsavel').value.trim();
  const observacoes = document.getElementById('registroLimpezaObservacoes').value.trim();

  if (!casaId) {
    showToast('Erro: nenhuma unidade selecionada para a limpeza.', 'error');
    return;
  }
  if (!data || !hora) {
    showToast('Informe a data e o horário da limpeza.', 'warning');
    return;
  }
  if (!responsavel) {
    showToast('Informe o nome do responsável pela limpeza.', 'warning');
    return;
  }

  const dataHoraStr = `${data}T${hora}:00`;
  const isQuarto = String(casaId).startsWith('quarto_');
  let casaNome = 'Unidade';
  let extraQuarto = {};

  if (isQuarto) {
    const qId = String(casaId).replace('quarto_', '');
    const q = (allQuartosData || []).find(x => String(x.id) === String(qId));
    casaNome = q ? `Quarto ${q.numero} (${q.bloco_nome || 'Bloco'})` : `Quarto #${qId}`;
    extraQuarto = {
      tipo_local: 'alojamento',
      quarto_id: String(qId),
      quarto_numero: q ? String(q.numero) : String(qId),
      bloco_nome: q ? String(q.bloco_nome || 'Bloco') : 'Bloco'
    };
  } else {
    const casa = (listaCasasCidade || []).find(x => x.id === casaId);
    casaNome = casa ? casa.nome : 'Casa';
    extraQuarto = { tipo_local: 'casa_cidade' };
  }

  const novoId = 'limpeza_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  const registro = {
    id: novoId,
    casa_id: casaId,
    casa_nome: casaNome,
    ...extraQuarto,
    tipo: tipo,
    data: data,
    hora: hora,
    data_hora: dataHoraStr,
    responsavel: responsavel,
    observacoes: observacoes || '',
    criado_em: new Date().toISOString(),
    criado_por: currentUserName || 'Usuário'
  };

  // 1. Salvar no estado local
  listaLimpezasCasas.unshift(registro);
  try {
    localStorage.setItem('casas_limpezas_cache', JSON.stringify(listaLimpezasCasas));
  } catch (err) {}

  // 2. Registrar na auditoria central
  if (typeof registrarAuditoria === 'function') {
    const descTipo = tipo === 'rotina' ? 'Limpeza de Rotina (Diária)' : 'Higienização de Ar Condicionado (Ciclo 30d)';
    registrarAuditoria(
      isQuarto ? 'quartos' : 'casas',
      'LIMPEZA',
      casaNome,
      `${descTipo} registrada para ${casaNome} por ${responsavel}. Obs: ${observacoes || 'Nenhuma'}`,
      responsavel
    );
  }

  // 3. Salvar no Firestore se disponível
  if (firestoreDb) {
    try {
      await firestoreDb.collection('casas_limpezas').doc(novoId).set(registro);
    } catch (err) {
      console.warn("Aviso ao salvar limpeza no Firestore:", err);
    }
  }

  fecharModal('modalRegistroLimpezaCasa');
  showToast(`✅ Limpeza (${tipo === 'rotina' ? 'Rotina Diária' : 'Ar Condicionado'}) registrada em ${casaNome}!`, 'success');

  // Atualizar visualizações
  if (activeTab === 'casas_cidade') {
    filtrarCasasCidadeUI();
  } else if (activeTab === 'blocos') {
    carregarQuartos();
  }
  if (casaSelecionadaId === casaId) {
    renderizarHistoricoLimpezasCasa(casaId);
  }
}

// Renderizar histórico de limpezas da casa no modal de detalhes
function renderizarHistoricoLimpezasCasa(casaId) {
  const container = document.getElementById('casaDetalhesLimpezasTabela');
  const vazio = document.getElementById('casaDetalhesLimpezasVazio');
  if (!container) return;

  const st = calcularStatusLimpezasCasa(casaId);

  // Atualizar cards de status resumo no topo da aba de limpezas
  const txtRotina = document.getElementById('statusTextoLimpezaRotina');
  const subRotina = document.getElementById('subtextoLimpezaRotina');
  const cardRotina = document.getElementById('statusCardLimpezaRotina');
  if (txtRotina) txtRotina.textContent = st.rotina.textoDetalhe;
  if (subRotina) subRotina.textContent = `Última: ${st.rotina.subtexto}`;
  if (cardRotina) {
    cardRotina.className = st.rotina.cor === 'emerald'
      ? 'bg-emerald-50/40 p-4 rounded-xl border border-emerald-200 shadow-sm flex items-center justify-between'
      : (st.rotina.cor === 'rose'
        ? 'bg-rose-50/40 p-4 rounded-xl border border-rose-200 shadow-sm flex items-center justify-between'
        : 'bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between');
  }

  const txtAr = document.getElementById('statusTextoLimpezaAr');
  const subAr = document.getElementById('subtextoLimpezaAr');
  const cardAr = document.getElementById('statusCardLimpezaAr');
  if (txtAr) txtAr.textContent = st.ar.textoDetalhe;
  if (subAr) subAr.textContent = `Última: ${st.ar.subtexto}`;
  if (cardAr) {
    cardAr.className = st.ar.cor === 'emerald'
      ? 'bg-emerald-50/40 p-4 rounded-xl border border-emerald-200 shadow-sm flex items-center justify-between'
      : (st.ar.cor === 'amber'
        ? 'bg-amber-50/50 p-4 rounded-xl border border-amber-300 shadow-sm flex items-center justify-between'
        : (st.ar.cor === 'rose'
          ? 'bg-rose-50/40 p-4 rounded-xl border border-rose-200 shadow-sm flex items-center justify-between'
          : 'bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between'));
  }

  // Obter registros e ordenar por data_hora desc
  const registros = (listaLimpezasCasas || [])
    .filter(l => l.casa_id === casaId)
    .sort((a, b) => new Date(b.data_hora || (b.data + 'T' + (b.hora || '00:00'))) - new Date(a.data_hora || (a.data + 'T' + (a.hora || '00:00'))));

  if (registros.length === 0) {
    container.innerHTML = '';
    if (vazio) vazio.classList.remove('hidden');
    return;
  }

  if (vazio) vazio.classList.add('hidden');

  const hoje = new Date();
  const hojeZero = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

  container.innerHTML = registros.map(reg => {
    const isAr = reg.tipo === 'ar_condicionado';
    const strDataReg = String(reg.data || '').split('T')[0].trim();
    const dataReg = new Date(strDataReg + 'T12:00:00');
    const dataRegZero = isNaN(dataReg.getTime()) ? hojeZero : new Date(dataReg.getFullYear(), dataReg.getMonth(), dataReg.getDate());
    const diffDias = Math.max(0, Math.floor((hojeZero - dataRegZero) / (1000 * 60 * 60 * 24)));

    let decorridoStr = '';
    if (diffDias === 0) decorridoStr = 'Hoje';
    else if (diffDias === 1) decorridoStr = 'Ontem';
    else decorridoStr = `Há ${diffDias} dias`;

    return `
      <div class="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs hover:border-slate-300 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl ${isAr ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700'} flex items-center justify-center flex-shrink-0 text-base">
            <i class="fa-solid ${isAr ? 'fa-snowflake' : 'fa-broom'}"></i>
          </div>
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2 py-0.5 rounded text-[11px] font-bold ${isAr ? 'bg-sky-100 text-sky-800 border border-sky-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'}">
                ${isAr ? 'Ar Condicionado (30d)' : 'Limpeza de Rotina'}
              </span>
              <span class="text-xs font-bold text-slate-800">
                ${formatarDataLimpezaBR(reg.data)} às ${reg.hora || '--:--'}
              </span>
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">
                ${decorridoStr}
              </span>
            </div>

            <p class="text-xs text-slate-600 mt-1 flex items-center gap-1.5">
              <i class="fa-solid fa-user-check text-slate-400 text-[11px]"></i>
              <span class="font-semibold text-slate-800">${reg.responsavel || 'Não informado'}</span>
            </p>

            ${reg.observacoes ? `
              <p class="text-xs text-slate-500 mt-1 bg-slate-50 p-2 rounded-lg border border-slate-100 leading-relaxed italic">
                "${reg.observacoes}"
              </p>
            ` : ''}
          </div>
        </div>

        <div class="flex items-center gap-1.5 sm:self-center ml-auto sm:ml-0">
          <button onclick="excluirRegistroLimpeza('${reg.id}')" class="btn-prefeito p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 text-xs transition" title="Excluir este registro">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Excluir registro do histórico de limpeza
async function excluirRegistroLimpeza(id) {
  if (!confirm('Deseja realmente excluir este registro de limpeza do histórico?')) return;

  const idx = (listaLimpezasCasas || []).findIndex(x => x.id === id);
  if (idx !== -1) {
    listaLimpezasCasas.splice(idx, 1);
    try {
      localStorage.setItem('casas_limpezas_cache', JSON.stringify(listaLimpezasCasas));
    } catch (e) {}

    if (firestoreDb) {
      try {
        await firestoreDb.collection('casas_limpezas').doc(id).delete();
      } catch (e) {}
    }

    showToast('Registro de limpeza excluído do histórico.', 'info');
    if (casaSelecionadaId) {
      renderizarHistoricoLimpezasCasa(casaSelecionadaId);
    }
    if (activeTab === 'casas_cidade') {
      filtrarCasasCidadeUI();
    } else if (activeTab === 'blocos') {
      carregarQuartos();
    }
  }
}

// ========================================================
// OUVIDORIA / RECLAMAÇÕES POR UNIDADE & RELATÓRIO EXECUTIVO A4
// ========================================================

// Obter chamados/reclamações em aberto de um Quarto do Alojamento
function obterChamadosAbertosQuarto(q) {
  if (!q) return [];
  return (listaChamados || []).filter(c => {
    if (c.status === 'concluido') return false;
    if (String(c.quarto_id) === String(q.id) || c.unidade_id === 'quarto_' + q.id) return true;
    if (c.tipo_local === 'casa_cidade') return false;
    const numMatch = String(c.quarto || '').trim() === String(q.numero || '').trim();
    if (!numMatch) return false;
    const blocoChamado = String(c.bloco || '').trim().toLowerCase();
    const blocoQuarto = String(q.bloco_nome || '').trim().toLowerCase();
    if (!blocoChamado || blocoChamado === 'não informado' || blocoChamado === 'não especificado' || blocoChamado === blocoQuarto) {
      return true;
    }
    return false;
  });
}

// Obter chamados/reclamações em aberto de uma Casa na Cidade
function obterChamadosAbertosCasa(casa) {
  if (!casa) return [];
  return (listaChamados || []).filter(c => {
    if (c.status === 'concluido') return false;
    if (c.casa_id === casa.id || c.unidade_id === casa.id) return true;
    const nomeCasa = String(casa.nome || '').trim().toLowerCase();
    if (!nomeCasa) return false;
    if (c.casa_nome && String(c.casa_nome).trim().toLowerCase() === nomeCasa) return true;
    if (c.tipo_local === 'casa_cidade' && c.bloco && String(c.bloco).trim().toLowerCase() === nomeCasa) return true;
    return false;
  });
}

// Abrir modal listando as reclamações/observações em aberto de uma Casa ou Quarto
function abrirModalOcorrenciasUnidade(tipoLocal, unidadeId) {
  const subEl = document.getElementById('modalOcorrenciasUnidadeSubtitulo');
  const container = document.getElementById('listaOcorrenciasUnidadeContainer');
  if (!container) return;

  let nomeUnidade = '';
  let chamadosUnidade = [];

  if (tipoLocal === 'quarto') {
    const q = (allQuartosData || []).find(x => String(x.id) === String(unidadeId));
    nomeUnidade = q ? `Quarto ${q.numero} (${q.bloco_nome || 'Bloco'})` : `Quarto #${unidadeId}`;
    chamadosUnidade = q ? obterChamadosAbertosQuarto(q) : [];
  } else {
    const c = (listaCasasCidade || []).find(x => String(x.id) === String(unidadeId));
    nomeUnidade = c ? c.nome : `Casa #${unidadeId}`;
    chamadosUnidade = c ? obterChamadosAbertosCasa(c) : [];
  }

  if (subEl) subEl.textContent = `Unidade: ${nomeUnidade}`;

  if (chamadosUnidade.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-500 space-y-2">
        <div class="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto text-xl">
          <i class="fa-solid fa-check"></i>
        </div>
        <p class="text-sm font-bold text-slate-700">Nenhuma reclamação ou pendência em aberto!</p>
        <p class="text-xs text-slate-400">Todas as observações desta unidade já foram solucionadas.</p>
      </div>
    `;
  } else {
    container.innerHTML = chamadosUnidade.map(ch => {
      const dtStr = ch.data_abertura ? new Date(ch.data_abertura).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Data não informada';
      return `
        <div class="bg-white rounded-xl p-4 border-2 border-rose-200 shadow-xs space-y-2.5">
          <div class="flex items-start justify-between gap-2">
            <div>
              <span class="inline-block px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-black text-[10px] uppercase tracking-wider border border-rose-200">
                ${ch.categoria || 'Reclamação / Reparo'}
              </span>
              <span class="text-[11px] font-mono text-slate-400 ml-1.5">#${ch.protocolo}</span>
            </div>
            <span class="text-[11px] font-semibold text-slate-500">${dtStr}</span>
          </div>

          <p class="text-xs font-semibold text-slate-800 bg-rose-50/60 p-2.5 rounded-lg border border-rose-100 leading-relaxed">
            "${ch.descricao || 'Sem detalhes adicionais.'}"
          </p>

          <div class="flex items-center justify-between pt-1 text-[11px] text-slate-600">
            <div>
              <i class="fa-solid fa-user text-slate-400 mr-1"></i>
              <strong>Morador:</strong> ${ch.solicitante || 'Morador (Anônimo)'}
              ${ch.telefone ? `<span class="ml-2 text-slate-400">• ${ch.telefone}</span>` : ''}
            </div>
            <button onclick="resolverOcorrenciaUnidade('${ch.protocolo}', '${tipoLocal}', '${unidadeId}')" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition">
              <i class="fa-solid fa-check"></i> Dar Baixa / Resolver
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  abrirModal('modalOcorrenciasUnidade');
}

// Dar baixa rápida em uma reclamação diretamente pelo modal da unidade
async function resolverOcorrenciaUnidade(protocolo, tipoLocal, unidadeId) {
  const ch = (listaChamados || []).find(c => String(c.protocolo) === String(protocolo));
  if (!ch) return;

  ch.status = 'concluido';
  ch.data_conclusao = new Date().toISOString();
  ch.concluido_por = currentUserName || 'Prefeito da Obra';

  try {
    localStorage.setItem('chamados_suporte_cache', JSON.stringify(listaChamados));
  } catch (e) {}

  if (firestoreDb) {
    try {
      await firestoreDb.collection('chamados_suporte').doc(String(protocolo)).update({
        status: 'concluido',
        data_conclusao: ch.data_conclusao,
        concluido_por: ch.concluido_por
      });
    } catch (e) {
      console.warn('Aviso ao atualizar chamado no Firestore:', e);
    }
  }

  showToast(`✅ Reclamação #${protocolo} marcada como resolvida!`, 'success');
  abrirModalOcorrenciasUnidade(tipoLocal, unidadeId);
  renderChamados();
  if (activeTab === 'blocos') carregarQuartos();
  if (activeTab === 'casas_cidade') filtrarCasasCidadeUI();
}

// Abrir o Relatório Executivo A4 de Limpeza, Ar-Condicionado e Ouvidoria (Casas & Alojamentos)
function abrirModalRelatorioLimpezaExecutivo(escopoInicial = 'todos') {
  const sel = document.getElementById('filtroRelatorioLimpezaEscopo');
  if (sel && escopoInicial) {
    sel.value = escopoInicial;
  }
  renderizarRelatorioLimpezaExecutivoUI();
  abrirModal('modalRelatorioLimpezaExecutivo');
}

// Renderizar os dados do Relatório Executivo A4 de Limpeza
function renderizarRelatorioLimpezaExecutivoUI() {
  const escopo = document.getElementById('filtroRelatorioLimpezaEscopo')?.value || 'todos';
  const dtEmissaoEl = document.getElementById('relatorioLimpezaDataEmissao');
  const subEscopoEl = document.getElementById('relatorioLimpezaSubEscopo');
  const kpiTotalEl = document.getElementById('relLimpKpiTotal');
  const kpiFaxinaEl = document.getElementById('relLimpKpiFaxinaOk');
  const kpiArEl = document.getElementById('relLimpKpiArOk');
  const kpiRecEl = document.getElementById('relLimpKpiReclamacoes');
  const tbodyUnidades = document.getElementById('relatorioLimpezaTabelaUnidadesCorpo');
  const tbodyOcorrencias = document.getElementById('relatorioLimpezaTabelaOcorrenciasCorpo');

  const agora = new Date();
  if (dtEmissaoEl) {
    dtEmissaoEl.textContent = `Emissão: ${agora.toLocaleDateString('pt-BR')} às ${agora.toTimeString().slice(0, 5)}`;
  }
  if (subEscopoEl) {
    subEscopoEl.textContent = escopo === 'casas'
      ? 'Escopo: Casas na Cidade'
      : (escopo === 'alojamento' ? 'Escopo: Quartos do Alojamento' : 'Escopo: Consolidado (Casas + Alojamentos)');
  }

  const linhasUnidades = [];
  let totalFaxinaOk = 0;
  let totalArOk = 0;
  let totalReclamacoesAbertas = 0;

  // 1. Incluir Casas na Cidade se escopo = 'todos' ou 'casas'
  if (escopo === 'todos' || escopo === 'casas') {
    (listaCasasCidade || []).forEach(c => {
      const st = calcularStatusLimpezasCasa(c.id);
      const chAbertos = obterChamadosAbertosCasa(c);
      if (st.rotina.status === 'ok') totalFaxinaOk++;
      if (st.ar.status === 'ok') totalArOk++;
      totalReclamacoesAbertas += chAbertos.length;

      linhasUnidades.push({
        nome: c.nome || 'Casa',
        sub: c.endereco || 'Residência Urbana',
        tipoLabel: '🏡 Casa Cidade',
        rotinaOk: st.rotina.status === 'ok',
        rotinaTexto: st.rotina.textoCurto,
        arOk: st.ar.status === 'ok',
        arTexto: st.ar.textoCurto,
        responsavel: st.ultResponsavel,
        reclamacoes: chAbertos.length
      });
    });
  }

  // 2. Incluir Quartos do Alojamento se escopo = 'todos' ou 'alojamento'
  if (escopo === 'todos' || escopo === 'alojamento') {
    (allQuartosData || []).forEach(q => {
      const st = calcularStatusLimpezaQuarto(q);
      const chAbertos = obterChamadosAbertosQuarto(q);
      if (st.rotina.status === 'ok') totalFaxinaOk++;
      if (st.ar.status === 'ok') totalArOk++;
      totalReclamacoesAbertas += chAbertos.length;

      linhasUnidades.push({
        nome: `Quarto ${q.numero}`,
        sub: q.bloco_nome || 'Alojamento',
        tipoLabel: '🏢 Alojamento',
        rotinaOk: st.rotina.status === 'ok',
        rotinaTexto: st.rotina.textoCurto,
        arOk: st.ar.status === 'ok',
        arTexto: st.ar.textoCurto,
        responsavel: st.ultResponsavel,
        reclamacoes: chAbertos.length
      });
    });
  }

  if (kpiTotalEl) kpiTotalEl.textContent = linhasUnidades.length;
  if (kpiFaxinaEl) kpiFaxinaEl.textContent = `${totalFaxinaOk} / ${linhasUnidades.length}`;
  if (kpiArEl) kpiArEl.textContent = `${totalArOk} / ${linhasUnidades.length}`;
  if (kpiRecEl) kpiRecEl.textContent = totalReclamacoesAbertas;

  if (tbodyUnidades) {
    if (linhasUnidades.length === 0) {
      tbodyUnidades.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-400">Nenhuma unidade encontrada para o filtro selecionado.</td></tr>`;
    } else {
      tbodyUnidades.innerHTML = linhasUnidades.map(u => `
        <tr class="hover:bg-slate-50">
          <td class="py-2 px-3">
            <div class="font-bold text-slate-900">${u.nome}</div>
            <div class="text-[10px] text-slate-500">${u.sub}</div>
          </td>
          <td class="py-2 px-2 font-semibold text-slate-600">${u.tipoLabel}</td>
          <td class="py-2 px-2">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${u.rotinaOk ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
              <span class="w-1.5 h-1.5 rounded-full ${u.rotinaOk ? 'bg-emerald-600' : 'bg-amber-500'}"></span>
              ${u.rotinaOk ? 'EM DIA' : 'PENDENTE'} (${u.rotinaTexto})
            </span>
          </td>
          <td class="py-2 px-2">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${u.arOk ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
              <span class="w-1.5 h-1.5 rounded-full ${u.arOk ? 'bg-emerald-600' : 'bg-rose-600'}"></span>
              ${u.arOk ? 'EM DIA' : 'PASSOU 30D'} (${u.arTexto})
            </span>
          </td>
          <td class="py-2 px-2 font-semibold text-slate-700">${u.responsavel}</td>
          <td class="py-2 px-2 text-center">
            ${u.reclamacoes > 0
              ? `<span class="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-black text-[10px]">🚨 ${u.reclamacoes} Aberta(s)</span>`
              : `<span class="text-[10px] text-emerald-700 font-bold">✓ Sem queixas</span>`}
          </td>
        </tr>
      `).join('');
    }
  }

  // Tabela 2: Reclamações / Observações registradas pelos moradores
  if (tbodyOcorrencias) {
    const chamadosFiltrados = (listaChamados || []).filter(ch => {
      const isCasa = ch.tipo_local === 'casa_cidade' || Boolean(ch.casa_id);
      if (escopo === 'casas' && !isCasa) return false;
      if (escopo === 'alojamento' && isCasa) return false;
      return true;
    }).slice(0, 40);

    if (chamadosFiltrados.length === 0) {
      tbodyOcorrencias.innerHTML = `<tr><td colspan="7" class="py-5 text-center text-slate-400">Nenhuma reclamação ou solicitação registrada para este escopo.</td></tr>`;
    } else {
      tbodyOcorrencias.innerHTML = chamadosFiltrados.map(ch => {
        const isCasa = ch.tipo_local === 'casa_cidade' || Boolean(ch.casa_id);
        const localTxt = isCasa ? `${ch.casa_nome || ch.bloco || 'Casa'}` : `${ch.bloco || 'Bloco'} • Q.${ch.quarto || '--'}`;
        const dtStr = ch.data_abertura ? new Date(ch.data_abertura).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--';
        const conc = ch.status === 'concluido';
        return `
          <tr>
            <td class="py-1.5 px-3 font-mono font-bold text-slate-700">#${ch.protocolo || '--'}</td>
            <td class="py-1.5 px-2 text-slate-600">${dtStr}</td>
            <td class="py-1.5 px-2 font-bold text-slate-800">${localTxt}</td>
            <td class="py-1.5 px-2 font-semibold text-slate-700">${ch.categoria || 'Manutenção'}</td>
            <td class="py-1.5 px-3 text-slate-600">${ch.descricao || ''}</td>
            <td class="py-1.5 px-2 text-slate-700">${ch.solicitante || 'Morador'}</td>
            <td class="py-1.5 px-2 text-center">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${conc ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
                ${conc ? 'RESOLVIDO' : 'EM ABERTO'}
              </span>
            </td>
          </tr>
        `;
      }).join('');
    }
  }
}

// Imprimir Relatório Executivo de Limpeza em folha A4
function imprimirRelatorioLimpezaA4() {
  document.body.classList.add('imprimindo-relatorio-limpeza');
  window.print();
  setTimeout(() => {
    document.body.classList.remove('imprimindo-relatorio-limpeza');
  }, 1000);
}

// Verificar parâmetros de URL (Redirecionar leitura de QR Code da faxineira para página isolada)
function verificarAcaoUrlParametros() {
  try {
    const params = new URLSearchParams(window.location.search);
    const acao = params.get('acao');
    const casaId = params.get('casa_id');
    const quartoId = params.get('quarto_id');

    if (acao === 'limpeza' && casaId) {
      window.location.replace(`limpeza.html?casa_id=${encodeURIComponent(casaId)}`);
      return;
    }
    if (acao === 'limpeza' && quartoId) {
      window.location.replace(`limpeza.html?quarto_id=${encodeURIComponent(quartoId)}`);
      return;
    }
  } catch (e) {
    console.warn("Erro ao verificar parâmetros de URL:", e);
  }
}

// Exposição explícita no window para garantir funcionamento de botões onclick
window.openModalNovaCasa = openModalNovaCasa;
window.editarCasa = editarCasa;
window.salvarCasa = salvarCasa;
window.excluirCasa = excluirCasa;
window.abrirDetalhesCasa = typeof abrirModalCasaDetalhes !== 'undefined' ? abrirModalCasaDetalhes : function(id) { if (typeof abrirModalCasaDetalhes === 'function') abrirModalCasaDetalhes(id); };
window.trocarAbaCasaDetalhes = trocarAbaCasaDetalhes;
window.openModalNovoComodo = openModalNovoComodo;
window.salvarComodo = salvarComodo;
window.salvarComodoCasa = salvarComodo;
window.excluirComodo = excluirComodo;
window.excluirComodoCasa = excluirComodo;
window.openModalNovoMoradorCasa = openModalNovoMoradorCasa;
window.salvarMoradorCasa = salvarMoradorCasa;
window.desocuparCamaCasa = desocuparCamaCasa;
window.removerMoradorCasa = desocuparCamaCasa;
window.openModalNovoMovelComodo = openModalNovoMovelComodo;
window.salvarMovelComodo = salvarMovelComodo;
window.excluirMovelComodo = excluirMovelComodo;
window.openModalNovaDespesaCasa = openModalNovaDespesaCasa;
window.openModalNovaDespesaCasaGlobal = openModalNovaDespesaCasaGlobal;
window.salvarDespesaCasa = salvarDespesaCasa;
window.alternarStatusDespesaCasa = alternarStatusDespesaCasa;
window.excluirDespesaCasa = excluirDespesaCasa;
window.recarregarCasasCidadeManual = recarregarCasasCidadeManual;
window.filtrarCasasCidadeUI = filtrarCasasCidadeUI;

// Funções de Limpeza & Manutenção via QR Code (Casas & Alojamentos)
window.listaLimpezasCasas = listaLimpezasCasas;
window.abrirScannerLimpezaQR = abrirScannerLimpezaQR;
window.fecharScannerLimpezaQR = fecharScannerLimpezaQR;
window.confirmarCasaManualScanner = confirmarCasaManualScanner;
window.processarLeituraQRCasa = processarLeituraQRCasa;
window.abrirModalRegistroLimpeza = abrirModalRegistroLimpeza;
window.abrirModalRegistroLimpezaQuarto = abrirModalRegistroLimpezaQuarto;
window.atualizarEstiloTipoLimpeza = atualizarEstiloTipoLimpeza;
window.salvarRegistroLimpeza = salvarRegistroLimpeza;
window.excluirRegistroLimpeza = excluirRegistroLimpeza;
window.abrirModalPlacaQRCasa = abrirModalPlacaQRCasa;
window.abrirModalPlacaQRQuarto = abrirModalPlacaQRQuarto;
window.imprimirPlacaQRCasa = imprimirPlacaQRCasa;
window.renderizarHistoricoLimpezasCasa = renderizarHistoricoLimpezasCasa;
window.calcularStatusLimpezasCasa = calcularStatusLimpezasCasa;
window.calcularStatusLimpezaQuarto = calcularStatusLimpezaQuarto;
window.getQRCodeUrlQuarto = getQRCodeUrlQuarto;
window.obterChamadosAbertosQuarto = obterChamadosAbertosQuarto;
window.obterChamadosAbertosCasa = obterChamadosAbertosCasa;
window.abrirModalOcorrenciasUnidade = abrirModalOcorrenciasUnidade;
window.resolverOcorrenciaUnidade = resolverOcorrenciaUnidade;
window.abrirModalRelatorioLimpezaExecutivo = abrirModalRelatorioLimpezaExecutivo;
window.renderizarRelatorioLimpezaExecutivoUI = renderizarRelatorioLimpezaExecutivoUI;
window.imprimirRelatorioLimpezaA4 = imprimirRelatorioLimpezaA4;
window.verificarAcaoUrlParametros = verificarAcaoUrlParametros;





// ========================================================
// MÓDULO DE ESTOQUE & ALMOXARIFADO (GALPÕES & PATRIMÔNIO)
// ========================================================
// listaEstoqueItens declarada no topo
// listaEstoqueMovimentacoes declarada no topo
// listaEstoqueLocais declarada no topo
// listenerEstoqueAtivo declarado no topo
// itemEstoqueSelecionadoId declarado no topo

// Inicialização do ouvinte em tempo real do Firestore para Estoque
function iniciarListenerEstoque() {
  if (!firestoreDb || listenerEstoqueAtivo) return;
  listenerEstoqueAtivo = true;

  console.log("📦 [ESTOQUE] Inicializando sincronização em tempo real de Estoque & Almoxarifado...");

  // 1. Carregar do cache local
  try {
    const cachedItens = localStorage.getItem('estoque_itens_cache');
    if (cachedItens) listaEstoqueItens = JSON.parse(cachedItens);
    const cachedMovs = localStorage.getItem('estoque_movimentacoes_cache');
    if (cachedMovs) listaEstoqueMovimentacoes = JSON.parse(cachedMovs);
    const cachedLocais = localStorage.getItem('estoque_locais_cache');
    if (cachedLocais) listaEstoqueLocais = JSON.parse(cachedLocais);
    
    // Seed inicial padrão se estiver totalmente vazio
    if (!cachedItens || listaEstoqueItens.length === 0) {
      inicializarItensPadraoEstoque();
    }

    atualizarContadoresEstoqueUI();
    popularSelectsLocaisEstoque();
  } catch (e) {
    console.warn("Aviso ao carregar cache do estoque:", e);
  }

  // 2. Ouvir coleção de estoque_itens
  try {
    firestoreDb.collection('estoque_itens').onSnapshot((snapshot) => {
      if (!snapshot.empty) {
        const itensNuvem = [];
        snapshot.forEach(doc => itensNuvem.push({ id: doc.id, ...doc.data() }));
        itensNuvem.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
        listaEstoqueItens = itensNuvem;
        try { localStorage.setItem('estoque_itens_cache', JSON.stringify(listaEstoqueItens)); } catch (e) {}
        atualizarContadoresEstoqueUI();
        if (activeTab === 'estoque') filtrarEstoqueUI();
      }
    }, (err) => console.warn("Aviso listener estoque_itens:", err));
  } catch (err) {
    console.warn("Erro ao iniciar snapshot de estoque_itens:", err);
  }

  // 3. Ouvir coleção de estoque_movimentacoes
  try {
    firestoreDb.collection('estoque_movimentacoes').onSnapshot((snapshot) => {
      if (!snapshot.empty) {
        const movsNuvem = [];
        snapshot.forEach(doc => movsNuvem.push({ id: doc.id, ...doc.data() }));
        movsNuvem.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
        listaEstoqueMovimentacoes = movsNuvem;
        try { localStorage.setItem('estoque_movimentacoes_cache', JSON.stringify(listaEstoqueMovimentacoes)); } catch (e) {}
        atualizarContadoresEstoqueUI();
      }
    }, (err) => console.warn("Aviso listener estoque_movimentacoes:", err));
  } catch (err) {
    console.warn("Erro snapshot estoque_movimentacoes:", err);
  }

  // 4. Ouvir locais/galpões
  try {
    firestoreDb.collection('configuracoes').doc('estoque_locais').onSnapshot((doc) => {
      if (doc.exists && doc.data().locais) {
        listaEstoqueLocais = doc.data().locais;
        try { localStorage.setItem('estoque_locais_cache', JSON.stringify(listaEstoqueLocais)); } catch (e) {}
        popularSelectsLocaisEstoque();
        if (activeTab === 'estoque') filtrarEstoqueUI();
      }
    }, (err) => console.warn("Aviso listener estoque_locais:", err));
  } catch (err) {}
}

// Criar itens padrão de canteiro caso não haja nenhum cadastrado
function inicializarItensPadraoEstoque() {
  const itensIniciais = [
    {
      id: 'EST-COLCHAO-D33',
      nome: 'Colchão D33 Solteiro (Alojamento)',
      categoria: 'Alojamento',
      local: 'Galpão 2 (Alojamento Obra)',
      quantidade: 24,
      unidade: 'UN',
      qtd_minima: 5,
      patrimonio: '',
      valor: 280.00,
      empresa: 'GEL',
      marca: 'Ortobom D33',
      observacoes: 'Padrão dos quartos de alojados'
    },
    {
      id: 'EST-LAMPADA-LED',
      nome: 'Lâmpada LED 12W Bivolt E27',
      categoria: 'Manutenção',
      local: 'Galpão 2 (Alojamento Obra)',
      quantidade: 45,
      unidade: 'UN',
      qtd_minima: 10,
      patrimonio: '',
      valor: 12.50,
      empresa: 'GEL',
      marca: 'Avant / Elgin',
      observacoes: 'Usada nos chamados de lâmpada queimada'
    },
    {
      id: 'EST-CHUVEIRO-MAXI',
      nome: 'Chuveiro Elétrico 220V + Resistência',
      categoria: 'Manutenção',
      local: 'Galpão 2 (Alojamento Obra)',
      quantidade: 8,
      unidade: 'UN',
      qtd_minima: 3,
      patrimonio: '',
      valor: 65.00,
      empresa: 'GEL',
      marca: 'Lorenzetti Maxi Ducha',
      observacoes: 'Substituição em banheiros de pavilhão'
    },
    {
      id: 'EST-SACO-LIXO-100L',
      nome: 'Saco de Lixo Reforçado 100L (Fardo 100un)',
      categoria: 'Limpeza',
      local: 'Galpão 1 (Cidade)',
      quantidade: 15,
      unidade: 'PCT',
      qtd_minima: 3,
      patrimonio: '',
      valor: 48.00,
      empresa: 'GEL',
      marca: 'Plastfort',
      observacoes: 'Para equipe de limpeza dos alojamentos e casas'
    },
    {
      id: 'EST-TV-SAMSUNG-43',
      nome: 'Smart TV 43" Full HD (Sala da Casa)',
      categoria: 'Móveis/Eletros',
      local: 'Galpão 1 (Cidade)',
      quantidade: 2,
      unidade: 'UN',
      qtd_minima: 1,
      patrimonio: '#GEL-TV-001',
      valor: 1650.00,
      empresa: 'GEL',
      marca: 'Samsung Smart',
      observacoes: 'Destinada às casas de engenharia na cidade'
    },
    {
      id: 'EST-GELADEIRA-375L',
      nome: 'Geladeira Frost Free 375L Duplex',
      categoria: 'Móveis/Eletros',
      local: 'Galpão 1 (Cidade)',
      quantidade: 1,
      unidade: 'UN',
      qtd_minima: 1,
      patrimonio: '#GEL-REF-004',
      valor: 2850.00,
      empresa: 'GEL',
      marca: 'Brastemp BRM44',
      observacoes: 'Equipamento patrimonial da liderança'
    }
  ];

  listaEstoqueItens = itensIniciais;
  try {
    localStorage.setItem('estoque_itens_cache', JSON.stringify(listaEstoqueItens));
    localStorage.setItem('estoque_locais_cache', JSON.stringify(listaEstoqueLocais));
  } catch (e) {}
}

// Carregamento da aba Estoque
function carregarEstoque() {
  iniciarListenerEstoque();
  popularSelectsLocaisEstoque();
  atualizarContadoresEstoqueUI();
  filtrarEstoqueUI();
}

// Popular selects de locais/galpões
function popularSelectsLocaisEstoque() {
  const fLocal = document.getElementById('filtroEstoqueLocal');
  const formLocal = document.getElementById('itemEstoqueFormLocal');
  const movLocal = document.getElementById('movimentacaoLocal');
  const chamLocal = document.getElementById('chamadoEstoqueLocal');

  const optionsHtml = listaEstoqueLocais.map(loc => `<option value="${loc}">${loc}</option>`).join('');

  if (fLocal) {
    const currentVal = fLocal.value;
    fLocal.innerHTML = '<option value="todos">🏬 Todos os Galpões</option>' + optionsHtml;
    if (currentVal) fLocal.value = currentVal;
  }
  if (formLocal) formLocal.innerHTML = optionsHtml;
  if (movLocal) movLocal.innerHTML = optionsHtml;
  if (chamLocal) chamLocal.innerHTML = optionsHtml;

  // Renderizar modal de lista de locais
  renderizarListaLocaisModal();
}

// Atualizar métricas do topo do estoque
function atualizarContadoresEstoqueUI() {
  const totItens = listaEstoqueItens.length;
  let totCritico = 0;
  let totValorPatrimonio = 0;
  let qtdPatrimonio = 0;

  listaEstoqueItens.forEach(item => {
    const qtd = Number(item.quantidade || 0);
    const min = Number(item.qtd_minima || 0);
    if (qtd <= min) totCritico++;

    if (item.patrimonio && item.patrimonio.trim() !== '') {
      qtdPatrimonio += qtd;
      if (item.valor) {
        totValorPatrimonio += (Number(item.valor) * qtd);
      }
    }
  });

  const mTot = document.getElementById('metricEstoqueTotalItens');
  if (mTot) mTot.textContent = totItens;

  const mCrit = document.getElementById('metricEstoqueCritico');
  if (mCrit) mCrit.textContent = totCritico;

  const mVal = document.getElementById('metricEstoqueValorPatrimonio');
  if (mVal) mVal.textContent = totValorPatrimonio.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const mQtdPat = document.getElementById('metricEstoqueQtdPatrimonio');
  if (mQtdPat) mQtdPat.textContent = `${qtdPatrimonio} itens patrimoniados`;

  const mLoc = document.getElementById('metricEstoqueLocais');
  if (mLoc) mLoc.textContent = listaEstoqueLocais.length;

  // Badges no Menu e Drawer
  const sideBadge = document.getElementById('sideCountEstoque');
  if (sideBadge) {
    sideBadge.textContent = `${totItens} itens`;
    sideBadge.classList.remove('hidden');
  }
  const drawerBadge = document.getElementById('drawerBadgeEstoque');
  if (drawerBadge) {
    drawerBadge.textContent = `${totItens} itens`;
  }

  // Atualiza indicadores de bens alocados em campo
  if (typeof atualizarBensAlocadosCampoUI === 'function') {
    atualizarBensAlocadosCampoUI();
  }
}

// Filtragem e renderização da grade de itens
function filtrarEstoqueUI() {
  const termo = (document.getElementById('buscaEstoqueInput')?.value || '').toLowerCase().trim();
  const filtroLocal = document.getElementById('filtroEstoqueLocal')?.value || 'todos';
  const filtroCat = document.getElementById('filtroEstoqueCategoria')?.value || 'todas';
  const filtroStatus = document.getElementById('filtroEstoqueStatus')?.value || 'todos';

  let filtrados = listaEstoqueItens.filter(item => {
    // Busca textual
    if (termo) {
      const matchNome = (item.nome || '').toLowerCase().includes(termo);
      const matchMarca = (item.marca || '').toLowerCase().includes(termo);
      const matchPat = (item.patrimonio || '').toLowerCase().includes(termo);
      const matchCat = (item.categoria || '').toLowerCase().includes(termo);
      const matchEmp = (item.empresa || '').toLowerCase().includes(termo);
      if (!matchNome && !matchMarca && !matchPat && !matchCat && !matchEmp) return false;
    }

    // Filtro Galpão
    if (filtroLocal !== 'todos' && item.local !== filtroLocal) return false;

    // Filtro Categoria
    if (filtroCat !== 'todas' && item.categoria !== filtroCat) return false;

    // Filtro Status / Patrimônio
    if (filtroStatus === 'critico') {
      const qtd = Number(item.quantidade || 0);
      const min = Number(item.qtd_minima || 0);
      if (qtd > min) return false;
    } else if (filtroStatus === 'patrimonio') {
      if (!item.patrimonio || item.patrimonio.trim() === '') return false;
    }

    return true;
  });

  renderizarEstoqueGrid(filtrados);
}

// Funções auxiliares para foto via URL na internet
function aoDigitarUrlFotoItemEstoque(url) {
  const preview = document.getElementById('itemEstoqueFotoPreview');
  const placeholder = document.getElementById('itemEstoqueFotoPlaceholder');
  if (!preview || !placeholder) return;

  const urlLimpa = (url || '').trim();
  if (urlLimpa.length > 5) {
    preview.src = urlLimpa;
    preview.classList.remove('hidden');
    placeholder.classList.add('hidden');
  } else {
    preview.src = '';
    preview.classList.add('hidden');
    placeholder.classList.remove('hidden');
  }
}

function tratarErroFotoPreviewItemEstoque() {
  const preview = document.getElementById('itemEstoqueFotoPreview');
  const placeholder = document.getElementById('itemEstoqueFotoPlaceholder');
  if (preview) preview.classList.add('hidden');
  if (placeholder) placeholder.classList.remove('hidden');
}

function limparFotoItemEstoqueForm() {
  const input = document.getElementById('itemEstoqueFormFotoUrl');
  if (input) input.value = '';
  aoDigitarUrlFotoItemEstoque('');
}

// Renderização dos cards de estoque
function renderizarEstoqueGrid(itens) {
  const grid = document.getElementById('estoqueItensGrid');
  const vazio = document.getElementById('estoqueVazio');
  if (!grid) return;

  if (itens.length === 0) {
    grid.innerHTML = '';
    if (vazio) vazio.classList.remove('hidden');
    return;
  }

  if (vazio) vazio.classList.add('hidden');

  grid.innerHTML = itens.map(item => {
    const qtd = Number(item.quantidade || 0);
    const min = Number(item.qtd_minima || 0);
    const isCritico = qtd <= min;
    const temPatrimonio = item.patrimonio && item.patrimonio.trim() !== '';

    let catBadgeColor = 'bg-slate-100 text-slate-700';
    let catIcon = 'fa-box';
    if (item.categoria === 'Alojamento') {
      catBadgeColor = 'bg-sky-50 text-sky-700 border border-sky-200';
      catIcon = 'fa-bed';
    } else if (item.categoria === 'Manutenção') {
      catBadgeColor = 'bg-amber-50 text-amber-700 border border-amber-200';
      catIcon = 'fa-wrench';
    } else if (item.categoria === 'Limpeza') {
      catBadgeColor = 'bg-teal-50 text-teal-700 border border-teal-200';
      catIcon = 'fa-broom';
    } else if (item.categoria === 'Móveis/Eletros') {
      catBadgeColor = 'bg-purple-50 text-purple-700 border border-purple-200';
      catIcon = 'fa-couch';
    }

    return `
      <div class="bg-white rounded-2xl border ${isCritico ? 'border-rose-300 shadow-rose-50/50' : 'border-slate-200'} shadow-sm hover:shadow-md transition p-4 sm:p-5 flex flex-col justify-between">
        
        <!-- Topo do Card -->
        <div>
          <div class="flex items-start justify-between gap-2 mb-2">
            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${catBadgeColor}">
              <i class="fa-solid ${catIcon} text-[10px]"></i> ${item.categoria}
            </span>

            <div class="flex items-center gap-1">
              ${isCritico ? `
                <span class="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold text-[10px] flex items-center gap-1">
                  <i class="fa-solid fa-triangle-exclamation"></i> Baixo
                </span>
              ` : `
                <span class="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[10px]">
                  Normal
                </span>
              `}
            </div>
          </div>

          <!-- Informações do Item com Foto opcional -->
          <div class="flex items-start gap-3 my-1">
            ${item.foto_url ? `
              <div class="w-16 h-16 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 flex-shrink-0 cursor-pointer shadow-sm group relative" onclick="abrirDetalhesItemEstoque('${item.id}')" title="Clique para ampliar">
                <img src="${item.foto_url}" alt="${item.nome}" class="w-full h-full object-cover group-hover:scale-105 transition" onerror="this.parentElement.style.display='none'">
              </div>
            ` : ''}

            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-bold text-slate-900 leading-snug hover:text-teal-700 transition cursor-pointer" onclick="abrirDetalhesItemEstoque('${item.id}')">
                ${item.nome}
              </h3>

              <div class="mt-1 flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                <i class="fa-solid fa-warehouse text-amber-500 text-[11px]"></i>
                <span class="truncate">${item.local || 'Almoxarifado'}</span>
              </div>
            </div>
          </div>

          <!-- Informações de Patrimônio & Valor (se existirem) -->
          ${temPatrimonio || item.valor ? `
            <div class="mt-2.5 p-2 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs">
              ${temPatrimonio ? `
                <span class="font-mono text-[11px] font-bold text-indigo-700 bg-indigo-100/70 px-2 py-0.5 rounded border border-indigo-200" title="Plaqueta de Patrimônio">
                  <i class="fa-solid fa-tag text-[9px] mr-1"></i>${item.patrimonio}
                </span>
              ` : '<span class="text-[10px] text-slate-400">Sem plaqueta</span>'}

              ${item.valor ? `
                <span class="font-bold text-slate-800 text-xs">
                  ${Number(item.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  <span class="text-[10px] text-slate-400 font-normal">/un</span>
                </span>
              ` : ''}
            </div>
          ` : ''}
        </div>

        <!-- Rodapé do Card com Saldo e Botões -->
        <div class="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between gap-2">
          <div>
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Saldo em Estoque</span>
            <div class="flex items-baseline gap-1">
              <span class="text-xl font-black ${isCritico ? 'text-rose-600' : 'text-slate-900'}">${qtd}</span>
              <span class="text-xs font-bold text-slate-500">${item.unidade || 'UN'}</span>
            </div>
          </div>

          <!-- Ações Rápidas -->
          <div class="flex items-center gap-1">
            <button onclick="abrirMovimentacaoRapidaItem('${item.id}', 'entrada')" class="btn-prefeito p-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold transition" title="Dar Entrada (+)">
              <i class="fa-solid fa-plus"></i>
            </button>
            <button onclick="abrirMovimentacaoRapidaItem('${item.id}', 'saida')" class="btn-prefeito p-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold transition" title="Dar Baixa / Saída (-)">
              <i class="fa-solid fa-minus"></i>
            </button>
            <button onclick="abrirDetalhesItemEstoque('${item.id}')" class="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs transition" title="Ver Histórico e Detalhes">
              <i class="fa-solid fa-clock-rotate-left"></i>
            </button>
            <button onclick="editarItemEstoque('${item.id}')" class="btn-prefeito p-2 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 text-xs transition" title="Editar Item">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button onclick="excluirItemEstoque('${item.id}')" class="btn-prefeito p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 text-xs transition" title="Excluir Item do Estoque">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>

        </div>

      </div>
    `;
  }).join('');
}

// Criar / Editar Item do Estoque
function openModalNovoItemEstoque() {
  const form = document.getElementById('formItemEstoque');
  if (form) form.reset();
  document.getElementById('itemEstoqueFormId').value = '';
  document.getElementById('modalItemEstoqueFormTitulo').textContent = 'Cadastrar Item no Estoque';
  document.getElementById('itemEstoqueFormQtd').value = 0;
  document.getElementById('itemEstoqueFormQtdMinima').value = 2;
  limparFotoItemEstoqueForm();
  const btnExcluir = document.getElementById('btnExcluirItemEstoqueModal');
  if (btnExcluir) btnExcluir.classList.add('hidden');
  popularSelectsLocaisEstoque();
  abrirModal('modalItemEstoqueForm');
}

function editarItemEstoque(id) {
  const item = listaEstoqueItens.find(x => x.id === id);
  if (!item) return;

  const form = document.getElementById('formItemEstoque');
  if (form) form.reset();
  popularSelectsLocaisEstoque();

  const setVal = (fieldId, val) => { const el = document.getElementById(fieldId); if (el) el.value = val; };
  setVal('itemEstoqueFormId', item.id);
  setVal('itemEstoqueFormNome', item.nome || '');
  setVal('itemEstoqueFormCategoria', item.categoria || 'Alojamento');
  setVal('itemEstoqueFormLocal', item.local || listaEstoqueLocais[0]);
  setVal('itemEstoqueFormQtd', item.quantidade || 0);
  setVal('itemEstoqueFormUnidade', item.unidade || 'UN');
  setVal('itemEstoqueFormQtdMinima', item.qtd_minima || 2);
  setVal('itemEstoqueFormPatrimonio', item.patrimonio || '');
  setVal('itemEstoqueFormValor', item.valor || '');
  setVal('itemEstoqueFormEmpresa', item.empresa || '');
  setVal('itemEstoqueFormMarca', item.marca || '');
  setVal('itemEstoqueFormObs', item.observacoes || '');
  setVal('itemEstoqueFormFotoUrl', item.foto_url || '');

  aoDigitarUrlFotoItemEstoque(item.foto_url || '');

  const btnExcluir = document.getElementById('btnExcluirItemEstoqueModal');
  if (btnExcluir) btnExcluir.classList.remove('hidden');

  document.getElementById('modalItemEstoqueFormTitulo').textContent = 'Editar Item do Estoque';
  abrirModal('modalItemEstoqueForm');
}

async function salvarItemEstoque(event) {
  event.preventDefault();

  const id = document.getElementById('itemEstoqueFormId').value || ('EST-' + Date.now());
  const nome = document.getElementById('itemEstoqueFormNome').value.trim();
  const categoria = document.getElementById('itemEstoqueFormCategoria').value;
  const local = document.getElementById('itemEstoqueFormLocal').value;
  const quantidade = parseInt(document.getElementById('itemEstoqueFormQtd').value) || 0;
  const unidade = document.getElementById('itemEstoqueFormUnidade').value;
  const qtdMinima = parseInt(document.getElementById('itemEstoqueFormQtdMinima').value) || 0;
  const patrimonio = document.getElementById('itemEstoqueFormPatrimonio').value.trim();
  const valor = parseFloat(document.getElementById('itemEstoqueFormValor').value) || 0;
  const empresa = document.getElementById('itemEstoqueFormEmpresa').value.trim();
  const marca = document.getElementById('itemEstoqueFormMarca').value.trim();
  const observacoes = document.getElementById('itemEstoqueFormObs').value.trim();
  const foto_url = (document.getElementById('itemEstoqueFormFotoUrl')?.value || '').trim();

  const itemObj = {
    id,
    nome,
    categoria,
    local,
    quantidade,
    unidade,
    qtd_minima: qtdMinima,
    patrimonio,
    valor,
    empresa,
    marca,
    observacoes,
    foto_url,
    atualizado_em: new Date().toISOString()
  };

  const idx = listaEstoqueItens.findIndex(x => x.id === id);
  if (idx >= 0) {
    listaEstoqueItens[idx] = itemObj;
  } else {
    listaEstoqueItens.push(itemObj);
  }

  try { localStorage.setItem('estoque_itens_cache', JSON.stringify(listaEstoqueItens)); } catch (e) {}

  atualizarContadoresEstoqueUI();
  filtrarEstoqueUI();
  fecharModal('modalItemEstoqueForm');
  showToast(`Item "${nome}" salvo no estoque com sucesso!`, 'success');

  registrarAuditoria(
    'estoque',
    idx >= 0 ? 'EDITAR' : 'CRIAR',
    nome,
    `${idx >= 0 ? 'Editou' : 'Cadastrou'} item de estoque "${nome}" (${quantidade} ${unidade}) no local "${local}"`
  );

  if (firestoreDb) {
    try {
      await firestoreDb.collection('estoque_itens').doc(id).set(itemObj, { merge: true });
    } catch (err) {
      console.warn("Erro ao salvar item no Firestore:", err);
    }
  }
}

// Movimentações de Estoque (Entradas e Saídas)
function openModalMovimentacaoEstoque(tipo = 'entrada') {
  const form = document.getElementById('formMovimentacaoEstoque');
  if (form) form.reset();

  popularSelectsLocaisEstoque();
  popularSelectItensMovimentacao();

  document.getElementById('movimentacaoTipo').value = tipo;
  document.getElementById('movimentacaoData').value = new Date().toISOString().split('T')[0];
  document.getElementById('movimentacaoQtd').value = 1;

  const topo = document.getElementById('movimentacaoEstoqueTopo');
  const tit = document.getElementById('movimentacaoEstoqueTitulo');
  const btn = document.getElementById('btnSalvarMovimentacaoEstoque');

  if (tipo === 'entrada') {
    topo.className = 'px-5 py-3.5 bg-emerald-600 text-white flex items-center justify-between';
    tit.textContent = 'Registrar Entrada no Estoque';
    btn.className = 'btn-prefeito px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm';
    btn.innerHTML = '<i class="fa-solid fa-arrow-down mr-1"></i> Confirmar Entrada';
  } else {
    topo.className = 'px-5 py-3.5 bg-rose-600 text-white flex items-center justify-between';
    tit.textContent = 'Registrar Saída / Baixa do Estoque';
    btn.className = 'btn-prefeito px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm';
    btn.innerHTML = '<i class="fa-solid fa-arrow-up mr-1"></i> Confirmar Saída';
  }

  // Atualizar badge do primeiro item
  const firstItem = document.getElementById('movimentacaoItemId')?.value;
  if (firstItem) aoSelecionarItemMovimentacao(firstItem);

  abrirModal('modalMovimentacaoEstoque');
}

function abrirMovimentacaoRapidaItem(itemId, tipo) {
  openModalMovimentacaoEstoque(tipo);
  const select = document.getElementById('movimentacaoItemId');
  if (select) {
    select.value = itemId;
    aoSelecionarItemMovimentacao(itemId);
  }
}

function popularSelectItensMovimentacao() {
  const select = document.getElementById('movimentacaoItemId');
  if (!select) return;

  if (listaEstoqueItens.length === 0) {
    select.innerHTML = '<option value="">Nenhum item cadastrado</option>';
    return;
  }

  select.innerHTML = listaEstoqueItens.map(item => `
    <option value="${item.id}">${item.nome} (${item.quantidade || 0} ${item.unidade || 'UN'}) - ${item.local || ''}</option>
  `).join('');
}

function aoSelecionarItemMovimentacao(itemId) {
  const item = listaEstoqueItens.find(x => x.id === itemId);
  const badge = document.getElementById('movimentacaoSaldoAtualBadge');
  const locSelect = document.getElementById('movimentacaoLocal');
  if (item && badge) {
    badge.innerHTML = `Saldo Atual: <b class="text-teal-700">${item.quantidade || 0} ${item.unidade || 'UN'}</b> no <i>${item.local}</i>`;
    if (locSelect) locSelect.value = item.local;
  }
}

async function salvarMovimentacaoEstoque(event) {
  event.preventDefault();

  const itemId = document.getElementById('movimentacaoItemId').value;
  const item = listaEstoqueItens.find(x => x.id === itemId);
  if (!item) {
    showToast('Selecione um item válido!', 'warning');
    return;
  }

  const tipo = document.getElementById('movimentacaoTipo').value; // 'entrada' ou 'saida'
  const qtd = parseInt(document.getElementById('movimentacaoQtd').value) || 1;
  const data = document.getElementById('movimentacaoData').value;
  const motivo = document.getElementById('movimentacaoMotivo').value.trim();
  const responsavel = document.getElementById('movimentacaoResponsavel').value.trim() || 'Almoxarifado';
  const local = document.getElementById('movimentacaoLocal').value || item.local;

  if (tipo === 'saida' && qtd > Number(item.quantidade || 0)) {
    if (!confirm(`Atenção: A quantidade de saída (${qtd}) é maior que o saldo em estoque (${item.quantidade || 0}). Deseja continuar mesmo assim?`)) {
      return;
    }
  }

  // Atualizar saldo
  const saldoAnterior = Number(item.quantidade || 0);
  const novoSaldo = tipo === 'entrada' ? (saldoAnterior + qtd) : Math.max(0, saldoAnterior - qtd);
  item.quantidade = novoSaldo;
  item.local = local;

  const movId = 'MOV-' + Date.now();
  const movObj = {
    id: movId,
    item_id: itemId,
    item_nome: item.nome,
    tipo: tipo,
    quantidade: qtd,
    saldo_anterior: saldoAnterior,
    novo_saldo: novoSaldo,
    data: data,
    motivo: motivo,
    responsavel: responsavel,
    local: local,
    criado_em: new Date().toISOString()
  };

  listaEstoqueMovimentacoes.unshift(movObj);

  try {
    localStorage.setItem('estoque_itens_cache', JSON.stringify(listaEstoqueItens));
    localStorage.setItem('estoque_movimentacoes_cache', JSON.stringify(listaEstoqueMovimentacoes));
  } catch (e) {}

  atualizarContadoresEstoqueUI();
  filtrarEstoqueUI();
  fecharModal('modalMovimentacaoEstoque');

  showToast(`${tipo === 'entrada' ? 'Entrada' : 'Saída'} de ${qtd}x "${item.nome}" registrada! Novo saldo: ${novoSaldo}`, 'success');

  registrarAuditoria(
    'estoque',
    tipo === 'entrada' ? 'ENTRADA' : 'SAIDA',
    item.nome,
    `${tipo === 'entrada' ? 'Entrada' : 'Saída'} de ${qtd}x "${item.nome}" (${local}). Saldo: ${saldoAnterior} ➔ ${novoSaldo}${motivo ? ' - Motivo: ' + motivo : ''}`,
    responsavel
  );

  if (firestoreDb) {
    try {
      await firestoreDb.collection('estoque_itens').doc(itemId).update({
        quantidade: novoSaldo,
        local: local,
        atualizado_em: new Date().toISOString()
      });
      await firestoreDb.collection('estoque_movimentacoes').doc(movId).set(movObj);
    } catch (err) {
      console.warn("Erro ao registrar movimentação no Firestore:", err);
    }
  }
}

// Detalhes e Histórico de Item
function abrirDetalhesItemEstoque(id) {
  const item = listaEstoqueItens.find(x => x.id === id);
  if (!item) return;

  itemEstoqueSelecionadoId = id;

  document.getElementById('modalItemDetalhesTitulo').textContent = item.nome;
  document.getElementById('modalItemDetalhesSubtitulo').textContent = `${item.categoria} • ${item.local}`;
  document.getElementById('modalItemDetalhesSaldo').textContent = `${item.quantidade || 0} ${item.unidade || 'UN'}`;
  document.getElementById('modalItemDetalhesPatrimonio').textContent = item.patrimonio ? `#${item.patrimonio.replace('#', '')}` : 'Sem plaqueta';
  document.getElementById('modalItemDetalhesValor').textContent = item.valor ? Number(item.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Não informado';

  // Foto do item em destaque
  const containerFoto = document.getElementById('modalItemDetalhesFotoContainer');
  const imgFoto = document.getElementById('modalItemDetalhesFotoImg');
  if (containerFoto && imgFoto) {
    if (item.foto_url && item.foto_url.trim() !== '') {
      imgFoto.src = item.foto_url;
      containerFoto.classList.remove('hidden');
    } else {
      imgFoto.src = '';
      containerFoto.classList.add('hidden');
    }
  }

  // Histórico
  const container = document.getElementById('modalItemMovimentacoesLista');
  const movs = listaEstoqueMovimentacoes.filter(m => m.item_id === id);

  if (movs.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-400 italic py-3 text-center">Nenhuma movimentação registrada para este item ainda.</p>';
  } else {
    container.innerHTML = movs.map(m => `
      <div class="p-2.5 rounded-xl border border-slate-200 text-xs flex items-center justify-between bg-white">
        <div class="flex items-center gap-2">
          <span class="w-6 h-6 rounded-lg ${m.tipo === 'entrada' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'} flex items-center justify-center font-bold text-[10px]">
            ${m.tipo === 'entrada' ? '+' : '-'}
          </span>
          <div>
            <p class="font-bold text-slate-800 leading-tight">${m.motivo || 'Sem motivo'}</p>
            <p class="text-[10px] text-slate-400 font-medium">${m.data || ''} • Resp: ${m.responsavel || 'Almoxarifado'}</p>
          </div>
        </div>
        <div class="text-right">
          <span class="font-bold text-sm ${m.tipo === 'entrada' ? 'text-emerald-600' : 'text-rose-600'}">
            ${m.tipo === 'entrada' ? '+' : '-'}${m.quantidade}
          </span>
          <span class="text-[10px] text-slate-400 block">Saldo: ${m.novo_saldo}</span>
        </div>
      </div>
    `).join('');
  }

  const btnEdit = document.getElementById('btnEditarItemPeloDetalhe');
  if (btnEdit) {
    btnEdit.onclick = () => {
      fecharModal('modalItemEstoqueDetalhes');
      editarItemEstoque(id);
    };
  }

  const btnExcluir = document.getElementById('btnExcluirItemPeloDetalhe');
  if (btnExcluir) {
    btnExcluir.onclick = () => {
      excluirItemEstoque(id);
    };
  }

  abrirModal('modalItemEstoqueDetalhes');
}

// Excluir Item do Estoque
async function excluirItemEstoque(id) {
  const item = listaEstoqueItens.find(x => x.id === id);
  const nome = item ? item.nome : 'Item';

  if (!confirm(`Tem certeza que deseja excluir o item "${nome}" do estoque? Esta ação não pode ser desfeita.`)) {
    return;
  }

  listaEstoqueItens = listaEstoqueItens.filter(x => x.id !== id);

  try {
    localStorage.setItem('estoque_itens_cache', JSON.stringify(listaEstoqueItens));
  } catch (e) {}

  fecharModal('modalItemEstoqueDetalhes');
  fecharModal('modalItemEstoqueForm');

  atualizarContadoresEstoqueUI();
  filtrarEstoqueUI();

  showToast(`Item "${nome}" excluído do estoque com sucesso!`, 'success');

  registrarAuditoria(
    'estoque',
    'EXCLUIR',
    nome,
    `Excluiu item de estoque "${nome}" (ID: ${id})`
  );

  if (firestoreDb) {
    try {
      await firestoreDb.collection('estoque_itens').doc(id).delete();
    } catch (err) {
      console.warn("Erro ao excluir item do Firestore:", err);
    }
  }
}

function excluirItemEstoqueAtual() {
  const id = document.getElementById('itemEstoqueFormId') ? document.getElementById('itemEstoqueFormId').value : null;
  if (id) {
    excluirItemEstoque(id);
  }
}

// Gerenciamento de Galpões e Locais
function openModalLocaisEstoque() {
  renderizarListaLocaisModal();
  abrirModal('modalLocaisEstoque');
}

function renderizarListaLocaisModal() {
  const container = document.getElementById('listaLocaisEstoqueContainer');
  if (!container) return;

  container.innerHTML = listaEstoqueLocais.map((loc, idx) => `
    <div class="p-2.5 px-3 flex items-center justify-between text-xs font-semibold text-slate-800 bg-white hover:bg-slate-50">
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-warehouse text-amber-500 text-xs"></i>
        <span>${loc}</span>
      </div>
      ${listaEstoqueLocais.length > 1 ? `
        <button onclick="removerLocalEstoque(${idx})" class="btn-prefeito text-slate-400 hover:text-rose-600 p-1" title="Excluir Galpão">
          <i class="fa-solid fa-trash-can text-[11px]"></i>
        </button>
      ` : ''}
    </div>
  `).join('');
}

async function adicionarLocalEstoque(event) {
  event.preventDefault();
  const input = document.getElementById('novoLocalEstoqueNome');
  const nome = input.value.trim();
  if (!nome) return;

  if (listaEstoqueLocais.includes(nome)) {
    showToast('Este galpão já existe!', 'warning');
    return;
  }

  listaEstoqueLocais.push(nome);
  input.value = '';
  try { localStorage.setItem('estoque_locais_cache', JSON.stringify(listaEstoqueLocais)); } catch (e) {}

  popularSelectsLocaisEstoque();
  showToast(`Galpão "${nome}" adicionado com sucesso!`, 'success');

  if (firestoreDb) {
    try {
      await firestoreDb.collection('configuracoes').doc('estoque_locais').set({
        locais: listaEstoqueLocais,
        atualizado_em: new Date().toISOString()
      }, { merge: true });
    } catch (e) {}
  }
}

async function removerLocalEstoque(idx) {
  const nome = listaEstoqueLocais[idx];
  if (!confirm(`Deseja realmente remover o local "${nome}"?`)) return;

  listaEstoqueLocais.splice(idx, 1);
  try { localStorage.setItem('estoque_locais_cache', JSON.stringify(listaEstoqueLocais)); } catch (e) {}

  popularSelectsLocaisEstoque();
  showToast(`Galpão "${nome}" removido.`, 'info');

  if (firestoreDb) {
    try {
      await firestoreDb.collection('configuracoes').doc('estoque_locais').set({
        locais: listaEstoqueLocais,
        atualizado_em: new Date().toISOString()
      }, { merge: true });
    } catch (e) {}
  }
}

// Integração com Chamados do QR Code: Dar Baixa Automática de Material
function abrirModalConcluirChamadoEstoque(protocolo) {
  const ch = listaChamados.find(c => c.protocolo === protocolo || c.id === protocolo);
  if (!ch) return;

  document.getElementById('chamadoConcluirProtocolo').value = protocolo;
  document.getElementById('chamadoConcluirInfoQuarto').textContent = `Quarto: ${ch.quarto || 'Não informado'} (${ch.bloco || 'Geral'}) - Solicitante: ${ch.nome_alojado || 'Anônimo'}`;
  document.getElementById('chamadoConcluirInfoDescricao').textContent = `Defeito Relatado: "${ch.descricao || ch.tipo_problema || 'Manutenção'}"`;
  document.getElementById('chamadoConcluirObs').value = '';

  // Popular select com materiais de manutenção/alojamento
  const sel = document.getElementById('chamadoEstoqueItemSelect');
  if (sel) {
    const itensReparo = listaEstoqueItens.filter(i => i.categoria === 'Manutenção' || i.categoria === 'Alojamento');
    sel.innerHTML = '<option value="">Nenhum material do estoque (apenas conserto/ajuste)</option>' + 
      itensReparo.map(i => `<option value="${i.id}">${i.nome} (Saldo: ${i.quantidade} ${i.unidade}) - ${i.local}</option>`).join('');

    // Sugerir item automaticamente baseado no texto do chamado
    const desc = (ch.descricao || '').toLowerCase();
    if (desc.includes('lâmpada') || desc.includes('lampada') || desc.includes('luz')) {
      const lamp = itensReparo.find(i => i.nome.toLowerCase().includes('lâmpada') || i.nome.toLowerCase().includes('lampada'));
      if (lamp) sel.value = lamp.id;
    } else if (desc.includes('chuveiro') || desc.includes('banho') || desc.includes('resistência')) {
      const chuv = itensReparo.find(i => i.nome.toLowerCase().includes('chuveiro'));
      if (chuv) sel.value = chuv.id;
    } else if (desc.includes('colchão') || desc.includes('colchao') || desc.includes('cama')) {
      const col = itensReparo.find(i => i.nome.toLowerCase().includes('colchão') || i.nome.toLowerCase().includes('colchao'));
      if (col) sel.value = col.id;
    }
  }

  popularSelectsLocaisEstoque();
  abrirModal('modalConcluirChamadoComEstoque');
}

async function confirmarConclusaoChamadoComEstoque(event) {
  event.preventDefault();

  const protocolo = document.getElementById('chamadoConcluirProtocolo').value;
  const itemId = document.getElementById('chamadoEstoqueItemSelect').value;
  const qtd = parseInt(document.getElementById('chamadoEstoqueQtd').value) || 1;
  const local = document.getElementById('chamadoEstoqueLocal').value;
  const obs = document.getElementById('chamadoConcluirObs').value.trim();

  const ch = listaChamados.find(c => c.protocolo === protocolo || c.id === protocolo);
  if (!ch) return;

  // Se selecionou material, dar baixa automática no estoque
  if (itemId) {
    const item = listaEstoqueItens.find(x => x.id === itemId);
    if (item) {
      const saldoAnterior = Number(item.quantidade || 0);
      const novoSaldo = Math.max(0, saldoAnterior - qtd);
      item.quantidade = novoSaldo;

      const movId = 'MOV-' + Date.now();
      const movObj = {
        id: movId,
        item_id: itemId,
        item_nome: item.nome,
        tipo: 'saida',
        quantidade: qtd,
        saldo_anterior: saldoAnterior,
        novo_saldo: novoSaldo,
        data: new Date().toISOString().split('T')[0],
        motivo: `Reparo Chamado #${protocolo} (${ch.quarto || ''}): ${ch.descricao || 'Manutenção'}`,
        responsavel: (typeof currentUserName !== 'undefined' ? currentUserName : 'Prefeito'),
        local: local || item.local,
        criado_em: new Date().toISOString()
      };

      listaEstoqueMovimentacoes.unshift(movObj);

      try {
        localStorage.setItem('estoque_itens_cache', JSON.stringify(listaEstoqueItens));
        localStorage.setItem('estoque_movimentacoes_cache', JSON.stringify(listaEstoqueMovimentacoes));
      } catch (e) {}

      if (firestoreDb) {
        try {
          await firestoreDb.collection('estoque_itens').doc(itemId).update({
            quantidade: novoSaldo,
            atualizado_em: new Date().toISOString()
          });
          await firestoreDb.collection('estoque_movimentacoes').doc(movId).set(movObj);
        } catch (e) {}
      }
    }
  }

  // Concluir chamado
  ch.status = 'concluido';
  if (obs) ch.observacoes_prefeito = obs;
  atualizarContadoresChamadosUI();
  filtrarChamadosUI();
  fecharModal('modalConcluirChamadoComEstoque');
  showToast(`Chamado #${protocolo} concluído e baixa realizada com sucesso!`, 'success');

  registrarAuditoria(
    'chamados',
    'CHAMADO',
    `#${protocolo}`,
    `Concluiu chamado #${protocolo} (${ch.quarto || 'Quarto'})${itemId ? ` com baixa de ${qtd}x material` : ''}${obs ? ' - Obs: ' + obs : ''}`
  );

  if (firestoreDb) {
    try {
      await firestoreDb.collection('chamados_suporte').doc(protocolo).update({
        status: 'concluido',
        observacoes_prefeito: obs || '',
        atualizado_em: firebase.firestore.FieldValue.serverTimestamp(),
        atualizado_por: (typeof currentUserName !== 'undefined' ? currentUserName : 'Prefeito')
      });
    } catch (e) {}
  }
}

// Recarregar manual do Estoque
function recarregarEstoqueManual() {
  const icone = document.getElementById('iconeReloadEstoque');
  if (icone) icone.classList.add('fa-spin');

  if (firestoreDb) {
    Promise.all([
      firestoreDb.collection('estoque_itens').get(),
      firestoreDb.collection('estoque_movimentacoes').get()
    ]).then(([snapItens, snapMovs]) => {
      if (!snapItens.empty) {
        const itens = [];
        snapItens.forEach(doc => itens.push({ id: doc.id, ...doc.data() }));
        itens.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
        listaEstoqueItens = itens;
        localStorage.setItem('estoque_itens_cache', JSON.stringify(listaEstoqueItens));
      }
      if (!snapMovs.empty) {
        const movs = [];
        snapMovs.forEach(doc => movs.push({ id: doc.id, ...doc.data() }));
        movs.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
        listaEstoqueMovimentacoes = movs;
        localStorage.setItem('estoque_movimentacoes_cache', JSON.stringify(listaEstoqueMovimentacoes));
      }
      atualizarContadoresEstoqueUI();
      filtrarEstoqueUI();
      if (icone) icone.classList.remove('fa-spin');
      showToast('Estoque sincronizado com a nuvem!', 'success');
    }).catch(err => {
      if (icone) icone.classList.remove('fa-spin');
      showToast('Erro ao recarregar estoque: ' + err.message, 'error');
    });
  } else {
    if (icone) icone.classList.remove('fa-spin');
    filtrarEstoqueUI();
  }
}

// Exposição explícita no window para garantir botões onclick
window.openModalNovoItemEstoque = openModalNovoItemEstoque;
window.editarItemEstoque = editarItemEstoque;
window.salvarItemEstoque = salvarItemEstoque;
window.openModalMovimentacaoEstoque = openModalMovimentacaoEstoque;
window.abrirMovimentacaoRapidaItem = abrirMovimentacaoRapidaItem;
window.aoSelecionarItemMovimentacao = aoSelecionarItemMovimentacao;
window.salvarMovimentacaoEstoque = salvarMovimentacaoEstoque;
window.abrirDetalhesItemEstoque = abrirDetalhesItemEstoque;
window.openModalLocaisEstoque = openModalLocaisEstoque;
window.adicionarLocalEstoque = adicionarLocalEstoque;
window.removerLocalEstoque = removerLocalEstoque;
window.abrirModalConcluirChamadoEstoque = abrirModalConcluirChamadoEstoque;
window.confirmarConclusaoChamadoComEstoque = confirmarConclusaoChamadoComEstoque;
window.recarregarEstoqueManual = recarregarEstoqueManual;
window.filtrarEstoqueUI = filtrarEstoqueUI;
window.excluirItemEstoque = excluirItemEstoque;
window.aoSelecionarMovelOrigemEstoque = aoSelecionarMovelOrigemEstoque;

// Exposição das funções de Fotos de Moradores e Transferência/Devolução de Móveis
window.previewFotoMoradorCasa = previewFotoMoradorCasa;
window.limparFotoMoradorCasaForm = limparFotoMoradorCasaForm;
window.openModalNovoMoradorCasa = openModalNovoMoradorCasa;
window.openModalEditarMoradorCasa = openModalEditarMoradorCasa;
window.abrirModalFotoMoradorCasa = abrirModalFotoMoradorCasa;
window.salvarMoradorCasa = salvarMoradorCasa;
window.desocuparCamaCasa = desocuparCamaCasa;

window.openModalTransferirMovelCasa = openModalTransferirMovelCasa;
window.aoMudarCasaDestinoTransferencia = aoMudarCasaDestinoTransferencia;
window.confirmarTransferenciaMovelCasa = confirmarTransferenciaMovelCasa;

window.openModalDevolverMovelEstoque = openModalDevolverMovelEstoque;
window.confirmarDevolucaoMovelEstoque = confirmarDevolucaoMovelEstoque;

// ========================================================
// RASTREABILIDADE PATRIMONIAL & SUB-ABAS DO ESTOQUE
// ========================================================

let subAbaEstoqueAtiva = 'galpoes';

function trocarSubAbaEstoque(aba) {
  subAbaEstoqueAtiva = aba;
  const btnGalpoes = document.getElementById('btnSubAbaEstoque_galpoes');
  const btnAlocados = document.getElementById('btnSubAbaEstoque_alocados');
  const painelGalpoes = document.getElementById('painelEstoqueGalpoes');
  const painelAlocados = document.getElementById('painelEstoqueAlocados');

  if (aba === 'galpoes') {
    if (btnGalpoes) btnGalpoes.className = 'px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-teal-600 text-white shadow-sm';
    if (btnAlocados) btnAlocados.className = 'px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700';
    if (painelGalpoes) painelGalpoes.classList.remove('hidden');
    if (painelAlocados) painelAlocados.classList.add('hidden');
    filtrarEstoqueUI();
  } else {
    if (btnGalpoes) btnGalpoes.className = 'px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700';
    if (btnAlocados) btnAlocados.className = 'px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-indigo-600 text-white shadow-sm';
    if (painelGalpoes) painelGalpoes.classList.add('hidden');
    if (painelAlocados) painelAlocados.classList.remove('hidden');
    atualizarBensAlocadosCampoUI();
  }
}

function obterTodosBensAlocados() {
  const lista = [];

  // 1. Bens nas Casas Urbanas
  if (Array.isArray(listaCasasCidade)) {
    listaCasasCidade.forEach(casa => {
      if (Array.isArray(casa.comodos)) {
        casa.comodos.forEach(comodo => {
          if (Array.isArray(comodo.moveis)) {
            comodo.moveis.forEach(mov => {
              lista.push({
                id: mov.id,
                tipo_origem: 'casa',
                casa_id: casa.id,
                casa_nome: casa.nome || casa.identificador || 'Casa Urbana',
                comodo_id: comodo.id,
                comodo_nome: comodo.nome || comodo.tipo || 'Cômodo',
                local_formatado: `${casa.nome || casa.identificador || 'Casa'} • ${comodo.nome || comodo.tipo || 'Cômodo'}`,
                endereco: casa.endereco || 'Área Urbana',
                nome: mov.tipo || 'Móvel / Equipamento',
                marca: mov.marca || '',
                patrimonio: mov.patrimonio || '',
                valor: Number(mov.valor || 0),
                quantidade: Number(mov.quantidade || 1),
                estado: mov.estado || 'Bom',
                empresa: mov.empresa || '',
                foto_url: mov.foto_url || ''
              });
            });
          }
        });
      }
    });
  }

  // 2. Bens nos Quartos de Alojamento
  if (typeof StaticApiEngine !== 'undefined' && StaticApiEngine.dbState && Array.isArray(StaticApiEngine.dbState.quartos)) {
    StaticApiEngine.dbState.quartos.forEach(quarto => {
      if (Array.isArray(quarto.moveis)) {
        quarto.moveis.forEach(mov => {
          lista.push({
            id: mov.id,
            tipo_origem: 'alojamento',
            quarto_id: quarto.id,
            bloco_id: quarto.bloco_id,
            quarto_numero: quarto.numero,
            bloco_nome: quarto.bloco_nome || '',
            local_formatado: `Alojamento Bloco ${quarto.bloco_nome || ''} • Quarto ${quarto.numero}`,
            endereco: 'Canteiro de Obras / Alojamento',
            nome: mov.tipo_item || mov.tipo || 'Móvel de Alojamento',
            marca: mov.marca || '',
            patrimonio: mov.patrimonio || '',
            valor: Number(mov.valor || 0),
            quantidade: Number(mov.quantidade || 1),
            estado: mov.estado_conservacao || mov.estado || 'Bom',
            empresa: mov.empresa || '',
            foto_url: mov.foto_url || ''
          });
        });
      }
    });
  }

  return lista;
}

function atualizarBensAlocadosCampoUI() {
  const todosBens = obterTodosBensAlocados();

  // Atualizar badge da sub-aba
  const badgeQtd = document.getElementById('badgeQtdBensAlocados');
  if (badgeQtd) badgeQtd.textContent = todosBens.length;

  // Atualizar KPIs de bens em campo
  const kpiTot = document.getElementById('kpiBensAlocadosTotal');
  const kpiCasas = document.getElementById('kpiBensAlocadosCasas');
  const kpiAloj = document.getElementById('kpiBensAlocadosAlojamentos');
  const kpiVal = document.getElementById('kpiBensAlocadosValorTotal');

  const totCasas = todosBens.filter(b => b.tipo_origem === 'casa').length;
  const totAloj = todosBens.filter(b => b.tipo_origem === 'alojamento').length;
  const valTot = todosBens.reduce((acc, b) => acc + (b.valor * b.quantidade), 0);

  if (kpiTot) kpiTot.textContent = todosBens.length;
  if (kpiCasas) kpiCasas.textContent = totCasas;
  if (kpiAloj) kpiAloj.textContent = totAloj;
  if (kpiVal) kpiVal.textContent = valTot.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  filtrarBensAlocadosUI();
}

function filtrarBensAlocadosUI() {
  const termo = (document.getElementById('buscaBensAlocadosInput')?.value || '').toLowerCase().trim();
  const filtroTipo = document.getElementById('filtroBensAlocadosTipoLocal')?.value || 'todos';
  const filtroEstado = document.getElementById('filtroBensAlocadosEstado')?.value || 'todos';

  const todos = obterTodosBensAlocados();

  let filtrados = todos.filter(bem => {
    if (termo) {
      const matchNome = (bem.nome || '').toLowerCase().includes(termo);
      const matchMarca = (bem.marca || '').toLowerCase().includes(termo);
      const matchPat = (bem.patrimonio || '').toLowerCase().includes(termo);
      const matchLocal = (bem.local_formatado || '').toLowerCase().includes(termo);
      const matchEmp = (bem.empresa || '').toLowerCase().includes(termo);
      if (!matchNome && !matchMarca && !matchPat && !matchLocal && !matchEmp) return false;
    }

    if (filtroTipo !== 'todos' && bem.tipo_origem !== filtroTipo) return false;

    if (filtroEstado !== 'todos') {
      const est = (bem.estado || '').toLowerCase();
      if (filtroEstado === 'Bom' && !est.includes('bom') && !est.includes('ótimo') && !est.includes('excelente')) return false;
      if (filtroEstado === 'Regular' && !est.includes('regular')) return false;
      if (filtroEstado === 'Danificado' && !est.includes('ruim') && !est.includes('danificado') && !est.includes('manuten')) return false;
    }

    return true;
  });

  renderizarGridBensAlocados(filtrados);
}

function renderizarGridBensAlocados(bens) {
  const container = document.getElementById('gridBensAlocadosContainer');
  const vazio = document.getElementById('bensAlocadosVazio');
  if (!container) return;

  if (bens.length === 0) {
    container.innerHTML = '';
    if (vazio) vazio.classList.remove('hidden');
    return;
  }

  if (vazio) vazio.classList.add('hidden');

  container.innerHTML = bens.map(bem => {
    const isCasa = bem.tipo_origem === 'casa';
    const tagLocalClass = isCasa ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-sky-50 text-sky-800 border-sky-200';
    const iconeLocal = isCasa ? 'fa-house' : 'fa-building';

    let estadoBadge = 'bg-emerald-100 text-emerald-800';
    if ((bem.estado || '').toLowerCase().includes('regular')) estadoBadge = 'bg-amber-100 text-amber-800';
    if ((bem.estado || '').toLowerCase().includes('ruim') || (bem.estado || '').toLowerCase().includes('danificado')) estadoBadge = 'bg-rose-100 text-rose-800';

    return `
      <div class="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition p-4 sm:p-5 flex flex-col justify-between">
        <div>
          <!-- Header do Card com Localização -->
          <div class="flex items-start justify-between gap-2 mb-2">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${tagLocalClass}">
              <i class="fa-solid ${iconeLocal}"></i>
              <span class="truncate max-w-[200px]">${bem.local_formatado}</span>
            </span>

            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${estadoBadge}">
              ${bem.estado || 'Bom'}
            </span>
          </div>

          <!-- Nome do Móvel / Bem com Foto se existir -->
          <div class="mt-2 flex items-start gap-3">
            ${bem.foto_url ? `
              <div class="w-14 h-14 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 flex-shrink-0 shadow-sm">
                <img src="${bem.foto_url}" alt="${bem.nome}" class="w-full h-full object-cover" onerror="this.parentElement.style.display='none'">
              </div>
            ` : `
              <div class="w-12 h-12 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center text-lg flex-shrink-0">
                <i class="fa-solid fa-couch"></i>
              </div>
            `}
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-bold text-slate-900 leading-snug">
                ${bem.nome}
              </h3>
              ${bem.marca ? `<p class="text-[11px] text-slate-500 font-medium">Marca: ${bem.marca}</p>` : ''}
              ${bem.empresa ? `<p class="text-[10px] text-indigo-600 font-semibold">Empresa: ${bem.empresa}</p>` : ''}
            </div>
          </div>

          <!-- Plaqueta de Patrimônio & Valor -->
          <div class="mt-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs">
            <div>
              <span class="text-[9px] font-bold text-slate-400 uppercase block">Patrimônio / Plaqueta</span>
              ${bem.patrimonio ? `
                <span class="font-mono text-xs font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded border border-indigo-200 inline-block mt-0.5">
                  <i class="fa-solid fa-tag text-[9px] mr-1"></i>${bem.patrimonio}
                </span>
              ` : '<span class="text-xs text-slate-400 italic">Sem plaqueta</span>'}
            </div>

            <div class="text-right">
              <span class="text-[9px] font-bold text-slate-400 uppercase block">Valor Unitário</span>
              <span class="text-xs font-black text-slate-800">
                ${bem.valor ? Number(bem.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00'}
              </span>
            </div>
          </div>
        </div>

        <!-- Rodapé do Card com Ações Rápidas -->
        <div class="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between gap-2">
          <span class="text-xs font-bold text-slate-600">
            Qtd: <span class="font-black text-slate-900">${bem.quantidade}</span>
          </span>

          <div class="flex items-center gap-1.5">
            ${isCasa ? `
              <button onclick="openModalTransferirMovelCasa('${bem.casa_id}', '${bem.comodo_id}', '${bem.id}')" class="px-2.5 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-bold transition flex items-center gap-1" title="Transferir de Casa ou Cômodo">
                <i class="fa-solid fa-arrow-right-arrow-left"></i> Transferir
              </button>
              <button onclick="openModalDevolverMovelEstoque('${bem.casa_id}', '${bem.comodo_id}', '${bem.id}')" class="px-2.5 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 text-xs font-bold transition flex items-center gap-1" title="Devolver ao Almoxarifado/Estoque">
                <i class="fa-solid fa-box-archive"></i> Devolver
              </button>
            ` : `
              <span class="text-[11px] text-slate-500 font-medium italic">
                <i class="fa-solid fa-bed mr-1"></i> Em uso no Alojamento
              </span>
            `}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ========================================================
// EXPORTAÇÃO DE RELATÓRIO DO ESTOQUE EM EXCEL (.XLSX)
// ========================================================

function exportarRelatorioEstoqueExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('Biblioteca SheetJS ainda não foi carregada. Tente novamente em instantes.', 'error');
    return;
  }

  try {
    const wb = XLSX.utils.book_new();

    // 1. Aba: Saldo em Galpões
    const dadosGalpoes = listaEstoqueItens.map(item => {
      const qtd = Number(item.quantidade || 0);
      const min = Number(item.qtd_minima || 0);
      const val = Number(item.valor || 0);
      const isCritico = qtd <= min;

      return {
        'ID Item': item.id || '',
        'Nome do Material / Bem': item.nome || '',
        'Categoria': item.categoria || '',
        'Galpão / Local': item.local || '',
        'Saldo Atual': qtd,
        'Unidade': item.unidade || 'UN',
        'Estoque Mínimo': min,
        'Status do Saldo': isCritico ? 'CRÍTICO / BAIXO' : 'NORMAL',
        'Plaqueta Patrimônio': item.patrimonio || '',
        'Marca / Modelo': item.marca || '',
        'Empresa Proprietária': item.empresa || '',
        'Valor Unitário (R$)': val,
        'Valor Total em Saldo (R$)': val * qtd,
        'Link da Foto': item.foto_url || '',
        'Observações': item.observacoes || ''
      };
    });
    const wsGalpoes = XLSX.utils.json_to_sheet(dadosGalpoes);
    XLSX.utils.book_append_sheet(wb, wsGalpoes, 'Saldo em Galpões');

    // 2. Aba: Bens Alocados em Campo
    const todosBens = obterTodosBensAlocados();
    const dadosCampo = todosBens.map(b => ({
      'ID Bem': b.id || '',
      'Item / Móvel': b.nome || '',
      'Plaqueta Patrimônio': b.patrimonio || '',
      'Tipo de Instalação': b.tipo_origem === 'casa' ? 'Casa Urbana' : 'Alojamento dos Blocos',
      'Localização / Imóvel': b.tipo_origem === 'casa' ? b.casa_nome : b.local_formatado,
      'Cômodo / Quarto': b.tipo_origem === 'casa' ? b.comodo_nome : `Quarto ${b.quarto_numero || ''}`,
      'Endereço / Referência': b.endereco || '',
      'Quantidade': b.quantidade || 1,
      'Estado de Conservação': b.estado || 'Bom',
      'Marca': b.marca || '',
      'Empresa': b.empresa || '',
      'Valor Estimado Unitário (R$)': b.valor || 0,
      'Valor Estimado Total (R$)': (b.valor || 0) * (b.quantidade || 1),
      'Link da Foto': b.foto_url || ''
    }));
    const wsCampo = XLSX.utils.json_to_sheet(dadosCampo);
    XLSX.utils.book_append_sheet(wb, wsCampo, 'Bens em Campo');

    // 3. Aba: Movimentações Recentes
    const dadosMovs = listaEstoqueMovimentacoes.map(m => ({
      'ID Movimentação': m.id || '',
      'Data': m.data || '',
      'Tipo': (m.tipo || '').toUpperCase(),
      'Item': m.item_nome || '',
      'Quantidade': m.quantidade || 0,
      'Saldo Anterior': m.saldo_anterior || 0,
      'Novo Saldo': m.novo_saldo || 0,
      'Galpão / Local': m.local || '',
      'Motivo / Destino': m.motivo || '',
      'Responsável': m.responsavel || ''
    }));
    const wsMovs = XLSX.utils.json_to_sheet(dadosMovs);
    XLSX.utils.book_append_sheet(wb, wsMovs, 'Histórico de Movimentações');

    // 4. Aba: Resumo Executivo
    const totItensEstoque = listaEstoqueItens.length;
    const totCriticos = listaEstoqueItens.filter(i => Number(i.quantidade || 0) <= Number(i.qtd_minima || 0)).length;
    const valTotalEstoque = listaEstoqueItens.reduce((acc, i) => acc + (Number(i.valor || 0) * Number(i.quantidade || 0)), 0);
    const valTotalCampo = todosBens.reduce((acc, b) => acc + (b.valor * b.quantidade), 0);

    const dadosResumo = [
      { 'Indicador': 'Data de Geração do Relatório', 'Valor': new Date().toLocaleString('pt-BR') },
      { 'Indicador': 'Total de Tipos de Itens em Galpões', 'Valor': totItensEstoque },
      { 'Indicador': 'Itens com Estoque Baixo / Crítico', 'Valor': totCriticos },
      { 'Indicador': 'Valor Total dos Materiais em Galpões (R$)', 'Valor': valTotalEstoque.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) },
      { 'Indicador': 'Total de Bens Alocados em Campo (Casas & Alojamentos)', 'Valor': todosBens.length },
      { 'Indicador': 'Bens Alocados em Casas Urbanas', 'Valor': todosBens.filter(b => b.tipo_origem === 'casa').length },
      { 'Indicador': 'Bens Alocados em Quartos de Alojamento', 'Valor': todosBens.filter(b => b.tipo_origem === 'alojamento').length },
      { 'Indicador': 'Valor Total Estimado de Bens em Campo (R$)', 'Valor': valTotalCampo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) },
      { 'Indicador': 'Patrimônio Consolidado Geral (Galpões + Campo)', 'Valor': (valTotalEstoque + valTotalCampo).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
    ];
    const wsResumo = XLSX.utils.json_to_sheet(dadosResumo);
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo Executivo');

    const dataHoje = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `RELATORIO_ALMOXARIFADO_PATRIMONIO_${dataHoje}.xlsx`);
    showToast('Relatório geral de estoque exportado com sucesso em Excel (.xlsx)!', 'success');
  } catch (err) {
    console.error('Erro ao exportar Excel:', err);
    showToast('Erro ao exportar relatório em Excel: ' + err.message, 'error');
  }
}

// ========================================================
// MÓDULO DE CONTROLE DE RONDA DO CANTEIRO (BANHEIROS & BEBEDOUROS - NR 18 / 24)
// ========================================================

let listaPontosRonda = [];
let listaRegistrosRonda = [];
let listaOcorrenciasRonda = [];
let configRonda = {
  freq_padrao_banheiro: 2,
  freq_padrao_bebedouro: 1,
  limite_manha: '12:00',
  limite_tarde: '17:00',
  senha_equipe: '1234'
};

const PONTOS_RONDA_PADRAO_SEED = [
  {
    id: 'ponto_banheiro_01',
    nome: 'Banheiro Químico 01',
    tipo: 'banheiro',
    setor: 'Frente KM 12',
    frequencia_diaria: 2,
    horarios_sugeridos: '08:30 e 14:00',
    observacoes: 'Frente de terraplenagem, reposição de papel reforçada',
    ativo: true,
    criado_em: new Date().toISOString()
  },
  {
    id: 'ponto_banheiro_02',
    nome: 'Banheiro Químico 02',
    tipo: 'banheiro',
    setor: 'Frente KM 14',
    frequencia_diaria: 2,
    horarios_sugeridos: '09:00 e 14:30',
    observacoes: 'Frente de drenagem e britagem',
    ativo: true,
    criado_em: new Date().toISOString()
  },
  {
    id: 'ponto_banheiro_central',
    nome: 'Banheiro Contêiner 01',
    tipo: 'banheiro',
    setor: 'Canteiro Central',
    frequencia_diaria: 2,
    horarios_sugeridos: '08:00 e 13:30',
    observacoes: 'Sanitário principal próximo aos refeitórios',
    ativo: true,
    criado_em: new Date().toISOString()
  },
  {
    id: 'ponto_banheiro_oficina',
    nome: 'Banheiro Oficina Mecânica',
    tipo: 'banheiro',
    setor: 'Oficina Mecânica',
    frequencia_diaria: 2,
    horarios_sugeridos: '08:00 e 15:00',
    observacoes: 'Área industrial dos mecânicos',
    ativo: true,
    criado_em: new Date().toISOString()
  },
  {
    id: 'ponto_bebedouro_refeitorio',
    nome: 'Bebedouro Industrial 01',
    tipo: 'bebedouro',
    setor: 'Refeitório',
    frequencia_diaria: 1,
    horarios_sugeridos: '07:30',
    observacoes: 'Bebedouro 100L em inox, água gelada para refeições',
    ativo: true,
    criado_em: new Date().toISOString()
  },
  {
    id: 'ponto_bebedouro_km14',
    nome: 'Bebedouro de Coluna 02',
    tipo: 'bebedouro',
    setor: 'Frente KM 14',
    frequencia_diaria: 1,
    horarios_sugeridos: '08:30',
    observacoes: 'Abastecimento diário com garrafão de 20L',
    ativo: true,
    criado_em: new Date().toISOString()
  },
  {
    id: 'ponto_bebedouro_oficina',
    nome: 'Bebedouro Purificador 03',
    tipo: 'bebedouro',
    setor: 'Oficina Mecânica',
    frequencia_diaria: 1,
    horarios_sugeridos: '08:00',
    observacoes: 'Higienização de bicas diária',
    ativo: true,
    criado_em: new Date().toISOString()
  }
];

function inicializarRondaCanteiro() {
  try {
    const cachedPontos = localStorage.getItem('ronda_pontos_cache');
    if (cachedPontos) {
      listaPontosRonda = JSON.parse(cachedPontos);
    } else {
      listaPontosRonda = [...PONTOS_RONDA_PADRAO_SEED];
      localStorage.setItem('ronda_pontos_cache', JSON.stringify(listaPontosRonda));
    }
  } catch (e) {
    listaPontosRonda = [...PONTOS_RONDA_PADRAO_SEED];
  }

  try {
    const cachedRegs = localStorage.getItem('ronda_registros_cache');
    if (cachedRegs) {
      listaRegistrosRonda = JSON.parse(cachedRegs);
    }
  } catch (e) {
    listaRegistrosRonda = [];
  }

  try {
    const cachedOcs = localStorage.getItem('ronda_ocorrencias_cache');
    if (cachedOcs) {
      listaOcorrenciasRonda = JSON.parse(cachedOcs);
    }
  } catch (e) {
    listaOcorrenciasRonda = [];
  }

  try {
    const cachedConf = localStorage.getItem('ronda_config_cache');
    if (cachedConf) {
      configRonda = Object.assign(configRonda, JSON.parse(cachedConf));
    }
  } catch (e) {}

  atualizarContadoresRondaUI();

  // Se houver Firestore conectado, sincronizar pontos, registros, ocorrências e config
  if (typeof firestoreDb !== 'undefined' && firestoreDb) {
    Promise.all([
      firestoreDb.collection('ronda_pontos').get(),
      firestoreDb.collection('ronda_registros').get(),
      firestoreDb.collection('ronda_ocorrencias').get(),
      firestoreDb.collection('ronda_config').doc('geral').get().catch(() => null)
    ]).then(([snapPontos, snapRegs, snapOcs, docConfig]) => {
      if (docConfig && docConfig.exists) {
        configRonda = Object.assign(configRonda, docConfig.data());
        localStorage.setItem('ronda_config_cache', JSON.stringify(configRonda));
      }

      if (!snapPontos.empty) {
        const remotas = [];
        snapPontos.forEach(doc => remotas.push({ id: doc.id, ...doc.data() }));
        if (remotas.length > 0) {
          listaPontosRonda = remotas;
          localStorage.setItem('ronda_pontos_cache', JSON.stringify(listaPontosRonda));
        }
      } else if (listaPontosRonda.length > 0) {
        listaPontosRonda.forEach(p => {
          firestoreDb.collection('ronda_pontos').doc(p.id).set(p).catch(() => {});
        });
      }

      if (!snapRegs.empty) {
        const remRegs = [];
        snapRegs.forEach(doc => remRegs.push({ id: doc.id, ...doc.data() }));
        remRegs.sort((a, b) => new Date(b.data_hora || 0) - new Date(a.data_hora || 0));
        listaRegistrosRonda = remRegs;
        localStorage.setItem('ronda_registros_cache', JSON.stringify(listaRegistrosRonda));
      }

      if (!snapOcs.empty) {
        const remOcs = [];
        snapOcs.forEach(doc => remOcs.push({ id: doc.id, ...doc.data() }));
        remOcs.sort((a, b) => new Date(b.data_hora || 0) - new Date(a.data_hora || 0));
        listaOcorrenciasRonda = remOcs;
        localStorage.setItem('ronda_ocorrencias_cache', JSON.stringify(listaOcorrenciasRonda));
      }

      atualizarContadoresRondaUI();
      if (typeof activeTab !== 'undefined' && activeTab === 'ronda') {
        filtrarRondaUI();
      }
    }).catch(err => {
      console.warn("Aviso ao sincronizar Ronda do Canteiro com Firestore:", err);
    });
  }
}

// Cálculo do status operacional e de metas do ponto de ronda para o dia de hoje
function calcularStatusPontoRonda(ponto) {
  const dataHoje = getDataHojeLocal();
  const regsHoje = (listaRegistrosRonda || [])
    .filter(r => r.ponto_id === ponto.id && r.data === dataHoje)
    .sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));

  const ocsPonto = (listaOcorrenciasRonda || []).filter(o => o.ponto_id === ponto.id);
  const ocsAberta = ocsPonto.filter(o => o.status === 'aberto');
  const temOcorrenciaAberta = ocsAberta.length > 0;

  const qtdHoje = regsHoje.length;
  const meta = Number(ponto.frequencia_diaria || (ponto.tipo === 'banheiro' ? (configRonda.freq_padrao_banheiro || 2) : (configRonda.freq_padrao_bebedouro || 1)));
  const pct = Math.min(100, Math.round((qtdHoje / meta) * 100));

  const temAlerta = temOcorrenciaAberta || regsHoje.some(r => r.avaliacao && (r.avaliacao.includes('Precisa Reparo') || r.avaliacao.includes('Aviso')));
  const faltaInsumo = regsHoje.some(r => r.avaliacao && r.avaliacao.includes('Falta Insumo'));

  let statusKey = 'pendente';
  let badgeLabel = `PENDENTE (0/${meta})`;
  let badgeClass = 'bg-orange-100 text-orange-800 border-orange-300';
  let dotClass = 'bg-orange-500';
  let cardBorder = 'border-slate-200 hover:border-orange-300';
  let bgClass = 'bg-white';
  let textoStatus = `Nenhuma limpeza realizada hoje ainda (Meta: ${meta}x)`;

  if (temOcorrenciaAberta) {
    statusKey = 'alerta';
    badgeLabel = `🚨 ${ocsAberta.length} RECLAMAÇÃO(ÕES)`;
    badgeClass = 'bg-rose-100 text-rose-800 border-rose-300 font-bold';
    dotClass = 'bg-rose-500 animate-pulse';
    cardBorder = 'border-rose-400 hover:border-rose-500 shadow-sm ring-1 ring-rose-300';
    bgClass = 'bg-rose-50/40';
    textoStatus = `Alerta de colaborador: ${ocsAberta[0].tipo_problema} ("${ocsAberta[0].descricao}")`;
  } else if (temAlerta) {
    statusKey = 'alerta';
    badgeLabel = 'PRECISA REPARO';
    badgeClass = 'bg-rose-100 text-rose-800 border-rose-300';
    dotClass = 'bg-rose-500 animate-pulse';
    cardBorder = 'border-rose-300 hover:border-rose-400';
    bgClass = 'bg-rose-50/30';
    textoStatus = 'Colaborador reportou necessidade de manutenção!';
  } else if (qtdHoje >= meta) {
    statusKey = 'ok';
    badgeLabel = `EM DIA (${qtdHoje}/${meta})`;
    badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
    dotClass = 'bg-emerald-500';
    cardBorder = 'border-emerald-200 hover:border-emerald-300';
    bgClass = 'bg-emerald-50/20';
    textoStatus = `Meta diária 100% batida! (${qtdHoje} limpezas)`;
  } else if (qtdHoje > 0) {
    statusKey = 'andamento';
    badgeLabel = `EM ANDAMENTO (${qtdHoje}/${meta})`;
    badgeClass = 'bg-amber-100 text-amber-800 border-amber-300';
    dotClass = 'bg-amber-500 animate-pulse';
    cardBorder = 'border-amber-300 hover:border-amber-400';
    bgClass = 'bg-amber-50/20';
    textoStatus = `${qtdHoje} de ${meta} limpezas feitas. Falta 1 para bater a meta.`;
  }

  return {
    statusKey,
    badgeLabel,
    badgeClass,
    dotClass,
    cardBorder,
    bgClass,
    textoStatus,
    qtdHoje,
    meta,
    pct,
    regsHoje,
    temAlerta,
    faltaInsumo,
    ocsAberta,
    ocsPonto
  };
}

// Atualiza contadores globais e KPIs da Ronda
function atualizarContadoresRondaUI() {
  const pontos = listaPontosRonda || [];
  const tot = pontos.length;
  let totBanheiros = 0;
  let totBebedouros = 0;
  let emDia = 0;
  let emAndamento = 0;
  let pendentes = 0;
  let alertas = 0;
  let somaMetas = 0;
  let somaFeitas = 0;

  pontos.forEach(p => {
    if (p.tipo === 'banheiro') totBanheiros++;
    else totBebedouros++;

    const st = calcularStatusPontoRonda(p);
    somaMetas += st.meta;
    somaFeitas += Math.min(st.meta, st.qtdHoje);

    if (st.statusKey === 'alerta') alertas++;
    if (st.statusKey === 'ok') emDia++;
    else if (st.statusKey === 'andamento') emAndamento++;
    else if (st.statusKey === 'pendente') pendentes++;
  });

  const taxaGeral = somaMetas > 0 ? Math.round((somaFeitas / somaMetas) * 100) : 0;

  const elTot = document.getElementById('kpiRondaTotalPontos');
  if (elTot) elTot.textContent = tot;
  const elSub = document.getElementById('kpiRondaSubPontos');
  if (elSub) elSub.textContent = `${totBanheiros} banheiros • ${totBebedouros} bebedouros`;

  const elProgTaxa = document.getElementById('kpiRondaProgressoTaxa');
  if (elProgTaxa) elProgTaxa.textContent = `${taxaGeral}%`;
  const elProgFracao = document.getElementById('kpiRondaProgressoFracao');
  if (elProgFracao) elProgFracao.textContent = `${somaFeitas}/${somaMetas}`;
  const elProgBarra = document.getElementById('kpiRondaProgressoBarra');
  if (elProgBarra) elProgBarra.style.width = `${taxaGeral}%`;

  const elEmDia = document.getElementById('kpiRondaEmDia');
  if (elEmDia) elEmDia.textContent = emDia;
  const elAndamento = document.getElementById('kpiRondaEmAndamento');
  if (elAndamento) elAndamento.textContent = emAndamento;
  const elPendentes = document.getElementById('kpiRondaPendentes');
  if (elPendentes) elPendentes.textContent = pendentes;
  const elAlertas = document.getElementById('kpiRondaAlertas');
  if (elAlertas) elAlertas.textContent = alertas;

  // Badges da Sidebar e Drawer Mobile
  const sideBadge = document.getElementById('sideCountRonda');
  if (sideBadge) {
    if (pendentes > 0 || emAndamento > 0) {
      sideBadge.textContent = `${pendentes + emAndamento} pend`;
      sideBadge.className = 'ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold';
      sideBadge.classList.remove('hidden');
    } else {
      sideBadge.textContent = `${tot} ok`;
      sideBadge.className = 'ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/40 font-bold';
      sideBadge.classList.remove('hidden');
    }
  }

  const drawerBadge = document.getElementById('drawerBadgeRonda');
  if (drawerBadge) {
    drawerBadge.textContent = `${tot} pontos (${taxaGeral}% hoje)`;
  }

  // Preencher filtro de setores dinamicamente
  const selSetor = document.getElementById('filtroSetorRonda');
  if (selSetor) {
    const valAtual = selSetor.value;
    const setores = Array.from(new Set(pontos.map(p => p.setor).filter(Boolean))).sort();
    selSetor.innerHTML = '<option value="todos">Todos os Setores</option>' +
      setores.map(s => `<option value="${s}" ${s === valAtual ? 'selected' : ''}>${s}</option>`).join('');
  }
}

// Carregar tela de Ronda do Canteiro
function carregarRondaCanteiro() {
  atualizarContadoresRondaUI();
  filtrarRondaUI();
}

// Filtra e renderiza os cards de Ronda
function filtrarRondaUI() {
  const busca = (document.getElementById('buscaRondaInput')?.value || '').toLowerCase().trim();
  const filtroTipo = document.getElementById('filtroTipoRonda')?.value || 'todos';
  const filtroStatus = document.getElementById('filtroStatusRonda')?.value || 'todos';
  const filtroSetor = document.getElementById('filtroSetorRonda')?.value || 'todos';

  let filtrados = [...listaPontosRonda];

  if (filtroTipo !== 'todos') {
    filtrados = filtrados.filter(p => p.tipo === filtroTipo);
  }

  if (filtroSetor !== 'todos') {
    filtrados = filtrados.filter(p => p.setor === filtroSetor);
  }

  if (filtroStatus !== 'todos') {
    filtrados = filtrados.filter(p => {
      const st = calcularStatusPontoRonda(p);
      return st.statusKey === filtroStatus;
    });
  }

  if (busca) {
    filtrados = filtrados.filter(p => {
      const nome = (p.nome || '').toLowerCase();
      const setor = (p.setor || '').toLowerCase();
      const obs = (p.observacoes || '').toLowerCase();
      return nome.includes(busca) || setor.includes(busca) || obs.includes(busca);
    });
  }

  renderizarGridRonda(filtrados);
}

// Renderiza os cards dos pontos
function renderizarGridRonda(pontos) {
  const grid = document.getElementById('gridPontosRonda');
  const vazio = document.getElementById('rondaVazio');
  if (!grid) return;

  if (pontos.length === 0) {
    grid.innerHTML = '';
    if (vazio) vazio.classList.remove('hidden');
    return;
  }

  if (vazio) vazio.classList.add('hidden');

  grid.innerHTML = pontos.map(p => {
    const isBanheiro = p.tipo === 'banheiro';
    const st = calcularStatusPontoRonda(p);
    const icone = isBanheiro ? '🚻' : '🚰';

    let htmlRegs = '';
    if (st.regsHoje.length > 0) {
      htmlRegs = st.regsHoje.map((r, idx) => `
        <div class="flex items-center justify-between text-[11px] p-1.5 rounded-lg bg-slate-50 border border-slate-200/70">
          <div class="flex items-center gap-1.5">
            <span class="w-4 h-4 rounded-full bg-teal-100 text-teal-800 font-bold text-[9px] flex items-center justify-center">${idx + 1}ª</span>
            <span class="font-bold text-slate-800">${r.hora || '--:--'}</span>
            <span class="text-slate-500 font-medium">(${r.responsavel || 'Equipe'})</span>
          </div>
          <span class="text-[10px] font-semibold ${r.avaliacao && r.avaliacao.includes('Precisa Reparo') ? 'text-rose-600 font-bold' : 'text-emerald-700'}">
            ${r.avaliacao || 'Tudo OK'}
          </span>
        </div>
      `).join('');
    } else {
      htmlRegs = `
        <div class="p-2 rounded-lg bg-orange-50/60 border border-orange-200/70 text-[11px] text-orange-800 flex items-center gap-1.5">
          <i class="fa-solid fa-clock text-orange-500"></i>
          <span>Nenhuma limpeza realizada hoje ainda.</span>
        </div>
      `;
    }

    return `
      <div class="rounded-2xl border ${st.cardBorder} ${st.bgClass} p-4 sm:p-5 shadow-xs transition hover:shadow-md flex flex-col justify-between space-y-4">
        <!-- Topo do Card -->
        <div class="space-y-2">
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2.5">
              <span class="text-2xl">${icone}</span>
              <div>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <h3 class="font-black text-slate-900 text-sm md:text-base leading-tight">${p.nome}</h3>
                </div>
                <p class="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                  <i class="fa-solid fa-location-dot text-rose-500 text-[10px]"></i>
                  <span>${p.setor || 'Canteiro Geral'}</span>
                </p>
              </div>
            </div>

            <!-- Badge de Status -->
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black border ${st.badgeClass} whitespace-nowrap shadow-2xs">
              <span class="w-2 h-2 rounded-full ${st.dotClass}"></span>
              <span>${st.badgeLabel}</span>
            </span>
          </div>

          <!-- Barra de Progresso Diário -->
          <div class="pt-1">
            <div class="flex items-center justify-between text-[11px] font-semibold text-slate-600 mb-1">
              <span>Meta: <b class="text-slate-900">${st.meta}x ao dia</b></span>
              <span class="font-bold ${st.qtdHoje >= st.meta ? 'text-emerald-600' : 'text-amber-600'}">
                ${st.qtdHoje} de ${st.meta} feitas (${st.pct}%)
              </span>
            </div>
            <div class="w-full bg-slate-200/80 rounded-full h-2 overflow-hidden">
              <div class="h-2 rounded-full transition-all duration-500 ${st.qtdHoje >= st.meta ? 'bg-emerald-500' : 'bg-amber-500'}" style="width: ${st.pct}%"></div>
            </div>
          </div>

          <!-- Batidas de Hoje -->
          <div class="space-y-1.5 pt-1">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Registros de Hoje:</span>
            ${htmlRegs}
          </div>

          ${st.ocsAberta && st.ocsAberta.length > 0 ? `
            <!-- Alerta de Reclamações de Trabalhadores (QR Code) -->
            <div class="p-2.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-950 text-xs space-y-1">
              <div class="flex items-center justify-between font-bold">
                <span class="flex items-center gap-1.5 text-rose-700">
                  <i class="fa-solid fa-bullhorn animate-pulse"></i> ${st.ocsAberta.length} Reclamação(ões) Aberta(s)
                </span>
                <span class="text-[10px] text-rose-500">${st.ocsAberta[0].hora || ''}</span>
              </div>
              <p class="text-[11px] font-semibold text-rose-900 truncate">
                <b>${st.ocsAberta[0].tipo_problema}:</b> "${st.ocsAberta[0].descricao}"
              </p>
              <button onclick="abrirModalOcorrenciasPontoRonda('${p.id}')" class="text-[10px] font-bold text-rose-700 hover:text-rose-900 underline flex items-center gap-1 mt-0.5">
                <i class="fa-solid fa-eye"></i> Ver todas e dar baixa
              </button>
            </div>
          ` : ''}

          ${p.observacoes ? `
            <p class="text-[10px] text-slate-500 italic bg-white/80 p-1.5 rounded-lg border border-slate-200">
              <i class="fa-solid fa-circle-info mr-1 text-slate-400"></i>${p.observacoes}
            </p>
          ` : ''}
        </div>

        <!-- Rodapé do Card com Ações -->
        <div class="pt-3 border-t border-slate-100 flex items-center justify-between gap-1 flex-wrap">
          <div class="flex items-center gap-1">
            <button onclick="abrirModalPlacaQRRonda('${p.id}')" class="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-1.5 shadow-2xs transition" title="Imprimir Plaqueta QR Code em Folha A4">
              <i class="fa-solid fa-qrcode text-amber-400 text-xs"></i>
              <span class="hidden sm:inline">Plaqueta A4</span>
            </button>

            <button onclick="abrirModalRegistroManualRonda('${p.id}')" class="btn-prefeito px-2.5 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold text-xs flex items-center gap-1 transition" title="Lançar Vistoria ou Limpeza Manual">
              <i class="fa-solid fa-pen-to-square"></i>
              <span>Lançar</span>
            </button>

            <button onclick="abrirModalHistoricoPontoRonda('${p.id}')" class="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition" title="Ver Histórico Completo de Limpezas">
              <i class="fa-solid fa-clock-rotate-left"></i>
            </button>

            <button onclick="abrirModalOcorrenciasPontoRonda('${p.id}')" class="px-2 py-1.5 rounded-lg ${st.ocsAberta && st.ocsAberta.length > 0 ? 'bg-amber-100 text-amber-900 border border-amber-300 font-bold' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'} text-xs transition" title="Ocorrências & Reclamações de Trabalhadores">
              <i class="fa-solid fa-bullhorn text-xs"></i>
              ${st.ocsAberta && st.ocsAberta.length > 0 ? `<span class="ml-1 text-[10px] font-black text-rose-600">${st.ocsAberta.length}</span>` : ''}
            </button>
          </div>

          <div class="flex items-center gap-1">
            <button onclick="abrirModalNovoPontoRonda('${p.id}')" class="btn-prefeito p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition" title="Editar Ponto">
              <i class="fa-solid fa-pen text-xs"></i>
            </button>
            <button onclick="excluirPontoRonda('${p.id}')" class="btn-prefeito p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition" title="Excluir Ponto">
              <i class="fa-solid fa-trash text-xs"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Abrir modal de novo ou editar ponto de ronda
function abrirModalNovoPontoRonda(pontoId = null) {
  const tit = document.getElementById('modalNovoPontoRondaTitulo');
  const idInput = document.getElementById('pontoRondaId');
  const nomeInput = document.getElementById('pontoRondaNome');
  const setorInput = document.getElementById('pontoRondaSetor');
  const freqSelect = document.getElementById('pontoRondaFrequencia');
  const horInput = document.getElementById('pontoRondaHorarios');
  const obsInput = document.getElementById('pontoRondaObs');

  if (pontoId) {
    const p = (listaPontosRonda || []).find(x => x.id === pontoId);
    if (!p) return;
    if (tit) tit.textContent = 'Editar Ponto de Ronda';
    if (idInput) idInput.value = p.id;
    if (nomeInput) nomeInput.value = p.nome || '';
    if (setorInput) setorInput.value = p.setor || '';
    if (freqSelect) freqSelect.value = String(p.frequencia_diaria || 2);
    if (horInput) horInput.value = p.horarios_sugeridos || '';
    if (obsInput) obsInput.value = p.observacoes || '';

    const radio = document.querySelector(`input[name="pontoRondaTipo"][value="${p.tipo || 'banheiro'}"]`);
    if (radio) {
      radio.checked = true;
      aoMudarTipoPontoRonda(p.tipo || 'banheiro');
    }
  } else {
    if (tit) tit.textContent = 'Cadastrar Ponto de Ronda';
    if (idInput) idInput.value = '';
    if (nomeInput) nomeInput.value = '';
    if (setorInput) setorInput.value = '';
    if (freqSelect) freqSelect.value = '2';
    if (horInput) horInput.value = '';
    if (obsInput) obsInput.value = '';

    const radio = document.querySelector('input[name="pontoRondaTipo"][value="banheiro"]');
    if (radio) {
      radio.checked = true;
      aoMudarTipoPontoRonda('banheiro');
    }
  }

  abrirModal('modalNovoPontoRonda');
}

function aoMudarTipoPontoRonda(tipo) {
  const lblBanheiro = document.getElementById('labelTipoPontoBanheiro');
  const lblBebedouro = document.getElementById('labelTipoPontoBebedouro');
  const freqSelect = document.getElementById('pontoRondaFrequencia');

  if (tipo === 'banheiro') {
    if (lblBanheiro) lblBanheiro.className = 'cursor-pointer border-2 border-teal-500 bg-teal-50/60 rounded-xl p-3 flex flex-col items-center text-center transition select-none shadow-xs';
    if (lblBebedouro) lblBebedouro.className = 'cursor-pointer border-2 border-slate-200 bg-white rounded-xl p-3 flex flex-col items-center text-center transition select-none hover:bg-slate-50 opacity-70';
    if (freqSelect && !document.getElementById('pontoRondaId').value) {
      freqSelect.value = String(configRonda.freq_padrao_banheiro || 2);
    }
  } else {
    if (lblBanheiro) lblBanheiro.className = 'cursor-pointer border-2 border-slate-200 bg-white rounded-xl p-3 flex flex-col items-center text-center transition select-none hover:bg-slate-50 opacity-70';
    if (lblBebedouro) lblBebedouro.className = 'cursor-pointer border-2 border-sky-500 bg-sky-50/60 rounded-xl p-3 flex flex-col items-center text-center transition select-none shadow-xs';
    if (freqSelect && !document.getElementById('pontoRondaId').value) {
      freqSelect.value = String(configRonda.freq_padrao_bebedouro || 1);
    }
  }
}

// Salvar ponto de ronda
async function salvarPontoRonda(e) {
  if (e && e.preventDefault) e.preventDefault();

  const id = document.getElementById('pontoRondaId').value;
  const tipo = document.querySelector('input[name="pontoRondaTipo"]:checked')?.value || 'banheiro';
  const nome = document.getElementById('pontoRondaNome').value.trim();
  const setor = document.getElementById('pontoRondaSetor').value.trim();
  const frequencia = parseInt(document.getElementById('pontoRondaFrequencia').value || '1', 10);
  const horarios = document.getElementById('pontoRondaHorarios').value.trim();
  const obs = document.getElementById('pontoRondaObs').value.trim();

  if (!nome) {
    showToast('Informe o nome do ponto de ronda.', 'warning');
    return;
  }
  if (!setor) {
    showToast('Informe o setor ou frente de serviço.', 'warning');
    return;
  }

  const isEdicao = !!id;
  const pontoId = id || ('ponto_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4));

  const pontoObj = {
    id: pontoId,
    nome: nome,
    tipo: tipo,
    setor: setor,
    frequencia_diaria: frequencia,
    horarios_sugeridos: horarios,
    observacoes: obs,
    ativo: true,
    atualizado_em: new Date().toISOString()
  };

  if (!isEdicao) {
    pontoObj.criado_em = new Date().toISOString();
    listaPontosRonda.unshift(pontoObj);
  } else {
    const idx = listaPontosRonda.findIndex(x => x.id === pontoId);
    if (idx !== -1) {
      listaPontosRonda[idx] = Object.assign(listaPontosRonda[idx], pontoObj);
    }
  }

  localStorage.setItem('ronda_pontos_cache', JSON.stringify(listaPontosRonda));
  fecharModal('modalNovoPontoRonda');
  atualizarContadoresRondaUI();
  filtrarRondaUI();

  showToast(`Ponto "${nome}" salvo com sucesso!`, 'success');

  if (typeof registrarAuditoria === 'function') {
    registrarAuditoria(
      'ronda',
      isEdicao ? 'EDITAR' : 'CRIAR',
      nome,
      `${isEdicao ? 'Atualizado' : 'Cadastrado'} ponto de ${tipo} (${setor}). Meta: ${frequencia}x/dia.`
    );
  }

  if (typeof firestoreDb !== 'undefined' && firestoreDb) {
    try {
      await firestoreDb.collection('ronda_pontos').doc(pontoId).set(pontoObj);
    } catch (err) {
      console.warn("Aviso ao salvar ponto no Firestore:", err);
    }
  }
}

// Excluir ponto de ronda
async function excluirPontoRonda(pontoId) {
  const p = (listaPontosRonda || []).find(x => x.id === pontoId);
  if (!p) return;

  if (!confirm(`Deseja realmente excluir o ponto "${p.nome}" (${p.setor})?`)) return;

  listaPontosRonda = listaPontosRonda.filter(x => x.id !== pontoId);
  localStorage.setItem('ronda_pontos_cache', JSON.stringify(listaPontosRonda));
  atualizarContadoresRondaUI();
  filtrarRondaUI();

  showToast(`Ponto "${p.nome}" excluído com sucesso.`, 'info');

  if (typeof registrarAuditoria === 'function') {
    registrarAuditoria('ronda', 'EXCLUIR', p.nome, `Ponto de ronda excluído do canteiro (${p.setor}).`);
  }

  if (typeof firestoreDb !== 'undefined' && firestoreDb) {
    try {
      await firestoreDb.collection('ronda_pontos').doc(pontoId).delete();
    } catch (err) {
      console.warn("Aviso ao excluir ponto no Firestore:", err);
    }
  }
}

// Obter URL pública para o QR Code da Ronda
function getQRCodeUrlRonda(pontoId) {
  const href = window.location.href;
  let cleanUrl = href.split('?')[0].split('#')[0];
  if (cleanUrl.includes('index.html')) {
    cleanUrl = cleanUrl.replace('index.html', 'ronda.html');
  } else {
    cleanUrl = cleanUrl.endsWith('/') ? `${cleanUrl}ronda.html` : `${cleanUrl}/ronda.html`;
  }
  return `${cleanUrl}?ponto_id=${encodeURIComponent(pontoId)}`;
}

// Abrir modal com placa QR Code da Ronda (Impressão A4)
function abrirModalPlacaQRRonda(pontoId) {
  const p = (listaPontosRonda || []).find(x => x.id === pontoId);
  if (!p) {
    showToast('Ponto de ronda não localizado.', 'warning');
    return;
  }

  const qrUrl = getQRCodeUrlRonda(pontoId);
  const imgEl = document.getElementById('imgPlacaQRRonda');
  const txtUrlEl = document.getElementById('textoPlacaQRRondaUrl');
  const titEl = document.getElementById('placaRondaTitulo');
  const setEl = document.getElementById('placaRondaSetor');
  const freqEl = document.getElementById('placaRondaFrequencia');
  const headEl = document.getElementById('placaRondaTipoHeader');

  if (titEl) titEl.textContent = (p.nome || 'Ponto de Ronda').toUpperCase();
  if (setEl) setEl.textContent = `Setor: ${p.setor || 'Canteiro Central'} ${p.observacoes ? '• ' + p.observacoes : ''}`;
  if (headEl) headEl.textContent = p.tipo === 'banheiro' ? 'CONTROLE DE HIGIENE DE SANITÁRIO' : 'CONTROLE DE HIGIENE DE BEBEDOURO';
  if (freqEl) {
    const meta = Number(p.frequencia_diaria || (p.tipo === 'banheiro' ? 2 : 1));
    freqEl.textContent = `META DE HIGIENE: ${meta}x AO DIA ${p.horarios_sugeridos ? '(' + p.horarios_sugeridos + ')' : ''}`;
  }
  if (txtUrlEl) txtUrlEl.textContent = qrUrl;

  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qrUrl)}&format=png`;
  if (imgEl) imgEl.src = qrApiUrl;

  abrirModal('modalPlacaQRRonda');
}

function imprimirPlacaQRRonda() {
  document.body.classList.add('imprimindo-placa-ronda');
  window.print();
  setTimeout(() => {
    document.body.classList.remove('imprimindo-placa-ronda');
  }, 1000);
}

// Configuração de frequências padrão e senha da equipe
function abrirModalConfigRonda() {
  const selBan = document.getElementById('configFreqPadraoBanheiro');
  const selBeb = document.getElementById('configFreqPadraoBebedouro');
  const inpSenha = document.getElementById('configSenhaEquipeRonda');
  if (selBan) selBan.value = String(configRonda.freq_padrao_banheiro || 2);
  if (selBeb) selBeb.value = String(configRonda.freq_padrao_bebedouro || 1);
  if (inpSenha) inpSenha.value = String(configRonda.senha_equipe || '1234');
  abrirModal('modalConfigRonda');
}

function salvarConfigRonda(e) {
  if (e && e.preventDefault) e.preventDefault();
  const fBan = parseInt(document.getElementById('configFreqPadraoBanheiro').value || '2', 10);
  const fBeb = parseInt(document.getElementById('configFreqPadraoBebedouro').value || '1', 10);
  const inpSenha = document.getElementById('configSenhaEquipeRonda');
  const senha = inpSenha ? inpSenha.value.trim() : (configRonda.senha_equipe || '1234');

  configRonda.freq_padrao_banheiro = fBan;
  configRonda.freq_padrao_bebedouro = fBeb;
  configRonda.senha_equipe = senha || '1234';

  localStorage.setItem('ronda_config_cache', JSON.stringify(configRonda));

  if (typeof firestoreDb !== 'undefined' && firestoreDb) {
    firestoreDb.collection('ronda_config').doc('geral').set(configRonda, { merge: true }).catch(err => {
      console.warn("Aviso ao salvar config da ronda no Firestore:", err);
    });
  }

  fecharModal('modalConfigRonda');
  atualizarContadoresRondaUI();
  filtrarRondaUI();
  showToast('Metas e Senha da Equipe atualizadas com sucesso!', 'success');
}

// Registro Manual / Vistoria pelo Prefeito
function abrirModalRegistroManualRonda(pontoId) {
  const p = (listaPontosRonda || []).find(x => x.id === pontoId);
  if (!p) return;

  const idInput = document.getElementById('regManualRondaPontoId');
  const subTit = document.getElementById('subtituloRegistroManualRonda');
  const dtInput = document.getElementById('regManualRondaData');
  const hrInput = document.getElementById('regManualRondaHora');
  const respInput = document.getElementById('regManualRondaResponsavel');
  const obsInput = document.getElementById('regManualRondaObs');

  if (idInput) idInput.value = pontoId;
  if (subTit) subTit.textContent = `${p.tipo === 'banheiro' ? '🚻' : '🚰'} ${p.nome} (${p.setor})`;

  const agora = new Date();
  if (dtInput) dtInput.value = getDataHojeLocal(agora);
  if (hrInput) hrInput.value = agora.toTimeString().slice(0, 5);
  if (respInput) respInput.value = (currentUserName && currentUserName !== 'Prefeito da Obra') ? currentUserName : 'Equipe de Limpeza';
  if (obsInput) obsInput.value = '';

  abrirModal('modalRegistroManualRonda');
}

async function salvarRegistroManualRonda(e) {
  if (e && e.preventDefault) e.preventDefault();

  const pontoId = document.getElementById('regManualRondaPontoId').value;
  const p = (listaPontosRonda || []).find(x => x.id === pontoId);
  if (!p) return;

  const data = document.getElementById('regManualRondaData').value;
  const hora = document.getElementById('regManualRondaHora').value;
  const responsavel = document.getElementById('regManualRondaResponsavel').value.trim();
  const avaliacao = document.getElementById('regManualRondaAvaliacao').value;
  const obs = document.getElementById('regManualRondaObs').value.trim();

  if (!data || !hora) {
    showToast('Informe a data e o horário.', 'warning');
    return;
  }
  if (!responsavel) {
    showToast('Informe o responsável pela limpeza.', 'warning');
    return;
  }

  const protocolo = 'RONDA-' + Math.floor(100000 + Math.random() * 900000);
  const dataHoraStr = `${data}T${hora}:00`;

  const dataHoje = getDataHojeLocal();
  const regsHoje = (listaRegistrosRonda || []).filter(r => r.ponto_id === pontoId && r.data === dataHoje);
  const ordemDia = regsHoje.length + 1;
  const meta = Number(p.frequencia_diaria || (p.tipo === 'banheiro' ? 2 : 1));

  const registro = {
    id: protocolo,
    ponto_id: pontoId,
    ponto_nome: p.nome,
    tipo: p.tipo,
    setor: p.setor,
    data: data,
    hora: hora,
    data_hora: dataHoraStr,
    responsavel: responsavel,
    ordem_dia: ordemDia,
    meta_dia: meta,
    checklist: ['Limpeza Geral e Desinfecção Completa'],
    avaliacao: avaliacao,
    observacoes: obs || 'Lançamento manual registrado via painel administrativo',
    criado_em: new Date().toISOString()
  };

  listaRegistrosRonda.unshift(registro);
  localStorage.setItem('ronda_registros_cache', JSON.stringify(listaRegistrosRonda.slice(0, 500)));

  fecharModal('modalRegistroManualRonda');
  atualizarContadoresRondaUI();
  filtrarRondaUI();

  showToast(`Limpeza registrada com sucesso (#${protocolo})!`, 'success');

  if (typeof registrarAuditoria === 'function') {
    registrarAuditoria(
      'ronda',
      'RONDA_HIGIENE',
      p.nome,
      `Limpeza registrada para ${p.nome} (${p.setor}) por ${responsavel}. Avaliação: ${avaliacao}.`
    );
  }

  if (typeof firestoreDb !== 'undefined' && firestoreDb) {
    try {
      await firestoreDb.collection('ronda_registros').doc(protocolo).set(registro);
    } catch (err) {
      console.warn("Aviso ao salvar registro manual no Firestore:", err);
    }
  }
}

// Histórico de limpezas de um ponto específico
function abrirModalHistoricoPontoRonda(pontoId) {
  const p = (listaPontosRonda || []).find(x => x.id === pontoId);
  if (!p) return;

  const nomeEl = document.getElementById('histRondaPontoNome');
  const setorEl = document.getElementById('histRondaPontoSetor');
  const corpo = document.getElementById('listaHistoricoRondaCorpo');
  const vazio = document.getElementById('historicoRondaVazio');

  if (nomeEl) nomeEl.textContent = `${p.tipo === 'banheiro' ? '🚻' : '🚰'} ${p.nome}`;
  if (setorEl) setorEl.textContent = `Setor: ${p.setor} • Meta: ${p.frequencia_diaria || 2}x ao dia`;

  const registros = (listaRegistrosRonda || []).filter(r => r.ponto_id === pontoId);

  if (!corpo) return;

  if (registros.length === 0) {
    corpo.innerHTML = '';
    if (vazio) vazio.classList.remove('hidden');
  } else {
    if (vazio) vazio.classList.add('hidden');
    corpo.innerHTML = registros.map(r => `
      <div class="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-2 text-xs">
        <div class="flex items-center justify-between pb-1.5 border-b border-slate-100">
          <div class="flex items-center gap-2">
            <span class="font-mono text-[11px] font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">#${r.id}</span>
            <span class="font-bold text-slate-800">${formatarDataLimpezaBR(r.data)} às ${r.hora}</span>
          </div>
          <span class="font-semibold text-[11px] ${r.avaliacao && r.avaliacao.includes('Precisa Reparo') ? 'text-rose-600 font-bold' : 'text-emerald-700'}">
            ${r.avaliacao || 'Tudo OK'}
          </span>
        </div>

        <div class="flex items-center justify-between text-slate-600">
          <span><i class="fa-solid fa-user-check mr-1 text-slate-400"></i> Responsável: <b>${r.responsavel || 'Equipe'}</b></span>
          <span class="text-[11px] text-slate-400">${r.ordem_dia ? r.ordem_dia + 'ª limpeza do dia' : ''}</span>
        </div>

        ${Array.isArray(r.checklist) && r.checklist.length > 0 ? `
          <div class="flex flex-wrap gap-1 pt-1">
            ${r.checklist.map(c => `
              <span class="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-medium border border-slate-200">
                ✓ ${c}
              </span>
            `).join('')}
          </div>
        ` : ''}

        ${r.observacoes ? `
          <p class="text-[11px] text-slate-500 bg-slate-50 p-2 rounded-lg italic">
            <i class="fa-solid fa-comment-dots mr-1 text-slate-400"></i>${r.observacoes}
          </p>
        ` : ''}
      </div>
    `).join('');
  }

  abrirModal('modalHistoricoPontoRonda');
}

// Recarregar dados da Ronda
function recarregarRondaManual() {
  const icone = document.getElementById('iconeReloadRonda');
  if (icone) icone.classList.add('fa-spin');
  showToast('Sincronizando Ronda do Canteiro com a Nuvem...', 'info');

  if (typeof firestoreDb !== 'undefined' && firestoreDb) {
    Promise.all([
      firestoreDb.collection('ronda_pontos').get(),
      firestoreDb.collection('ronda_registros').get()
    ]).then(([snapPontos, snapRegs]) => {
      if (!snapPontos.empty) {
        const remotas = [];
        snapPontos.forEach(doc => remotas.push({ id: doc.id, ...doc.data() }));
        if (remotas.length > 0) {
          listaPontosRonda = remotas;
          localStorage.setItem('ronda_pontos_cache', JSON.stringify(listaPontosRonda));
        }
      }

      if (!snapRegs.empty) {
        const remRegs = [];
        snapRegs.forEach(doc => remRegs.push({ id: doc.id, ...doc.data() }));
        remRegs.sort((a, b) => new Date(b.data_hora || 0) - new Date(a.data_hora || 0));
        listaRegistrosRonda = remRegs;
        localStorage.setItem('ronda_registros_cache', JSON.stringify(listaRegistrosRonda));
      }

      atualizarContadoresRondaUI();
      filtrarRondaUI();
      if (icone) icone.classList.remove('fa-spin');
      showToast('Dados da Ronda atualizados com sucesso!', 'success');
    }).catch(err => {
      if (icone) icone.classList.remove('fa-spin');
      showToast('Erro ao atualizar: ' + err.message, 'error');
    });
  } else {
    atualizarContadoresRondaUI();
    filtrarRondaUI();
    if (icone) icone.classList.remove('fa-spin');
  }
}

// Leitor de Câmera da Ronda (html5-qrcode)
let html5QrScannerRondaInstance = null;

function abrirScannerRondaQR() {
  abrirModal('modalScannerRondaQR');

  const sel = document.getElementById('selectPontoScannerManual');
  if (sel) {
    sel.innerHTML = '<option value="">Selecione o ponto...</option>' +
      (listaPontosRonda || []).map(p => `<option value="${p.id}">${p.tipo === 'banheiro' ? '🚻' : '🚰'} ${p.nome} (${p.setor})</option>`).join('');
  }

  if (typeof Html5Qrcode !== 'undefined') {
    try {
      if (html5QrScannerRondaInstance) {
        html5QrScannerRondaInstance.clear();
      }
      html5QrScannerRondaInstance = new Html5Qrcode("leitorCameraRonda");
      const config = { fps: 10, qrbox: { width: 220, height: 220 } };

      html5QrScannerRondaInstance.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          fecharScannerRondaQR();
          processarLeituraQRRonda(decodedText);
        },
        () => {}
      ).catch(() => {});
    } catch (e) {}
  }
}

function fecharScannerRondaQR() {
  fecharModal('modalScannerRondaQR');
  if (html5QrScannerRondaInstance) {
    try {
      html5QrScannerRondaInstance.stop().then(() => {
        html5QrScannerRondaInstance.clear();
        html5QrScannerRondaInstance = null;
      }).catch(() => {
        html5QrScannerRondaInstance = null;
      });
    } catch (e) {
      html5QrScannerRondaInstance = null;
    }
  }
}

function confirmarPontoManualScanner() {
  const sel = document.getElementById('selectPontoScannerManual');
  const pontoId = sel ? sel.value : null;
  if (!pontoId) {
    showToast('Selecione um ponto para registrar a ronda', 'warning');
    return;
  }
  fecharScannerRondaQR();
  abrirModalRegistroManualRonda(pontoId);
}

function processarLeituraQRRonda(texto) {
  if (!texto) return;
  texto = String(texto).trim();

  let pontoId = null;
  try {
    if (texto.includes('ponto_id=')) {
      const urlObj = new URL(texto.startsWith('http') ? texto : `https://dummy.local/${texto}`);
      pontoId = urlObj.searchParams.get('ponto_id');
    }
  } catch (e) {}

  if (!pontoId) {
    const achou = (listaPontosRonda || []).find(p => p.id === texto || (p.nome && p.nome.toLowerCase() === texto.toLowerCase()));
    if (achou) pontoId = achou.id;
  }

  if (!pontoId) pontoId = texto;

  const pontoEncontrado = (listaPontosRonda || []).find(p => p.id === pontoId);
  if (!pontoEncontrado) {
    showToast(`QR Code lido ("${pontoId}"), mas o ponto não foi localizado.`, 'warning');
    return;
  }

  showToast(`Ponto "${pontoEncontrado.nome}" identificado!`, 'success');
  abrirModalRegistroManualRonda(pontoId);
}

// Gestão de Ocorrências & Reclamações de Trabalhadores da Ronda
function abrirModalOcorrenciasPontoRonda(pontoId) {
  const p = (listaPontosRonda || []).find(x => x.id === pontoId);
  if (!p) return;

  const nomeEl = document.getElementById('ocorrenciasRondaPontoNome');
  const setorEl = document.getElementById('ocorrenciasRondaPontoSetor');
  const corpo = document.getElementById('listaOcorrenciasRondaCorpo');
  const vazio = document.getElementById('ocorrenciasRondaVazio');

  if (nomeEl) nomeEl.textContent = `${p.tipo === 'banheiro' ? '🚻' : '🚰'} ${p.nome}`;
  if (setorEl) setorEl.textContent = `Setor: ${p.setor || 'Canteiro'} • Reclamações e Apontamentos via QR Code`;

  const ocs = (listaOcorrenciasRonda || []).filter(o => o.ponto_id === pontoId);

  if (!corpo) return;

  if (ocs.length === 0) {
    corpo.innerHTML = '';
    if (vazio) vazio.classList.remove('hidden');
  } else {
    if (vazio) vazio.classList.add('hidden');
    corpo.innerHTML = ocs.map(o => {
      const isAberto = o.status === 'aberto';
      return `
        <div class="p-3.5 rounded-xl border ${isAberto ? 'border-rose-300 bg-rose-50/50' : 'border-slate-200 bg-white'} shadow-xs space-y-2 text-xs">
          <div class="flex items-center justify-between pb-1.5 border-b border-slate-200">
            <div class="flex items-center gap-2">
              <span class="font-mono text-[11px] font-bold ${isAberto ? 'text-rose-700 bg-rose-100' : 'text-slate-600 bg-slate-100'} px-2 py-0.5 rounded border border-rose-200">#${o.id}</span>
              <span class="font-bold text-slate-800">${formatarDataLimpezaBR(o.data)} às ${o.hora || '--:--'}</span>
            </div>
            <span class="px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${isAberto ? 'bg-rose-600 text-white animate-pulse' : 'bg-emerald-100 text-emerald-800'}">
              ${isAberto ? '🚨 Pendente / Aberto' : '✓ Resolvido'}
            </span>
          </div>

          <div class="flex items-center justify-between font-semibold text-slate-800">
            <span class="text-sm font-bold text-rose-950 flex items-center gap-1.5">
              <i class="fa-solid fa-triangle-exclamation text-amber-500"></i> ${o.tipo_problema}
            </span>
            <span class="text-[11px] text-slate-500 font-normal">Por: <b>${o.solicitante || 'Anônimo'}</b></span>
          </div>

          <p class="text-xs text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200">
            "${o.descricao}"
          </p>

          <div class="flex items-center justify-between pt-1 border-t border-slate-200/60">
            <span class="text-[10px] text-slate-400">
              ${isAberto ? 'Aguardando atendimento da zeladoria' : `Resolvido por ${o.resolvido_por || 'Prefeito'} em ${formatarDataLimpezaBR(o.resolvido_em ? o.resolvido_em.slice(0, 10) : o.data)}`}
            </span>
            ${isAberto ? `
              <button onclick="resolverOcorrenciaRonda('${o.id}')" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition">
                <i class="fa-solid fa-check"></i>
                <span>Dar Baixa (Marcar como Resolvido)</span>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  abrirModal('modalOcorrenciasPontoRonda');
}

async function resolverOcorrenciaRonda(ocorrenciaId) {
  const oc = (listaOcorrenciasRonda || []).find(o => o.id === ocorrenciaId);
  if (!oc) return;

  const agora = new Date();
  oc.status = 'resolvido';
  oc.resolvido_em = agora.toISOString();
  oc.resolvido_por = (typeof currentUserName !== 'undefined' && currentUserName && currentUserName !== 'Prefeito da Obra') ? currentUserName : 'Prefeito de Canteiro';

  try {
    localStorage.setItem('ronda_ocorrencias_cache', JSON.stringify(listaOcorrenciasRonda));
  } catch (e) {}

  if (typeof firestoreDb !== 'undefined' && firestoreDb) {
    try {
      await firestoreDb.collection('ronda_ocorrencias').doc(ocorrenciaId).set(oc, { merge: true });

      const logId = 'LOG-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      await firestoreDb.collection('auditoria_logs').doc(logId).set({
        id: logId,
        data_hora: agora.toISOString(),
        usuario: String(oc.resolvido_por),
        modulo: 'ronda',
        acao: 'RESOLVER_ALERTA',
        entidade: String(oc.ponto_nome),
        detalhes: `Reclamação #${oc.id} (${oc.tipo_problema}) marcada como resolvida.`
      });
    } catch (err) {
      console.warn("Aviso ao resolver ocorrência no Firestore:", err);
    }
  }

  abrirModalOcorrenciasPontoRonda(oc.ponto_id);
  atualizarContadoresRondaUI();
  filtrarRondaUI();
  showToast('Reclamação marcada como resolvida com sucesso!', 'success');
}

// Modal Relatório Executivo Oficial de Ronda (NR-18 e NR-24)
function abrirModalRelatorioRondaExecutivo() {
  const inpData = document.getElementById('relatorioRondaDataFiltro');
  if (inpData) inpData.value = getDataHojeLocal();

  renderizarRelatorioRondaExecutivoUI();
  abrirModal('modalRelatorioRondaExecutivo');
}

function renderizarRelatorioRondaExecutivoUI() {
  const inpData = document.getElementById('relatorioRondaDataFiltro');
  const dataFiltro = (inpData ? inpData.value : '') || getDataHojeLocal();
  const pontos = listaPontosRonda || [];

  const dataFormatada = dataFiltro.split('-').reverse().join('/');
  const txtData = document.getElementById('relatorioRondaDataEmissaoTexto');
  const txtHora = document.getElementById('relatorioRondaHoraEmissaoTexto');
  if (txtData) txtData.textContent = `Data: ${dataFormatada}`;
  if (txtHora) txtHora.textContent = `Emissão: ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

  let somaMetas = 0;
  let somaFeitas = 0;
  let totBanheiros = 0;
  let totBebedouros = 0;

  const regsData = (listaRegistrosRonda || []).filter(r => r.data === dataFiltro);
  const ocsData = (listaOcorrenciasRonda || []).filter(o => o.data === dataFiltro);
  const ocsPendentes = ocsData.filter(o => o.status === 'aberto');

  const corpoPontos = document.getElementById('relatorioRondaTabelaCorpo');
  if (corpoPontos) {
    corpoPontos.innerHTML = pontos.map(p => {
      const isBanheiro = p.tipo === 'banheiro';
      if (isBanheiro) totBanheiros++;
      else totBebedouros++;

      const meta = Number(p.frequencia_diaria || (isBanheiro ? (configRonda.freq_padrao_banheiro || 2) : (configRonda.freq_padrao_bebedouro || 1)));
      const regsPonto = regsData.filter(r => r.ponto_id === p.id).sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
      const ocsPonto = ocsData.filter(o => o.ponto_id === p.id);
      const qtdFeitas = regsPonto.length;

      somaMetas += meta;
      somaFeitas += Math.min(meta, qtdFeitas);

      let statusBadge = '';
      if (ocsPonto.some(o => o.status === 'aberto')) {
        statusBadge = '<span class="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold text-[10px]">RECLAMAÇÃO</span>';
      } else if (qtdFeitas >= meta) {
        statusBadge = '<span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">CONFORME</span>';
      } else if (qtdFeitas > 0) {
        statusBadge = '<span class="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">EM ANDAMENTO</span>';
      } else {
        statusBadge = '<span class="px-2 py-0.5 rounded bg-orange-100 text-orange-800 font-bold text-[10px]">PENDENTE</span>';
      }

      const horariosStr = regsPonto.length > 0 ? regsPonto.map(r => `${r.hora} (${r.responsavel || 'Equipe'})`).join(' • ') : 'Nenhuma';
      const obsStr = ocsPonto.length > 0 ? ocsPonto.map(o => `🚨 ${o.tipo_problema}: "${o.descricao}"`).join(' | ') : (regsPonto.length > 0 && regsPonto[regsPonto.length - 1].observacoes ? regsPonto[regsPonto.length - 1].observacoes : '-');

      return `
        <tr class="hover:bg-slate-50">
          <td class="py-2.5 px-3 font-bold text-slate-900">${isBanheiro ? '🚻' : '🚰'} ${p.nome}</td>
          <td class="py-2.5 px-2 text-slate-600">${p.setor || '-'}</td>
          <td class="py-2.5 px-2 text-center font-bold text-slate-700">${meta}x</td>
          <td class="py-2.5 px-2 text-center font-bold ${qtdFeitas >= meta ? 'text-emerald-700' : 'text-amber-700'}">${qtdFeitas}</td>
          <td class="py-2.5 px-3 text-slate-600">${horariosStr}</td>
          <td class="py-2.5 px-2 text-center">${statusBadge}</td>
          <td class="py-2.5 px-3 text-slate-500 italic text-[10px]">${obsStr}</td>
        </tr>
      `;
    }).join('');
  }

  // Tabela de Ocorrências do dia
  const secaoOcs = document.getElementById('relatorioRondaSecaoOcorrencias');
  const corpoOcs = document.getElementById('relatorioRondaTabelaOcorrenciasCorpo');
  if (secaoOcs && corpoOcs) {
    if (ocsData.length === 0) {
      corpoOcs.innerHTML = '<tr><td colspan="7" class="py-3 px-3 text-center text-slate-400 italic">Nenhum chamado ou reclamação registrada para esta data.</td></tr>';
    } else {
      corpoOcs.innerHTML = ocsData.map(o => `
        <tr class="hover:bg-slate-50">
          <td class="py-2 px-3 font-mono font-bold text-slate-800">#${o.id}</td>
          <td class="py-2 px-2 text-slate-600">${o.hora || '--:--'}</td>
          <td class="py-2 px-2 font-semibold text-slate-900">${o.ponto_nome || '-'}</td>
          <td class="py-2 px-2 text-rose-700 font-bold">${o.tipo_problema}</td>
          <td class="py-2 px-3 text-slate-700">"${o.descricao}"</td>
          <td class="py-2 px-2 text-slate-600">${o.solicitante || 'Anônimo'}</td>
          <td class="py-2 px-2 text-center">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${o.status === 'aberto' ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}">
              ${o.status === 'aberto' ? 'ABERTO' : 'RESOLVIDO'}
            </span>
          </td>
        </tr>
      `).join('');
    }
  }

  const taxaGeral = somaMetas > 0 ? Math.round((somaFeitas / somaMetas) * 100) : 0;
  const taxaEl = document.getElementById('relatorioRondaTaxaConformidade');
  if (taxaEl) taxaEl.textContent = `${taxaGeral}%`;
  const fracaoEl = document.getElementById('relatorioRondaFracaoMetas');
  if (fracaoEl) fracaoEl.textContent = `${somaFeitas} de ${somaMetas} metas batidas`;

  const banEl = document.getElementById('relatorioRondaTotalBanheiros');
  if (banEl) banEl.textContent = totBanheiros;
  const bebEl = document.getElementById('relatorioRondaTotalBebedouros');
  if (bebEl) bebEl.textContent = totBebedouros;

  const ocsTotEl = document.getElementById('relatorioRondaTotalOcorrencias');
  if (ocsTotEl) ocsTotEl.textContent = ocsData.length;
  const ocsSubEl = document.getElementById('relatorioRondaSubOcorrencias');
  if (ocsSubEl) ocsSubEl.textContent = `${ocsPendentes.length} pendente(s)`;

  const contEl = document.getElementById('relatorioRondaContadorPontosTexto');
  if (contEl) contEl.textContent = `${pontos.length} instalações monitoradas`;
}

function imprimirRelatorioRondaA4() {
  document.body.classList.add('imprimindo-relatorio-ronda');
  window.print();
  setTimeout(() => {
    document.body.classList.remove('imprimindo-relatorio-ronda');
  }, 1000);
}

// Exportação em Excel (.xlsx) da Ronda do Canteiro com ExcelProGenerator
function exportarRondaExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('Biblioteca SheetJS ainda não foi carregada. Tente novamente.', 'error');
    return;
  }

  try {
    showToast('📊 Gerando Relatório Executivo de Ronda (NR-18/NR-24)...', 'info');
    const wb = XLSX.utils.book_new();
    const dataHora = new Date().toLocaleString('pt-BR');
    const empresaNome = localStorage.getItem('appCustomEmpresaNome') || 'GEL • Goetze Lobato Engenharia S.A.';
    const obraNome = localStorage.getItem('appCustomObraNome') || 'Canteiro Taboca 2';
    const dataHoje = getDataHojeLocal();

    // 1. ABA RESUMO DE CONFORMIDADE
    const ws1 = {};
    ExcelProGenerator.addCabecalhoObra(
      ws1,
      `${obraNome.toUpperCase()} — AUDITORIA DE HIGIENE & BEBEDOUROS (NR-18 / NR-24)`,
      `${empresaNome} • Fiscalização de Canteiro: Tiago Vidal • Emissão: ${dataHora}`,
      7
    );

    const h1 = ['Instalação / Ponto', 'Tipo', 'Setor da Obra', 'Meta Diária', 'Limpezas Hoje', 'Taxa (%)', 'Status Operacional'];
    h1.forEach((h, col) => ExcelProGenerator.addCell(ws1, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    const pontos = listaPontosRonda || [];
    let r1 = 4;
    let somaMetas = 0;
    let somaFeitas = 0;

    pontos.forEach((p, idx) => {
      const zebra = idx % 2 === 1;
      const st = calcularStatusPontoRonda(p);
      const isBanheiro = p.tipo === 'banheiro';
      const rowEx = r1 + 1;
      somaMetas += st.meta;
      somaFeitas += Math.min(st.meta, st.qtdHoje);

      let statusStyle = ExcelProGenerator.estilos.statusLivre;
      if (st.statusKey === 'alerta') statusStyle = ExcelProGenerator.estilos.statusAlerta;
      else if (st.statusKey === 'andamento') statusStyle = ExcelProGenerator.estilos.statusOcupada;

      ExcelProGenerator.addCell(ws1, r1, 0, p.nome, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws1, r1, 1, isBanheiro ? 'BANHEIRO' : 'BEBEDOURO', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws1, r1, 2, p.setor || 'Canteiro', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws1, r1, 3, st.meta, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws1, r1, 4, st.qtdHoje, { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws1, r1, 5, (st.qtdHoje / st.meta), { f: `E${rowEx}/D${rowEx}`, z: '0.0%', s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws1, r1, 6, st.badgeLabel, { s: statusStyle });

      r1++;
    });

    const totEx1 = r1 + 1;
    ExcelProGenerator.addCell(ws1, r1, 0, 'TOTAL GERAL DE METAS', { s: ExcelProGenerator.estilos.total('left') });
    ExcelProGenerator.addCell(ws1, r1, 1, '-', { s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws1, r1, 2, `${pontos.length} Pontos`, { s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws1, r1, 3, somaMetas, { f: `SUM(D5:D${r1})`, s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws1, r1, 4, somaFeitas, { f: `SUM(E5:E${r1})`, s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws1, r1, 5, somaMetas > 0 ? (somaFeitas / somaMetas) : 0, { f: `E${totEx1}/D${totEx1}`, z: '0.0%', s: ExcelProGenerator.estilos.total('center') });
    ExcelProGenerator.addCell(ws1, r1, 6, somaFeitas >= somaMetas ? 'CONFORME NR-24' : 'EM ATENDIMENTO', { s: ExcelProGenerator.estilos.total('center') });

    ws1['!ref'] = `A1:G${totEx1}`;
    ws1['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 24 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 26 }];
    ws1['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws1, "RESUMO CONFORMIDADE");

    // 2. ABA HISTÓRICO DE LIMPEZAS
    const ws2 = {};
    ExcelProGenerator.addCabecalhoObra(
      ws2,
      `${obraNome.toUpperCase()} — LOG DE HIGIENIZAÇÕES REALIZADAS`,
      `Auditoria Completa de Limpezas por Ponto, Responsável e Horário`,
      9
    );
    const h2 = ['Protocolo', 'Data', 'Horário', 'Instalação / Ponto', 'Tipo', 'Setor', 'Responsável', 'Avaliação', 'Checklist Realizado'];
    h2.forEach((h, col) => ExcelProGenerator.addCell(ws2, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    const regs = listaRegistrosRonda || [];
    let r2 = 4;
    regs.forEach((rg, idx) => {
      const zebra = idx % 2 === 1;
      ExcelProGenerator.addCell(ws2, r2, 0, rg.id || '-', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws2, r2, 1, formatarDataLimpezaBR(rg.data), { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws2, r2, 2, rg.hora || '-', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws2, r2, 3, rg.ponto_nome || '-', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws2, r2, 4, (rg.tipo === 'banheiro' ? 'BANHEIRO' : 'BEBEDOURO'), { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws2, r2, 5, rg.setor || '-', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws2, r2, 6, rg.responsavel || 'Equipe', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws2, r2, 7, rg.avaliacao || 'Tudo OK', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws2, r2, 8, Array.isArray(rg.checklist) ? rg.checklist.join('; ') : '-', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      r2++;
    });

    ws2['!ref'] = `A1:I${Math.max(5, r2)}`;
    ws2['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 28 }, { wch: 14 }, { wch: 22 }, { wch: 24 }, { wch: 20 }, { wch: 45 }];
    ws2['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws2, "HISTÓRICO DE LIMPEZAS");

    // 3. ABA OUVIDORIA & RECLAMAÇÕES DE TRABALHADORES
    const ws3 = {};
    ExcelProGenerator.addCabecalhoObra(
      ws3,
      `${obraNome.toUpperCase()} — OUVIDORIA & APONTAMENTOS DE TRABALHADORES`,
      `Registros Feitos pelos Operários da Obra via QR Code (Sem Senha)`,
      8
    );
    const h3 = ['Protocolo', 'Data', 'Horário', 'Local / Ponto', 'Tipo de Ocorrência', 'Descrição / Reclamação', 'Solicitante', 'Status'];
    h3.forEach((h, col) => ExcelProGenerator.addCell(ws3, 3, col, h, { s: ExcelProGenerator.estilos.th }));

    const ocs = listaOcorrenciasRonda || [];
    let r3 = 4;
    ocs.forEach((oc, idx) => {
      const zebra = idx % 2 === 1;
      const isAberto = oc.status === 'aberto';
      const stStyle = isAberto ? ExcelProGenerator.estilos.statusAlerta : ExcelProGenerator.estilos.statusLivre;

      ExcelProGenerator.addCell(ws3, r3, 0, oc.id || '-', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws3, r3, 1, formatarDataLimpezaBR(oc.data), { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws3, r3, 2, oc.hora || '-', { s: ExcelProGenerator.estilos.td(zebra, 'center') });
      ExcelProGenerator.addCell(ws3, r3, 3, `${oc.ponto_nome || '-'} (${oc.setor || '-'})`, { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws3, r3, 4, oc.tipo_problema || '-', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws3, r3, 5, oc.descricao || '-', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws3, r3, 6, oc.solicitante || 'Anônimo', { s: ExcelProGenerator.estilos.td(zebra, 'left') });
      ExcelProGenerator.addCell(ws3, r3, 7, isAberto ? 'PENDENTE / ABERTO' : 'RESOLVIDO', { s: stStyle });
      r3++;
    });

    ws3['!ref'] = `A1:H${Math.max(5, r3)}`;
    ws3['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 30 }, { wch: 25 }, { wch: 38 }, { wch: 24 }, { wch: 20 }];
    ws3['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 10 }, { hpt: 26 }];
    XLSX.utils.book_append_sheet(wb, ws3, "OUVIDORIA & RECLAMAÇÕES");

    XLSX.writeFile(wb, `RELATORIO_EXECUTIVO_RONDA_NR18_${dataHoje}.xlsx`);
    showToast('Planilha executiva da Ronda exportada com sucesso!', 'success');
  } catch (err) {
    showToast('Erro ao exportar planilha da ronda: ' + err.message, 'error');
  }
}

// Exposição das funções da Ronda do Canteiro no window
window.inicializarRondaCanteiro = inicializarRondaCanteiro;
window.carregarRondaCanteiro = carregarRondaCanteiro;
window.filtrarRondaUI = filtrarRondaUI;
window.atualizarContadoresRondaUI = atualizarContadoresRondaUI;
window.calcularStatusPontoRonda = calcularStatusPontoRonda;
window.abrirModalNovoPontoRonda = abrirModalNovoPontoRonda;
window.aoMudarTipoPontoRonda = aoMudarTipoPontoRonda;
window.salvarPontoRonda = salvarPontoRonda;
window.excluirPontoRonda = excluirPontoRonda;
window.getQRCodeUrlRonda = getQRCodeUrlRonda;
window.abrirModalPlacaQRRonda = abrirModalPlacaQRRonda;
window.imprimirPlacaQRRonda = imprimirPlacaQRRonda;
window.abrirModalConfigRonda = abrirModalConfigRonda;
window.salvarConfigRonda = salvarConfigRonda;
window.abrirModalRegistroManualRonda = abrirModalRegistroManualRonda;
window.salvarRegistroManualRonda = salvarRegistroManualRonda;
window.abrirModalHistoricoPontoRonda = abrirModalHistoricoPontoRonda;
window.abrirModalOcorrenciasPontoRonda = abrirModalOcorrenciasPontoRonda;
window.resolverOcorrenciaRonda = resolverOcorrenciaRonda;
window.abrirModalRelatorioRondaExecutivo = abrirModalRelatorioRondaExecutivo;
window.renderizarRelatorioRondaExecutivoUI = renderizarRelatorioRondaExecutivoUI;
window.imprimirRelatorioRondaA4 = imprimirRelatorioRondaA4;
window.recarregarRondaManual = recarregarRondaManual;
window.exportarRondaExcel = exportarRondaExcel;
window.abrirScannerRondaQR = abrirScannerRondaQR;
window.fecharScannerRondaQR = fecharScannerRondaQR;
window.confirmarPontoManualScanner = confirmarPontoManualScanner;
window.processarLeituraQRRonda = processarLeituraQRRonda;

// Exposição das novas funções no window
window.aoDigitarUrlFotoItemEstoque = aoDigitarUrlFotoItemEstoque;
window.tratarErroFotoPreviewItemEstoque = tratarErroFotoPreviewItemEstoque;
window.limparFotoItemEstoqueForm = limparFotoItemEstoqueForm;
window.trocarSubAbaEstoque = trocarSubAbaEstoque;
window.obterTodosBensAlocados = obterTodosBensAlocados;
window.atualizarBensAlocadosCampoUI = atualizarBensAlocadosCampoUI;
window.filtrarBensAlocadosUI = filtrarBensAlocadosUI;
window.renderizarGridBensAlocados = renderizarGridBensAlocados;
window.exportarRelatorioEstoqueExcel = exportarRelatorioEstoqueExcel;

// Exposição das funções de Transferência de Moradores de Casas
window.openModalTransferirMoradorCasa = openModalTransferirMoradorCasa;
window.aoMudarCasaDestinoTransferenciaMorador = aoMudarCasaDestinoTransferenciaMorador;
window.aoMudarComodoDestinoTransferenciaMorador = aoMudarComodoDestinoTransferenciaMorador;
window.confirmarTransferenciaMoradorCasa = confirmarTransferenciaMoradorCasa;

// Exposição das funções de Linha do Tempo e Log de Auditoria
window.registrarAuditoria = registrarAuditoria;
window.inicializarAuditoria = inicializarAuditoria;
window.renderizarFeedAuditoriaDashboard = renderizarFeedAuditoriaDashboard;
window.carregarAuditoria = carregarAuditoria;
window.filtrarAuditoriaUI = filtrarAuditoriaUI;
window.exportarAuditoriaExcel = exportarAuditoriaExcel;

// Exposição das funções de Gráficos de Ocupação e Casas
window.alternarModoGraficoBlocos = alternarModoGraficoBlocos;
window.renderChartCasasCidade = renderChartCasasCidade;
window.renderChartCasasTab = renderChartCasasTab;

// Exposição das funções de Relatórios Excel, Termos A4, Painel de Despesas e Backup JSON
window.exportarCasasCidadeExcel = exportarCasasCidadeExcel;
window.exportarLimpezasExcel = exportarLimpezasExcel;
window.exportarDespesasCasasExcel = exportarDespesasCasasExcel;
window.abrirModalTermoResponsabilidadeGenerico = abrirModalTermoResponsabilidadeGenerico;
window.gerarTermoResponsabilidadeAlojado = gerarTermoResponsabilidadeAlojado;
window.gerarTermoResponsabilidadeMoradorCasa = gerarTermoResponsabilidadeMoradorCasa;
window.imprimirTermoResponsabilidadeAtual = imprimirTermoResponsabilidadeAtual;
window.alternarSubAbaCasas = alternarSubAbaCasas;
window.carregarPainelConsolidadoDespesas = carregarPainelConsolidadoDespesas;
window.filtrarPainelDespesasCasasUI = filtrarPainelDespesasCasasUI;
window.marcarDespesaComoPaga = marcarDespesaComoPaga;
window.limparFiltrosPainelDespesas = limparFiltrosPainelDespesas;
window.fazerBackupCompletoJSON = fazerBackupCompletoJSON;
window.analisarArquivoBackupJSON = analisarArquivoBackupJSON;
window.executarRestauracaoBackupConfirmada = executarRestauracaoBackupConfirmada;
window.preencherItensTermoResponsabilidade = preencherItensTermoResponsabilidade;
window.gerarTermoResponsabilidadeDoModalFoto = gerarTermoResponsabilidadeDoModalFoto;




