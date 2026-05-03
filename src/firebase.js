import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

const appCheckDebugToken = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN
const recaptchaKey = import.meta.env.VITE_RECAPTCHA_KEY
const appCheckEnabled = import.meta.env.PROD ? Boolean(recaptchaKey) : Boolean(appCheckDebugToken)

if (import.meta.env.DEV && appCheckDebugToken) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = appCheckDebugToken
}

let appCheck
if (appCheckEnabled) {
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(recaptchaKey),
    isTokenAutoRefreshEnabled: true,
  })
} else {
  console.warn('Firebase App Check está desabilitado. Defina VITE_RECAPTCHA_KEY em produção ou VITE_FIREBASE_APPCHECK_DEBUG_TOKEN em dev para habilitar.')
}

export { appCheck }

export const auth = getAuth(app)
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()
