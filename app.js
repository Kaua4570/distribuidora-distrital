import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, collection, onSnapshot, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig, API_BASE } from './firebase-config.js';
const fb = initializeApp(firebaseConfig), auth = getAuth(fb), db = getFirestore(fb);
const $ = s => document.querySelector(s), R = n => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Vitrine pública (somente visual, tudo esgotado) — edite aqui os produtos do preview
const PREV = [['Cerveja', [['Skol Lata 350ml', 4.29], ['Brahma Lata 350ml', 4.39], ['Heineken Long Neck', 7.9], ['Stella Artois Long Neck', 7.5], ['Original 600ml', 11.9]]], ['Refrigerante', [['Coca-Cola 2L', 10.5], ['Guaraná Antarctica 2L', 9.5], ['Fanta Laranja 2L', 9.5]]]];
const S = { v: 'home', u: null, cart: {}, dr: null, ck: null, tab: 'ent', cfg: { faixas: [], loja: null }, prods: [], peds: [], ent: null, pin: '' }, F = {};
let unsubs = [], unPed = null;
const kmD = (a, b, c, d) => { const r = x => x * Math.PI / 180, h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const fee = k => { const f = [...(S.cfg.faixas || [])].sort((a, b) => a.km - b.km), x = f.find(z => k <= z.km) || f[f.length - 1]; return x ? x.p : 0; };
const sub = () => Object.entries(S.cart).reduce((s, [i, q]) => s + q * (S.prods.find(p => p.id === i) || { p: 0 }).p, 0);
const qtd = () => Object.values(S.cart).reduce((a, b) => a + b, 0);
function toast(m) { $('#tt').innerHTML = `<div class="toast">${esc(m)}</div>`; clearTimeout(toast.t); toast.t = setTimeout(() => $('#tt').innerHTML = '', 2800); }
async function api(p, b) {
  const t = await auth.currentUser.getIdToken();
  const r = await fetch(API_BASE + '/api/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(b) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || 'Erro no servidor'); return j;
}
const go = v => { S.v = v; S.dr = null; S.pin = ''; render(); };
function render() { $('#app').innerHTML = ({ home: vHome, login: vLogin, pin: vPin, loja: vLoja, admin: vAdmin, ent: vEnt })[S.v](); $('#ov').innerHTML = S.dr ? drawer() : ''; }
const inp = (k, ph = '', t = 'text') => `<input data-k="${k}" type="${t}" placeholder="${ph}" value="${esc(F[k] || '')}">`;
/* ---------- sessão ---------- */
function watch(role) {
  unsubs.forEach(f => f()); unsubs = [];
  if (role === 'cliente' || role === 'admin') {
    unsubs.push(onSnapshot(collection(db, 'produtos'), s => { S.prods = s.docs.map(d => ({ id: d.id, ...d.data() })); if (['loja', 'admin'].includes(S.v) && !S.dr) render(); }));
    unsubs.push(onSnapshot(doc(db, 'config', 'entrega'), s => { S.cfg = s.data() || S.cfg; if (S.v === 'admin' && S.tab === 'ent') render(); }));
  }
  if (role === 'admin') unsubs.push(onSnapshot(query(collection(db, 'pedidos'), orderBy('n', 'desc')), s => { S.peds = s.docs.map(d => d.data()); if (S.v === 'admin' && S.tab === 'ped') render(); }));
}
onAuthStateChanged(auth, async u => {
  unsubs.forEach(f => f()); unsubs = [];
  if (!u) { S.u = null; S.cart = {}; return go('home'); }
  const t = await u.getIdTokenResult(true), role = t.claims.role;
  if (!role) { await signOut(auth); return toast('Conta sem permissão de acesso'); }
  S.u = { role, nome: u.displayName || u.email };
  if (role === 'cliente') { watch('cliente'); return go('loja'); }
  if (t.claims.pinAt && Date.now() - t.claims.pinAt < 8 * 36e5) { watch(role); return go(role === 'admin' ? 'admin' : 'ent'); }
  go('pin');
});
/* ---------- telas ---------- */
function vHome() {
  return `<div class="top"><h1>Distribuidora Campos</h1><button class="ic" data-lupa aria-label="Buscar">🔍</button></div>
<div class="pills">${PREV.map(c => `<span class="pill">${c[0]}</span>`).join('')}</div>
${PREV.map(c => `<div class="sec"><h2>${c[0]}</h2>${c[1].map(p => `<div class="it off"><div class="th">${p[0][0]}</div><div class="n"><b>${esc(p[0])}</b><span class="pr">${R(p[1])}</span></div><span class="tag">ESGOTADO</span></div>`).join('')}</div>`).join('')}`;
}
const vLogin = () => `<div class="center"><h2>Entrar</h2><p class="mut">Acesso para clientes cadastrados</p></div><div class="sec"><label>E-mail</label>${inp('em', '', 'email')}<label>Senha</label>${inp('pw', '', 'password')}<button class="btn" style="margin-top:14px" data-a="entrar">Entrar</button><button class="btn g" style="margin-top:8px" data-a="home">Voltar</button></div>`;
const vPin = () => `<div class="center"><h2>PIN de ${S.u.role === 'admin' ? 'administrador' : 'entregador'}</h2><p class="mut">Olá, ${esc(S.u.nome)}. Digite seu PIN de 6 dígitos.</p></div><div class="dots">${[0, 1, 2, 3, 4, 5].map(i => `<i class="${i < S.pin.length ? 'f' : ''}"></i>`).join('')}</div><div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, '✓'].map(k => `<button data-a="key" data-k="${k}">${k}</button>`).join('')}</div><div style="text-align:center"><button class="sm" data-a="sair">Cancelar</button></div>`;
function vLoja() {
  const cats = [...new Set(S.prods.map(p => p.c))];
  return `<div class="top"><h1>${esc(S.u.nome)}</h1><button class="sm" data-a="sair">Sair</button></div><div class="pills">${cats.map(c => `<span class="pill">${esc(c)}</span>`).join('')}</div>
${cats.map(c => `<div class="sec"><h2>${esc(c)}</h2>${S.prods.filter(p => p.c === c).map(p => `<div class="it ${p.on ? '' : 'off'}"><div class="th">${esc(p.n[0])}</div><div class="n"><b>${esc(p.n)}</b><span>${esc(p.d)}</span><br><span class="pr">${R(p.p)}</span></div>${p.on ? `<div class="q">${S.cart[p.id] ? `<button class="m" data-a="add" data-i="${p.id}" data-d="-1">−</button><b>${S.cart[p.id]}</b>` : ''}<button data-a="add" data-i="${p.id}" data-d="1">+</button></div>` : '<span class="tag">ESGOTADO</span>'}</div>`).join('')}</div>`).join('')}
${qtd() ? `<button class="btn fab" data-a="cart"><span>${qtd()} ${qtd() > 1 ? 'itens' : 'item'} · Ver carrinho</span><span>${R(sub())}</span></button>` : ''}`;
}
const linhas = () => Object.entries(S.cart).map(([i, q]) => { const p = S.prods.find(x => x.id === i); return p ? `<div class="row"><span>${q}× ${esc(p.n)}</span><span>${R(q * p.p)}</span></div>` : ''; }).join('');
function drawer() {
  if (S.dr === 'cart') return `<div class="ov" data-a="fechar"><div class="sheet"><h2>Seu carrinho</h2>${linhas()}<div class="row tot"><span>Subtotal</span><span>${R(sub())}</span></div><p class="mut">A taxa de entrega entra depois de informar o endereço.</p><button class="btn" data-a="ck">Continuar pedido</button></div></div>`;
  const c = S.ck, taxa = c.km != null ? fee(c.km) : 0;
  if (c.step === 1) return `<div class="ov"><div class="sheet"><h2>Seus dados</h2><label>Nome</label>${inp('nome')}<label>Telefone (WhatsApp)</label>${inp('tel', '(00) 0 0000-0000', 'tel')}<p class="mut">Somente entrega. Não há retirada.</p><button class="btn" data-a="s2">Próximo</button><button class="sm" data-a="fechar2">Cancelar</button></div></div>`;
  if (c.step === 2) return `<div class="ov"><div class="sheet"><h2>Endereço de entrega</h2><button class="btn g" data-a="gps">📍 ${c.km == null ? 'Usar minha localização' : 'Localização sincronizada'}</button>${c.km != null ? `<div class="box"><b>${c.km.toFixed(1)} km da loja</b><br><span class="mut">Taxa de entrega ${R(taxa)}</span></div>` : ''}<label>Rua / bairro</label>${inp('end')}<label>Quadra e lote</label>${inp('quadra', 'Ex: Quadra 12, Lote 4')}<label>Ponto de referência</label>${inp('ref')}<div style="display:flex;gap:8px;margin-top:14px"><button class="btn g" data-a="s1">Voltar</button><button class="btn" data-a="s3">Próximo</button></div></div></div>`;
  if (c.step === 3) return `<div class="ov"><div class="sheet"><h2>Resumo do pedido</h2>${linhas()}<div class="row"><span>Subtotal</span><span>${R(sub())}</span></div><div class="row"><span>Entrega (${c.km.toFixed(1)} km)</span><span>${R(taxa)}</span></div><div class="row tot"><span>Total</span><span>${R(sub() + taxa)}</span></div><div class="box mut">${esc(F.nome)} · ${esc(F.tel)}<br>${esc(F.end)} · ${esc(F.quadra)}${F.ref ? ' · ' + esc(F.ref) : ''}</div><p class="mut">Pagamento por Pix. O valor final é conferido pelo servidor.</p><div style="display:flex;gap:8px"><button class="btn g" data-a="s2b">Voltar</button><button class="btn" data-a="pagar">${c.busy ? 'Gerando Pix…' : 'Pagar com Pix'}</button></div></div></div>`;
  const p = c.ped;
  return `<div class="ov"><div class="sheet center" style="padding-top:18px"><h2>Pedido #${c.num}</h2>${p && p.status !== 'aguardando_pagamento' ? `<h3 class="ok">✔ Pagamento confirmado</h3><p class="mut">A distribuidora já recebeu seu pedido. Status: ${esc(p.status.replace('_', ' '))}.</p><button class="btn" data-a="fim">Voltar ao cardápio</button>` : `<p class="mut">Pague ${R(c.total)} com Pix. Esta tela confirma sozinha quando o pagamento cair.</p>${c.img ? `<img class="qr" alt="QR Code Pix" src="data:image/png;base64,${c.img}">` : ''}<button class="btn g" data-a="copiar">Copiar código Pix</button><p class="mut">Aguardando pagamento…</p>`}</div></div>`;
}
/* ---------- admin ---------- */
function vAdmin() {
  const T = [['ent', 'Entrega'], ['prod', 'Produtos'], ['cli', 'Cadastros'], ['ped', 'Pedidos']], f = S.cfg.faixas || []; let b = '';
  if (S.tab === 'ent') b = `<div class="sec"><h2>Taxa por distância</h2><p class="mut">Cada faixa vale até o limite de km. Acima da última, vale o valor dela.</p>${f.map((x, i) => `<div class="f2"><input type="number" step="0.1" data-ch="fk" data-i="${i}" value="${x.km}" aria-label="Até km"><input type="number" step="0.5" data-ch="fp" data-i="${i}" value="${x.p}" aria-label="Preço"><button class="ic" data-a="delf" data-i="${i}">🗑</button></div>`).join('')}<p class="mut">Esquerda: até quantos km · Direita: preço em R$</p><button class="btn g" data-a="addf">+ Adicionar faixa</button>
<div class="box"><b>Localização da loja</b><br><span class="mut">${S.cfg.loja ? S.cfg.loja.lat.toFixed(4) + ', ' + S.cfg.loja.lng.toFixed(4) : 'Não definida'}</span><button class="btn g" style="margin-top:8px" data-a="loja">📍 Usar minha localização atual como loja</button></div><label>Distância máxima de entrega (km, 0 = sem limite)</label><input type="number" data-ch="max" value="${S.cfg.maxKm || 0}"></div>`;
  if (S.tab === 'prod') b = `<div class="sec"><h2>Produtos da loja</h2>${S.prods.map(p => `<div class="it"><div class="n"><b>${esc(p.n)}</b><span>${esc(p.c)}</span></div><input style="width:84px" type="number" step="0.01" data-ch="pp" data-id="${p.id}" value="${p.p}"><button class="sm" style="border:1px solid var(--line);border-radius:8px" data-a="tog" data-id="${p.id}">${p.on ? 'Disponível' : 'Esgotado'}</button></div>`).join('')}<div class="box"><b>Novo produto</b><label>Nome</label>${inp('pn')}<label>Categoria</label>${inp('pc')}<label>Descrição</label>${inp('pd')}<label>Preço</label>${inp('ppr', '0,00', 'number')}<button class="btn" style="margin-top:12px" data-a="newp">Adicionar</button></div></div>`;
  if (S.tab === 'cli') b = `<div class="sec"><h2>Novo acesso</h2><div class="box"><label>Tipo</label><select data-k="cp"><option value="cliente">Cliente</option><option value="entregador">Entregador</option></select><label>Nome / empresa</label>${inp('cn')}<label>Telefone</label>${inp('ct', '', 'tel')}<label>E-mail de acesso</label>${inp('ce', '', 'email')}<label>Senha inicial (6+)</label>${inp('cs')}<label>PIN (só entregador, 6 dígitos)</label>${inp('cpin')}<button class="btn" style="margin-top:12px" data-a="newu">Criar acesso</button></div></div>`;
  if (S.tab === 'ped') b = `<div class="sec"><h2>Pedidos</h2>${S.peds.map(p => `<div class="box"><div class="row"><b>#${p.n} · ${esc(p.nome)}</b><span class="st ${p.status === 'entregue' || p.status === 'pago' ? 'ok' : ''}">${esc(p.status.replace('_', ' '))}</span></div>${p.itens.map(i => `<div class="mut">${i[1]}× ${esc(i[0])}</div>`).join('')}<div class="mut">${esc(p.end)} · ${esc(p.quadra || '')} ${esc(p.ref)}</div><div class="row"><span class="mut">${p.km} km · entrega ${R(p.taxa)}</span><b>${R(p.total)}</b></div>${p.status === 'pago' ? `<button class="btn g" data-a="rota" data-n="${p.n}">Marcar em rota</button>` : ''}</div>`).join('') || '<p class="mut">Nenhum pedido ainda.</p>'}</div>`;
  return `<div class="top"><h1>Painel do dono</h1><button class="sm" data-a="sair">Sair</button></div><div class="tabs">${T.map(t => `<button class="${S.tab === t[0] ? 'on' : ''}" data-a="tab" data-t="${t[0]}">${t[1]}</button>`).join('')}</div>${b}`;
}
/* ---------- entregador ---------- */
function vEnt() {
  const p = S.ent;
  return `<div class="top"><h1>Entregador · ${esc(S.u.nome)}</h1><button class="sm" data-a="sair">Sair</button></div><div class="sec"><label>Número do pedido</label><div style="display:flex;gap:8px"><input data-k="nn" inputmode="numeric" value="${esc(F.nn || '')}"><button class="btn" style="width:auto" data-a="buscar">Abrir</button></div>
${p ? `<div class="box"><div class="row"><b>Pedido #${p.n}</b><span class="st ${p.status === 'entregue' ? 'ok' : ''}">${esc(p.status.replace('_', ' '))}</span></div><b>${esc(p.nome)}</b><div class="mut">${esc(p.end)} · ${esc(p.quadra || '')} ${esc(p.ref)}</div>${p.itens.map(i => `<div class="mut">${i[1]}× ${esc(i[0])}</div>`).join('')}<div class="row tot"><span>Já pago por Pix</span><span>${R(p.total)}</span></div>
<a class="btn g" style="margin-bottom:8px" target="_blank" rel="noopener" href="https://wa.me/55${String(p.tel).replace(/\D/g, '')}?text=${encodeURIComponent('Sou o entregador da Distribuidora Campos, estou a caminho.')}">💬 WhatsApp do cliente</a><a class="btn g" style="margin-bottom:8px" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}">📍 Abrir localização</a><button class="btn" data-a="pronto">Pronto</button></div>` : ''}</div>`;
}
/* ---------- ações ---------- */
const A = {
  home: () => go('home'), sair: () => signOut(auth).then(() => go('home')),
  async entrar() { try { await signInWithEmailAndPassword(auth, (F.em || '').trim(), F.pw || ''); } catch { toast('E-mail ou senha incorretos'); } },
  async key(d) {
    const k = d.k; if (k === '⌫') S.pin = S.pin.slice(0, -1); else if (k !== '✓' && S.pin.length < 6) S.pin += k;
    if (S.pin.length === 6) { try { await api('pin', { pin: S.pin }); await auth.currentUser.getIdToken(true); watch(S.u.role); return go(S.u.role === 'admin' ? 'admin' : 'ent'); } catch (e) { toast(e.message); S.pin = ''; } }
    render();
  },
  add(d) { const i = d.i, q = Math.max(0, (S.cart[i] || 0) + +d.d); q ? S.cart[i] = q : delete S.cart[i]; render(); },
  cart() { S.dr = 'cart'; render(); }, fechar(d, e) { if (e.target.classList.contains('ov')) { S.dr = null; render(); } },
  ck() { S.ck = { step: 1, km: null }; S.dr = 'ck'; render(); }, fechar2() { S.dr = null; render(); },
  s1() { S.ck.step = 1; render(); }, s2b() { S.ck.step = 2; render(); },
  s2() { if (!F.nome || (F.tel || '').length < 8) return toast('Preencha nome e telefone'); S.ck.step = 2; render(); },
  gps() {
    if (!S.cfg.loja) return toast('A loja ainda não configurou a entrega');
    navigator.geolocation.getCurrentPosition(p => { S.ck.lat = p.coords.latitude; S.ck.lng = p.coords.longitude; S.ck.km = kmD(S.ck.lat, S.ck.lng, S.cfg.loja.lat, S.cfg.loja.lng); render(); }, () => toast('Permita o acesso à localização'), { enableHighAccuracy: true, timeout: 15000 });
  },
  s3() { if (S.ck.km == null || !F.quadra || !F.end) return toast('Sincronize a localização e preencha rua e quadra/lote'); if (S.cfg.maxKm && S.ck.km > S.cfg.maxKm) return toast('Fora da área de entrega'); S.ck.step = 3; render(); },
  async pagar() {
    if (S.ck.busy) return; S.ck.busy = true; render();
    try {
      const r = await api('pix', { itens: Object.entries(S.cart).map(([id, q]) => ({ id, q })), nome: F.nome, tel: F.tel, end: F.end + ' · ' + F.quadra, ref: F.ref, lat: S.ck.lat, lng: S.ck.lng });
      Object.assign(S.ck, { step: 4, num: r.n, total: r.total, img: r.img, qr: r.qr, busy: false }); S.cart = {};
      unPed = onSnapshot(doc(db, 'pedidos', String(r.n)), s => { S.ck.ped = s.data(); if (S.dr === 'ck') render(); }); render();
    } catch (e) { S.ck.busy = false; toast(e.message); render(); }
  },
  copiar() { navigator.clipboard.writeText(S.ck.qr).then(() => toast('Código Pix copiado')); },
  fim() { if (unPed) unPed(); S.ck = null; S.dr = null; render(); },
  tab(d) { S.tab = d.t; render(); },
  addf() { const f = S.cfg.faixas || []; salvaCfg({ faixas: [...f, { km: (f.length ? Math.max(...f.map(x => x.km)) : 0) + 1, p: 15 }] }); },
  delf(d) { salvaCfg({ faixas: S.cfg.faixas.filter((_, i) => i !== +d.i) }); },
  loja() { navigator.geolocation.getCurrentPosition(p => salvaCfg({ loja: { lat: p.coords.latitude, lng: p.coords.longitude } }), () => toast('Permita o acesso à localização')); },
  tog(d) { const p = S.prods.find(x => x.id === d.id); updateDoc(doc(db, 'produtos', d.id), { on: !p.on }); },
  async newp() { if (!F.pn || !F.pc || !(+F.ppr > 0)) return toast('Preencha nome, categoria e preço'); await addDoc(collection(db, 'produtos'), { n: F.pn, c: F.pc, d: F.pd || '', p: +F.ppr, on: true }); F.pn = F.pd = F.ppr = ''; toast('Produto adicionado'); },
  async newu() { try { await api('create-user', { papel: F.cp || 'cliente', nome: F.cn, tel: F.ct, email: F.ce, senha: F.cs, pin: F.cpin }); F.cn = F.ct = F.ce = F.cs = F.cpin = ''; toast('Acesso criado'); render(); } catch (e) { toast(e.message); } },
  rota(d) { updateDoc(doc(db, 'pedidos', d.n), { status: 'em_rota' }); },
  async buscar() { try { const s = await getDoc(doc(db, 'pedidos', (F.nn || '').trim())); if (!s.exists()) throw 0; S.ent = s.data(); } catch { S.ent = null; toast('Pedido não encontrado ou ainda não pago'); } render(); },
  async pronto() { await updateDoc(doc(db, 'pedidos', String(S.ent.n)), { status: 'entregue' }); S.ent.status = 'entregue'; toast('Pedido #' + S.ent.n + ' entregue'); render(); }
};
const salvaCfg = p => setDoc(doc(db, 'config', 'entrega'), { ...S.cfg, ...p }, { merge: true });
document.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b && A[b.dataset.a]) A[b.dataset.a](b.dataset, e); });
document.addEventListener('input', e => { const k = e.target.dataset.k; if (k) F[k] = e.target.value; });
document.addEventListener('change', e => {
  const t = e.target, c = t.dataset.ch; if (!c) return;
  if (c === 'pp') updateDoc(doc(db, 'produtos', t.dataset.id), { p: +t.value });
  if (c === 'max') salvaCfg({ maxKm: +t.value });
  if (c === 'fk' || c === 'fp') { const f = S.cfg.faixas.map(x => ({ ...x })); f[+t.dataset.i][c === 'fk' ? 'km' : 'p'] = +t.value; salvaCfg({ faixas: f }); }
});
let lp; // segurar a lupa ~0,7s abre o login
document.addEventListener('pointerdown', e => { if (e.target.closest('[data-lupa]')) lp = setTimeout(() => go('login'), 700); });
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => document.addEventListener(ev, () => clearTimeout(lp)));
document.addEventListener('click', e => { if (e.target.closest('[data-lupa]')) toast('Segure a lupa para entrar'); });
render();
