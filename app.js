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

    // Recalcular status por quarto
    quartos.forEach(q => {
      const vagas = q.vagas || [];
      const cap = q.capacidade || vagas.length || 4;
      const oc = vagas.filter(v => v.status === 'ocupada').length;
      const liv = cap - oc;
      q.total_camas = cap;
      q.vagas_ocupadas = oc;
      q.vagas_livres = liv >= 0 ? liv : 0;
      
      const moveisAlerta = (q.moveis || []).filter(m => m.precisa_manutencao === 1 || m.estado_conservacao === 'Ruim' || m.estado_conservacao === 'Danificado').length;
      q.itens_alerta = moveisAlerta;

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
    });

    // Recalcular blocos
    blocos.forEach(b => {
      const qBloco = quartos.filter(q => q.bloco_id == b.id);
      b.total_quartos = qBloco.length;
      b.total_vagas = qBloco.reduce((s, q) => s + (q.capacidade || 4), 0);
      b.ocupadas = qBloco.reduce((s, q) => s + (q.vagas_ocupadas || 0), 0);
      b.livres = b.total_vagas - b.ocupadas;
      b.taxa_ocupacao = b.total_vagas > 0 ? Number(((b.ocupadas / b.total_vagas) * 100).toFixed(1)) : 0;
      b.itens_alerta = qBloco.reduce((s, q) => s + (q.itens_alerta || 0), 0);
    });

    // Recalcular empresas
    empresas.forEach(e => {
      e.total_alojados = alojados.filter(a => a.status === 'ativo' && (a.empresa_id == e.id || a.empresa_nome === e.nome)).length;
    });

    // Recalcular Geral
    const totVagas = blocos.reduce((s, b) => s + b.total_vagas, 0);
    const totOcup = alojados.filter(a => a.status === 'ativo').length;
    const totDesl = alojados.filter(a => a.status === 'desligado').length;
    const totAlertas = quartos.reduce((s, q) => s + (q.itens_alerta || 0), 0);

    this.dbState.geral = {
      total_vagas: totVagas || 880,
      ocupadas: totOcup,
      disponiveis: (totVagas - totOcup) >= 0 ? (totVagas - totOcup) : 0,
      taxa_ocupacao: totVagas > 0 ? Number(((totOcup / totVagas) * 100).toFixed(1)) : 0,
      total_blocos: blocos.length,
      total_quartos: quartos.length,
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
        if (typeof sincronizarTudoComFirebase === 'function' && firebaseInitialized) sincronizarTudoComFirebase(false);
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
        }
        return { message: "Bloco atualizado" };
      }
      if (method === 'DELETE') {
        this.dbState.blocos = this.dbState.blocos.filter(x => x.id !== bId);
        this.recomputeStats();
        this.saveToStorage();
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
        if (typeof sincronizarTudoComFirebase === 'function' && firebaseInitialized) sincronizarTudoComFirebase(false);
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
        }
        return { message: "Empresa atualizada" };
      }
      if (method === 'DELETE') {
        this.dbState.empresas = this.dbState.empresas.filter(x => x.id !== eId);
        this.saveToStorage();
        return { message: "Empresa excluída" };
      }
    }

    // 4. Vagas Livres
    if (path.includes('/api/vagas/livres')) {
      this.recomputeStats();
      const livres = [];
      this.dbState.quartos.forEach(q => {
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
        q.numero = body.numero || q.numero;
        q.capacidade = Number(body.capacidade) || q.capacidade;
        q.observacoes = body.observacoes !== undefined ? body.observacoes : q.observacoes;
        this.recomputeStats();
        this.saveToStorage();
      }
      return { message: "Quarto atualizado" };
    }
    if (matchQuartoDetalhe && method === 'DELETE') {
      const qId = Number(matchQuartoDetalhe[1]);
      this.dbState.quartos = this.dbState.quartos.filter(x => x.id !== qId);
      this.recomputeStats();
      this.saveToStorage();
      return { message: "Quarto excluído" };
    }
    if (path.includes('/api/quartos')) {
      if (method === 'POST') {
        const novoId = Date.now();
        const bloco = this.dbState.blocos.find(b => b.id == body.bloco_id) || { nome: 'Bloco', tipo: 'alojamento' };
        const cap = Number(body.capacidade) || 4;
        const vagas = [];
        for (let i = 1; i <= cap; i++) {
          vagas.push({ id: novoId + i, numero_cama: i, status: 'livre', alojado: null });
        }
        const moveis = [
          { id: novoId + 10, tipo_item: 'Ar-Condicionado', quantidade: 1, estado_conservacao: 'Bom', precisa_manutencao: 0, data_vistoria: new Date().toISOString().split('T')[0], observacoes: 'Funcionando' },
          { id: novoId + 11, tipo_item: 'Beliche / Camas', quantidade: 2, estado_conservacao: 'Bom', precisa_manutencao: 0, data_vistoria: new Date().toISOString().split('T')[0], observacoes: 'Em bom estado' },
          { id: novoId + 12, tipo_item: 'Guarda-roupa / Armário', quantidade: 4, estado_conservacao: 'Bom', precisa_manutencao: 0, data_vistoria: new Date().toISOString().split('T')[0], observacoes: 'Em bom estado' }
        ];
        const novoQ = {
          id: novoId,
          bloco_id: Number(body.bloco_id),
          bloco_nome: bloco.nome,
          bloco_tipo: bloco.tipo,
          numero: body.numero,
          capacidade: cap,
          observacoes: body.observacoes || '',
          vagas: vagas,
          moveis: moveis
        };
        this.dbState.quartos.push(novoQ);
        this.recomputeStats();
        this.saveToStorage();
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
    if (matchDesligar && method === 'POST') {
      const aId = Number(matchDesligar[1]);
      const alojado = this.dbState.alojados.find(x => x.id === aId);
      if (alojado) {
        alojado.status = 'desligado';
        alojado.data_saida = new Date().toISOString().split('T')[0];
        // Liberar vaga
        this.dbState.quartos.forEach(q => {
          (q.vagas || []).forEach(v => {
            if (v.id === alojado.vaga_id || (v.alojado && v.alojado.id === aId)) {
              v.status = 'livre';
              v.alojado = null;
            }
          });
        });
        this.recomputeStats();
        this.saveToStorage();
        if (typeof sincronizarTudoComFirebase === 'function' && firebaseInitialized) sincronizarTudoComFirebase(false);
      }
      return { message: "Alojado desligado e vaga liberada com sucesso" };
    }

    // 6.2 Realocar
    const matchRealocar = path.match(/\/api\/alojados\/(\d+)\/realocar/);
    if (matchRealocar && method === 'POST') {
      const aId = Number(matchRealocar[1]);
      const alojado = this.dbState.alojados.find(x => x.id === aId);
      const novaVagaId = Number(body.nova_vaga_id);
      if (alojado && novaVagaId) {
        // Liberar antiga
        this.dbState.quartos.forEach(q => {
          (q.vagas || []).forEach(v => {
            if (v.id === alojado.vaga_id || (v.alojado && v.alojado.id === aId)) {
              v.status = 'livre';
              v.alojado = null;
            }
          });
        });
        // Ocupar nova
        let foundRoom = null;
        let foundBed = null;
        this.dbState.quartos.forEach(q => {
          (q.vagas || []).forEach(v => {
            if (v.id === novaVagaId) {
              v.status = 'ocupada';
              v.alojado = alojado;
              foundRoom = q;
              foundBed = v;
            }
          });
        });
        if (foundRoom && foundBed) {
          alojado.vaga_id = novaVagaId;
          alojado.bloco_nome = foundRoom.bloco_nome;
          alojado.quarto_numero = foundRoom.numero;
          alojado.numero_cama = foundBed.numero_cama;
        }
        this.recomputeStats();
        this.saveToStorage();
        if (typeof sincronizarTudoComFirebase === 'function' && firebaseInitialized) sincronizarTudoComFirebase(false);
      }
      return { message: "Alojado realocado com sucesso" };
    }

    // 6.3 PUT Alojado
    const matchAlojadoPut = path.match(/\/api\/alojados\/(\d+)$/);
    if (matchAlojadoPut && method === 'PUT') {
      const aId = Number(matchAlojadoPut[1]);
      const a = this.dbState.alojados.find(x => x.id === aId);
      if (a) {
        if (body.nome_completo) a.nome_completo = body.nome_completo.toUpperCase();
        if (body.matricula) a.matricula = body.matricula;
        if (body.funcao) a.funcao = body.funcao.toUpperCase();
        if (body.observacoes !== undefined) a.observacoes = body.observacoes;
        if (body.foto_url !== undefined) a.foto_url = body.foto_url;
        // Atualiza na vaga
        this.dbState.quartos.forEach(q => {
          (q.vagas || []).forEach(v => {
            if (v.alojado && v.alojado.id === aId) {
              v.alojado = { ...a };
            }
          });
        });
        this.saveToStorage();
        if (typeof sincronizarTudoComFirebase === 'function' && firebaseInitialized) sincronizarTudoComFirebase(false);
      }
      return { message: "Alojado atualizado com sucesso" };
    }

    // 6.4 Listar/Cadastrar Alojados
    if (path.includes('/api/alojados')) {
      if (method === 'POST') {
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
          nome_completo: (body.nome_completo || '').toUpperCase(),
          empresa_id: Number(body.empresa_id),
          empresa_nome: emp.nome,
          empresa_cor: emp.cor,
          funcao: (body.funcao || '').toUpperCase(),
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
          foundBed.alojado = novoAlojado;
        }

        this.dbState.alojados.unshift(novoAlojado);
        this.recomputeStats();
        this.saveToStorage();
        if (typeof sincronizarTudoComFirebase === 'function' && firebaseInitialized) sincronizarTudoComFirebase(false);
        return { id: novoId, message: "Alojado cadastrado com sucesso" };
      }

      // GET
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
        if (typeof sincronizarTudoComFirebase === 'function' && firebaseInitialized) sincronizarTudoComFirebase(false);
        return { message: "Vistoria atualizada com sucesso" };
      }

      if (method === 'POST') {
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

function renderAvatarHtml(nome, fotoUrl, sizeClass = 'w-9 h-9', textSize = 'text-xs', clickCall = '') {
  const cursor = clickCall ? 'cursor-pointer hover:ring-2 hover:ring-amber-500 transition' : '';
  const onclickAttr = clickCall ? `onclick="${clickCall}" title="Ver / alterar foto de ${nome.replace(/"/g, '&quot;')}"` : '';

  if (fotoUrl && fotoUrl.trim() !== '') {
    const cachedUrl = photoCacheManager.memCache.get(fotoUrl) || fotoUrl;
    return `<img src="${cachedUrl}" data-cache-url="${fotoUrl}" onload="handleAvatarImgLoaded(this)" alt="${nome.replace(/"/g, '&quot;')}" ${onclickAttr} class="${sizeClass} rounded-full object-cover border border-slate-300 shadow-xs flex-shrink-0 ${cursor}">`;
  }

  const initials = getInitials(nome);
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

let firebaseApp = null;
let firestoreDb = null;
let firebaseInitialized = false;

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
    } else {
      console.warn("SDK do Firebase não detectado.");
      atualizarBadgeFirebaseUI(false, "Offline");
    }
  } catch (err) {
    console.error("Erro ao inicializar Firebase:", err);
    atualizarBadgeFirebaseUI(false, "Erro Firebase");
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
    console.error("Erro ao gerar snapshot:", err);
    if (manual) showToast(`Erro ao gerar snapshot: ${err.message}`, 'error');
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
    showToast(`Erro ao ler snapshot: ${err.message}`, 'error');
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
    console.error("Erro na sincronização Firebase:", err);
    if (manual) showToast(`Erro ao sincronizar com Firebase: ${err.message}`, 'error');
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
// 0.2 CROPPER.JS - CORTE E EDIÇÃO DE FOTOS 1:1
// ========================================================
let currentCropper = null;
let currentCropAlojadoId = null;

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

async function confirmarCropFoto() {
  if (!currentCropper) return;
  const btn = document.getElementById('btnConfirmarCrop');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Salvando no PC...';
  }

  try {
    const canvas = currentCropper.getCroppedCanvas({
      width: 400,
      height: 400,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });

    canvas.toBlob(async (blob) => {
      if (!blob) {
        showToast('Erro ao processar recorte da foto', 'error');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-check"></i> Cortar & Salvar Foto';
        }
        return;
      }

      const file = new File([blob], 'foto_alojado.jpg', { type: 'image/jpeg' });
      const formData = new FormData();
      formData.append('file', file);
      formData.append('usuario', currentUserName);

      const alojadoId = currentCropAlojadoId || document.getElementById('modalFotoAlojadoId').value;
      const res = await fetch(`${API_BASE}/api/alojados/${alojadoId}/foto`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Erro ao salvar foto');

      showToast('📸 Foto recortada com sucesso e salva no PC local do Prefeito!', 'success');
      
      const imgEl = document.getElementById('modalFotoImg');
      if (imgEl) {
        imgEl.src = data.foto_url;
        imgEl.classList.remove('hidden');
      }
      const vazioEl = document.getElementById('modalFotoVazio');
      if (vazioEl) vazioEl.classList.add('hidden');
      const btnRem = document.getElementById('modalFotoBtnRemover');
      if (btnRem) btnRem.classList.remove('hidden');

      cancelarCropFoto();
      refreshAllData();

      if (firebaseInitialized && firestoreDb) {
        firestoreDb.collection('alojados').doc(String(alojadoId)).set({
          tem_foto_local: true,
          atualizado_em: new Date().toISOString()
        }, { merge: true }).catch(() => {});
      }
    }, 'image/jpeg', 0.9);
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
  inicializarTamanhoFonte();
  initFirebase();
  initMobileMenu();
  loadInitialData();
  updateUserRoleUI();
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
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth < 768 && sidebar) {
    sidebar.classList.add('-translate-x-full');
  }

  // Executa carregamento sob demanda
  if (tabId === 'dashboard') {
    carregarDashboard();
  } else if (tabId === 'blocos') {
    carregarQuartos();
  } else if (tabId === 'alojados') {
    carregarAlojados();
  } else if (tabId === 'moveis') {
    carregarMoveis();
  } else if (tabId === 'gestao_cadastros') {
    carregarGestaoCadastros();
  } else if (tabId === 'relatorios') {
    carregarRelatoriosPreview();
  } else if (tabId === 'auditoria') {
    carregarAuditoria();
  } else if (tabId === 'configuracoes') {
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

function initMobileMenu() {
  const btn = document.getElementById('mobileMenuBtn');
  const sidebar = document.getElementById('sidebar');
  if (btn && sidebar) {
    btn.addEventListener('click', () => {
      sidebar.classList.toggle('-translate-x-full');
    });
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

    setTimeout(() => {
      if (firebaseInitialized) {
        sincronizarTudoComFirebase(false);
      }
    }, 1500);
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

    // Atualiza KPIs do Topo
    document.getElementById('kpiTotalVagas').textContent = data.geral.total_vagas;
    document.getElementById('kpiTotalQuartos').textContent = data.geral.total_quartos;
    document.getElementById('kpiTotalBlocos').textContent = data.geral.total_blocos;
    document.getElementById('kpiOcupadas').textContent = data.geral.ocupadas;
    document.getElementById('kpiTaxaOcupacao').textContent = `${data.geral.taxa_ocupacao}%`;
    document.getElementById('kpiLivres').textContent = data.geral.disponiveis;
    document.getElementById('kpiAlertasManut').textContent = data.geral.total_alertas_manutencao;

    // Sidebar counts
    document.getElementById('sideCountVagas').textContent = data.geral.total_vagas;
    document.getElementById('sideCountAlojados').textContent = data.geral.total_alojados_ativos;
    document.getElementById('sideCountAlertas').textContent = data.geral.total_alertas_manutencao;

    // Badge Alertas Top Navbar
    const badgeAlertas = document.getElementById('badgeAlertasNav');
    if (data.geral.total_alertas_manutencao > 0) {
      badgeAlertas.textContent = data.geral.total_alertas_manutencao;
      badgeAlertas.classList.remove('hidden');
    } else {
      badgeAlertas.classList.add('hidden');
    }

    // Banner de Alerta de Manutenção
    const banner = document.getElementById('bannerAlertaManutencao');
    if (data.geral.total_alertas_manutencao > 0) {
      banner.classList.remove('hidden');
      document.getElementById('bannerAlertaTexto').textContent = 
        `Foram identificados ${data.geral.total_alertas_manutencao} itens ou móveis necessitando de manutenção ou em estado ruim/danificado nas vistorias.`;
    } else {
      banner.classList.add('hidden');
    }

    // Renderiza Cards dos Blocos no Dashboard
    renderBlocosCards(data.blocos);

    // Renderiza Gráficos
    renderChartBlocos(data.blocos);
    renderChartEmpresas(data.empresas);

  } catch (err) {
    console.error('Erro dashboard:', err);
  }
}

function renderBlocosCards(blocos) {
  const container = document.getElementById('gridBlocosCards');
  if (!container) return;

  container.innerHTML = blocos.map(b => {
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
}

function renderChartBlocos(blocos) {
  const ctx = document.getElementById('chartBlocos');
  if (!ctx) return;

  if (chartBlocosInstance) {
    chartBlocosInstance.destroy();
  }

  const labels = blocos.map(b => b.nome);
  const ocupadas = blocos.map(b => b.ocupadas);
  const livres = blocos.map(b => b.livres);

  chartBlocosInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Vagas Ocupadas',
          data: ocupadas,
          backgroundColor: '#2563eb',
          borderRadius: 4,
        },
        {
          label: 'Vagas Disponíveis',
          data: livres,
          backgroundColor: '#10b981',
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
              const b = blocos[items[0].dataIndex];
              return `Capacidade Total: ${b.total_vagas} | Ocupação: ${b.taxa_ocupacao}%`;
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
          position: 'right',
          labels: {
            boxWidth: 12,
            font: { size: 10, family: 'Inter' }
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
  if (alerta) url += `filtro_alerta=true&`;
  if (busca) url += `q=${encodeURIComponent(busca)}&`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    globalQuartos = data;
    renderQuartosCards(data);
  } catch (err) {
    console.error('Erro quartos:', err);
  }
}

function aplicarFiltrosQuartos() {
  carregarQuartos();
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
    let borderClass = 'border-emerald-300 hover:border-emerald-500';
    let badgeColor = 'bg-emerald-100 text-emerald-800 border-emerald-300';
    let statusTexto = `${q.vagas_livres} Vaga(s) Livre(s)`;

    if (q.status_visual === 'lotado') {
      borderClass = 'border-red-300 hover:border-red-500';
      badgeColor = 'bg-red-100 text-red-800 border-red-300';
      statusTexto = 'Lotado (100%)';
    } else if (q.status_visual === 'quase_cheio') {
      borderClass = 'border-amber-300 hover:border-amber-500';
      badgeColor = 'bg-amber-100 text-amber-800 border-amber-300';
      statusTexto = 'Quase Cheio (1 livre)';
    }

    // Camas dentro do quarto
    const camasHtml = q.vagas.map(v => {
      if (v.status === 'ocupada' && v.alojado_id) {
        const safeNome = (v.nome_completo || '').replace(/'/g, "\\'");
        const safeEmpresa = (v.empresa_nome || '').replace(/'/g, "\\'");
        const safeFuncao = (v.funcao || '').replace(/'/g, "\\'");
        const clickFoto = `abrirModalFotoAlojado(${v.alojado_id}, '${safeNome}', '${v.foto_url || ''}', '${safeEmpresa}', '${v.empresa_cor || ''}', '${safeFuncao}', '${v.matricula || ''}', '${q.bloco_nome}', '${q.numero}', ${v.numero_cama})`;

        return `
          <div class="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-col justify-between text-xs">
            <div class="flex items-center justify-between gap-1 mb-1.5">
              <span class="font-bold text-slate-800 flex items-center gap-1">
                <i class="fa-solid fa-bed text-blue-600"></i> Cama ${v.numero_cama}
              </span>
              <span class="text-[9px] font-bold px-1.5 py-0.5 rounded text-white truncate max-w-[100px]" style="background-color: ${v.empresa_cor || '#475569'}">
                ${v.empresa_nome || 'CONTRATADA'}
              </span>
            </div>
            
            <div class="flex items-center gap-2 mb-1">
              ${renderAvatarHtml(v.nome_completo, v.foto_url, 'w-8 h-8', 'text-[11px]', clickFoto)}
              <div class="min-w-0 flex-1">
                <div class="font-bold text-slate-900 truncate" title="${v.nome_completo}">${v.nome_completo}</div>
                <div class="text-[11px] text-slate-500 truncate">${v.funcao || 'Alojado'} • Reg: ${v.matricula || '-'}</div>
              </div>
            </div>

            <!-- Ações rápidas na cama -->
            <div class="mt-2 pt-1.5 border-t border-slate-200 flex items-center justify-between">
              <button onclick="${clickFoto}" class="text-[10px] font-semibold text-slate-500 hover:text-amber-600 flex items-center gap-1" title="Foto do trabalhador">
                <i class="fa-solid fa-camera"></i> Foto
              </button>
              <div class="flex items-center gap-2">
                <button onclick="abrirModalRealocar(${v.alojado_id}, '${safeNome}', '${q.bloco_nome}', '${q.numero}', ${v.numero_cama})" class="btn-prefeito text-[10px] font-semibold text-sky-600 hover:text-sky-800 flex items-center gap-1">
                  <i class="fa-solid fa-arrows-turn-to-dots"></i> Mover
                </button>
                <button onclick="abrirModalDesligar(${v.alojado_id}, '${safeNome}')" class="btn-prefeito text-[10px] font-semibold text-red-600 hover:text-red-800 flex items-center gap-1">
                  <i class="fa-solid fa-person-walking-arrow-right"></i> Liberar
                </button>
              </div>
            </div>
          </div>
        `;
      } else {
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

            <button onclick="openModalNovoAlojadoComVaga(${v.vaga_id})" class="btn-prefeito w-full py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold flex items-center justify-center gap-1 transition">
              <i class="fa-solid fa-plus"></i> Alojar
            </button>
          </div>
        `;
      }
    }).join('');

    return `
      <div class="bg-white rounded-xl border ${borderClass} shadow-sm transition p-4 flex flex-col justify-between space-y-3">
        <!-- Topo do Card do Quarto -->
        <div class="flex items-start justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-lg font-extrabold text-slate-900">Quarto ${q.numero}</span>
              <span class="text-xs px-2 py-0.5 rounded font-semibold bg-slate-100 text-slate-700">${q.bloco_nome}</span>
            </div>
            <div class="text-xs text-slate-500 mt-0.5">
              Capacidade: ${q.capacidade} vagas (${q.vagas_ocupadas} ocupadas)
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

        <!-- Grade de Camas -->
        <div class="grid grid-cols-2 gap-2">
          ${camasHtml}
        </div>

        <!-- Rodapé do Card: Ações do Quarto -->
        <div class="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
          <button onclick="abrirModalQuartoDetalhes(${q.id})" class="text-sky-600 hover:text-sky-800 font-semibold flex items-center gap-1.5">
            <i class="fa-solid fa-list-check"></i> Detalhes & Móveis
          </button>
          <div class="flex items-center gap-2">
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
      if (v.status === 'ocupada' && v.alojado_id) {
        const safeNome = (v.nome_completo || '').replace(/'/g, "\\'");
        const safeEmpresa = (v.empresa_nome || '').replace(/'/g, "\\'");
        const safeFuncao = (v.funcao || '').replace(/'/g, "\\'");
        const clickFoto = `abrirModalFotoAlojado(${v.alojado_id}, '${safeNome}', '${v.foto_url || ''}', '${safeEmpresa}', '${v.empresa_cor || ''}', '${safeFuncao}', '${v.matricula || ''}', '${q.bloco_nome}', '${q.numero}', ${v.numero_cama})`;

        return `
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-bold text-slate-900"><i class="fa-solid fa-bed text-blue-600 mr-1"></i> Cama ${v.numero_cama}</span>
              <span class="text-[9px] font-bold px-1.5 py-0.5 rounded text-white" style="background-color: ${v.empresa_cor || '#475569'}">${v.empresa_nome || 'GEL'}</span>
            </div>
            
            <div class="flex items-center gap-3">
              ${renderAvatarHtml(v.nome_completo, v.foto_url, 'w-11 h-11', 'text-xs', clickFoto)}
              <div class="min-w-0 flex-1">
                <div class="font-bold text-slate-900 text-sm truncate">${v.nome_completo}</div>
                <div class="text-slate-500">Matrícula: <b>${v.matricula || '-'}</b> • Função: <b>${v.funcao || '-'}</b></div>
                <div class="text-slate-400 text-[10px]">Entrada: ${v.data_entrada || '-'}</div>
              </div>
            </div>

            <div class="pt-1.5 border-t border-slate-200 flex justify-end">
              <button onclick="${clickFoto}" class="text-[11px] font-semibold text-amber-600 hover:text-amber-800 flex items-center gap-1">
                <i class="fa-solid fa-camera"></i> Ver / Trocar Foto
              </button>
            </div>
          </div>
        `;
      } else {
        return `
          <div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs flex items-center justify-between">
            <div>
              <span class="font-bold text-emerald-900"><i class="fa-solid fa-bed text-emerald-600 mr-1"></i> Cama ${v.numero_cama}</span>
              <div class="text-emerald-700 text-[11px]">Vaga Livre</div>
            </div>
            <button onclick="fecharModal('modalQuartoDetalhes'); openModalNovoAlojadoComVaga(${v.vaga_id})" class="btn-prefeito px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold">
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

  const total = data.total;
  const items = data.items;

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
      const clickFoto = `abrirModalFotoAlojado(${a.id}, '${safeNome}', '${a.foto_url || ''}', '${safeEmpresa}', '${a.empresa_cor || ''}', '${safeFuncao}', '${a.matricula || ''}', '${a.bloco_nome || ''}', '${a.quarto_numero || ''}', ${a.numero_cama || 0})`;

      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="py-3 px-4 font-mono font-semibold text-slate-700">${a.matricula || '-'}</td>
          <td class="py-3 px-4">
            <div class="flex items-center gap-3">
              ${renderAvatarHtml(a.nome_completo, a.foto_url, 'w-10 h-10', 'text-xs', clickFoto)}
              <div>
                <div class="font-bold text-slate-900 cursor-pointer hover:text-sky-600" onclick="${clickFoto}" title="Ver detalhes e foto">${a.nome_completo}</div>
                <div class="text-[11px] text-slate-400">Entrada: ${a.data_entrada || '-'}</div>
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
            <button onclick="abrirModalEditarAlojado(${a.id}, '${a.matricula || ''}', '${a.nome_completo}', ${a.empresa_id || "null"}, '${a.funcao || ''}', '${a.data_entrada || ''}', '${a.observacoes || ''}')" class="btn-prefeito text-slate-500 hover:text-sky-600 p-1 mr-1" title="Editar Dados">
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
      const clickFoto = `abrirModalFotoAlojado(${a.id}, '${safeNome}', '${a.foto_url || ''}', '${safeEmpresa}', '${a.empresa_cor || ''}', '${safeFuncao}', '${a.matricula || ''}', '${a.bloco_nome || ''}', '${a.quarto_numero || ''}', ${a.numero_cama || 0})`;

      return `
        <div class="p-3.5 bg-white hover:bg-slate-50 transition flex items-center justify-between gap-3 border-b border-slate-100">
          <div class="flex items-center gap-3 min-w-0 flex-1">
            ${renderAvatarHtml(a.nome_completo, a.foto_url, 'w-11 h-11 flex-shrink-0', 'text-xs', clickFoto)}
            <div class="min-w-0 flex-1">
              <div class="font-bold text-slate-900 text-sm leading-tight truncate cursor-pointer hover:text-sky-600" onclick="${clickFoto}">${a.nome_completo}</div>
              <div class="text-xs text-slate-500 font-medium truncate mt-0.5">
                ${a.funcao || 'Sem função'} • <span class="font-bold" style="color: ${a.empresa_cor || '#475569'}">${a.empresa_nome || '-'}</span>
              </div>
              <div class="text-[11px] text-slate-600 mt-1 flex items-center gap-1.5 flex-wrap">
                ${isAtivo ? `<span class="bg-slate-100 px-1.5 py-0.5 rounded font-semibold text-slate-700 text-[10px]">🏢 ${a.bloco_nome} • Q.${a.quarto_numero} (Cama ${a.numero_cama})</span>` : '<span class="text-slate-400 italic text-[10px]">Desocupado</span>'}
                <span class="text-[10px] text-slate-400 font-mono">Reg: ${a.matricula || '-'}</span>
              </div>
            </div>
          </div>
          <div class="flex flex-col items-end gap-1.5 flex-shrink-0">
            ${statusBadge}
            <div class="flex items-center gap-1 mt-0.5">
              <button onclick="${clickFoto}" class="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs shadow-xs" title="Ver foto">
                <i class="fa-solid fa-camera"></i>
              </button>
              <button onclick="abrirModalEditarAlojado(${a.id}, '${a.matricula || ''}', '${safeNome}', ${a.empresa_id || 'null'}, '${safeFuncao}', '${a.data_entrada || ''}', '${a.observacoes || ''}')" class="btn-prefeito p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs shadow-xs" title="Editar">
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
  limparFotoForm();

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

function abrirModalEditarAlojado(id, matricula, nome, empresaId, funcao, dataEntrada, obs, fotoUrl = '') {
  if (!checkPrefeitoAccess()) return;
  document.getElementById('modalAlojadoTitulo').textContent = 'Editar Dados do Alojado';
  document.getElementById('alojadoFormId').value = id;
  document.getElementById('secaoSelecaoVaga').classList.add('hidden'); // Vaga é alterada por realocação

  preencherSelectEmpresas('alojadoFormEmpresa', empresaId);

  document.getElementById('alojadoFormNome').value = nome;
  document.getElementById('alojadoFormMatricula').value = matricula;
  document.getElementById('alojadoFormFuncao').value = funcao;
  document.getElementById('alojadoFormDataEntrada').value = dataEntrada || '';
  document.getElementById('alojadoFormObs').value = obs || '';

  // Foto atual
  const imgPreview = document.getElementById('alojadoFormFotoPreview');
  const placeholder = document.getElementById('alojadoFormFotoPlaceholder');
  const btnRemover = document.getElementById('btnRemoverFotoForm');
  const urlInput = document.getElementById('alojadoFormFotoUrl');
  document.getElementById('alojadoFormFotoInput').value = '';

  if (fotoUrl && fotoUrl.trim() !== '') {
    imgPreview.src = fotoUrl;
    imgPreview.classList.remove('hidden');
    placeholder.classList.add('hidden');
    btnRemover.classList.remove('hidden');
    urlInput.value = fotoUrl;
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
          data_entrada: dataEntrada,
          observacoes: obs,
          foto_url: fotoUrlAtual,
          usuario: currentUserName
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Erro ao cadastrar alojado');
      targetAlojadoId = data.id;

      // Se selecionou arquivo de foto, enviar upload
      if (fotoInput && fotoInput.files && fotoInput.files[0]) {
        const formData = new FormData();
        formData.append('file', fotoInput.files[0]);
        formData.append('usuario', currentUserName);
        await fetch(`${API_BASE}/api/alojados/${targetAlojadoId}/foto`, {
          method: 'POST',
          body: formData
        });
      }

      showToast('Alojado cadastrado com sucesso!', 'success');
      fecharModal('modalAlojadoForm');
      refreshAllData();
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
          data_entrada: dataEntrada,
          observacoes: obs,
          foto_url: fotoUrlAtual,
          usuario: currentUserName
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Erro ao atualizar dados');

      // Se selecionou arquivo de foto nova, enviar upload
      if (fotoInput && fotoInput.files && fotoInput.files[0]) {
        const formData = new FormData();
        formData.append('file', fotoInput.files[0]);
        formData.append('usuario', currentUserName);
        await fetch(`${API_BASE}/api/alojados/${id}/foto`, {
          method: 'POST',
          body: formData
        });
      }

      showToast('Dados e foto do alojado atualizados!', 'success');
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
  
  if (fotoUrl && fotoUrl.trim() !== '') {
    imgEl.src = fotoUrl;
    imgEl.classList.remove('hidden');
    vazioEl.classList.add('hidden');
    btnRemover.classList.remove('hidden');
  } else {
    imgEl.src = '';
    imgEl.classList.add('hidden');
    vazioEl.classList.remove('hidden');
    btnRemover.classList.add('hidden');
  }
  
  abrirModal('modalFotoAlojado');
  updateUserRoleUI();
}

function uploadFotoModalAlojado(input) {
  if (!checkPrefeitoAccess()) return;
  if (!input.files || !input.files[0]) return;
  const alojadoId = document.getElementById('modalFotoAlojadoId').value;
  iniciarCropFoto(input.files[0], alojadoId);
}

async function removerFotoModalAlojado() {
  if (!checkPrefeitoAccess()) return;
  const alojadoId = document.getElementById('modalFotoAlojadoId').value;
  if (!confirm('Deseja realmente remover a foto deste colaborador?')) return;

  try {
    const res = await fetch(`${API_BASE}/api/alojados/${alojadoId}/foto?usuario=${encodeURIComponent(currentUserName)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro ao remover foto');

    showToast('Foto removida!', 'success');
    document.getElementById('modalFotoImg').src = '';
    document.getElementById('modalFotoImg').classList.add('hidden');
    document.getElementById('modalFotoVazio').classList.remove('hidden');
    document.getElementById('modalFotoBtnRemover').classList.add('hidden');
    refreshAllData();
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

  try {
    const res = await fetch(`${API_BASE}/api/alojados/realocar`, {
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
    if (!res.ok) throw new Error(data.detail || 'Erro na realocação');

    showToast('Alojado realocado com sucesso!', 'success');
    fecharModal('modalRealocar');
    refreshAllData();
  } catch (err) {
    showToast(err.message, 'error');
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

  try {
    const res = await fetch(`${API_BASE}/api/alojados/desligar`, {
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
    if (!res.ok) throw new Error(data.detail || 'Erro no desligamento');

    showToast('Saída registrada e vaga liberada com sucesso!', 'success');
    fecharModal('modalDesligar');
    refreshAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Reativar Alojado
async function abrirModalReativar(alojadoId, nome) {
  if (!checkPrefeitoAccess()) return;
  const vagaId = prompt(`Selecione uma vaga livre para reativar ${nome}.\nDigite o ID da vaga (consulte a aba Quartos ou crie um novo cadastro):`);
  if (!vagaId) return;

  try {
    const res = await fetch(`${API_BASE}/api/alojados/reativar`, {
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
    if (!res.ok) throw new Error(data.detail || 'Erro ao reativar');

    showToast('Alojado reativado com sucesso!', 'success');
    refreshAllData();
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

async function carregarBlocosCadastros() {
  const tbody = document.getElementById('tabelaBlocosCadastros');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_BASE}/api/blocos`);
    const blocos = await res.json();
    globalBlocos = blocos;

    tbody.innerHTML = blocos.map(b => `
      <tr class="hover:bg-slate-50">
        <td class="py-2.5 px-3 font-bold text-slate-900">${b.nome}</td>
        <td class="py-2.5 px-3 uppercase text-xs font-semibold text-slate-500">${b.tipo}</td>
        <td class="py-2.5 px-3 text-center">${b.total_quartos}</td>
        <td class="py-2.5 px-3 text-center font-bold text-slate-700">${b.total_vagas}</td>
        <td class="py-2.5 px-3 text-right whitespace-nowrap">
          <button onclick="abrirModalEditarBloco(${b.id}, '${b.nome}', '${b.tipo}', ${b.ordem || 0})" class="btn-prefeito text-slate-500 hover:text-sky-600 mr-2">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button onclick="confirmarExcluirBloco(${b.id}, '${b.nome}')" class="btn-prefeito text-slate-400 hover:text-red-600">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');

    updateUserRoleUI();
  } catch (err) {
    console.error('Erro blocos cadastros:', err);
  }
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

function exportarResumoExcel() {
  if (staticModeActive && typeof XLSX !== 'undefined') {
    const wb = XLSX.utils.book_new();
    const data = (StaticApiEngine.dbState.blocos || []).map(b => ({
      "Bloco": b.nome,
      "Tipo": b.tipo.toUpperCase(),
      "Total Vagas": b.total_vagas,
      "Ocupadas": b.ocupadas,
      "Vagas Livres": b.livres,
      "Taxa de Ocupação": `${b.taxa_ocupacao}%`
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Resumo Ocupacao");
    XLSX.writeFile(wb, "resumo_ocupacao_canteiro.xlsx");
    showToast('Planilha de resumo baixada!', 'success');
    return;
  }
  window.open(`${API_BASE}/api/relatorios/exportar-resumo-excel`, '_blank');
}

function exportarAlojadosExcel() {
  if (staticModeActive && typeof XLSX !== 'undefined') {
    const blocoId = document.getElementById('filtroAlojadosBloco')?.value || '';
    const empresaId = document.getElementById('filtroAlojadosEmpresa')?.value || '';
    let lista = (StaticApiEngine.dbState.alojados || []).filter(a => a.status === 'ativo');
    if (empresaId) lista = lista.filter(a => a.empresa_id == empresaId);
    if (blocoId) {
      const b = StaticApiEngine.dbState.blocos.find(x => x.id == blocoId);
      if (b) lista = lista.filter(a => a.bloco_nome === b.nome);
    }
    const wb = XLSX.utils.book_new();
    const data = lista.map(a => ({
      "Matrícula": a.matricula,
      "Nome Completo": a.nome_completo,
      "Empresa": a.empresa_nome,
      "Função": a.funcao,
      "Bloco": a.bloco_nome,
      "Quarto": a.quarto_numero,
      "Cama": a.numero_cama,
      "Data Entrada": a.data_entrada || ""
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Alojados Ativos");
    XLSX.writeFile(wb, "alojados_ativos_canteiro.xlsx");
    showToast('Planilha de alojados baixada!', 'success');
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
    const danificados = [];
    (StaticApiEngine.dbState.quartos || []).forEach(q => {
      (q.moveis || []).forEach(m => {
        if (m.precisa_manutencao === 1 || m.estado_conservacao === 'Ruim' || m.estado_conservacao === 'Danificado') {
          danificados.push({
            "Bloco": q.bloco_nome,
            "Quarto": q.numero,
            "Item": m.tipo_item,
            "Quantidade": m.quantidade,
            "Estado": m.estado_conservacao,
            "Manutenção": m.precisa_manutencao ? "Sim" : "Não",
            "Data Vistoria": m.data_vistoria || "",
            "Observações": m.observacoes || ""
          });
        }
      });
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(danificados);
    XLSX.utils.book_append_sheet(wb, ws, "Moveis com Alerta");
    XLSX.writeFile(wb, "moveis_manutencao_canteiro.xlsx");
    showToast('Planilha de manutenção baixada!', 'success');
    return;
  }
  window.open(`${API_BASE}/api/relatorios/exportar-moveis-danificados-excel`, '_blank');
}

function exportarPlanilhaOficial() {
  if (staticModeActive && typeof XLSX !== 'undefined') {
    showToast('📗 Gerando Planilha Oficial Taboca 2 (modelo idêntico com 4 abas)...', 'info');
    const wb = XLSX.utils.book_new();

    // 1. RESUMO
    const resumoData = (StaticApiEngine.dbState.blocos || []).map(b => ({
      "Alojamento": b.nome,
      "Tipo": b.tipo.toUpperCase(),
      "Total de Vagas": b.total_vagas,
      "Ocupadas": b.ocupadas,
      "Vagas Livres": b.livres,
      "Taxa de Ocupação": `${b.taxa_ocupacao}%`
    }));
    const wsResumo = XLSX.utils.json_to_sheet(resumoData);
    XLSX.utils.book_append_sheet(wb, wsResumo, "RESUMO DE OCUPAÇÃO");

    // 2. MAPA DE CAMAS
    const camasData = [];
    (StaticApiEngine.dbState.quartos || []).forEach(q => {
      (q.vagas || []).forEach(v => {
        camasData.push({
          "Bloco": q.bloco_nome,
          "Quarto": q.numero,
          "Cama": v.numero_cama,
          "Status": v.status.toUpperCase(),
          "Matrícula": v.alojado ? v.alojado.matricula : "-",
          "Nome do Alojado": v.alojado ? v.alojado.nome_completo : "VAGA LIVRE",
          "Empresa": v.alojado ? v.alojado.empresa_nome : "-",
          "Função": v.alojado ? v.alojado.funcao : "-"
        });
      });
    });
    const wsCamas = XLSX.utils.json_to_sheet(camasData);
    XLSX.utils.book_append_sheet(wb, wsCamas, "MAPA DE CAMAS");

    // 3. ALOJADOS ATIVOS
    const ativosData = (StaticApiEngine.dbState.alojados || []).filter(a => a.status === 'ativo').map(a => ({
      "Matrícula": a.matricula,
      "Nome Completo": a.nome_completo,
      "Empresa": a.empresa_nome,
      "Função": a.funcao,
      "Bloco": a.bloco_nome,
      "Quarto": a.quarto_numero,
      "Cama": a.numero_cama,
      "Data de Entrada": a.data_entrada || "-",
      "Observações": a.observacoes || ""
    }));
    const wsAtivos = XLSX.utils.json_to_sheet(ativosData);
    XLSX.utils.book_append_sheet(wb, wsAtivos, "ALOJADOS ATIVOS");

    // 4. MÓVEIS E VISTORIAS
    const moveisData = [];
    (StaticApiEngine.dbState.quartos || []).forEach(q => {
      (q.moveis || []).forEach(m => {
        moveisData.push({
          "Bloco": q.bloco_nome,
          "Quarto": q.numero,
          "Item / Móvel": m.tipo_item,
          "Quantidade": m.quantidade,
          "Estado": m.estado_conservacao,
          "Precisa Manutenção": m.precisa_manutencao ? "SIM (ALERTA)" : "NÃO",
          "Data da Vistoria": m.data_vistoria || "-",
          "Observações": m.observacoes || ""
        });
      });
    });
    const wsMoveis = XLSX.utils.json_to_sheet(moveisData);
    XLSX.utils.book_append_sheet(wb, wsMoveis, "MÓVEIS E VISTORIAS");

    XLSX.writeFile(wb, "controle_alojamento_oficial_taboca2.xlsx");
    showToast('Planilha baixada com sucesso!', 'success');
    return;
  }
  showToast('📗 Gerando Planilha Oficial Taboca 2 (modelo idêntico com 4 abas)...', 'info');
  window.open(`${API_BASE}/api/relatorios/exportar-planilha-oficial`, '_blank');
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
// 8. AUDITORIA & LOGS
// ========================================================

async function carregarAuditoria() {
  const busca = document.getElementById('filtroAuditBusca')?.value.trim() || '';
  const acao = document.getElementById('filtroAuditAcao')?.value || '';
  const usuario = document.getElementById('filtroAuditUsuario')?.value || '';

  let url = `${API_BASE}/api/auditoria?limit=150&`;
  if (busca) url += `q=${encodeURIComponent(busca)}&`;
  if (acao) url += `acao=${acao}&`;
  if (usuario) url += `usuario=${usuario}&`;

  try {
    const res = await fetch(url);
    const logs = await res.json();
    renderTabelaAuditoria(logs);
  } catch (err) {
    console.error('Erro auditoria:', err);
  }
}

function renderTabelaAuditoria(logs) {
  const tbody = document.getElementById('tabelaAuditoriaCorpo');
  if (!tbody) return;

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-400">Nenhum registro de auditoria encontrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(l => {
    let acaoClass = 'bg-slate-100 text-slate-700';
    if (l.acao === 'CRIAR') acaoClass = 'bg-emerald-100 text-emerald-800';
    if (l.acao === 'EDITAR') acaoClass = 'bg-blue-100 text-blue-800';
    if (l.acao === 'REALOCAR') acaoClass = 'bg-indigo-100 text-indigo-800';
    if (l.acao === 'DESLIGAR') acaoClass = 'bg-amber-100 text-amber-800';
    if (l.acao === 'EXCLUIR') acaoClass = 'bg-red-100 text-red-800';
    if (l.acao === 'IMPORTACAO' || l.acao === 'RESTAURACAO') acaoClass = 'bg-purple-100 text-purple-800';

    return `
      <tr class="hover:bg-slate-50">
        <td class="py-2.5 px-4 text-slate-500 whitespace-nowrap">${l.data_hora}</td>
        <td class="py-2.5 px-4 font-bold text-slate-900">${l.usuario}</td>
        <td class="py-2.5 px-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${acaoClass}">${l.acao}</span>
        </td>
        <td class="py-2.5 px-4 uppercase text-slate-500 text-[11px]">${l.entidade}</td>
        <td class="py-2.5 px-4 text-slate-700">${l.detalhes}</td>
      </tr>
    `;
  }).join('');
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
  if (modal) modal.classList.remove('hidden');
}

function fecharModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
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
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[PWA] Service Worker registrado com sucesso:', reg.scope))
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

