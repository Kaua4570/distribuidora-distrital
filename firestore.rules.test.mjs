// Teste das regras do Firestore com o emulador oficial.
// NÃO foi executado no ambiente de desenvolvimento (sem acesso à rede) — rode na sua máquina:
//   npm i -D @firebase/rules-unit-testing firebase
//   npx firebase emulators:exec --only firestore --project demo-distrital "node --test firestore.rules.test.mjs"
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc, query, where, serverTimestamp, writeBatch } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { test, before, after } from "node:test";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-distrital",
    firestore: { rules: readFileSync(new URL("./firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 }
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "usuarios_autorizados/AUT"), { ativo: true });
    await setDoc(doc(db, "usuarios_autorizados/INATIVO"), { ativo: false });
    await setDoc(doc(db, "usuarios_autorizados/ADM"), { ativo: true, admin: true });
    await setDoc(doc(db, "usuarios_autorizados/CLI"), { ativo: true, tipo: "cliente" });
    await setDoc(doc(db, "usuarios_autorizados/CLI2"), { ativo: true, tipo: "cliente" });
    await setDoc(doc(db, "usuarios_autorizados/ENT"), { ativo: true, tipo: "entregador" });
    await setDoc(doc(db, "usuarios_autorizados/ENT2"), { ativo: true, tipo: "entregador" });
    await setDoc(doc(db, "usuarios_autorizados/COM"), { ativo: true, tipo: "comanda" });
    await setDoc(doc(db, "pedidos/5"), { clienteUid: "CLI", cliente: "Ana", telefone: "61999999999", endereco: "Q1 L2", pagamento: "Pix", pago: false, status: "Pendente", total: 10, itens: [{ nome: "X", preco: 10, qtd: 1 }] });
    await setDoc(doc(db, "pedidos/6"), { clienteUid: "CLI2", cliente: "Bia", telefone: "61988888888", endereco: "Q3 L4", pagamento: "Dinheiro", pago: false, status: "Pendente", total: 20, itens: [{ nome: "Y", preco: 20, qtd: 1 }] });
    await setDoc(doc(db, "produtos_secretos/p1"), { nome: "X", categoriaId: "c1", preco: 1 });
    await setDoc(doc(db, "categorias_secretas/c1"), { nome: "Vinhos", ordem: 0 });
    await setDoc(doc(db, "produtos/pub"), { nome: "Skol" });
  });
});
after(() => env.cleanup());

const anon = () => env.unauthenticatedContext().firestore();
const user = (uid) => env.authenticatedContext(uid).firestore();

test("anônimo NÃO lê produtos_secretos (get e list)", async () => {
  await assertFails(getDoc(doc(anon(), "produtos_secretos/p1")));
  await assertFails(getDocs(collection(anon(), "produtos_secretos")));
});
test("logado mas não autorizado NÃO lê", async () => {
  await assertFails(getDoc(doc(user("QUALQUER"), "produtos_secretos/p1")));
  await assertFails(getDocs(collection(user("QUALQUER"), "produtos_secretos")));
});
test("autorizado inativo NÃO lê", async () => {
  await assertFails(getDocs(collection(user("INATIVO"), "produtos_secretos")));
});
test("autorizado ativo lê", async () => {
  await assertSucceeds(getDoc(doc(user("AUT"), "produtos_secretos/p1")));
  await assertSucceeds(getDocs(collection(user("AUT"), "produtos_secretos")));
});
const ok = { nome: "Novo", categoriaId: "c1", preco: 10.5, disponivel: true };
test("autorizado SEM admin NÃO escreve em produtos_secretos", async () => {
  await assertFails(setDoc(doc(user("AUT"), "produtos_secretos/novo"), ok));
  await assertFails(deleteDoc(doc(user("AUT"), "produtos_secretos/p1")));
});
test("anônimo e não autorizado NÃO escrevem", async () => {
  await assertFails(setDoc(doc(anon(), "produtos_secretos/novo"), ok));
  await assertFails(setDoc(doc(user("HACKER"), "produtos_secretos/novo"), ok));
});
test("admin escreve com dados válidos e exclui", async () => {
  await assertSucceeds(setDoc(doc(user("ADM"), "produtos_secretos/novo"), ok));
  await assertSucceeds(deleteDoc(doc(user("ADM"), "produtos_secretos/novo")));
});
test("admin NÃO grava dados inválidos", async () => {
  await assertFails(setDoc(doc(user("ADM"), "produtos_secretos/x"), { ...ok, preco: -1 }));
  await assertFails(setDoc(doc(user("ADM"), "produtos_secretos/x"), { ...ok, preco: "10" }));
  await assertFails(setDoc(doc(user("ADM"), "produtos_secretos/x"), { ...ok, nome: "" }));
  await assertFails(setDoc(doc(user("ADM"), "produtos_secretos/x"), { categoriaId: "A", preco: 1 }));
});
test("ninguém se autoriza sozinho nem vira admin", async () => {
  await assertFails(setDoc(doc(user("HACKER"), "usuarios_autorizados/HACKER"), { ativo: true, tipo: "cliente" }));
  await assertFails(setDoc(doc(user("AUT"), "usuarios_autorizados/AUT"), { ativo: true, admin: true }));
  await assertFails(setDoc(doc(user("CLI"), "usuarios_autorizados/OUTRO"), { ativo: true, tipo: "cliente" }));
});
test("admin libera logins pelo painel (só cliente/entregador/comanda, nunca admin)", async () => {
  await assertSucceeds(setDoc(doc(user("ADM"), "usuarios_autorizados/NOVO"), { ativo: true, tipo: "entregador", nome: "João" }));
  await assertSucceeds(updateDoc(doc(user("ADM"), "usuarios_autorizados/NOVO"), { tipo: "cliente" }));
  await assertSucceeds(updateDoc(doc(user("ADM"), "usuarios_autorizados/NOVO"), { ativo: false }));
  await assertFails(setDoc(doc(user("ADM"), "usuarios_autorizados/NOVO2"), { ativo: true, tipo: "cliente", admin: true }));
  await assertFails(setDoc(doc(user("ADM"), "usuarios_autorizados/NOVO3"), { ativo: true, tipo: "superuser" }));
  await assertFails(setDoc(doc(user("ADM"), "usuarios_autorizados/ADM"), { ativo: true, tipo: "cliente" }));   // não altera a si mesmo
  await assertSucceeds(deleteDoc(doc(user("ADM"), "usuarios_autorizados/NOVO")));
});
test("só lê o PRÓPRIO doc de autorização; só admin lista", async () => {
  await assertSucceeds(getDoc(doc(user("AUT"), "usuarios_autorizados/AUT")));
  await assertFails(getDoc(doc(user("HACKER"), "usuarios_autorizados/AUT")));
  await assertFails(getDocs(collection(user("AUT"), "usuarios_autorizados")));
  await assertFails(getDocs(collection(user("CLI"), "usuarios_autorizados")));
  await assertFails(getDoc(doc(anon(), "usuarios_autorizados/AUT")));
  await assertSucceeds(getDocs(collection(user("ADM"), "usuarios_autorizados")));
});
test("catálogo público segue lendo sem login", async () => {
  await assertSucceeds(getDoc(doc(anon(), "produtos/pub")));
  await assertSucceeds(getDocs(collection(anon(), "categorias")));
  await assertSucceeds(getDoc(doc(anon(), "config/loja")));
});
test("tela inicial: só admin grava em produtos, categorias e config", async () => {
  await assertFails(setDoc(doc(anon(), "produtos/novo"), ok));
  await assertFails(setDoc(doc(user("AUT"), "produtos/novo"), ok));
  await assertFails(setDoc(doc(anon(), "categorias/x"), { nome: "A", ordem: 0 }));
  await assertFails(setDoc(doc(user("AUT"), "config/loja"), { aberta: false }));
  await assertFails(deleteDoc(doc(anon(), "produtos/pub")));
  await assertSucceeds(setDoc(doc(user("ADM"), "produtos/novo"), { ...ok, volume: "350ml", imagemUrl: "" }));
  await assertSucceeds(setDoc(doc(user("ADM"), "categorias/x"), { nome: "Cervejas", ordem: 1 }));
  await assertSucceeds(setDoc(doc(user("ADM"), "config/loja"), { aberta: true, whatsapp: "5561999999999" }));
  await assertSucceeds(deleteDoc(doc(user("ADM"), "produtos/novo")));
});
test("categorias_secretas: autorizado lê, só admin grava", async () => {
  await assertFails(getDocs(collection(anon(), "categorias_secretas")));
  await assertSucceeds(getDocs(collection(user("AUT"), "categorias_secretas")));
  await assertFails(setDoc(doc(user("AUT"), "categorias_secretas/n"), { nome: "A", ordem: 0 }));
  await assertSucceeds(setDoc(doc(user("ADM"), "categorias_secretas/n"), { nome: "Whisky", ordem: 1 }));
  await assertFails(setDoc(doc(user("ADM"), "categorias_secretas/n2"), { nome: "", ordem: 1 }));
  await assertSucceeds(deleteDoc(doc(user("ADM"), "categorias_secretas/n")));
});
const pedidoOk = (uid) => ({
  clienteUid: uid, cliente: "Ana", telefone: "61999999999", endereco: "Quadra 1 lote 2",
  localizacao: { lat: -15.8, lng: -47.9, precisao: 20 }, pagamento: "Pix", troco: "", pago: false,
  status: "Pendente", total: 25.5, itens: [{ produtoId: "p1", nome: "X", preco: 25.5, qtd: 1 }], criadoEm: serverTimestamp()
});
test("pedido: cliente cria com número aleatório de 4 dígitos; os outros não", async () => {
  await assertSucceeds(setDoc(doc(user("CLI"), "pedidos/4839"), pedidoOk("CLI")));
  await assertFails(setDoc(doc(user("CLI"), "pedidos/12"), pedidoOk("CLI")));                 // id fora do padrão (2 dígitos)
  await assertFails(setDoc(doc(user("CLI"), "pedidos/abc123"), pedidoOk("CLI")));
  await assertFails(setDoc(doc(user("CLI"), "pedidos/483920"), pedidoOk("CLI")));              // 6 dígitos não vale mais
  await assertFails(setDoc(doc(anon(), "pedidos/1100"), pedidoOk("X")));
  await assertFails(setDoc(doc(user("ENT"), "pedidos/1101"), pedidoOk("ENT")));
  await assertFails(setDoc(doc(user("COM"), "pedidos/1102"), pedidoOk("COM")));
  await assertFails(setDoc(doc(user("CLI"), "pedidos/1103"), pedidoOk("CLI2")));            // em nome de outro
  await assertFails(setDoc(doc(user("CLI"), "pedidos/1104"), { ...pedidoOk("CLI"), pago: true }));   // cliente não se marca como pago
  await assertFails(setDoc(doc(user("CLI"), "pedidos/1105"), { ...pedidoOk("CLI"), status: "Finalizado" }));
  await assertFails(setDoc(doc(user("CLI"), "pedidos/1106"), { ...pedidoOk("CLI"), itens: [] }));
  await assertFails(setDoc(doc(user("CLI"), "pedidos/1107"), { ...pedidoOk("CLI"), pagamento: "Cartão" }));
  await assertSucceeds(setDoc(doc(user("ADM"), "pedidos/2222"), pedidoOk("ADM")));         // admin também pode pedir
});
test("pedido: colisão de número não sobrescreve pedido de ninguém (nem do admin)", async () => {
  await assertFails(setDoc(doc(user("CLI2"), "pedidos/4839"), pedidoOk("CLI2")));           // já existe (do CLI)
  await assertFails(setDoc(doc(user("ADM"), "pedidos/4839"), pedidoOk("ADM")));             // admin também não sobrescreve
  const dono = await getDoc(doc(user("CLI"), "pedidos/4839"));
  if (dono.data().clienteUid !== "CLI") throw new Error("pedido foi sobrescrito");
});
test("pedido: cliente só enxerga os próprios", async () => {
  await assertSucceeds(getDoc(doc(user("CLI"), "pedidos/5")));
  await assertFails(getDoc(doc(user("CLI"), "pedidos/6")));
  await assertSucceeds(getDocs(query(collection(user("CLI"), "pedidos"), where("clienteUid", "==", "CLI"))));
  await assertFails(getDocs(collection(user("CLI"), "pedidos")));
  await assertFails(getDocs(collection(anon(), "pedidos")));
  await assertFails(updateDoc(doc(user("CLI"), "pedidos/5"), { status: "Finalizado" }));
});
test("pedido: admin e comanda leem tudo e atualizam; só admin apaga", async () => {
  await assertSucceeds(getDocs(collection(user("ADM"), "pedidos")));
  await assertSucceeds(getDocs(collection(user("COM"), "pedidos")));
  await assertSucceeds(updateDoc(doc(user("COM"), "pedidos/5"), { pago: true }));
  await assertSucceeds(updateDoc(doc(user("ADM"), "pedidos/5"), { status: "Em Preparo" }));
  await assertFails(deleteDoc(doc(user("COM"), "pedidos/6")));
  await assertSucceeds(deleteDoc(doc(user("ADM"), "pedidos/6")));
});
test("entregador: acha pelo número, entra na rota, avisa e finaliza", async () => {
  await assertSucceeds(getDoc(doc(user("ENT"), "pedidos/5")));
  await assertFails(getDocs(collection(user("ENT"), "pedidos")));                            // não lista tudo
  await assertSucceeds(updateDoc(doc(user("ENT"), "pedidos/5"), { entregadorUid: "ENT", status: "Saiu para Entrega" }));
  await assertSucceeds(getDocs(query(collection(user("ENT"), "pedidos"), where("entregadorUid", "==", "ENT"))));
  await assertFails(getDocs(query(collection(user("ENT2"), "pedidos"), where("entregadorUid", "==", "ENT"))));
  await assertFails(updateDoc(doc(user("ENT2"), "pedidos/5"), { entregadorUid: "ENT2", status: "Saiu para Entrega" })); // já é de outro
  await assertSucceeds(updateDoc(doc(user("ENT"), "pedidos/5"), { status: "Chegando" }));
  await assertFails(updateDoc(doc(user("ENT"), "pedidos/5"), { status: "Chegando", pago: true }));      // não mexe em pagamento
  await assertFails(updateDoc(doc(user("ENT"), "pedidos/5"), { total: 1 }));
  await assertSucceeds(updateDoc(doc(user("ENT"), "pedidos/5"), { status: "Finalizado", entregueEm: serverTimestamp() }));
  await assertFails(updateDoc(doc(user("ENT"), "pedidos/5"), { status: "Chegando" }));                  // já encerrado
});
test("coleção desconhecida é negada", async () => {
  await assertFails(getDoc(doc(user("AUT"), "outra_colecao/x")));
});
