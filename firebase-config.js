// ============================================================
// CONFIGURAÇÃO — DISTRIBUIDORA CAMPOS
// ============================================================
// Importado por app.js e admin.js. Não usa Firebase Storage:
// as fotos são salvas em Base64 (comprimidas) no Firestore.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD1A3tnhurt0v4FN634kgT7DIx9MzzSdbc",
  authDomain: "lanchonete-a98dc.firebaseapp.com",
  projectId: "lanchonete-a98dc",
  storageBucket: "lanchonete-a98dc.firebasestorage.app",
  messagingSenderId: "804923372506",
  appId: "1:804923372506:web:9f58c3698475ba30b146e3",
  measurementId: "G-QNMBS7K1F1"
};

export const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);

// WhatsApp da loja (55 + DDD + número, só dígitos)
export const WHATSAPP_LOJA_PADRAO = "5561999123044"; // CONFIRME: (61) 99912-3044

// Senha do painel do dono (trava simples, não é segurança real)
export const ADMIN_SENHA = "Campos@2026"; // <-- TROQUE AQUI

export const COL_PRODUTOS = "produtos";
export const COL_CATEGORIAS = "categorias";
export const COL_PEDIDOS = "pedidos";
export const DOC_CONFIG_LOJA = "config/loja";
