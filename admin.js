// ============================================================
// DISTRIBUIDORA DISTRITAL — admin.js (painel do dono)
// ============================================================
import { db, COL_PRODUTOS, COL_CATEGORIAS, COL_PEDIDOS } from "./firebase-config.js";
import {
  auth, onAuthStateChanged, signOut, paginaInicialDo,
  COL_USUARIOS_AUTORIZADOS, COL_PRODUTOS_SECRETOS, COL_CATEGORIAS_SECRETAS
} from "./secreto-firebase.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------------- Estado ----------------
let categorias = [];
let produtos = [];
let pedidos = [];
let edicaoProdutoId = null;
let fotoBase64Selecionada = null; // string Base64 já comprimida, pronta pra gravar no Firestore
let primeiraCargaPedidos = true;

// ---------------- Modo: qual "tela" está sendo editada ----------------
// A ferramenta é a mesma; só mudam as coleções do Firestore usadas.
const MODOS = {
  inicial: { rotulo: "Tela inicial", descricao: "cardápio público",    produtos: COL_PRODUTOS,         categorias: COL_CATEGORIAS },
  secreta: { rotulo: "Tela secreta", descricao: "catálogo reservado",  produtos: COL_PRODUTOS_SECRETOS, categorias: COL_CATEGORIAS_SECRETAS }
};
const CHAVE_MODO = "distrital_modo";
function modoInicial(){
  const url = new URLSearchParams(location.search).get("modo");
  if (url && MODOS[url]) return url;
  let salvo = null;
  try{ salvo = sessionStorage.getItem(CHAVE_MODO); }catch(_){}
  return salvo && MODOS[salvo] ? salvo : "inicial";
}
let modo = modoInicial();
const colP = () => MODOS[modo].produtos;
const colC = () => MODOS[modo].categorias;

// ============================================================
// COMPRESSÃO DE IMAGEM (Canvas) — sem Firebase Storage
// ============================================================
// Redimensiona para no máximo 400x400 (mantendo proporção) e recomprime
// como JPEG qualidade 0.75, retornando uma string Base64 (data URL) leve
// o suficiente para caber direto num campo do Firestore.
function comprimirImagem(file, maxLado = 400, qualidade = 0.75){
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = (evento) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height){
          if (width > maxLado){ height = Math.round(height * (maxLado / width)); width = maxLado; }
        } else {
          if (height > maxLado){ width = Math.round(width * (maxLado / height)); height = maxLado; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", qualidade));
      };
      img.onerror = () => reject(new Error("Não foi possível ler essa imagem."));
      img.src = evento.target.result;
    };
    leitor.onerror = () => reject(new Error("Falha ao carregar o arquivo."));
    leitor.readAsDataURL(file);
  });
}

// ---------------- Elementos ----------------
const elToast = document.getElementById("toast");
function mostrarToast(msg, erro = false){
  elToast.textContent = msg;
  elToast.classList.toggle("erro", erro);
  elToast.classList.add("mostrar");
  clearTimeout(mostrarToast._t);
  mostrarToast._t = setTimeout(() => elToast.classList.remove("mostrar"), 3200);
}
function formatarReal(v){
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ============================================================
// ACESSO — só entra quem está logado (Firebase Authentication) E tem
// admin: true em usuarios_autorizados/{uid}. O painel não tem mais senha
// própria nem link na tela inicial: a porta de entrada é a engrenagem
// da área secreta. As regras do Firestore também exigem admin para gravar.
// ============================================================
const telaLogin = document.getElementById("tela-login");
const appAdmin = document.getElementById("app-admin");
const PAGINA_INICIAL = "index.html";
const PAGINA_SECRETA = "produtos-secretos.html";

let verificando = false;
let painelAberto = false;
let cancelarAutorizacao = null;
let cancelarCategorias = null;
let cancelarProdutos = null;

function irPara(pagina){
  try{ cancelarAutorizacao && cancelarAutorizacao(); }catch(_){}
  window.location.replace(pagina);
}

async function sairDaConta(){
  try{ await signOut(auth); }catch(_){}
  irPara(PAGINA_INICIAL);
}

// Quem entra: administrador (tudo) ou login do tipo "comanda" (só as comandas).
function perfilDoPainel(d){
  if (!d || d.ativo !== true) return null;
  if (d.admin === true) return "admin";
  if (d.tipo === "comanda") return "comanda";
  return null;
}

function entrarNoPainel(perfil){
  painelAberto = true;
  telaLogin.style.display = "none";
  appAdmin.style.display = "block";
  if (perfil === "comanda"){
    // login "comanda": só a aba de comandas (o resto nem existe na tela)
    document.querySelectorAll(".so-admin").forEach(el => el.remove());
    document.querySelector('.admin-tab[data-aba="comandas"]').click();
    listenPedidos();
    return;
  }
  atualizarBarraModo();
  iniciarListeners();
}

onAuthStateChanged(auth, async (user) => {
  if (!user){ irPara(PAGINA_INICIAL); return; }     // sem sessão / saiu da conta
  if (verificando || painelAberto) return;
  verificando = true;

  let perfil = null, dados = null;
  try{
    const snap = await getDoc(doc(db, COL_USUARIOS_AUTORIZADOS, user.uid));
    dados = snap.exists() ? snap.data() : null;
    perfil = perfilDoPainel(dados);
  }catch(_){ perfil = null; }

  if (!perfil){
    // autorizado mas sem acesso ao painel (cliente/entregador) vai para a tela dele
    const destino = dados && dados.ativo === true
      ? paginaInicialDo({ tipo: dados.tipo || "cliente" })
      : PAGINA_INICIAL;
    irPara(destino);
    return;
  }

  // Se o acesso for removido/bloqueado/alterado com o painel aberto, sai na hora.
  cancelarAutorizacao = onSnapshot(
    doc(db, COL_USUARIOS_AUTORIZADOS, user.uid),
    (s) => { if (perfilDoPainel(s.exists() ? s.data() : null) !== perfil) irPara(PAGINA_SECRETA); },
    () => irPara(PAGINA_INICIAL)
  );
  entrarNoPainel(perfil);
});

document.getElementById("btn-sair").addEventListener("click", sairDaConta);

// ============================================================
// ALTERNAR TELA INICIAL / TELA SECRETA
// ============================================================
function atualizarBarraModo(){
  const m = MODOS[modo];
  document.querySelectorAll(".modo-btn").forEach(b => b.classList.toggle("ativa", b.dataset.modo === modo));
  const leg = document.getElementById("modo-legenda");
  if (leg) leg.textContent = `Editando agora: ${m.rotulo} (${m.descricao})`;
  document.querySelectorAll(".modo-tag").forEach(t => { t.textContent = `— ${m.rotulo}`; });
}

function trocarModo(novo){
  if (!MODOS[novo] || novo === modo) return;
  modo = novo;
  try{ sessionStorage.setItem(CHAVE_MODO, modo); }catch(_){}
  try{ cancelarCategorias && cancelarCategorias(); }catch(_){}
  try{ cancelarProdutos && cancelarProdutos(); }catch(_){}
  categorias = [];
  produtos = [];
  resetFormProduto();
  renderSelectCategorias();
  renderChipsCategorias();
  renderTabelaProdutos();
  atualizarBarraModo();
  listenCategorias();
  listenProdutos();
}

document.querySelectorAll(".modo-btn").forEach(btn => {
  btn.addEventListener("click", () => trocarModo(btn.dataset.modo));
});

function avisarErroLeitura(err){
  if (err && err.code === "permission-denied"){
    mostrarToast("Sem permissão para ler. Publique as regras novas (firestore.rules) no Firebase.", true);
  }
}

// ============================================================
// ABAS
// ============================================================
document.querySelectorAll(".admin-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".admin-tab").forEach(b => b.classList.remove("ativa"));
    document.querySelectorAll(".admin-aba").forEach(a => a.classList.remove("ativa"));
    btn.classList.add("ativa");
    document.getElementById(`aba-${btn.dataset.aba}`).classList.add("ativa");
  });
});

// ============================================================
// INICIALIZA LISTENERS (só depois do login, pra economizar leituras)
// ============================================================
function iniciarListeners(){
  listenCategorias();
  listenProdutos();
  listenPedidos();
  listenConfigLoja();
  listenUsuarios();
}

// ============================================================
// CATEGORIAS
// ============================================================
function listenCategorias(){
  cancelarCategorias = onSnapshot(query(collection(db, colC()), orderBy("ordem")), (snap) => {
    categorias = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSelectCategorias();
    renderChipsCategorias();
    renderTabelaProdutos();
  }, (err) => { console.error("Erro categorias:", err); avisarErroLeitura(err); });
}

function renderSelectCategorias(){
  const sel = document.getElementById("produto-categoria");
  const atual = sel.value;
  sel.innerHTML = categorias.map(c => `<option value="${c.id}">${c.nome}</option>`).join("")
    || `<option value="">Cadastre uma categoria primeiro</option>`;
  if (categorias.some(c => c.id === atual)) sel.value = atual;
}

function renderChipsCategorias(){
  const box = document.getElementById("lista-categorias-chips");
  if (categorias.length === 0){
    box.innerHTML = `<span style="color:var(--text-faint); font-size:0.85rem">Nenhuma categoria cadastrada ainda.</span>`;
    return;
  }
  const ordenadas = [...categorias].sort((a,b) => (a.ordem||0) - (b.ordem||0));
  box.innerHTML = ordenadas.map(c => `
    <div class="linha-categoria-config arrastavel-item" data-id="${c.id}">
      <span class="arrastar-handle" title="Arrastar categoria">⠿</span>
      <span class="linha-categoria-nome">${c.nome}</span>
      <button data-del-cat="${c.id}" class="btn btn-sm btn-danger">Remover</button>
    </div>
  `).join("");

  box.querySelectorAll("[data-del-cat]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const emUso = produtos.some(p => p.categoriaId === btn.dataset.delCat);
      const aviso = emUso
        ? "Existem produtos nessa categoria. Excluir mesmo assim? Os produtos continuarão existindo, mas ficarão sem categoria visível."
        : "Remover esta categoria?";
      if (!confirm(aviso)) return;
      await deleteDoc(doc(db, colC(), btn.dataset.delCat));
      mostrarToast("Categoria removida.");
    });
  });

  ativarArrastar(box, (itensDom) => persistirOrdemCategorias(itensDom));
}

document.getElementById("form-categoria").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("nova-categoria");
  const nome = input.value.trim();
  if (!nome) return;
  try{
    await addDoc(collection(db, colC()), { nome, ordem: categorias.length });
    input.value = "";
    mostrarToast("Categoria adicionada.");
  } catch(err){
    console.error(err);
    mostrarToast("Erro ao adicionar categoria.", true);
  }
});

// ============================================================
// PRODUTOS
// ============================================================
function listenProdutos(){
  cancelarProdutos = onSnapshot(collection(db, colP()), (snap) => {
    produtos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTabelaProdutos();
  }, (err) => { console.error("Erro produtos:", err); avisarErroLeitura(err); });
}

// ao escolher a foto: comprime no Canvas (máx. 400x400, JPEG 0.75) e já
// deixa pronta em Base64 pra gravar direto no Firestore (sem Storage)
document.getElementById("produto-foto").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const preview = document.getElementById("preview-foto");
  const texto = document.getElementById("texto-upload");

  if (!file){
    fotoBase64Selecionada = null;
    preview.style.display = "none";
    texto.textContent = "Toque para escolher uma imagem";
    return;
  }

  texto.textContent = "Otimizando imagem...";
  try{
    fotoBase64Selecionada = await comprimirImagem(file);
    preview.src = fotoBase64Selecionada;
    preview.style.display = "block";
    texto.textContent = `${file.name} (otimizada)`;
  } catch(err){
    console.error(err);
    fotoBase64Selecionada = null;
    mostrarToast("Não foi possível processar essa imagem.", true);
    texto.textContent = "Toque para escolher uma imagem";
  }
});

document.getElementById("form-produto").addEventListener("submit", async (e) => {
  e.preventDefault();

  const nome = document.getElementById("produto-nome").value.trim();
  const categoriaId = document.getElementById("produto-categoria").value;
  const preco = parseFloat(document.getElementById("produto-preco").value);
  const volume = document.getElementById("produto-volume").value.trim();
  const disponivel = document.getElementById("produto-disponivel").value === "true";

  if (!nome || !categoriaId || isNaN(preco)){
    return mostrarToast("Preencha nome, categoria e preço.", true);
  }

  const btnSalvar = document.getElementById("btn-salvar-produto");
  btnSalvar.disabled = true;
  btnSalvar.innerHTML = `<span class="spinner" style="width:15px;height:15px"></span> Salvando...`;

  try{
    let imagemUrl = "";
    if (edicaoProdutoId){
      const atual = produtos.find(p => p.id === edicaoProdutoId);
      imagemUrl = atual?.imagemUrl || "";
    }

    // se uma foto nova foi escolhida, ela já está comprimida em Base64
    // (feito no listener do input de arquivo) — grava direto, sem Storage
    if (fotoBase64Selecionada){
      imagemUrl = fotoBase64Selecionada;
    }

    const dadosProduto = {
      nome, categoriaId, preco, volume, disponivel,
      imagemUrl: imagemUrl || ""
    };

    if (edicaoProdutoId){
      await updateDoc(doc(db, colP(), edicaoProdutoId), dadosProduto);
      mostrarToast("Produto atualizado!");
    } else {
      await addDoc(collection(db, colP()), { ...dadosProduto, ordem: produtos.length });
      mostrarToast("Produto cadastrado!");
    }

    resetFormProduto();
  } catch(err){
    console.error(err);
    mostrarToast(err && err.code === "permission-denied"
      ? "Sem permissão para salvar. Publique as regras novas do Firestore e confirme admin: true."
      : "Erro ao salvar produto. Verifique a configuração do Firebase.", true);
  }

  btnSalvar.disabled = false;
  btnSalvar.textContent = "Salvar produto";
});

function resetFormProduto(){
  edicaoProdutoId = null;
  fotoBase64Selecionada = null;
  document.getElementById("form-produto").reset();
  document.getElementById("produto-id").value = "";
  document.getElementById("preview-foto").style.display = "none";
  document.getElementById("texto-upload").textContent = "Toque para escolher uma imagem";
  document.getElementById("titulo-form-produto").textContent = "Novo produto";
  document.getElementById("btn-cancelar-edicao").style.display = "none";
}

document.getElementById("btn-cancelar-edicao").addEventListener("click", resetFormProduto);

// ============================================================
// ARRASTAR E SOLTAR (Pointer Events — funciona com toque e mouse)
// ============================================================
// container: elemento pai; os filhos diretos com classe "arrastavel-item" são
// os itens que podem ser arrastados, cada um contendo um ".arrastar-handle".
// aoSoltar(itensEmOrdemDom) é chamado ao final do arraste, com os elementos
// já na nova ordem visual — quem chama decide o que persistir.
//
// O item "gruda" no dedo/mouse (translateY) e só troca de lugar com o
// vizinho imediatamente acima/abaixo quando o centro dele ultrapassa o
// centro do vizinho — nunca compara com a lista toda de uma vez, que era
// o que fazia o item pular direto pro topo/fim ao mínimo movimento.
function ativarArrastar(container, aoSoltar){
  let item = null;
  let startY = 0;

  function ehItem(el){
    return el && el.classList && el.classList.contains("arrastavel-item");
  }

  function aoMover(e){
    if (!item) return;
    e.preventDefault();

    const delta = e.clientY - startY;
    item.style.transform = `translateY(${delta}px)`;

    const rectItem = item.getBoundingClientRect();
    const centroItem = rectItem.top + rectItem.height / 2;

    const proximo = item.nextElementSibling;
    if (ehItem(proximo)){
      const rectProx = proximo.getBoundingClientRect();
      if (centroItem > rectProx.top + rectProx.height / 2){
        container.insertBefore(proximo, item);
        startY = e.clientY;
        item.style.transform = "translateY(0px)";
        return;
      }
    }

    const anterior = item.previousElementSibling;
    if (ehItem(anterior)){
      const rectAnt = anterior.getBoundingClientRect();
      if (centroItem < rectAnt.top + rectAnt.height / 2){
        container.insertBefore(item, anterior);
        startY = e.clientY;
        item.style.transform = "translateY(0px)";
      }
    }
  }

  function aoFinalizar(){
    if (!item) return;
    item.style.transform = "";
    item.style.zIndex = "";
    item.classList.remove("arrastando");
    const itemFinal = item;
    item = null;
    document.removeEventListener("pointermove", aoMover);
    document.removeEventListener("pointerup", aoFinalizar);
    document.removeEventListener("pointercancel", aoFinalizar);
    aoSoltar(Array.from(container.querySelectorAll(':scope > .arrastavel-item')), itemFinal);
  }

  container.querySelectorAll(':scope > .arrastavel-item .arrastar-handle').forEach(handle => {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      item = handle.closest(".arrastavel-item");
      startY = e.clientY;
      item.classList.add("arrastando");
      item.style.zIndex = "50";
      try{ handle.setPointerCapture(e.pointerId); } catch(err){ /* ignora se não suportado */ }
      document.addEventListener("pointermove", aoMover, { passive: false });
      document.addEventListener("pointerup", aoFinalizar);
      document.addEventListener("pointercancel", aoFinalizar);
    });
  });
}

async function persistirOrdemProdutos(itensDom){
  try{
    await Promise.all(itensDom.map((el, i) => updateDoc(doc(db, colP(), el.dataset.id), { ordem: i })));
  } catch(err){
    console.error(err);
    mostrarToast("Erro ao salvar a nova ordem dos produtos.", true);
  }
}

async function persistirOrdemCategorias(itensDom){
  try{
    await Promise.all(itensDom.map((el, i) => updateDoc(doc(db, colC(), el.dataset.id), { ordem: i })));
    mostrarToast("Ordem atualizada!");
  } catch(err){
    console.error(err);
    mostrarToast("Erro ao salvar a nova ordem das categorias.", true);
  }
}

function linhaProdutoHTML(p, comArraste){
  const cat = categorias.find(c => c.id === p.categoriaId);
  const disponivel = p.disponivel !== false;
  const visivel = p.visivel !== false;
  return `
    <div class="linha-produto-admin arrastavel-item" data-id="${p.id}">
      <div class="linha-produto-topo">
        ${comArraste ? `<span class="arrastar-handle" title="Arrastar produto">⠿</span>` : `<span class="arrastar-handle-vazio"></span>`}
        <img class="thumb" src="${p.imagemUrl || ""}" onerror="this.style.opacity=0.2" alt="">
        <div class="linha-produto-info">
          <div class="linha-produto-nome">${p.nome}</div>
          <div class="linha-produto-preco">${formatarReal(p.preco)}</div>
          <div class="linha-produto-badges">
            <span class="badge badge-categoria">${cat ? cat.nome : "sem categoria"}</span>
            ${!disponivel ? `<span class="badge badge-esgotado">Esgotada</span>` : ""}
            ${!visivel ? `<span class="badge badge-oculto">Oculta no cardápio</span>` : ""}
          </div>
        </div>
      </div>
      <div class="linha-produto-acoes">
        <button class="icone-acao" data-toggle-visivel="${p.id}" title="${visivel ? "Ocultar do cardápio" : "Mostrar no cardápio"}">${visivel ? "👁️" : "🙈"}</button>
        <button class="icone-acao" data-editar="${p.id}" title="Editar produto">✏️</button>
        <button class="icone-acao icone-perigo" data-excluir="${p.id}" title="Excluir produto">🗑️</button>
        <button class="pilula-esgotado ${disponivel ? "" : "ativa"}" data-toggle="${p.id}">${disponivel ? "Marcar esgotada" : "Esgotada"}</button>
      </div>
    </div>`;
}

function ligarEventosLinhasProduto(container){
  container.querySelectorAll("[data-editar]").forEach(b => b.addEventListener("click", () => editarProduto(b.dataset.editar)));
  container.querySelectorAll("[data-toggle]").forEach(b => b.addEventListener("click", () => alternarDisponibilidade(b.dataset.toggle)));
  container.querySelectorAll("[data-excluir]").forEach(b => b.addEventListener("click", () => excluirProduto(b.dataset.excluir)));
  container.querySelectorAll("[data-toggle-visivel]").forEach(b => b.addEventListener("click", () => alternarVisibilidade(b.dataset.toggleVisivel)));
}

async function alternarVisibilidade(id){
  const p = produtos.find(x => x.id === id);
  if (!p) return;
  try{
    await updateDoc(doc(db, colP(), id), { visivel: !(p.visivel !== false) });
  } catch(err){
    console.error(err);
    mostrarToast("Erro ao atualizar a visibilidade do produto.", true);
  }
}

function renderTabelaProdutos(){
  const container = document.getElementById("lista-organizar-produtos");
  const filtro = document.getElementById("filtro-produtos-admin").value.trim().toLowerCase();
  document.getElementById("produtos-vazio").style.display = produtos.length === 0 ? "block" : "none";

  // com busca ativa: lista simples e sem arrastar, pra não bagunçar a ordem real
  if (filtro){
    const lista = produtos
      .filter(p => p.nome.toLowerCase().includes(filtro))
      .sort((a,b) => (a.ordem||0) - (b.ordem||0));

    container.innerHTML = `
      <div class="aviso-busca-ativa">Buscando "${filtro}" — limpe a busca pra poder reordenar.</div>
      ${lista.map(p => linhaProdutoHTML(p, false)).join("") || `<div class="lista-vazia">Nenhum produto encontrado.</div>`}
    `;
    ligarEventosLinhasProduto(container);
    return;
  }

  // sem busca: agrupado por categoria, com arraste habilitado
  const categoriasOrdenadas = [...categorias].sort((a,b) => (a.ordem||0) - (b.ordem||0));
  const idsComCategoria = new Set(categorias.map(c => c.id));
  const semCategoria = produtos.filter(p => !idsComCategoria.has(p.categoriaId)).sort((a,b) => (a.ordem||0) - (b.ordem||0));

  let html = categoriasOrdenadas.map(cat => {
    const itensCategoria = produtos
      .filter(p => p.categoriaId === cat.id)
      .sort((a,b) => (a.ordem||0) - (b.ordem||0));
    return `
      <div class="bloco-categoria-admin arrastavel-item" data-id="${cat.id}">
        <div class="bloco-categoria-topo">
          <span class="arrastar-handle" title="Arrastar categoria">⠿</span>
          <strong>${cat.nome}</strong>
          <span class="bloco-categoria-contagem">${itensCategoria.length} produto(s)</span>
        </div>
        <div class="lista-produtos-categoria" data-categoria-id="${cat.id}">
          ${itensCategoria.map(p => linhaProdutoHTML(p, true)).join("") || `<div class="lista-vazia" style="padding:12px">Nenhum produto nesta categoria ainda.</div>`}
        </div>
      </div>`;
  }).join("");

  if (semCategoria.length){
    html += `
      <div class="bloco-categoria-admin">
        <div class="bloco-categoria-topo"><span class="arrastar-handle-vazio"></span><strong>Sem categoria</strong></div>
        <div class="lista-produtos-categoria" data-categoria-id="">
          ${semCategoria.map(p => linhaProdutoHTML(p, true)).join("")}
        </div>
      </div>`;
  }

  container.innerHTML = html || `<div class="lista-vazia">Cadastre uma categoria e um produto pra começar.</div>`;

  ligarEventosLinhasProduto(container);

  // arrastar categorias inteiras (ordem das seções do cardápio)
  ativarArrastar(container, (itensDom) => persistirOrdemCategorias(itensDom));

  // arrastar produtos dentro de cada categoria
  container.querySelectorAll(".lista-produtos-categoria").forEach(lista => {
    ativarArrastar(lista, (itensDom) => persistirOrdemProdutos(itensDom));
  });
}

document.getElementById("filtro-produtos-admin").addEventListener("input", renderTabelaProdutos);

function editarProduto(id){
  const p = produtos.find(x => x.id === id);
  if (!p) return;
  edicaoProdutoId = id;
  fotoBase64Selecionada = null; // só troca a imagem se o dono escolher uma nova
  document.getElementById("produto-id").value = id;
  document.getElementById("produto-nome").value = p.nome || "";
  document.getElementById("produto-categoria").value = p.categoriaId || "";
  document.getElementById("produto-preco").value = p.preco || "";
  document.getElementById("produto-volume").value = p.volume || "";
  document.getElementById("produto-disponivel").value = p.disponivel !== false ? "true" : "false";

  const preview = document.getElementById("preview-foto");
  if (p.imagemUrl){
    preview.src = p.imagemUrl;
    preview.style.display = "block";
    document.getElementById("texto-upload").textContent = "Toque para trocar a imagem";
  }

  document.getElementById("titulo-form-produto").textContent = `Editando: ${p.nome}`;
  document.getElementById("btn-cancelar-edicao").style.display = "inline-flex";
  document.querySelector(".admin-tab[data-aba='produtos']").click();
  document.getElementById("form-produto").scrollIntoView({ behavior: "smooth" });
}

async function alternarDisponibilidade(id){
  const p = produtos.find(x => x.id === id);
  if (!p) return;
  try{
    await updateDoc(doc(db, colP(), id), { disponivel: !(p.disponivel !== false) });
  } catch(err){
    console.error(err);
    mostrarToast("Erro ao atualizar disponibilidade.", true);
  }
}

async function excluirProduto(id){
  if (!confirm("Excluir este produto definitivamente?")) return;
  try{
    await deleteDoc(doc(db, colP(), id));
    mostrarToast("Produto excluído.");
  } catch(err){
    console.error(err);
    mostrarToast("Erro ao excluir produto.", true);
  }
}

// ============================================================
// COMANDAS (PEDIDOS EM TEMPO REAL)
// ============================================================
function tocarBeep(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.5);
  } catch(e){ /* navegador pode bloquear áudio sem interação prévia */ }
}

const ORDEM_STATUS = ["Pendente", "Em Preparo", "Saiu para Entrega", "Chegando", "Finalizado", "Cancelado"];

function linkWhatsApp(tel){
  const d = String(tel || "").replace(/\D/g, "");
  if (d.length < 8) return "";
  return `https://wa.me/${d.startsWith("55") && d.length >= 12 ? d : "55" + d}`;
}
function linkMapa(loc){
  if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") return "";
  return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
}

function listenPedidos(){
  onSnapshot(query(collection(db, COL_PEDIDOS), orderBy("criadoEm", "desc")), (snap) => {
    if (!primeiraCargaPedidos){
      snap.docChanges().forEach(change => {
        if (change.type === "added" && !change.doc.metadata.hasPendingWrites){
          tocarBeep();
        }
      });
    }
    pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPedidos();
    primeiraCargaPedidos = false;
  }, (err) => { console.error("Erro pedidos:", err); avisarErroLeitura(err); });
}

function renderPedidos(){
  const grid = document.getElementById("pedidos-grid");
  document.getElementById("pedidos-vazio").style.display = pedidos.length === 0 ? "block" : "none";

  const pendentes = pedidos.filter(p => p.status === "Pendente").length;
  document.getElementById("badge-pendentes").textContent = pendentes > 0 ? `(${pendentes})` : "";

  grid.innerHTML = pedidos.map(p => {
    const hora = p.criadoEm?.toDate ? p.criadoEm.toDate().toLocaleString("pt-BR") : "agora";
    const statusClasse = "status-" + (p.status || "Pendente").toLowerCase().replace(/\s+/g,"-").replace("saiu-para-entrega","entrega").replace("em-preparo","preparo");
    const itensHtml = (p.itens || []).map(it =>
      `<div class="comanda-item-linha"><span>${esc(it.qtd)}x ${esc(it.nome)}</span><span>${formatarReal((Number(it.preco) || 0) * (Number(it.qtd) || 0))}</span></div>`
    ).join("");
    const mapa = linkMapa(p.localizacao);
    const zap = linkWhatsApp(p.telefone);
    const pago = p.pago === true;

    return `
      <div class="comanda ${statusClasse}" data-id="${esc(p.id)}">
        <div class="comanda-topo">
          <div>
            <div class="comanda-cliente">#${esc(p.id)} · ${esc(p.cliente || "Cliente")}</div>
            <div class="comanda-hora">${esc(hora)}</div>
          </div>
        </div>
        ${p.telefone ? `<div class="comanda-info-linha">📞 ${zap ? `<a class="comanda-link" href="${esc(zap)}" target="_blank" rel="noopener">${esc(p.telefone)}</a>` : esc(p.telefone)}</div>` : ""}
        <div class="comanda-info-linha">📍 ${esc(p.endereco || "-")}${mapa ? ` · <a class="comanda-link" href="${esc(mapa)}" target="_blank" rel="noopener">abrir no mapa</a>` : ""}</div>
        <div class="comanda-info-linha">💳 ${esc(p.pagamento || "-")}${p.troco ? ` (troco p/ ${esc(p.troco)})` : ""} · ${pago ? "PAGO ✓" : "não pago"}${p.mpPagamentoId ? " (confirmado pelo Mercado Pago)" : ""}</div>
        ${p.entregadorUid ? `<div class="comanda-info-linha">🛵 Na rota de um entregador</div>` : ""}
        <div class="comanda-itens">${itensHtml}</div>
        <div class="comanda-total"><span>Total</span><span>${formatarReal(p.total)}</span></div>
        ${p.observacoes ? `<div class="comanda-obs">Obs: ${esc(p.observacoes)}</div>` : ""}
        <div class="comanda-acoes">
          <select data-status-id="${esc(p.id)}">
            ${ORDEM_STATUS.map(s => `<option value="${s}" ${p.status === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </div>
        <button type="button" class="btn btn-sm ${pago ? "btn-ghost" : "btn-gold"} comanda-pago" data-pago-id="${esc(p.id)}" data-pago="${pago ? "1" : "0"}">
          ${pago ? "Pago ✓ (desfazer)" : "Marcar como pago"}
        </button>
      </div>`;
  }).join("");

  grid.querySelectorAll("[data-status-id]").forEach(sel => {
    sel.addEventListener("change", async () => {
      try{
        await updateDoc(doc(db, COL_PEDIDOS, sel.dataset.statusId), { status: sel.value });
      } catch(err){
        console.error(err);
        mostrarToast("Erro ao atualizar status do pedido.", true);
      }
    });
  });
  grid.querySelectorAll("[data-pago-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      try{
        await updateDoc(doc(db, COL_PEDIDOS, btn.dataset.pagoId), { pago: btn.dataset.pago !== "1" });
      } catch(err){
        console.error(err);
        mostrarToast("Erro ao atualizar o pagamento.", true);
      }
    });
  });
}

// ============================================================
// LOGINS LIBERADOS (usuarios_autorizados)
// O usuário é criado no Firebase (Authentication); aqui você cola o UID
// e escolhe o tipo: cliente, entregador ou comanda. "admin" só pelo Console.
// ============================================================
const TIPOS_LOGIN = { cliente: "Cliente", entregador: "Entregador", comanda: "Comanda" };
let usuarios = [];

function listenUsuarios(){
  onSnapshot(collection(db, COL_USUARIOS_AUTORIZADOS), (snap) => {
    usuarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderUsuarios();
  }, (err) => { console.error("Erro logins:", err); avisarErroLeitura(err); });
}

function renderUsuarios(){
  const el = document.getElementById("lista-usuarios");
  document.getElementById("usuarios-vazio").style.display = usuarios.length ? "none" : "block";
  const ordenados = [...usuarios].sort((a, b) =>
    (b.admin === true) - (a.admin === true) || String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));

  el.innerHTML = ordenados.map(u => {
    const ehAdmin = u.admin === true;
    const ativo = u.ativo === true;
    const tipo = u.tipo || "cliente";
    return `
      <div class="usuario-linha ${ativo ? "" : "bloqueado"}" data-uid="${esc(u.id)}">
        <div class="usuario-nome">${esc(u.nome || "(sem nome)")}
          ${ehAdmin ? `<span class="badge badge-categoria">Administrador</span>` : `<span class="badge badge-categoria">${esc(TIPOS_LOGIN[tipo] || tipo)}</span>`}
          ${ativo ? "" : `<span class="badge badge-esgotado">Bloqueado</span>`}
        </div>
        <div class="usuario-uid">${esc(u.id)}</div>
        ${ehAdmin ? "" : `
          <div class="usuario-acoes">
            <select data-uacao="tipo" aria-label="Tipo de acesso">
              ${Object.entries(TIPOS_LOGIN).map(([v, r]) => `<option value="${v}" ${v === tipo ? "selected" : ""}>${r}</option>`).join("")}
            </select>
            <button type="button" class="btn btn-sm ${ativo ? "btn-outline" : "btn-gold"}" data-uacao="ativo">${ativo ? "Bloquear" : "Reativar"}</button>
            <button type="button" class="btn btn-sm btn-ghost" data-uacao="remover">Remover</button>
          </div>`}
      </div>`;
  }).join("");
}

function erroUsuario(err, padrao){
  console.error(err);
  mostrarToast(err && err.code === "permission-denied"
    ? "Sem permissão (administradores só se alteram pelo Console, e você não altera o próprio login)."
    : padrao, true);
}

document.getElementById("lista-usuarios").addEventListener("change", async (e) => {
  const sel = e.target.closest('[data-uacao="tipo"]');
  const linha = e.target.closest(".usuario-linha");
  if (!sel || !linha) return;
  try{
    await updateDoc(doc(db, COL_USUARIOS_AUTORIZADOS, linha.dataset.uid), { tipo: sel.value });
    mostrarToast("Tipo de acesso atualizado.");
  }catch(err){ erroUsuario(err, "Erro ao alterar o tipo."); renderUsuarios(); }
});

document.getElementById("lista-usuarios").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-uacao]");
  const linha = e.target.closest(".usuario-linha");
  if (!b || !linha) return;
  const uid = linha.dataset.uid;
  const u = usuarios.find(x => x.id === uid);
  if (!u) return;
  try{
    if (b.dataset.uacao === "ativo"){
      await updateDoc(doc(db, COL_USUARIOS_AUTORIZADOS, uid), { ativo: u.ativo !== true });
      mostrarToast(u.ativo === true ? "Login bloqueado." : "Login reativado.");
    } else if (b.dataset.uacao === "remover"){
      if (!confirm(`Remover o acesso de "${u.nome || uid}"?\n(O usuário continua existindo no Firebase, mas perde o acesso.)`)) return;
      await deleteDoc(doc(db, COL_USUARIOS_AUTORIZADOS, uid));
      mostrarToast("Acesso removido.");
    }
  }catch(err){ erroUsuario(err, "Erro ao atualizar o login."); }
});

document.getElementById("form-usuario").addEventListener("submit", async (e) => {
  e.preventDefault();
  const uid = document.getElementById("usuario-uid").value.trim();
  const nome = document.getElementById("usuario-nome").value.trim();
  const tipo = document.getElementById("usuario-tipo").value;
  if (!/^[A-Za-z0-9]{20,40}$/.test(uid)){
    mostrarToast("UID inválido. Copie o User UID inteiro, na tela Authentication → Users.", true);
    return;
  }
  const existente = usuarios.find(u => u.id === uid);
  if (existente && !confirm(`Esse UID já está liberado como ${TIPOS_LOGIN[existente.tipo || "cliente"] || existente.tipo}. Substituir?`)) return;
  try{
    await setDoc(doc(db, COL_USUARIOS_AUTORIZADOS, uid), { ativo: true, tipo, nome, criadoEm: serverTimestamp() });
    document.getElementById("form-usuario").reset();
    mostrarToast(`Acesso liberado como ${TIPOS_LOGIN[tipo]}.`);
  }catch(err){ erroUsuario(err, "Erro ao liberar o acesso."); }
});

// ============================================================
// CONFIGURAÇÕES DA LOJA
// ============================================================
function listenConfigLoja(){
  onSnapshot(doc(db, "config", "loja"), (snap) => {
    if (!snap.exists()) return;
    const cfg = snap.data();
    document.getElementById("toggle-loja-aberta").checked = cfg.aberta !== false;
    document.getElementById("config-whatsapp").value = cfg.whatsapp || "";
  }, (err) => console.error("Erro config loja:", err));
}

document.getElementById("btn-salvar-config").addEventListener("click", async () => {
  const aberta = document.getElementById("toggle-loja-aberta").checked;
  const whatsapp = document.getElementById("config-whatsapp").value.trim();
  try{
    await setDoc(doc(db, "config", "loja"), { aberta, whatsapp }, { merge: true });
    mostrarToast("Configurações salvas!");
  } catch(err){
    console.error(err);
    mostrarToast("Erro ao salvar configurações.", true);
  }
});

// ============================================================
// IMPORTAÇÃO DE BACKUP (sistema antigo)
// ============================================================
// Espera um .json com o formato: { produtos: {...}, config: { categorias: [...], telefoneLoja } }
// Reaproveita categorias já existentes (por nome) e usa o "code"/nome do produto
// como ID do documento no Firestore, para que importar de novo atualize em vez de duplicar.

document.getElementById("btn-importar-backup").addEventListener("click", importarBackup);

async function importarBackup(){
  const input = document.getElementById("arquivo-backup");
  const file = input.files[0];
  if (!file) return mostrarToast("Selecione um arquivo .json primeiro.", true);

  const progresso = document.getElementById("progresso-importacao");
  const barra = document.getElementById("barra-importacao");
  const texto = document.getElementById("texto-importacao");
  progresso.style.display = "block";
  barra.style.width = "0%";
  texto.textContent = "Lendo arquivo...";

  let dados;
  try{
    const conteudo = await file.text();
    dados = JSON.parse(conteudo);
  } catch(err){
    progresso.style.display = "none";
    return mostrarToast("Arquivo inválido. Confira se é o .json de backup correto.", true);
  }

  const produtosBackup = dados.produtos || {};
  const categoriasBackup = dados.config?.categorias?.length
    ? dados.config.categorias
    : [...new Set(Object.values(produtosBackup).map(p => p.categoria).filter(Boolean))];

  // 1) Categorias: reaproveita as existentes (por nome) e cria as que faltarem
  texto.textContent = "Importando categorias...";
  const mapaCategoria = {};
  categorias.forEach(c => { mapaCategoria[c.nome] = c.id; });

  for (let i = 0; i < categoriasBackup.length; i++){
    const nome = categoriasBackup[i];
    if (!nome || mapaCategoria[nome]) continue;
    try{
      const refCat = await addDoc(collection(db, colC()), { nome, ordem: categorias.length + i });
      mapaCategoria[nome] = refCat.id;
    } catch(err){
      console.error("Erro ao importar categoria", nome, err);
    }
  }

  // 2) Produtos: grava o Base64 já existente direto no Firestore (sem Storage)
  const listaProdutos = Object.values(produtosBackup);
  const total = listaProdutos.length || 1;
  let feitos = 0;
  let comErro = 0;

  for (const p of listaProdutos){
    const nomeProduto = p.name || "Produto sem nome";
    texto.textContent = `Importando ${feitos + 1} de ${total}: ${nomeProduto}`;
    try{
      // o backup antigo já traz a foto em Base64 (data:image/...) — usamos direto
      const imagemUrl = (p.image && typeof p.image === "string" && p.image.startsWith("data:image"))
        ? p.image
        : "";
      const docId = String(p.code || nomeProduto).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
      await setDoc(doc(db, colP(), docId), {
        nome: nomeProduto,
        categoriaId: mapaCategoria[p.categoria] || "",
        preco: Number(p.price) || 0,
        volume: "",
        disponivel: p.stock === undefined ? true : Number(p.stock) > 0,
        imagemUrl,
        ordem: Number(p.ordem) || 0
      }, { merge: true });
    } catch(err){
      comErro++;
      console.error("Erro ao importar produto", nomeProduto, err);
    }
    feitos++;
    barra.style.width = Math.round((feitos / total) * 100) + "%";
  }

  // 3) WhatsApp da loja, se presente no backup
  if (dados.config?.telefoneLoja){
    let numero = String(dados.config.telefoneLoja).replace(/\D/g, "");
    if (!numero.startsWith("55")) numero = "55" + numero;
    try{
      await setDoc(doc(db, "config", "loja"), { whatsapp: numero }, { merge: true });
    } catch(err){
      console.error("Erro ao importar WhatsApp da loja", err);
    }
  }

  texto.textContent = comErro > 0
    ? `Concluído: ${feitos} produtos processados, ${comErro} com erro (veja o console).`
    : `Importação concluída! ${feitos} produtos importados.`;
  mostrarToast(comErro > 0 ? "Importação concluída com alguns erros." : "Backup importado com sucesso!", comErro > 0);
}
