// ============================================================================
// MOTOR DE INSTALAÇÃO PWA INDEPENDENTE PARA PORTAIS DE CAMPO
// (ronda.html, limpeza.html, guarda.html) — Zero interferência com index.html
// ============================================================================
(function () {
  'use strict';

  const scriptEl = document.currentScript;
  const appName = (scriptEl && scriptEl.dataset.appName) || 'App de Campo GEL';
  const appSub = (scriptEl && scriptEl.dataset.appSub) || 'Aplicativo dedicado sem conflito com a Gestão';
  const appIcon = (scriptEl && scriptEl.dataset.appIcon) || 'icon-192.png';
  const accentColor = (scriptEl && scriptEl.dataset.accent) || 'teal';

  const ACCENTS = {
    teal: { btn: 'bg-teal-500 hover:bg-teal-400 text-slate-950', border: 'border-teal-500/40', txt: 'text-teal-300' },
    emerald: { btn: 'bg-emerald-500 hover:bg-emerald-400 text-slate-950', border: 'border-emerald-500/40', txt: 'text-emerald-300' },
    indigo: { btn: 'bg-indigo-500 hover:bg-indigo-400 text-white', border: 'border-indigo-500/40', txt: 'text-indigo-300' }
  };
  const theme = ACCENTS[accentColor] || ACCENTS.teal;

  let deferredPrompt = null;

  function jaInstalado() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function atualizarBotoes() {
    const instalado = jaInstalado();
    document.querySelectorAll('[data-pwa-install-btn]').forEach(el => {
      el.classList.toggle('hidden', instalado);
    });
  }

  function criarModalSeNecessario() {
    if (document.getElementById('modalInstallPortalPwa')) return;
    const div = document.createElement('div');
    div.id = 'modalInstallPortalPwa';
    div.className = 'fixed inset-0 z-[95] bg-slate-950/85 backdrop-blur-sm hidden flex items-end sm:items-center justify-center p-0 sm:p-4';
    div.onclick = fecharModal;
    div.innerHTML = `
      <div onclick="event.stopPropagation()" class="bg-slate-900 border border-slate-700 w-full max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl">
        <div class="p-5 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <img src="${appIcon}" alt="${appName}" class="w-12 h-12 rounded-2xl border ${theme.border} shadow-md flex-shrink-0">
            <div class="min-w-0">
              <h3 class="text-sm font-black text-white truncate">Instalar "${appName}"</h3>
              <p class="text-[11px] ${theme.txt} font-semibold truncate">${appSub}</p>
            </div>
          </div>
          <button type="button" onclick="window.PwaPortal.fecharModal()" class="text-slate-400 hover:text-white p-1.5">
            <i class="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>
        <div class="p-5 space-y-4">
          <div id="pwaPortalGuiaIos" class="hidden space-y-2 text-xs text-slate-200">
            <p class="font-bold text-amber-300 uppercase text-[11px] tracking-wider"><i class="fa-brands fa-apple mr-1"></i> Instalar no iPhone (Safari):</p>
            <div class="p-3 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-1.5 leading-relaxed">
              <p>1. Toque em <strong>Compartilhar</strong> (<i class="fa-solid fa-arrow-up-from-bracket text-sky-400 mx-0.5"></i>) na barra inferior.</p>
              <p>2. Escolha <strong>"Adicionar à Tela de Início"</strong>.</p>
              <p>3. Confirme em <strong>"Adicionar"</strong>. Ele ficará com ícone próprio!</p>
            </div>
          </div>
          <div id="pwaPortalGuiaAndroid" class="space-y-2 text-xs text-slate-200">
            <p class="font-bold text-emerald-400 uppercase text-[11px] tracking-wider"><i class="fa-brands fa-android mr-1"></i> Instalar no Android (Chrome):</p>
            <div class="p-3 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-1.5 leading-relaxed">
              <p>1. Toque nos <strong>3 pontinhos (⋮)</strong> no canto superior direito do Chrome.</p>
              <p>2. Toque em <strong>"Instalar aplicativo"</strong> ou <strong>"Adicionar à tela inicial"</strong>.</p>
              <p>3. Confirme em <strong>"Instalar"</strong> — o ícone exclusivo <strong>${appName}</strong> será criado sem interferir na Gestão!</p>
            </div>
          </div>
          <button type="button" onclick="window.PwaPortal.fecharModal()" class="w-full h-11 rounded-xl ${theme.btn} font-black text-xs uppercase transition">
            Entendi
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(div);
  }

  function fecharModal() {
    const m = document.getElementById('modalInstallPortalPwa');
    if (m) m.classList.add('hidden');
  }

  async function instalar() {
    if (jaInstalado()) return;
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const res = await deferredPrompt.userChoice;
        if (res && res.outcome === 'accepted') {
          deferredPrompt = null;
          atualizarBotoes();
        }
        return;
      } catch (e) {
        console.warn('[PwaPortal] Erro prompt nativo:', e);
      }
    }
    criarModalSeNecessario();
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const bIos = document.getElementById('pwaPortalGuiaIos');
    const bAnd = document.getElementById('pwaPortalGuiaAndroid');
    if (bIos) bIos.classList.toggle('hidden', !isIos);
    if (bAnd) bAnd.classList.toggle('hidden', isIos);
    const m = document.getElementById('modalInstallPortalPwa');
    if (m) m.classList.remove('hidden');
  }

  function init() {
    atualizarBotoes();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      atualizarBotoes();
    });
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      atualizarBotoes();
      fecharModal();
    });
  }

  window.PwaPortal = { instalar, fecharModal };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
