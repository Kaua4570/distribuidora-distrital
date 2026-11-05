// ============================================================
// DISTRIBUIDORA CAMPOS — admin.js (painel do dono)
// ============================================================
import { db, ADMIN_SENHA, COL_PRODUTOS, COL_CATEGORIAS, COL_PEDIDOS } from "./firebase-config.js";
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
// LOGIN
// ============================================================
const telaLogin = document.getElementById("tela-login");
const appAdmin = document.getElementById("app-admin");

function entrarNoPainel(){
  telaLogin.style.display = "none";
  appAdmin.style.display = "block";
  iniciarListeners();
}

if (sessionStorage.getItem("distcampos_admin_logado") === "1"){
  entrarNoPainel();
}

document.getElementById("form-login").addEventListener("submit", (e) => {
  e.preventDefault();
  const senha = document.getElementById("senha-admin").value;
  if (senha === ADMIN_SENHA){
    sessionStorage.setItem("distcampos_admin_logado", "1");
    entrarNoPainel();
  } else {
    document.getElementById("login-erro").textContent = "Senha incorreta. Tente novamente.";
  }
});

document.getElementById("btn-sair").addEventListener("click", () => {
  sessionStorage.removeItem("distcampos_admin_logado");
  location.reload();
});

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
}

// ============================================================
// CATEGORIAS
// ============================================================
function listenCategorias(){
  onSnapshot(query(collection(db, COL_CATEGORIAS), orderBy("ordem")), (snap) => {
    categorias = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSelectCategorias();
    renderChipsCategorias();
    renderTabelaProdutos();
  }, (err) => console.error("Erro categorias:", err));
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
      await deleteDoc(doc(db, COL_CATEGORIAS, btn.dataset.delCat));
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
    await addDoc(collection(db, COL_CATEGORIAS), { nome, ordem: categorias.length });
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
  onSnapshot(collection(db, COL_PRODUTOS), (snap) => {
    produtos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTabelaProdutos();
  }, (err) => console.error("Erro produtos:", err));
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
      await updateDoc(doc(db, COL_PRODUTOS, edicaoProdutoId), dadosProduto);
      mostrarToast("Produto atualizado!");
    } else {
      await addDoc(collection(db, COL_PRODUTOS), { ...dadosProduto, ordem: produtos.length });
      mostrarToast("Produto cadastrado!");
    }

    resetFormProduto();
  } catch(err){
    console.error(err);
    mostrarToast("Erro ao salvar produto. Verifique a configuração do Firebase.", true);
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
    await Promise.all(itensDom.map((el, i) => updateDoc(doc(db, COL_PRODUTOS, el.dataset.id), { ordem: i })));
  } catch(err){
    console.error(err);
    mostrarToast("Erro ao salvar a nova ordem dos produtos.", true);
  }
}

async function persistirOrdemCategorias(itensDom){
  try{
    await Promise.all(itensDom.map((el, i) => updateDoc(doc(db, COL_CATEGORIAS, el.dataset.id), { ordem: i })));
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
    await updateDoc(doc(db, COL_PRODUTOS, id), { visivel: !(p.visivel !== false) });
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
    await updateDoc(doc(db, COL_PRODUTOS, id), { disponivel: !(p.disponivel !== false) });
  } catch(err){
    console.error(err);
    mostrarToast("Erro ao atualizar disponibilidade.", true);
  }
}

async function excluirProduto(id){
  if (!confirm("Excluir este produto definitivamente?")) return;
  try{
    await deleteDoc(doc(db, COL_PRODUTOS, id));
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

const ORDEM_STATUS = ["Pendente", "Em Preparo", "Saiu para Entrega", "Finalizado", "Cancelado"];

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
  }, (err) => console.error("Erro pedidos:", err));
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
      `<div class="comanda-item-linha"><span>${it.qtd}x ${it.nome}</span><span>${formatarReal(it.preco * it.qtd)}</span></div>`
    ).join("");

    return `
      <div class="comanda ${statusClasse}" data-id="${p.id}">
        <div class="comanda-topo">
          <div>
            <div class="comanda-cliente">${p.cliente || "Cliente"}</div>
            <div class="comanda-hora">${hora}</div>
          </div>
        </div>
        <div class="comanda-info-linha">📍 ${p.endereco || "-"}</div>
        <div class="comanda-info-linha">💳 ${p.pagamento || "-"}${p.troco ? ` (troco p/ ${p.troco})` : ""}</div>
        <div class="comanda-itens">${itensHtml}</div>
        <div class="comanda-total"><span>Total</span><span>${formatarReal(p.total)}</span></div>
        ${p.observacoes ? `<div class="comanda-obs">Obs: ${p.observacoes}</div>` : ""}
        <div class="comanda-acoes">
          <select data-status-id="${p.id}">
            ${ORDEM_STATUS.map(s => `<option value="${s}" ${p.status === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </div>
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
}

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
      const refCat = await addDoc(collection(db, COL_CATEGORIAS), { nome, ordem: categorias.length + i });
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
      await setDoc(doc(db, COL_PRODUTOS, docId), {
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
