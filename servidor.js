// ============================================================
// Utilitários das funções da Vercel (Pix do Mercado Pago)
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   MP_ACCESS_TOKEN            Access Token do Mercado Pago (credenciais da aplicação)
//   FIREBASE_SERVICE_ACCOUNT   JSON inteiro da chave de serviço do Firebase
//   ALLOWED_ORIGINS            sites autorizados a chamar a API, separados por vírgula
//                              ex: https://kaua4570.github.io,https://distribuidora-campos.vercel.app
//   MP_SELLER_EMAIL (opcional) e-mail da conta vendedora do Mercado Pago
// ============================================================
const admin = require("firebase-admin");

function iniciarFirebase(){
  if (admin.apps.length) return;
  const bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!bruto) throw new Error("FIREBASE_SERVICE_ACCOUNT não configurada");
  const cred = JSON.parse(bruto);
  if (cred.private_key) cred.private_key = cred.private_key.replace(/\\n/g, "\n");
  admin.initializeApp({ credential: admin.credential.cert(cred) });
}

function bancoDeDados(){ iniciarFirebase(); return admin.firestore(); }
function autenticacao(){ iniciarFirebase(); return admin.auth(); }
const carimboDeTempo = () => admin.firestore.FieldValue.serverTimestamp();

// CORS: só os sites listados em ALLOWED_ORIGINS conseguem chamar a API pelo navegador.
// Retorna true quando a requisição já foi respondida (pré-voo OPTIONS).
function cors(req, res){
  const permitidos = String(process.env.ALLOWED_ORIGINS || "")
    .split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean);
  const origem = req.headers.origin;
  res.setHeader("Vary", "Origin");
  if (origem && permitidos.includes(origem)){
    res.setHeader("Access-Control-Allow-Origin", origem);
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS"){ res.status(204).end(); return true; }
  return false;
}

// Chamada à API do Mercado Pago
async function mercadoPago(caminho, { metodo = "GET", corpo, chaveIdempotencia } = {}){
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error("MP_ACCESS_TOKEN não configurado");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (chaveIdempotencia) headers["X-Idempotency-Key"] = chaveIdempotencia;
  const resp = await fetch(`https://api.mercadopago.com${caminho}`, {
    method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined
  });
  let dados = null;
  try{ dados = await resp.json(); }catch(_){}
  return { ok: resp.ok, status: resp.status, dados };
}

module.exports = { bancoDeDados, autenticacao, carimboDeTempo, cors, mercadoPago };
