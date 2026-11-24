// ============================================================================
// SISTEMA DE AUTENTICAÇÃO, APROVAÇÃO E PERMISSÕES (RBAC)
// Prefeitura de Canteiro — GEL Engenharia (Obra Taboca 2)
// Firebase Authentication (Usuário Simples) + Firestore Tempo Real
// ============================================================================

(function () {
  'use strict';

  const AUTH_INTERNAL_DOMAIN = 'prefeitura-taboca.gel.local';
  const COLLECTION_USERS = 'usuarios_sistema';
  const DOC_AUTH_CONFIG = 'sistema_auth';

  // Catálogo oficial dos 18 módulos do sistema (alinhado com sidebar e mapaGrupoAba)
  const AUTH_MODULOS = [
    // Grupo 1: Alojamentos & Vagas
    { id: 'dashboard', nome: 'Dashboard Geral', grupo: 'grupo_alojamento', grupoNome: 'Alojamentos & Vagas', icone: 'fa-chart-pie', cor: 'text-amber-500' },
    { id: 'blocos', nome: 'Blocos & Quartos', grupo: 'grupo_alojamento', grupoNome: 'Alojamentos & Vagas', icone: 'fa-border-all', cor: 'text-sky-500' },
    { id: 'alojados', nome: 'Gestão de Alojados', grupo: 'grupo_alojamento', grupoNome: 'Alojamentos & Vagas', icone: 'fa-users-line', cor: 'text-emerald-500' },
    { id: 'moveis', nome: 'Móveis & Vistoria', grupo: 'grupo_alojamento', grupoNome: 'Alojamentos & Vagas', icone: 'fa-bed', cor: 'text-violet-500' },
    { id: 'casas_cidade', nome: 'Casas na Cidade', grupo: 'grupo_alojamento', grupoNome: 'Alojamentos & Vagas', icone: 'fa-house-chimney-user', cor: 'text-indigo-500' },

    // Grupo 2: Operações & Campo
    { id: 'chamados', nome: 'Chamados QR Code', grupo: 'grupo_operacoes', grupoNome: 'Operações & Campo', icone: 'fa-qrcode', cor: 'text-amber-500' },
    { id: 'ronda', nome: 'Ronda do Canteiro', grupo: 'grupo_operacoes', grupoNome: 'Operações & Campo', icone: 'fa-clipboard-check', cor: 'text-teal-500' },
    { id: 'maquina_gelo', nome: 'Fábrica & Máquina de Gelo', grupo: 'grupo_operacoes', grupoNome: 'Operações & Campo', icone: 'fa-cubes', cor: 'text-cyan-500' },
    { id: 'ronda_vigilancia', nome: 'Ronda de Vigilância', grupo: 'grupo_operacoes', grupoNome: 'Operações & Campo', icone: 'fa-shield-halved', cor: 'text-indigo-500' },
    { id: 'portal_alojado', nome: 'App do Alojado (Admin)', grupo: 'grupo_operacoes', grupoNome: 'Operações & Campo', icone: 'fa-id-card-clip', cor: 'text-amber-500' },
    { id: 'sorteio', nome: 'Sorteio Motivacional', grupo: 'grupo_operacoes', grupoNome: 'Operações & Campo', icone: 'fa-trophy', cor: 'text-yellow-500' },

    // Grupo 3: Logística & Custos
    { id: 'estoque', nome: 'Estoque & Almoxarifado', grupo: 'grupo_logistica', grupoNome: 'Logística & Custos', icone: 'fa-boxes-stacked', cor: 'text-teal-500' },
    { id: 'erp_canteiro', nome: 'Rateio & Canteiro ERP', grupo: 'grupo_logistica', grupoNome: 'Logística & Custos', icone: 'fa-file-invoice-dollar', cor: 'text-emerald-500' },

    // Grupo 4: Gestão & Sistema
    { id: 'gestao_cadastros', nome: 'Estrutura & Empresas', grupo: 'grupo_gestao', grupoNome: 'Gestão & Sistema', icone: 'fa-sitemap', cor: 'text-indigo-500' },
    { id: 'relatorios', nome: 'Relatórios & Exportação', grupo: 'grupo_gestao', grupoNome: 'Gestão & Sistema', icone: 'fa-file-excel', cor: 'text-green-600' },
    { id: 'importacao', nome: 'Importar Planilha', grupo: 'grupo_gestao', grupoNome: 'Gestão & Sistema', icone: 'fa-file-import', cor: 'text-orange-500' },
    { id: 'auditoria', nome: 'Auditoria & Logs', grupo: 'grupo_gestao', grupoNome: 'Gestão & Sistema', icone: 'fa-clock-rotate-left', cor: 'text-cyan-500' },
    { id: 'configuracoes', nome: 'Configurações & Firebase', grupo: 'grupo_gestao', grupoNome: 'Gestão & Sistema', icone: 'fa-sliders', cor: 'text-slate-600' }
  ];

  // Frentes de Campo (multi-seleção independente no modal de permissões — 100% compatível com os 18 módulos existentes)
  const AUTH_FRENTES_CAMPO = [
    {
      id: 'maquina_gelo',
      emoji: '🧊',
      titulo: 'Fábrica & Máquina de Gelo',
      subtitulo: 'Produção, freezer e saídas',
      badgeCurto: '🧊 Gelo',
      badgeClass: 'bg-cyan-50 text-cyan-800 border-cyan-200'
    },
    {
      id: 'ronda',
      emoji: '🚽',
      titulo: 'Banheiros & Bebedouros',
      subtitulo: 'Ronda de higienização e checklists',
      badgeCurto: '🚽 Ronda',
      badgeClass: 'bg-teal-50 text-teal-800 border-teal-200'
    },
    {
      id: 'casas_cidade',
      emoji: '🏠',
      titulo: 'Casas na Cidade',
      subtitulo: 'Limpeza, ar-condicionado e enxoval',
      badgeCurto: '🏠 Casas',
      badgeClass: 'bg-indigo-50 text-indigo-800 border-indigo-200'
    },
    {
      id: 'blocos',
      emoji: '🛏️',
      titulo: 'Alojamentos & Quartos',
      subtitulo: 'Limpeza de quartos, ar e enxoval',
      badgeCurto: '🛏️ Quartos',
      badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200'
    }
  ];

  function criarMapaPermissoes(padrao = 'bloqueado', overrides = {}) {
    const map = {};
    AUTH_MODULOS.forEach(m => { map[m.id] = padrao; });
    Object.keys(overrides).forEach(k => { map[k] = overrides[k]; });
    return map;
  }

  // Perfis prontos de 1 clique (totalmente editáveis após aplicar)
  const AUTH_PERFIS_PRONTOS = {
    auxiliar_adm: {
      nome: 'Auxiliar Adm',
      icone: 'fa-user-tie',
      cor: 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100',
      modulos: criarMapaPermissoes('bloqueado', {
        dashboard: 'ver',
        blocos: 'editar',
        alojados: 'editar',
        moveis: 'editar',
        casas_cidade: 'ver',
        chamados: 'editar',
        portal_alojado: 'editar',
        relatorios: 'ver'
      }),
      extras: { podeExcluir: false, podeExportar: true, gerenciarUsuarios: false }
    },
    fiscal_ronda: {
      nome: 'Fiscal de Ronda',
      icone: 'fa-clipboard-check',
      cor: 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100',
      modulos: criarMapaPermissoes('bloqueado', {
        dashboard: 'ver',
        blocos: 'ver',
        alojados: 'ver',
        moveis: 'editar',
        chamados: 'editar',
        ronda: 'editar',
        maquina_gelo: 'editar',
        ronda_vigilancia: 'editar'
      }),
      extras: { podeExcluir: false, podeExportar: false, gerenciarUsuarios: false }
    },
    manutencao: {
      nome: 'Manutenção',
      icone: 'fa-screwdriver-wrench',
      cor: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
      modulos: criarMapaPermissoes('bloqueado', {
        dashboard: 'ver',
        blocos: 'ver',
        moveis: 'editar',
        casas_cidade: 'editar',
        chamados: 'editar',
        estoque: 'ver'
      }),
      extras: { podeExcluir: false, podeExportar: false, gerenciarUsuarios: false }
    },
    almoxarife: {
      nome: 'Almoxarife',
      icone: 'fa-boxes-stacked',
      cor: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
      modulos: criarMapaPermissoes('bloqueado', {
        dashboard: 'ver',
        estoque: 'editar',
        maquina_gelo: 'editar',
        moveis: 'ver',
        relatorios: 'ver'
      }),
      extras: { podeExcluir: false, podeExportar: true, gerenciarUsuarios: false }
    },
    diretoria_leitura: {
      nome: 'Diretoria (Só Ver)',
      icone: 'fa-eye',
      cor: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',
      modulos: criarMapaPermissoes('ver', {
        importacao: 'bloqueado',
        configuracoes: 'bloqueado'
      }),
      extras: { podeExcluir: false, podeExportar: true, gerenciarUsuarios: false }
    },
    co_admin: {
      nome: 'Co-Admin (Tudo)',
      icone: 'fa-crown',
      cor: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100',
      modulos: criarMapaPermissoes('editar'),
      extras: { podeExcluir: true, podeExportar: true, gerenciarUsuarios: true }
    },
    campo_gelo: {
      nome: 'Operador de Gelo (Só Campo)',
      icone: 'fa-cubes',
      cor: 'bg-cyan-50 text-cyan-800 border-cyan-200 hover:bg-cyan-100',
      modulos: criarMapaPermissoes('bloqueado', {
        maquina_gelo: 'editar'
      }),
      extras: { podeExcluir: false, podeExportar: false, gerenciarUsuarios: false }
    },
    campo_ronda: {
      nome: 'Equipe Banheiros/Bebedouros (Só Campo)',
      icone: 'fa-faucet-drip',
      cor: 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100',
      modulos: criarMapaPermissoes('bloqueado', {
        ronda: 'editar'
      }),
      extras: { podeExcluir: false, podeExportar: false, gerenciarUsuarios: false }
    },
    campo_limpeza: {
      nome: 'Equipe Limpeza Casas/Quartos (Só Campo)',
      icone: 'fa-broom',
      cor: 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100',
      modulos: criarMapaPermissoes('bloqueado', {
        casas_cidade: 'editar',
        blocos: 'editar'
      }),
      extras: { podeExcluir: false, podeExportar: false, gerenciarUsuarios: false }
    },
    campo_completo: {
      nome: 'Operador Campo Geral (Gelo+Ronda+Casas)',
      icone: 'fa-helmet-safety',
      cor: 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100',
      modulos: criarMapaPermissoes('bloqueado', {
        maquina_gelo: 'editar',
        ronda: 'editar',
        casas_cidade: 'editar',
        blocos: 'editar'
      }),
      extras: { podeExcluir: false, podeExportar: false, gerenciarUsuarios: false }
    }
  };

  // Estado interno
  const state = {
    initialized: false,
    appBooted: false,
    auth: null,
    db: null,
    firebaseUser: null,
    perfilAtual: null,
    masterConfigurado: null,
    unsubMeuPerfil: null,
    unsubTodosUsuarios: null,
    todosUsuarios: [],
    filtroStatus: 'todos',
    termoBusca: '',
    modalModo: 'editar', // 'criar' | 'aprovar' | 'editar'
    modalEditUid: null,
    modalPermissoesTemp: criarMapaPermissoes('bloqueado'),
    modalExtrasTemp: { podeExcluir: false, podeExportar: false, gerenciarUsuarios: false },
    modalPerfilBaseTemp: 'personalizado',
    observerPermissoes: null,
    observerTimer: null,
    pendentesNotificados: new Set()
  };

  // ==========================================================================
  // UTILITÁRIOS
  // ==========================================================================
  function normalizarUsername(raw) {
    if (!raw) return '';
    let s = String(raw).trim().toLowerCase();
    // Se já digitou e-mail completo com @, mantém apenas a parte local se for nosso domínio
    if (s.endsWith('@' + AUTH_INTERNAL_DOMAIN)) {
      s = s.replace('@' + AUTH_INTERNAL_DOMAIN, '');
    }
    if (s.includes('@')) return s; // permite e-mail real se desejar
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    s = s.replace(/\s+/g, '.');
    s = s.replace(/[^a-z0-9._-]/g, '');
    return s;
  }

  function usernameParaEmail(raw) {
    const norm = normalizarUsername(raw);
    if (!norm) return '';
    if (norm.includes('@')) return norm;
    return `${norm}@${AUTH_INTERNAL_DOMAIN}`;
  }

  function gerarIniciais(nome) {
    if (!nome) return 'US';
    const partes = String(nome).trim().split(/\s+/).filter(Boolean);
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }

  function escaparHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatarDataHoraCurta(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return '—';
    }
  }

  function traduzirErroAuth(err) {
    const code = (err && err.code) ? err.code : '';
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Usuário ou senha incorretos. Verifique e tente novamente.';
      case 'auth/email-already-in-use':
        return 'Este nome de usuário já está cadastrado. Escolha outro login.';
      case 'auth/invalid-email':
        return 'Nome de usuário inválido. Use apenas letras, números, ponto ou traço.';
      case 'auth/weak-password':
        return 'A senha deve ter pelo menos 6 caracteres.';
      case 'auth/too-many-requests':
        return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.';
      case 'auth/network-request-failed':
        return 'Sem conexão com a internet. Verifique o sinal e tente novamente.';
      case 'auth/operation-not-allowed':
        return 'AUTH_NOT_ENABLED';
      case 'auth/requires-recent-login':
        return 'Por segurança, saia e entre novamente antes de trocar sua senha.';
      default:
        return (err && err.message) ? err.message : 'Erro inesperado ao autenticar.';
    }
  }

  function avaliarForcaSenha(senha) {
    if (!senha) return { score: 0, label: '', barClass: 'bg-slate-600', width: '0%' };
    let score = 0;
    if (senha.length >= 6) score++;
    if (senha.length >= 8) score++;
    if (/[A-Z]/.test(senha) && /[a-z]/.test(senha)) score++;
    if (/[0-9]/.test(senha)) score++;
    if (/[^A-Za-z0-9]/.test(senha)) score++;

    if (senha.length < 6) return { score: 1, label: 'Muito curta (mín. 6)', barClass: 'bg-rose-500', width: '20%' };
    if (score <= 2) return { score: 2, label: 'Senha fraca', barClass: 'bg-amber-500', width: '45%' };
    if (score === 3) return { score: 3, label: 'Senha boa', barClass: 'bg-sky-400', width: '75%' };
    return { score: 4, label: 'Senha forte', barClass: 'bg-emerald-400', width: '100%' };
  }

  function notify(msg, tipo = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, tipo);
    } else {
      console.log(`[Auth][${tipo}]`, msg);
    }
  }

  // ==========================================================================
  // CONTROLE VISUAL DO OVERLAY GLASSMORPHISM
  // ==========================================================================
  function isPerfilSomenteCampo(perfilBase) {
    return String(perfilBase || '').startsWith('campo_');
  }

  function mostrarTelaGate(viewName) {
    const gate = document.getElementById('authGateOverlay');
    if (gate) gate.classList.remove('hidden');
    document.body.classList.add('auth-locked');

    const views = ['authViewLoading', 'authViewSetupMaster', 'authViewAuth', 'authViewPending', 'authViewBlocked', 'authViewConfigError', 'authViewSomenteCampo'];
    views.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', id !== viewName);
    });
  }

  function esconderTelaGate() {
    const gate = document.getElementById('authGateOverlay');
    if (gate) gate.classList.add('hidden');
    document.body.classList.remove('auth-locked');
  }

  function exibirErroInline(containerId, mensagem) {
    const box = document.getElementById(containerId);
    if (!box) return;
    if (!mensagem) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    if (mensagem === 'AUTH_NOT_ENABLED') {
      mostrarTelaGate('authViewConfigError');
      return;
    }
    box.classList.remove('hidden');
    box.innerHTML = `<i class="fa-solid fa-circle-exclamation mt-0.5 flex-shrink-0"></i><span>${escaparHtml(mensagem)}</span>`;
  }

  function setBotaoCarregando(btnId, carregando, textoNormal, textoLoad = 'Processando...') {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = carregando;
    if (carregando) {
      btn.dataset.origHtml = btn.innerHTML;
      btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin mr-2"></i>${textoLoad}`;
      btn.classList.add('opacity-80', 'cursor-wait');
    } else {
      btn.innerHTML = textoNormal || btn.dataset.origHtml || btn.innerHTML;
      btn.classList.remove('opacity-80', 'cursor-wait');
    }
  }

  function alternarAbaAuth(aba) {
    const tabEntrar = document.getElementById('authTabBtnEntrar');
    const tabSolicitar = document.getElementById('authTabBtnSolicitar');
    const formEntrar = document.getElementById('formAuthLogin');
    const formSolicitar = document.getElementById('formAuthRegister');
    exibirErroInline('authLoginError', '');
    exibirErroInline('authRegisterError', '');

    if (aba === 'solicitar') {
      if (tabSolicitar) tabSolicitar.className = 'flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-lg shadow-amber-500/20';
      if (tabEntrar) tabEntrar.className = 'flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all text-slate-300 hover:text-white';
      if (formEntrar) formEntrar.classList.add('hidden');
      if (formSolicitar) formSolicitar.classList.remove('hidden');
    } else {
      if (tabEntrar) tabEntrar.className = 'flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-lg shadow-amber-500/20';
      if (tabSolicitar) tabSolicitar.className = 'flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all text-slate-300 hover:text-white';
      if (formSolicitar) formSolicitar.classList.add('hidden');
      if (formEntrar) formEntrar.classList.remove('hidden');
    }
  }

  function toggleVisibilidadeSenha(inputId, btnEl) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    const isPass = inp.type === 'password';
    inp.type = isPass ? 'text' : 'password';
    if (btnEl) {
      const icon = btnEl.querySelector('i');
      if (icon) icon.className = isPass ? 'fa-solid fa-eye-slash text-sm' : 'fa-solid fa-eye text-sm';
    }
  }

  function atualizarMedidorForca(inputId, barId, labelId) {
    const inp = document.getElementById(inputId);
    const bar = document.getElementById(barId);
    const lbl = document.getElementById(labelId);
    if (!inp || !bar || !lbl) return;
    const res = avaliarForcaSenha(inp.value);
    bar.style.width = res.width;
    bar.className = `h-full rounded-full transition-all duration-300 ${res.barClass}`;
    lbl.textContent = res.label;
  }

  // ==========================================================================
  // VERIFICAÇÃO DE MASTER INICIAL
  // ==========================================================================
  async function verificarSeMasterExiste() {
    try {
      const doc = await state.db.collection('configuracoes').doc(DOC_AUTH_CONFIG).get();
      if (doc.exists && doc.data().masterConfigurado) {
        state.masterConfigurado = true;
        return true;
      }
      state.masterConfigurado = false;
      return false;
    } catch (err) {
      console.warn('[Auth] Aviso ao verificar master:', err);
      // Em caso de erro de rede/permissão, cai para tela de login normal
      return true;
    }
  }

  // ==========================================================================
  // AÇÕES DE AUTENTICAÇÃO (SETUP MASTER, LOGIN, SOLICITAR ACESSO, LOGOUT)
  // ==========================================================================
  async function handleSetupMaster(e) {
    if (e) e.preventDefault();
    exibirErroInline('authSetupError', '');

    const nome = (document.getElementById('setupMasterNome')?.value || '').trim();
    const userRaw = (document.getElementById('setupMasterUsername')?.value || '').trim();
    const senha = document.getElementById('setupMasterSenha')?.value || '';
    const confirmar = document.getElementById('setupMasterConfirmar')?.value || '';

    const username = normalizarUsername(userRaw);
    if (nome.length < 3) return exibirErroInline('authSetupError', 'Informe seu nome completo.');
    if (username.length < 3) return exibirErroInline('authSetupError', 'O login deve ter pelo menos 3 caracteres (letras, números, ponto ou traço).');
    if (senha.length < 6) return exibirErroInline('authSetupError', 'A senha deve ter no mínimo 6 caracteres.');
    if (senha !== confirmar) return exibirErroInline('authSetupError', 'As senhas digitadas não coincidem.');

    setBotaoCarregando('btnSubmitSetupMaster', true, null, 'Criando conta Master...');
    try {
      // Revalida para impedir criação duplicada simultânea
      const jaExiste = await verificarSeMasterExiste();
      if (jaExiste) {
        mostrarTelaGate('authViewAuth');
        alternarAbaAuth('entrar');
        exibirErroInline('authLoginError', 'Já existe um Prefeito Master configurado. Faça login ou solicite acesso.');
        return;
      }

      const emailInterno = usernameParaEmail(username);
      await state.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      const cred = await state.auth.createUserWithEmailAndPassword(emailInterno, senha);
      const uid = cred.user.uid;
      const agora = new Date().toISOString();

      const perfilMaster = {
        uid,
        username,
        emailInterno,
        nome,
        cargo: 'Prefeito da Obra (Master)',
        role: 'master',
        status: 'ativo',
        perfilBase: 'master',
        permissoesModulos: criarMapaPermissoes('editar'),
        extras: { podeExcluir: true, podeExportar: true, gerenciarUsuarios: true },
        criadoEm: agora,
        aprovadoPor: nome,
        aprovadoEm: agora,
        ultimoAcesso: agora
      };

      await state.db.collection(COLLECTION_USERS).doc(uid).set(perfilMaster);
      await state.db.collection('configuracoes').doc(DOC_AUTH_CONFIG).set({
        masterConfigurado: true,
        masterUid: uid,
        masterUsername: username,
        criadoEm: agora
      });

      state.masterConfigurado = true;
      notify(`Bem-vindo, ${nome}! Conta Master do Prefeito configurada com sucesso.`, 'success');
    } catch (err) {
      console.error('[Auth] Erro no setup master:', err);
      exibirErroInline('authSetupError', traduzirErroAuth(err));
    } finally {
      setBotaoCarregando('btnSubmitSetupMaster', false, '<i class="fa-solid fa-crown mr-2"></i>Criar Conta Master do Prefeito');
    }
  }

  async function handleLogin(e) {
    if (e) e.preventDefault();
    exibirErroInline('authLoginError', '');

    const userRaw = (document.getElementById('authLoginUsername')?.value || '').trim();
    const senha = document.getElementById('authLoginSenha')?.value || '';
    const lembrar = document.getElementById('authLoginLembrar')?.checked !== false;

    const username = normalizarUsername(userRaw);
    if (!username) return exibirErroInline('authLoginError', 'Digite seu nome de usuário.');
    if (!senha) return exibirErroInline('authLoginError', 'Digite sua senha.');

    setBotaoCarregando('btnSubmitLogin', true, null, 'Entrando...');
    try {
      const persistence = lembrar
        ? firebase.auth.Auth.Persistence.LOCAL
        : firebase.auth.Auth.Persistence.SESSION;
      await state.auth.setPersistence(persistence);

      const emailInterno = usernameParaEmail(username);
      await state.auth.signInWithEmailAndPassword(emailInterno, senha);
      // onAuthStateChanged cuidará do resto automaticamente
    } catch (err) {
      console.error('[Auth] Erro no login:', err);
      exibirErroInline('authLoginError', traduzirErroAuth(err));
    } finally {
      setBotaoCarregando('btnSubmitLogin', false, '<i class="fa-solid fa-right-to-bracket mr-2"></i>Entrar no Painel');
    }
  }

  async function handleSolicitarAcesso(e) {
    if (e) e.preventDefault();
    exibirErroInline('authRegisterError', '');

    const nome = (document.getElementById('authRegNome')?.value || '').trim();
    const cargo = (document.getElementById('authRegCargo')?.value || '').trim();
    const userRaw = (document.getElementById('authRegUsername')?.value || '').trim();
    const senha = document.getElementById('authRegSenha')?.value || '';
    const confirmar = document.getElementById('authRegConfirmar')?.value || '';

    const username = normalizarUsername(userRaw);
    if (nome.length < 3) return exibirErroInline('authRegisterError', 'Informe seu nome completo.');
    if (cargo.length < 2) return exibirErroInline('authRegisterError', 'Informe seu cargo ou setor (ex: Fiscal, Almoxarife, Encarregado).');
    if (username.length < 3) return exibirErroInline('authRegisterError', 'O usuário deve ter no mínimo 3 caracteres (ex: joao.silva).');
    if (senha.length < 6) return exibirErroInline('authRegisterError', 'A senha deve ter no mínimo 6 caracteres.');
    if (senha !== confirmar) return exibirErroInline('authRegisterError', 'As senhas não conferem.');

    setBotaoCarregando('btnSubmitRegister', true, null, 'Enviando solicitação...');
    try {
      const emailInterno = usernameParaEmail(username);
      await state.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      const cred = await state.auth.createUserWithEmailAndPassword(emailInterno, senha);
      const uid = cred.user.uid;
      const agora = new Date().toISOString();

      const novoPerfilPendente = {
        uid,
        username,
        emailInterno,
        nome,
        cargo,
        role: 'operador',
        status: 'pendente',
        perfilBase: 'personalizado',
        permissoesModulos: criarMapaPermissoes('bloqueado'),
        extras: { podeExcluir: false, podeExportar: false, gerenciarUsuarios: false },
        criadoEm: agora,
        aprovadoPor: null,
        aprovadoEm: null,
        ultimoAcesso: agora
      };

      await state.db.collection(COLLECTION_USERS).doc(uid).set(novoPerfilPendente);
      // onAuthStateChanged + onSnapshot exibirão automaticamente a tela de Aguardando Liberação
    } catch (err) {
      console.error('[Auth] Erro ao solicitar acesso:', err);
      exibirErroInline('authRegisterError', traduzirErroAuth(err));
    } finally {
      setBotaoCarregando('btnSubmitRegister', false, '<i class="fa-solid fa-paper-plane mr-2"></i>Enviar Solicitação de Acesso');
    }
  }

  async function logout() {
    try {
      if (state.unsubMeuPerfil) { state.unsubMeuPerfil(); state.unsubMeuPerfil = null; }
      if (state.unsubTodosUsuarios) { state.unsubTodosUsuarios(); state.unsubTodosUsuarios = null; }
      state.perfilAtual = null;
      state.firebaseUser = null;
      state.todosUsuarios = [];
      fecharDropdownUsuario();
      await state.auth.signOut();
      mostrarTelaGate('authViewAuth');
      alternarAbaAuth('entrar');
      const inpPass = document.getElementById('authLoginSenha');
      if (inpPass) inpPass.value = '';
      notify('Você saiu do sistema com segurança.', 'info');
    } catch (err) {
      console.error('[Auth] Erro ao sair:', err);
    }
  }

  // ==========================================================================
  // MONITORAMENTO DE SESSÃO E PERFIL EM TEMPO REAL
  // ==========================================================================
  function escutarPerfilUsuarioLogado(fbUser) {
    if (state.unsubMeuPerfil) {
      state.unsubMeuPerfil();
      state.unsubMeuPerfil = null;
    }

    const docRef = state.db.collection(COLLECTION_USERS).doc(fbUser.uid);

    state.unsubMeuPerfil = docRef.onSnapshot(async (snap) => {
      if (!snap.exists) {
        // Caso o usuário exista no Firebase Auth mas seu documento foi removido pelo Prefeito
        const usernameFallback = (fbUser.email || '').split('@')[0] || 'usuario';
        state.perfilAtual = null;
        preencherTelaBloqueado({
          nome: usernameFallback,
          username: usernameFallback,
          motivo: 'Sua conta foi removida ou ainda não possui cadastro ativo na Prefeitura.'
        });
        mostrarTelaGate('authViewBlocked');
        return;
      }

      const perfil = snap.data();
      perfil.uid = snap.id;
      state.perfilAtual = perfil;

      if (perfil.status === 'pendente') {
        preencherTelaPendente(perfil);
        mostrarTelaGate('authViewPending');
        return;
      }

      if (perfil.status === 'bloqueado' || perfil.status === 'recusado') {
        preencherTelaBloqueado(perfil);
        mostrarTelaGate('authViewBlocked');
        return;
      }

      if (perfil.status === 'ativo') {
        // Atualiza ultimoAcesso silenciosamente (máx 1x por sessão)
        if (!state._ultimoAcessoGravado) {
          state._ultimoAcessoGravado = true;
          docRef.set({ ultimoAcesso: new Date().toISOString() }, { merge: true }).catch(() => {});
        }

        ativarSessaoNoPainel(perfil);
      }
    }, (err) => {
      console.error('[Auth] Erro ao escutar perfil do usuário:', err);
      exibirErroInline('authLoginError', 'Erro ao verificar suas permissões no Firebase. Verifique as regras do Firestore.');
      mostrarTelaGate('authViewAuth');
    });
  }

  function preencherTelaPendente(perfil) {
    const elNome = document.getElementById('pendingUserNome');
    const elLogin = document.getElementById('pendingUserLogin');
    const elCargo = document.getElementById('pendingUserCargo');
    if (elNome) elNome.textContent = perfil.nome || 'Colaborador';
    if (elLogin) elLogin.textContent = '@' + (perfil.username || 'usuario');
    if (elCargo) elCargo.textContent = perfil.cargo || 'Sem cargo informado';
  }

  function preencherTelaBloqueado(perfil) {
    const elNome = document.getElementById('blockedUserNome');
    const elMotivo = document.getElementById('blockedUserMotivo');
    if (elNome) elNome.textContent = perfil.nome || 'Usuário';
    if (elMotivo) {
      if (perfil.motivo) {
        elMotivo.textContent = perfil.motivo;
      } else if (perfil.status === 'recusado') {
        elMotivo.textContent = 'Sua solicitação de acesso não foi aprovada pelo Prefeito da Obra.';
      } else {
        elMotivo.textContent = 'Seu acesso ao sistema foi suspenso temporariamente pela administração da Prefeitura.';
      }
    }
  }

  function preencherTelaSomenteCampo(perfil) {
    const elNome = document.getElementById('somenteCampoUserNome');
    const elLogin = document.getElementById('somenteCampoUserLogin');
    const elCargo = document.getElementById('somenteCampoUserCargo');
    const elBadges = document.getElementById('somenteCampoFrentesBadges');
    if (elNome) elNome.textContent = perfil.nome || 'Colaborador';
    if (elLogin) elLogin.textContent = '@' + (perfil.username || 'usuario');
    if (elCargo) elCargo.textContent = perfil.cargo || 'Equipe de Campo';

    if (elBadges) {
      const perms = perfil.permissoesModulos || {};
      const frentes = [];
      if (perms.maquina_gelo === 'editar') {
        frentes.push('<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/15 text-cyan-200 border border-cyan-400/30 text-[11px] font-bold"><i class="fa-solid fa-cubes"></i>Máquina de Gelo</span>');
      }
      if (perms.ronda === 'editar') {
        frentes.push('<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-500/15 text-teal-200 border border-teal-400/30 text-[11px] font-bold"><i class="fa-solid fa-faucet-drip"></i>Banheiros & Bebedouros</span>');
      }
      if (perms.casas_cidade === 'editar') {
        frentes.push('<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/15 text-indigo-200 border border-indigo-400/30 text-[11px] font-bold"><i class="fa-solid fa-house-chimney-user"></i>Casas na Cidade</span>');
      }
      if (perms.blocos === 'editar') {
        frentes.push('<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-200 border border-emerald-400/30 text-[11px] font-bold"><i class="fa-solid fa-bed"></i>Alojamentos & Quartos</span>');
      }
      elBadges.innerHTML = frentes.length > 0
        ? frentes.join('')
        : '<span class="text-[11px] text-slate-400">Nenhuma frente de campo liberada ainda.</span>';
    }
  }

  function ativarSessaoNoPainel(perfil) {
    // Bloqueia entrada no Painel do Prefeito para perfis marcados como "Somente Apps de Campo"
    if (!isMaster() && isPerfilSomenteCampo(perfil.perfilBase)) {
      if (state.unsubTodosUsuarios) {
        state.unsubTodosUsuarios();
        state.unsubTodosUsuarios = null;
      }
      preencherTelaSomenteCampo(perfil);
      mostrarTelaGate('authViewSomenteCampo');
      return;
    }

    // Atualiza nome global usado nos logs de auditoria do app.js
    if (typeof window !== 'undefined') {
      try {
        // currentUserName e currentUserRole são `let` no escopo global do app.js
        window.PrefeituraAuthUser = perfil;
      } catch {}
    }

    // Atualiza UI do cabeçalho com os dados do usuário real
    atualizarHeaderUsuario(perfil);

    // Libera a tela principal
    esconderTelaGate();

    // Dispara boot principal do app.js uma única vez após login aprovado
    if (!state.appBooted) {
      state.appBooted = true;
      if (typeof window.iniciarAppAposLogin === 'function') {
        window.iniciarAppAposLogin();
      }
      iniciarObserverPermissoesDOM();
    }

    // Inicia listener de todos os usuários se tiver permissão de gestão
    if (canManageUsers()) {
      iniciarListenerTodosUsuarios();
    } else if (state.unsubTodosUsuarios) {
      state.unsubTodosUsuarios();
      state.unsubTodosUsuarios = null;
    }

    // Aplica travas visuais de sidebar, mobile e aba ativa
    aplicarPermissoesInterface();

    // Verifica se a aba ativa atual ainda é permitida; se não, vai para a 1ª liberada
    const abaAtual = (typeof activeTab !== 'undefined' && activeTab) ? activeTab : 'dashboard';
    if (getNivelModulo(abaAtual) === 'bloqueado') {
      const primeira = obterPrimeiraAbaPermitida();
      if (primeira && typeof window.switchTab === 'function') {
        window.switchTab(primeira);
      }
    } else {
      aplicarPermissoesAbaAtiva(abaAtual);
    }
  }

  // ==========================================================================
  // MOTOR DE PERMISSÕES (RBAC)
  // ==========================================================================
  function isMaster() {
    return !!(state.perfilAtual && state.perfilAtual.status === 'ativo' && state.perfilAtual.role === 'master');
  }

  function canManageUsers() {
    if (!state.perfilAtual || state.perfilAtual.status !== 'ativo') return false;
    if (isMaster()) return true;
    return !!(state.perfilAtual.extras && state.perfilAtual.extras.gerenciarUsuarios);
  }

  function canDelete() {
    if (!state.perfilAtual || state.perfilAtual.status !== 'ativo') return false;
    if (isMaster()) return true;
    return !!(state.perfilAtual.extras && state.perfilAtual.extras.podeExcluir);
  }

  function canExport() {
    if (!state.perfilAtual || state.perfilAtual.status !== 'ativo') return false;
    if (isMaster()) return true;
    return !!(state.perfilAtual.extras && state.perfilAtual.extras.podeExportar);
  }

  function getNivelModulo(tabId) {
    if (!state.perfilAtual || state.perfilAtual.status !== 'ativo') return 'bloqueado';
    if (tabId === 'usuarios') {
      return canManageUsers() ? 'editar' : 'bloqueado';
    }
    if (isMaster()) return 'editar';
    const perms = state.perfilAtual.permissoesModulos || {};
    const nivel = perms[tabId];
    if (nivel === 'editar' || nivel === 'ver') return nivel;
    return 'bloqueado';
  }

  function canEditTab(tabId) {
    return getNivelModulo(tabId) === 'editar';
  }

  function obterPrimeiraAbaPermitida() {
    for (const mod of AUTH_MODULOS) {
      if (getNivelModulo(mod.id) !== 'bloqueado') return mod.id;
    }
    if (canManageUsers()) return 'usuarios';
    return null;
  }

  function aplicarPermissoesInterface() {
    if (!state.perfilAtual || state.perfilAtual.status !== 'ativo') return;

    // 1. Sidebar Desktop — esconde botões de abas bloqueadas
    document.querySelectorAll('#sidebar .nav-item[data-tab]').forEach(btn => {
      const tab = btn.getAttribute('data-tab');
      const nivel = getNivelModulo(tab);
      btn.classList.toggle('hidden', nivel === 'bloqueado');

      // Mini tag visual discreta "Só Ver" na sidebar se o usuário só tem leitura naquela aba
      let tagVer = btn.querySelector('.rbac-ver-tag');
      if (nivel === 'ver' && !isMaster()) {
        if (!tagVer) {
          tagVer = document.createElement('span');
          tagVer.className = 'rbac-ver-tag ml-auto text-[9px] px-1.5 py-0.5 rounded bg-sky-950/90 text-sky-300 border border-sky-800/70 font-semibold';
          tagVer.textContent = 'Ver';
          btn.appendChild(tagVer);
        }
      } else if (tagVer) {
        tagVer.remove();
      }
    });

    // 2. Oculta grupos da Sidebar que ficaram 100% vazios
    ['grupo_alojamento', 'grupo_operacoes', 'grupo_logistica', 'grupo_gestao'].forEach(grupoId => {
      const containerItens = document.getElementById(`${grupoId}_itens`);
      const wrapperGrupo = containerItens ? containerItens.parentElement : null;
      if (!containerItens || !wrapperGrupo) return;
      const visiveis = containerItens.querySelectorAll('.nav-item[data-tab]:not(.hidden)').length;
      wrapperGrupo.classList.toggle('hidden', visiveis === 0);
    });

    // 3. Barra inferior Mobile
    document.querySelectorAll('#bottomNavBar .mobile-nav-btn[data-mob-tab]').forEach(btn => {
      const tab = btn.getAttribute('data-mob-tab');
      btn.classList.toggle('hidden', getNivelModulo(tab) === 'bloqueado');
    });

    // 4. Cards do Drawer Mobile "Mais"
    document.querySelectorAll('#drawerMobileMais [data-mob-drawer-tab]').forEach(btn => {
      const tab = btn.getAttribute('data-mob-drawer-tab');
      btn.classList.toggle('hidden', getNivelModulo(tab) === 'bloqueado');
    });

    // 5. Botões globais de exportação Excel no header/drawer
    const podeExp = canExport();
    document.querySelectorAll('.rbac-export-btn').forEach(btn => {
      btn.classList.toggle('hidden', !podeExp);
    });

    // 6. Alerta de manutenção no header (só mostra se puder ver móveis)
    const btnAlertaNav = document.getElementById('btnAlertaManutencaoHeader');
    if (btnAlertaNav) {
      btnAlertaNav.classList.toggle('hidden', getNivelModulo('moveis') === 'bloqueado');
    }
  }

  function aplicarPermissoesAbaAtiva(tabId) {
    if (!state.perfilAtual || state.perfilAtual.status !== 'ativo') return;
    const nivel = getNivelModulo(tabId);
    const podeEditar = (nivel === 'editar');
    const podeExcluir = canDelete();
    const podeExportar = canExport();

    // Sincroniza variáveis globais do app.js para manter compatibilidade total com funções legadas
    if (typeof window.sincronizarEstadoUsuarioApp === 'function') {
      const nomeAudit = state.perfilAtual.cargo
        ? `${state.perfilAtual.nome} (${state.perfilAtual.cargo})`
        : state.perfilAtual.nome;
      window.sincronizarEstadoUsuarioApp(podeEditar ? 'prefeito' : 'consulta', nomeAudit);
    }

    // Atualiza indicador no header e badge da página
    const nivelPill = document.getElementById('headerNivelAbaPill');
    if (nivelPill) {
      if (isMaster()) {
        nivelPill.textContent = 'Master';
        nivelPill.className = 'text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold';
      } else if (podeEditar) {
        nivelPill.textContent = 'Edição';
        nivelPill.className = 'text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold';
      } else {
        nivelPill.textContent = 'Só Ver';
        nivelPill.className = 'text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/40 font-bold';
      }
    }

    // Aplica bloqueio visual nos botões dentro da aba ativa
    const tabEl = document.getElementById(`tab-${tabId}`);
    if (!tabEl) return;

    // Botões marcados como .btn-prefeito
    tabEl.querySelectorAll('.btn-prefeito').forEach(btn => {
      if (podeEditar) {
        btn.style.opacity = '';
        btn.style.pointerEvents = '';
        btn.removeAttribute('disabled');
        btn.classList.remove('rbac-hidden-action');
      } else {
        btn.style.opacity = '0.45';
        btn.style.pointerEvents = 'none';
        btn.setAttribute('disabled', 'true');
        btn.classList.add('rbac-hidden-action');
      }
    });

    // Para operadores em modo "Só Ver", trava botões de mutação inline (editar/novo/salvar/excluir/adicionar) dentro da aba
    if (!isMaster() && tabId !== 'usuarios') {
      const seletoresMutacao = [
        'button[onclick*="Novo"]', 'button[onclick*="Nova"]', 'button[onclick*="Editar"]',
        'button[onclick*="editar"]', 'button[onclick*="Salvar"]', 'button[onclick*="salvar"]',
        'button[onclick*="Adicionar"]', 'button[onclick*="adicionar"]', 'button[onclick*="Registrar"]',
        'button[onclick*="registrar"]', 'button[onclick*="Criar"]', 'button[onclick*="criar"]',
        'button[onclick*="Realocar"]', 'button[onclick*="Desligar"]', 'button[onclick*="Reativar"]',
        'button[onclick*="Marcar"]', 'button[onclick*="Resolver"]', 'button[onclick*="Concluir"]',
        'button[onclick*="Restaurar"]', 'button[onclick*="Sincronizar"]', 'button[onclick*="GerarSnapshot"]',
        'button[type="submit"]'
      ].join(',');

      tabEl.querySelectorAll(seletoresMutacao).forEach(btn => {
        if (btn.closest('#modalMinhaConta') || btn.closest('#modalUsuarioPermissoes')) return;
        if (!podeEditar) {
          btn.style.display = 'none';
          btn.dataset.rbacBlocked = '1';
        } else if (btn.dataset.rbacBlocked === '1') {
          btn.style.display = '';
          delete btn.dataset.rbacBlocked;
        }
      });

      // Botões destrutivos (excluir / deletar / apagar / limpar) respeitam `podeExcluir`
      const seletoresExclusao = [
        'button[onclick*="excluir"]', 'button[onclick*="Excluir"]',
        'button[onclick*="deletar"]', 'button[onclick*="Deletar"]',
        'button[onclick*="remover"]', 'button[onclick*="Remover"]',
        'button[onclick*="apagar"]', 'button[onclick*="Apagar"]',
        'button[onclick*="Limpar"]', 'button[onclick*="limpar"]'
      ].join(',');

      tabEl.querySelectorAll(seletoresExclusao).forEach(btn => {
        if (btn.dataset.rbacIgnore === '1') return;
        // Ignora botões de limpar filtro de busca (não são destrutivos no banco)
        const oc = (btn.getAttribute('onclick') || '').toLowerCase();
        if (oc.includes('filtro') || oc.includes('busca') || oc.includes('pesquisa')) return;

        if (!podeExcluir || !podeEditar) {
          btn.style.display = 'none';
          btn.dataset.rbacDeleteBlocked = '1';
        } else if (btn.dataset.rbacDeleteBlocked === '1') {
          btn.style.display = '';
          delete btn.dataset.rbacDeleteBlocked;
        }
      });

      // Botões de exportação dentro da aba
      tabEl.querySelectorAll('button[onclick*="exportar"], button[onclick*="Exportar"]').forEach(btn => {
        if (!podeExportar) {
          btn.style.display = 'none';
          btn.dataset.rbacExportBlocked = '1';
        } else if (btn.dataset.rbacExportBlocked === '1') {
          btn.style.display = '';
          delete btn.dataset.rbacExportBlocked;
        }
      });
    }
  }

  function iniciarObserverPermissoesDOM() {
    if (state.observerPermissoes) return;
    const mainEl = document.querySelector('main');
    if (!mainEl) return;

    state.observerPermissoes = new MutationObserver(() => {
      if (!state.perfilAtual || isMaster()) return;
      clearTimeout(state.observerTimer);
      state.observerTimer = setTimeout(() => {
        const abaAtual = (typeof activeTab !== 'undefined' && activeTab) ? activeTab : 'dashboard';
        aplicarPermissoesAbaAtiva(abaAtual);
      }, 120);
    });

    state.observerPermissoes.observe(mainEl, { childList: true, subtree: true });
  }

  // ==========================================================================
  // HEADER DO USUÁRIO LOGADO & DROPDOWN
  // ==========================================================================
  function atualizarHeaderUsuario(perfil) {
    const iniciaisEl = document.getElementById('headerUserAvatarIniciais');
    const nomeEl = document.getElementById('headerUserNome');
    const cargoEl = document.getElementById('headerUserCargo');
    const dropNome = document.getElementById('dropdownUserNome');
    const dropLogin = document.getElementById('dropdownUserLogin');
    const dropCargo = document.getElementById('dropdownUserCargo');
    const btnGestaoDrop = document.getElementById('dropdownBtnGerenciarUsuarios');

    const primeiroNome = (perfil.nome || 'Usuário').split(' ')[0];
    if (iniciaisEl) iniciaisEl.textContent = gerarIniciais(perfil.nome);
    if (nomeEl) nomeEl.textContent = primeiroNome;
    if (cargoEl) cargoEl.textContent = perfil.role === 'master' ? 'Prefeito Master' : (perfil.cargo || 'Equipe');

    if (dropNome) dropNome.textContent = perfil.nome || 'Usuário';
    if (dropLogin) dropLogin.textContent = '@' + (perfil.username || 'usuario');
    if (dropCargo) dropCargo.textContent = perfil.role === 'master' ? 'Prefeito Master • Acesso Total' : (perfil.cargo || 'Operador');
    if (btnGestaoDrop) btnGestaoDrop.classList.toggle('hidden', !canManageUsers());
  }

  function toggleDropdownUsuario(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('userProfileDropdown');
    if (menu) menu.classList.toggle('hidden');
  }

  function fecharDropdownUsuario() {
    const menu = document.getElementById('userProfileDropdown');
    if (menu) menu.classList.add('hidden');
  }

  // ==========================================================================
  // GESTÃO DE USUÁRIOS (PAINEL DO PREFEITO / CO-ADMIN)
  // ==========================================================================
  function iniciarListenerTodosUsuarios() {
    if (state.unsubTodosUsuarios) return;

    let primeiraCarga = true;
    state.unsubTodosUsuarios = state.db.collection(COLLECTION_USERS).onSnapshot((snap) => {
      const lista = [];
      snap.forEach(doc => {
        const data = doc.data();
        data.uid = doc.id;
        lista.push(data);
      });

      // Ordenação inteligente: Pendentes primeiro, depois Master, depois Ativos A-Z, depois Bloqueados
      const ordemStatus = { pendente: 0, ativo: 1, bloqueado: 2, recusado: 3 };
      lista.sort((a, b) => {
        if (a.status === 'pendente' && b.status !== 'pendente') return -1;
        if (b.status === 'pendente' && a.status !== 'pendente') return 1;
        if (a.role === 'master' && b.role !== 'master') return -1;
        if (b.role === 'master' && a.role !== 'master') return 1;
        const osA = ordemStatus[a.status] ?? 9;
        const osB = ordemStatus[b.status] ?? 9;
        if (osA !== osB) return osA - osB;
        return (a.nome || '').localeCompare(b.nome || '');
      });

      // Notifica em tempo real quando chega uma nova solicitação pendente
      const pendentes = lista.filter(u => u.status === 'pendente');
      if (!primeiraCarga) {
        pendentes.forEach(u => {
          if (!state.pendentesNotificados.has(u.uid)) {
            state.pendentesNotificados.add(u.uid);
            notify(`Nova solicitação de acesso: ${u.nome} (@${u.username}) aguardando sua liberação!`, 'warning');
          }
        });
      } else {
        pendentes.forEach(u => state.pendentesNotificados.add(u.uid));
        primeiraCarga = false;
      }

      state.todosUsuarios = lista;
      atualizarBadgesPendentes(pendentes.length);

      if (typeof activeTab !== 'undefined' && activeTab === 'usuarios') {
        renderUsuariosGestao();
      }
    }, (err) => {
      console.warn('[Auth] Erro ao escutar lista de usuários:', err);
    });
  }

  function atualizarBadgesPendentes(qtd) {
    const badges = [
      document.getElementById('sideCountUsuariosPendentes'),
      document.getElementById('headerBadgeUsuariosPendentes'),
      document.getElementById('drawerBadgeUsuariosPendentes')
    ];
    badges.forEach(el => {
      if (!el) return;
      if (qtd > 0) {
        el.textContent = qtd === 1 && el.id === 'drawerBadgeUsuariosPendentes' ? '1 pendente'
          : (el.id === 'drawerBadgeUsuariosPendentes' ? `${qtd} pendentes` : String(qtd));
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });
  }

  function setFiltroUsuarios(status) {
    state.filtroStatus = status;
    document.querySelectorAll('.btn-filtro-usuario').forEach(btn => {
      const ativo = btn.getAttribute('data-status') === status;
      btn.className = ativo
        ? 'btn-filtro-usuario px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-900 text-white shadow-xs transition'
        : 'btn-filtro-usuario px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition';
    });
    renderUsuariosGestao();
  }

  function setBuscaUsuarios(val) {
    state.termoBusca = (val || '').trim().toLowerCase();
    renderUsuariosGestao();
  }

  function contarPermissoesResumo(usuario) {
    if (usuario.role === 'master') return { editar: AUTH_MODULOS.length, ver: 0 };
    const perms = usuario.permissoesModulos || {};
    let editar = 0, ver = 0;
    AUTH_MODULOS.forEach(m => {
      if (perms[m.id] === 'editar') editar++;
      else if (perms[m.id] === 'ver') ver++;
    });
    return { editar, ver };
  }

  function renderUsuariosGestao() {
    if (!canManageUsers()) return;

    const total = state.todosUsuarios.length;
    const pendentes = state.todosUsuarios.filter(u => u.status === 'pendente');
    const ativos = state.todosUsuarios.filter(u => u.status === 'ativo');
    const bloqueados = state.todosUsuarios.filter(u => u.status === 'bloqueado' || u.status === 'recusado');

    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
    setTxt('kpiUsersTotal', total);
    setTxt('kpiUsersPendentes', pendentes.length);
    setTxt('kpiUsersAtivos', ativos.length);
    setTxt('kpiUsersBloqueados', bloqueados.length);

    // Banner de alerta se houver pendentes
    const bannerPend = document.getElementById('bannerUsuariosPendentes');
    const textoPend = document.getElementById('bannerUsuariosPendentesTexto');
    if (bannerPend) {
      bannerPend.classList.toggle('hidden', pendentes.length === 0);
      if (textoPend && pendentes.length > 0) {
        textoPend.textContent = pendentes.length === 1
          ? `1 colaborador (${pendentes[0].nome}) está aguardando sua aprovação para entrar no sistema.`
          : `${pendentes.length} colaboradores estão aguardando sua liberação para acessar o sistema.`;
      }
    }

    // Filtra lista
    let filtrados = state.todosUsuarios.filter(u => {
      if (state.filtroStatus === 'pendente') return u.status === 'pendente';
      if (state.filtroStatus === 'ativo') return u.status === 'ativo';
      if (state.filtroStatus === 'bloqueado') return u.status === 'bloqueado' || u.status === 'recusado';
      return true;
    });

    if (state.termoBusca) {
      filtrados = filtrados.filter(u =>
        (u.nome || '').toLowerCase().includes(state.termoBusca) ||
        (u.username || '').toLowerCase().includes(state.termoBusca) ||
        (u.cargo || '').toLowerCase().includes(state.termoBusca)
      );
    }

    const container = document.getElementById('listaUsuariosGestaoContainer');
    if (!container) return;

    if (filtrados.length === 0) {
      container.innerHTML = `
        <div class="bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <div class="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3 text-xl">
            <i class="fa-solid fa-users-slash"></i>
          </div>
          <h4 class="text-sm font-bold text-slate-800">Nenhum usuário encontrado neste filtro</h4>
          <p class="text-xs text-slate-500 mt-1">Altere o filtro acima ou clique em "Cadastrar Novo Usuário" para adicionar alguém da equipe.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtrados.map(u => {
      const ehMaster = u.role === 'master';
      const ehEu = state.perfilAtual && u.uid === state.perfilAtual.uid;
      const resumo = contarPermissoesResumo(u);

      let statusBadge = '';
      let cardBorder = 'border-slate-200';
      if (u.status === 'pendente') {
        statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300"><span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>Aguardando Liberação</span>`;
        cardBorder = 'border-amber-300 ring-1 ring-amber-200/70 bg-amber-50/20';
      } else if (u.status === 'ativo') {
        statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200"><i class="fa-solid fa-circle-check text-[10px]"></i>Ativo</span>`;
      } else if (u.status === 'recusado') {
        statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200"><i class="fa-solid fa-ban text-[10px]"></i>Recusado</span>`;
      } else {
        statusBadge = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-200 text-slate-700 border border-slate-300"><i class="fa-solid fa-lock text-[10px]"></i>Bloqueado</span>`;
      }

      const roleBadge = ehMaster
        ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 uppercase tracking-wide"><i class="fa-solid fa-crown"></i> Prefeito Master</span>`
        : (u.extras && u.extras.gerenciarUsuarios
          ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200 uppercase">Co-Admin</span>`
          : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">Equipe</span>`);

      const campoBadge = (!ehMaster && isPerfilSomenteCampo(u.perfilBase))
        ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-teal-100 text-teal-800 border border-teal-200 uppercase"><i class="fa-solid fa-helmet-safety"></i> Somente Campo</span>`
        : '';

      const permsU = u.permissoesModulos || {};
      const frentesBadgesHtml = AUTH_FRENTES_CAMPO
        .filter(f => ehMaster || permsU[f.id] === 'editar')
        .map(f => `<span class="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg border ${f.badgeClass}">${f.badgeCurto}</span>`)
        .join('');

      const avatarBg = ehMaster
        ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950'
        : (u.status === 'pendente'
          ? 'bg-gradient-to-br from-amber-100 to-orange-200 text-amber-900'
          : (u.status === 'ativo' ? 'bg-gradient-to-br from-slate-800 to-slate-900 text-white' : 'bg-slate-200 text-slate-500'));

      let botoesAcao = '';
      if (ehMaster) {
        botoesAcao = `<span class="text-[11px] text-slate-400 font-medium italic px-2">Conta principal protegida</span>`;
      } else if (u.status === 'pendente') {
        botoesAcao = `
          <button type="button" onclick="PrefeituraAuth.abrirModalUsuario('aprovar', '${u.uid}')" class="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition active:scale-95">
            <i class="fa-solid fa-check-double"></i> Aprovar & Definir Permissões
          </button>
          <button type="button" onclick="PrefeituraAuth.alterarStatusUsuario('${u.uid}', 'recusado')" class="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs flex items-center gap-1.5 transition">
            <i class="fa-solid fa-xmark"></i> Recusar
          </button>
        `;
      } else if (u.status === 'ativo') {
        botoesAcao = `
          <button type="button" onclick="PrefeituraAuth.abrirModalUsuario('editar', '${u.uid}')" class="px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold text-xs flex items-center gap-1.5 transition">
            <i class="fa-solid fa-sliders"></i> Permissões
          </button>
          ${!ehEu ? `
          <button type="button" onclick="PrefeituraAuth.alterarStatusUsuario('${u.uid}', 'bloqueado')" class="px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold text-xs flex items-center gap-1.5 transition" title="Suspender acesso imediatamente">
            <i class="fa-solid fa-ban"></i> Bloquear
          </button>` : ''}
        `;
      } else {
        botoesAcao = `
          <button type="button" onclick="PrefeituraAuth.abrirModalUsuario('aprovar', '${u.uid}')" class="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-xs flex items-center gap-1.5 transition">
            <i class="fa-solid fa-unlock"></i> Reativar & Permissões
          </button>
          <button type="button" onclick="PrefeituraAuth.excluirRegistroUsuario('${u.uid}')" class="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs flex items-center gap-1.5 transition" title="Remover usuário da lista">
            <i class="fa-solid fa-trash"></i>
          </button>
        `;
      }

      return `
        <div class="bg-white rounded-2xl border ${cardBorder} p-4 sm:p-5 shadow-xs hover:shadow-md transition flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div class="flex items-start gap-3.5 min-w-0">
            <div class="w-12 h-12 rounded-2xl ${avatarBg} flex items-center justify-center font-extrabold text-base flex-shrink-0 shadow-xs">
              ${gerarIniciais(u.nome)}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <h4 class="font-bold text-slate-900 text-sm sm:text-base truncate">${escaparHtml(u.nome)}</h4>
                ${ehEu ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-bold">Você</span>' : ''}
                ${roleBadge}
                ${campoBadge}
                ${statusBadge}
              </div>
              <div class="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-slate-500 mt-1">
                <span class="font-mono font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">@${escaparHtml(u.username)}</span>
                <span><i class="fa-solid fa-briefcase text-slate-400 mr-1"></i>${escaparHtml(u.cargo || 'Sem cargo')}</span>
                <span><i class="fa-regular fa-clock text-slate-400 mr-1"></i>Último acesso: ${formatarDataHoraCurta(u.ultimoAcesso)}</span>
              </div>
              ${u.status !== 'pendente' ? `
                <div class="flex items-center gap-2 flex-wrap mt-2.5">
                  <span class="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <i class="fa-solid fa-pen-to-square mr-1"></i>${resumo.editar} módulo(s) Editar
                  </span>
                  <span class="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-sky-50 text-sky-700 border border-sky-200">
                    <i class="fa-solid fa-eye mr-1"></i>${resumo.ver} módulo(s) Só Ver
                  </span>
                  ${u.extras && u.extras.podeExcluir ? '<span class="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200"><i class="fa-solid fa-trash mr-1"></i>Pode Excluir</span>' : ''}
                  ${u.extras && u.extras.podeExportar ? '<span class="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-green-50 text-green-700 border border-green-200"><i class="fa-solid fa-file-excel mr-1"></i>Exporta Excel</span>' : ''}
                </div>
                ${frentesBadgesHtml ? `
                  <div class="flex items-center gap-1.5 flex-wrap mt-2">
                    <span class="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mr-0.5">Frentes:</span>
                    ${frentesBadgesHtml}
                  </div>
                ` : ''}
              ` : `
                <p class="text-[11px] text-amber-800 mt-2 font-medium">
                  <i class="fa-solid fa-circle-info mr-1"></i>Solicitou acesso em ${formatarDataHoraCurta(u.criadoEm)}. Bloqueado até você aprovar e liberar módulos.
                </p>
              `}
            </div>
          </div>
          <div class="flex items-center gap-2 flex-wrap lg:justify-end flex-shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
            ${botoesAcao}
          </div>
        </div>
      `;
    }).join('');
  }

  // ==========================================================================
  // MODAL DE CRIAR / APROVAR / EDITAR PERMISSÕES DE USUÁRIO
  // ==========================================================================
  function abrirModalUsuario(modo, uid = null) {
    if (!canManageUsers()) {
      notify('Apenas o Prefeito Master ou Co-Admin pode gerenciar usuários.', 'warning');
      return;
    }

    state.modalModo = modo;
    state.modalEditUid = uid;

    const titulo = document.getElementById('modalUsuarioPermTitulo');
    const subtitulo = document.getElementById('modalUsuarioPermSubtitulo');
    const btnSalvar = document.getElementById('btnSalvarUsuarioPermissoes');
    const blocoCriar = document.getElementById('modalUsuarioCamposCriar');
    const blocoResumo = document.getElementById('modalUsuarioResumoExistente');
    const erroBox = document.getElementById('modalUsuarioPermErro');
    if (erroBox) { erroBox.classList.add('hidden'); erroBox.textContent = ''; }

    if (modo === 'criar') {
      if (titulo) titulo.textContent = 'Cadastrar Novo Usuário da Equipe';
      if (subtitulo) subtitulo.textContent = 'Crie o login, defina a senha inicial e escolha exatamente o que esta pessoa pode acessar.';
      if (btnSalvar) btnSalvar.innerHTML = '<i class="fa-solid fa-user-plus mr-1.5"></i>Criar Conta & Liberar Acesso';
      if (blocoCriar) blocoCriar.classList.remove('hidden');
      if (blocoResumo) blocoResumo.classList.add('hidden');

      ['novoUserNome', 'novoUserCargo', 'novoUserUsername', 'novoUserSenha'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });

      // Padrão inicial útil: Auxiliar Adm
      aplicarPerfilProntoModal('auxiliar_adm', false);
    } else {
      const usuario = state.todosUsuarios.find(u => u.uid === uid);
      if (!usuario) return;

      if (blocoCriar) blocoCriar.classList.add('hidden');
      if (blocoResumo) blocoResumo.classList.remove('hidden');

      const elResNome = document.getElementById('editUserNomeInput');
      const elResCargo = document.getElementById('editUserCargoInput');
      const elResLogin = document.getElementById('editUserLoginBadge');
      if (elResNome) elResNome.value = usuario.nome || '';
      if (elResCargo) elResCargo.value = usuario.cargo || '';
      if (elResLogin) elResLogin.textContent = '@' + (usuario.username || 'usuario');

      if (modo === 'aprovar') {
        if (titulo) titulo.textContent = 'Aprovar Solicitação & Liberar Permissões';
        if (subtitulo) subtitulo.textContent = 'Escolha um perfil pronto ou personalize módulo a módulo antes de liberar o acesso.';
        if (btnSalvar) btnSalvar.innerHTML = '<i class="fa-solid fa-check-double mr-1.5"></i>Aprovar & Liberar Agora';

        // Se ainda não tinha nada liberado (pendente novo), pré-seleciona "Diretoria (Só Ver)" ou "Fiscal de Ronda" apenas se vazio
        const jaTemAlgo = Object.values(usuario.permissoesModulos || {}).some(v => v === 'ver' || v === 'editar');
        if (jaTemAlgo) {
          state.modalPermissoesTemp = criarMapaPermissoes('bloqueado', usuario.permissoesModulos || {});
          state.modalExtrasTemp = {
            podeExcluir: !!(usuario.extras && usuario.extras.podeExcluir),
            podeExportar: !!(usuario.extras && usuario.extras.podeExportar),
            gerenciarUsuarios: !!(usuario.extras && usuario.extras.gerenciarUsuarios)
          };
          state.modalPerfilBaseTemp = usuario.perfilBase || 'personalizado';
        } else if (isPerfilSomenteCampo(usuario.perfilBase)) {
          aplicarPerfilProntoModal('campo_completo', false);
        } else {
          aplicarPerfilProntoModal('fiscal_ronda', false);
        }
      } else {
        if (titulo) titulo.textContent = 'Editar Permissões do Usuário';
        if (subtitulo) subtitulo.textContent = 'As alterações entram em vigor em tempo real na tela do usuário.';
        if (btnSalvar) btnSalvar.innerHTML = '<i class="fa-solid fa-floppy-disk mr-1.5"></i>Salvar Permissões';

        state.modalPermissoesTemp = criarMapaPermissoes('bloqueado', usuario.permissoesModulos || {});
        state.modalExtrasTemp = {
          podeExcluir: !!(usuario.extras && usuario.extras.podeExcluir),
          podeExportar: !!(usuario.extras && usuario.extras.podeExportar),
          gerenciarUsuarios: !!(usuario.extras && usuario.extras.gerenciarUsuarios)
        };
        state.modalPerfilBaseTemp = usuario.perfilBase || 'personalizado';
      }
    }

    renderFrentesCampoModal();
    renderPresetsModal();
    renderMatrizModulosModal();
    sincronizarCheckboxesExtrasModal();

    const modal = document.getElementById('modalUsuarioPermissoes');
    if (modal) modal.classList.remove('hidden');
  }

  function renderFrentesCampoModal() {
    const container = document.getElementById('modalFrentesCampoContainer');
    const contador = document.getElementById('modalFrentesCampoContador');
    const selecionadas = AUTH_FRENTES_CAMPO.filter(f => state.modalPermissoesTemp[f.id] === 'editar').length;

    if (contador) {
      contador.textContent = selecionadas === 1 ? '1 selecionada' : `${selecionadas} selecionadas`;
      contador.className = selecionadas > 0
        ? 'text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300'
        : 'text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200';
    }

    if (!container) return;

    container.innerHTML = AUTH_FRENTES_CAMPO.map(f => {
      const nivel = state.modalPermissoesTemp[f.id] || 'bloqueado';
      const ativo = nivel === 'editar';
      const soVer = nivel === 'ver';
      return `
        <button type="button" onclick="PrefeituraAuth.toggleFrenteCampoModal('${f.id}')" aria-pressed="${ativo ? 'true' : 'false'}" class="w-full text-left p-3.5 rounded-xl border-2 transition-all flex items-center gap-3 active:scale-[0.99] ${ativo ? 'border-emerald-500 bg-emerald-50/90 ring-2 ring-emerald-500/20 shadow-xs' : 'border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50/30'}">
          <div class="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition ${ativo ? 'bg-emerald-600 text-white shadow-xs' : 'border-2 border-slate-300 bg-white text-transparent'}">
            <i class="fa-solid fa-check text-xs"></i>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs sm:text-sm font-extrabold ${ativo ? 'text-emerald-950' : 'text-slate-800'} truncate">${f.emoji} ${f.titulo}</span>
              ${ativo
                ? '<span class="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded-md bg-emerald-600 text-white flex-shrink-0">Liberada</span>'
                : (soVer ? '<span class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-700 border border-sky-200 flex-shrink-0">Só Ver</span>' : '')}
            </div>
            <span class="block text-[11px] ${ativo ? 'text-emerald-800/80' : 'text-slate-500'} truncate mt-0.5">${f.subtitulo}</span>
          </div>
        </button>
      `;
    }).join('');
  }

  function toggleFrenteCampoModal(modId) {
    if (!AUTH_FRENTES_CAMPO.some(f => f.id === modId)) return;
    const nivelAtual = state.modalPermissoesTemp[modId];
    state.modalPermissoesTemp[modId] = (nivelAtual === 'editar') ? 'bloqueado' : 'editar';

    const chkCampo = document.getElementById('chkPermSomenteCampo');
    const somenteCampo = chkCampo ? chkCampo.checked : isPerfilSomenteCampo(state.modalPerfilBaseTemp);
    state.modalPerfilBaseTemp = somenteCampo ? 'campo_personalizado' : 'personalizado';

    renderFrentesCampoModal();
    renderPresetsModal();
    renderMatrizModulosModal();
  }

  function renderPresetsModal() {
    const container = document.getElementById('modalPerfisProntosContainer');
    if (!container) return;
    const entries = Object.entries(AUTH_PERFIS_PRONTOS);
    const adminEntries = entries.filter(([key]) => !isPerfilSomenteCampo(key));
    const campoEntries = entries.filter(([key]) => isPerfilSomenteCampo(key));

    const renderBtn = ([key, p]) => {
      const ativo = state.modalPerfilBaseTemp === key;
      return `
        <button type="button" onclick="PrefeituraAuth.aplicarPerfilProntoModal('${key}', true)" class="px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition ${p.cor} ${ativo ? 'ring-2 ring-slate-900 shadow-sm' : ''}">
          <i class="fa-solid ${p.icone}"></i>
          <span>${p.nome}</span>
        </button>
      `;
    };

    container.innerHTML = `
      ${adminEntries.map(renderBtn).join('')}
      <div class="w-full pt-2 mt-1 border-t border-slate-100 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-teal-700">
        <i class="fa-solid fa-helmet-safety"></i>
        <span>Perfis de Campo (Apenas App do Funcionário — bloqueia entrada no Painel)</span>
      </div>
      ${campoEntries.map(renderBtn).join('')}
    `;
  }

  function aplicarPerfilProntoModal(perfilKey, reRender = true) {
    const preset = AUTH_PERFIS_PRONTOS[perfilKey];
    if (!preset) return;
    state.modalPerfilBaseTemp = perfilKey;
    state.modalPermissoesTemp = { ...preset.modulos };
    state.modalExtrasTemp = { ...preset.extras };
    if (reRender) {
      renderFrentesCampoModal();
      renderPresetsModal();
      renderMatrizModulosModal();
      sincronizarCheckboxesExtrasModal();
    }
  }

  function setPermissaoModuloModal(modId, nivel) {
    state.modalPermissoesTemp[modId] = nivel;
    const chkCampo = document.getElementById('chkPermSomenteCampo');
    const somenteCampo = chkCampo ? chkCampo.checked : isPerfilSomenteCampo(state.modalPerfilBaseTemp);
    state.modalPerfilBaseTemp = somenteCampo ? 'campo_personalizado' : 'personalizado';
    renderFrentesCampoModal();
    renderPresetsModal();
    renderMatrizModulosModal();
  }

  function setPermissaoGrupoModal(grupoId, nivel) {
    AUTH_MODULOS.filter(m => m.grupo === grupoId).forEach(m => {
      state.modalPermissoesTemp[m.id] = nivel;
    });
    const chkCampo = document.getElementById('chkPermSomenteCampo');
    const somenteCampo = chkCampo ? chkCampo.checked : isPerfilSomenteCampo(state.modalPerfilBaseTemp);
    state.modalPerfilBaseTemp = somenteCampo ? 'campo_personalizado' : 'personalizado';
    renderFrentesCampoModal();
    renderPresetsModal();
    renderMatrizModulosModal();
  }

  function toggleSomenteCampoModal(checked) {
    if (checked) {
      if (!isPerfilSomenteCampo(state.modalPerfilBaseTemp)) {
        state.modalPerfilBaseTemp = 'campo_personalizado';
      }
    } else if (isPerfilSomenteCampo(state.modalPerfilBaseTemp)) {
      const semPrefixo = String(state.modalPerfilBaseTemp).replace(/^campo_/, '');
      state.modalPerfilBaseTemp = (AUTH_PERFIS_PRONTOS[semPrefixo] && !isPerfilSomenteCampo(semPrefixo))
        ? semPrefixo
        : 'personalizado';
    }
    renderPresetsModal();
  }

  function sincronizarCheckboxesExtrasModal() {
    const cExc = document.getElementById('chkPermPodeExcluir');
    const cExp = document.getElementById('chkPermPodeExportar');
    const cUsu = document.getElementById('chkPermGerenciarUsuarios');
    const cCampo = document.getElementById('chkPermSomenteCampo');
    if (cExc) cExc.checked = !!state.modalExtrasTemp.podeExcluir;
    if (cExp) cExp.checked = !!state.modalExtrasTemp.podeExportar;
    if (cUsu) cUsu.checked = !!state.modalExtrasTemp.gerenciarUsuarios;
    if (cCampo) cCampo.checked = isPerfilSomenteCampo(state.modalPerfilBaseTemp);
  }

  function renderMatrizModulosModal() {
    const container = document.getElementById('modalMatrizModulosContainer');
    if (!container) return;

    const grupos = [
      { id: 'grupo_alojamento', nome: 'Alojamentos & Vagas', icone: 'fa-hotel', cor: 'text-amber-600' },
      { id: 'grupo_operacoes', nome: 'Operações & Campo', icone: 'fa-shield-halved', cor: 'text-indigo-600' },
      { id: 'grupo_logistica', nome: 'Logística & Custos', icone: 'fa-boxes-stacked', cor: 'text-teal-600' },
      { id: 'grupo_gestao', nome: 'Gestão & Sistema', icone: 'fa-sliders', cor: 'text-slate-700' }
    ];

    container.innerHTML = grupos.map(g => {
      const mods = AUTH_MODULOS.filter(m => m.grupo === g.id);
      return `
        <div class="rounded-2xl border border-slate-200 overflow-hidden bg-white">
          <div class="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2 font-bold text-xs text-slate-800 uppercase tracking-wider">
              <i class="fa-solid ${g.icone} ${g.cor}"></i>
              <span>${g.nome}</span>
            </div>
            <div class="flex items-center gap-1 text-[10px]">
              <span class="text-slate-400 mr-1 hidden sm:inline">Grupo todo:</span>
              <button type="button" onclick="PrefeituraAuth.setPermissaoGrupoModal('${g.id}', 'bloqueado')" class="px-2 py-0.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold transition">Bloquear</button>
              <button type="button" onclick="PrefeituraAuth.setPermissaoGrupoModal('${g.id}', 'ver')" class="px-2 py-0.5 rounded bg-sky-100 hover:bg-sky-200 text-sky-800 font-bold transition">Só Ver</button>
              <button type="button" onclick="PrefeituraAuth.setPermissaoGrupoModal('${g.id}', 'editar')" class="px-2 py-0.5 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-bold transition">Editar</button>
            </div>
          </div>
          <div class="divide-y divide-slate-100">
            ${mods.map(m => {
              const nivel = state.modalPermissoesTemp[m.id] || 'bloqueado';
              return `
                <div class="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/70 transition">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <i class="fa-solid ${m.icone} ${m.cor} w-4 text-center text-sm flex-shrink-0"></i>
                    <span class="text-xs sm:text-sm font-semibold text-slate-800 truncate">${m.nome}</span>
                  </div>
                  <div class="inline-flex rounded-xl bg-slate-100 p-0.5 border border-slate-200 flex-shrink-0 self-start sm:self-auto">
                    <button type="button" onclick="PrefeituraAuth.setPermissaoModuloModal('${m.id}', 'bloqueado')" class="px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${nivel === 'bloqueado' ? 'bg-slate-800 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'}">
                      <i class="fa-solid fa-lock mr-1 text-[10px]"></i>Bloqueado
                    </button>
                    <button type="button" onclick="PrefeituraAuth.setPermissaoModuloModal('${m.id}', 'ver')" class="px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${nivel === 'ver' ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'}">
                      <i class="fa-solid fa-eye mr-1 text-[10px]"></i>Só Ver
                    </button>
                    <button type="button" onclick="PrefeituraAuth.setPermissaoModuloModal('${m.id}', 'editar')" class="px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${nivel === 'editar' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'}">
                      <i class="fa-solid fa-pen mr-1 text-[10px]"></i>Editar
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  async function salvarModalUsuarioPermissoes(e) {
    if (e) e.preventDefault();
    const erroBox = document.getElementById('modalUsuarioPermErro');
    const mostrarErro = (msg) => {
      if (erroBox) {
        erroBox.textContent = msg;
        erroBox.classList.remove('hidden');
      }
    };
    if (erroBox) erroBox.classList.add('hidden');

    const extras = {
      podeExcluir: !!document.getElementById('chkPermPodeExcluir')?.checked,
      podeExportar: !!document.getElementById('chkPermPodeExportar')?.checked,
      gerenciarUsuarios: !!document.getElementById('chkPermGerenciarUsuarios')?.checked
    };

    const somenteCampo = !!document.getElementById('chkPermSomenteCampo')?.checked;
    let perfilBaseFinal = String(state.modalPerfilBaseTemp || 'personalizado').trim() || 'personalizado';
    if (somenteCampo) {
      if (!isPerfilSomenteCampo(perfilBaseFinal)) {
        perfilBaseFinal = 'campo_personalizado';
      }
    } else if (isPerfilSomenteCampo(perfilBaseFinal)) {
      const semPrefixo = perfilBaseFinal.replace(/^campo_/, '');
      perfilBaseFinal = (AUTH_PERFIS_PRONTOS[semPrefixo] && !isPerfilSomenteCampo(semPrefixo))
        ? semPrefixo
        : 'personalizado';
    }
    state.modalPerfilBaseTemp = perfilBaseFinal;

    const temAlgumModulo = Object.values(state.modalPermissoesTemp).some(v => v === 'ver' || v === 'editar') || extras.gerenciarUsuarios;
    if (!temAlgumModulo) {
      return mostrarErro('Libere pelo menos 1 módulo (Só Ver ou Editar) para que o usuário consiga entrar no sistema.');
    }

    const agora = new Date().toISOString();
    const nomeAprovador = state.perfilAtual ? state.perfilAtual.nome : 'Prefeito';

    if (state.modalModo === 'criar') {
      const nome = (document.getElementById('novoUserNome')?.value || '').trim();
      const cargo = (document.getElementById('novoUserCargo')?.value || '').trim();
      const userRaw = (document.getElementById('novoUserUsername')?.value || '').trim();
      const senha = document.getElementById('novoUserSenha')?.value || '';
      const username = normalizarUsername(userRaw);

      if (nome.length < 3) return mostrarErro('Informe o nome completo do colaborador.');
      if (cargo.length < 2) return mostrarErro('Informe o cargo ou setor.');
      if (username.length < 3) return mostrarErro('O login precisa ter no mínimo 3 caracteres (ex: maria.adm).');
      if (senha.length < 6) return mostrarErro('A senha inicial precisa ter no mínimo 6 caracteres.');

      setBotaoCarregando('btnSalvarUsuarioPermissoes', true, null, 'Criando conta...');
      let secondaryApp = null;
      try {
        const cfg = firebase.app().options;
        const appName = 'SecondaryAdminAuth_' + Date.now();
        secondaryApp = firebase.initializeApp(cfg, appName);
        const secondaryAuth = secondaryApp.auth();

        const emailInterno = usernameParaEmail(username);
        const cred = await secondaryAuth.createUserWithEmailAndPassword(emailInterno, senha);
        const novoUid = cred.user.uid;
        await secondaryAuth.signOut();

        await state.db.collection(COLLECTION_USERS).doc(novoUid).set({
          uid: novoUid,
          username,
          emailInterno,
          nome,
          cargo,
          role: 'operador',
          status: 'ativo',
          perfilBase: state.modalPerfilBaseTemp,
          permissoesModulos: { ...state.modalPermissoesTemp },
          extras,
          criadoEm: agora,
          aprovadoPor: nomeAprovador,
          aprovadoEm: agora,
          ultimoAcesso: null
        });

        fecharModalUsuarioPermissoes();
        notify(`Conta @${username} criada e liberada com sucesso!`, 'success');
      } catch (err) {
        console.error('[Auth] Erro ao criar usuário via admin:', err);
        const msg = traduzirErroAuth(err);
        mostrarErro(msg === 'AUTH_NOT_ENABLED' ? 'Ative o provedor E-mail/senha no Console do Firebase.' : msg);
      } finally {
        if (secondaryApp) {
          secondaryApp.delete().catch(() => {});
        }
        setBotaoCarregando('btnSalvarUsuarioPermissoes', false, '<i class="fa-solid fa-user-plus mr-1.5"></i>Criar Conta & Liberar Acesso');
      }
      return;
    }

    // Modos 'aprovar' ou 'editar'
    const uid = state.modalEditUid;
    if (!uid) return;
    const nomeEdit = (document.getElementById('editUserNomeInput')?.value || '').trim();
    const cargoEdit = (document.getElementById('editUserCargoInput')?.value || '').trim();

    setBotaoCarregando('btnSalvarUsuarioPermissoes', true, null, 'Salvando...');
    try {
      const payload = {
        permissoesModulos: { ...state.modalPermissoesTemp },
        extras,
        perfilBase: state.modalPerfilBaseTemp,
        atualizadoEm: agora,
        atualizadoPor: nomeAprovador
      };
      if (nomeEdit.length >= 2) payload.nome = nomeEdit;
      if (cargoEdit.length >= 2) payload.cargo = cargoEdit;

      if (state.modalModo === 'aprovar') {
        payload.status = 'ativo';
        payload.aprovadoPor = nomeAprovador;
        payload.aprovadoEm = agora;
      }

      await state.db.collection(COLLECTION_USERS).doc(uid).set(payload, { merge: true });
      fecharModalUsuarioPermissoes();
      notify(
        state.modalModo === 'aprovar'
          ? 'Acesso liberado! O painel do colaborador abrirá automaticamente.'
          : 'Permissões atualizadas em tempo real!',
        'success'
      );
    } catch (err) {
      console.error('[Auth] Erro ao salvar permissões:', err);
      mostrarErro('Não foi possível salvar no Firebase: ' + (err.message || err));
    } finally {
      setBotaoCarregando('btnSalvarUsuarioPermissoes', false, '<i class="fa-solid fa-floppy-disk mr-1.5"></i>Salvar Permissões');
    }
  }

  function fecharModalUsuarioPermissoes() {
    const modal = document.getElementById('modalUsuarioPermissoes');
    if (modal) modal.classList.add('hidden');
  }

  async function alterarStatusUsuario(uid, novoStatus) {
    if (!canManageUsers()) return;
    const usuario = state.todosUsuarios.find(u => u.uid === uid);
    if (!usuario || usuario.role === 'master') return;

    const acaoLabel = novoStatus === 'bloqueado' ? 'BLOQUEAR o acesso de'
      : (novoStatus === 'recusado' ? 'RECUSAR a solicitação de' : 'ATIVAR');

    if (!confirm(`Deseja realmente ${acaoLabel} ${usuario.nome} (@${usuario.username})?`)) return;

    try {
      await state.db.collection(COLLECTION_USERS).doc(uid).set({
        status: novoStatus,
        atualizadoEm: new Date().toISOString(),
        atualizadoPor: state.perfilAtual ? state.perfilAtual.nome : 'Prefeito'
      }, { merge: true });

      notify(
        novoStatus === 'bloqueado'
          ? `Acesso de ${usuario.nome} bloqueado imediatamente.`
          : `Solicitação de ${usuario.nome} atualizada.`,
        'info'
      );
    } catch (err) {
      notify('Erro ao alterar status: ' + err.message, 'error');
    }
  }

  async function excluirRegistroUsuario(uid) {
    if (!canManageUsers()) return;
    const usuario = state.todosUsuarios.find(u => u.uid === uid);
    if (!usuario || usuario.role === 'master') return;

    if (!confirm(`Remover o registro de ${usuario.nome} (@${usuario.username}) do sistema?\n\nEle não conseguirá mais acessar o painel.`)) return;

    try {
      await state.db.collection(COLLECTION_USERS).doc(uid).delete();
      notify(`Usuário ${usuario.nome} removido do painel.`, 'success');
    } catch (err) {
      notify('Erro ao remover usuário: ' + err.message, 'error');
    }
  }

  // ==========================================================================
  // MODAL MINHA CONTA & ALTERAR SENHA
  // ==========================================================================
  function abrirModalMinhaConta() {
    fecharDropdownUsuario();
    if (!state.perfilAtual) return;
    const p = state.perfilAtual;

    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setTxt('minhaContaAvatar', gerarIniciais(p.nome));
    setTxt('minhaContaNome', p.nome || 'Usuário');
    setTxt('minhaContaLogin', '@' + (p.username || 'usuario'));
    setTxt('minhaContaCargo', p.role === 'master' ? 'Prefeito Master (Acesso Irrestrito)' : (p.cargo || 'Equipe'));

    const badgesEl = document.getElementById('minhaContaPermissoesBadges');
    if (badgesEl) {
      if (isMaster()) {
        badgesEl.innerHTML = `<span class="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold"><i class="fa-solid fa-crown mr-1"></i>Acesso Total a todos os 18 módulos + Gestão de Usuários</span>`;
      } else {
        const itens = AUTH_MODULOS
          .map(m => ({ ...m, nivel: getNivelModulo(m.id) }))
          .filter(m => m.nivel !== 'bloqueado');

        badgesEl.innerHTML = itens.map(m => `
          <span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border ${m.nivel === 'editar' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-sky-50 text-sky-800 border-sky-200'}">
            <i class="fa-solid ${m.icone} text-[10px]"></i>
            ${m.nome}
            <strong class="uppercase text-[9px] ml-0.5 opacity-80">(${m.nivel === 'editar' ? 'Editar' : 'Ver'})</strong>
          </span>
        `).join('') || '<span class="text-xs text-slate-400">Nenhum módulo liberado.</span>';
      }
    }

    ['minhaContaSenhaAtual', 'minhaContaNovaSenha', 'minhaContaConfirmarSenha'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const errEl = document.getElementById('minhaContaErro');
    if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; }

    const modal = document.getElementById('modalMinhaConta');
    if (modal) modal.classList.remove('hidden');
  }

  function fecharModalMinhaConta() {
    const modal = document.getElementById('modalMinhaConta');
    if (modal) modal.classList.add('hidden');
  }

  async function handleAlterarMinhaSenha(e) {
    if (e) e.preventDefault();
    const errEl = document.getElementById('minhaContaErro');
    const mostrarErro = (msg) => {
      if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
    };
    if (errEl) errEl.classList.add('hidden');

    const atual = document.getElementById('minhaContaSenhaAtual')?.value || '';
    const nova = document.getElementById('minhaContaNovaSenha')?.value || '';
    const confirmar = document.getElementById('minhaContaConfirmarSenha')?.value || '';

    if (!atual) return mostrarErro('Digite sua senha atual.');
    if (nova.length < 6) return mostrarErro('A nova senha deve ter pelo menos 6 caracteres.');
    if (nova !== confirmar) return mostrarErro('A confirmação da nova senha não confere.');
    if (atual === nova) return mostrarErro('A nova senha deve ser diferente da senha atual.');

    setBotaoCarregando('btnSubmitAlterarSenha', true, null, 'Atualizando senha...');
    try {
      const user = state.auth.currentUser;
      if (!user || !user.email) throw new Error('Sessão expirada. Faça login novamente.');

      const cred = firebase.auth.EmailAuthProvider.credential(user.email, atual);
      await user.reauthenticateWithCredential(cred);
      await user.updatePassword(nova);

      fecharModalMinhaConta();
      notify('Sua senha foi alterada com sucesso!', 'success');
    } catch (err) {
      console.error('[Auth] Erro ao alterar senha:', err);
      mostrarErro(traduzirErroAuth(err));
    } finally {
      setBotaoCarregando('btnSubmitAlterarSenha', false, '<i class="fa-solid fa-key mr-1.5"></i>Atualizar Minha Senha');
    }
  }

  // ==========================================================================
  // INICIALIZAÇÃO PRINCIPAL
  // ==========================================================================
  function init() {
    if (state.initialized) return;
    state.initialized = true;

    // Fecha dropdown ao clicar fora
    document.addEventListener('click', () => fecharDropdownUsuario());

    mostrarTelaGate('authViewLoading');

    if (typeof firebase === 'undefined' || !firebase.auth || !firebase.firestore) {
      console.error('[Auth] SDK do Firebase Auth/Firestore não carregado.');
      exibirErroInline('authLoginError', 'Erro ao carregar módulos de autenticação do Firebase. Recarregue a página.');
      mostrarTelaGate('authViewAuth');
      return;
    }

    state.auth = firebase.auth();
    state.db = firebase.firestore();

    state.auth.onAuthStateChanged(async (fbUser) => {
      state.firebaseUser = fbUser;
      if (!fbUser) {
        if (state.unsubMeuPerfil) { state.unsubMeuPerfil(); state.unsubMeuPerfil = null; }
        if (state.unsubTodosUsuarios) { state.unsubTodosUsuarios(); state.unsubTodosUsuarios = null; }
        state.perfilAtual = null;
        state._ultimoAcessoGravado = false;

        const temMaster = await verificarSeMasterExiste();
        if (!temMaster) {
          mostrarTelaGate('authViewSetupMaster');
        } else {
          mostrarTelaGate('authViewAuth');
          alternarAbaAuth('entrar');
        }
        return;
      }

      // Usuário autenticado no Firebase Auth -> escuta documento de permissões em tempo real
      escutarPerfilUsuarioLogado(fbUser);
    });
  }

  // Expõe API pública limpa
  window.PrefeituraAuth = {
    AUTH_MODULOS,
    AUTH_PERFIS_PRONTOS,
    init,
    handleSetupMaster,
    handleLogin,
    handleSolicitarAcesso,
    logout,
    alternarAbaAuth,
    toggleVisibilidadeSenha,
    atualizarMedidorForca,
    toggleDropdownUsuario,
    fecharDropdownUsuario,
    isMaster,
    canManageUsers,
    canDelete,
    canExport,
    getNivelModulo,
    canEditTab,
    obterPrimeiraAbaPermitida,
    aplicarPermissoesInterface,
    aplicarPermissoesAbaAtiva,
    renderUsuariosGestao,
    setFiltroUsuarios,
    setBuscaUsuarios,
    abrirModalUsuario,
    fecharModalUsuarioPermissoes,
    renderFrentesCampoModal,
    toggleFrenteCampoModal,
    aplicarPerfilProntoModal,
    setPermissaoModuloModal,
    setPermissaoGrupoModal,
    toggleSomenteCampoModal,
    isPerfilSomenteCampo,
    salvarModalUsuarioPermissoes,
    alterarStatusUsuario,
    excluirRegistroUsuario,
    abrirModalMinhaConta,
    fecharModalMinhaConta,
    handleAlterarMinhaSenha,
    getPerfilAtual: () => state.perfilAtual
  };
})();
