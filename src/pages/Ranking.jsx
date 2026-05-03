import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../firebase'
import { collection, getDocs } from 'firebase/firestore'
import Layout from '../components/Layout'

function buildLeaderboard(redacoes = []) {
  const map = {}

  redacoes.forEach((item) => {
    if (!item.userId) return
    const userId = item.userId
    const score = item.notaTotal ?? item.nota_final ?? item.resultadoCompleto?.nota_final ?? 0
    const userName = item.userName || item.userEmail || item.userDisplayName || 'Estudante'

    if (!map[userId]) {
      map[userId] = {
        userId,
        userName,
        totalScore: 0,
        bestScore: 0,
        count: 0,
        lastSubmission: item.createdAt,
      }
    }

    const profile = map[userId]
    profile.totalScore += score
    profile.bestScore = Math.max(profile.bestScore, score)
    profile.count += 1

    const existingTimestamp = profile.lastSubmission?.toMillis ? profile.lastSubmission.toMillis() : new Date(profile.lastSubmission).getTime()
    const currentTimestamp = item.createdAt?.toMillis ? item.createdAt.toMillis() : new Date(item.createdAt).getTime()
    if (currentTimestamp > existingTimestamp) profile.lastSubmission = item.createdAt
  })

  return Object.values(map)
    .map((item) => ({
      ...item,
      averageScore: Math.round(item.totalScore / item.count),
      lastDate: item.lastSubmission?.toDate ? item.lastSubmission.toDate() : new Date(item.lastSubmission),
    }))
    .sort((a, b) => {
      if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore
      if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore
      return b.count - a.count
    })
}

function expandPercent(rank, total) {
  if (!total) return '0%'
  const value = Math.round((rank / total) * 100)
  return `${Math.min(100, value)}%` 
}

export default function Ranking() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [leaderboard, setLeaderboard] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchAllScores = async () => {
      try {
        const docs = await getDocs(collection(db, 'redacoes'))
        const allRedacoes = docs.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        const board = buildLeaderboard(allRedacoes)
        setLeaderboard(board)
      } catch (error) {
        console.error('Erro ao carregar ranking global', error)
      } finally {
        setLoading(false)
      }
    }

    fetchAllScores()
  }, [])

  const userIndex = leaderboard.findIndex((entry) => entry.userId === user?.uid)
  const userRank = userIndex >= 0 ? userIndex + 1 : null
  const topPercent = userRank ? expandPercent(userRank, leaderboard.length) : null

  return (
    <Layout>
      <div className="mb-10 pb-6 border-b border-ink/8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-serif text-4xl font-bold text-ink leading-tight mb-2">Ranking global</h1>
          <p className="text-sm text-ink-light leading-relaxed max-w-2xl">
            Veja em qual posição você está na comunidade de redações e compare com os estudantes que mais evoluem.
          </p>
        </div>
        <button
          onClick={() => navigate('/dashboard')}
          className="bg-accent text-white px-5 py-3 rounded shadow hover:bg-indigo-700 transition-colors text-sm"
        >
          Voltar ao dashboard
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr] mb-8">
        <div className="bg-white border border-ink/8 rounded-3xl p-6 shadow-sm">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-ink-muted">Classificação global</p>
              <h2 className="text-2xl font-semibold text-ink mt-2">Os estudantes mais consistentes</h2>
            </div>
            {userRank ? (
              <div className="rounded-3xl bg-paper-warm p-4 border border-ink/10">
                <p className="text-xs uppercase tracking-[0.3em] text-ink-muted">Sua posição</p>
                <p className="text-3xl font-serif font-black text-ink">#{userRank}</p>
                <p className="text-xs text-ink-light mt-1">Top {topPercent}</p>
              </div>
            ) : (
              <div className="rounded-3xl bg-paper-warm p-4 border border-ink/10">
                <p className="text-xs uppercase tracking-[0.3em] text-ink-muted">Sem pontuação ainda</p>
                <p className="text-sm text-ink-light mt-2">Escreva sua primeira redação e apareça aqui.</p>
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin w-10 h-10 border-4 border-accent/30 border-t-accent rounded-full" />
            </div>
          ) : (
            <div className="overflow-hidden rounded-3xl border border-ink/10">
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-50 border-b border-gray-100 text-xs uppercase tracking-widest text-gray-500">
                  <tr>
                    <th className="p-4">Rank</th>
                    <th className="p-4">Estudante</th>
                    <th className="p-4 text-right">Média</th>
                    <th className="p-4 text-right hidden md:table-cell">Melhor nota</th>
                    <th className="p-4 text-right hidden lg:table-cell">Redações</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {leaderboard.slice(0, 12).map((item, index) => (
                    <tr key={item.userId} className={`${item.userId === user?.uid ? 'bg-indigo-50/50' : ''}`}>
                      <td className="p-4 font-semibold text-ink">{index + 1}</td>
                      <td className="p-4">
                        <p className="font-medium text-ink">{item.userName}</p>
                        <p className="text-xs text-ink-muted">Última: {item.lastDate.toLocaleDateString('pt-BR')}</p>
                      </td>
                      <td className="p-4 text-right font-semibold text-ink">{item.averageScore}</td>
                      <td className="p-4 text-right hidden md:table-cell text-ink-light">{item.bestScore}</td>
                      <td className="p-4 text-right hidden lg:table-cell text-ink-light">{item.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-white border border-ink/8 rounded-3xl p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.25em] text-ink-muted mb-3">Como a classificação é calculada</p>
            <p className="text-sm text-ink-light leading-relaxed">
              O ranking global considera a média das notas, a consistência de envios e o melhor desempenho acumulado. Cada redação conta como treino e cada ponto é traduzido em progresso real.
            </p>
          </div>

          <div className="bg-paper-warm border border-ink/8 rounded-3xl p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.25em] text-ink-muted mb-3">Dica prática</p>
            <p className="text-sm text-ink-light leading-relaxed">
              Para ganhar posições no ranking, mantenha a rotina de redações semanais e foque em clareza, repertório e intervenção social.</p>
          </div>
        </div>
      </div>
    </Layout>
  )
}
