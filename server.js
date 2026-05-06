/* global process */
import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { importX509, jwtVerify } from 'jose';
import admin from 'firebase-admin';
import { corrigirRedacao } from './aiService.js';
import { gerarTema } from './themeAgent.js';

// ─── Validação de ambiente na inicialização ────────────────────────────────────

const ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT    || 3001;
// eslint-disable-next-line no-unused-vars
const FREE_LIFETIME_PREVIEWS      = Number(process.env.FREE_LIFETIME_PREVIEWS      || 1);
const SUBSCRIPTION_MONTHLY_LIMIT  = Number(process.env.SUBSCRIPTION_MONTHLY_LIMIT  || 30);
const SUBSCRIPTION_DAILY_LIMIT    = Number(process.env.SUBSCRIPTION_DAILY_LIMIT    || 1);
const IP_CORRECTIONS_PER_DAY      = Number(process.env.IP_CORRECTIONS_PER_DAY      || 20);
// eslint-disable-next-line no-unused-vars
const IP_FREE_PREVIEWS_PER_DAY    = Number(process.env.IP_FREE_PREVIEWS_PER_DAY    || 1);

// ─── Tabela de planos explícita (PATCH 3 — substitui Math.floor(quantity/15)) ─
const TABELA_PLANOS = {
  '26':    { quantity: 3,   dailyLimit: 3, type: 'credits',      label: 'Pacote 3 correções'  },
  '49.9':  { quantity: 6,   dailyLimit: 6, type: 'credits',      label: 'Pacote 6 correções'  },
  '44.49': { quantity: 30,  dailyLimit: 2, type: 'subscription', label: 'Assinatura Mensal'   },
  '99.9':  { quantity: 120, dailyLimit: 4, type: 'subscription', label: 'Assinatura Anual'    },
};

function encontrarPlano(amount) {
  const amountNum = Number(amount);
  for (const [valor, plano] of Object.entries(TABELA_PLANOS)) {
    if (Math.abs(Number(valor) - amountNum) < 0.1) return plano;
  }
  return null;
}

const REQUIRED_ENV = ['VERTEX_AI_URL', 'VERTEX_API_KEY', 'ALLOWED_ORIGINS', 'FIREBASE_PROJECT_ID', 'MP_WEBHOOK_SECRET'];

function initFirebaseAdmin() {
  if (admin.apps.length) return admin.app();

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }

  return admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

let adminDb = null;
try {
  initFirebaseAdmin();
  adminDb = admin.firestore();
  console.log('[boot] Firebase Admin inicializado para controle de plano e uso.');
} catch (error) {
  console.error('[boot] Firebase Admin não inicializado. Correções serão bloqueadas até configurar credenciais:', error.message);
}

const PLACEHOLDER_PATTERN = /your_|sua_|<\s*[^>]+\s*>|replace|example/i;
const missing = REQUIRED_ENV.filter((key) => {
  const value = process.env[key];
  return !value || PLACEHOLDER_PATTERN.test(value);
});
if (missing.length) {
  console.error(`[boot] Variáveis de ambiente ausentes ou com valor de exemplo: ${missing.join(', ')}`);
  process.exit(1);
}

if (ENV === 'development' && !process.env.INTERNAL_API_KEY) {
  console.warn('[boot] INTERNAL_API_KEY não definido. O fallback de chave interna não estará disponível no modo de desenvolvimento.');
}

// Aviso (não fatal) se MP_WEBHOOK_SECRET não estiver configurado
if (!process.env.MP_WEBHOOK_SECRET) {
  console.warn('[boot] MP_WEBHOOK_SECRET não configurado. O webhook do Mercado Pago ficará BLOQUEADO até ser configurado.');
}

// ─── App ───────────────────────────────────────────────────────────────────────

const app = express();
app.set('trust proxy', 1);

// ─── Segurança: headers ────────────────────────────────────────────────────────

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ─── CORS com whitelist explícita ─────────────────────────────────────────────

const origensPermitidas = process.env.ALLOWED_ORIGINS
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin && ENV === 'development') return callback(null, true);
    if (origensPermitidas.includes(origin)) return callback(null, true);
    callback(new Error(`Origem não permitida pelo CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Device-Id'],
}));

// ─── Body parsing com limite contra JSON Flood ────────────────────────────────

app.use(express.json({ limit: '10kb' }));

// ─── Firebase JWT ─────────────────────────────────────────────────────────────

let firebaseCertsCache = null;
let firebaseCertsExpiresAt = 0;

async function getFirebaseCerts() {
  const now = Date.now();
  if (firebaseCertsCache && now < firebaseCertsExpiresAt) {
    return firebaseCertsCache;
  }

  const response = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  if (!response.ok) {
    throw new Error(`Falha ao buscar certificados Firebase: ${response.statusText}`);
  }

  const cacheControl = response.headers.get('cache-control') || '';
  const maxAgeMatch  = cacheControl.match(/max-age=(\d+)/);
  const maxAge       = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;

  firebaseCertsCache      = await response.json();
  firebaseCertsExpiresAt  = Date.now() + maxAge * 1000;
  return firebaseCertsCache;
}

async function verifyFirebaseIdToken(idToken) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID não está configurado.');

  const certs  = await getFirebaseCerts();
  const issuer = `https://securetoken.google.com/${projectId}`;

  for (const cert of Object.values(certs)) {
    try {
      const key = await importX509(cert, 'RS256');
      const { payload } = await jwtVerify(idToken, key, { audience: projectId, issuer });
      if (!payload.sub) throw new Error('Token Firebase inválido: sub ausente.');
      return payload;
    } catch {
      // continua testando outras chaves
    }
  }
  throw new Error('Token Firebase inválido ou expirado.');
}

async function validarAutenticacao(req, res, next) {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    try {
      const idToken = authorization.split(' ')[1];
      req.user = await verifyFirebaseIdToken(idToken);
      return next();
    } catch (error) {
      console.warn('[auth] Falha ao verificar token Firebase:', error.message);
      return res.status(401).json({ error: 'Não autorizado.' });
    }
  }

  if (ENV === 'development' && process.env.INTERNAL_API_KEY) {
    const chave = req.headers['x-api-key'];
    if (chave && chave === process.env.INTERNAL_API_KEY) {
      console.warn('[auth] Autenticação de fallback via X-API-Key usada em modo de desenvolvimento.');
      return next();
    }
  }

  return res.status(401).json({ error: 'Não autorizado.' });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentUsageMonth() {
  return new Date().toISOString().slice(0, 7);
}

function getCurrentUsageDay() {
  return new Date().toISOString().slice(0, 10);
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (raw || req.ip || req.socket?.remoteAddress || 'unknown').trim();
}

function safeDocId(value) {
  if (value == null) {
    return 'unknown';
  }
  // eslint-disable-next-line no-undef
  return Buffer.from(String(value), 'utf8').toString('base64url');
}

function isSubscriptionActive(userData = {}) {
  if (userData.plan !== 'monthly' || userData.planStatus !== 'active') return false;
  if (!userData.subscriptionUntil) return true;
  const until = userData.subscriptionUntil?.toMillis
    ? userData.subscriptionUntil.toMillis()
    : new Date(userData.subscriptionUntil).getTime();
  return Number.isFinite(until) ? until > Date.now() : true;
}

async function getUserPaidEntitlement(uid) {
  if (!adminDb) return { hasPaidAccess: false, subscriptionActive: false, credits: 0, plan: null, planStatus: null };
  const userSnap = await adminDb.collection('users').doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() : {};
  const subscriptionActive = isSubscriptionActive(userData);
  const credits = Number(userData.correctionCredits || 0);
  return {
    hasPaidAccess: subscriptionActive || credits > 0,
    subscriptionActive,
    credits,
    plan: userData.plan || null,
    planStatus: userData.planStatus || null,
  };
}

function redactFreePreview(resultado) {
  const competencias = resultado.competencias || {};
  const c1    = competencias.competencia_1 || competencias.C1 || null;
  const c2    = competencias.competencia_2 || competencias.C2 || null;
  const notaC1 = typeof c1 === 'number' ? c1 : Number(c1?.nota || 0);
  const notaC2 = typeof c2 === 'number' ? c2 : Number(c2?.nota || 0);

  return {
    access: {
      level: 'preview',
      label: 'Prévia gratuita',
      lockedCompetencies: ['C3', 'C4', 'C5'],
      upgradeMessage: 'Desbloqueie C3, C4, C5, texto anotado e plano de reescrita comprando um pacote ou assinatura.',
    },
    nota_final:           notaC1 + notaC2,
    nota_parcial:         notaC1 + notaC2,
    nota_maxima_parcial:  400,
    competencias: {
      competencia_1: c1,
      competencia_2: c2,
    },
    feedback_geral:    'Prévia gratuita liberada com C1 e C2. Para ver argumentação, coesão, proposta de intervenção, texto anotado e sugestões de reescrita, escolha um pacote.',
    heatmap:           [],
    paragrafo_feedback:[],
    mensagens_agentes: {},
    sugestoes_reescrita:[],
  };
}

// ─── Verificação de plano e limite mensal ─────────────────────────────────────

async function verificarPlanoELimiteMensal(req, res, next) {
  if (!req.user?.sub) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  if (!adminDb) {
    return res.status(503).json({
      error: 'A correção está temporariamente indisponível. Tente novamente em alguns minutos.',
    });
  }

  const uid       = req.user.sub;
  const month     = getCurrentUsageMonth();
  const day       = getCurrentUsageDay();
  const ip        = getClientIp(req);
  const deviceId  = req.headers['x-device-id'] || 'unknown_device';

  const userRef     = adminDb.collection('users').doc(uid);
  const lifetimeRef = adminDb.collection('usageLifetime').doc(uid);
  const monthlyRef  = adminDb.collection('usageMonthly').doc(`${uid}_${month}`);
  const dailyRef    = adminDb.collection('usageDaily').doc(`${uid}_${day}`);
  const ipRef       = adminDb.collection('usageIpDaily').doc(`${safeDocId(ip)}_${day}`);
  const deviceRef   = adminDb.collection('usageDeviceDaily').doc(`${safeDocId(deviceId)}_${day}`);

  try {
    const reservation = await adminDb.runTransaction(async (transaction) => {
      // eslint-disable-next-line no-unused-vars
      const [userSnap, lifetimeSnap, monthlySnap, dailySnap, ipSnap, deviceSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(lifetimeRef),
        transaction.get(monthlyRef),
        transaction.get(dailyRef),
        transaction.get(ipRef),
        transaction.get(deviceRef),
      ]);

      const userData   = userSnap.exists   ? userSnap.data()   : {};
      const monthly    = monthlySnap.exists  ? monthlySnap.data()  : {};
      const daily      = dailySnap.exists    ? dailySnap.data()    : {};
      const ipUsage    = ipSnap.exists       ? ipSnap.data()       : {};

      const ipCorrections = Number(ipUsage.corrections || 0);
      if (ipCorrections >= IP_CORRECTIONS_PER_DAY) {
        return {
          allowed: false,
          status: 429,
          error: 'Muitas correções foram solicitadas nesta rede hoje. Tente novamente mais tarde.',
        };
      }

      const commonIpUpdate = {
        ip,
        day,
        corrections: ipCorrections + 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (isSubscriptionActive(userData)) {
        const monthlyUsed      = Number(monthly.corrections || 0);
        const dailyUsed        = Number(daily.corrections || 0);
        const userMonthlyLimit = Number(userData.monthlyLimit || SUBSCRIPTION_MONTHLY_LIMIT);
        const userDailyLimit   = Number(userData.dailyLimit   || SUBSCRIPTION_DAILY_LIMIT);

        if (monthlyUsed >= userMonthlyLimit) {
          return { allowed: false, status: 402, error: 'Seu limite mensal da assinatura foi atingido.' };
        }
        if (dailyUsed >= userDailyLimit) {
          return { allowed: false, status: 429, error: `Seu plano libera ${userDailyLimit} correção(ões) por dia. Volte amanhã.` };
        }

        transaction.set(monthlyRef, { userId: uid, month, source: 'subscription', corrections: monthlyUsed + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        transaction.set(dailyRef,   { userId: uid, day,   source: 'subscription', corrections: dailyUsed   + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        transaction.set(ipRef, commonIpUpdate, { merge: true });

        return {
          allowed: true,
          level: 'full',
          source: 'subscription',
          refs: ['monthly', 'daily', 'ip'],
          counters: { monthly: monthlyUsed + 1, daily: dailyUsed + 1, ip: ipCorrections + 1 },
        };
      }

      const credits = Number(userData.correctionCredits || 0);
      if (credits > 0) {
        transaction.set(userRef, { correctionCredits: credits - 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        transaction.set(ipRef, commonIpUpdate, { merge: true });

        return {
          allowed: true,
          level: 'full',
          source: 'credits',
          refs: ['credits', 'ip'],
          counters: { credits: credits - 1, ip: ipCorrections + 1 },
        };
      }

      return {
        allowed: false,
        status: 402,
        error: 'Resultado completo disponível somente para usuários com plano pago ou créditos. Faça um pagamento para liberar a correção.',
      };
    });

    if (!reservation.allowed) {
      return res.status(reservation.status || 402).json({
        error: reservation.error || 'Escolha um pacote para continuar corrigindo.',
      });
    }

    req.entitlement = {
      level:    reservation.level,
      source:   reservation.source,
      counters: reservation.counters,
    };

    req.refundCorrectionUsage = async () => {
      await adminDb.runTransaction(async (transaction) => {
        const [userSnap, lifetimeSnap, monthlySnap, dailySnap, ipSnap, deviceSnap] = await Promise.all([
          transaction.get(userRef),
          transaction.get(lifetimeRef),
          transaction.get(monthlyRef),
          transaction.get(dailyRef),
          transaction.get(ipRef),
          transaction.get(deviceRef),
        ]);

        if (reservation.source === 'credits' && userSnap.exists) {
          const current = Number(userSnap.data()?.correctionCredits || 0);
          transaction.set(userRef, { correctionCredits: current + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        }
        if (reservation.refs?.includes('lifetime') && lifetimeSnap.exists) {
          const current = Number(lifetimeSnap.data()?.freePreviews || 0);
          transaction.set(lifetimeRef, { freePreviews: Math.max(0, current - 1), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        }
        if (reservation.refs?.includes('monthly') && monthlySnap.exists) {
          const current = Number(monthlySnap.data()?.corrections || 0);
          transaction.set(monthlyRef, { corrections: Math.max(0, current - 1), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        }
        if (reservation.refs?.includes('daily') && dailySnap.exists) {
          const current = Number(dailySnap.data()?.corrections || 0);
          transaction.set(dailyRef, { corrections: Math.max(0, current - 1), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        }
        if (reservation.refs?.includes('ip') && ipSnap.exists) {
          const ipData = ipSnap.data();
          transaction.set(ipRef, {
            corrections:  Math.max(0, Number(ipData?.corrections  || 0) - 1),
            freePreviews: reservation.source === 'free_preview'
              ? Math.max(0, Number(ipData?.freePreviews || 0) - 1)
              : Number(ipData?.freePreviews || 0),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        if (reservation.refs?.includes('device') && deviceSnap.exists) {
          const dData = deviceSnap.data();
          transaction.set(deviceRef, { freePreviews: Math.max(0, Number(dData?.freePreviews || 0) - 1), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        }
      });
    };

    return next();
  } catch (error) {
    console.error('[quota] Falha ao verificar plano/uso mensal:', error.message);

    if (ENV === 'development') {
      console.warn('[quota] Bypass de cota ativado no modo desenvolvimento (credenciais ausentes ou inválidas).');
      req.entitlement = { level: 'full', source: 'dev_bypass', counters: {} };
      return next();
    }

    return res.status(500).json({ error: 'Falha ao verificar limite de uso.' });
  }
}

// ─── Sanitização de inputs ────────────────────────────────────────────────────

function validarTexto(campo, minLen = 10, maxLen = 5000) {
  return (req, res, next) => {
    const valor = req.body[campo];
    if (typeof valor !== 'string' || valor.trim().length < minLen) {
      return res.status(400).json({ error: `"${campo}" muito curto (mínimo ${minLen} caracteres).` });
    }
    if (valor.length > maxLen) {
      return res.status(400).json({ error: `"${campo}" excede o limite de ${maxLen} caracteres.` });
    }
    // eslint-disable-next-line no-control-regex
    const controlCharRegex = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
    req.body[campo] = valor.replace(controlCharRegex, '').trim();
    next();
  };
}

// ─── Rate Limiters ────────────────────────────────────────────────────────────

const limiteCorrecao = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: req => req.user?.sub || req.headers['x-user-id'] || ipKeyGenerator(req),
  message: { error: 'Limite de correções excedido. Tente novamente em 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const limiteTema = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: req => req.user?.sub || req.headers['x-user-id'] || ipKeyGenerator(req),
  message: { error: 'Limite de geração de temas excedido. Tente novamente em 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── PATCH 1: Validação de assinatura HMAC do Mercado Pago ───────────────────
//
// O MP envia: x-signature: "ts=...,v1=..."  e  x-request-id: "uuid"
// O manifest assinado é: "id:{data.id};request-id:{x-request-id};ts:{ts};"
// Sem isso, qualquer pessoa que conheça a URL pode forjar um pagamento aprovado.

function validarAssinaturaMP(req, res, next) {
  const secret     = process.env.MP_WEBHOOK_SECRET;
  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];

  if (!secret) {
    console.error('[Webhook MP] MP_WEBHOOK_SECRET não configurado. Bloqueando request.');
    return res.status(500).json({ error: 'Webhook não configurado no servidor.' });
  }

  if (!xSignature) {
    console.warn('[Webhook MP] Request sem x-signature rejeitado.');
    return res.status(401).json({ error: 'Assinatura ausente.' });
  }

  if (!xRequestId) {
    console.warn('[Webhook MP] Request sem x-request-id rejeitado.');
    return res.status(401).json({ error: 'Request ID ausente.' });
  }

  const parts = {};
  xSignature.split(',').forEach(part => {
    const [key, value] = part.split('=');
    if (key && value) parts[key.trim()] = value.trim();
  });

  const ts = parts['ts'];
  const v1 = parts['v1'];

  if (!ts || !v1) {
    console.warn('[Webhook MP] Header x-signature malformado.');
    return res.status(401).json({ error: 'Assinatura malformada.' });
  }

  // data.id vem como query string: ?data.id=123
  const dataId = req.query['data.id'] || req.query?.data?.id || req.body?.data?.id;

  if (!dataId) {
    console.warn('[Webhook MP] data.id ausente no request.');
    return res.status(400).json({ error: 'data.id ausente.' });
  }

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  let expectedBuf;
  let receivedBuf;
  try {
    // eslint-disable-next-line no-undef
    expectedBuf = Buffer.from(expected, 'hex');
    // eslint-disable-next-line no-undef
    receivedBuf = Buffer.from(v1, 'hex');
  // eslint-disable-next-line no-unused-vars
  } catch (error) {
    console.warn('[Webhook MP] Assinatura inválida (hex malformado).');
    return res.status(401).json({ error: 'Assinatura inválida.' });
  }

  const assinaturaValida =
    expectedBuf.length === receivedBuf.length &&
    crypto.timingSafeEqual(expectedBuf, receivedBuf);

  if (!assinaturaValida) {
    console.warn(`[Webhook MP] Assinatura inválida para dataId=${dataId}. Possível tentativa de fraude.`);
    return res.status(401).json({ error: 'Assinatura inválida.' });
  }

  req.mpDataId = dataId;
  next();
}

// ─── Rotas ────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', env: ENV, timestamp: new Date().toISOString() });
});

app.get('/api/entitlement', validarAutenticacao, async (req, res) => {
  if (!adminDb) {
    return res.status(503).json({ error: 'Serviço temporariamente indisponível.' });
  }

  try {
    const uid = req.user.sub;
    const entitlement = await getUserPaidEntitlement(uid);
    return res.json(entitlement);
  } catch (error) {
    console.error('[entitlement] Falha ao verificar plano do usuário:', error.message);
    return res.status(500).json({ error: 'Falha ao verificar seu plano.' });
  }
});

app.post(
  '/api/corrigir',
  validarAutenticacao,
  limiteCorrecao,
  validarTexto('tema', 10, 300),
  validarTexto('redacao', 100, 5000),
  verificarPlanoELimiteMensal,
  async (req, res) => {
    const { tema, redacao } = req.body;

    try {
      const resultado = await corrigirRedacao(tema, redacao);
      const responseResult = req.entitlement?.level === 'preview'
        ? redactFreePreview(resultado)
        : { ...resultado, access: { level: 'full', source: req.entitlement?.source || 'paid' } };
      return res.json({ resultado: responseResult, access: responseResult.access });
    } catch (error) {
      console.error('[/api/corrigir]', error.message);
      if (req.refundCorrectionUsage) {
        try {
          await req.refundCorrectionUsage();
        } catch (refundError) {
          console.error('[quota] Falha ao devolver uso após erro da IA:', refundError.message);
        }
      }
      return res.status(502).json({ error: 'Falha ao processar a redação. Tente novamente.' });
    }
  }
);

app.post(
  '/api/gerar-tema',
  validarAutenticacao,
  limiteTema,
  validarTexto('assunto', 5, 200),
  async (req, res) => {
    const { assunto } = req.body;

    try {
      const resultado = await gerarTema(assunto);
      return res.json({ resultado });
    } catch (error) {
      console.error('[/api/gerar-tema]', error.message);
      return res.status(502).json({ error: 'Falha ao gerar o tema. Tente novamente.' });
    }
  }
);

// ─── Webhook Mercado Pago ─────────────────────────────────────────────────────
// PATCH 1 (HMAC) aplicado via middleware validarAssinaturaMP
// PATCH 2 (idempotência) aplicado dentro da transaction
// PATCH 3 (cross-check uid vs email) aplicado antes de escrever no Firestore

app.post('/api/webhook/mercadopago', validarAssinaturaMP, async (req, res) => {
  // Responde 200 imediatamente — o MP exige resposta rápida
  res.sendStatus(200);

  try {
    const { type, action } = req.body;
    const paymentId = req.mpDataId; // injetado pelo middleware PATCH 1

    const ehEventoRelevante =
      type === 'payment' ||
      action === 'payment.created' ||
      action === 'payment.updated';

    if (!ehEventoRelevante || !paymentId) return;

    const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
    if (!MP_TOKEN) {
      console.error('[Webhook MP] MP_ACCESS_TOKEN não configurado no .env!');
      return;
    }

    // 1. Busca dados confiáveis do pagamento direto no servidor do MP
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` },
    });
    if (!mpResponse.ok) {
      console.error(`[Webhook MP] Falha ao buscar pagamento ${paymentId}: ${mpResponse.status}`);
      return;
    }

    const paymentData = await mpResponse.json();

    // 2. Só entrega se estiver APROVADO
    if (paymentData.status !== 'approved') {
      console.log(`[Webhook MP] Pagamento ${paymentId} com status "${paymentData.status}". Ignorando.`);
      return;
    }

    const userId = paymentData.external_reference;
    if (!userId || userId === 'null' || userId === 'undefined') {
      console.error(`[Webhook MP] Pagamento ${paymentId} sem external_reference válido.`);
      return;
    }

    const amount = Number(paymentData.transaction_amount);
    const plano  = encontrarPlano(amount);

    if (!plano) {
      console.warn(`[Webhook MP] Valor R$${amount} não corresponde a nenhum plano. PaymentId=${paymentId}`);
      return;
    }

    const userRef     = adminDb.collection('users').doc(userId);
    const pgtoRef     = adminDb.collection('processedPayments').doc(String(paymentId));
    const lifetimeRef = adminDb.collection('usageLifetime').doc(userId);

    const entregouPlano = await adminDb.runTransaction(async (t) => {

      // ── PATCH 2: Idempotência ─────────────────────────────────────────────
      // Lê o doc ANTES de escrever — se já existe, o MP reenviou o evento
      const pgtoSnap = await t.get(pgtoRef);
      if (pgtoSnap.exists) {
        console.log(`[Webhook MP] Pagamento ${paymentId} já processado. Ignorando duplicata.`);
        return false;
      }

      // ── PATCH 3: Cross-check uid vs email do pagador ──────────────────────
      const userSnap = await t.get(userRef);
      const userData = userSnap.exists ? userSnap.data() : null;

      if (!userData) {
        console.error(`[Webhook MP] uid ${userId} não encontrado no Firestore. Pagamento ${paymentId} não entregue.`);
        return false;
      }

      const emailCadastrado = userData.email?.toLowerCase().trim();
      const emailPagador    = paymentData.payer?.email?.toLowerCase().trim();

      if (emailCadastrado && (!emailPagador || emailPagador !== emailCadastrado)) {
        console.error(
          `[Webhook MP] FRAUDE DETECTADA! ` +
          `uid=${userId} tem email="${emailCadastrado}" mas pagador é "${emailPagador || 'ausente'}". ` +
          `PaymentId=${paymentId} NÃO entregue.`
        );
        // Salva para auditoria
        t.set(adminDb.collection('fraudAttempts').doc(String(paymentId)), {
          userId, emailCadastrado, emailPagador: emailPagador || null, amount, paymentId,
          detectedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return false;
      }

      // ── Entrega o plano ───────────────────────────────────────────────────
      let updateData = {};

      if (plano.type === 'subscription') {
        updateData = {
          plan: 'monthly',
          planStatus: 'active',
          monthlyLimit: plano.quantity,
          dailyLimit: plano.dailyLimit,
          subscriptionUntil: admin.firestore.Timestamp.fromDate(
            new Date(Date.now() + 32 * 24 * 60 * 60 * 1000)
          ),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      } else {
        const currentCredits = Number(userData.correctionCredits || 0);
        updateData = {
          correctionCredits: currentCredits + plano.quantity,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      }

      t.set(userRef, updateData, { merge: true });

      // Zera o contador de prévia gratuita para quem acabou de pagar
      t.set(lifetimeRef, {
        freePreviews: 0,
        resetByPayment: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // Marca como processado (garante idempotência em próximos eventos)
      t.set(pgtoRef, {
        userId,
        emailPagador: emailPagador || null,
        amount,
        plano: plano.label,
        quantity: plano.quantity,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return true;
    });

    if (entregouPlano) {
      console.log(`[Webhook MP] ✅ "${plano.label}" (${plano.quantity} correções) entregue para uid=${userId}`);
    } else {
      console.log(`[Webhook MP] Pagamento ${paymentId} não entregue para uid=${userId}.`);
    }

  } catch (error) {
    // 200 já foi enviado — loga mas não relança
    console.error('[Webhook MP] Erro no processamento pós-resposta:', error.message);
  }
});

// ─── 404 catch-all ────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// ─── Error handler global ─────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  void next;
  if (err.message?.includes('CORS')) {
    return res.status(403).json({ error: 'Origem não autorizada.' });
  }
  console.error('[global error handler]', err.message);
  res.status(500).json({ error: 'Erro interno.' });
});

// ─── Processo resiliente ──────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 Micro-backend rodando | env=${ENV} | porta=${PORT}`);
});