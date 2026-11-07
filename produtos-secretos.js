// ============================================================
// DISTRIBUIDORA DISTRITAL — produtos-secretos.js
// Catálogo reservado: vitrine + carrinho + pedido de entrega. Fluxo:
//   1. Firebase Auth confirma o login (sem login → volta ao início).
//   2. Firestore confirma que o UID está em usuarios_autorizados.
//   3. Só então lê produtos_secretos / categorias_secretas (as REGRAS
//      do Firestore também barram quem não for autorizado).
//   4. Se a sessão cair ou a autorização for revogada, tudo é apagado
//      da tela imediatamente e o usuário volta ao início.
// Cadastro e edição: engrenagem ⚙️ (só admin) → painel → "Tela secreta".
// Pedido: produtos → carrinho → dados → localização/endereço → pagamento → nº do pedido (aleatório, 4 dígitos).
// Pix: gerado pela função /api/pix-criar (Vercel) e confirmado sozinho pelo Mercado Pago.
// Entregador e comanda têm telas próprias (entregador.html / admin.html).
// ============================================================
import {
  auth, db, doc, onSnapshot, collection, signOut, onAuthStateChanged,
  setDoc, query, where, serverTimestamp,
  perfilDoUsuario, paginaInicialDo,
  COL_PRODUTOS_SECRETOS, COL_CATEGORIAS_SECRETAS, COL_USUARIOS_AUTORIZADOS,
  COL_PEDIDOS
} from "./secreto-firebase.js";
import { API_URL } from "./firebase-config.js";

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
const elToast    = document.getElementById("toast");
const elOverlay  = document.getElementById("overlay");

let produtos = [];
let categorias = [];            // [{id, nome, ordem}]
let categoriaAtiva = "__todas__";
let termo = "";
let cancelarProdutos = null;
let cancelarCategorias = null;
let cancelarAutorizacao = null;
let cancelarPedidos = null;
let encerrado = false;
let iniciado = false;
let usuarioAtual = null;        // { uid, email }
const pagosConhecidos = new Set();   // pedidos que já estavam pagos (para avisar só quando MUDAR para pago)
let primeiraCargaPedidos = true;
let carrinho = {};              // { produtoId: qtd }
let meusPedidos = [];

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
  try{ cancelarPedidos && cancelarPedidos(); }catch(_){}
  produtos = []; categorias = []; carrinho = {}; meusPedidos = [];
  fecharTodosDrawers();
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

  const perfil = await perfilDoUsuario(user);
  if (!perfil || !perfil.ativo){ await sairEBloquear(); return; }
  if (!auth.currentUser){ iniciado = false; return; }

  // Entregador e comanda não usam o catálogo: vão para a tela deles (sem sair da conta).
  const destino = paginaInicialDo(perfil);
  if (destino !== "produtos-secretos.html"){ window.location.replace(destino); return; }

  usuarioAtual = { uid: user.uid, email: user.email || "" };
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

  // Histórico de pedidos deste cliente (só os dele; a regra do Firestore também exige isso).
  cancelarPedidos = onSnapshot(
    query(collection(db, COL_PEDIDOS), where("clienteUid", "==", user.uid)),
    (snap) => {
      meusPedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (!primeiraCargaPedidos){
        meusPedidos.forEach(p => {
          if (p.pago === true && !pagosConhecidos.has(p.id)) toast(`Pedido #${p.id}: pagamento confirmado ✓`);
        });
      }
      meusPedidos.forEach(p => { if (p.pago === true) pagosConhecidos.add(p.id); });
      primeiraCargaPedidos = false;
      renderMeusPedidos();
    },
    (err) => console.error("Meus pedidos:", err.code)
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
  atualizarCarrinho();     // o catálogo muda em tempo real: mantém o carrinho coerente
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
  const qtd = carrinho[p.id] || 0;
  const compra = !disp ? "" : `
    <div class="ps-compra">
      ${qtd > 0 ? `
        <div class="qtd-seletor">
          <button type="button" data-acao="menos" aria-label="Diminuir">−</button>
          <span>${qtd}</span>
          <button type="button" data-acao="mais" aria-label="Aumentar">+</button>
        </div>` : `<button type="button" class="btn btn-gold btn-sm" data-acao="adicionar">Adicionar</button>`}
    </div>`;
  return `
    <div class="ps-item" data-id="${esc(p.id)}">
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
      </button>
      ${compra}
    </div>`;
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
  const acao = e.target.closest("[data-acao]");
  if (acao){
    const item = acao.closest(".ps-item");
    if (item) alterarQtd(item.dataset.id, acao.dataset.acao === "menos" ? -1 : 1);
    return;
  }
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
        ${disp ? `<button type="button" class="btn btn-gold btn-block ps-add-detalhe" style="margin-top:10px">Adicionar ao carrinho</button>` : ""}
      </div>
    </div>`;
  const fechar = () => { f.remove(); document.removeEventListener("keydown", tecla); };
  const tecla = (e) => { if (e.key === "Escape") fechar(); };
  f.addEventListener("click", (e) => { if (e.target === f) fechar(); });
  f.querySelector(".ps-detalhe-fechar").addEventListener("click", fechar);
  f.querySelector(".ps-add-detalhe")?.addEventListener("click", () => { alterarQtd(p.id, 1); fechar(); });
  f.querySelector("img.ps-foto")?.addEventListener("error", (e) => {
    const v = document.createElement("div"); v.className = "ps-foto-vazia"; v.innerHTML = ICONE_VAZIO; e.target.replaceWith(v);
  });
  document.addEventListener("keydown", tecla);
  document.body.appendChild(f);
}

// ============================================================
// UTILITÁRIOS DE TELA
// ============================================================
function toast(msg, erro = false){
  elToast.textContent = msg;
  elToast.classList.toggle("erro", erro);
  elToast.classList.add("mostrar");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => elToast.classList.remove("mostrar"), 3200);
}

function abrirDrawer(id){
  document.querySelectorAll(".drawer.aberto").forEach(d => d.classList.remove("aberto"));
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
document.querySelectorAll("[data-fechar-drawer]").forEach(b => b.addEventListener("click", fecharTodosDrawers));

// ============================================================
// CARRINHO
// ============================================================
const elCarrinhoFlut = document.getElementById("carrinho-flutuante");
const elCarrinhoQtd  = document.getElementById("carrinho-qtd-badge");
const elCarrinhoTot  = document.getElementById("carrinho-total-badge");
const elListaCarrinho = document.getElementById("lista-itens-carrinho");

// itens do carrinho com os dados ATUAIS do catálogo (some o que saiu do ar)
function itensDoCarrinho(){
  const itens = [];
  for (const [id, qtd] of Object.entries(carrinho)){
    const p = produtos.find(x => x.id === id);
    if (p && p.disponivel !== false && qtd > 0) itens.push({ produto: p, qtd });
  }
  return itens;
}
const totalCarrinho = () => itensDoCarrinho().reduce((t, i) => t + i.qtd * (Number(i.produto.preco) || 0), 0);
const qtdCarrinho   = () => itensDoCarrinho().reduce((t, i) => t + i.qtd, 0);

function alterarQtd(id, delta){
  const nova = Math.max(0, (carrinho[id] || 0) + delta);
  if (nova === 0) delete carrinho[id]; else carrinho[id] = nova;
  render();
  atualizarCarrinho();
}

function atualizarCarrinho(){
  const itens = itensDoCarrinho();
  const qtd = qtdCarrinho();
  const total = totalCarrinho();
  elCarrinhoFlut.classList.toggle("visivel", qtd > 0);
  elCarrinhoQtd.textContent = qtd;
  elCarrinhoTot.textContent = real(total);
  document.getElementById("drawer-total").textContent = real(total);
  document.getElementById("co-total").textContent = real(total);

  if (!itens.length){
    elListaCarrinho.innerHTML = `<div class="carrinho-vazio">Seu carrinho está vazio.<br>Adicione produtos para continuar.</div>`;
    return;
  }
  elListaCarrinho.innerHTML = itens.map(({ produto: p, qtd }) => `
    <div class="item-carrinho" data-id="${esc(p.id)}">
      ${urlImagemSegura(p.imagemUrl) ? `<img class="item-carrinho-foto" src="${esc(p.imagemUrl)}" alt="" referrerpolicy="no-referrer">` : `<div class="item-carrinho-foto"></div>`}
      <div class="item-carrinho-info">
        <div class="item-carrinho-nome">${esc(p.nome)}</div>
        <div class="item-carrinho-preco">${real(p.preco)} un.</div>
      </div>
      <div class="item-carrinho-qtd">
        <button type="button" data-acao="menos">−</button>
        <span>${qtd}</span>
        <button type="button" data-acao="mais">+</button>
      </div>
      <button type="button" class="item-carrinho-remover" data-acao="remover">remover</button>
    </div>`).join("");
}

elListaCarrinho.addEventListener("click", (e) => {
  const b = e.target.closest("[data-acao]");
  const linha = e.target.closest(".item-carrinho");
  if (!b || !linha) return;
  const id = linha.dataset.id;
  if (b.dataset.acao === "remover"){ delete carrinho[id]; render(); atualizarCarrinho(); }
  else alterarQtd(id, b.dataset.acao === "menos" ? -1 : 1);
});

elCarrinhoFlut.addEventListener("click", () => abrirDrawer("drawer-carrinho"));
document.getElementById("btn-ir-checkout").addEventListener("click", () => {
  if (!qtdCarrinho()) return toast("Seu carrinho está vazio.", true);
  abrirCheckout();
});

// ============================================================
// FINALIZAR PEDIDO — 3 passos
// ============================================================
const coTitulos = ["Seus dados", "Entrega", "Pagamento"];
const elCoNome = document.getElementById("co-nome");
const elCoTel  = document.getElementById("co-telefone");
const elCoEnd  = document.getElementById("co-endereco");
const elCoTroco = document.getElementById("co-troco");
const elCoErro = document.getElementById("co-erro");
const elCoGps  = document.getElementById("co-gps");
const elCoGpsStatus = document.getElementById("co-gps-status");
const elCoAvancar = document.getElementById("co-avancar");
const elCoVoltar  = document.getElementById("co-voltar");

let coPasso = 1;
let coLocalizacao = null;       // { lat, lng, precisao }
let coEnviando = false;

function abrirCheckout(){
  document.getElementById("co-formulario").hidden = false;
  document.getElementById("co-sucesso").hidden = true;
  document.getElementById("co-total-linha").hidden = false;
  document.getElementById("co-botoes").hidden = false;
  document.getElementById("co-botoes-fim").hidden = true;
  elCoErro.textContent = "";
  mostrarPasso(1);
  abrirDrawer("drawer-checkout");
}

function mostrarPasso(n){
  coPasso = n;
  document.querySelectorAll(".co-passo").forEach(el => { el.hidden = Number(el.dataset.passo) !== n; });
  document.querySelectorAll("#co-trilha i").forEach((i, idx) => i.classList.toggle("feito", idx < n));
  document.getElementById("co-titulo").textContent = coTitulos[n - 1];
  elCoVoltar.textContent = n === 1 ? "Carrinho" : "Voltar";
  elCoAvancar.textContent = n === 3 ? "Finalizar pedido" : "Avançar";
  elCoErro.textContent = "";
}

elCoVoltar.addEventListener("click", () => {
  if (coEnviando) return;
  if (coPasso === 1) abrirDrawer("drawer-carrinho"); else mostrarPasso(coPasso - 1);
});

// Pagamento: Pix / Dinheiro
document.querySelectorAll("#co-pagamento input").forEach(radio => {
  radio.addEventListener("change", () => {
    radio.closest(".radio-grupo").querySelectorAll(".radio-opcao").forEach(o => o.classList.remove("selecionada"));
    radio.closest(".radio-opcao").classList.add("selecionada");
    document.getElementById("co-campo-troco").hidden = radio.value !== "Dinheiro";
    document.getElementById("co-nota-pix").hidden = radio.value !== "Pix";
  });
});

// Localização (GPS) — fica salva no pedido para o entregador
elCoGps.addEventListener("click", () => {
  if (!navigator.geolocation){
    elCoGpsStatus.className = "co-nota erro";
    elCoGpsStatus.textContent = "Este aparelho não permite localização. Preencha o endereço abaixo.";
    return;
  }
  elCoGps.disabled = true;
  elCoGpsStatus.className = "co-nota";
  elCoGpsStatus.textContent = "Buscando sua localização...";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      coLocalizacao = {
        lat: Math.round(pos.coords.latitude * 1e6) / 1e6,
        lng: Math.round(pos.coords.longitude * 1e6) / 1e6,
        precisao: Math.round(pos.coords.accuracy || 0)
      };
      elCoGps.disabled = false;
      elCoGps.textContent = "📍 Atualizar localização";
      elCoGpsStatus.className = "co-nota ok";
      elCoGpsStatus.textContent = `Localização salva ✓ (precisão de ~${coLocalizacao.precisao} m)`;
    },
    (err) => {
      elCoGps.disabled = false;
      elCoGpsStatus.className = "co-nota erro";
      elCoGpsStatus.textContent = err.code === 1
        ? "Permissão negada. Libere a localização do navegador e tente de novo, ou preencha o endereço."
        : "Não foi possível pegar a localização agora. Tente de novo ou preencha o endereço.";
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
});

elCoAvancar.addEventListener("click", () => {
  if (coEnviando) return;
  elCoErro.textContent = "";
  if (coPasso === 1){
    if (!elCoNome.value.trim()) return erroCheckout("Informe seu nome.");
    if (elCoTel.value.replace(/\D/g, "").length < 8) return erroCheckout("Informe um telefone válido, com DDD.");
    return mostrarPasso(2);
  }
  if (coPasso === 2){
    if (!elCoEnd.value.trim()) return erroCheckout("Informe a quadra, o lote ou um ponto de referência.");
    if (!coLocalizacao && !confirm("Seguir sem sincronizar a localização? O entregador só terá o endereço escrito.")) return;
    return mostrarPasso(3);
  }
  enviarPedido();
});

function erroCheckout(msg){ elCoErro.textContent = msg; }

async function enviarPedido(){
  if (!usuarioAtual) return;
  const itens = itensDoCarrinho();
  if (!itens.length){ erroCheckout("Seu carrinho ficou vazio (algum produto saiu do ar)."); return; }

  const pagamento = document.querySelector('input[name="co-pag"]:checked').value;
  const dados = {
    clienteUid: usuarioAtual.uid,
    cliente: elCoNome.value.trim(),
    telefone: elCoTel.value.trim(),
    tipoEntrega: "Entrega",
    endereco: elCoEnd.value.trim(),
    localizacao: coLocalizacao,
    pagamento,
    troco: pagamento === "Dinheiro" ? elCoTroco.value.trim() : "",
    pago: false,
    itens: itens.map(({ produto: p, qtd }) => ({ produtoId: p.id, nome: p.nome, preco: Number(p.preco) || 0, qtd })),
    total: Math.round(totalCarrinho() * 100) / 100,
    status: "Pendente"
  };

  coEnviando = true;
  elCoAvancar.disabled = true; elCoVoltar.disabled = true;
  elCoAvancar.textContent = "Enviando...";
  try{
    const numero = await criarPedido(dados);
    carrinho = {};
    render(); atualizarCarrinho();
    document.getElementById("co-formulario").hidden = true;
    document.getElementById("co-total-linha").hidden = true;
    document.getElementById("co-botoes").hidden = true;
    document.getElementById("co-botoes-fim").hidden = false;
    document.getElementById("co-sucesso").hidden = false;
    document.getElementById("co-sucesso-numero").textContent = `#${numero}`;
    document.getElementById("co-titulo").textContent = "Pedido enviado!";
    if (pagamento === "Pix" && PIX_AUTOMATICO) abrirPix(numero, dados.total);
    elCoEnd.value = ""; elCoTroco.value = "";
    coLocalizacao = null;
    elCoGps.textContent = "📍 Sincronizar minha localização";
    elCoGpsStatus.className = "co-nota";
    elCoGpsStatus.textContent = "A localização fica salva no pedido para o entregador chegar até você.";
  }catch(err){
    console.error("Erro ao criar pedido:", err);
    erroCheckout(err && err.code === "permission-denied"
      ? "Sem permissão para fazer pedidos. Peça para liberar seu acesso como cliente."
      : "Não foi possível enviar o pedido agora. Tente novamente.");
  }finally{
    coEnviando = false;
    elCoAvancar.disabled = false; elCoVoltar.disabled = false;
    if (!document.getElementById("co-formulario").hidden) elCoAvancar.textContent = "Finalizar pedido";
  }
}

// Número do pedido: 4 dígitos ALEATÓRIOS (1000–9999, sem sequência). Se o número já existir, a regra do
// Firestore nega a gravação (seria uma alteração de pedido alheio) e sorteamos outro.
function numeroAleatorio(){
  const v = new Uint32Array(1);
  crypto.getRandomValues(v);
  return String(1000 + (v[0] % 9000));
}

async function criarPedido(dados){
  const TENTATIVAS = 25;
  for (let i = 1; i <= TENTATIVAS; i++){
    const numero = numeroAleatorio();
    try{
      await setDoc(doc(db, COL_PEDIDOS, numero), { ...dados, criadoEm: serverTimestamp() });
      return numero;
    }catch(err){
      if (!(err && err.code === "permission-denied") || i === TENTATIVAS) throw err;
    }
  }
}

document.getElementById("co-ver-pedidos").addEventListener("click", () => abrirDrawer("drawer-pedidos"));

// ============================================================
// MEUS PEDIDOS (andamento em tempo real)
// ============================================================
const elMeusPedidos = document.getElementById("lista-meus-pedidos");
const elBadgePedidos = document.getElementById("ps-badge-pedidos");
const ROTULO_STATUS = {
  "Pendente": "Recebido",
  "Em Preparo": "Em preparo",
  "Saiu para Entrega": "Saiu para entrega",
  "Chegando": "Entregador chegando",
  "Finalizado": "Entregue ✓",
  "Cancelado": "Cancelado"
};
const classeStatus = (s) => ({ "Em Preparo":"preparo", "Saiu para Entrega":"entrega", "Chegando":"chegando", "Finalizado":"finalizado", "Cancelado":"cancelado" }[s] || "pendente");
// criadoEm ainda é nulo logo após gravar (carimbo do servidor): trata como "agora"
const tempoDe = (p) => (p.criadoEm && p.criadoEm.toMillis) ? p.criadoEm.toMillis() : Date.now();
const emAndamento = (p) => p.status !== "Finalizado" && p.status !== "Cancelado";

function renderMeusPedidos(){
  if (encerrado) return;
  const lista = [...meusPedidos].sort((a, b) => tempoDe(b) - tempoDe(a));
  const ativos = lista.filter(emAndamento).length;
  elBadgePedidos.hidden = ativos === 0;
  elBadgePedidos.textContent = ativos;

  if (!lista.length){
    elMeusPedidos.innerHTML = `<div class="carrinho-vazio">Você ainda não fez nenhum pedido.</div>`;
    return;
  }
  elMeusPedidos.innerHTML = lista.map(p => {
    const data = p.criadoEm?.toDate ? p.criadoEm.toDate().toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }) : "agora";
    const pgto = p.pagamento === "Pix"
      ? (p.pago ? "Pix — pago ✓" : (PIX_AUTOMATICO ? "Pix — aguardando pagamento" : "Pix — aguardando confirmação"))
      : `Dinheiro${p.troco ? ` (troco para ${p.troco})` : ""}`;
    const pagarPix = PIX_AUTOMATICO && p.pagamento === "Pix" && !p.pago && emAndamento(p)
      ? `<button type="button" class="btn btn-gold btn-sm btn-block mp-pix" data-pix="${esc(p.id)}">Pagar com Pix</button>` : "";
    return `
      <div class="mp-card st-${classeStatus(p.status)}">
        <div class="mp-topo">
          <span class="mp-num">Pedido #${esc(p.id)}</span>
          <span class="mp-status">${esc(ROTULO_STATUS[p.status] || p.status || "Recebido")}</span>
        </div>
        <div class="mp-linha">${esc(data)} · ${esc(pgto)}</div>
        <div class="mp-itens">${(p.itens || []).map(i => `<div><span>${esc(i.qtd)}x ${esc(i.nome)}</span><span>${real((Number(i.preco) || 0) * (Number(i.qtd) || 0))}</span></div>`).join("")}</div>
        <div class="mp-total"><span>Total</span><span>${real(p.total)}</span></div>
        ${pagarPix}
      </div>`;
  }).join("");
  atualizarPixAberto();
}

elMeusPedidos.addEventListener("click", (e) => {
  const b = e.target.closest("[data-pix]");
  if (!b) return;
  const p = meusPedidos.find(x => x.id === b.dataset.pix);
  if (p) abrirPix(p.id, p.total);
});

document.getElementById("ps-pedidos").addEventListener("click", () => abrirDrawer("drawer-pedidos"));

// ============================================================
// PIX AUTOMÁTICO (Mercado Pago)
// A função da Vercel cria a cobrança com o valor do pedido gravado no Firestore.
// Quando o cliente paga, o Mercado Pago avisa a função, que marca o pedido como
// PAGO — e este celular percebe sozinho pela escuta em tempo real dos pedidos.
// ============================================================
const PIX_AUTOMATICO = !!API_URL;
const elPixPedido = document.getElementById("pix-pedido");
const elPixValor  = document.getElementById("pix-valor");
const elPixCarregando = document.getElementById("pix-carregando");
const elPixConteudo = document.getElementById("pix-conteudo");
const elPixQr = document.getElementById("pix-qr");
const elPixCodigo = document.getElementById("pix-codigo");
const elPixStatus = document.getElementById("pix-status");
const elPixPago = document.getElementById("pix-pago");
const elPixErro = document.getElementById("pix-erro");
const elPixTentar = document.getElementById("pix-tentar");
let pixAbertoId = null;

if (!PIX_AUTOMATICO){
  document.getElementById("co-nota-pix").textContent = "No Pix, a loja confirma o pagamento no seu pedido.";
} else {
  document.getElementById("co-nota-pix").textContent = "O QR Code do Pix aparece logo depois de finalizar, e o pagamento é confirmado automaticamente.";
}

function mostrarPixPago(){
  elPixCarregando.hidden = true;
  elPixConteudo.hidden = true;
  elPixTentar.hidden = true;
  elPixErro.textContent = "";
  elPixPago.hidden = false;
}

async function abrirPix(id, total){
  pixAbertoId = String(id);
  elPixPedido.textContent = `Pedido #${id}`;
  elPixValor.textContent = real(total);
  elPixCarregando.hidden = false;
  elPixConteudo.hidden = true;
  elPixPago.hidden = true;
  elPixTentar.hidden = true;
  elPixErro.textContent = "";
  abrirDrawer("drawer-pix");

  const ja = meusPedidos.find(p => p.id === pixAbertoId);
  if (ja && ja.pago === true){ mostrarPixPago(); return; }

  try{
    const usuario = auth.currentUser;
    if (!usuario) throw new Error("sem login");
    const token = await usuario.getIdToken();
    const resp = await fetch(`${API_URL}/api/pix-criar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pedido: pixAbertoId })
    });
    const dados = await resp.json().catch(() => ({}));
    if (pixAbertoId !== String(id)) return;               // fechou/abriu outro enquanto carregava
    if (!resp.ok || !dados.ok) throw new Error(dados.erro || `http ${resp.status}`);
    if (dados.pago){ mostrarPixPago(); return; }

    elPixQr.src = `data:image/png;base64,${dados.qrBase64}`;
    elPixCodigo.value = dados.copiaECola;
    elPixCarregando.hidden = true;
    elPixConteudo.hidden = false;
    elPixStatus.textContent = "Aguardando o pagamento…";
  }catch(err){
    console.error("Pix:", err);
    elPixCarregando.hidden = true;
    elPixErro.textContent = "Não foi possível gerar o Pix agora. Seu pedido está salvo — tente de novo ou fale com a loja.";
    elPixTentar.hidden = false;
    elPixTentar.onclick = () => abrirPix(id, total);
  }
}

// chamado a cada atualização dos pedidos: se o Pix aberto foi pago, mostra a confirmação
function atualizarPixAberto(){
  if (!pixAbertoId) return;
  const p = meusPedidos.find(x => x.id === pixAbertoId);
  if (p && p.pago === true && elPixPago.hidden) mostrarPixPago();
}

document.getElementById("pix-copiar").addEventListener("click", async () => {
  const codigo = elPixCodigo.value;
  try{
    await navigator.clipboard.writeText(codigo);
  }catch(_){
    elPixCodigo.select();
    try{ document.execCommand("copy"); }catch(__){}
  }
  toast("Código Pix copiado!");
});
document.querySelectorAll("#drawer-pix [data-fechar-drawer], #overlay").forEach(el =>
  el.addEventListener("click", () => { pixAbertoId = null; }));

atualizarCarrinho();
