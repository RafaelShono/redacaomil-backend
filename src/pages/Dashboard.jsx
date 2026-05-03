import { useEffect, useState, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import Layout from '../components/Layout';
import {
  getAverageScore,
  getBestScore,
  getSortedRedacoes,
  getStreakDays,
  getCompetencyAverages,
  getCommonIssues,
  getCurrentLevel,
  getNextLevelInfo,
  getLevelProgress,
  getProgressTier,
  getAchievementList,
  getMonthlyTrend,
  buildLeaderboard,
} from '../utils/progressUtils';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

// ─── Constantes ────────────────────────────────────────────────────────────────

const COMPETENCIA_TITULO = {
  competencia_1: 'Norma culta',
  competencia_2: 'Tema e repertório',
  competencia_3: 'Argumentação',
  competencia_4: 'Coesão textual',
  competencia_5: 'Proposta de intervenção',
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extrai a nota final de uma redação independentemente do schema salvo.
 * Centralizado aqui para não repetir a lógica no JSX.
 */
function extrairNota(redacao) {
  return redacao?.notaTotal
    ?? redacao?.nota_final
    ?? redacao?.resultadoCompleto?.nota_final
    ?? 0;
}

function renderBadge(nota) {
  if (nota >= 900) return <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-bold border border-green-200">FEDERAL</span>;
  if (nota >= 700) return <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold border border-blue-200">AVANÇADO</span>;
  if (nota >= 500) return <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-bold border border-yellow-200">INTERMEDIÁRIO</span>;
  return <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded-full text-xs font-bold border border-gray-200">CALOURO</span>;
}

function formatDate(createdAt) {
  if (!createdAt?.toMillis) return 'Recente';
  return new Date(createdAt.toMillis()).toLocaleDateString('pt-BR');
}

// ─── Sub-componentes ───────────────────────────────────────────────────────────

function MetricCard({ label, value, subtitle, children }) {
  return (
    <div className="rounded-3xl bg-white border border-ink/8 px-6 py-6 shadow-sm">
      <p className="text-xs uppercase tracking-[0.25em] text-ink-muted mb-4">{label}</p>
      <p className="font-serif text-5xl font-black text-ink">{value}</p>
      {subtitle && <p className="text-sm text-ink-light mt-2">{subtitle}</p>}
      {children}
    </div>
  );
}

function LeaderboardCard({ leaderboard, currentUserId, averageScore, loading }) {
  const currentRank = currentUserId ? leaderboard.findIndex((item) => item.userId === currentUserId) + 1 : null;
  const currentEntry = currentRank ? leaderboard[currentRank - 1] : null;
  const topEntries = leaderboard.slice(0, 4);

  if (loading) {
    return (
      <div className="bg-white border border-ink/8 rounded-3xl p-5 shadow-sm">
        <p className="text-xs uppercase tracking-[0.22em] text-ink-muted mb-3">Ranking estimado</p>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-20 rounded-2xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-ink/8 rounded-3xl p-5 shadow-sm">
      <p className="text-xs uppercase tracking-[0.22em] text-ink-muted mb-3">Ranking estimado</p>
      {leaderboard.length ? (
        <div className="space-y-3">
          {topEntries.map((item, index) => (
            <div
              key={item.userId}
              className={`flex items-center justify-between rounded-2xl p-4 ${
                item.userId === currentUserId
                  ? 'bg-indigo-50 border border-indigo-100'
                  : 'bg-white border border-ink/10'
              }`}
            >
              <span className="text-sm font-medium text-ink">{index + 1}. {item.userName}</span>
              <div className="text-right">
                <p className="text-sm font-semibold text-ink">{item.averageScore}</p>
                <p className="text-[11px] text-ink-muted">Média de {item.count} redações</p>
              </div>
            </div>
          ))}
          {currentEntry && currentRank > 4 && (
            <div className="flex items-center justify-between rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
              <span className="text-sm font-medium text-ink">{currentRank}. Você</span>
              <div className="text-right">
                <p className="text-sm font-semibold text-ink">{averageScore}</p>
                <p className="text-[11px] text-ink-muted">Sua média real</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-light">Ainda não há ranking global disponível.</p>
      )}
    </div>
  );
}

MetricCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  subtitle: PropTypes.string,
  children: PropTypes.node,
};

LeaderboardCard.propTypes = {
  leaderboard: PropTypes.arrayOf(PropTypes.shape({
    userId: PropTypes.string.isRequired,
    userName: PropTypes.string.isRequired,
    averageScore: PropTypes.number.isRequired,
    count: PropTypes.number.isRequired,
  })).isRequired,
  currentUserId: PropTypes.string,
  averageScore: PropTypes.number.isRequired,
  loading: PropTypes.bool,
};

function SkeletonCard() {
  return (
    <div className="rounded-3xl bg-white border border-ink/8 px-6 py-6 shadow-sm animate-pulse">
      <div className="h-3 bg-gray-100 rounded w-1/3 mb-4" />
      <div className="h-10 bg-gray-100 rounded w-1/2 mb-2" />
      <div className="h-3 bg-gray-100 rounded w-2/3" />
    </div>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [redacoes, setRedacoes] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [erro, setErro]         = useState(null);

  // Busca com ordenação no Firestore (evita sort em memória)
  const fetchHistorico = useCallback(async () => {
    if (!user?.uid) return;
    setErro(null);
    try {
      const q = query(
        collection(db, 'redacoes'),
        where('userId', '==', user.uid)
      );
      const snap = await getDocs(q);
      setRedacoes(
        snap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
      );
    } catch (err) {
      console.error('[Dashboard] Erro ao buscar histórico:', err);
      setErro('Não foi possível carregar seu histórico. Tente recarregar a página.');
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  const fetchLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true);
    try {
      const snap = await getDocs(collection(db, 'redacoes'));
      const allRedacoes = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setLeaderboard(buildLeaderboard(allRedacoes));
    } catch (err) {
      console.error('[Dashboard] Erro ao buscar ranking global:', err);
    } finally {
      setLeaderboardLoading(false);
    }
  }, []);

  useEffect(() => { fetchHistorico(); }, [fetchHistorico]);
  useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);

  // ── Métricas memoizadas ────────────────────────────────────────────────────

  const sorted          = useMemo(() => getSortedRedacoes(redacoes), [redacoes]);
  const averageScore    = useMemo(() => getAverageScore(redacoes), [redacoes]);
  const bestScore       = useMemo(() => getBestScore(redacoes), [redacoes]);
  const streakDays      = useMemo(() => getStreakDays(redacoes), [redacoes]);
  const competencies    = useMemo(() => getCompetencyAverages(redacoes), [redacoes]);
  const progressTier    = useMemo(() => getProgressTier(averageScore), [averageScore]);
  const level           = useMemo(() => getCurrentLevel(averageScore), [averageScore]);
  const nextLevelInfo   = useMemo(() => getNextLevelInfo(averageScore), [averageScore]);
  const levelProgress   = useMemo(() => getLevelProgress(averageScore), [averageScore]);
  const achievements    = useMemo(() => getAchievementList(redacoes), [redacoes]);
  const commonIssues    = useMemo(() => getCommonIssues(redacoes), [redacoes]);
  const monthlyTrend    = useMemo(() => getMonthlyTrend(redacoes), [redacoes]);

  const scoreTrend = useMemo(() =>
    sorted.slice(0, 8).reverse().map(item => ({
      date:  item.createdAt?.toDate?.() ?? new Date(),
      score: extrairNota(item),
    })),
    [sorted]
  );

  const monthlyChartData = useMemo(() => ({
    labels: monthlyTrend.map((item) => item.label),
    datasets: [
      {
        label: 'Média mensal',
        data: monthlyTrend.map((item) => item.score),
        backgroundColor: 'rgba(79, 70, 229, 0.85)',
        borderColor: 'rgba(79, 70, 229, 1)',
        borderWidth: 1,
        borderRadius: 18,
        maxBarThickness: 42,
      },
    ],
  }), [monthlyTrend]);

  const monthlyChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => `${context.parsed.y ?? 0} pts`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#475569' },
      },
      y: {
        beginAtZero: true,
        max: 1000,
        ticks: {
          stepSize: 200,
          color: '#475569',
        },
        grid: { color: 'rgba(148, 163, 184, 0.2)' },
      },
    },
  }), []);

  const scoreTrendChartData = useMemo(() => ({
    labels: scoreTrend.map((item) => item.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })),
    datasets: [
      {
        label: 'Nota',
        data: scoreTrend.map((item) => item.score),
        fill: true,
        backgroundColor: 'rgba(79, 70, 229, 0.16)',
        borderColor: 'rgba(79, 70, 229, 1)',
        tension: 0.35,
        pointBackgroundColor: 'rgba(79, 70, 229, 1)',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 4,
      },
    ],
  }), [scoreTrend]);

  const scoreTrendOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => `${context.parsed.y ?? 0} pts`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#475569' },
      },
      y: {
        beginAtZero: true,
        max: 1000,
        ticks: {
          stepSize: 200,
          color: '#475569',
        },
        grid: { color: 'rgba(148, 163, 184, 0.2)' },
      },
    },
  }), []);

  const aiInsight = useMemo(() => {
    if (!redacoes.length)    return 'Escreva sua primeira redação para ativar insights personalizados da IA.';
    if (averageScore >= 850) return 'Mantenha o repertório crítico e foque em intervenção sofisticada para atingir 950+.';
    if (averageScore >= 700) return 'A IA sugere reforçar a coesão entre parágrafos e conectar melhor seus argumentos ao tema.';
    if (streakDays >= 4)     return 'Sua consistência está criando vantagem: use isso para subir sua nota média ainda mais rápido.';
    return 'Comece com redações mais densas em repertório e proponha intervenções claras para avançar de faixa.';
  }, [redacoes.length, averageScore, streakDays]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Layout>
      {/* Header */}
      <div className="mb-10 pb-6 border-b border-ink/8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-serif text-4xl font-bold text-ink leading-tight mb-2">Seu painel de evolução</h1>
          <p className="text-sm text-ink-light leading-relaxed max-w-2xl">
            O ecossistema ENEM para redações entrega métricas reais, ranking e planos de treino com IA.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <button
            onClick={() => navigate('/editor')}
            className="bg-accent text-white font-medium px-6 py-3 rounded hover:bg-opacity-90 transition-colors shadow flex items-center gap-2"
          >
            + Nova redação
          </button>
          <button
            onClick={() => navigate('/ranking')}
            className="border border-accent text-accent font-medium px-6 py-3 rounded hover:bg-accent hover:text-white transition-colors shadow-sm"
          >
            Ranking global
          </button>
        </div>
      </div>

      {/* Erro de carregamento */}
      {erro && (
        <div className="mb-6 rounded-2xl bg-red-50 border border-red-200 px-5 py-4 text-sm text-red-700 flex items-center justify-between gap-4">
          <span>{erro}</span>
          <button onClick={fetchHistorico} className="text-red-700 font-semibold underline text-xs">Tentar novamente</button>
        </div>
      )}

      {/* Cards de métricas — skeleton enquanto carrega */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-8">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard label="Nota média" value={averageScore} subtitle="Média em tempo real com base no histórico." />
            <MetricCard label="Melhor redação" value={bestScore} subtitle="Sua maior pontuação registrada." />
            <MetricCard label="Nível" value={level.title} subtitle={level.description}>
              <div className="h-2 rounded-full bg-paper-dark mt-4 overflow-hidden">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${levelProgress}%` }} />
              </div>
              <p className="text-xs text-ink-muted mt-2">
                {levelProgress}% até <strong>{nextLevelInfo.nextTitle}</strong>
              </p>
            </MetricCard>
            <MetricCard label="Consistência" value={`${streakDays}d`} subtitle="Dias seguidos com treino de redação." />
          </>
        )}
      </div>

      {/* Gráfico mensal + Insights + Ranking */}
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr] mb-8">
        <div className="bg-white border border-ink/8 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4 mb-6">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-ink-muted">Evolução mensal</p>
              <h2 className="text-2xl font-semibold text-ink mt-2">Tração das últimas semanas</h2>
            </div>
            <span className="text-xs uppercase tracking-[0.22em] text-ink-muted">{progressTier}</span>
          </div>
          <div className="h-52">
            {monthlyTrend.length ? (
              <Bar data={monthlyChartData} options={monthlyChartOptions} />
            ) : (
              <p className="text-sm text-ink-light">Ainda não há dados suficientes para a evolução mensal.</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-paper-warm border border-ink/8 rounded-3xl p-5">
            <p className="text-xs uppercase tracking-[0.22em] text-ink-muted mb-3">Insights IA</p>
            <p className="text-sm text-ink-light leading-relaxed">{aiInsight}</p>
          </div>
          <LeaderboardCard
            leaderboard={leaderboard}
            currentUserId={user?.uid}
            averageScore={averageScore}
            loading={leaderboardLoading}
          />
        </div>
      </div>

      {/* Trajetória de nota */}
      <div className="bg-white border border-ink/8 rounded-3xl p-6 shadow-sm mb-8">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-ink-muted">Trajetória de nota</p>
            <h2 className="text-2xl font-semibold text-ink mt-2">Suas últimas 8 redações</h2>
          </div>
          <span className="text-xs uppercase tracking-[0.22em] text-ink-muted">{progressTier}</span>
        </div>
        <div className="h-44">
          {scoreTrend.length ? (
            <Line data={scoreTrendChartData} options={scoreTrendOptions} />
          ) : (
            <p className="text-sm text-ink-light">Nenhuma redação ainda.</p>
          )}
        </div>
      </div>

      {/* Conquistas */}
      <div className="bg-white border border-ink/8 rounded-3xl p-5 shadow-sm mb-8">
        <p className="text-xs uppercase tracking-[0.22em] text-ink-muted mb-3">Conquistas</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {achievements.length ? achievements.map((badge) => (
            <div key={badge.title} className="rounded-2xl bg-paper-dark p-4">
              <p className="text-sm font-semibold text-ink">{badge.title}</p>
              <p className="text-xs text-ink-muted mt-1">{badge.subtitle}</p>
            </div>
          )) : (
            <p className="text-sm text-ink-light col-span-3">Complete a primeira redação para liberar a primeira conquista.</p>
          )}
        </div>
      </div>

      {/* Competências */}
      <div className="grid gap-4 lg:grid-cols-3 mb-8">
        {Object.entries(competencies).map(([key, value]) => (
          <div key={key} className="bg-white border border-ink/8 rounded-3xl p-5 shadow-sm">
            <p className="text-xs uppercase tracking-[0.22em] text-ink-muted mb-3">{COMPETENCIA_TITULO[key]}</p>
            <p className="text-3xl font-serif font-black text-ink mb-3">{value}</p>
            <div className="h-2 rounded-full bg-paper-dark overflow-hidden">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, (value / 200) * 100))}%` }} />
            </div>
          </div>
        ))}
      </div>

      {/* Erros recorrentes + Plano de treino */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr] mb-8">
        <div className="bg-white border border-ink/8 rounded-3xl p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-ink-muted">Erros recorrentes</p>
              <h2 className="text-2xl font-semibold text-ink mt-2">Tendências de ajuste</h2>
            </div>
            <button onClick={() => navigate('/editor')} className="text-xs text-accent font-semibold hover:text-ink transition-colors">
              Treinar agora
            </button>
          </div>
          {commonIssues.length ? (
            <div className="space-y-3">
              {commonIssues.map((issue) => (
                <div key={issue.issue} className="rounded-2xl border border-ink/10 bg-paper-warm p-4">
                  <p className="text-sm font-semibold text-ink">{issue.issue}</p>
                  <p className="text-xs text-ink-muted mt-1">Encontrado em {issue.count} redações recentes.</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-light">Nenhuma tendência identificada ainda. Faça mais redações para personalizar seu plano.</p>
          )}
        </div>

        <div className="bg-white border border-ink/8 rounded-3xl p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.22em] text-ink-muted mb-3">Plano de treino</p>
          <p className="text-sm text-ink-light leading-relaxed mb-4">
            Concentre-se em clareza, repertório e intervenção. A cada redação, o agente estrategista atualiza sua sugestão.
          </p>
          <div className="space-y-3">
            <div className="rounded-2xl border border-ink/10 bg-paper-warm p-4">
              <p className="font-semibold text-ink">Foco imediato</p>
              <p className="text-xs text-ink-muted mt-1">Pratique a coesão entre parágrafos e evite desvios do tema.</p>
            </div>
            <div className="rounded-2xl border border-ink/10 bg-paper-warm p-4">
              <p className="font-semibold text-ink">Meta semanal</p>
              <p className="text-xs text-ink-muted mt-1">Entregar 3 redações com média acima de 700 para subir de nível.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Histórico de redações */}
      {!loading && (
        sorted.length === 0 ? (
          <div className="bg-paper-warm p-10 rounded-3xl border border-ink/8 text-center">
            <p className="text-xl font-semibold text-ink mb-3">Seu histórico ainda está vazio</p>
            <p className="text-sm text-ink-light mb-5">Comece a treinar hoje e o painel vai se preencher com evolução e ranking.</p>
            <button
              onClick={() => navigate('/editor')}
              className="bg-ink text-white rounded-full px-6 py-3 text-sm font-semibold hover:bg-accent transition-colors"
            >
              Escrever primeira redação
            </button>
          </div>
        ) : (
          <div className="bg-white border border-ink/8 rounded-3xl overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-widest">
                  <th className="p-5 w-2/4">Tema</th>
                  <th className="p-5 text-center">Nota</th>
                  <th className="p-5 text-center hidden md:table-cell">Nível</th>
                  <th className="p-5 text-center">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sorted.map((redacao) => {
                  const nota = extrairNota(redacao);
                  return (
                    <tr key={redacao.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="p-5">
                        <p className="font-medium text-gray-800 line-clamp-2">{redacao.tema}</p>
                        <p className="text-xs text-gray-400 mt-1">{formatDate(redacao.createdAt)}</p>
                      </td>
                      <td className="p-5 text-center">
                        <span className="font-serif text-2xl font-black text-ink">{nota}</span>
                      </td>
                      <td className="p-5 text-center hidden md:table-cell">
                        {renderBadge(nota)}
                      </td>
                      <td className="p-5 text-center">
                        <button
                          onClick={() => navigate('/resultado', {
                            state: { resultado: redacao.resultadoCompleto ?? redacao, tema: redacao.tema }
                          })}
                          className="text-accent text-sm font-medium hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-4 py-2 rounded transition-colors"
                        >
                          Revisar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </Layout>
  );
}