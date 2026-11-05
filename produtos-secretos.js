// ============================================================
// DISTRIBUIDORA CAMPOS — produtos-secretos.js
// Catálogo reservado. Fluxo:
//   1. Firebase Auth confirma o login (sem login → volta ao início).
//   2. Firestore confirma que o UID está em usuarios_autorizados.
//   3. Só então lê produtos_secretos (as REGRAS do Firestore também
//      barram quem não for autorizado, mesmo fora desta página).
//   4. Se a sessão cair ou a autorização for revogada, tudo é apagado
//      da tela imediatamente e o usuário volta ao início.
// ============================================================
import {
  auth, db, doc, onSnapshot, collection, signOut, onAuthStateChanged,
  usuarioAutorizado, COL_PRODUTOS_SECRETOS, COL_USUARIOS_AUTORIZADOS,
  addDoc, updateDoc, deleteDoc, serverTimestamp
} from "./secreto-firebase.js";

const SAIDA = "index.html";

const elPorteiro = document.getElementById("ps-porteiro");
const elApp      = document.getElementById("ps-app");
const elUsuario  = document.getElementById("ps-usuario");
const elGrade    = document.getElementById("ps-grade");
const elCats     = document.getElementById("ps-cats");
const elBusca    = document.getElementById("ps-busca");
const elConta    = document.getElementById("ps-contagem");
const elNovo     = document.getElementById("ps-novo");
const elToast    = document.getElementById("toast");

let produtos = [];
let categoriaAtiva = "__todas__";
let termo = "";
let cancelarProdutos = null;
let cancelarAutorizacao = null;
let encerrado = false;
let iniciado = false;
let ehAdmin = false;

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
  try{ cancelarAutorizacao && cancelarAutorizacao(); }catch(_){}
  produtos = [];
  elGrade.innerHTML = ""; elCats.innerHTML = ""; elConta.textContent = "";
  document.querySelectorAll(".ps-detalhe-fundo").forEach(n => n.remove());
  ehAdmin = false; elNovo.hidden = true;
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
  cancelarAutorizacao = onSnapshot(
    doc(db, COL_USUARIOS_AUTORIZADOS, user.uid),
    (snap) => {
      if (!snap.exists() || snap.data().ativo !== true){ sairEBloquear(); return; }
      ehAdmin = snap.data().admin === true;
      elNovo.hidden = !ehAdmin;
    },
    () => sairEBloquear()
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

// Voltar pelo histórico (bfcache) após sair não pode mostrar a área em cache.
window.addEventListener("pageshow", (e) => { if (e.persisted && !auth.currentUser) bloquearETirarDaTela(); });

// ---------------- Render ----------------
function categoriasDisponiveis(){
  const set = new Set();
  produtos.forEach(p => { if (p.categoria) set.add(String(p.categoria)); });
  return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function renderCategorias(){
  const cats = categoriasDisponiveis();
  if (categoriaAtiva !== "__todas__" && !cats.includes(categoriaAtiva)) categoriaAtiva = "__todas__";
  const pill = (id, nome) =>
    `<button type="button" class="cat-pill ${id === categoriaAtiva ? "ativa" : ""}" data-cat="${esc(id)}">${esc(nome)}</button>`;
  elCats.innerHTML = pill("__todas__", "Todos") + cats.map(c => pill(c, c)).join("");
}

function filtrados(){
  const b = normalizar(termo);
  return produtos
    .filter(p => categoriaAtiva === "__todas__" || String(p.categoria) === categoriaAtiva)
    .filter(p => !b || normalizar(`${p.nome} ${p.descricao} ${p.categoria}`).includes(b))
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

function cardHTML(p){
  const disp = p.disponivel !== false;
  return `
    <button type="button" class="ps-card ${disp ? "" : "indisponivel"}" data-id="${esc(p.id)}">
      ${fotoHTML(p)}
      <div class="ps-info">
        ${p.categoria ? `<span class="ps-cat">${esc(p.categoria)}</span>` : ""}
        <span class="ps-nome">${esc(p.nome)}</span>
        ${p.descricao ? `<span class="ps-desc">${esc(p.descricao)}</span>` : ""}
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
  const f = document.createElement("div");
  f.className = "ps-detalhe-fundo";
  f.innerHTML = `
    <div class="ps-detalhe" role="dialog" aria-modal="true" aria-label="${esc(p.nome)}">
      <button type="button" class="ps-detalhe-fechar" aria-label="Fechar">✕</button>
      ${fotoHTML(p)}
      <div class="ps-detalhe-corpo">
        ${p.categoria ? `<span class="ps-cat">${esc(p.categoria)}</span>` : ""}
        <h2>${esc(p.nome)}</h2>
        <div class="ps-detalhe-preco">${real(p.preco)}</div>
        <div><span class="ps-tag ${disp ? "ok" : "off"}">${disp ? "DISPONÍVEL" : "INDISPONÍVEL"}</span></div>
        ${p.descricao ? `<p>${esc(p.descricao)}</p>` : ""}
        ${ehAdmin ? `<button type="button" class="btn btn-gold btn-block ps-editar" style="margin-top:10px">Editar produto</button>` : ""}
      </div>
    </div>`;
  const fechar = () => { f.remove(); document.removeEventListener("keydown", tecla); };
  const tecla = (e) => { if (e.key === "Escape") fechar(); };
  f.addEventListener("click", (e) => { if (e.target === f) fechar(); });
  f.querySelector(".ps-detalhe-fechar").addEventListener("click", fechar);
  f.querySelector(".ps-editar")?.addEventListener("click", () => { fechar(); abrirFormulario(p); });
  f.querySelector("img.ps-foto")?.addEventListener("error", (e) => {
    const v = document.createElement("div"); v.className = "ps-foto-vazia"; v.innerHTML = ICONE_VAZIO; e.target.replaceWith(v);
  });
  document.addEventListener("keydown", tecla);
  document.body.appendChild(f);
}

// ============================================================
// GERENCIAR PRODUTOS (só contas com admin: true em usuarios_autorizados)
// As regras do Firestore também exigem isso — esconder o botão é só conforto.
// ============================================================
function toast(msg, erro = false){
  elToast.textContent = msg;
  elToast.classList.toggle("erro", erro);
  elToast.classList.add("mostrar");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => elToast.classList.remove("mostrar"), 3200);
}

// "12,50" | "1.234,56" | "12.5" → número
function lerPreco(txt){
  let t = String(txt).trim().replace(/[^\d.,]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return t !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

// Foto → JPEG comprimido em Base64 (máx. 600px), igual à abordagem do painel atual
function comprimirFoto(arquivo, max = 600, qualidade = 0.78){
  return new Promise((ok, falha) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * r));
      c.height = Math.max(1, Math.round(img.height * r));
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok(c.toDataURL("image/jpeg", qualidade));
    };
    img.onerror = () => { URL.revokeObjectURL(url); falha(new Error("imagem")); };
    img.src = url;
  });
}

elNovo.addEventListener("click", () => abrirFormulario(null));

function abrirFormulario(p){
  if (!ehAdmin) return;
  const novo = !p;
  let imagem = p?.imagemUrl || "";
  const cats = categoriasDisponiveis();
  const f = document.createElement("div");
  f.className = "ps-detalhe-fundo";
  f.innerHTML = `
    <form class="ps-detalhe ps-form" role="dialog" aria-modal="true" novalidate>
      <button type="button" class="ps-detalhe-fechar" aria-label="Fechar">✕</button>
      <h2 class="ps-form-titulo">${novo ? "Novo produto" : "Editar produto"}</h2>
      <div class="ps-form-corpo">
        <div class="ps-foto-box">
          <div class="ps-foto-previa"></div>
          <div class="ps-foto-botoes">
            <label class="btn btn-outline btn-sm">Escolher foto
              <input type="file" accept="image/*" hidden>
            </label>
            <button type="button" class="btn btn-ghost btn-sm ps-foto-remover">Remover</button>
          </div>
        </div>
        <div class="campo"><label for="pf-nome">Nome*</label>
          <input id="pf-nome" type="text" maxlength="120" autocomplete="off" value="${esc(p?.nome || "")}"></div>
        <div class="campo"><label for="pf-cat">Categoria*</label>
          <input id="pf-cat" type="text" maxlength="60" list="pf-cats" autocomplete="off" value="${esc(p?.categoria || "")}">
          <datalist id="pf-cats">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist></div>
        <div class="ps-form-linha">
          <div class="campo"><label for="pf-preco">Preço (R$)*</label>
            <input id="pf-preco" type="text" inputmode="decimal" autocomplete="off" value="${p ? String(p.preco ?? "").replace(".", ",") : ""}"></div>
          <div class="campo"><label for="pf-ordem">Ordem</label>
            <input id="pf-ordem" type="number" inputmode="numeric" value="${p?.ordem ?? ""}"></div>
        </div>
        <div class="campo"><label for="pf-desc">Descrição</label>
          <textarea id="pf-desc" maxlength="1000">${esc(p?.descricao || "")}</textarea></div>
        <label class="checkbox-confirma"><input type="checkbox" id="pf-disp" ${p?.disponivel === false ? "" : "checked"}><span>Disponível</span></label>
        <label class="checkbox-confirma" style="margin-top:8px"><input type="checkbox" id="pf-vis" ${p?.visivel === false ? "" : "checked"}><span>Visível no catálogo</span></label>
        <p class="ps-form-erro" role="alert"></p>
        <button type="submit" class="btn btn-gold btn-block ps-salvar"><span class="ps-salvar-txt">Salvar</span><span class="spinner" hidden style="width:16px;height:16px"></span></button>
        ${novo ? "" : `<button type="button" class="btn btn-danger btn-block ps-excluir" style="margin-top:10px">Excluir produto</button>`}
      </div>
    </form>`;
  document.body.appendChild(f);

  const q = (s) => f.querySelector(s);
  const erroEl = q(".ps-form-erro");
  const previa = q(".ps-foto-previa");
  let ocupado = false;

  function mostrarPrevia(){
    const src = urlImagemSegura(imagem);
    previa.innerHTML = src ? `<img src="${esc(src)}" alt="">` : `<div class="ps-foto-vazia">${ICONE_VAZIO}</div>`;
    q(".ps-foto-remover").hidden = !src;
  }
  mostrarPrevia();

  const fechar = () => { if (ocupado) return; f.remove(); document.removeEventListener("keydown", tecla); };
  const tecla = (e) => { if (e.key === "Escape") fechar(); };
  document.addEventListener("keydown", tecla);
  q(".ps-detalhe-fechar").addEventListener("click", fechar);
  f.addEventListener("click", (e) => { if (e.target === f) fechar(); });

  q('input[type=file]').addEventListener("change", async (e) => {
    const arq = e.target.files[0]; e.target.value = "";
    if (!arq) return;
    erroEl.textContent = "";
    try{ imagem = await comprimirFoto(arq); mostrarPrevia(); }
    catch(_){ erroEl.textContent = "Não foi possível ler essa imagem."; }
  });
  q(".ps-foto-remover").addEventListener("click", () => { imagem = ""; mostrarPrevia(); });

  function ocupar(v){
    ocupado = v;
    f.querySelectorAll("button, input, textarea").forEach(el => el.disabled = v);
    q(".spinner").hidden = !v;
    q(".ps-salvar-txt").textContent = v ? "Salvando..." : "Salvar";
  }

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (ocupado) return;
    const nome = q("#pf-nome").value.trim();
    const categoria = q("#pf-cat").value.trim();
    const preco = lerPreco(q("#pf-preco").value);
    const ordemTxt = q("#pf-ordem").value.trim();
    if (!nome) return erroEl.textContent = "Informe o nome do produto.";
    if (!categoria) return erroEl.textContent = "Informe a categoria.";
    if (preco === null) return erroEl.textContent = "Informe um preço válido (ex: 12,50).";
    const dados = {
      nome, categoria, preco,
      descricao: q("#pf-desc").value.trim(),
      imagemUrl: imagem,
      disponivel: q("#pf-disp").checked,
      visivel: q("#pf-vis").checked,
      ordem: ordemTxt === "" ? 0 : Number(ordemTxt),
      atualizadoEm: serverTimestamp()
    };
    erroEl.textContent = "";
    ocupar(true);
    try{
      if (novo) await addDoc(collection(db, COL_PRODUTOS_SECRETOS), dados);
      else await updateDoc(doc(db, COL_PRODUTOS_SECRETOS, p.id), dados);
      ocupado = false; fechar();
      toast(novo ? "Produto adicionado!" : "Produto atualizado!");
    }catch(err){
      ocupar(false);
      erroEl.textContent = err.code === "permission-denied"
        ? "Sem permissão para salvar. Sua conta precisa de admin: true e as regras atualizadas."
        : "Não foi possível salvar agora. Tente novamente.";
    }
  });

  q(".ps-excluir")?.addEventListener("click", async () => {
    if (ocupado) return;
    if (!confirm(`Excluir "${p.nome}" definitivamente?`)) return;
    ocupar(true);
    try{
      await deleteDoc(doc(db, COL_PRODUTOS_SECRETOS, p.id));
      ocupado = false; fechar(); toast("Produto excluído.");
    }catch(_){
      ocupar(false); erroEl.textContent = "Não foi possível excluir agora.";
    }
  });
  setTimeout(() => q("#pf-nome").focus(), 50);
}
