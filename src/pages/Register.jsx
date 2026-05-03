import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate, Link } from 'react-router-dom'

export default function Register() {
  const { register, loginWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (password.length < 6) { setErro('A senha deve ter pelo menos 6 caracteres.'); return }
    setErro(''); setLoading(true)
    try {
      await register(name, email, password)
      navigate('/editor')
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') setErro('Este e-mail já está cadastrado.')
      else setErro('Erro ao criar conta. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setErro(''); setLoading(true)
    try {
      await loginWithGoogle()
      navigate('/editor')
    } catch {
      setErro('Erro ao entrar com Google.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-10 text-center">
            <div className="inline-flex flex-col leading-none mb-6">
              <span className="font-serif text-5xl font-black text-accent tracking-tight">Mil</span>
              <span className="text-xs font-sans font-medium text-ink-muted tracking-widest uppercase -mt-1">Redação</span>
            </div>
            <h1 className="font-serif text-2xl font-bold text-ink">Crie sua conta</h1>
            <p className="text-ink-muted text-sm mt-2">Comece a corrigir suas redações gratuitamente</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink-light uppercase tracking-widest">Nome</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full bg-white border border-ink/10 rounded px-4 py-3 text-ink text-sm outline-none focus:border-accent transition-colors"
                placeholder="Seu nome"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink-light uppercase tracking-widest">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-white border border-ink/10 rounded px-4 py-3 text-ink text-sm outline-none focus:border-accent transition-colors"
                placeholder="seu@email.com"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink-light uppercase tracking-widest">Senha</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-white border border-ink/10 rounded px-4 py-3 text-ink text-sm outline-none focus:border-accent transition-colors"
                placeholder="Mínimo 6 caracteres"
                required
              />
            </div>

            {erro && (
              <p className="text-sm text-accent bg-accent-light px-4 py-3 rounded border-l-2 border-accent">{erro}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-ink text-white font-medium py-3 rounded hover:bg-accent transition-colors disabled:opacity-50 mt-2"
            >
              {loading ? 'Criando conta...' : 'Criar conta'}
            </button>
          </form>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-ink/10" />
            <span className="text-xs text-ink-muted">ou</span>
            <div className="flex-1 h-px bg-ink/10" />
          </div>

          <button
            onClick={handleGoogle}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 border border-ink/12 rounded py-3 text-sm text-ink-light hover:border-ink/25 hover:text-ink transition-colors disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continuar com Google
          </button>

          <p className="text-center text-sm text-ink-muted mt-6">
            Já tem conta?{' '}
            <Link to="/login" className="text-accent hover:underline font-medium">Entrar</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
