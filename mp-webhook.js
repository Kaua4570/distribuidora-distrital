// ============================================================
// POST /api/mp-webhook   (o Mercado Pago chama esta URL sozinho)
// Quando um Pix é aprovado, marca o pedido como PAGO no Firestore.
//
// Segurança: o aviso recebido NÃO é confiado. A função só usa o número do
// pagamento e consulta a API do Mercado Pago com o seu Access Token; o pedido só
// é marcado como pago se o pagamento estiver "approved", for Pix, tiver o número
// do pedido em external_reference e o valor for igual ao total do pedido.
// ============================================================
const { bancoDeDados, carimboDeTempo, mercadoPago } = require("./servidor");

module.exports = async function handler(req, res){
  // o Mercado Pago precisa de resposta 200 rápida, senão reenvia o aviso
  try{
    const query = req.query || {};
    const body = typeof req.body === "string" ? safeJson(req.body) : (req.body || {});
    const tipo = String(body.type || query.type || query.topic || "");
    const acao = String(body.action || "");
    const idPagamento = String((body.data && body.data.id) || query["data.id"] || query.id || "");

    const ehPagamento = tipo === "payment" || acao.startsWith("payment");
    if (!ehPagamento || !/^\d+$/.test(idPagamento)){
      return res.status(200).json({ ok: true, ignorado: true });
    }

    const consulta = await mercadoPago(`/v1/payments/${idPagamento}`);
    if (!consulta.ok){
      console.error("Consulta ao MP falhou:", consulta.status, JSON.stringify(consulta.dados));
      return res.status(200).json({ ok: true, consulta: consulta.status });
    }
    const pg = consulta.dados || {};
    const idPedido = String(pg.external_reference || "");
    if (!/^\d{4,9}$/.test(idPedido)) return res.status(200).json({ ok: true, semPedido: true });

    const db = bancoDeDados();
    const ref = db.collection("pedidos").doc(idPedido);
    const snap = await ref.get();
    if (!snap.exists) return res.status(200).json({ ok: true, semPedido: true });
    const pedido = snap.data();

    if (pg.status === "approved"){
      if (pg.payment_method_id !== "pix"){
        console.error("Pagamento aprovado que não é Pix, ignorado:", idPagamento);
        return res.status(200).json({ ok: true });
      }
      if (Math.abs(Number(pg.transaction_amount) - Number(pedido.total)) > 0.01){
        console.error(`Valor diferente no pedido ${idPedido}: pago ${pg.transaction_amount}, total ${pedido.total}`);
        return res.status(200).json({ ok: true, valorDiferente: true });
      }
      if (pedido.pago !== true){
        await ref.update({
          pago: true,
          pagoEm: carimboDeTempo(),
          mpPagamentoId: String(pg.id),
          "pix.status": "approved"
        });
      }
    } else if (["cancelled", "rejected", "expired"].includes(pg.status) && pedido.pago !== true){
      await ref.update({ "pix.status": pg.status });
    }
    return res.status(200).json({ ok: true });
  }catch(err){
    console.error("mp-webhook:", err);
    // 500 faz o Mercado Pago tentar de novo mais tarde
    return res.status(500).json({ ok: false });
  }
};

function safeJson(t){ try{ return JSON.parse(t); }catch(_){ return {}; } }
