// Configuração WEB do Firebase (pode ser pública; a proteção está nas regras do Firestore)
export const firebaseConfig = {
  apiKey: "AIzaSyD1A3tnhurt0v4FN634kgT7DIx9MzzSdbc",
  authDomain: "lanchonete-a98dc.firebaseapp.com",
  projectId: "lanchonete-a98dc",
  storageBucket: "lanchonete-a98dc.firebasestorage.app",
  messagingSenderId: "804923372506",
  appId: "1:804923372506:web:9f58c3698475ba30b146e3"
};

// Endereço da API (pin, pix, webhook, create-user).
// Deixe "" se o site inteiro estiver na Vercel.
// Se o site estiver no GitHub Pages, coloque aqui o endereço da Vercel, ex.: "https://SEU-PROJETO.vercel.app"
export const API_BASE = "";
