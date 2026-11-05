// ============================================================
// DISTRIBUIDORA CAMPOS — secreto-firebase.js
// Camada de autenticação da área secreta (Firebase Authentication).
// Reaproveita o app Firebase já criado em firebase-config.js.
// Só é carregado sob demanda (login ou área secreta) — a página
// pública não baixa nada daqui.
// ============================================================
import { app, db } from "./firebase-config.js";
import {
  initializeAuth, browserSessionPersistence,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, onSnapshot, collection
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Sessão vive só na aba: fechar a aba/navegador encerra o acesso.
// (Para manter logado entre visitas, troque por browserLocalPersistence.)
export const auth = initializeAuth(app, { persistence: browserSessionPersistence });

export const COL_PRODUTOS_SECRETOS = "produtos_secretos";
export const COL_USUARIOS_AUTORIZADOS = "usuarios_autorizados";

export { db, doc, getDoc, onSnapshot, collection, signInWithEmailAndPassword, signOut, onAuthStateChanged };

// Confere no Firestore (protegido por regras) se o UID está autorizado.
export let diagAutorizacao = "";   // DEBUG TEMPORÁRIO
export async function usuarioAutorizado(user){
  if (!user) return false;
  try{
    diagAutorizacao = "uid=" + user.uid;
    const snap = await getDoc(doc(db, COL_USUARIOS_AUTORIZADOS, user.uid));
    if (!snap.exists()){ diagAutorizacao += " | DOCUMENTO NAO EXISTE com esse ID"; return false; }
    const v = snap.data().ativo;
    if (v !== true){ diagAutorizacao += " | campo ativo = " + JSON.stringify(v) + " (precisa ser boolean true)"; return false; }
    return true;
  }catch(e){
    diagAutorizacao += " | erro Firestore: " + (e.code || e.message);
    return false;
  }
}
