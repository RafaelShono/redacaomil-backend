import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function Layout({ children }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen flex flex-col bg-paper">
      <header className="bg-primary text-white shadow-xl">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <button onClick={() => navigate('/')} className="text-left">
              <div className="flex flex-col leading-none">
                <span className="font-serif text-4xl font-black tracking-tight">Mil</span>
                <span className="text-xs font-sans font-medium text-white/75 tracking-widest uppercase -mt-1">Redação</span>
              </div>
            </button>

            {user && (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => navigate('/dashboard')}
                  className="text-xs text-white/90 font-medium hover:text-white transition-colors border border-white/20 hover:border-white/40 hover:bg-white/10 rounded-full px-3 py-2"
                >
                  Painel
                </button>
                <button
                  onClick={() => navigate('/ranking')}
                  className="text-xs text-white/90 font-medium hover:text-white transition-colors border border-white/20 hover:border-white/40 hover:bg-white/10 rounded-full px-3 py-2"
                >
                  Ranking
                </button>
                <span className="text-sm text-white/70 hidden md:inline-block">
                  {user.displayName || user.email}
                </span>
                <button
                  onClick={handleLogout}
                  className="text-xs text-white/75 hover:text-white transition-colors border border-white/20 hover:border-white/40 rounded-full px-3 py-2"
                >
                  Sair
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-12">
        {children}
      </main>

      <footer className="bg-slate-950 py-6 text-center">
        <p className="text-xs text-white/40 tracking-wide">
          RedaçãoMil · Correção automatizada por IA · Experiência otimizada para evolução contínua
        </p>
      </footer>
    </div>
  )
}
