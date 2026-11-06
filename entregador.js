// ============================================================
// DISTRIBUIDORA CAMPOS — entregador.js
// Tela do entregador: um "+" no topo; digita o número do pedido e ele entra
// na rota. Cada pedido mostra itens, se está pago, localização, WhatsApp e
// o botão "Pronto" (o pedido sai da tela e fica Finalizado para o cliente).
// Acesso: login Firebase + tipo "entregador" em usuarios_autorizados.
// As REGRAS do Firestore limitam o que o entregador pode mexer
// (só entregadorUid, status e entregueEm do pedido).
// ============================================================
import {
  auth, db, doc, getDoc, updateDoc, onSnapshot, collection, query, where,
  serverTimestamp, signOut, onAuthStateChanged, perfilDoUsuario, paginaInicialDo,
  COL_USUARIOS_AUTORIZADOS, COL_PEDIDOS
} from "./secreto-firebase.js";

const SAIDA = "index.html";

const elPorteiro = document.getElementById("en-porteiro");
const elApp      = document.getElementById("en-app");
const elUsuario  = document.getElementById("en-usuario");
const elLista    = document.getElementById("en-lista");
const elToast    = document.getElementById("toast");
const elModal    = document.getElementById("en-modal");
const elForm     = document.getElementById("en-form");
const elNumero   = document.getElementById("en-numero");
const elModalErro = document.getElementById("en-modal-erro");
const elConfirmar = document.getElementById("en-confirmar");

let uidAtual = null;
let rota = [];
let cancelarRota = null;
let cancelarAutorizacao = null;
let iniciado = false;
let encerrado = false;

// ---------------- Utilitários ----------------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const real = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function toast(msg, erro = false){
  elToast.textContent = msg;
  elToast.classList.toggle("erro", erro);
  elToast.classList.add("mostrar");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => elToast.classList.remove("mostrar"), 3200);
}

function linkWhatsApp(tel){
  const d = String(tel || "").replace(/\D/g, "");
  if (d.length < 8) return "";
  return `https://wa.me/${d.startsWith("55") && d.length >= 12 ? d : "55" + d}`;
}
function linkMapa(loc){
  if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") return "";
  return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
}

// ---------------- Saída / bloqueio ----------------
function bloquear(destino = SAIDA){
  if (encerrado) return;
  encerrado = true;
  try{ cancelarRota && cancelarRota(); }catch(_){}
  try{ cancelarAutorizacao && cancelarAutorizacao(); }catch(_){}
  rota = [];
  elLista.innerHTML = "";
  elApp.hidden = true;
  elPorteiro.hidden = false;
  window.location.replace(destino);
}
async function sairDaConta(){
  try{ await signOut(auth); }catch(_){}
  bloquear(SAIDA);
}
document.getElementById("en-sair").addEventListener("click", sairDaConta);

// ---------------- Porteiro ----------------
onAuthStateChanged(auth, async (user) => {
  if (!user){ bloquear(SAIDA); return; }
  if (iniciado) return;
  iniciado = true;

  const perfil = await perfilDoUsuario(user);
  if (!perfil || !perfil.ativo){ await sairDaConta(); return; }
  if (perfil.tipo !== "entregador"){ bloquear(paginaInicialDo(perfil)); return; }   // outro tipo de login
  if (!auth.currentUser){ iniciado = false; return; }

  uidAtual = user.uid;
  elUsuario.textContent = perfil.nome || user.email || "";
  elPorteiro.hidden = true;
  elApp.hidden = false;

  // acesso removido/bloqueado → sai na hora
  cancelarAutorizacao = onSnapshot(
    doc(db, COL_USUARIOS_AUTORIZADOS, user.uid),
    (snap) => {
      const d = snap.exists() ? snap.data() : null;
      if (!d || d.ativo !== true || d.tipo !== "entregador") sairDaConta();
    },
    () => sairDaConta()
  );

  // minha rota: só os pedidos que estão na minha conta
  cancelarRota = onSnapshot(
    query(collection(db, COL_PEDIDOS), where("entregadorUid", "==", user.uid)),
    (snap) => {
      rota = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(p => p.status !== "Finalizado" && p.status !== "Cancelado")
        .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
      render();
    },
    (err) => {
      console.error("Rota:", err.code);
      toast("Não foi possível carregar sua rota. Verifique a conexão.", true);
    }
  );
});

window.addEventListener("pageshow", (e) => { if (e.persisted && !auth.currentUser) bloquear(SAIDA); });

// ---------------- Render ----------------
function render(){
  if (encerrado) return;
  if (!rota.length){
    elLista.innerHTML = `<div class="en-vazio">Nenhum pedido na sua rota.<br>Toque no <strong>+</strong> e digite o número do pedido.</div>`;
    return;
  }
  elLista.innerHTML = rota.map(cardHTML).join("");
}

function cardHTML(p){
  const mapa = linkMapa(p.localizacao);
  const zap = linkWhatsApp(p.telefone);
  const pago = p.pago === true;
  const chegando = p.status === "Chegando";
  const receber = !pago
    ? `<div class="en-receber">💵 Receber na entrega: ${real(p.total)}${p.pagamento === "Dinheiro" && p.troco ? ` · troco para ${esc(p.troco)}` : ""}${p.pagamento === "Pix" ? " · Pix ainda não confirmado" : ""}</div>`
    : "";
  return `
    <article class="en-card ${chegando ? "chegando" : ""}" data-id="${esc(p.id)}">
      <div class="en-card-topo">
        <span class="en-num">Pedido #${esc(p.id)}</span>
        <span class="en-pago ${pago ? "sim" : "nao"}">${pago ? "PAGO ✓" : "NÃO PAGO"}</span>
      </div>
      <div class="en-cliente">${esc(p.cliente)}</div>
      <div class="en-linha">📞 ${esc(p.telefone)}</div>
      <div class="en-linha">📍 ${esc(p.endereco)}</div>
      <div class="en-linha">${p.pagamento === "Pix" ? "Pix" : "Dinheiro"}${chegando ? " · você avisou que está chegando" : ""}</div>
      <div class="en-itens">
        ${(p.itens || []).map(i => `<div><span>${esc(i.qtd)}x ${esc(i.nome)}</span><span>${real((Number(i.preco) || 0) * (Number(i.qtd) || 0))}</span></div>`).join("")}
        <div class="en-total"><span>Total</span><span>${real(p.total)}</span></div>
      </div>
      ${receber}
      <div class="en-links">
        <a class="en-link ${mapa ? "" : "desligado"}" ${mapa ? `href="${esc(mapa)}" target="_blank" rel="noopener"` : ""}>📍 ${mapa ? "Abrir localização" : "Sem localização"}</a>
        <a class="en-link ${zap ? "" : "desligado"}" ${zap ? `href="${esc(zap)}" target="_blank" rel="noopener"` : ""}>💬 WhatsApp</a>
      </div>
      <div class="en-acoes">
        <button type="button" class="btn btn-outline" data-acao="chegando" ${chegando ? "hidden" : ""}>Estou chegando</button>
        <button type="button" class="btn btn-pronto" data-acao="pronto">Pronto ✓</button>
      </div>
    </article>`;
}

elLista.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-acao]");
  const card = e.target.closest(".en-card");
  if (!b || !card) return;
  const id = card.dataset.id;
  b.disabled = true;
  try{
    if (b.dataset.acao === "chegando"){
      await updateDoc(doc(db, COL_PEDIDOS, id), { status: "Chegando" });
      toast("Cliente avisado: você está chegando.");
    } else if (b.dataset.acao === "pronto"){
      if (!confirm(`Confirmar a entrega do pedido #${id}?`)){ b.disabled = false; return; }
      await updateDoc(doc(db, COL_PEDIDOS, id), { status: "Finalizado", entregueEm: serverTimestamp() });
      toast(`Pedido #${id} finalizado.`);
    }
  }catch(err){
    console.error(err);
    toast("Não foi possível atualizar o pedido. Tente de novo.", true);
    b.disabled = false;
  }
});

// ---------------- "+" : adicionar pedido à rota ----------------
function abrirModal(){
  elNumero.value = "";
  elModalErro.textContent = "";
  elModal.hidden = false;
  setTimeout(() => elNumero.focus(), 50);
}
function fecharModal(){ elModal.hidden = true; }

document.getElementById("en-mais").addEventListener("click", abrirModal);
document.getElementById("en-cancelar").addEventListener("click", fecharModal);
elModal.addEventListener("click", (e) => { if (e.target === elModal) fecharModal(); });

elForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const num = elNumero.value.replace(/\D/g, "").replace(/^0+/, "");
  if (!num){ elModalErro.textContent = "Digite o número do pedido."; return; }
  elConfirmar.disabled = true;
  elModalErro.textContent = "";
  try{
    const ref = doc(db, COL_PEDIDOS, num);
    const snap = await getDoc(ref);
    if (!snap.exists()){ elModalErro.textContent = `Pedido #${num} não encontrado.`; return; }
    const p = snap.data();
    if (p.status === "Finalizado" || p.status === "Cancelado"){
      elModalErro.textContent = `O pedido #${num} já está ${p.status === "Finalizado" ? "finalizado" : "cancelado"}.`; return;
    }
    if (p.entregadorUid && p.entregadorUid !== uidAtual){
      elModalErro.textContent = `O pedido #${num} já está na rota de outro entregador.`; return;
    }
    if (p.entregadorUid === uidAtual){
      elModalErro.textContent = `O pedido #${num} já está na sua rota.`; return;
    }
    await updateDoc(ref, { entregadorUid: uidAtual, status: "Saiu para Entrega" });
    fecharModal();
    toast(`Pedido #${num} adicionado à sua rota.`);
  }catch(err){
    console.error(err);
    elModalErro.textContent = err && err.code === "permission-denied"
      ? "Sem permissão para esse pedido."
      : "Não foi possível adicionar agora. Tente de novo.";
  }finally{
    elConfirmar.disabled = false;
  }
});
