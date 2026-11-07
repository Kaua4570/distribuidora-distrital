// ============================================================
// DISTRIBUIDORA DISTRITAL — app.js (tela inicial / cardápio público)
// Só vitrine: lista os produtos, busca e categorias.
// Não há carrinho nem pedido por aqui. Produtos e categorias são
// cadastrados no painel (engrenagem da área secreta → Tela inicial).
// ============================================================
import { db, COL_PRODUTOS, COL_CATEGORIAS } from "./firebase-config.js";
import {
  collection, doc, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------------- Estado ----------------
let categorias = [];   // [{id, nome, ordem}]
let produtos   = [];   // [{id, nome, categoriaId, preco, volume, imagemUrl, disponivel, ordem}]
let termoBusca = "";

// ---------------- Elementos ----------------
const elCatNav        = document.getElementById("cat-nav");
const elCategoriasBox = document.getElementById("categorias-container");
const elBusca         = document.getElementById("busca-input");
const elStatusLoja    = document.getElementById("status-loja");

// ---------------- Utilitários ----------------
function formatarReal(v){
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function normalizar(txt){
  return (txt || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

// ============================================================
// FIRESTORE — escuta em tempo real
// ============================================================
onSnapshot(query(collection(db, COL_CATEGORIAS), orderBy("ordem")), (snap) => {
  categorias = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderCatNav();
  renderProdutos();
}, (err) => {
  console.error("Erro ao carregar categorias:", err);
  elCategoriasBox.innerHTML = `<p class="sem-resultados">Não foi possível carregar o cardápio agora.<br>Verifique a conexão ou tente novamente em instantes.</p>`;
});

onSnapshot(collection(db, COL_PRODUTOS), (snap) => {
  produtos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderProdutos();
}, (err) => console.error("Erro ao carregar produtos:", err));

onSnapshot(doc(db, "config", "loja"), (snap) => {
  if (!snap.exists()) return;
  const aberta = snap.data().aberta !== false;
  elStatusLoja.classList.toggle("aberta", aberta);
  elStatusLoja.classList.toggle("fechada", !aberta);
  elStatusLoja.innerHTML = `<span class="status-dot"></span> ${aberta ? "Loja aberta" : "Loja fechada no momento"}`;
}, (err) => console.error("Erro ao carregar status da loja:", err));

// ============================================================
// RENDER — navegação de categorias
// ============================================================
function renderCatNav(){
  elCatNav.innerHTML = categorias.map(cat =>
    `<button class="cat-pill" data-cat="${esc(cat.id)}">${esc(cat.nome)}</button>`
  ).join("");

  elCatNav.querySelectorAll(".cat-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      const alvo = document.getElementById(`cat-${btn.dataset.cat}`);
      if (alvo) alvo.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

// destaca a categoria visível ao rolar, e arrasta a barra pra deixar
// o pill ativo encostado na esquerda (sobe ou desce, sempre acompanha)
const observadorSecoes = new IntersectionObserver((entradas) => {
  entradas.forEach(ent => {
    if (ent.isIntersecting){
      const id = ent.target.id.replace("cat-", "");
      let pillAtiva = null;
      elCatNav.querySelectorAll(".cat-pill").forEach(p => {
        const ativa = p.dataset.cat === id;
        p.classList.toggle("ativa", ativa);
        if (ativa) pillAtiva = p;
      });
      if (pillAtiva){
        pillAtiva.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
      }
    }
  });
}, { rootMargin: "-120px 0px -70% 0px" });

// ============================================================
// RENDER — produtos agrupados por categoria (somente vitrine)
// ============================================================
function renderProdutos(){
  if (categorias.length === 0){
    elCategoriasBox.innerHTML = `<div class="loading-full"><div class="spinner"></div><span>Carregando cardápio...</span></div>`;
    return;
  }

  const busca = normalizar(termoBusca);
  let htmlFinal = "";
  let totalVisiveis = 0;

  categorias.forEach(cat => {
    const itensCategoria = produtos
      .filter(p => p.categoriaId === cat.id)
      .filter(p => p.visivel !== false)
      .filter(p => !busca || normalizar(p.nome).includes(busca))
      .sort((a,b) => (a.ordem||0) - (b.ordem||0));

    if (itensCategoria.length === 0) return;
    totalVisiveis += itensCategoria.length;

    htmlFinal += `
      <section class="categoria-secao" id="cat-${esc(cat.id)}">
        <h2 class="categoria-titulo">${esc(cat.nome)}</h2>
        <div class="grid-produtos">
          ${itensCategoria.map(cardProdutoHTML).join("")}
        </div>
      </section>`;
  });

  elCategoriasBox.innerHTML = totalVisiveis > 0
    ? htmlFinal
    : `<p class="sem-resultados">Nenhum produto encontrado${termoBusca ? ` para "${esc(termoBusca)}"` : ""}.</p>`;

  document.querySelectorAll(".categoria-secao").forEach(sec => observadorSecoes.observe(sec));
}

function cardProdutoHTML(p){
  const disponivel = p.disponivel !== false;
  return `
    <div class="card-produto ${disponivel ? "" : "esgotado"}" data-id="${esc(p.id)}">
      <img class="card-produto-foto" src="${esc(p.imagemUrl || "")}" alt="${esc(p.nome)}" loading="lazy"
           onerror="this.src='';this.style.opacity='0.4'">
      <div class="card-produto-info">
        <div class="card-produto-nome">${esc(p.nome)}</div>
        ${p.volume ? `<div class="card-produto-vol">${esc(p.volume)}</div>` : ""}
        <div class="card-produto-preco">${formatarReal(p.preco)}</div>
        ${disponivel ? "" : `<div class="card-produto-esgotado-tag">ESGOTADO</div>`}
      </div>
    </div>`;
}

// ============================================================
// BUSCA
// ============================================================
elBusca.addEventListener("input", (e) => {
  termoBusca = e.target.value;
  renderProdutos();
});
