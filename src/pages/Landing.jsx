import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../firebase'

const apiUrl = import.meta.env.VITE_API_URL
  ? new URL('/api', import.meta.env.VITE_API_URL).toString()
  : 'http://localhost:3001/api'

const DEFAULT_TEMA = 'Desafios para combater a ansiedade entre jovens no Brasil contemporaneo'
const DRAFT_KEY = 'redacaoMilPublicDraft'
const THEME_KEY = 'redacaoMilPublicTheme'
const SUPPORT_TEXTS = [
  {
    title: 'Texto I',
    body: 'Segundo a Organizacao Mundial da Saude, sintomas de ansiedade e depressao entre jovens cresceram de forma significativa nos ultimos anos, especialmente em contextos de pressao escolar, hiperconectividade e incerteza sobre o futuro.',
    source: 'Fonte: OMS, adaptado para proposta ENEM',
  },
  {
    title: 'Texto II',
    body: 'No Brasil, estudantes do ensino medio relatam rotina intensa de estudos, comparacao constante nas redes sociais e medo de decepcionar a familia. A redacao do ENEM costuma concentrar parte dessa ansiedade por ter peso decisivo na nota final.',
    source: 'Fonte: levantamento educacional, adaptado',
  },
  {
    title: 'Texto III',
    body: 'Especialistas defendem que praticar com feedback rapido ajuda o aluno a transformar inseguranca em plano de acao: identificar o erro, reescrever e acompanhar a evolucao reduz a sensacao de estar estudando no escuro.',
    source: 'Fonte: estudos sobre aprendizagem ativa, adaptado',
  },
]

function userFacingApiError(error) {
  if (error.status === 402) {
    return error.message || 'Seu limite gratuito acabou. Assine o Pro para continuar corrigindo.'
  }
  if (error.status === 401) {
    return 'Entre na sua conta para corrigir a redacao.'
  }
  if (error.status === 400) {
    return 'Revise o tema e o texto. Sua redacao precisa estar completa para uma correcao precisa.'
  }
  if (error.status === 429) {
    return 'Voce fez muitas tentativas em pouco tempo. Espere um pouco e tente novamente.'
  }
  if (error.status === 503) {
    return 'A correcao esta temporariamente indisponivel. Tente novamente em alguns minutos.'
  }
  if (error.status >= 500) {
    return 'Nao conseguimos corrigir sua redacao agora. Tente novamente em alguns instantes.'
  }
  if (error instanceof TypeError || error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
    return 'Nao conseguimos conectar ao corretor agora. Verifique sua conexao e tente novamente.'
  }
  return 'Nao conseguimos concluir a correcao agora. Tente novamente em instantes.'
}

function AuthModal({ onClose, onAuthenticated }) {
  const { login, register, loginWithGoogle } = useAuth()
  const [mode, setMode] = useState('register')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function finishAuth(authPromise) {
    setError('')
    setLoading(true)
    try {
      await authPromise
      onAuthenticated()
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') setError('Este e-mail ja esta cadastrado. Tente entrar.')
      else if (err.code === 'auth/invalid-credential') setError('E-mail ou senha incorretos.')
      else setError('Nao foi possivel continuar. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.')
      return
    }

    if (mode === 'register') {
      const isDisposable = ['tempmail', '10minutemail', 'throwaway', 'yopmail', 'guerrillamail']
        .some(domain => email.toLowerCase().includes(domain));
      if (isDisposable) {
        setError('Por favor, use um e-mail válido e permanente para não perder sua nota.');
        return;
      }
      finishAuth(register(name, email, password))
    } else {
      finishAuth(login(email, password))
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/65 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-7 shadow-2xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent">Sua correcao esta pronta</p>
            <h2 className="mt-2 text-2xl font-bold text-ink">Veja sua nota completa</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-light">
              Entre para liberar a nota por competencia, salvar seu historico e acompanhar sua evolucao ate o ENEM.
            </p>
          </div>
          <button onClick={onClose} className="rounded-full px-3 py-1 text-xl text-ink-muted hover:bg-paper-dark">x</button>
        </div>

        <button
          onClick={() => finishAuth(loginWithGoogle())}
          disabled={loading}
          className="mb-4 flex w-full items-center justify-center gap-3 rounded-xl border border-ink/10 py-3 text-sm font-bold text-ink transition-colors hover:bg-paper-warm disabled:opacity-60"
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continuar com Google
        </button>

        <div className="mb-4 grid grid-cols-2 rounded-xl bg-paper-dark p-1 text-sm font-semibold">
          <button onClick={() => setMode('register')} className={`rounded-lg py-2 ${mode === 'register' ? 'bg-white text-ink shadow-sm' : 'text-ink-muted'}`}>
            Criar conta
          </button>
          <button onClick={() => setMode('login')} className={`rounded-lg py-2 ${mode === 'login' ? 'bg-white text-ink shadow-sm' : 'text-ink-muted'}`}>
            Entrar
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'register' && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome"
              required
              className="w-full rounded-xl border border-ink/10 px-4 py-3 text-sm outline-none focus:border-accent"
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com"
            required
            className="w-full rounded-xl border border-ink/10 px-4 py-3 text-sm outline-none focus:border-accent"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Senha"
            required
            className="w-full rounded-xl border border-ink/10 px-4 py-3 text-sm outline-none focus:border-accent"
          />

          {error && <p className="rounded-xl border border-error/20 bg-error/10 px-4 py-3 text-sm text-error-dark">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-ink py-3 font-bold text-white transition-colors hover:bg-accent disabled:opacity-60"
          >
            {loading ? 'Continuando...' : mode === 'register' ? 'Liberar minha nota' : 'Entrar e ver minha nota'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs leading-relaxed text-ink-muted">
          Sem cartao. Sua primeira correcao completa fica salva na sua conta.
        </p>
      </div>
    </div>
  )
}

export default function Landing() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const editorRef = useRef(null)
  const [tema, setTema] = useState(() => sessionStorage.getItem(THEME_KEY) || DEFAULT_TEMA)
  const [content, setContent] = useState(() => sessionStorage.getItem(DRAFT_KEY) || '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [pendingCorrection, setPendingCorrection] = useState(false)
  const [error, setError] = useState('')

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length
  const canCorrect = tema.trim().length >= 10 && wordCount >= 20

  useEffect(() => {
    sessionStorage.setItem(DRAFT_KEY, content)
  }, [content])

  useEffect(() => {
    sessionStorage.setItem(THEME_KEY, tema)
  }, [tema])

  useEffect(() => {
    if (user && pendingCorrection) {
      setShowAuthModal(false)
      setPendingCorrection(false)
      submitCorrection()
    }
  }, [user, pendingCorrection])

  async function getAuthHeaders() {
    let deviceId = localStorage.getItem('redacao_did');
    if (!deviceId) {
      deviceId = Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem('redacao_did', deviceId);
    }
    const headers = { 'X-Device-Id': deviceId };

    if (!user?.getIdToken) return headers;
    const token = await user.getIdToken()
    headers.Authorization = `Bearer ${token}`
    return headers;
  }

  async function saveResult(resultadoNota) {
    const resultadoPayload = { resultado: resultadoNota, tema, textoOriginal: content }
    window.sessionStorage.setItem('redacaoMilResultado', JSON.stringify(resultadoPayload))

    if (user?.uid) {
      await addDoc(collection(db, 'redacoes'), {
        userId: user.uid,
        userName: user.displayName || user.email || 'Aluno RedacaoMil',
        userEmail: user.email || '',
        tema,
        textoOriginal: content,
        notaTotal: resultadoNota.nota_final || resultadoNota.nota_final_estimada || 0,
        competencias: resultadoNota.competencias || {},
        heatmap: resultadoNota.heatmap || [],
        paragrafoFeedback: resultadoNota.paragrafo_feedback || [],
        mensagensAgentes: resultadoNota.mensagens_agentes || {},
        resultadoCompleto: resultadoNota,
        createdAt: serverTimestamp(),
      })
    }

    navigate('/resultado', { state: resultadoPayload })
  }

  async function submitCorrection() {
    if (!canCorrect) {
      editorRef.current?.focus()
      setError('Escreva pelo menos 20 palavras e mantenha um tema valido para liberar a correcao.')
      return
    }

    if (!user) {
      setPendingCorrection(true)
      setShowAuthModal(true)
      return
    }

    setIsSubmitting(true)
    setError('')

    try {
      const res = await fetch(`${apiUrl}/corrigir`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAuthHeaders()),
        },
        body: JSON.stringify({ tema, redacao: content }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const apiError = new Error(data.error || data.message || `Erro ${res.status}`)
        apiError.status = res.status
        throw apiError
      }

      const data = await res.json()
      await saveResult(data.resultado)
    } catch (err) {
      console.error('Erro na correcao', err)
      setError(userFacingApiError(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-40 border-b border-ink/8 bg-paper/95 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-[1760px] items-center justify-between gap-4">
          <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="text-left">
            <span className="block font-serif text-3xl font-black leading-none text-accent">Mil</span>
            <span className="-mt-1 block text-[10px] font-medium uppercase tracking-widest text-ink-muted">Redacao</span>
          </button>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <button onClick={() => navigate('/dashboard')} className="hidden rounded-full border border-ink/10 px-4 py-2 text-sm font-semibold text-ink-light hover:text-ink sm:block">
                  Painel
                </button>
                <button onClick={() => navigate('/editor')} className="rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white hover:bg-accent">
                  Abrir editor completo
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="text-sm font-medium text-ink-muted hover:text-ink">Entrar</Link>
                <button onClick={() => setShowAuthModal(true)} className="rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white hover:bg-accent">
                  Criar conta gratis
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1760px] gap-10 px-8 py-8 xl:grid-cols-[minmax(380px,520px)_minmax(980px,1fr)] xl:items-start 2xl:px-12">
        <section className="pt-4 xl:sticky xl:top-28">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-success/20 bg-success/10 px-3 py-1.5 text-xs font-bold text-success-dark">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Simulado com correcao por competencia
          </div>
          <h1 className="max-w-xl font-serif text-5xl font-black leading-[1.03] text-ink 2xl:text-6xl">
            Descubra hoje o que te impede de tirar 900+ na redacao.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-light">
            Treine em uma folha parecida com a prova, receba sua nota por C1 a C5 e saiba exatamente qual ajuste pode recuperar pontos antes do ENEM.
          </p>

          <div className="mt-7 grid gap-3 text-sm text-ink-light sm:grid-cols-3">
            <div className="rounded-2xl border border-ink/8 bg-white p-4 shadow-sm">
              <p className="font-bold text-ink">Nota realista</p>
              <p>C1 a C5</p>
            </div>
            <div className="rounded-2xl border border-ink/8 bg-white p-4 shadow-sm">
              <p className="font-bold text-ink">Feedback claro</p>
              <p>sem enrolacao</p>
            </div>
            <div className="rounded-2xl border border-ink/8 bg-white p-4 shadow-sm">
              <p className="font-bold text-ink">Treino guiado</p>
              <p>ate a prova</p>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-accent/20 bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-ink">O erro que mais custa ponto</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-light">
              A maioria dos alunos so descobre seus problemas depois de entregar a redacao. Aqui voce descobre antes, reescreve melhor e chega na prova com um metodo.
            </p>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-2xl">
          <div className="border-b border-ink/8 bg-ink px-5 py-5 text-white sm:px-7">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0 flex-1">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.24em] text-white/55">Proposta de redacao ENEM</p>
                <input
                  value={tema}
                  onChange={(e) => setTema(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white outline-none placeholder:text-white/50 focus:border-white/40"
                  placeholder="Digite o tema da redacao"
                />
              </div>
              <div className="rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm">
                <p className="text-white/55 text-[11px] uppercase tracking-[0.2em]">Meta</p>
                <p className="font-bold">30 linhas | texto dissertativo-argumentativo</p>
              </div>
            </div>
          </div>

          <div className="grid gap-0 xl:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]">
            <aside className="border-b border-ink/8 bg-paper-warm p-5 xl:max-h-[760px] xl:overflow-y-auto xl:border-b-0 xl:border-r">
              <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-ink-muted">Textos motivadores</p>
              <div className="space-y-4">
                {SUPPORT_TEXTS.map((item) => (
                  <article key={item.title} className="rounded-xl border border-ink/8 bg-white p-4 shadow-sm">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">{item.title}</p>
                    <p className="mt-2 text-xs leading-relaxed text-ink-light">{item.body}</p>
                    <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-muted">{item.source}</p>
                  </article>
                ))}
              </div>
              <div className="mt-5 rounded-xl border border-ink/8 bg-white p-4">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-ink">Comando da prova</p>
                <p className="mt-2 text-xs leading-relaxed text-ink-light">
                  A partir da leitura dos textos motivadores e com base nos conhecimentos construidos ao longo de sua formacao, redija texto dissertativo-argumentativo em modalidade formal da lingua portuguesa, apresentando proposta de intervencao.
                </p>
              </div>
            </aside>

            <div className="p-5 sm:p-7 2xl:p-8">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-ink-muted">Folha de redacao</p>
                  <p className="mt-1 text-xs text-ink-muted">Introducao, dois desenvolvimentos e conclusao com proposta de intervencao.</p>
                </div>
              <p className={`text-xs font-bold ${wordCount >= 20 ? 'text-success-dark' : 'text-warning-dark'}`}>
                {wordCount} palavras
              </p>
            </div>
            <textarea
              ref={editorRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Comece pela tese: apresente o problema, defenda um ponto de vista e prepare seus argumentos..."
              className="h-[600px] w-full resize-none rounded-xl border border-ink/10 bg-[#fffdf8] px-8 font-serif text-[17px] text-ink outline-none transition-colors placeholder:text-ink-muted/45 focus:border-accent 2xl:h-[640px]"
              style={{
                lineHeight: '32px',
                paddingTop: '6px',
                paddingBottom: '24px',
                backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 31px, rgba(100,116,139,0.28) 31px, rgba(100,116,139,0.28) 32px)',
                backgroundSize: '100% 32px',
                backgroundPosition: '0 0',
              }}
            />

            {error && <p className="mt-4 rounded-xl border border-error/20 bg-error/10 px-4 py-3 text-sm text-error-dark">{error}</p>}

            <button
              onClick={submitCorrection}
              disabled={isSubmitting || !canCorrect}
              className="mt-5 flex w-full items-center justify-center rounded-2xl bg-ink px-6 py-5 text-lg font-black text-white shadow-xl transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isSubmitting
                ? 'Corrigindo sua redacao...'
                : !canCorrect
                  ? 'Escreva pelo menos 20 palavras para corrigir'
                  : user
                    ? 'Receber minha nota agora'
                    : 'Quero descobrir minha nota'}
            </button>
            <p className="mt-3 text-center text-xs text-ink-muted">
              Primeira correcao completa sem cartao. Seu texto fica salvo para acompanhar sua evolucao.
            </p>
            </div>
          </div>
        </section>
      </main>

      <section className="mx-auto max-w-[1760px] border-t border-ink/8 px-8 py-14 2xl:px-12">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ['Pare de treinar no escuro', 'Veja exatamente qual competencia esta puxando sua nota para baixo.'],
            ['Evolucao que aparece', 'Salve suas redacoes e acompanhe media, melhor nota e progresso por competencia.'],
            ['Mais barato que corretor particular', 'Treine com feedback imediato por uma fracao do custo de uma correcao humana.'],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-2xl border border-ink/8 bg-white p-6 shadow-sm">
              <p className="font-bold text-ink">{title}</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-light">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {showAuthModal && (
        <AuthModal
          onClose={() => {
            setShowAuthModal(false)
            setPendingCorrection(false)
          }}
          onAuthenticated={() => {
            setShowAuthModal(false)
            setPendingCorrection(true)
          }}
        />
      )}
    </div>
  )
}
