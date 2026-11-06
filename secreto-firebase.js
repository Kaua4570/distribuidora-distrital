// ============================================================
// DISTRIBUIDORA CAMPOS — secreto-firebase.js
// Camada de autenticação da área secreta (Firebase Authentication).
// Reaproveita o app Firebase já criado em firebase-config.js.
// Só é carregado sob demanda (login ou área secreta) — a página
// pública não baixa nada daqui.
// ============================================================
import { app, db, COL_PEDIDOS } from "./firebase-config.js";
import {
  initializeAuth, browserSessionPersistence,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, onSnapshot, collection, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
  runTransaction, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Sessão vive só na aba: fechar a aba/navegador encerra o acesso.
// (Para manter logado entre visitas, troque por browserLocalPersistence.)
export const auth = initializeAuth(app, { persistence: browserSessionPersistence });

export const COL_PRODUTOS_SECRETOS = "produtos_secretos";
export const COL_CATEGORIAS_SECRETAS = "categorias_secretas";
export const COL_CONTADORES = "contadores";
export const COL_USUARIOS_AUTORIZADOS = "usuarios_autorizados";

export {
  db, doc, getDoc, onSnapshot, collection, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
  runTransaction, query, where, COL_PEDIDOS,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
};

// Confere no Firestore (protegido por regras) se o UID está autorizado.
export async function usuarioAutorizado(user){
  if (!user) return false;
  try{
    const snap = await getDoc(doc(db, COL_USUARIOS_AUTORIZADOS, user.uid));
    return snap.exists() && snap.data().ativo === true;
  }catch(_){
    return false;
  }
}

// Perfil do login: { ativo, admin, tipo, nome } ou null.
// tipo: "admin" | "cliente" | "entregador" | "comanda" (sem tipo gravado = cliente).
export async function perfilDoUsuario(user){
  if (!user) return null;
  try{
    const snap = await getDoc(doc(db, COL_USUARIOS_AUTORIZADOS, user.uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    const admin = d.admin === true;
    return { ativo: d.ativo === true, admin, tipo: admin ? "admin" : (d.tipo || "cliente"), nome: d.nome || "" };
  }catch(_){
    return null;
  }
}

// Para onde cada tipo de login vai depois de entrar.
export function paginaInicialDo(perfil){
  if (perfil && perfil.tipo === "entregador") return "entregador.html";
  if (perfil && perfil.tipo === "comanda") return "admin.html";
  return "produtos-secretos.html";
}
