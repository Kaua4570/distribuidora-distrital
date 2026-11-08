// ============================================================
// POST /api/pix-criar   { "pedido": "4839" }
// Gera (ou reaproveita) o Pix do Mercado Pago de um pedido.
//  - exige o login do Firebase (Authorization: Bearer <ID token>)
//  - o VALOR vem do pedido gravado no Firestore, nunca do navegador
//  - só o dono do pedido consegue gerar o Pix dele
// Resposta: { ok, pago, copiaECola, qrBase64, expiraEm, valor }
// ============================================================
const { bancoDeDados, autenticacao, carimboDeTempo, cors, mercadoPago } = require("./servidor");

const MINUTOS_VALIDADE = 60;

function expiracaoMercadoPago(data){
  // formato exigido pelo MP: 2026-11-06T10:30:00.000-03:00 (horário de Brasília)
  return new Date(data.getTime() - 3 * 3600 * 1000).toISOString().replace("Z", "-03:00");
}

function urlBase(req){
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `https://${host}`;
}

async function criarPagamento(req, id, pedido, email, chave){
  const nome = String(pedido.cliente || "Cliente").trim().split(/\s+/);
  const expira = new Date(Date.now() + MINUTOS_VALIDADE * 60000);
  const resp = await mercadoPago("/v1/payments", {
    metodo: "POST",
    chaveIdempotencia: chave,
    corpo: {
      transaction_amount: Math.round(Number(pedido.total) * 100) / 100,
      description: `Pedido #${id} - Distribuidora Distrital`,
      payment_method_id: "pix",
      external_reference: id,
      notification_url: `${urlBase(req)}/api/mp-webhook`,
      date_of_expiration: expiracaoMercadoPago(expira),
      payer: { email, first_name: nome[0], last_name: nome.slice(1).join(" ") || undefined }
    }
  });
  return { resp, expira };
}

module.exports = async function handler(req, res){
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ ok: false, erro: "metodo" });

  try{
    // 1) quem está chamando
    const cabecalho = String(req.headers.authorization || "");
    const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7) : "";
    if (!token) return res.status(401).json({ ok: false, erro: "login" });
    let usuario;
    try{ usuario = await autenticacao().verifyIdToken(token); }
    catch(_){ return res.status(401).json({ ok: false, erro: "login" }); }

    const db = bancoDeDados();
    const doUsuario = await db.collection("usuarios_autorizados").doc(usuario.uid).get();
    if (!doUsuario.exists || doUsuario.data().ativo !== true){
      return res.status(403).json({ ok: false, erro: "acesso" });
    }

    // 2) o pedido
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const id = String(body.pedido || "").trim();
    if (!/^\d{4,9}$/.test(id)) return res.status(400).json({ ok: false, erro: "pedido" });

    const ref = db.collection("pedidos").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ ok: false, erro: "pedido" });
    const pedido = snap.data();

    if (pedido.clienteUid !== usuario.uid) return res.status(403).json({ ok: false, erro: "acesso" });
    if (pedido.pagamento !== "Pix") return res.status(400).json({ ok: false, erro: "forma" });
    if (pedido.status === "Cancelado" || pedido.status === "Finalizado"){
      return res.status(400).json({ ok: false, erro: "encerrado" });
    }
    if (pedido.pago === true) return res.status(200).json({ ok: true, pago: true });

    // 2b) o VALOR é recalculado aqui com os preços reais de produtos_secretos
    //     (o total gravado pelo navegador não é confiável)
    const itensPedido = Array.isArray(pedido.itens) ? pedido.itens : [];
    if (!itensPedido.length || itensPedido.length > 100) return res.status(400).json({ ok: false, erro: "valor" });
    let centavos = 0;
    const itensReais = [];
    for (const it of itensPedido){
      const qtd = Number(it && it.qtd);
      if (!Number.isInteger(qtd) || qtd < 1 || qtd > 999) return res.status(400).json({ ok: false, erro: "valor" });
      const prod = await db.collection("produtos_secretos").doc(String((it && it.produtoId) || "_")).get();
      if (!prod.exists) return res.status(400).json({ ok: false, erro: "produto" });
      const preco = Number(prod.data().preco);
      if (!(preco >= 0)) return res.status(400).json({ ok: false, erro: "produto" });
      centavos += Math.round(preco * 100) * qtd;
      itensReais.push({ ...it, preco });
    }
    const total = centavos / 100;
    if (!(total > 0)) return res.status(400).json({ ok: false, erro: "valor" });
    if (Math.abs(total - Number(pedido.total)) > 0.001){
      // corrige o pedido para o valor real antes de cobrar
      await ref.update({ itens: itensReais, total, pix: null });
      pedido.total = total; pedido.pix = null;
    }

    // 3) já existe um Pix ainda válido? devolve o mesmo (não cria cobrança duplicada)
    const pix = pedido.pix;
    if (pix && pix.copiaECola && pix.qrBase64 && pix.expiraEm && new Date(pix.expiraEm).getTime() > Date.now() + 60000){
      return res.status(200).json({ ok: true, pago: false, copiaECola: pix.copiaECola, qrBase64: pix.qrBase64, expiraEm: pix.expiraEm, valor: total });
    }

    // 4) cria o Pix no Mercado Pago
    let email = usuario.email || "";
    const emailVendedor = String(process.env.MP_SELLER_EMAIL || "").toLowerCase();
    const emailSintetico = `pedido${id}@distribuidoradistrital.com.br`;
    if (!email || (emailVendedor && email.toLowerCase() === emailVendedor)) email = emailSintetico;

    const chave = `pix-${id}-${Date.now()}`;
    let { resp, expira } = await criarPagamento(req, id, pedido, email, chave);
    if (!resp.ok && email !== emailSintetico){
      // alguns e-mails são recusados pelo MP (ex.: o do próprio vendedor): tenta com um e-mail neutro
      ({ resp, expira } = await criarPagamento(req, id, pedido, emailSintetico, `${chave}-b`));
    }
    if (!resp.ok){
      console.error("Mercado Pago recusou o Pix:", resp.status, JSON.stringify(resp.dados));
      return res.status(502).json({ ok: false, erro: "mercadopago" });
    }

    const dados = resp.dados || {};
    const transacao = (dados.point_of_interaction || {}).transaction_data || {};
    if (!transacao.qr_code || !transacao.qr_code_base64){
      console.error("Resposta do MP sem QR Code:", JSON.stringify(dados));
      return res.status(502).json({ ok: false, erro: "mercadopago" });
    }

    const expiraEm = expira.toISOString();
    await ref.update({
      pix: {
        paymentId: String(dados.id),
        copiaECola: transacao.qr_code,
        qrBase64: transacao.qr_code_base64,
        expiraEm,
        status: dados.status || "pending"
      },
      pixAtualizadoEm: carimboDeTempo()
    });

    return res.status(200).json({ ok: true, pago: false, copiaECola: transacao.qr_code, qrBase64: transacao.qr_code_base64, expiraEm, valor: total });
  }catch(err){
    console.error("pix-criar:", err);
    return res.status(500).json({ ok: false, erro: "interno" });
  }
};
