/* global process */
import 'dotenv/config';
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
const FREE_LIFETIME_PREVIEWS = Number(process.env.FREE_LIFETIME_PREVIEWS || 1);
const SUBSCRIPTION_MONTHLY_LIMIT = Number(process.env.SUBSCRIPTION_MONTHLY_LIMIT || 30);
const SUBSCRIPTION_DAILY_LIMIT = Number(process.env.SUBSCRIPTION_DAILY_LIMIT || 1);
const IP_CORRECTIONS_PER_DAY = Number(process.env.IP_CORRECTIONS_PER_DAY || 20);
const IP_FREE_PREVIEWS_PER_DAY = Number(process.env.IP_FREE_PREVIEWS_PER_DAY || 1);

const REQUIRED_ENV = ['VERTEX_AI_URL', 'VERTEX_API_KEY', 'ALLOWED_ORIGINS', 'FIREBASE_PROJECT_ID'];
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
  console.error('[boot] Firebase Admin nao inicializado. Correcoes serao bloqueadas ate configurar credenciais:', error.message);
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
    // Permite chamadas sem origin (ex: mobile nativo, Postman em dev)
    if (!origin && ENV === 'development') return callback(null, true);
    if (origensPermitidas.includes(origin)) return callback(null, true);
    callback(new Error(`Origem não permitida pelo CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Device-Id'],
}));

// ─── Body parsing com limite contra JSON Flood ────────────────────────────────

app.use(express.json({ limit: '10kb' }));

// ─── Middlewares reutilizáveis ─────────────────────────────────────────────────

/**
 * Valida a chave interna (usada pelo próprio frontend/BFF).
 * Evita que qualquer pessoa que descubra a URL use a API diretamente.
 */
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
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;

  firebaseCertsCache = await response.json();
  firebaseCertsExpiresAt = Date.now() + maxAge * 1000;
  return firebaseCertsCache;
}

async function verifyFirebaseIdToken(idToken) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID não está configurado.');
  }

  const certs = await getFirebaseCerts();
  const issuer = `https://securetoken.google.com/${projectId}`;

  for (const cert of Object.values(certs)) {
    try {
      const key = await importX509(cert, 'RS256');
      const { payload } = await jwtVerify(idToken, key, {
        audience: projectId,
        issuer,
      });
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
  return Buffer.from(value, 'utf8').toString('base64url');
}

function isSubscriptionActive(userData = {}) {
  if (userData.plan !== 'monthly' || userData.planStatus !== 'active') return false;
  if (!userData.subscriptionUntil) return true;
  const until = userData.subscriptionUntil?.toMillis
    ? userData.subscriptionUntil.toMillis()
    : new Date(userData.subscriptionUntil).getTime();
  return Number.isFinite(until) ? until > Date.now() : true;
}

function redactFreePreview(resultado) {
  const competencias = resultado.competencias || {};
  const c1 = competencias.competencia_1 || competencias.C1 || null;
  const c2 = competencias.competencia_2 || competencias.C2 || null;
  const notaC1 = typeof c1 === 'number' ? c1 : Number(c1?.nota || 0);
  const notaC2 = typeof c2 === 'number' ? c2 : Number(c2?.nota || 0);

  return {
    access: {
      level: 'preview',
      label: 'Prévia gratuita',
      lockedCompetencies: ['C3', 'C4', 'C5'],
      upgradeMessage: 'Desbloqueie C3, C4, C5, texto anotado e plano de reescrita comprando um pacote ou assinatura.',
    },
    nota_final: notaC1 + notaC2,
    nota_parcial: notaC1 + notaC2,
    nota_maxima_parcial: 400,
    competencias: {
      competencia_1: c1,
      competencia_2: c2,
    },
    feedback_geral: 'Prévia gratuita liberada com C1 e C2. Para ver argumentação, coesão, proposta de intervenção, texto anotado e sugestões de reescrita, escolha um pacote.',
    heatmap: [],
    paragrafo_feedback: [],
    mensagens_agentes: {},
    sugestoes_reescrita: [],
  };
}

async function verificarPlanoELimiteMensal(req, res, next) {
  if (!req.user?.sub) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  if (!adminDb) {
    return res.status(503).json({
      error: 'A correcao esta temporariamente indisponivel. Tente novamente em alguns minutos.',
    });
  }

  const uid = req.user.sub;
  const month = getCurrentUsageMonth();
  const day = getCurrentUsageDay();
  const ip = getClientIp(req);
  const deviceId = req.headers['x-device-id'] || 'unknown_device';
  const userRef = adminDb.collection('users').doc(uid);
  const lifetimeRef = adminDb.collection('usageLifetime').doc(uid);
  const monthlyRef = adminDb.collection('usageMonthly').doc(`${uid}_${month}`);
  const dailyRef = adminDb.collection('usageDaily').doc(`${uid}_${day}`);
  const ipRef = adminDb.collection('usageIpDaily').doc(`${safeDocId(ip)}_${day}`);
  const deviceRef = adminDb.collection('usageDeviceDaily').doc(`${safeDocId(deviceId)}_${day}`);

  try {
    const reservation = await adminDb.runTransaction(async (transaction) => {
      const [userSnap, lifetimeSnap, monthlySnap, dailySnap, ipSnap, deviceSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(lifetimeRef),
        transaction.get(monthlyRef),
        transaction.get(dailyRef),
        transaction.get(ipRef),
        transaction.get(deviceRef),
      ]);

      const userData = userSnap.exists ? userSnap.data() : {};
      const lifetime = lifetimeSnap.exists ? lifetimeSnap.data() : {};
      const monthly = monthlySnap.exists ? monthlySnap.data() : {};
      const daily = dailySnap.exists ? dailySnap.data() : {};
      const ipUsage = ipSnap.exists ? ipSnap.data() : {};
      const deviceUsage = deviceSnap.exists ? deviceSnap.data() : {};

      const ipCorrections = Number(ipUsage.corrections || 0);
      if (ipCorrections >= IP_CORRECTIONS_PER_DAY) {
        return {
          allowed: false,
          status: 429,
          error: 'Muitas correcoes foram solicitadas nesta rede hoje. Tente novamente mais tarde.',
        };
      }

      const commonIpUpdate = {
        ip,
        day,
        corrections: ipCorrections + 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (isSubscriptionActive(userData)) {
        const monthlyUsed = Number(monthly.corrections || 0);
        const dailyUsed = Number(daily.corrections || 0);

        const userMonthlyLimit = Number(userData.monthlyLimit || SUBSCRIPTION_MONTHLY_LIMIT);
        const userDailyLimit = Number(userData.dailyLimit || SUBSCRIPTION_DAILY_LIMIT);

        if (monthlyUsed >= userMonthlyLimit) {
          return {
            allowed: false,
            status: 402,
            error: 'Seu limite mensal da assinatura foi atingido.',
          };
        }

        if (dailyUsed >= userDailyLimit) {
          return {
            allowed: false,
            status: 429,
            error: `Seu plano libera ${userDailyLimit} correção(ões) por dia. Volte amanhã.`,
          };
        }

        transaction.set(monthlyRef, {
          userId: uid,
          month,
          source: 'subscription',
          corrections: monthlyUsed + 1,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        transaction.set(dailyRef, {
          userId: uid,
          day,
          source: 'subscription',
          corrections: dailyUsed + 1,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
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
        transaction.set(userRef, {
          correctionCredits: credits - 1,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        transaction.set(ipRef, commonIpUpdate, { merge: true });

        return {
          allowed: true,
          level: 'full',
          source: 'credits',
          refs: ['credits', 'ip'],
          counters: { credits: credits - 1, ip: ipCorrections + 1 },
        };
      }

      const freeUsed = Number(lifetime.freePreviews || 0);
      const ipFreePreviews = Number(ipUsage.freePreviews || 0);
      const deviceFreePreviews = Number(deviceUsage.freePreviews || 0);
      
      if (freeUsed >= FREE_LIFETIME_PREVIEWS) {
        return {
          allowed: false,
          status: 402,
          error: 'Sua prévia gratuita já foi usada. Escolha um pacote para desbloquear novas correções.',
        };
      }

      if (ipFreePreviews >= IP_FREE_PREVIEWS_PER_DAY) {
        return {
          allowed: false,
          status: 429,
          error: 'O limite de testes para esta rede/Wi-Fi foi atingido hoje. Escolha um plano para liberar acessos.',
        };
      }

      if (deviceFreePreviews >= IP_FREE_PREVIEWS_PER_DAY) {
        return {
          allowed: false,
          status: 429,
          error: 'Você já usou seu teste gratuito neste dispositivo. Assine um plano para continuar.',
        };
      }

      transaction.set(lifetimeRef, {
        userId: uid,
        freePreviews: freeUsed + 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(ipRef, {
        ...commonIpUpdate,
        freePreviews: ipFreePreviews + 1,
      }, { merge: true });
      transaction.set(deviceRef, {
        deviceId,
        day,
        freePreviews: deviceFreePreviews + 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      return {
        allowed: true,
        level: 'preview',
        source: 'free_preview',
        refs: ['lifetime', 'ip', 'device'],
        counters: { freePreviews: freeUsed + 1, ipFreePreviews: ipFreePreviews + 1, ip: ipCorrections + 1 },
      };
    });

    if (!reservation.allowed) {
      return res.status(reservation.status || 402).json({
        error: reservation.error || 'Escolha um pacote para continuar corrigindo.',
      });
    }

    req.entitlement = {
      level: reservation.level,
      source: reservation.source,
      counters: reservation.counters,
    };
    req.refundCorrectionUsage = async () => {
      await adminDb.runTransaction(async (transaction) => {
        const [userSnap, lifetimeSnap, monthlySnap, dailySnap, ipSnap] = await Promise.all([
          transaction.get(userRef),
          transaction.get(lifetimeRef),
          transaction.get(monthlyRef),
          transaction.get(dailyRef),
          transaction.get(ipRef),
        ]);

        if (reservation.source === 'credits' && userSnap.exists) {
          const current = Number(userSnap.data()?.correctionCredits || 0);
          transaction.set(userRef, {
            correctionCredits: current + 1,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }

        if (reservation.refs?.includes('lifetime') && lifetimeSnap.exists) {
          const current = Number(lifetimeSnap.data()?.freePreviews || 0);
          transaction.set(lifetimeRef, {
            freePreviews: Math.max(0, current - 1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }

        if (reservation.refs?.includes('monthly') && monthlySnap.exists) {
          const current = Number(monthlySnap.data()?.corrections || 0);
          transaction.set(monthlyRef, {
            corrections: Math.max(0, current - 1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }

        if (reservation.refs?.includes('daily') && dailySnap.exists) {
          const current = Number(dailySnap.data()?.corrections || 0);
          transaction.set(dailyRef, {
            corrections: Math.max(0, current - 1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }

        if (reservation.refs?.includes('ip') && ipSnap.exists) {
          const ipData = ipSnap.data();
          transaction.set(ipRef, {
            corrections: Math.max(0, Number(ipData?.corrections || 0) - 1),
            freePreviews: reservation.source === 'free_preview'
              ? Math.max(0, Number(ipData?.freePreviews || 0) - 1)
              : Number(ipData?.freePreviews || 0),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }

        if (reservation.refs?.includes('device') && deviceSnap.exists) {
          const dData = deviceSnap.data();
          transaction.set(deviceRef, {
            freePreviews: Math.max(0, Number(dData?.freePreviews || 0) - 1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }
      });
    };

    return next();
  } catch (error) {
    console.error('[quota] Falha ao verificar plano/uso mensal:', error.message);
    
    // Se estiver rodando localmente sem as credenciais, libera a correção para não travar o desenvolvimento
    if (ENV === 'development') {
      console.warn('[quota] Bypass de cota ativado no modo desenvolvimento (credenciais ausentes ou inválidas).');
      req.entitlement = {
        level: 'full',
        source: 'dev_bypass',
        counters: {},
      };
      return next();
    }

    return res.status(500).json({ error: 'Falha ao verificar limite de uso.' });
  }
}

/**
 * Sanitização e validação de strings de entrada.
 * Rejeita payloads vazios ou muito longos antes de chegar na IA.
 */
function validarTexto(campo, minLen = 10, maxLen = 5000) {
  return (req, res, next) => {
    const valor = req.body[campo];
    if (typeof valor !== 'string' || valor.trim().length < minLen) {
      return res.status(400).json({ error: `"${campo}" muito curto (mínimo ${minLen} caracteres).` });
    }
    if (valor.length > maxLen) {
      return res.status(400).json({ error: `"${campo}" excede o limite de ${maxLen} caracteres.` });
    }
    // Remove caracteres de controle (exceto quebras de linha normais)
    const controlCharRegex = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
    req.body[campo] = valor.replace(controlCharRegex, '').trim();
    next();
  };
}

// ─── Rate Limiters separados por custo de operação ───────────────────────────

// Correção é cara (Vertex AI) — limite mais restrito
const limiteCorrecao = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: req => req.user?.sub || req.headers['x-user-id'] || ipKeyGenerator(req),
  message: { error: 'Limite de correções excedido. Tente novamente em 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Geração de tema é mais leve — limite mais generoso
const limiteTema = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: req => req.user?.sub || req.headers['x-user-id'] || ipKeyGenerator(req),
  message: { error: 'Limite de geração de temas excedido. Tente novamente em 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Rotas ─────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', env: ENV, timestamp: new Date().toISOString() });
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
        : {
            ...resultado,
            access: {
              level: 'full',
              source: req.entitlement?.source || 'paid',
            },
          };
      return res.json({ resultado: responseResult, access: responseResult.access });
    } catch (error) {
      console.error('[/api/corrigir]', error.message);
      if (req.refundCorrectionUsage) {
        try {
          await req.refundCorrectionUsage();
        } catch (refundError) {
          console.error('[quota] Falha ao devolver uso apos erro da IA:', refundError.message);
        }
      }
      return res.status(502).json({ error: 'Falha ao processar a redacao. Tente novamente.' });
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

// ─── Webhooks de Pagamento (Mercado Pago) ─────────────────────────────────────

app.post('/api/webhook/mercadopago', async (req, res) => {
  // O MP manda um POST para nossa API sempre que um pagamento é aprovado, negado, etc.
  try {
    const { type, action, data } = req.body;
    
    // Apenas continuamos se for um pagamento criado/atualizado que precisamos olhar o ID
    if (type === 'payment' || action === 'payment.created' || action === 'payment.updated') {
      const paymentId = req.query.data?.id || data?.id || req.body.id;
      if (!paymentId) return res.sendStatus(200);

      // Usando seu token de integração do Mercado Pago (Precisa colocar no .env e habilitar)
      const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
      if (!MP_TOKEN) {
        console.error('[Webhook MP] Token do Mercado Pago não configurado no .env!');
        return res.sendStatus(200);
      }

      // 1. Busca os detalhes originais e confiáveis do pagamento do servidor do MP
      const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` }
      });
      if (!mpResponse.ok) return res.sendStatus(200); // Não foi possivel ler o pgto
      
      const paymentData = await mpResponse.json();
      
      // 2. Só entregamos se tiver APROVADO
      if (paymentData.status !== 'approved') {
        return res.sendStatus(200);
      }

      // O external_reference DEVE ser o userId (UID do Firebase) na hora de criar o link do MP
      const userId = paymentData.external_reference;
      if (!userId || userId === 'null') {
        console.error('[Webhook MP] Pagamento sem external_reference (userId do aluno).');
        return res.sendStatus(200); 
      }

      const amount = Number(paymentData.transaction_amount);
      const userRef = adminDb.collection('users').doc(userId);

      // 3. Regras de Negócio (Valores exatos ou aproximados do plano)
      const deltaLimits = { 26: 3, 49.9: 6, 44.49: 30, 99.9: 120 };
      
      // Acha a chave que chegue perto para evitar problemas com centavos flutuantes (ex: 49.90 virar 49.9)
      const matchedPlan = Object.keys(deltaLimits).find(planValue => Math.abs(Number(planValue) - amount) < 0.1);

      if (!matchedPlan) {
        console.warn(`[Webhook MP] Aluno ${userId} pagou R$ ${amount}, mas não achamos o pacote correspondente.`);
        return res.sendStatus(200);
      }

      const isSub = (matchedPlan === '44.49' || matchedPlan === '99.9');
      const quantity = deltaLimits[matchedPlan];

      // 4. Salva no Firestore (Tudo numa Transaction para evitar conflito)
      await adminDb.runTransaction(async (t) => {
        const snap = await t.get(userRef);
        let updateData = {};

        if (isSub) {
          // É uma assinatura mensal, atualizamos os limites mensais do cara
          updateData = {
            plan: 'monthly',
            planStatus: 'active',
            monthlyLimit: quantity,
            // Pode corrigir 120 redações de uma vez? Ou por dia liberamos quantas? 
            // ex: pacotes maiores podem dar até 4 por dia. Vamos deixar fixo 4 ou dividir.
            dailyLimit: Math.floor(quantity / 15) || 1, 
            subscriptionUntil: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 32 * 24 * 60 * 60 * 1000)),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          };
        } else {
          // É um pacote avulso, damos os créditos + mantemos o que ele já tem
          const currentCredits = snap.exists ? Number(snap.data().correctionCredits || 0) : 0;
          updateData = {
            correctionCredits: currentCredits + quantity,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          };
        }
        t.set(userRef, updateData, { merge: true });
        
        // Vamos guardar também que processamos isso para não entregar dobrado se o MP mandar 2x o evento
        const pgtoRef = adminDb.collection('processedPayments').doc(`${paymentId}`);
        t.set(pgtoRef, { userId, amount, quantity, processedAt: admin.firestore.FieldValue.serverTimestamp() });
      });

      console.log(`[Webhook MP] SUCESSO! Entrega de ${quantity} redações processada para o aluno: ${userId}`);
    }
    
    // MP sempre exige res.sendStatus(200) rápido
    res.sendStatus(200);
  } catch (error) {
    console.error('[Webhook MP] Erro catastrófico no webhook:', error.message);
    res.sendStatus(200); // retorna 200 pra ele não ficar re-tentando e floodar caso seja um bug fixo do formato JSON falso
  }
});

// ─── 404 catch-all ────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// ─── Error handler global (erros síncronos e de middleware) ───────────────────

app.use((err, req, res, next) => {
  void next;
  // Erros de CORS chegam aqui
  if (err.message?.includes('CORS')) {
    return res.status(403).json({ error: 'Origem não autorizada.' });
  }
  console.error('[global error handler]', err.message);
  res.status(500).json({ error: 'Erro interno.' });
});

// ─── Processo resiliente ──────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  // Não derruba o processo — loga e continua
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  // Aqui sim encerra, pois o estado pode estar corrompido
  process.exit(1);
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 Micro-backend rodando | env=${ENV} | porta=${PORT}`);
});
