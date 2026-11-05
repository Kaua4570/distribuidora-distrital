// ============================================================
// DISTRIBUIDORA CAMPOS — app.js (interface do cliente)
// ============================================================
import { db, WHATSAPP_LOJA_PADRAO, COL_PRODUTOS, COL_CATEGORIAS, COL_PEDIDOS } from "./firebase-config.js";
import {
  collection, doc, onSnapshot, query, orderBy, addDoc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------------- Estado ----------------
let categorias = [];   // [{id, nome, ordem}]
let produtos   = [];   // [{id, nome, categoriaId, preco, volume, imagemUrl, disponivel, ordem}]
let carrinho   = {};   // { produtoId: { produto, qtd } }
let termoBusca = "";
let whatsappLoja = WHATSAPP_LOJA_PADRAO;

// ---------------- Elementos ----------------
const elCatNav       = document.getElementById("cat-nav");
const elCategoriasBox = document.getElementById("categorias-container");
const elBusca        = document.getElementById("busca-input");
const elCarrinhoFlut = document.getElementById("carrinho-flutuante");
const elCarrinhoQtd  = document.getElementById("carrinho-qtd-badge");
const elCarrinhoTotalBadge = document.getElementById("carrinho-total-badge");
const elListaItensCarrinho = document.getElementById("lista-itens-carrinho");
const elDrawerTotal  = document.getElementById("drawer-total");
const elCheckoutTotal = document.getElementById("checkout-total");
const elOverlay      = document.getElementById("overlay");
const elStatusLoja   = document.getElementById("status-loja");
const elToast        = document.getElementById("toast");

// ---------------- Utilitários ----------------
function formatarReal(v){
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function normalizar(txt){
  return (txt || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function mostrarToast(msg, erro = false){
  elToast.textContent = msg;
  elToast.classList.toggle("erro", erro);
  elToast.classList.add("mostrar");
  clearTimeout(mostrarToast._t);
  mostrarToast._t = setTimeout(() => elToast.classList.remove("mostrar"), 3200);
}
function abrirDrawer(id){
  document.getElementById(id).classList.add("aberto");
  elOverlay.classList.add("aberto");
  document.body.style.overflow = "hidden";
}
function fecharTodosDrawers(){
  document.querySelectorAll(".drawer").forEach(d => d.classList.remove("aberto"));
  elOverlay.classList.remove("aberto");
  document.body.style.overflow = "";
}
elOverlay.addEventListener("click", fecharTodosDrawers);
document.querySelectorAll("[data-fechar-drawer]").forEach(btn=>{
  btn.addEventListener("click", fecharTodosDrawers);
});

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
  const cfg = snap.data();
  whatsappLoja = cfg.whatsapp || WHATSAPP_LOJA_PADRAO;
  const aberta = cfg.aberta !== false;
  elStatusLoja.classList.toggle("aberta", aberta);
  elStatusLoja.classList.toggle("fechada", !aberta);
  elStatusLoja.innerHTML = `<span class="status-dot"></span> ${aberta ? "Loja aberta" : "Loja fechada no momento"}`;
}, (err) => console.error("Erro ao carregar status da loja:", err));

// ============================================================
// RENDER — navegação de categorias
// ============================================================
function renderCatNav(){
  elCatNav.innerHTML = categorias.map(cat =>
    `<button class="cat-pill" data-cat="${cat.id}">${cat.nome}</button>`
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
// RENDER — produtos agrupados por categoria
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
      <section class="categoria-secao" id="cat-${cat.id}">
        <h2 class="categoria-titulo">${cat.nome}</h2>
        <div class="grid-produtos">
          ${itensCategoria.map(p => cardProdutoHTML(p)).join("")}
        </div>
      </section>`;
  });

  elCategoriasBox.innerHTML = totalVisiveis > 0
    ? htmlFinal
    : `<p class="sem-resultados">Nenhum produto encontrado para "${termoBusca}".</p>`;

  // religa observers e eventos
  document.querySelectorAll(".categoria-secao").forEach(sec => observadorSecoes.observe(sec));
  ligarEventosCards();
}

function cardProdutoHTML(p){
  const disponivel = p.disponivel !== false;
  const qtdAtual = carrinho[p.id]?.qtd || 0;
  return `
    <div class="card-produto ${disponivel ? "" : "esgotado"}" data-id="${p.id}">
      <img class="card-produto-foto" src="${p.imagemUrl || ""}" alt="${p.nome}" loading="lazy"
           onerror="this.src='';this.style.opacity='0.4'">
      <div class="card-produto-info">
        <div class="card-produto-nome">${p.nome}</div>
        ${p.volume ? `<div class="card-produto-vol">${p.volume}</div>` : ""}
        <div class="card-produto-preco">${formatarReal(p.preco)}</div>
        ${!disponivel ? `<div class="card-produto-esgotado-tag">ESGOTADO</div>` : `
        <div class="card-produto-acao">
          ${qtdAtual > 0 ? `
            <div class="qtd-seletor" data-qtd-id="${p.id}">
              <button data-acao="menos">−</button>
              <span>${qtdAtual}</span>
              <button data-acao="mais">+</button>
            </div>` : `<span></span>`}
          ${qtdAtual === 0 ? `<button class="btn-add-card" data-acao="adicionar">+</button>` : ""}
        </div>`}
      </div>
    </div>`;
}

function ligarEventosCards(){
  document.querySelectorAll(".card-produto").forEach(card => {
    const id = card.dataset.id;
    const produto = produtos.find(p => p.id === id);
    if (!produto) return;

    card.querySelectorAll('[data-acao="adicionar"]').forEach(b =>
      b.addEventListener("click", () => alterarQtd(produto, 1)));
    card.querySelectorAll('[data-acao="mais"]').forEach(b =>
      b.addEventListener("click", () => alterarQtd(produto, 1)));
    card.querySelectorAll('[data-acao="menos"]').forEach(b =>
      b.addEventListener("click", () => alterarQtd(produto, -1)));
  });
}

// ============================================================
// CARRINHO
// ============================================================
function alterarQtd(produto, delta){
  const atual = carrinho[produto.id]?.qtd || 0;
  const nova = Math.max(0, atual + delta);
  if (nova === 0) delete carrinho[produto.id];
  else carrinho[produto.id] = { produto, qtd: nova };

  renderProdutos();
  atualizarUICarrinho();
}

function totalCarrinho(){
  return Object.values(carrinho).reduce((soma, it) => soma + it.qtd * Number(it.produto.preco), 0);
}
function qtdTotalCarrinho(){
  return Object.values(carrinho).reduce((soma, it) => soma + it.qtd, 0);
}

function atualizarUICarrinho(){
  const qtd = qtdTotalCarrinho();
  const total = totalCarrinho();

  elCarrinhoFlut.classList.toggle("visivel", qtd > 0);
  elCarrinhoQtd.textContent = qtd;
  elCarrinhoTotalBadge.textContent = formatarReal(total);
  elDrawerTotal.textContent = formatarReal(total);
  elCheckoutTotal.textContent = formatarReal(total);

  if (qtd === 0){
    elListaItensCarrinho.innerHTML = `<div class="carrinho-vazio">Seu carrinho está vazio.<br>Adicione produtos para continuar 🍻</div>`;
    return;
  }

  elListaItensCarrinho.innerHTML = Object.values(carrinho).map(({produto, qtd}) => `
    <div class="item-carrinho" data-id="${produto.id}">
      <img class="item-carrinho-foto" src="${produto.imagemUrl || ""}" alt="" onerror="this.style.opacity='0.3'">
      <div class="item-carrinho-info">
        <div class="item-carrinho-nome">${produto.nome}</div>
        <div class="item-carrinho-preco">${formatarReal(produto.preco)} un.</div>
      </div>
      <div class="item-carrinho-qtd">
        <button data-acao="menos">−</button>
        <span>${qtd}</span>
        <button data-acao="mais">+</button>
      </div>
      <button class="item-carrinho-remover" data-acao="remover">remover</button>
    </div>
  `).join("");

  elListaItensCarrinho.querySelectorAll(".item-carrinho").forEach(el => {
    const id = el.dataset.id;
    const produto = carrinho[id].produto;
    el.querySelector('[data-acao="mais"]').addEventListener("click", () => alterarQtd(produto, 1));
    el.querySelector('[data-acao="menos"]').addEventListener("click", () => alterarQtd(produto, -1));
    el.querySelector('[data-acao="remover"]').addEventListener("click", () => { delete carrinho[id]; renderProdutos(); atualizarUICarrinho(); });
  });
}

elCarrinhoFlut.addEventListener("click", () => abrirDrawer("drawer-carrinho"));
document.getElementById("btn-ir-checkout").addEventListener("click", () => {
  if (qtdTotalCarrinho() === 0) return mostrarToast("Seu carrinho está vazio.", true);
  fecharTodosDrawers();
  setTimeout(() => abrirDrawer("drawer-checkout"), 180);
});

// ============================================================
// BUSCA
// ============================================================
elBusca.addEventListener("input", (e) => {
  termoBusca = e.target.value;
  renderProdutos();
});

// ============================================================
// FORMULÁRIO DE CHECKOUT — interações visuais
// ============================================================
document.querySelectorAll('#grupo-pagamento input').forEach(radio => {
  radio.addEventListener("change", () => {
    radio.closest(".radio-grupo").querySelectorAll(".radio-opcao").forEach(op => op.classList.remove("selecionada"));
    radio.closest(".radio-opcao").classList.add("selecionada");
    document.getElementById("campo-troco").style.display = radio.value === "Dinheiro" ? "" : "none";
  });
});

// ============================================================
// ENVIO DO PEDIDO
// ============================================================
document.getElementById("form-checkout").addEventListener("submit", async (e) => {
  e.preventDefault();

  const nome = document.getElementById("cli-nome").value.trim();
  const pagamento = document.querySelector('input[name="pagamento"]:checked').value;
  const troco = document.getElementById("cli-troco").value.trim();
  const obs = document.getElementById("cli-obs").value.trim();

  if (!nome) return mostrarToast("Por favor, informe seu nome.", true);
  if (qtdTotalCarrinho() === 0) return mostrarToast("Seu carrinho está vazio.", true);

  const itens = Object.values(carrinho).map(({produto, qtd}) => ({
    produtoId: produto.id, nome: produto.nome, preco: Number(produto.preco), qtd
  }));
  const total = totalCarrinho();

  const btn = document.getElementById("btn-enviar-pedido");
  const btnTexto = document.getElementById("btn-enviar-texto");
  btn.disabled = true;
  btnTexto.innerHTML = `<span class="spinner" style="width:16px;height:16px;display:inline-block;vertical-align:middle"></span> Enviando...`;

  const pedido = {
    cliente: nome,
    tipoEntrega: "Retirada",
    endereco: "Retirada no balcão",
    pagamento,
    troco: pagamento === "Dinheiro" ? troco : "",
    observacoes: obs,
    itens,
    total,
    status: "Pendente",
    criadoEm: serverTimestamp()
  };

  try{
    await addDoc(collection(db, COL_PEDIDOS), pedido);
  } catch(err){
    console.error("Erro ao salvar pedido no Firebase:", err);
    mostrarToast("Pedido não foi salvo no sistema, mas será enviado pelo WhatsApp.", true);
  }

  enviarWhatsApp(pedido);

  // reset
  carrinho = {};
  e.target.reset();
  document.getElementById("campo-troco").style.display = "none";
  renderProdutos();
  atualizarUICarrinho();
  fecharTodosDrawers();
  mostrarToast("Pedido enviado! Finalize pelo WhatsApp 🍻");

  btn.disabled = false;
  btnTexto.textContent = "Enviar pedido pelo WhatsApp";
});

function enviarWhatsApp(pedido){
  const linhasItens = pedido.itens.map(it =>
    `- ${it.qtd}x ${it.nome} (${formatarReal(it.preco * it.qtd)})`
  ).join("\n");

  let msg = "";
  msg += `🍻 *NOVO PEDIDO - DISTRIBUIDORA CAMPOS* 🍻\n`;
  msg += `--------------------------------\n`;
  msg += `*Cliente:* ${pedido.cliente}\n`;
  msg += `*Entrega:* ${pedido.endereco}\n`;
  msg += `*Pagamento:* ${pedido.pagamento}`;
  if (pedido.pagamento === "Dinheiro" && pedido.troco) msg += ` (troco para ${pedido.troco})`;
  msg += `\n--------------------------------\n`;
  msg += `*ITENS:*\n${linhasItens}\n`;
  msg += `--------------------------------\n`;
  msg += `*TOTAL: ${formatarReal(pedido.total)}*\n`;
  msg += `--------------------------------\n`;
  if (pedido.observacoes) msg += `*Obs:* ${pedido.observacoes}`;

  const url = `https://wa.me/${whatsappLoja}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
}

// estado inicial da UI do carrinho
atualizarUICarrinho();
