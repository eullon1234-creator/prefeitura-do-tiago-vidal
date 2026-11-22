// ============================================================================
// MÓDULO ADMINISTRATIVO: EQUIPE DE CAMPO, PRIORIDADES & ROTINAS DIÁRIAS
// Prefeitura de Canteiro — GEL Engenharia (Obra Taboca 2)
// ============================================================================

(function () {
  'use strict';

  const CATEGORIAS = {
    banheiro: { label: 'Banheiro / Bebedouro', icone: 'fa-restroom', badge: 'bg-teal-50 text-teal-700 border-teal-200' },
    alojamento: { label: 'Alojamento / Quarto', icone: 'fa-bed', badge: 'bg-sky-50 text-sky-700 border-sky-200' },
    casa: { label: 'Casa na Cidade', icone: 'fa-house-chimney-user', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    equipamento: { label: 'Equipamento / Móvel', icone: 'fa-screwdriver-wrench', badge: 'bg-violet-50 text-violet-700 border-violet-200' },
    estoque: { label: 'Estoque / Gelo', icone: 'fa-boxes-stacked', badge: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
    chamado: { label: 'Chamado QR Code', icone: 'fa-qrcode', badge: 'bg-amber-50 text-amber-800 border-amber-200' },
    vigilancia: { label: 'Ponto Vigilância', icone: 'fa-shield-halved', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
    outro: { label: 'Outro / Tarefa Livre', icone: 'fa-clipboard-list', badge: 'bg-slate-100 text-slate-700 border-slate-200' }
  };

  const state = {
    initialized: false,
    unsubs: [],
    usuarios: [],
    tarefas: [],
    rotinas: [],
    rotinasLogsHoje: [],
    funcionarioSelecionadoUid: 'todos',
    subAba: 'tarefas', // 'tarefas' | 'rotinas'
    filtroStatus: 'abertas', // 'abertas' | 'visto' | 'impedimento' | 'concluidas' | 'todas'
    modalTipo: 'tarefa', // 'tarefa' | 'rotina'
    modalCategoria: 'banheiro',
    catalogoCache: {
      ronda_pontos: [],
      casas_cidade: [],
      estoque_itens: [],
      chamados_suporte: [],
      pontos_vigilancia: []
    },
    catalogoCarregado: false
  };

  function getDataHojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function iniciais(nome) {
    const p = String(nome || 'EQ').trim().split(/\s+/).filter(Boolean);
    return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
  }

  function toast(msg, tipo = 'info') {
    if (typeof window.showToast === 'function') window.showToast(msg, tipo);
  }

  function getDb() {
    if (typeof firestoreDb !== 'undefined' && firestoreDb) return firestoreDb;
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) return firebase.firestore();
    return null;
  }

  // ==========================================================================
  // LISTENERS EM TEMPO REAL
  // ==========================================================================
  function initListeners() {
    if (state.initialized) return;
    const db = getDb();
    if (!db) return;
    state.initialized = true;

    const hoje = getDataHojeISO();

    // 1. Funcionários ativos (prioriza quem tem acessoAppEquipe === true)
    const u1 = db.collection('usuarios_sistema').where('status', '==', 'ativo').onSnapshot(snap => {
      const arr = [];
      snap.forEach(d => arr.push({ uid: d.id, ...d.data() }));
      arr.sort((a, b) => {
        const ae = (a.extras && a.extras.acessoAppEquipe) ? 0 : 1;
        const be = (b.extras && b.extras.acessoAppEquipe) ? 0 : 1;
        if (ae !== be) return ae - be;
        return (a.nome || '').localeCompare(b.nome || '');
      });
      state.usuarios = arr;
      renderPainelSeAtivo();
    }, err => console.warn('[EquipeAdmin] Erro usuarios:', err));

    // 2. Tarefas / Prioridades
    const u2 = db.collection('equipe_tarefas').onSnapshot(snap => {
      const arr = [];
      snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
      const peso = { urgente: 1, alta: 2, normal: 3 };
      arr.sort((a, b) => {
        const pa = peso[a.prioridade] || 3;
        const pb = peso[b.prioridade] || 3;
        if (pa !== pb) return pa - pb;
        const oa = Number(a.ordem || 999);
        const ob = Number(b.ordem || 999);
        if (oa !== ob) return oa - ob;
        return String(b.criadoEm || '').localeCompare(String(a.criadoEm || ''));
      });
      state.tarefas = arr;
      atualizarBadgesGlobais();
      renderPainelSeAtivo();
    }, err => console.warn('[EquipeAdmin] Erro tarefas:', err));

    // 3. Rotinas Fixas Diárias
    const u3 = db.collection('equipe_rotinas').onSnapshot(snap => {
      const arr = [];
      snap.forEach(d => {
        const data = d.data();
        if (data.ativo !== false) arr.push({ id: d.id, ...data });
      });
      arr.sort((a, b) => Number(a.ordem || 999) - Number(b.ordem || 999));
      state.rotinas = arr;
      renderPainelSeAtivo();
    }, err => console.warn('[EquipeAdmin] Erro rotinas:', err));

    // 4. Logs das rotinas de HOJE
    const u4 = db.collection('equipe_rotinas_logs').where('data', '==', hoje).onSnapshot(snap => {
      const arr = [];
      snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
      state.rotinasLogsHoje = arr;
      renderPainelSeAtivo();
    }, err => console.warn('[EquipeAdmin] Erro logs rotina:', err));

    state.unsubs.push(u1, u2, u3, u4);
  }

  function atualizarBadgesGlobais() {
    const alertas = state.tarefas.filter(t => t.status === 'aguardando_visto' || t.status === 'impedimento').length;
    const sideBadge = document.getElementById('sideCountEquipePrioridades');
    const drawerBadge = document.getElementById('drawerBadgeEquipePrioridades');
    if (sideBadge) {
      if (alertas > 0) {
        sideBadge.textContent = String(alertas);
        sideBadge.classList.remove('hidden');
      } else {
        sideBadge.classList.add('hidden');
      }
    }
    if (drawerBadge) {
      drawerBadge.textContent = alertas > 0 ? `${alertas} alerta(s)` : 'Ao Vivo';
    }
  }

  function renderPainelSeAtivo() {
    if (typeof activeTab !== 'undefined' && activeTab === 'equipe_prioridades') {
      renderPainel();
    }
  }

  // ==========================================================================
  // CATÁLOGO DE ITENS CADASTRADOS NO SISTEMA (CONECTADO AO BANCO)
  // ==========================================================================
  async function carregarCatalogoItens() {
    if (state.catalogoCarregado) return;
    const db = getDb();
    if (!db) return;
    state.catalogoCarregado = true;

    const cols = ['ronda_pontos', 'casas_cidade', 'estoque_itens', 'chamados_suporte', 'pontos_vigilancia'];
    await Promise.allSettled(cols.map(async col => {
      try {
        const snap = await db.collection(col).get();
        const arr = [];
        snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
        state.catalogoCache[col] = arr;
      } catch (e) {
        console.warn(`[EquipeAdmin] Aviso ao ler catálogo ${col}:`, e);
      }
    }));
  }

  function obterOpcoesCategoria(cat) {
    const dbMem = (window.StaticApiEngine && window.StaticApiEngine.dbState) ? window.StaticApiEngine.dbState : {};
    const opcoes = [];

    if (cat === 'banheiro') {
      (state.catalogoCache.ronda_pontos || []).forEach(p => {
        if (p.ativo === false) return;
        const tipoLbl = p.tipo === 'bebedouro' ? '💧 Bebedouro' : '🚽 Banheiro';
        opcoes.push({
          id: p.id,
          nome: `${tipoLbl}: ${p.nome}${p.setor ? ' • ' + p.setor : ''}`,
          refColecao: 'ronda_pontos'
        });
      });
    } else if (cat === 'alojamento') {
      const blocos = dbMem.blocos || [];
      const quartos = dbMem.quartos || [];
      blocos.forEach(b => {
        opcoes.push({ id: `bloco_${b.id}`, nome: `🏢 Bloco Inteiro: ${b.nome}`, refColecao: 'blocos' });
      });
      quartos.forEach(q => {
        opcoes.push({
          id: String(q.id),
          nome: `🛏️ ${q.bloco_nome || 'Bloco'} • Quarto ${q.numero}`,
          refColecao: 'quartos'
        });
      });
    } else if (cat === 'casa') {
      (state.catalogoCache.casas_cidade || []).forEach(c => {
        opcoes.push({
          id: c.id,
          nome: `🏠 ${c.nome || 'Casa'}${c.endereco ? ' • ' + c.endereco : ''}`,
          refColecao: 'casas_cidade'
        });
      });
    } else if (cat === 'equipamento') {
      const moveis = dbMem.moveis || [];
      const ordenados = [...moveis].sort((a, b) => {
        const score = m => (m.precisa_manutencao || m.estado === 'Danificado' || m.estado === 'Ruim') ? 0 : 1;
        return score(a) - score(b);
      });
      ordenados.slice(0, 250).forEach(m => {
        const alerta = (m.precisa_manutencao || m.estado === 'Danificado') ? '⚠️ ' : '🔧 ';
        opcoes.push({
          id: String(m.id),
          nome: `${alerta}${m.tipo_movel || m.tipo || 'Equipamento'} — ${m.bloco_nome || ''} Q.${m.quarto_numero || m.quarto_id || ''} (${m.estado || 'Bom'})`,
          refColecao: 'moveis_vistorias'
        });
      });
    } else if (cat === 'estoque') {
      opcoes.push({ id: 'maquina_gelo', nome: '🧊 Fábrica & Máquina de Gelo (Produção / Freezer)', refColecao: 'ronda_registros' });
      (state.catalogoCache.estoque_itens || []).forEach(e => {
        opcoes.push({
          id: e.id,
          nome: `📦 ${e.nome || e.item || 'Item Estoque'} (Qtd: ${e.quantidade ?? 0})`,
          refColecao: 'estoque_itens'
        });
      });
    } else if (cat === 'chamado') {
      (state.catalogoCache.chamados_suporte || [])
        .filter(c => !['concluido', 'resolvido', 'cancelado'].includes(c.status))
        .forEach(c => {
          opcoes.push({
            id: c.id || c.protocolo,
            nome: `🎫 #${c.protocolo || c.id} • ${c.categoria || 'Manutenção'} — ${c.local_formatado || c.quarto || c.casa_nome || 'Canteiro'}`,
            refColecao: 'chamados_suporte',
            extraDesc: c.descricao || ''
          });
        });
    } else if (cat === 'vigilancia') {
      (state.catalogoCache.pontos_vigilancia || []).forEach(p => {
        opcoes.push({
          id: p.id,
          nome: `🛡️ ${p.nome || 'Ponto'}${p.local ? ' • ' + p.local : ''}`,
          refColecao: 'pontos_vigilancia'
        });
      });
    }

    return opcoes;
  }

  // ==========================================================================
  // RENDERIZAÇÃO DO PAINEL DO PREFEITO (#tab-equipe_prioridades)
  // ==========================================================================
  function getFuncionariosEquipe() {
    const marcados = state.usuarios.filter(u => u.extras && u.extras.acessoAppEquipe === true);
    return marcados.length > 0 ? marcados : state.usuarios;
  }

  function renderPainel() {
    initListeners();
    carregarCatalogoItens();

    const funcionarios = getFuncionariosEquipe();
    const hoje = getDataHojeISO();

    // KPIs Globais
    const abertas = state.tarefas.filter(t => ['pendente', 'em_andamento', 'impedimento'].includes(t.status));
    const urgentes = abertas.filter(t => t.prioridade === 'urgente');
    const aguardandoVisto = state.tarefas.filter(t => t.status === 'aguardando_visto');
    const impedimentos = state.tarefas.filter(t => t.status === 'impedimento');
    const concluidasHoje = state.tarefas.filter(t => t.status === 'concluido' && String(t.concluidoEm || '').startsWith(hoje));

    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
    setTxt('eqAdmKpiEquipe', funcionarios.length);
    setTxt('eqAdmKpiUrgentes', urgentes.length);
    setTxt('eqAdmKpiVisto', aguardandoVisto.length);
    setTxt('eqAdmKpiImpedimentos', impedimentos.length);
    setTxt('eqAdmKpiConcluidasHoje', concluidasHoje.length + state.rotinasLogsHoje.length);

    renderCardsFuncionarios(funcionarios);
    renderListaPrincipal();
  }

  function renderCardsFuncionarios(funcionarios) {
    const container = document.getElementById('eqAdmListaFuncionarios');
    if (!container) return;

    if (!funcionarios.length) {
      container.innerHTML = `
        <div class="col-span-full bg-white rounded-2xl border border-slate-200 p-6 text-center">
          <p class="text-sm font-bold text-slate-800">Nenhum funcionário cadastrado com acesso ao App da Equipe ainda.</p>
          <p class="text-xs text-slate-500 mt-1">Vá em <strong>Usuários & Acessos</strong>, cadastre um funcionário e marque a opção <strong>"App da Equipe (Campo)"</strong>.</p>
          <button type="button" onclick="switchTab('usuarios')" class="mt-3 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition">
            <i class="fa-solid fa-user-plus mr-1.5"></i>Ir para Usuários & Acessos
          </button>
        </div>
      `;
      return;
    }

    const todosAtivo = state.funcionarioSelecionadoUid === 'todos';
    const cardTodos = `
      <button type="button" onclick="EquipeAdmin.selecionarFuncionario('todos')" class="text-left p-4 rounded-2xl border transition flex flex-col justify-between ${todosAtivo ? 'bg-slate-900 text-white border-amber-500 ring-2 ring-amber-400/40 shadow-md' : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300'}">
        <div class="flex items-center justify-between gap-2 w-full">
          <div class="w-10 h-10 rounded-xl ${todosAtivo ? 'bg-amber-500 text-slate-950' : 'bg-slate-100 text-slate-700'} flex items-center justify-center font-black">
            <i class="fa-solid fa-users"></i>
          </div>
          <span class="text-[11px] font-bold px-2 py-0.5 rounded-full ${todosAtivo ? 'bg-white/10 text-amber-300' : 'bg-slate-100 text-slate-600'}">${funcionarios.length} pessoas</span>
        </div>
        <div class="mt-3">
          <p class="text-sm font-extrabold">Toda a Equipe</p>
          <p class="text-[11px] ${todosAtivo ? 'text-slate-300' : 'text-slate-500'}">Visão geral das prioridades</p>
        </div>
      </button>
    `;

    const cards = funcionarios.map(f => {
      const sel = state.funcionarioSelecionadoUid === f.uid;
      const tFunc = state.tarefas.filter(t => t.funcionarioUid === f.uid);
      const abertas = tFunc.filter(t => ['pendente', 'em_andamento', 'impedimento'].includes(t.status));
      const emAndamento = tFunc.filter(t => t.status === 'em_andamento').length;
      const imp = tFunc.filter(t => t.status === 'impedimento').length;
      const visto = tFunc.filter(t => t.status === 'aguardando_visto').length;

      const rotFunc = state.rotinas.filter(r => r.funcionarioUid === f.uid);
      const rotFeitas = rotFunc.filter(r => state.rotinasLogsHoje.some(l => l.rotinaId === r.id)).length;

      const totalDia = abertas.length + visto + rotFunc.length;
      const feitasDia = visto + rotFeitas;
      const pct = totalDia > 0 ? Math.round((feitasDia / totalDia) * 100) : 100;

      return `
        <div onclick="EquipeAdmin.selecionarFuncionario('${f.uid}')" class="cursor-pointer p-4 rounded-2xl border transition flex flex-col justify-between ${sel ? 'bg-slate-900 text-white border-amber-500 ring-2 ring-amber-400/40 shadow-md' : 'bg-white text-slate-800 border-slate-200 hover:border-amber-300 hover:shadow-xs'}">
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-10 h-10 rounded-xl ${sel ? 'bg-amber-500 text-slate-950' : 'bg-slate-900 text-amber-400'} font-black text-xs flex items-center justify-center flex-shrink-0">
                ${iniciais(f.nome)}
              </div>
              <div class="min-w-0">
                <p class="text-sm font-extrabold truncate">${esc(f.nome)}</p>
                <p class="text-[11px] ${sel ? 'text-slate-300' : 'text-slate-500'} truncate">${esc(f.cargo || '@' + f.username)}</p>
              </div>
            </div>
            <button type="button" onclick="event.stopPropagation(); EquipeAdmin.enviarWhatsAppFuncionario('${f.uid}')" title="Enviar prioridades no WhatsApp" class="w-8 h-8 rounded-lg bg-emerald-500/15 hover:bg-emerald-500 text-emerald-500 hover:text-white flex items-center justify-center transition flex-shrink-0">
              <i class="fa-brands fa-whatsapp text-sm"></i>
            </button>
          </div>

          <div class="mt-3 space-y-2">
            <div class="flex items-center gap-1.5 flex-wrap text-[10px] font-bold">
              <span class="px-2 py-0.5 rounded-full ${sel ? 'bg-white/10 text-amber-300' : 'bg-amber-50 text-amber-800 border border-amber-200'}">${abertas.length} na fila</span>
              <span class="px-2 py-0.5 rounded-full ${sel ? 'bg-white/10 text-emerald-300' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}">Rotina ${rotFeitas}/${rotFunc.length}</span>
              ${emAndamento > 0 ? `<span class="px-2 py-0.5 rounded-full bg-sky-500 text-white">Em campo</span>` : ''}
              ${visto > 0 ? `<span class="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950">${visto} p/ visto</span>` : ''}
              ${imp > 0 ? `<span class="px-2 py-0.5 rounded-full bg-rose-600 text-white animate-pulse">${imp} travou</span>` : ''}
            </div>
            <div class="w-full h-1.5 rounded-full ${sel ? 'bg-slate-800' : 'bg-slate-100'} overflow-hidden">
              <div class="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-500" style="width: ${pct}%"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = cardTodos + cards;
  }

  function renderListaPrincipal() {
    const container = document.getElementById('eqAdmListaPrincipal');
    if (!container) return;

    const barraFiltros = document.getElementById('eqAdmBarraFiltrosTarefas');
    if (barraFiltros) barraFiltros.classList.toggle('hidden', state.subAba !== 'tarefas');

    if (state.subAba === 'rotinas') {
      renderListaRotinasAdmin(container);
      return;
    }

    let lista = state.tarefas.filter(t => {
      if (state.funcionarioSelecionadoUid !== 'todos' && t.funcionarioUid !== state.funcionarioSelecionadoUid) return false;
      if (state.filtroStatus === 'abertas') return ['pendente', 'em_andamento', 'impedimento'].includes(t.status);
      if (state.filtroStatus === 'visto') return t.status === 'aguardando_visto';
      if (state.filtroStatus === 'impedimento') return t.status === 'impedimento';
      if (state.filtroStatus === 'concluidas') return t.status === 'concluido';
      return true;
    });

    if (!lista.length) {
      container.innerHTML = `
        <div class="bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <div class="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3 text-xl">
            <i class="fa-solid fa-list-check"></i>
          </div>
          <h4 class="text-sm font-bold text-slate-800">Nenhuma prioridade encontrada neste filtro</h4>
          <p class="text-xs text-slate-500 mt-1">Clique em <strong>"+ Nova Prioridade"</strong> para atribuir equipamentos, banheiros, alojamentos, casas ou chamados para um funcionário.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = lista.map((t, idx) => {
      const cat = CATEGORIAS[t.categoria] || CATEGORIAS.outro;
      const prioChip = t.prioridade === 'urgente'
        ? '<span class="px-2.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-black uppercase">🔥 URGENTE</span>'
        : (t.prioridade === 'alta'
          ? '<span class="px-2.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black uppercase">⚡ ALTA</span>'
          : '<span class="px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-800 text-[10px] font-bold uppercase">NORMAL</span>');

      let stChip = '';
      let border = 'border-slate-200';
      if (t.status === 'pendente') {
        stChip = '<span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-bold">Na Fila</span>';
      } else if (t.status === 'em_andamento') {
        stChip = '<span class="px-2 py-0.5 rounded-md bg-sky-100 text-sky-800 text-[10px] font-bold"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Em Andamento</span>';
        border = 'border-sky-300 bg-sky-50/20';
      } else if (t.status === 'impedimento') {
        stChip = '<span class="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[10px] font-bold"><i class="fa-solid fa-triangle-exclamation mr-1"></i>IMPEDIMENTO</span>';
        border = 'border-rose-400 ring-1 ring-rose-200 bg-rose-50/30';
      } else if (t.status === 'aguardando_visto') {
        stChip = '<span class="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-extrabold"><i class="fa-solid fa-eye mr-1"></i>Aguardando seu Visto</span>';
        border = 'border-amber-400 ring-1 ring-amber-200 bg-amber-50/30';
      } else {
        stChip = '<span class="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold"><i class="fa-solid fa-check-double mr-1"></i>Concluído</span>';
      }

      return `
        <div class="bg-white rounded-2xl border ${border} p-4 sm:p-5 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div class="space-y-2 min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="w-6 h-6 rounded-lg bg-slate-900 text-amber-400 text-[11px] font-black flex items-center justify-center">#${idx + 1}</span>
              ${prioChip}
              ${stChip}
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-bold ${cat.badge}">
                <i class="fa-solid ${cat.icone}"></i>${cat.label}
              </span>
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-bold">
                <i class="fa-solid fa-helmet-safety text-amber-500"></i>${esc(t.funcionarioNome)}
              </span>
            </div>

            <div>
              <h4 class="text-sm sm:text-base font-extrabold text-slate-900">${esc(t.titulo)}</h4>
              <p class="text-xs font-semibold text-indigo-700 mt-0.5"><i class="fa-solid fa-location-dot mr-1"></i>${esc(t.itemNome)}</p>
              ${t.instrucoes ? `<p class="text-xs text-slate-600 mt-1">${esc(t.instrucoes)}</p>` : ''}
            </div>

            ${t.status === 'impedimento' && t.motivoImpedimento ? `
              <div class="p-2.5 rounded-xl bg-rose-100 border border-rose-300 text-xs text-rose-900 font-semibold">
                <i class="fa-solid fa-circle-exclamation mr-1"></i>Motivo reportado: ${esc(t.motivoImpedimento)}
              </div>
            ` : ''}

            ${(t.observacaoConclusao || t.fotoConclusao) ? `
              <div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-emerald-950">
                <div>
                  <strong class="block text-emerald-800">Retorno do Funcionário:</strong>
                  <span>${esc(t.observacaoConclusao || 'Concluído sem observação adicional.')}</span>
                </div>
                ${t.fotoConclusao ? `
                  <a href="${esc(t.fotoConclusao)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-emerald-300 text-emerald-800 font-bold text-xs hover:bg-emerald-100 flex-shrink-0">
                    <i class="fa-solid fa-camera"></i> Ver Foto de Comprovação
                  </a>
                ` : ''}
              </div>
            ` : ''}
          </div>

          <!-- Ações do Prefeito -->
          <div class="flex items-center gap-1.5 flex-wrap lg:justify-end flex-shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
            ${t.status === 'aguardando_visto' ? `
              <button type="button" onclick="EquipeAdmin.darVistoConclusao('${t.id}')" class="btn-prefeito px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-xs transition">
                <i class="fa-solid fa-check-double"></i> Dar Visto & Encerrar
              </button>
              <button type="button" onclick="EquipeAdmin.devolverTarefa('${t.id}')" class="btn-prefeito px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold text-xs transition" title="Devolver para refazer">
                <i class="fa-solid fa-rotate-left"></i> Refazer
              </button>
            ` : ''}

            ${['pendente', 'em_andamento', 'impedimento'].includes(t.status) ? `
              <button type="button" onclick="EquipeAdmin.alterarPrioridadeRapida('${t.id}')" class="btn-prefeito px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition" title="Alternar Urgente / Alta / Normal">
                <i class="fa-solid fa-arrow-up-wide-short mr-1"></i>Prioridade
              </button>
              <button type="button" onclick="EquipeAdmin.moverOrdem('${t.id}', -1)" class="btn-prefeito w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center text-xs transition" title="Subir na fila">
                <i class="fa-solid fa-chevron-up"></i>
              </button>
              <button type="button" onclick="EquipeAdmin.moverOrdem('${t.id}', 1)" class="btn-prefeito w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center text-xs transition" title="Descer na fila">
                <i class="fa-solid fa-chevron-down"></i>
              </button>
            ` : ''}

            <button type="button" onclick="EquipeAdmin.excluirTarefa('${t.id}')" class="btn-prefeito w-8 h-8 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 flex items-center justify-center text-xs transition" title="Excluir prioridade">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderListaRotinasAdmin(container) {
    let lista = state.rotinas.filter(r =>
      state.funcionarioSelecionadoUid === 'todos' || r.funcionarioUid === state.funcionarioSelecionadoUid
    );

    if (!lista.length) {
      container.innerHTML = `
        <div class="bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <div class="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3 text-xl">
            <i class="fa-solid fa-arrows-rotate"></i>
          </div>
          <h4 class="text-sm font-bold text-slate-800">Nenhuma rotina fixa diária cadastrada</h4>
          <p class="text-xs text-slate-500 mt-1">Cadastre locais fixos (ex: Banheiro Bloco 1, Bebedouro Central, Casa 2) que renovam automaticamente toda manhã no app do funcionário.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = lista.map(r => {
      const cat = CATEGORIAS[r.categoria] || CATEGORIAS.outro;
      const log = state.rotinasLogsHoje.find(l => l.rotinaId === r.id);
      const feito = !!log;

      return `
        <div class="bg-white rounded-2xl border ${feito ? 'border-emerald-300 bg-emerald-50/20' : 'border-slate-200'} p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="space-y-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-bold ${cat.badge}">
                <i class="fa-solid ${cat.icone}"></i>${cat.label}
              </span>
              <span class="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-bold">
                <i class="fa-solid fa-helmet-safety text-amber-500 mr-1"></i>${esc(r.funcionarioNome)}
              </span>
              ${r.turno ? `<span class="px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-bold">${esc(r.turno)}</span>` : ''}
              ${feito
                ? `<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold"><i class="fa-solid fa-check mr-1"></i>Feito Hoje às ${new Date(log.concluidoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>`
                : `<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">Pendente Hoje</span>`}
            </div>
            <h4 class="text-sm font-extrabold text-slate-900">${esc(r.titulo)}</h4>
            <p class="text-xs font-semibold text-indigo-700"><i class="fa-solid fa-location-dot mr-1"></i>${esc(r.itemNome)}</p>
            ${r.instrucoes ? `<p class="text-xs text-slate-500">${esc(r.instrucoes)}</p>` : ''}
            ${feito && log.fotoUrl ? `<a href="${esc(log.fotoUrl)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 underline mt-1"><i class="fa-solid fa-camera"></i>Ver foto enviada hoje</a>` : ''}
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <button type="button" onclick="EquipeAdmin.excluirRotina('${r.id}')" class="btn-prefeito px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 font-bold text-xs transition">
              <i class="fa-solid fa-trash mr-1"></i>Remover
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // ==========================================================================
  // MODAL DE NOVA PRIORIDADE / NOVA ROTINA FIXA
  // ==========================================================================
  async function abrirModalCriar(tipo = 'tarefa') {
    await carregarCatalogoItens();
    state.modalTipo = tipo;
    state.modalCategoria = 'banheiro';

    const funcs = getFuncionariosEquipe();
    const selFunc = document.getElementById('eqModalFuncionarioUid');
    if (selFunc) {
      selFunc.innerHTML = funcs.map(f => `<option value="${f.uid}" ${f.uid === state.funcionarioSelecionadoUid ? 'selected' : ''}>${esc(f.nome)} (${esc(f.cargo || '@' + f.username)})</option>`).join('');
    }

    document.getElementById('eqModalTituloHeader').textContent = tipo === 'rotina'
      ? 'Nova Rotina Fixa Diária'
      : 'Nova Prioridade / Ordem de Serviço';
    document.getElementById('eqModalSubtituloHeader').textContent = tipo === 'rotina'
      ? 'Este item renovará automaticamente toda manhã no App do funcionário.'
      : 'Escolha um item cadastrado no sistema e defina o nível de prioridade.';

    document.getElementById('eqModalBlocoPrioridade').classList.toggle('hidden', tipo === 'rotina');
    document.getElementById('eqModalBlocoTurnoRotina').classList.toggle('hidden', tipo !== 'rotina');

    document.getElementById('eqModalTituloInput').value = '';
    document.getElementById('eqModalInstrucoesInput').value = '';
    document.getElementById('eqModalItemLivreInput').value = '';
    const chkAuto = document.getElementById('eqModalBaixaAuto');
    if (chkAuto) chkAuto.checked = false;

    selecionarCategoriaModal('banheiro');
    document.getElementById('modalNovaPrioridadeEquipe').classList.remove('hidden');
  }

  function selecionarCategoriaModal(cat) {
    state.modalCategoria = cat;
    document.querySelectorAll('.btn-cat-eq-modal').forEach(b => {
      const ativo = b.getAttribute('data-cat') === cat;
      b.className = ativo
        ? 'btn-cat-eq-modal px-3 py-2 rounded-xl text-xs font-extrabold bg-slate-900 text-amber-400 border border-slate-900 shadow-xs transition flex items-center gap-1.5'
        : 'btn-cat-eq-modal px-3 py-2 rounded-xl text-xs font-semibold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition flex items-center gap-1.5';
    });

    const opcoes = obterOpcoesCategoria(cat);
    const wrapSelect = document.getElementById('eqModalItemSelectWrap');
    const wrapLivre = document.getElementById('eqModalItemLivreWrap');
    const sel = document.getElementById('eqModalItemSelect');

    if (cat === 'outro' || opcoes.length === 0) {
      wrapSelect.classList.add('hidden');
      wrapLivre.classList.remove('hidden');
    } else {
      wrapSelect.classList.remove('hidden');
      wrapLivre.classList.add('hidden');
      sel.innerHTML = `<option value="">-- Selecione o item cadastrado (${opcoes.length} disponíveis) --</option>` +
        opcoes.map(o => `<option value="${esc(o.id)}" data-nome="${esc(o.nome)}" data-col="${esc(o.refColecao || '')}" data-desc="${esc(o.extraDesc || '')}">${esc(o.nome)}</option>`).join('');
    }
  }

  function onItemCadastradoChange() {
    const sel = document.getElementById('eqModalItemSelect');
    const opt = sel && sel.options[sel.selectedIndex];
    if (!opt || !opt.value) return;
    const tituloInp = document.getElementById('eqModalTituloInput');
    const instInp = document.getElementById('eqModalInstrucoesInput');
    if (tituloInp && !tituloInp.value.trim()) {
      const prefixos = {
        banheiro: 'Higienização / Conferência',
        alojamento: 'Vistoria / Manutenção no Alojamento',
        casa: 'Atendimento na Casa da Cidade',
        equipamento: 'Manutenção de Equipamento',
        estoque: 'Conferência / Reposição',
        chamado: 'Atender Chamado QR Code',
        vigilancia: 'Verificar Ponto de Vigilância'
      };
      tituloInp.value = prefixos[state.modalCategoria] || 'Executar Serviço';
    }
    if (instInp && !instInp.value.trim() && opt.dataset.desc) {
      instInp.value = opt.dataset.desc;
    }
  }

  async function salvarNovaPrioridadeOuRotina(e) {
    e.preventDefault();
    const db = getDb();
    if (!db) return;

    const funcUid = document.getElementById('eqModalFuncionarioUid')?.value;
    const funcObj = state.usuarios.find(u => u.uid === funcUid);
    if (!funcObj) return toast('Selecione um funcionário válido.', 'warning');

    const titulo = (document.getElementById('eqModalTituloInput')?.value || '').trim();
    const instrucoes = (document.getElementById('eqModalInstrucoesInput')?.value || '').trim();
    if (!titulo) return toast('Informe o que o funcionário precisa fazer.', 'warning');

    let itemId = '';
    let itemNome = '';
    let refColecao = '';

    const sel = document.getElementById('eqModalItemSelect');
    const wrapSelectHidden = document.getElementById('eqModalItemSelectWrap').classList.contains('hidden');
    if (!wrapSelectHidden && sel && sel.value) {
      const opt = sel.options[sel.selectedIndex];
      itemId = sel.value;
      itemNome = opt.dataset.nome || opt.textContent;
      refColecao = opt.dataset.col || '';
    } else {
      itemNome = (document.getElementById('eqModalItemLivreInput')?.value || '').trim() || 'Canteiro Geral';
      itemId = 'livre_' + Date.now();
    }

    const agora = new Date().toISOString();
    const criadoPor = (window.PrefeituraAuth && window.PrefeituraAuth.getPerfilAtual())
      ? window.PrefeituraAuth.getPerfilAtual().nome
      : 'Prefeito';

    try {
      if (state.modalTipo === 'rotina') {
        const turno = document.getElementById('eqModalTurnoSelect')?.value || 'Diário';
        const rotId = `ROT-${Date.now()}`;
        const ordem = state.rotinas.filter(r => r.funcionarioUid === funcUid).length + 1;
        await db.collection('equipe_rotinas').doc(rotId).set({
          id: rotId,
          funcionarioUid: funcUid,
          funcionarioNome: funcObj.nome,
          categoria: state.modalCategoria,
          itemId,
          itemNome,
          refColecao,
          titulo,
          instrucoes,
          turno,
          ordem,
          ativo: true,
          criadoEm: agora,
          criadoPor
        });
        toast(`Rotina diária adicionada para ${funcObj.nome}!`, 'success');
      } else {
        const prioridade = document.getElementById('eqModalPrioridadeSelect')?.value || 'alta';
        const baixaAutomatica = !!document.getElementById('eqModalBaixaAuto')?.checked;
        const tarId = `TAR-${Date.now()}`;
        const ordem = state.tarefas.filter(t => t.funcionarioUid === funcUid && ['pendente', 'em_andamento', 'impedimento'].includes(t.status)).length + 1;
        await db.collection('equipe_tarefas').doc(tarId).set({
          id: tarId,
          funcionarioUid: funcUid,
          funcionarioNome: funcObj.nome,
          categoria: state.modalCategoria,
          itemId,
          itemNome,
          refColecao,
          titulo,
          instrucoes,
          prioridade,
          ordem,
          status: 'pendente',
          baixaAutomatica,
          criadoEm: agora,
          atualizadoEm: agora,
          criadoPor
        });
        toast(`Prioridade enviada em tempo real para ${funcObj.nome}!`, 'success');
      }

      fecharModalCriar();
    } catch (err) {
      toast('Erro ao salvar: ' + err.message, 'error');
    }
  }

  function fecharModalCriar() {
    document.getElementById('modalNovaPrioridadeEquipe')?.classList.add('hidden');
  }

  // ==========================================================================
  // AÇÕES DO PREFEITO SOBRE TAREFAS (VISTO, ORDEM, PRIORIDADE, WHATSAPP)
  // ==========================================================================
  async function darVistoConclusao(id) {
    const db = getDb();
    const t = state.tarefas.find(x => x.id === id);
    if (!db || !t) return;
    const agora = new Date().toISOString();
    const aprovador = (window.PrefeituraAuth && window.PrefeituraAuth.getPerfilAtual())
      ? window.PrefeituraAuth.getPerfilAtual().nome
      : 'Prefeito';

    try {
      await db.collection('equipe_tarefas').doc(id).update({
        status: 'concluido',
        vistoPor: aprovador,
        vistoEm: agora,
        atualizadoEm: agora
      });

      // Sincronização inteligente: se era vinculado a um Chamado QR Code, conclui o chamado também!
      if (t.refColecao === 'chamados_suporte' && t.itemId) {
        await db.collection('chamados_suporte').doc(String(t.itemId)).set({
          status: 'concluido',
          concluido_por: `${t.funcionarioNome} (Visto: ${aprovador})`,
          data_conclusao: agora,
          atualizado_em: agora
        }, { merge: true }).catch(() => {});
      }

      toast('Visto confirmado! Serviço encerrado com sucesso.', 'success');
    } catch (err) {
      toast('Erro ao dar visto: ' + err.message, 'error');
    }
  }

  async function devolverTarefa(id) {
    const db = getDb();
    if (!db) return;
    const motivo = prompt('Motivo para devolver a tarefa ao funcionário (opcional):') || '';
    try {
      await db.collection('equipe_tarefas').doc(id).update({
        status: 'pendente',
        instrucoes: motivo ? `[REFAZER] ${motivo}` : 'Devolvido pelo Prefeito para revisão.',
        atualizadoEm: new Date().toISOString()
      });
      toast('Tarefa devolvida para a fila do funcionário.', 'info');
    } catch (err) {
      toast('Erro ao devolver: ' + err.message, 'error');
    }
  }

  async function alterarPrioridadeRapida(id) {
    const db = getDb();
    const t = state.tarefas.find(x => x.id === id);
    if (!db || !t) return;
    const ciclo = { normal: 'alta', alta: 'urgente', urgente: 'normal' };
    const nova = ciclo[t.prioridade] || 'alta';
    await db.collection('equipe_tarefas').doc(id).update({ prioridade: nova, atualizadoEm: new Date().toISOString() });
    toast(`Prioridade alterada para ${nova.toUpperCase()}.`, 'info');
  }

  async function moverOrdem(id, delta) {
    const db = getDb();
    const t = state.tarefas.find(x => x.id === id);
    if (!db || !t) return;
    const novaOrdem = Math.max(1, Number(t.ordem || 1) + delta);
    await db.collection('equipe_tarefas').doc(id).update({ ordem: novaOrdem, atualizadoEm: new Date().toISOString() });
  }

  async function excluirTarefa(id) {
    if (!confirm('Remover esta prioridade da fila do funcionário?')) return;
    const db = getDb();
    if (!db) return;
    await db.collection('equipe_tarefas').doc(id).delete();
    toast('Prioridade removida.', 'info');
  }

  async function excluirRotina(id) {
    if (!confirm('Remover esta rotina fixa diária?')) return;
    const db = getDb();
    if (!db) return;
    await db.collection('equipe_rotinas').doc(id).delete();
    toast('Rotina fixa removida.', 'info');
  }

  function obterLinkAppEquipe() {
    const base = window.location.href.split('?')[0].split('#')[0];
    if (base.endsWith('index.html')) return base.replace('index.html', 'equipe.html');
    return base.endsWith('/') ? base + 'equipe.html' : base + '/equipe.html';
  }

  function copiarLinkAppEquipe() {
    const link = obterLinkAppEquipe();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(() => toast('Link do App da Equipe copiado! Envie no WhatsApp.', 'success'));
    } else {
      prompt('Copie o link do App da Equipe:', link);
    }
  }

  function enviarWhatsAppFuncionario(uid) {
    const f = state.usuarios.find(u => u.uid === uid);
    if (!f) return;
    const abertas = state.tarefas.filter(t => t.funcionarioUid === uid && ['pendente', 'em_andamento', 'impedimento'].includes(t.status));
    const rotinas = state.rotinas.filter(r => r.funcionarioUid === uid);
    const link = obterLinkAppEquipe();

    let msg = `🏗️ *PREFEITURA DE CANTEIRO — SUAS PRIORIDADES*\n`;
    msg += `Olá, *${f.nome}*!\n\n`;
    if (abertas.length) {
      msg += `🔥 *PRIORIDADES NA FILA (${abertas.length}):*\n`;
      abertas.slice(0, 8).forEach((t, i) => {
        const tag = t.prioridade === 'urgente' ? '🔴 [URGENTE]' : (t.prioridade === 'alta' ? '🟠 [ALTA]' : '🔵 [NORMAL]');
        msg += `${i + 1}. ${tag} ${t.titulo} — _${t.itemNome}_\n`;
      });
      msg += `\n`;
    }
    if (rotinas.length) {
      msg += `🔄 *ROTINA FIXA DE HOJE (${rotinas.length} itens)*\n\n`;
    }
    msg += `📲 *Acesse seu App da Equipe com seu login (@${f.username}):*\n${link}`;

    const fone = String(f.whatsapp || '').replace(/\D/g, '');
    const url = fone
      ? `https://wa.me/${fone.startsWith('55') ? fone : '55' + fone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  }

  // API Pública
  window.EquipeAdmin = {
    initListeners,
    renderPainel,
    selecionarFuncionario(uid) {
      state.funcionarioSelecionadoUid = uid;
      renderPainel();
    },
    setSubAba(aba) {
      state.subAba = aba;
      const bT = document.getElementById('eqAdmSubBtnTarefas');
      const bR = document.getElementById('eqAdmSubBtnRotinas');
      if (bT) bT.className = aba === 'tarefas'
        ? 'px-4 py-2 rounded-xl text-xs font-extrabold bg-slate-900 text-amber-400 shadow-xs transition'
        : 'px-4 py-2 rounded-xl text-xs font-bold bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition';
      if (bR) bR.className = aba === 'rotinas'
        ? 'px-4 py-2 rounded-xl text-xs font-extrabold bg-slate-900 text-amber-400 shadow-xs transition'
        : 'px-4 py-2 rounded-xl text-xs font-bold bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition';
      renderListaPrincipal();
    },
    setFiltroStatus(st) {
      state.filtroStatus = st;
      document.querySelectorAll('.btn-eq-adm-filtro').forEach(b => {
        const ativo = b.getAttribute('data-st') === st;
        b.className = ativo
          ? 'btn-eq-adm-filtro px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 text-slate-950 shadow-xs transition'
          : 'btn-eq-adm-filtro px-3 py-1.5 rounded-xl text-xs font-semibold bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition';
      });
      renderListaPrincipal();
    },
    abrirModalCriar,
    fecharModalCriar,
    selecionarCategoriaModal,
    onItemCadastradoChange,
    salvarNovaPrioridadeOuRotina,
    darVistoConclusao,
    devolverTarefa,
    alterarPrioridadeRapida,
    moverOrdem,
    excluirTarefa,
    excluirRotina,
    copiarLinkAppEquipe,
    enviarWhatsAppFuncionario
  };
})();
