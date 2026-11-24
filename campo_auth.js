// ============================================================================
// AUTENTICAÇÃO COMPARTILHADA & RBAC EM TEMPO REAL PARA APPS DE CAMPO
// Prefeitura de Canteiro — GEL Engenharia (Obra Taboca 2 | prefeitura-cc71b)
// Usado por: campo.html, ronda.html, limpeza.html
// ============================================================================

(function () {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCd1Uu_dRx8k4EcgifWUmsmfeqnAcB4PHw",
    authDomain: "prefeitura-cc71b.firebaseapp.com",
    projectId: "prefeitura-cc71b",
    storageBucket: "prefeitura-cc71b.firebasestorage.app",
    messagingSenderId: "395936672533",
    appId: "1:395936672533:web:d7d17537d2c38c47bc971c",
    measurementId: "G-YYXMDWCM4Q"
  };

  const AUTH_INTERNAL_DOMAIN = 'prefeitura-taboca.gel.local';
  const COLLECTION_USERS = 'usuarios_sistema';

  // Exatamente os 18 módulos oficiais exigidos por firestore.rules (bMap / vPm)
  const AUTH_MODULOS_IDS = [
    'dashboard',
    'blocos',
    'alojados',
    'moveis',
    'casas_cidade',
    'chamados',
    'ronda',
    'maquina_gelo',
    'ronda_vigilancia',
    'portal_alojado',
    'sorteio',
    'estoque',
    'erp_canteiro',
    'gestao_cadastros',
    'relatorios',
    'importacao',
    'auditoria',
    'configuracoes'
  ];

  const FRENTE_LABELS = {
    maquina_gelo: 'Fábrica & Máquina de Gelo',
    ronda: 'Banheiros & Bebedouros (Ronda)',
    limpeza: 'Casas na Cidade & Quartos (Limpeza / Ar)'
  };

  const internal = {
    app: null,
    auth: null,
    db: null,
    watcherStarted: false,
    unsubAuth: null,
    unsubDoc: null,
    listeners: new Set(),
    lastSnapshot: { state: 'loading', user: null, perfil: null },
    ultimoAcessoAtualizadoUid: null,
    boxCounter: 0
  };

  // ==========================================================================
  // INICIALIZAÇÃO SEGURA DO FIREBASE
  // ==========================================================================
  function init() {
    if (internal.app && internal.auth && internal.db) {
      return { app: internal.app, auth: internal.auth, db: internal.db };
    }
    if (typeof firebase === 'undefined') {
      throw new Error('Firebase SDK não carregado antes de campo_auth.js.');
    }
    internal.app = (firebase.apps && firebase.apps.length > 0)
      ? firebase.app()
      : firebase.initializeApp(FIREBASE_CONFIG);

    if (typeof firebase.auth !== 'function') {
      throw new Error('Firebase Auth SDK (firebase-auth-compat.js) não carregado.');
    }
    if (typeof firebase.firestore !== 'function') {
      throw new Error('Firebase Firestore SDK (firebase-firestore-compat.js) não carregado.');
    }

    internal.auth = firebase.auth();
    internal.db = firebase.firestore();
    return { app: internal.app, auth: internal.auth, db: internal.db };
  }

  // ==========================================================================
  // UTILITÁRIOS (100% ALINHADOS COM auth.js)
  // ==========================================================================
  function criarMapaPermissoes(padrao = 'bloqueado', overrides = {}) {
    const map = {};
    AUTH_MODULOS_IDS.forEach(id => { map[id] = padrao; });
    Object.keys(overrides || {}).forEach(k => {
      if (Object.prototype.hasOwnProperty.call(map, k)) {
        map[k] = overrides[k];
      }
    });
    return map;
  }

  function normalizarUsername(raw) {
    if (!raw) return '';
    let s = String(raw).trim().toLowerCase();
    if (s.endsWith('@' + AUTH_INTERNAL_DOMAIN)) {
      s = s.replace('@' + AUTH_INTERNAL_DOMAIN, '');
    }
    if (s.includes('@')) return s;
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

  function escaparHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function gerarIniciais(nome) {
    if (!nome) return 'US';
    const partes = String(nome).trim().split(/\s+/).filter(Boolean);
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }

  function traduzirErroAuth(err) {
    const code = (err && err.code) ? String(err.code) : '';
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Usuário ou senha incorretos. Verifique e tente novamente.';
      case 'auth/email-already-in-use':
        return 'Este nome de usuário já está cadastrado. Escolha outro login ou clique em Entrar.';
      case 'auth/invalid-email':
        return 'Nome de usuário inválido. Use apenas letras, números, ponto ou traço.';
      case 'auth/weak-password':
        return 'A senha deve ter pelo menos 6 caracteres.';
      case 'auth/too-many-requests':
        return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.';
      case 'auth/network-request-failed':
        return 'Sem conexão com a internet. Verifique o sinal e tente novamente.';
      case 'auth/operation-not-allowed':
        return 'O login por usuário e senha ainda não foi ativado no servidor Firebase.';
      case 'auth/user-disabled':
        return 'Esta conta foi desativada pela administração. Procure o Prefeito da Obra.';
      case 'auth/requires-recent-login':
        return 'Por segurança, saia e entre novamente para continuar.';
      case 'permission-denied':
        return 'Sem permissão no servidor para completar esta ação. Procure o Prefeito da Obra.';
      case 'unavailable':
        return 'Servidor temporariamente indisponível. Verifique sua conexão e tente novamente.';
      default:
        return (err && err.message) ? err.message : 'Erro inesperado ao autenticar.';
    }
  }

  // ==========================================================================
  // REGRAS DE ACESSO ÀS FRENTES DE CAMPO (RBAC)
  // ==========================================================================
  function hasFrontAccess(perfil, frente) {
    if (!perfil || perfil.status !== 'ativo') return false;
    if (perfil.role === 'master') return true;
    const mods = perfil.permissoesModulos;
    if (!mods || typeof mods !== 'object') return false;

    if (frente === 'maquina_gelo') {
      return mods.maquina_gelo === 'editar';
    }
    if (frente === 'ronda') {
      return mods.ronda === 'editar';
    }
    if (frente === 'limpeza') {
      return mods.casas_cidade === 'editar' || mods.blocos === 'editar';
    }
    return false;
  }

  function hasAnyFrontAccess(perfil) {
    return (
      hasFrontAccess(perfil, 'maquina_gelo') ||
      hasFrontAccess(perfil, 'ronda') ||
      hasFrontAccess(perfil, 'limpeza')
    );
  }

  function hasAdminPanelAccess(perfil) {
    if (!perfil || perfil.status !== 'ativo') return false;
    if (perfil.role === 'master') return true;
    if (String(perfil.perfilBase || '').startsWith('campo_')) return false;
    const mods = perfil.permissoesModulos || {};
    return Object.keys(mods).some(k => mods[k] === 'ver' || mods[k] === 'editar');
  }

  // ==========================================================================
  // AÇÕES DE AUTENTICAÇÃO (LOGIN, SOLICITAR ACESSO, LOGOUT)
  // ==========================================================================
  async function login(usernameRaw, senha, lembrar = true) {
    const { auth } = init();
    const username = normalizarUsername(usernameRaw);
    if (!username) {
      const err = new Error('Digite seu nome de usuário.');
      err.code = 'campo/missing-username';
      throw err;
    }
    if (!senha) {
      const err = new Error('Digite sua senha.');
      err.code = 'campo/missing-password';
      throw err;
    }

    const persistence = lembrar !== false
      ? firebase.auth.Auth.Persistence.LOCAL
      : firebase.auth.Auth.Persistence.SESSION;
    await auth.setPersistence(persistence);

    const emailInterno = usernameParaEmail(username);
    const cred = await auth.signInWithEmailAndPassword(emailInterno, senha);
    return cred.user;
  }

  async function solicitarAcesso(nomeRaw, cargoRaw, usernameRaw, senha) {
    const { auth, db } = init();
    const nome = String(nomeRaw || '').trim();
    const cargo = String(cargoRaw || '').trim();
    const username = normalizarUsername(usernameRaw);
    const pass = String(senha || '');

    if (nome.length < 3) {
      throw new Error('Informe seu nome completo (mínimo 3 caracteres).');
    }
    if (cargo.length < 2) {
      throw new Error('Informe seu cargo ou setor (ex: Operador Gelo, Aux. Limpeza, Fiscal).');
    }
    if (username.length < 3 || username.length > 64) {
      throw new Error('O usuário deve ter entre 3 e 64 caracteres (ex: joao.silva).');
    }
    if (pass.length < 6) {
      throw new Error('A senha deve ter no mínimo 6 caracteres.');
    }

    const emailInterno = usernameParaEmail(username);
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    const cred = await auth.createUserWithEmailAndPassword(emailInterno, pass);
    const uid = cred.user.uid;
    const agora = new Date().toISOString();

    // Schema 100% compatível com firestore.rules (vUs + sReg)
    const novoPerfilPendente = {
      uid,
      username,
      emailInterno,
      nome: nome.slice(0, 120),
      cargo: cargo.slice(0, 300),
      role: 'operador',
      status: 'pendente',
      perfilBase: 'campo_solicitado',
      permissoesModulos: criarMapaPermissoes('bloqueado'),
      extras: {
        podeExcluir: false,
        podeExportar: false,
        gerenciarUsuarios: false
      },
      criadoEm: agora,
      aprovadoPor: null,
      aprovadoEm: null,
      ultimoAcesso: agora
    };

    try {
      await db.collection(COLLECTION_USERS).doc(uid).set(novoPerfilPendente);
    } catch (docErr) {
      // Se falhar gravar o perfil no Firestore, tenta desfazer para não travar conta órfã
      try { await cred.user.delete(); } catch (_) {}
      throw docErr;
    }

    return { user: cred.user, perfil: novoPerfilPendente };
  }

  async function logout() {
    const { auth } = init();
    internal.ultimoAcessoAtualizadoUid = null;
    if (internal.unsubDoc) {
      internal.unsubDoc();
      internal.unsubDoc = null;
    }
    await auth.signOut();
  }

  // ==========================================================================
  // WATCHER EM TEMPO REAL (AUTH + FIRESTORE usuarios_sistema/{uid})
  // ==========================================================================
  function emitirEstado(snapshot) {
    internal.lastSnapshot = snapshot;
    internal.listeners.forEach(cb => {
      try {
        cb(snapshot);
      } catch (err) {
        console.error('[CampoAuth] Erro em callback de watchAuth:', err);
      }
    });
  }

  function iniciarWatcherSeNecessario() {
    if (internal.watcherStarted) return;
    const { auth, db } = init();
    internal.watcherStarted = true;

    internal.unsubAuth = auth.onAuthStateChanged((fbUser) => {
      if (internal.unsubDoc) {
        internal.unsubDoc();
        internal.unsubDoc = null;
      }

      if (!fbUser) {
        internal.ultimoAcessoAtualizadoUid = null;
        emitirEstado({ state: 'unauthenticated', user: null, perfil: null });
        return;
      }

      emitirEstado({ state: 'loading', user: fbUser, perfil: null });

      const docRef = db.collection(COLLECTION_USERS).doc(fbUser.uid);
      internal.unsubDoc = docRef.onSnapshot((snap) => {
        if (!snap.exists) {
          const usernameFallback = (fbUser.email || '').split('@')[0] || 'usuario';
          emitirEstado({
            state: 'blocked',
            user: fbUser,
            perfil: {
              uid: fbUser.uid,
              nome: usernameFallback,
              username: usernameFallback,
              status: 'bloqueado',
              motivo: 'Sua conta foi removida ou ainda não possui cadastro ativo na Prefeitura.'
            }
          });
          return;
        }

        const perfil = Object.assign({ uid: snap.id }, snap.data() || {});

        if (perfil.status === 'pendente') {
          emitirEstado({ state: 'pending', user: fbUser, perfil });
          return;
        }

        if (perfil.status === 'bloqueado' || perfil.status === 'recusado') {
          emitirEstado({ state: 'blocked', user: fbUser, perfil });
          return;
        }

        if (perfil.status === 'ativo') {
          if (internal.ultimoAcessoAtualizadoUid !== fbUser.uid) {
            internal.ultimoAcessoAtualizadoUid = fbUser.uid;
            docRef.update({ ultimoAcesso: new Date().toISOString() }).catch(() => {});
          }
          emitirEstado({ state: 'active', user: fbUser, perfil });
          return;
        }

        emitirEstado({ state: 'blocked', user: fbUser, perfil });
      }, (err) => {
        console.warn('[CampoAuth] Erro ao escutar perfil do usuário:', err);
        emitirEstado({
          state: 'blocked',
          user: fbUser,
          perfil: {
            uid: fbUser.uid,
            nome: (fbUser.email || '').split('@')[0] || 'Usuário',
            username: (fbUser.email || '').split('@')[0] || '',
            status: 'bloqueado',
            motivo: traduzirErroAuth(err)
          }
        });
      });
    });
  }

  function watchAuth(callback) {
    if (typeof callback !== 'function') {
      throw new Error('watchAuth requer uma função callback.');
    }
    iniciarWatcherSeNecessario();
    internal.listeners.add(callback);

    // Entrega o estado atual imediatamente
    try {
      callback(internal.lastSnapshot);
    } catch (err) {
      console.error('[CampoAuth] Erro no callback inicial de watchAuth:', err);
    }

    return function unsubscribe() {
      internal.listeners.delete(callback);
    };
  }

  function getCurrentState() {
    return internal.lastSnapshot;
  }

  // ==========================================================================
  // COMPONENTE REUTILIZÁVEL: CAIXA DE LOGIN / RBAC INLINE (ronda.html, limpeza.html)
  // ==========================================================================
  function mountInlineAuthBox(containerId, options = {}) {
    const container = typeof containerId === 'string'
      ? document.getElementById(containerId)
      : containerId;

    if (!container) {
      console.warn('[CampoAuth] Container não encontrado para mountInlineAuthBox:', containerId);
      return {
        refresh: () => {},
        setFrente: () => {},
        destroy: () => {},
        getState: () => internal.lastSnapshot
      };
    }

    const boxUid = 'ca_' + (++internal.boxCounter);
    const cfg = {
      frente: options.frente || 'ronda',
      tituloFrente: options.tituloFrente || '',
      onUnlocked: typeof options.onUnlocked === 'function' ? options.onUnlocked : null,
      onLocked: typeof options.onLocked === 'function' ? options.onLocked : null
    };

    let activeTab = 'entrar';
    let lastViewKey = '';
    let lastSnapshot = internal.lastSnapshot;
    let destroyed = false;

    function resolveFrente() {
      return typeof cfg.frente === 'function' ? cfg.frente() : cfg.frente;
    }

    function resolveTitulo(frenteKey) {
      const custom = typeof cfg.tituloFrente === 'function'
        ? cfg.tituloFrente(frenteKey)
        : cfg.tituloFrente;
      return custom || FRENTE_LABELS[frenteKey] || 'Operação de Campo';
    }

    function setInlineError(elId, msg) {
      const el = document.getElementById(elId);
      if (!el) return;
      if (!msg) {
        el.classList.add('hidden');
        el.innerHTML = '';
      } else {
        el.classList.remove('hidden');
        el.innerHTML = `<i class="fa-solid fa-circle-exclamation mt-0.5 flex-shrink-0"></i><span>${escaparHtml(msg)}</span>`;
      }
    }

    function renderLoading() {
      container.innerHTML = `
        <div class="py-6 text-center space-y-3">
          <div class="w-12 h-12 rounded-2xl bg-teal-500/15 border border-teal-500/30 text-teal-400 flex items-center justify-center mx-auto">
            <i class="fa-solid fa-circle-notch fa-spin text-xl"></i>
          </div>
          <div>
            <p class="text-xs font-black text-white uppercase tracking-wider">Verificando credenciais...</p>
            <p class="text-[11px] text-slate-400 mt-0.5">Conectando à conta da equipe de campo</p>
          </div>
        </div>
      `;
    }

    function renderUnauthenticated(tituloFrente) {
      const isEntrar = activeTab !== 'solicitar';
      container.innerHTML = `
        <div class="space-y-4">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center text-lg flex-shrink-0 border border-teal-500/30">
              <i class="fa-solid fa-user-shield"></i>
            </div>
            <div class="min-w-0">
              <h3 class="text-sm font-black text-white uppercase tracking-wide leading-tight">Acesso da Equipe</h3>
              <p id="${boxUid}_titulo" class="text-[11px] text-teal-300 font-semibold truncate">${escaparHtml(tituloFrente)}</p>
            </div>
          </div>

          <div class="flex p-1 rounded-xl bg-slate-950/80 border border-slate-800">
            <button type="button" id="${boxUid}_tabEntrar" class="flex-1 py-2 px-2.5 rounded-lg text-xs font-bold transition ${isEntrar ? 'bg-teal-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}">
              <i class="fa-solid fa-right-to-bracket mr-1"></i>Entrar
            </button>
            <button type="button" id="${boxUid}_tabSolicitar" class="flex-1 py-2 px-2.5 rounded-lg text-xs font-bold transition ${!isEntrar ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'}">
              <i class="fa-solid fa-user-plus mr-1"></i>Solicitar Acesso
            </button>
          </div>

          <!-- Form Login -->
          <form id="${boxUid}_formLogin" class="${isEntrar ? '' : 'hidden'} space-y-3">
            <div id="${boxUid}_errLogin" class="hidden p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs font-medium flex items-start gap-2"></div>

            <div>
              <label for="${boxUid}_loginUser" class="block text-[11px] font-bold uppercase tracking-wider text-slate-300 mb-1">Usuário</label>
              <div class="relative">
                <i class="fa-solid fa-user absolute left-3 top-1/2 -translate-y-1/2 text-teal-400 text-xs"></i>
                <input id="${boxUid}_loginUser" type="text" required autocomplete="username" placeholder="Ex: joao.silva" class="w-full h-11 bg-slate-900 border border-slate-700 focus:border-teal-500 rounded-xl pl-9 pr-3 text-sm text-white placeholder-slate-500 outline-none transition">
              </div>
            </div>

            <div>
              <label for="${boxUid}_loginPass" class="block text-[11px] font-bold uppercase tracking-wider text-slate-300 mb-1">Senha</label>
              <div class="relative">
                <i class="fa-solid fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                <input id="${boxUid}_loginPass" type="password" required autocomplete="current-password" placeholder="Sua senha" class="w-full h-11 bg-slate-900 border border-slate-700 focus:border-teal-500 rounded-xl pl-9 pr-10 text-sm text-white placeholder-slate-500 outline-none transition">
                <button type="button" id="${boxUid}_toggleLoginPass" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1.5" aria-label="Mostrar senha">
                  <i class="fa-solid fa-eye text-xs"></i>
                </button>
              </div>
            </div>

            <div class="flex items-center justify-between text-xs pt-0.5">
              <label class="inline-flex items-center gap-2 text-slate-300 cursor-pointer select-none">
                <input id="${boxUid}_lembrar" type="checkbox" checked class="w-4 h-4 rounded border-slate-600 bg-slate-900 accent-teal-500">
                <span class="text-[11px] font-semibold">Manter conectado</span>
              </label>
              <a href="campo.html" class="text-[11px] font-bold text-amber-300 hover:text-amber-200 flex items-center gap-1">
                <i class="fa-solid fa-grid-2 text-[10px]"></i>Menu GEL Campo
              </a>
            </div>

            <button id="${boxUid}_btnLogin" type="submit" class="w-full h-11 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white font-black text-xs uppercase tracking-wider shadow-lg transition active:scale-[0.98] flex items-center justify-center gap-2">
              <i class="fa-solid fa-unlock-keyhole"></i><span>Entrar e Liberar Formulário</span>
            </button>
          </form>

          <!-- Form Solicitar Acesso -->
          <form id="${boxUid}_formReg" class="${!isEntrar ? '' : 'hidden'} space-y-2.5">
            <div class="p-2.5 rounded-xl bg-sky-500/10 border border-sky-400/25 text-[11px] text-sky-200 flex items-start gap-2">
              <i class="fa-solid fa-circle-info text-sky-400 mt-0.5 flex-shrink-0"></i>
              <span>Após enviar, sua conta ficará <strong>aguardando o Prefeito liberar</strong> as frentes de trabalho no sistema.</span>
            </div>

            <div id="${boxUid}_errReg" class="hidden p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs font-medium flex items-start gap-2"></div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label for="${boxUid}_regNome" class="block text-[10px] font-bold uppercase tracking-wider text-slate-300 mb-1">Nome Completo</label>
                <input id="${boxUid}_regNome" type="text" required placeholder="Seu nome" class="w-full h-10 bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-xl px-3 text-xs text-white placeholder-slate-500 outline-none transition">
              </div>
              <div>
                <label for="${boxUid}_regCargo" class="block text-[10px] font-bold uppercase tracking-wider text-slate-300 mb-1">Cargo / Setor</label>
                <input id="${boxUid}_regCargo" type="text" required placeholder="Ex: Aux. Limpeza, Gelo" class="w-full h-10 bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-xl px-3 text-xs text-white placeholder-slate-500 outline-none transition">
              </div>
            </div>

            <div>
              <label for="${boxUid}_regUser" class="block text-[10px] font-bold uppercase tracking-wider text-slate-300 mb-1">Usuário de Login</label>
              <input id="${boxUid}_regUser" type="text" required autocomplete="username" placeholder="Ex: maria.limpeza" class="w-full h-10 bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-xl px-3 text-xs text-white placeholder-slate-500 lowercase outline-none transition">
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label for="${boxUid}_regPass" class="block text-[10px] font-bold uppercase tracking-wider text-slate-300 mb-1">Criar Senha (mín. 6)</label>
                <input id="${boxUid}_regPass" type="password" required minlength="6" autocomplete="new-password" placeholder="Mínimo 6 dígitos" class="w-full h-10 bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-xl px-3 text-xs text-white placeholder-slate-500 outline-none transition">
              </div>
              <div>
                <label for="${boxUid}_regPass2" class="block text-[10px] font-bold uppercase tracking-wider text-slate-300 mb-1">Confirmar Senha</label>
                <input id="${boxUid}_regPass2" type="password" required minlength="6" autocomplete="new-password" placeholder="Repita a senha" class="w-full h-10 bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-xl px-3 text-xs text-white placeholder-slate-500 outline-none transition">
              </div>
            </div>

            <button id="${boxUid}_btnReg" type="submit" class="w-full h-11 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs uppercase tracking-wider shadow-lg transition active:scale-[0.98] flex items-center justify-center gap-2">
              <i class="fa-solid fa-paper-plane"></i><span>Enviar Solicitação ao Prefeito</span>
            </button>
          </form>
        </div>
      `;

      // Bindings
      const tabEntrar = document.getElementById(`${boxUid}_tabEntrar`);
      const tabSolicitar = document.getElementById(`${boxUid}_tabSolicitar`);
      const formLogin = document.getElementById(`${boxUid}_formLogin`);
      const formReg = document.getElementById(`${boxUid}_formReg`);
      const togglePass = document.getElementById(`${boxUid}_toggleLoginPass`);

      const switchTab = (tab) => {
        activeTab = tab;
        const showLogin = tab === 'entrar';
        if (formLogin) formLogin.classList.toggle('hidden', !showLogin);
        if (formReg) formReg.classList.toggle('hidden', showLogin);
        if (tabEntrar) {
          tabEntrar.className = `flex-1 py-2 px-2.5 rounded-lg text-xs font-bold transition ${showLogin ? 'bg-teal-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`;
        }
        if (tabSolicitar) {
          tabSolicitar.className = `flex-1 py-2 px-2.5 rounded-lg text-xs font-bold transition ${!showLogin ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'}`;
        }
        setInlineError(`${boxUid}_errLogin`, '');
        setInlineError(`${boxUid}_errReg`, '');
      };

      if (tabEntrar) tabEntrar.addEventListener('click', () => switchTab('entrar'));
      if (tabSolicitar) tabSolicitar.addEventListener('click', () => switchTab('solicitar'));

      if (togglePass) {
        togglePass.addEventListener('click', () => {
          const inp = document.getElementById(`${boxUid}_loginPass`);
          if (!inp) return;
          const isPass = inp.type === 'password';
          inp.type = isPass ? 'text' : 'password';
          const ico = togglePass.querySelector('i');
          if (ico) ico.className = isPass ? 'fa-solid fa-eye-slash text-xs' : 'fa-solid fa-eye text-xs';
        });
      }

      if (formLogin) {
        formLogin.addEventListener('submit', async (e) => {
          e.preventDefault();
          setInlineError(`${boxUid}_errLogin`, '');
          const userVal = document.getElementById(`${boxUid}_loginUser`)?.value || '';
          const passVal = document.getElementById(`${boxUid}_loginPass`)?.value || '';
          const lembrar = document.getElementById(`${boxUid}_lembrar`)?.checked !== false;
          const btn = document.getElementById(`${boxUid}_btnLogin`);
          const orig = btn ? btn.innerHTML : '';
          if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Entrando...</span>';
          }
          try {
            await login(userVal, passVal, lembrar);
          } catch (err) {
            setInlineError(`${boxUid}_errLogin`, traduzirErroAuth(err));
            if (btn) { btn.disabled = false; btn.innerHTML = orig; }
          }
        });
      }

      if (formReg) {
        formReg.addEventListener('submit', async (e) => {
          e.preventDefault();
          setInlineError(`${boxUid}_errReg`, '');
          const nomeVal = document.getElementById(`${boxUid}_regNome`)?.value || '';
          const cargoVal = document.getElementById(`${boxUid}_regCargo`)?.value || '';
          const userVal = document.getElementById(`${boxUid}_regUser`)?.value || '';
          const passVal = document.getElementById(`${boxUid}_regPass`)?.value || '';
          const pass2Val = document.getElementById(`${boxUid}_regPass2`)?.value || '';

          if (passVal !== pass2Val) {
            setInlineError(`${boxUid}_errReg`, 'As senhas digitadas não coincidem.');
            return;
          }

          const btn = document.getElementById(`${boxUid}_btnReg`);
          const orig = btn ? btn.innerHTML : '';
          if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Enviando...</span>';
          }
          try {
            await solicitarAcesso(nomeVal, cargoVal, userVal, passVal);
          } catch (err) {
            setInlineError(`${boxUid}_errReg`, traduzirErroAuth(err));
            if (btn) { btn.disabled = false; btn.innerHTML = orig; }
          }
        });
      }
    }

    function renderPending(perfil) {
      const nome = escaparHtml(perfil && perfil.nome ? perfil.nome : 'Colaborador');
      const user = escaparHtml(perfil && perfil.username ? '@' + perfil.username : '');
      container.innerHTML = `
        <div class="py-3 text-center space-y-3.5">
          <div class="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-400/40 text-amber-400 flex items-center justify-center mx-auto">
            <i class="fa-solid fa-hourglass-half text-2xl animate-pulse"></i>
          </div>
          <div class="space-y-1">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-bold uppercase tracking-wider">
              Aguardando Aprovação
            </span>
            <h3 class="text-sm font-black text-white pt-1">Solicitação Enviada!</h3>
            <p class="text-xs text-slate-300 leading-relaxed">
              Olá, <strong class="text-white">${nome}</strong> ${user ? `(<span class="font-mono text-amber-300">${user}</span>)` : ''}. Sua conta aguarda liberação do <strong>Prefeito da Obra</strong>. Assim que ele aprovar, esta tela destrava sozinha.
            </p>
          </div>
          <div class="flex flex-col sm:flex-row gap-2">
            <a href="campo.html" class="flex-1 py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-700 text-amber-300 border border-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 transition">
              <i class="fa-solid fa-mobile-screen"></i><span>Ir p/ GEL Campo</span>
            </a>
            <button type="button" id="${boxUid}_btnLogoutPending" class="flex-1 py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 transition">
              <i class="fa-solid fa-right-from-bracket"></i><span>Sair / Trocar Conta</span>
            </button>
          </div>
        </div>
      `;
      const btn = document.getElementById(`${boxUid}_btnLogoutPending`);
      if (btn) btn.addEventListener('click', () => logout().catch(() => {}));
    }

    function renderBlocked(perfil) {
      const nome = escaparHtml(perfil && perfil.nome ? perfil.nome : 'Usuário');
      const motivo = escaparHtml(
        (perfil && perfil.motivo) ||
        'Seu acesso foi suspenso ou recusado. Procure o Prefeito da Obra para reativação.'
      );
      container.innerHTML = `
        <div class="py-3 text-center space-y-3.5">
          <div class="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-400 flex items-center justify-center mx-auto">
            <i class="fa-solid fa-user-lock text-2xl"></i>
          </div>
          <div class="space-y-1">
            <h3 class="text-sm font-black text-white">Acesso Não Autorizado</h3>
            <p class="text-xs font-bold text-rose-300">${nome}</p>
            <p class="text-xs text-slate-300 leading-relaxed">${motivo}</p>
          </div>
          <button type="button" id="${boxUid}_btnLogoutBlocked" class="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-700 text-white border border-slate-700 font-bold text-xs flex items-center justify-center gap-2 transition">
            <i class="fa-solid fa-arrow-left"></i><span>Sair e Voltar ao Login</span>
          </button>
        </div>
      `;
      const btn = document.getElementById(`${boxUid}_btnLogoutBlocked`);
      if (btn) btn.addEventListener('click', () => logout().catch(() => {}));
    }

    function renderNoFrontAccess(perfil, tituloFrente) {
      const nome = escaparHtml(perfil && perfil.nome ? perfil.nome : 'Colaborador');
      const user = escaparHtml(perfil && perfil.username ? '@' + perfil.username : '');
      container.innerHTML = `
        <div class="py-3 text-center space-y-3.5">
          <div class="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-400 flex items-center justify-center mx-auto">
            <i class="fa-solid fa-shield-halved text-2xl"></i>
          </div>
          <div class="space-y-1.5">
            <div class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-[11px] text-slate-200 font-semibold">
              <i class="fa-solid fa-user-check text-emerald-400 text-[10px]"></i>
              <span>${nome}</span>
              ${user ? `<span class="text-slate-400 font-mono text-[10px]">${user}</span>` : ''}
            </div>
            <h3 class="text-sm font-black text-white pt-1">Frente Não Liberada</h3>
            <p class="text-xs text-amber-200 font-semibold leading-relaxed">
              O Prefeito ainda não liberou esta frente (<span class="text-white">${escaparHtml(tituloFrente)}</span>) para sua conta.
            </p>
            <p class="text-[11px] text-slate-400 leading-relaxed">
              Peça a liberação na aba <strong>Usuários &amp; Acessos</strong> ou volte ao menu GEL Campo para abrir suas frentes ativas.
            </p>
          </div>
          <div class="flex flex-col sm:flex-row gap-2 pt-1">
            <a href="campo.html" class="flex-1 py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 shadow transition">
              <i class="fa-solid fa-arrow-left"></i><span>Menu GEL Campo</span>
            </a>
            <button type="button" id="${boxUid}_btnLogoutDenied" class="flex-1 py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 transition">
              <i class="fa-solid fa-right-from-bracket"></i><span>Trocar Conta</span>
            </button>
          </div>
        </div>
      `;
      const btn = document.getElementById(`${boxUid}_btnLogoutDenied`);
      if (btn) btn.addEventListener('click', () => logout().catch(() => {}));
    }

    function renderUnlockedBadge(perfil, tituloFrente) {
      const nome = escaparHtml(perfil && perfil.nome ? perfil.nome : 'Colaborador');
      container.innerHTML = `
        <div class="flex items-center justify-between gap-2 text-xs">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0"></span>
            <span class="text-emerald-300 font-bold truncate">${nome}</span>
            <span class="text-slate-400 text-[10px] truncate hidden sm:inline">• ${escaparHtml(tituloFrente)}</span>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <a href="campo.html" class="text-[11px] font-bold text-amber-300 hover:underline">GEL Campo</a>
            <button type="button" id="${boxUid}_btnLogoutSmall" class="px-2 py-1 rounded-lg bg-slate-900 hover:bg-rose-950 text-rose-300 border border-slate-700 text-[10px] font-bold">Sair</button>
          </div>
        </div>
      `;
      const btn = document.getElementById(`${boxUid}_btnLogoutSmall`);
      if (btn) btn.addEventListener('click', () => logout().catch(() => {}));
    }

    function evaluate(snapshot) {
      if (destroyed) return;
      lastSnapshot = snapshot || internal.lastSnapshot;
      const frenteKey = resolveFrente();
      const tituloFrente = resolveTitulo(frenteKey);
      const st = lastSnapshot.state;
      const perfil = lastSnapshot.perfil;
      const user = lastSnapshot.user;

      if (st === 'loading') {
        if (lastViewKey !== 'loading') {
          lastViewKey = 'loading';
          renderLoading();
        }
        if (cfg.onLocked) cfg.onLocked('loading', { state: st, user, perfil, frente: frenteKey });
        return;
      }

      if (st === 'unauthenticated') {
        if (lastViewKey !== 'unauthenticated') {
          lastViewKey = 'unauthenticated';
          renderUnauthenticated(tituloFrente);
        } else {
          const titleEl = document.getElementById(`${boxUid}_titulo`);
          if (titleEl) titleEl.textContent = tituloFrente;
        }
        if (cfg.onLocked) cfg.onLocked('unauthenticated', { state: st, user, perfil, frente: frenteKey });
        return;
      }

      if (st === 'pending') {
        const key = 'pending|' + (perfil ? perfil.uid : '');
        if (lastViewKey !== key) {
          lastViewKey = key;
          renderPending(perfil);
        }
        if (cfg.onLocked) cfg.onLocked('pending', { state: st, user, perfil, frente: frenteKey });
        return;
      }

      if (st === 'blocked') {
        const key = 'blocked|' + (perfil ? perfil.uid + '|' + (perfil.motivo || '') : '');
        if (lastViewKey !== key) {
          lastViewKey = key;
          renderBlocked(perfil);
        }
        if (cfg.onLocked) cfg.onLocked('blocked', { state: st, user, perfil, frente: frenteKey });
        return;
      }

      // st === 'active'
      const allowed = hasFrontAccess(perfil, frenteKey);
      if (!allowed) {
        const key = 'denied|' + (perfil ? perfil.uid : '') + '|' + frenteKey + '|' + tituloFrente;
        if (lastViewKey !== key) {
          lastViewKey = key;
          renderNoFrontAccess(perfil, tituloFrente);
        }
        if (cfg.onLocked) cfg.onLocked('no_front_access', { state: st, user, perfil, frente: frenteKey });
        return;
      }

      const key = 'unlocked|' + (perfil ? perfil.uid + '|' + (perfil.nome || '') : '') + '|' + frenteKey;
      if (lastViewKey !== key) {
        lastViewKey = key;
        renderUnlockedBadge(perfil, tituloFrente);
      }
      if (cfg.onUnlocked) cfg.onUnlocked(perfil, user, frenteKey);
    }

    const unsub = watchAuth(evaluate);

    return {
      refresh(nextOptions) {
        if (nextOptions) {
          if (nextOptions.frente !== undefined) cfg.frente = nextOptions.frente;
          if (nextOptions.tituloFrente !== undefined) cfg.tituloFrente = nextOptions.tituloFrente;
          if (typeof nextOptions.onUnlocked === 'function') cfg.onUnlocked = nextOptions.onUnlocked;
          if (typeof nextOptions.onLocked === 'function') cfg.onLocked = nextOptions.onLocked;
        }
        evaluate(internal.lastSnapshot);
      },
      setFrente(frente, tituloFrente) {
        cfg.frente = frente;
        if (tituloFrente !== undefined) cfg.tituloFrente = tituloFrente;
        evaluate(internal.lastSnapshot);
      },
      destroy() {
        destroyed = true;
        unsub();
      },
      getState() {
        return lastSnapshot;
      }
    };
  }

  // ==========================================================================
  // API PÚBLICA window.CampoAuth
  // ==========================================================================
  window.CampoAuth = {
    AUTH_INTERNAL_DOMAIN,
    COLLECTION_USERS,
    AUTH_MODULOS_IDS: AUTH_MODULOS_IDS.slice(),
    FIREBASE_CONFIG,
    init,
    normalizarUsername,
    usernameParaEmail,
    traduzirErroAuth,
    gerarIniciais,
    escaparHtml,
    login,
    solicitarAcesso,
    logout,
    hasFrontAccess,
    hasAnyFrontAccess,
    hasAdminPanelAccess,
    watchAuth,
    getCurrentState,
    mountInlineAuthBox
  };
})();
