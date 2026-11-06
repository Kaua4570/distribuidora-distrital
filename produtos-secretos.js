// ============================================================
// DISTRIBUIDORA CAMPOS — produtos-secretos.js
// Catálogo reservado (somente leitura). Fluxo:
//   1. Firebase Auth confirma o login (sem login → volta ao início).
//   2. Firestore confirma que o UID está em usuarios_autorizados.
//   3. Só então lê produtos_secretos / categorias_secretas (as REGRAS
//      do Firestore também barram quem não for autorizado).
//   4. Se a sessão cair ou a autorização for revogada, tudo é apagado
//      da tela imediatamente e o usuário volta ao início.
// Cadastro e edição: engrenagem ⚙️ (só admin) → painel → "Tela secreta".
// ============================================================
import {
  auth, db, doc, onSnapshot, collection, signOut, onAuthStateChanged,
  usuarioAutorizado, COL_PRODUTOS_SECRETOS, COL_CATEGORIAS_SECRETAS, COL_USUARIOS_AUTORIZADOS
} from "./secreto-firebase.js";

const SAIDA = "index.html";
const PAINEL = "admin.html?modo=secreta";

const elPorteiro = document.getElementById("ps-porteiro");
const elApp      = document.getElementById("ps-app");
const elUsuario  = document.getElementById("ps-usuario");
const elGrade    = document.getElementById("ps-grade");
const elCats     = document.getElementById("ps-cats");
const elBusca    = document.getElementById("ps-busca");
const elConta    = document.getElementById("ps-contagem");
const elAdmin    = document.getElementById("ps-admin");

let produtos = [];
let categorias = [];            // [{id, nome, ordem}]
let categoriaAtiva = "__todas__";
let termo = "";
let cancelarProdutos = null;
let cancelarCategorias = null;
let cancelarAutorizacao = null;
let encerrado = false;
let iniciado = false;

// ---------------- Utilitários ----------------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const normalizar = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const real = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const urlImagemSegura = (u) => /^(https:\/\/|data:image\/(png|jpe?g|webp|gif);base64,)/i.test(u || "") ? u : "";

const ICONE_VAZIO = `<svg viewBox="0 0 24 24" width="38" height="38"><path fill="currentColor" d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm7 9l-3 4h10l-4-5-2 3-1-2z"/></svg>`;

// ---------------- Bloqueio imediato ----------------
function bloquearETirarDaTela(){
  if (encerrado) return;
  encerrado = true;
  try{ cancelarProdutos && cancelarProdutos(); }catch(_){}
  try{ cancelarCategorias && cancelarCategorias(); }catch(_){}
  try{ cancelarAutorizacao && cancelarAutorizacao(); }catch(_){}
  produtos = []; categorias = [];
  elGrade.innerHTML = ""; elCats.innerHTML = ""; elConta.textContent = "";
  document.querySelectorAll(".ps-detalhe-fundo").forEach(n => n.remove());
  elAdmin.hidden = true;
  elApp.hidden = true;
  elPorteiro.hidden = false;
  window.location.replace(SAIDA);
}

async function sairEBloquear(){
  try{ await signOut(auth); }catch(_){}
  bloquearETirarDaTela();
}

// ---------------- Início: porteiro ----------------
onAuthStateChanged(auth, async (user) => {
  if (!user){ bloquearETirarDaTela(); return; }      // sem sessão / saiu da conta
  if (iniciado) return;                              // já iniciado
  iniciado = true;

  const ok = await usuarioAutorizado(user);
  if (!ok){ await sairEBloquear(); return; }
  if (!auth.currentUser){ iniciado = false; return; }

  elUsuario.textContent = user.email || "";
  elPorteiro.hidden = true;
  elApp.hidden = false;

  // Se a autorização for removida/desativada, derruba a sessão na hora.
  // Também mostra a engrenagem só para quem tem admin: true.
  cancelarAutorizacao = onSnapshot(
    doc(db, COL_USUARIOS_AUTORIZADOS, user.uid),
    (snap) => {
      if (!snap.exists() || snap.data().ativo !== true){ sairEBloquear(); return; }
      elAdmin.hidden = snap.data().admin !== true;
    },
    () => sairEBloquear()
  );

  // Categorias da tela secreta (criadas no painel). Se falhar, os produtos
  // ainda aparecem; só não ordena/agrupa por categoria.
  cancelarCategorias = onSnapshot(
    collection(db, COL_CATEGORIAS_SECRETAS),
    (snap) => {
      categorias = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      render();
    },
    (err) => console.error("Categorias secretas:", err.code)
  );

  cancelarProdutos = onSnapshot(
    collection(db, COL_PRODUTOS_SECRETOS),
    (snap) => {
      produtos = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.visivel !== false);
      render();
    },
    (err) => {
      console.error("Acesso negado ou erro ao carregar:", err.code);
      if (err.code === "permission-denied") sairEBloquear();
      else elGrade.innerHTML = `<p class="ps-vazio">Não foi possível carregar agora. Tente novamente em instantes.</p>`;
    }
  );
});

document.getElementById("ps-sair").addEventListener("click", sairEBloquear);
elAdmin.addEventListener("click", () => { window.location.href = PAINEL; });

// Voltar pelo histórico (bfcache) após sair não pode mostrar a área em cache.
window.addEventListener("pageshow", (e) => { if (e.persisted && !auth.currentUser) bloquearETirarDaTela(); });

// ---------------- Render ----------------
const nomeCategoria = (p) => categorias.find(c => c.id === p.categoriaId)?.nome || p.categoria || "";

// Categorias (na ordem definida no painel) que têm pelo menos um produto visível
function categoriasDisponiveis(){
  return [...categorias]
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
    .filter(c => produtos.some(p => p.categoriaId === c.id));
}

function renderCategorias(){
  const cats = categoriasDisponiveis();
  if (categoriaAtiva !== "__todas__" && !cats.some(c => c.id === categoriaAtiva)) categoriaAtiva = "__todas__";
  const pill = (id, nome) =>
    `<button type="button" class="cat-pill ${id === categoriaAtiva ? "ativa" : ""}" data-cat="${esc(id)}">${esc(nome)}</button>`;
  elCats.innerHTML = pill("__todas__", "Todos") + cats.map(c => pill(c.id, c.nome)).join("");
}

function filtrados(){
  const b = normalizar(termo);
  return produtos
    .filter(p => categoriaAtiva === "__todas__" || p.categoriaId === categoriaAtiva)
    .filter(p => !b || normalizar(`${p.nome} ${p.volume} ${p.descricao} ${nomeCategoria(p)}`).includes(b))
    .sort((a, c) => (a.ordem || 0) - (c.ordem || 0) || String(a.nome).localeCompare(String(c.nome), "pt-BR"));
}

function render(){
  if (encerrado) return;
  renderCategorias();
  const lista = filtrados();
  elConta.textContent = lista.length ? `${lista.length} ${lista.length === 1 ? "produto" : "produtos"}` : "";
  if (!lista.length){
    elGrade.innerHTML = `<p class="ps-vazio">${produtos.length ? "Nenhum produto encontrado." : "Nenhum produto cadastrado ainda."}</p>`;
    return;
  }
  elGrade.innerHTML = lista.map(cardHTML).join("");
}

function fotoHTML(p, classe = "ps-foto"){
  const src = urlImagemSegura(p.imagemUrl);
  return src
    ? `<img class="${classe}" src="${esc(src)}" alt="${esc(p.nome)}" loading="lazy" referrerpolicy="no-referrer">`
    : `<div class="ps-foto-vazia">${ICONE_VAZIO}</div>`;
}

// texto curto: volume (campo do painel) ou descrição (produtos antigos)
const textoCurto = (p) => p.volume || p.descricao || "";

function cardHTML(p){
  const disp = p.disponivel !== false;
  const cat = nomeCategoria(p);
  return `
    <button type="button" class="ps-card ${disp ? "" : "indisponivel"}" data-id="${esc(p.id)}">
      ${fotoHTML(p)}
      <div class="ps-info">
        ${cat ? `<span class="ps-cat">${esc(cat)}</span>` : ""}
        <span class="ps-nome">${esc(p.nome)}</span>
        ${textoCurto(p) ? `<span class="ps-desc">${esc(textoCurto(p))}</span>` : ""}
        <div class="ps-rodape-card">
          <span class="ps-preco">${real(p.preco)}</span>
          <span class="ps-tag ${disp ? "ok" : "off"}">${disp ? "DISPONÍVEL" : "INDISPONÍVEL"}</span>
        </div>
      </div>
    </button>`;
}

// Fotos quebradas viram o ícone padrão
elGrade.addEventListener("error", (e) => {
  if (e.target.tagName === "IMG"){
    const v = document.createElement("div");
    v.className = "ps-foto-vazia"; v.innerHTML = ICONE_VAZIO;
    e.target.replaceWith(v);
  }
}, true);

// ---------------- Interações ----------------
elCats.addEventListener("click", (e) => {
  const b = e.target.closest(".cat-pill");
  if (!b) return;
  categoriaAtiva = b.dataset.cat;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
elBusca.addEventListener("input", (e) => { termo = e.target.value; render(); });

elGrade.addEventListener("click", (e) => {
  const c = e.target.closest(".ps-card");
  if (!c) return;
  const p = produtos.find(x => x.id === c.dataset.id);
  if (p) abrirDetalhe(p);
});

function abrirDetalhe(p){
  const disp = p.disponivel !== false;
  const cat = nomeCategoria(p);
  const f = document.createElement("div");
  f.className = "ps-detalhe-fundo";
  f.innerHTML = `
    <div class="ps-detalhe" role="dialog" aria-modal="true" aria-label="${esc(p.nome)}">
      <button type="button" class="ps-detalhe-fechar" aria-label="Fechar">✕</button>
      ${fotoHTML(p)}
      <div class="ps-detalhe-corpo">
        ${cat ? `<span class="ps-cat">${esc(cat)}</span>` : ""}
        <h2>${esc(p.nome)}</h2>
        <div class="ps-detalhe-preco">${real(p.preco)}</div>
        <div><span class="ps-tag ${disp ? "ok" : "off"}">${disp ? "DISPONÍVEL" : "INDISPONÍVEL"}</span></div>
        ${p.volume ? `<p>${esc(p.volume)}</p>` : ""}
        ${p.descricao ? `<p>${esc(p.descricao)}</p>` : ""}
      </div>
    </div>`;
  const fechar = () => { f.remove(); document.removeEventListener("keydown", tecla); };
  const tecla = (e) => { if (e.key === "Escape") fechar(); };
  f.addEventListener("click", (e) => { if (e.target === f) fechar(); });
  f.querySelector(".ps-detalhe-fechar").addEventListener("click", fechar);
  f.querySelector("img.ps-foto")?.addEventListener("error", (e) => {
    const v = document.createElement("div"); v.className = "ps-foto-vazia"; v.innerHTML = ICONE_VAZIO; e.target.replaceWith(v);
  });
  document.addEventListener("keydown", tecla);
  document.body.appendChild(f);
}
