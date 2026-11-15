(function () {
  'use strict';

  var INTERESTS = [
    { id: 'Copy Trade B3', label: 'Copy Trade B3' },
    { id: 'Sinais Forex & Ouro', label: 'Sinais Forex & Ouro' },
    { id: 'Análises & Studio', label: 'Análises & Studio' },
    { id: 'Notícias & Aprendizado', label: 'Notícias & Aprendizado' }
  ];

  var supabaseClient = null;
  var selectedInterest = '';
  var pendingConfirmEmail = '';
  var resendCooldownUntil = 0;
  var resendTimerId = null;

  function $(id) {
    return document.getElementById(id);
  }

  function loginUrl() {
    return window.LUIGI_APP_LOGIN_URL || 'https://app.ctinvest.com.br/login';
  }

  function configReady() {
    var url = window.LUIGI_SUPABASE_URL || '';
    var key = window.LUIGI_SUPABASE_ANON_KEY || '';
    return url && key && url.indexOf('[YOUR_') === -1 && key.indexOf('[YOUR_') === -1;
  }

  function ensureClient() {
    if (supabaseClient) return supabaseClient;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('Biblioteca Supabase não carregada.');
    }
    if (!configReady()) {
      throw new Error('Configure LUIGI_SUPABASE_URL e LUIGI_SUPABASE_ANON_KEY em assets/js/supabase-config.js.');
    }
    supabaseClient = window.supabase.createClient(
      window.LUIGI_SUPABASE_URL,
      window.LUIGI_SUPABASE_ANON_KEY
    );
    return supabaseClient;
  }

  function onlyDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function formatWhatsApp(value) {
    var d = onlyDigits(value).slice(0, 11);
    if (d.length <= 2) return d.length ? '(' + d : '';
    if (d.length <= 7) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }

  function setAlert(message, type) {
    var el = $('authAlert');
    if (!el) return;
    if (!message) {
      el.textContent = '';
      el.className = 'hidden text-xs rounded-lg px-3 py-2 border mb-4';
      return;
    }
    var styles = type === 'success'
      ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300'
      : type === 'warn'
        ? 'bg-amber-950/40 border-amber-800 text-amber-200'
        : 'bg-rose-950/40 border-rose-800 text-rose-200';
    el.className = 'text-xs rounded-lg px-3 py-2 border mb-4 ' + styles;
    el.textContent = message;
  }

  function setLoading(btn, loading, label) {
    if (!btn) return;
    btn.disabled = !!loading;
    btn.dataset.loading = loading ? '1' : '0';
    if (loading) {
      btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
      btn.textContent = label || 'Aguarde...';
      btn.classList.add('opacity-70', 'cursor-wait');
    } else {
      btn.textContent = btn.dataset.originalText || btn.textContent;
      btn.classList.remove('opacity-70', 'cursor-wait');
    }
  }

  function showPanel(mode) {
    var signup = $('authPanelSignup');
    var confirm = $('authPanelConfirm');
    var headerSub = $('authModalSubtitle');
    if (signup) signup.classList.toggle('hidden', mode !== 'signup');
    if (confirm) confirm.classList.toggle('hidden', mode !== 'confirm');
    if (headerSub) {
      headerSub.textContent = mode === 'confirm'
        ? 'Quase lá — confirme o e-mail para ativar o acesso.'
        : 'Crie sua conta gratuita para acessar o workspace.';
    }
  }

  function interestChipClass(active) {
    return active
      ? 'px-3 py-2 rounded-full text-[11px] font-semibold border border-emerald-500/60 bg-emerald-500/15 text-emerald-300 transition-all'
      : 'px-3 py-2 rounded-full text-[11px] font-semibold border border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500 transition-all';
  }

  function renderInterestChips() {
    var wrap = $('signupInterestChips');
    if (!wrap) return;
    wrap.innerHTML = '';
    INTERESTS.forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = interestChipClass(item.id === selectedInterest);
      btn.textContent = item.label;
      btn.addEventListener('click', function () {
        selectedInterest = item.id;
        renderInterestChips();
      });
      wrap.appendChild(btn);
    });
  }

  function togglePasswordVisibility(inputId, btnId) {
    var input = $(inputId);
    var btn = $(btnId);
    if (!input || !btn) return;
    var showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
    btn.textContent = showing ? 'Mostrar' : 'Ocultar';
  }

  function updateResendButton() {
    var btn = $('btnResendConfirm');
    if (!btn) return;
    var now = Date.now();
    if (now >= resendCooldownUntil) {
      btn.disabled = false;
      btn.textContent = 'Reenviar e-mail de confirmação';
      btn.classList.remove('opacity-60', 'cursor-not-allowed');
      return;
    }
    var secs = Math.ceil((resendCooldownUntil - now) / 1000);
    btn.disabled = true;
    btn.textContent = 'Reenviar em ' + secs + 's';
    btn.classList.add('opacity-60', 'cursor-not-allowed');
  }

  function startResendCooldown(seconds) {
    resendCooldownUntil = Date.now() + (seconds * 1000);
    updateResendButton();
    if (resendTimerId) clearInterval(resendTimerId);
    resendTimerId = setInterval(function () {
      updateResendButton();
      if (Date.now() >= resendCooldownUntil) {
        clearInterval(resendTimerId);
        resendTimerId = null;
      }
    }, 250);
  }

  function showConfirmScreen(email) {
    pendingConfirmEmail = email;
    var emailEl = $('confirmEmailText');
    if (emailEl) emailEl.textContent = email;
    setAlert('');
    showPanel('confirm');
    startResendCooldown(30);
  }

  function translateAuthError(error) {
    var msg = (error && (error.message || error.error_description || error.msg)) || '';
    var lower = String(msg).toLowerCase();
    if (lower.indexOf('user already registered') !== -1) {
      return 'Este e-mail já possui cadastro. Entre no Luigi com sua conta.';
    }
    if (lower.indexOf('password') !== -1 && lower.indexOf('least') !== -1) {
      return 'A senha deve ter pelo menos 8 caracteres.';
    }
    return msg || 'Não foi possível concluir a solicitação. Tente novamente.';
  }

  async function handleSignup(event) {
    event.preventDefault();
    setAlert('');

    var firstName = ($('signupFirstName') || {}).value || '';
    var lastName = ($('signupLastName') || {}).value || '';
    var email = ($('signupEmail') || {}).value || '';
    var whatsapp = ($('signupWhatsapp') || {}).value || '';
    var password = ($('signupPassword') || {}).value || '';
    var terms = ($('signupTerms') || {}).checked;
    var marketingOptIn = !!($('signupMarketing') || {}).checked;
    var btn = $('btnSignupSubmit');

    if (!firstName.trim() || !lastName.trim()) {
      setAlert('Informe nome e sobrenome.', 'error');
      return;
    }
    if (!email.trim()) {
      setAlert('Informe um e-mail válido.', 'error');
      return;
    }
    if (!selectedInterest) {
      setAlert('Selecione seu principal interesse.', 'error');
      return;
    }
    if (!password || password.length < 8) {
      setAlert('A senha deve ter pelo menos 8 caracteres.', 'error');
      return;
    }
    if (!terms) {
      setAlert('É necessário aceitar os Termos de Uso e a Política de Privacidade.', 'error');
      return;
    }

    try {
      setLoading(btn, true, 'Criando conta...');
      var client = ensureClient();
      var whatsappDigits = onlyDigits(whatsapp);
      var signupResult = await client.auth.signUp({
        email: email.trim(),
        password: password,
        options: {
          emailRedirectTo: loginUrl(),
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            full_name: firstName.trim() + ' ' + lastName.trim(),
            whatsapp: whatsappDigits || null,
            primary_interest: selectedInterest,
            marketing_opt_in: marketingOptIn,
            terms_accepted: true,
            terms_accepted_at: new Date().toISOString(),
            signup_source: 'ctinvest_web'
          }
        }
      });

      if (signupResult.error) {
        setAlert(translateAuthError(signupResult.error), 'error');
        return;
      }

      showConfirmScreen(email.trim());
    } catch (err) {
      setAlert(err.message || 'Erro ao criar conta.', 'error');
    } finally {
      setLoading(btn, false);
    }
  }

  async function handleResendConfirm() {
    if (!pendingConfirmEmail) {
      setAlert('Informe um e-mail para reenviar a confirmação.', 'error');
      return;
    }
    if (Date.now() < resendCooldownUntil) return;

    try {
      var client = ensureClient();
      var resendResult = await client.auth.resend({
        type: 'signup',
        email: pendingConfirmEmail,
        options: { emailRedirectTo: loginUrl() }
      });
      if (resendResult.error) {
        setAlert(translateAuthError(resendResult.error), 'error');
        return;
      }
      setAlert('E-mail de confirmação reenviado para ' + pendingConfirmEmail + '.', 'success');
      startResendCooldown(30);
    } catch (err) {
      setAlert(err.message || 'Erro ao reenviar confirmação.', 'error');
    }
  }

  function openModal() {
    var modal = $('loginModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    setAlert('');
    showPanel('signup');
  }

  function closeModal() {
    var modal = $('loginModal');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    setAlert('');
  }

  function bindExistingLoginLinks() {
    var href = loginUrl();
    document.querySelectorAll('[data-luigi-login]').forEach(function (el) {
      if (el.tagName === 'A') el.setAttribute('href', href);
    });
  }

  function bindEvents() {
    var modal = $('loginModal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeModal();
      });
    }

    var closeBtn = $('authCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    var signupForm = $('signupForm');
    if (signupForm) signupForm.addEventListener('submit', handleSignup);

    var resendBtn = $('btnResendConfirm');
    if (resendBtn) resendBtn.addEventListener('click', handleResendConfirm);

    var whatsapp = $('signupWhatsapp');
    if (whatsapp) {
      whatsapp.addEventListener('input', function () {
        whatsapp.value = formatWhatsApp(whatsapp.value);
      });
    }

    var toggleSignupPass = $('toggleSignupPassword');
    if (toggleSignupPass) {
      toggleSignupPass.addEventListener('click', function () {
        togglePasswordVisibility('signupPassword', 'toggleSignupPassword');
      });
    }
  }

  window.openModal = openModal;
  window.closeModal = closeModal;
  window.openAuthSignup = openModal;

  document.addEventListener('DOMContentLoaded', function () {
    renderInterestChips();
    bindEvents();
    bindExistingLoginLinks();
    showPanel('signup');
  });
})();
