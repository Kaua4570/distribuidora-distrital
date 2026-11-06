// Teste das regras do Firestore com o emulador oficial.
// NÃO foi executado no ambiente de desenvolvimento (sem acesso à rede) — rode na sua máquina:
//   npm i -D @firebase/rules-unit-testing firebase
//   npx firebase emulators:exec --only firestore --project demo-campos "node --test firestore.rules.test.mjs"
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, setDoc, deleteDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { test, before, after } from "node:test";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-campos",
    firestore: { rules: readFileSync(new URL("./firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 }
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "usuarios_autorizados/AUT"), { ativo: true });
    await setDoc(doc(db, "usuarios_autorizados/INATIVO"), { ativo: false });
    await setDoc(doc(db, "usuarios_autorizados/ADM"), { ativo: true, admin: true });
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
test("usuário comum NÃO se autoriza sozinho", async () => {
  await assertFails(setDoc(doc(user("HACKER"), "usuarios_autorizados/HACKER"), { ativo: true }));
  await assertFails(setDoc(doc(user("AUT"), "usuarios_autorizados/AUT"), { ativo: true, admin: true }));
  await assertFails(setDoc(doc(user("ADM"), "usuarios_autorizados/OUTRO"), { ativo: true }));
});
test("só lê o PRÓPRIO doc de autorização; não lista", async () => {
  await assertSucceeds(getDoc(doc(user("AUT"), "usuarios_autorizados/AUT")));
  await assertFails(getDoc(doc(user("HACKER"), "usuarios_autorizados/AUT")));
  await assertFails(getDocs(collection(user("AUT"), "usuarios_autorizados")));
  await assertFails(getDoc(doc(anon(), "usuarios_autorizados/AUT")));
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
test("pedidos: ninguém cria pelo site; só admin lê e atualiza", async () => {
  await assertFails(setDoc(doc(anon(), "pedidos/p1"), { cliente: "A", total: 1 }));
  await assertFails(getDocs(collection(anon(), "pedidos")));
  await assertFails(getDocs(collection(user("AUT"), "pedidos")));
  await assertSucceeds(getDocs(collection(user("ADM"), "pedidos")));
});
test("coleção desconhecida é negada", async () => {
  await assertFails(getDoc(doc(user("AUT"), "outra_colecao/x")));
});
