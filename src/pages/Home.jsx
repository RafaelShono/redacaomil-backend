import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Layout from '../components/Layout'
import { useEffect, useState } from 'react'

export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const nome = user?.displayName?.split(' ')[0] || 'você'
  const [showSticky, setShowSticky] = useState(false)

  useEffect(() => {
    const handleScroll = () => setShowSticky(window.scrollY > 420)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const benefits = [
    {
      icon: '⚡',
      title: 'Feedback em 30 segundos',
      desc: 'Chega de esperar semanas. Envie e receba C1–C5 pontuados antes de terminar o café.',
      highlight: 'Treine todo dia. Evolua todo dia.',
      bg: 'bg-amber-50 border-amber-100',
    },
    {
      icon: '🎯',
      title: 'Nota por competência, igual ao INEP',
      desc: 'Cada ponto descontado explicado em português claro — sem comentário vago, sem achismo.',
      highlight: null,
      bg: 'bg-blue-50 border-blue-100',
    },
    {
      icon: '📈',
      title: 'Evolua até 200 pontos em 4 semanas',
      desc: 'Quem corrige 3x por semana identifica o padrão de erro e elimina na prova real.',
      highlight: 'Padrão identificado = ponto recuperado.',
      bg: 'bg-emerald-50 border-emerald-100',
    },
    {
      icon: '💰',
      title: 'Menos que uma correção humana por mês',
      desc: 'Corretor particular: R$15–30 por texto. Aqui você treina sem limite pelo preço de um lanche.',
      highlight: null,
      bg: 'bg-paper-warm border-ink/8',
    },
  ]

  const steps = [
    { num: '1', title: 'Abra o Workspace', desc: 'Tema, textos de apoio e cronômetro regressivo — igual ao dia da prova.' },
    { num: '2', title: 'Escreva e envie', desc: 'Direto na plataforma. Sem upload, sem espera.' },
    { num: '3', title: 'Receba sua nota em 30s', desc: 'C1 a C5 com pontuação, diagnóstico e sugestões práticas.' },
  ]

  const competencies = [
    ['C1', 'Norma culta', 'Gramática, ortografia e pontuação'],
    ['C2', 'Tema', 'Desenvolvimento da proposta'],
    ['C3', 'Argumentação', 'Seleção e organização de ideias'],
    ['C4', 'Coesão', 'Conectivos e progressão textual'],
    ['C5', 'Proposta', 'Intervenção social detalhada'],
  ]

  return (
    <Layout>
      {/* ── STICKY CTA BAR ── */}
      <div
        className={`fixed top-0 left-0 right-0 z-50 bg-ink text-white px-6 py-3 flex items-center justify-between shadow-lg transition-all duration-300 ${
          showSticky ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
        }`}
        style={{ pointerEvents: showSticky ? 'auto' : 'none' }}
      >
        <p className="text-sm font-medium hidden sm:block">
          Descubra exatamente onde sua redação está perdendo pontos.
        </p>
        <button
          onClick={() => navigate('/editor')}
          className="ml-auto bg-white text-ink text-sm font-bold px-5 py-2 rounded hover:bg-gray-100 transition-colors whitespace-nowrap"
        >
          Corrigir agora →
        </button>
      </div>

      {/* ── HERO — acima do fold, foco único ── */}
      <div className="min-h-[88vh] flex flex-col justify-center pb-12 border-b border-ink/8">
        <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-full border border-emerald-200 mb-6 self-start">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Correção em menos de 30 segundos
        </div>

        <p className="text-sm text-ink-muted mb-3">Olá, {nome} 👋</p>

        <h1 className="font-serif text-5xl sm:text-6xl font-bold text-ink leading-[1.1] mb-5 max-w-2xl">
          Sua nota do ENEM está{' '}
          <span className="text-red-600 italic">vazando pontos.</span>
          <br />
          Descubra onde.
        </h1>

        <p className="text-ink-light text-lg leading-relaxed max-w-xl mb-8">
          O RedaçãoMil avalia seu texto pelas mesmas 5 competências do INEP e entrega
          nota + diagnóstico em 30 segundos — para você corrigir o erro antes da prova,
          não depois.
        </p>

        <button
          onClick={() => navigate('/editor')}
          className="self-start bg-ink text-white font-bold text-lg px-10 py-5 rounded-lg hover:bg-accent transition-colors shadow-xl flex items-center gap-3"
        >
          Quero minha nota agora →
        </button>

        <div className="flex items-center gap-3 mt-6">
          <div className="flex">
            {['MF', 'LR', 'CB', 'JP'].map((ini, i) => (
              <div
                key={i}
                className="w-8 h-8 rounded-full bg-paper-warm border-2 border-white flex items-center justify-center text-[10px] font-semibold text-ink-muted -ml-2 first:ml-0 shadow-sm"
              >
                {ini}
              </div>
            ))}
          </div>
          <p className="text-sm text-ink-muted">
            <span className="text-ink font-semibold">+2.400 estudantes</span> já treinam com o RedaçãoMil
          </p>
        </div>

        {/* Scroll cue */}
        <div className="mt-14 flex flex-col items-start gap-1 text-ink-muted text-xs">
          <span>Ver como funciona</span>
          <span className="animate-bounce text-base">↓</span>
        </div>
      </div>

      {/* ── DOR / AGITAÇÃO ── */}
      <div className="py-12 border-b border-ink/8">
        <div className="bg-red-50 border border-red-100 rounded-2xl px-8 py-6">
          <p className="font-serif italic text-red-800 text-lg leading-relaxed mb-4">
            "Mandei minha redação pra professora há 3 semanas. Até hoje não recebi feedback.
            O ENEM é em novembro."
          </p>
          <p className="text-sm text-red-600 font-semibold">
            Sem feedback rápido, você repete o mesmo erro na prova real.
          </p>
        </div>
      </div>

      {/* ── BENEFÍCIOS ── */}
      <div className="py-12 border-b border-ink/8">
        <p className="text-xs font-semibold text-ink-muted uppercase tracking-widest mb-8">
          Por que funciona
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {benefits.map(({ icon, title, desc, highlight, bg }) => (
            <div
              key={title}
              className={`flex gap-4 items-start border rounded-2xl p-6 ${bg}`}
            >
              <div className="text-2xl flex-shrink-0 mt-0.5">{icon}</div>
              <div>
                <p className="text-base font-bold text-ink mb-1">{title}</p>
                <p className="text-sm text-ink-light leading-relaxed">{desc}</p>
                {highlight && (
                  <p className="text-xs text-emerald-600 font-semibold mt-3">→ {highlight}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── COMO FUNCIONA ── */}
      <div className="py-12 border-b border-ink/8">
        <p className="text-xs font-semibold text-ink-muted uppercase tracking-widest mb-8">
          Como funciona
        </p>
        <div className="flex flex-col sm:flex-row gap-6">
          {steps.map(({ num, title, desc }) => (
            <div key={num} className="flex-1 flex sm:flex-col gap-4 items-start py-5 sm:py-0 border-b sm:border-b-0 border-ink/8 last:border-b-0">
              <div className="w-9 h-9 rounded-full bg-ink text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                {num}
              </div>
              <div>
                <p className="text-sm font-bold text-ink mb-1 sm:mt-3">{title}</p>
                <p className="text-xs text-ink-light leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── QUEBRA DE OBJEÇÃO ── */}
      <div className="py-12 border-b border-ink/8">
        <div className="bg-paper-warm border border-ink/8 rounded-2xl px-8 py-7">
          <p className="text-base font-bold text-ink mb-3">
            💬 &ldquo;Mas a IA avalia igual a um corretor humano?&rdquo;
          </p>
          <p className="text-sm text-ink-light leading-relaxed">
            Nossa IA foi treinada com a{' '}
            <span className="font-semibold text-ink">Cartilha Oficial do Participante do INEP</span>{' '}
            — os mesmos critérios que os corretores humanos recebem antes de avaliar sua prova.
            Ela não opina: ela aplica a grade. Transparente, consistente e disponível 24h.
          </p>
        </div>
      </div>

      {/* ── 5 COMPETÊNCIAS ── */}
      <div className="py-12 border-b border-ink/8">
        <p className="text-xs font-semibold text-ink-muted uppercase tracking-widest mb-2">
          O que é avaliado
        </p>
        <p className="text-sm text-ink-muted italic mb-6">
          Em qual dessas você está perdendo mais pontos?
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {competencies.map(([cod, nome, desc]) => (
            <div
              key={cod}
              className="flex flex-col gap-1 p-4 bg-paper-warm border border-ink/8 rounded-xl hover:border-accent/40 transition-colors"
            >
              <span className="font-serif text-xl font-bold text-accent">{cod}</span>
              <span className="text-xs font-bold text-ink">{nome}</span>
              <span className="text-xs text-ink-muted leading-snug">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── CTA FINAL ── */}
      <div className="py-14 text-center">
        <h2 className="font-serif text-3xl sm:text-4xl font-bold text-ink mb-4 leading-tight">
          Você não precisa adivinhar <br className="hidden sm:block" />
          onde está errando.
        </h2>
        <p className="text-ink-light text-base leading-relaxed max-w-md mx-auto mb-8">
          Deixa a IA apontar. Você foca em melhorar. O ENEM chega pra todo mundo —
          a diferença é quanto você vai estar pronto quando ele chegar.
        </p>
        <button
          onClick={() => navigate('/editor')}
          className="bg-ink text-white font-bold text-lg px-12 py-5 rounded-lg hover:bg-accent transition-colors shadow-xl inline-flex items-center gap-3"
        >
          Quero minha nota agora — é grátis →
        </button>
        <p className="text-xs text-ink-muted mt-4">
          Sem cartão de crédito. Primeira correção gratuita.
        </p>
      </div>
    </Layout>
  )
}