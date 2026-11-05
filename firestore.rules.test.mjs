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
    await setDoc(doc(db, "produtos_secretos/p1"), { nome: "X", preco: 1 });
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
test("ninguém escreve em produtos_secretos (nem autorizado)", async () => {
  await assertFails(setDoc(doc(user("AUT"), "produtos_secretos/novo"), { nome: "y" }));
  await assertFails(deleteDoc(doc(user("AUT"), "produtos_secretos/p1")));
});
test("usuário comum NÃO se autoriza sozinho", async () => {
  await assertFails(setDoc(doc(user("HACKER"), "usuarios_autorizados/HACKER"), { ativo: true }));
  await assertFails(setDoc(doc(user("AUT"), "usuarios_autorizados/AUT"), { ativo: true }));
});
test("só lê o PRÓPRIO doc de autorização; não lista", async () => {
  await assertSucceeds(getDoc(doc(user("AUT"), "usuarios_autorizados/AUT")));
  await assertFails(getDoc(doc(user("HACKER"), "usuarios_autorizados/AUT")));
  await assertFails(getDocs(collection(user("AUT"), "usuarios_autorizados")));
  await assertFails(getDoc(doc(anon(), "usuarios_autorizados/AUT")));
});
test("catálogo público segue lendo sem login", async () => {
  await assertSucceeds(getDoc(doc(anon(), "produtos/pub")));
});
test("coleção desconhecida é negada", async () => {
  await assertFails(getDoc(doc(user("AUT"), "outra_colecao/x")));
});
