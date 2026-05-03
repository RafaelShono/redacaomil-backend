import { useLocation, useNavigate } from 'react-router-dom'
import { useMemo, useState, useEffect } from 'react'
import Layout from '../components/Layout'

const SESSION_STORAGE_KEY = 'redacaoMilResultado'

const NOMES = {
  C1: 'Norma culta', C2: 'Tema e repertório', C3: 'Argumentação',
  C4: 'Coesão textual', C5: 'Proposta de intervenção',
  competencia_1: 'Norma culta', competencia_2: 'Tema e repertório',
  competencia_3: 'Argumentação', competencia_4: 'Coesão textual',
  competencia_5: 'Proposta de intervenção',
}

function normalizeKey(key) {
  return key.toUpperCase().replace('COMPETENCIA_', 'C').replace('COMPETÊNCIA_', 'C')
}

function getScoreTone(score = 0) {
  if (score >= 900) {
    return {
      label: 'Elite',
      description: 'Sua redação está no padrão de excelência, com clareza, repertório e coesão alinhados ao ENEM.',
      tone: 'success',
    }
  }
  if (score >= 700) {
    return {
      label: 'Avançado',
      description: 'Você já domina conceitos estratégicos e está próximo do topo. Foque em repertório e intervenção.',
      tone: 'primary',
    }
  }
  if (score >= 500) {
    return {
      label: 'Intermediário',
      description: 'Boa base, mas a redação ainda pode ganhar força em argumentação e transições.',
      tone: 'warning',
    }
  }
  return {
    label: 'Fundamental',
    description: 'Comece a treinar com foco em tema, coesão e intervenção para acelerar sua evolução.',
    tone: 'error',
  }
}

function getSeverityLabel(cor) {
  const value = (cor || '').toLowerCase()
  if (value.includes('red') || value.includes('vermelh')) return 'Grave'
  if (value.includes('yellow') || value.includes('amarel')) return 'Atenção'
  if (value.includes('green') || value.includes('verde')) return 'Aperfeiçoamento'
  if (value.includes('blue') || value.includes('azul')) return 'Sugestão'
  return 'Observação'
}

function getSeverityClasses(cor) {
  const value = (cor || '').toLowerCase()
  if (value.includes('red') || value.includes('vermelh')) return 'border-error/30 bg-error/10 text-error-dark'
  if (value.includes('yellow') || value.includes('amarel')) return 'border-warning/30 bg-warning/10 text-warning-dark'
  if (value.includes('green') || value.includes('verde')) return 'border-success/30 bg-success/10 text-success-dark'
  if (value.includes('blue') || value.includes('azul')) return 'border-info/30 bg-info/10 text-info-dark'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function buildHighlightedSegments(text, heatmap) {
  if (!text || !heatmap.length) return [{ text }]
  const lowerText = text.toLowerCase()
  const matches = heatmap
    .map((item, index) => {
      const trecho = (item.trecho || '').trim()
      const start = trecho ? lowerText.indexOf(trecho.toLowerCase()) : -1
      return { ...item, trecho, index, start, end: start >= 0 ? start + trecho.length : -1 }
    })
    .filter((item) => item.start >= 0)
    .sort((a, b) => a.start - b.start)

  const segments = []
  let cursor = 0

  matches.forEach((match) => {
    if (match.start >= cursor) {
      if (cursor < match.start) {
        segments.push({ text: text.slice(cursor, match.start) })
      }
      segments.push({
        text: text.slice(match.start, match.end),
        highlight: match,
      })
      cursor = match.end
    }
  })

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) })
  }

  return segments.length ? segments : [{ text }]
}

export default function Resultado() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const [savedState, setSavedState] = useState(() => {
    if (state?.resultado) {
      return {
        resultado: state.resultado,
        tema: state.tema,
        textoOriginal: state.textoOriginal,
      }
    }

    if (typeof window !== 'undefined') {
      const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY)
      if (raw) {
        try {
          return JSON.parse(raw)
        } catch {
          window.sessionStorage.removeItem(SESSION_STORAGE_KEY)
        }
      }
    }

    return null
  })

  useEffect(() => {
    if (state?.resultado && !savedState) {
      const payload = {
        resultado: state.resultado,
        tema: state.tema,
        textoOriginal: state.textoOriginal,
      }
      setSavedState(payload)
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload))
    }
  }, [state, savedState])

  useEffect(() => {
    if (savedState?.resultado) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(savedState))
    }
  }, [savedState])

  useEffect(() => {
    if (!savedState) {
      navigate('/', { replace: true })
    }
  }, [savedState, navigate])

  const { resultado, tema, textoOriginal } = savedState || {}
  const notaFinal = resultado?.nota_final ?? resultado?.nota_final_estimada ?? 0
  const feedback = resultado?.comentarios_gerais ?? resultado?.feedback_geral ?? ''
  const heatmap = useMemo(() => resultado?.heatmap || [], [resultado])
  const paragraphs = resultado?.paragrafo_feedback || []
  const agenteMsgs = resultado?.mensagens_agentes || {}
  const sugestoesReescrita = resultado?.sugestoes_reescrita || []
  const textoOriginalFinal = textoOriginal || resultado?.textoOriginal || ''
  const pct = Math.round((notaFinal / 1000) * 100)
  const performance = getScoreTone(notaFinal)
  const [activeHeatmapIndex, setActiveHeatmapIndex] = useState(0)
  const selectedHeatmap = heatmap[activeHeatmapIndex] || null
  const highlightedText = useMemo(
    () => buildHighlightedSegments(textoOriginalFinal, heatmap),
    [textoOriginalFinal, heatmap]
  )

  if (!savedState?.resultado) {
    return null
  }

  if (!resultado.competencias) {
    return (
      <Layout>
        <p className="text-slate-500">Resultado inválido. <button onClick={() => navigate('/')} className="text-primary underline">Voltar</button></p>
      </Layout>
    )
  }

  const competencias = Object.entries(resultado.competencias || {}).map(([key, val]) => {
    const norm = normalizeKey(key)
    const nome = NOMES[norm] ?? NOMES[key] ?? key
    if (typeof val === 'number') return { key: norm, nome, nota: val, justificativa: '' }
    return { key: norm, nome, nota: val.nota, justificativa: val.justificativa }
  })

  const radius = 66
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (pct / 100) * circumference

  return (
    <Layout>
      <div className="mb-8 grid gap-6">
        <div className="rounded-[32px] bg-white border border-slate-200 p-8 shadow-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Resultado AI</p>
              <h1 className="mt-3 font-serif text-5xl font-black text-slate-950">
                {notaFinal}
                <span className="ml-3 text-2xl font-medium text-slate-500">/1000</span>
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-600">{performance.description}</p>
            </div>

            <div className="relative flex items-center justify-center rounded-3xl border border-primary/20 bg-primary/5 px-5 py-4 text-center">
              <svg className="h-40 w-40" viewBox="0 0 180 180">
                <circle cx="90" cy="90" r="66" className="fill-none stroke-slate-200 stroke-[16]" />
                <circle
                  cx="90"
                  cy="90"
                  r="66"
                  className="fill-none stroke-primary stroke-[16] stroke-linecap-round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  transform="rotate(-90 90 90)"
                />
              </svg>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xs uppercase tracking-[0.24em] text-slate-500">Progresso</span>
                <span className="mt-2 text-4xl font-black text-slate-950">{pct}%</span>
                <span className="text-sm text-slate-600">{performance.label}</span>
              </div>
            </div>
          </div>

          <div className="mt-8 space-y-4">
            <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex flex-wrap gap-3">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">C1 a C5</span>
              <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">Feedback técnico</span>
              <span className="rounded-full bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">Erros médios</span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
          <div className="rounded-[32px] bg-slate-50 border border-slate-200 p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Tema da redação</p>
            <p className="mt-3 text-base text-slate-700">{tema}</p>
            <div className="mt-6 grid gap-3">
              <div className="rounded-3xl bg-white border border-slate-200 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Meta do próximo ciclo</p>
                <p className="mt-2 text-sm text-slate-600">Foque em clareza de argumentos, repertório atualizado e intervenção completa.</p>
              </div>
              <div className="rounded-3xl bg-white border border-slate-200 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Insight de conversão</p>
                <p className="mt-2 text-sm text-slate-600">Use as sugestões de reescrita para evoluir rapidamente e aumentar a confiança no seu texto.</p>
              </div>
            </div>
          </div>

          <div className="rounded-[32px] bg-white border border-slate-200 p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Plano inteligente</p>
            <h2 className="mt-4 text-2xl font-semibold text-slate-950">Próximo passo</h2>
            <div className="mt-6 space-y-4">
              <div className="rounded-3xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Aprimore o repertório</p>
                <p className="text-sm text-slate-600 mt-2">Inclua referências contemporâneas e conceitos sociais para aumentar a pontuação em tema e repertório.</p>
              </div>
              <div className="rounded-3xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Fortaleça a coesão</p>
                <p className="text-sm text-slate-600 mt-2">Use conectores claros e mantenha o foco no tema para convencer o leitor e a banca.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-8 rounded-[32px] bg-white border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Competências ENEM</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">Pontuação por domínio</h2>
          </div>
          <span className="text-xs uppercase tracking-[0.22em] text-slate-500">0–200</span>
        </div>

        <div className="space-y-4">
          {competencias.map(({ key, nome, nota, justificativa }) => {
            const barPct = Math.max(0, Math.min(100, Math.round((nota / 200) * 100)))
            const colorClass = key === 'C1' ? 'bg-cyan-500' : key === 'C2' ? 'bg-blue-500' : key === 'C3' ? 'bg-indigo-500' : key === 'C4' ? 'bg-emerald-500' : 'bg-amber-500'
            return (
              <div key={key} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{key} · {nome}</p>
                    {justificativa ? <p className="mt-2 text-sm text-slate-600">{justificativa}</p> : null}
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700 border border-slate-200">{nota}/200</span>
                </div>
                <div className="mt-4 h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${colorClass}`} style={{ width: `${barPct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {feedback && (
        <div className="mb-8 rounded-[32px] border border-accent/20 bg-accent/10 p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.24em] text-accent font-semibold">Comentário geral</p>
          <p className="mt-4 text-sm leading-relaxed text-slate-700">{feedback}</p>
        </div>
      )}

      {(heatmap.length > 0 || paragraphs.length > 0) && (
        <div className="grid gap-4 mb-8 lg:grid-cols-[1.3fr_1fr]">
          <div className="rounded-[32px] bg-white border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Texto anotado</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-950">Clique no trecho para ver a correção</h2>
              </div>
              <span className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{heatmap.length} destaques</span>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 prose prose-slate max-w-none text-sm leading-7 text-slate-700">
              {textoOriginalFinal ? highlightedText.map((segment, index) => (
                segment.highlight ? (
                  <mark
                    key={index}
                    onClick={() => setActiveHeatmapIndex(segment.highlight.index)}
                    className={`cursor-pointer rounded-md px-1 py-0.5 transition ${getSeverityClasses(segment.highlight.cor)} ${segment.highlight.index === activeHeatmapIndex ? 'ring-2 ring-primary/40' : ''}`}
                  >
                    {segment.text}
                  </mark>
                ) : (
                  <span key={index}>{segment.text}</span>
                )
              )) : (
                <p className="text-slate-500">O texto original não está disponível para marcações interativas.</p>
              )}
            </div>

            {selectedHeatmap && (
              <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Destaque selecionado</p>
                <p className="mt-3 text-sm font-semibold text-slate-900">{selectedHeatmap.trecho || 'Trecho não informado'}</p>
                <p className="mt-2 text-sm text-slate-600">{selectedHeatmap.comentario}</p>
                {selectedHeatmap.sugestao && <p className="mt-3 text-sm text-slate-500">Sugestão de reescrita: {selectedHeatmap.sugestao}</p>}
              </div>
            )}
          </div>

          <div className="space-y-4">
            {heatmap.length > 0 && (
              <div className="rounded-[32px] bg-slate-50 border border-slate-200 p-6 shadow-sm">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500 mb-3">Painel de erros</p>
                <div className="space-y-4">
                  {heatmap.map((item, index) => (
                    <button
                      key={`${item.trecho}-${index}`}
                      type="button"
                      onClick={() => setActiveHeatmapIndex(index)}
                      className={`w-full rounded-3xl border p-4 text-left transition ${activeHeatmapIndex === index ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                    >
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <p className="text-sm font-semibold text-slate-900">{item.trecho || 'Trecho destacado'}</p>
                        <span className={`text-[11px] px-2 py-1 rounded-full border ${getSeverityClasses(item.cor)}`}>
                          {getSeverityLabel(item.cor)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 leading-relaxed">{item.comentario}</p>
                      {item.sugestao && <p className="mt-3 text-xs text-slate-500">Reescrever: {item.sugestao}</p>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {paragraphs.length > 0 && (
              <div className="rounded-[32px] bg-white border border-slate-200 p-6 shadow-sm">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500 mb-3">Feedback por parágrafo</p>
                <div className="space-y-4">
                  {paragraphs.map((item, index) => (
                    <div key={`${item.paragrafo}-${index}`} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <p className="text-sm font-semibold text-slate-900">Parágrafo {index + 1}</p>
                        <span className={`text-[11px] px-2 py-1 rounded-full border ${getSeverityClasses(item.cor)}`}>
                          {getSeverityLabel(item.cor)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 leading-relaxed">{item.comentario}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {Object.keys(agenteMsgs).length > 0 && (
        <div className="grid gap-4 mb-8 lg:grid-cols-2">
          {Object.entries(agenteMsgs).map(([key, msg]) => (
            msg ? (
              <div key={key} className="rounded-[32px] bg-white border border-slate-200 p-6 shadow-sm">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{key === 'corretor' ? 'Corretor' : key === 'professor' ? 'Professor' : key === 'motivador' ? 'Motivador' : 'Estrategista'}</p>
                <p className="mt-4 text-sm leading-relaxed text-slate-600">{msg}</p>
              </div>
            ) : null
          ))}
        </div>
      )}

      {sugestoesReescrita.length > 0 && (
        <div className="rounded-[32px] bg-white border border-slate-200 p-6 shadow-sm mb-8">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500 font-semibold mb-4">Sugestões de reescrita</p>
          <div className="space-y-4">
            {sugestoesReescrita.map((item, index) => (
              <div key={`${item.trecho}-${index}`} className="rounded-3xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900 mb-1">{item.trecho || 'Trecho'}</p>
                <p className="text-sm text-slate-600 leading-relaxed">{item.sugestao}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => navigate('/')}
          className="bg-primary text-white font-medium px-6 py-3 rounded-full hover:bg-primary-dark transition-colors shadow-sm"
        >
          Corrigir outra redação
        </button>
        <button
          onClick={() => window.print()}
          className="border border-slate-300 text-slate-700 px-6 py-3 rounded-full hover:border-slate-400 hover:text-slate-900 transition-colors text-sm"
        >
          Imprimir resultado
        </button>
      </div>
    </Layout>
  )
}
