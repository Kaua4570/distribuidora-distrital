// ============================================================
// DISTRIBUIDORA CAMPOS — acesso-secreto.js
// Gesto discreto: segurar a logo por 5 s abre o login.
//  - Nenhuma alteração visual, dica ou animação na página.
//  - Soltou antes / saiu da logo / rolou a página → cancela.
//  - O login e o Firebase Auth só são carregados DEPOIS do gesto.
// Este arquivo não guarda senha nem libera nada: a validação
// é feita pelo Firebase Authentication + regras do Firestore.
// ============================================================

const TEMPO_SEGURAR_MS = 5000;
const DESTINO = "produtos-secretos.html";

(function iniciar(){
  const logo = document.querySelector("img.logo-img");
  if (!logo) return;

  // Evita menu de contexto / pré-visualização / arrasto ao segurar (invisível ao usuário)
  logo.style.webkitTouchCallout = "none";
  logo.style.webkitUserSelect = "none";
  logo.style.userSelect = "none";
  logo.setAttribute("draggable", "false");
  logo.addEventListener("dragstart", e => e.preventDefault());
  logo.addEventListener("contextmenu", e => e.preventDefault());

  let timer = null;
  let ponteiro = null;
  let scrollInicial = 0;

  function cancelar(){
    if (timer) clearTimeout(timer);
    timer = null;
    ponteiro = null;
  }

  function dentroDaLogo(x, y){
    const r = logo.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  logo.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (timer){ cancelar(); return; }          // 2º dedo (pinça etc.) cancela
    ponteiro = e.pointerId;
    scrollInicial = window.scrollY;
    timer = setTimeout(() => {
      cancelar();
      abrirLogin();
    }, TEMPO_SEGURAR_MS);
  });

  // Listeners na janela: no toque o ponteiro fica "preso" à logo, então
  // a checagem de limites é feita manualmente.
  window.addEventListener("pointermove", (e) => {
    if (!timer || e.pointerId !== ponteiro) return;
    if (!dentroDaLogo(e.clientX, e.clientY)) cancelar();
  }, { passive: true });
  window.addEventListener("pointerup",     (e) => { if (e.pointerId === ponteiro) cancelar(); }, { passive: true });
  window.addEventListener("pointercancel", (e) => { if (e.pointerId === ponteiro) cancelar(); }, { passive: true });
  logo.addEventListener("pointerleave",    (e) => { if (e.pointerId === ponteiro) cancelar(); }, { passive: true });
  // Só a rolagem da PÁGINA cancela (rolagens internas, como a barra de
  // categorias do próprio site, não: scroll de elementos não borbulha até window).
  window.addEventListener("scroll", () => {
    if (timer && Math.abs(window.scrollY - scrollInicial) > 8) cancelar();
  }, { passive: true });
  window.addEventListener("blur", cancelar);
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancelar(); });
})();

// ============================================================
// JANELA DE LOGIN (criada só quando o gesto é concluído)
// ============================================================
let modalEl = null;
let carregandoModulos = null;

function carregarCss(){
  if (document.getElementById("cs-css")) return Promise.resolve();
  return new Promise((ok) => {
    const l = document.createElement("link");
    l.id = "cs-css"; l.rel = "stylesheet"; l.href = "produtos-secretos.css";
    l.onload = l.onerror = () => ok();
    document.head.appendChild(l);
  });
}

async function abrirLogin(){
  if (modalEl) return;
  await carregarCss();
  if (modalEl) return;
  carregandoModulos = carregandoModulos || import("./secreto-firebase.js");
  construirModal();
}

function construirModal(){
  modalEl = document.createElement("div");
  modalEl.className = "cs-overlay";
  modalEl.innerHTML = `
    <div class="cs-modal" role="dialog" aria-modal="true" aria-labelledby="cs-titulo">
      <button type="button" class="cs-fechar" aria-label="Fechar">✕</button>
      <img class="cs-logo" src="logo.png" alt="" draggable="false">
      <h2 id="cs-titulo" class="cs-titulo">Acesso restrito</h2>
      <p class="cs-sub">Entre com suas credenciais.</p>
      <form class="cs-form" novalidate autocomplete="on">
        <div class="cs-campo">
          <label for="cs-email">E-mail</label>
          <input id="cs-email" type="email" name="email" inputmode="email" autocomplete="username"
                 autocapitalize="none" autocorrect="off" spellcheck="false" required>
        </div>
        <div class="cs-campo">
          <label for="cs-senha">Senha</label>
          <div class="cs-senha-wrap">
            <input id="cs-senha" type="password" name="senha" autocomplete="current-password" required>
            <button type="button" class="cs-olho" aria-label="Mostrar senha" aria-pressed="false">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>
                <line class="cs-risco" x1="3" y1="3" x2="21" y2="21"/>
              </svg>
            </button>
          </div>
        </div>
        <p class="cs-erro" role="alert" aria-live="polite"></p>
        <button type="submit" class="btn btn-gold btn-block cs-entrar">
          <span class="cs-entrar-txt">Entrar</span>
          <span class="spinner cs-spin" hidden></span>
        </button>
      </form>
    </div>`;
  document.body.appendChild(modalEl);
  document.body.style.overflow = "hidden";

  const form  = modalEl.querySelector("form");
  const email = modalEl.querySelector("#cs-email");
  const senha = modalEl.querySelector("#cs-senha");
  const erro  = modalEl.querySelector(".cs-erro");
  const btn   = modalEl.querySelector(".cs-entrar");
  const spin  = modalEl.querySelector(".cs-spin");
  const txt   = modalEl.querySelector(".cs-entrar-txt");
  const olho  = modalEl.querySelector(".cs-olho");
  let ocupado = false;

  function fechar(){
    if (ocupado) return;
    senha.value = "";
    document.removeEventListener("keydown", aoTeclar, true);
    modalEl.remove(); modalEl = null;
    document.body.style.overflow = "";
  }
  function aoTeclar(e){
    if (e.key === "Escape") fechar();
    if (e.key === "Tab"){                       // mantém o foco dentro da janela
      const foco = [...modalEl.querySelectorAll("button:not([disabled]), input")];
      const i = foco.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0){ e.preventDefault(); foco[foco.length-1].focus(); }
      else if (!e.shiftKey && i === foco.length-1){ e.preventDefault(); foco[0].focus(); }
    }
  }
  document.addEventListener("keydown", aoTeclar, true);

  modalEl.addEventListener("click", (e) => { if (e.target === modalEl) fechar(); });
  modalEl.querySelector(".cs-fechar").addEventListener("click", fechar);

  olho.addEventListener("click", () => {
    const mostrar = senha.type === "password";
    senha.type = mostrar ? "text" : "password";
    olho.setAttribute("aria-pressed", String(mostrar));
    olho.setAttribute("aria-label", mostrar ? "Ocultar senha" : "Mostrar senha");
    olho.classList.toggle("ativo", mostrar);
    senha.focus();
  });

  function setOcupado(v){
    ocupado = v;
    btn.disabled = v; email.disabled = v; senha.disabled = v;
    spin.hidden = !v;
    txt.textContent = v ? "Entrando..." : "Entrar";
  }
  function mostrarErro(m){ erro.textContent = m; }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (ocupado) return;
    const em = email.value.trim();
    const pw = senha.value;
    mostrarErro("");
    if (!em || !pw) return mostrarErro("Informe e-mail e senha.");

    setOcupado(true);
    let fb;
    try{
      fb = await carregandoModulos;   // se falhou ao carregar, cai no catch
      const cred = await fb.signInWithEmailAndPassword(fb.auth, em, pw);
      const perfil = await fb.perfilDoUsuario(cred.user);
      if (!perfil || !perfil.ativo){
        await fb.signOut(fb.auth);
        throw { code: "cs/nao-autorizado" };   // mesma mensagem de senha errada
      }
      // cliente/admin → catálogo reservado; entregador → entregas; comanda → comandas
      window.location.href = fb.paginaInicialDo(perfil);   // mantém o overlay até a navegação
    }catch(err){
      if (!fb) carregandoModulos = null;
      setOcupado(false);
      senha.value = "";
      mostrarErro(mensagemDeErro(err));
      senha.focus();
    }
  });

  setTimeout(() => email.focus(), 50);
}

// Mensagens amigáveis e genéricas — nunca revelam se o e-mail existe,
// se a senha estava certa ou se a conta apenas não está autorizada.
function mensagemDeErro(err){
  const c = (err && err.code) || "";
  if (c === "auth/too-many-requests") return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
  if (c === "auth/network-request-failed") return "Sem conexão. Verifique sua internet e tente de novo.";
  const credenciais = ["cs/nao-autorizado","auth/invalid-credential","auth/wrong-password",
    "auth/user-not-found","auth/invalid-email","auth/user-disabled","auth/missing-password"];
  if (credenciais.includes(c)) return "E-mail ou senha incorretos.";
  return "Não foi possível entrar agora. Tente novamente.";
}
