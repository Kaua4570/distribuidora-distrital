const admin = require('firebase-admin');
const crypto = require('crypto');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
async function auth(req, roles) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const d = await admin.auth().verifyIdToken(t);
  if (roles && !roles.includes(d.role)) throw new Error('Sem permissão');
  return d;
}
const pinFresco = d => d.pinAt && Date.now() - d.pinAt < 8 * 3600e3;
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
// CORS: permite o site (ex.: GitHub Pages) chamar esta API quando ela está em outro endereço (Vercel)
function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}
module.exports = { cors, admin, db, auth, pinFresco, hashPin, crypto };
