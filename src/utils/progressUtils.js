export const LEVELS = [
  { min: 0, title: 'Iniciante', description: 'Vamos começar a construir sua rotina de redações.' },
  { min: 450, title: 'Em Formação', description: 'Você já domina o suficiente para evoluir com estratégia.' },
  { min: 650, title: 'Avançado', description: 'Seu desempenho está acima da média ENEM e sua consistência conta.' },
  { min: 800, title: 'Elite', description: 'Você já pisa firme no topo e agora trabalha refinando a nota mil.' },
  { min: 920, title: 'Mil no Radar', description: 'Sua rotina está pronta para chegar às pontuações máximas.' },
]

export function getAverageScore(redacoes = []) {
  if (!redacoes.length) return 0
  const total = redacoes.reduce((acc, item) => acc + (item.notaTotal ?? item.nota_final ?? item.resultadoCompleto?.nota_final ?? 0), 0)
  return Math.round(total / redacoes.length)
}

export function getBestScore(redacoes = []) {
  return redacoes.reduce((best, item) => Math.max(best, item.notaTotal ?? item.nota_final ?? item.resultadoCompleto?.nota_final ?? 0), 0)
}

export function getSortedRedacoes(redacoes = []) {
  return [...redacoes].sort((a, b) => {
    const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0
    const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0
    return bTime - aTime
  })
}

export function getStreakDays(redacoes = []) {
  const sorted = getSortedRedacoes(redacoes)
  if (!sorted.length) return 0

  let streak = 1
  let lastDate = new Date(sorted[0].createdAt?.toMillis ? sorted[0].createdAt.toMillis() : sorted[0].createdAt)
  lastDate.setHours(0, 0, 0, 0)

  for (let i = 1; i < sorted.length; i += 1) {
    const currentDate = new Date(sorted[i].createdAt?.toMillis ? sorted[i].createdAt.toMillis() : sorted[i].createdAt)
    currentDate.setHours(0, 0, 0, 0)
    const diff = (lastDate - currentDate) / (1000 * 60 * 60 * 24)
    if (diff === 1) {
      streak += 1
      lastDate = currentDate
    } else if (diff > 1) {
      break
    }
  }

  return streak
}

export function getCompetencyAverages(redacoes = []) {
  const totals = { competencia_1: 0, competencia_2: 0, competencia_3: 0, competencia_4: 0, competencia_5: 0 }
  let count = 0

  redacoes.forEach((item) => {
    const competencias = item.resultadoCompleto?.competencias || item.competencias || {}
    if (Object.keys(competencias).length) {
      count += 1
      Object.entries(totals).forEach(([key]) => {
        const raw = competencias[key] || competencias[key.replace('competencia_', 'C')] || 0
        const nota = typeof raw === 'number' ? raw : raw?.nota ?? 0
        totals[key] += nota
      })
    }
  })

  if (!count) return totals
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round(value / count)]))
}

export function getCommonIssues(redacoes = []) {
  const tally = {}
  redacoes.forEach((item) => {
    const heat = item.resultadoCompleto?.heatmap || item.heatmap || []
    heat.forEach((issue) => {
      const label = issue.tipo || issue.trecho || 'Erro comum'
      tally[label] = (tally[label] || 0) + 1
    })
  })
  return Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([issue, count]) => ({ issue, count }))
}

export function getCurrentLevel(avgScore = 0) {
  return LEVELS.slice().reverse().find((level) => avgScore >= level.min) || LEVELS[0]
}

export function getNextLevelInfo(avgScore = 0) {
  const current = getCurrentLevel(avgScore)
  const next = LEVELS.find((level) => level.min > current.min)
  if (!next) return { nextTitle: current.title, remaining: 0 }
  return { nextTitle: next.title, remaining: Math.max(0, next.min - avgScore) }
}

export function getLevelProgress(avgScore = 0) {
  const current = getCurrentLevel(avgScore)
  const next = LEVELS.find((level) => level.min > current.min)
  if (!next) return 100
  const distance = next.min - current.min
  return Math.min(100, Math.max(0, Math.round(((avgScore - current.min) / distance) * 100)))
}

export function getProgressTier(avgScore = 0) {
  if (avgScore >= 900) return 'top 10%'
  if (avgScore >= 800) return 'top 20%'
  if (avgScore >= 700) return 'top 35%'
  if (avgScore >= 600) return 'top 50%'
  if (avgScore >= 500) return 'top 70%'
  return 'top 90%'
}

export function getMonthlyTrend(redacoes = []) {
  const byMonth = {}
  redacoes.forEach((item) => {
    const date = item.createdAt?.toMillis ? new Date(item.createdAt.toMillis()) : new Date(item.createdAt)
    if (!date || Number.isNaN(date.getTime())) return
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const score = item.notaTotal ?? item.nota_final ?? item.resultadoCompleto?.nota_final ?? 0
    if (!byMonth[monthKey]) byMonth[monthKey] = { total: 0, count: 0 }
    byMonth[monthKey].total += score
    byMonth[monthKey].count += 1
  })
  return Object.entries(byMonth)
    .map(([month, data]) => ({
      month,
      label: new Date(`${month}-01`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      score: Math.round(data.total / data.count),
    }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

export function buildLeaderboard(redacoes = []) {
  const users = {}

  redacoes.forEach((item) => {
    if (!item.userId) return
    const score = item.notaTotal ?? item.nota_final ?? item.resultadoCompleto?.nota_final ?? 0
    const userId = item.userId
    const userName = item.userName || item.userEmail || item.userDisplayName || 'Estudante'

    if (!users[userId]) {
      users[userId] = {
        userId,
        userName,
        totalScore: 0,
        bestScore: 0,
        count: 0,
        lastSubmission: item.createdAt,
      }
    }

    const profile = users[userId]
    profile.totalScore += score
    profile.bestScore = Math.max(profile.bestScore, score)
    profile.count += 1

    const existingTimestamp = profile.lastSubmission?.toMillis ? profile.lastSubmission.toMillis() : new Date(profile.lastSubmission).getTime()
    const currentTimestamp = item.createdAt?.toMillis ? item.createdAt.toMillis() : new Date(item.createdAt).getTime()
    if (currentTimestamp > existingTimestamp) {
      profile.lastSubmission = item.createdAt
    }
  })

  return Object.values(users)
    .map((item) => ({
      ...item,
      averageScore: item.count ? Math.round(item.totalScore / item.count) : 0,
      lastDate: item.lastSubmission?.toDate ? item.lastSubmission.toDate() : new Date(item.lastSubmission),
    }))
    .sort((a, b) => {
      if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore
      if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore
      return b.count - a.count
    })
}

export function getAchievementList(redacoes = []) {
  const badges = []
  const averageScore = getAverageScore(redacoes)
  const streakDays = getStreakDays(redacoes)
  const scores = redacoes.map((item) => item.notaTotal ?? item.nota_final ?? item.resultadoCompleto?.nota_final ?? 0)

  if (redacoes.length >= 1) {
    badges.push({ title: 'Primeira redação', subtitle: 'Você desbloqueou seu primeiro treino.' })
  }

  if (scores.some((score) => score >= 700)) {
    badges.push({ title: 'Desempenho sólido', subtitle: 'Pelo menos uma redação com nota acima de 700.' })
  }

  if (scores.some((score) => score >= 800)) {
    badges.push({ title: 'Nota acima de 800', subtitle: 'Você já conquistou uma redação muito bem avaliada.' })
  }

  if (scores.some((score) => score >= 900)) {
    badges.push({ title: 'Na faixa dos 900', subtitle: 'Sua redação já entrou na elite ENEM.' })
  }

  if (streakDays >= 3) {
    badges.push({ title: 'Consistência 3 dias', subtitle: 'Você está criando hábito com redações seguidas.' })
  }

  if (streakDays >= 7) {
    badges.push({ title: 'Consistência 7 dias', subtitle: 'Uma semana escrevendo com foco e disciplina.' })
  }

  if (averageScore >= 800) {
    badges.push({ title: 'Rotina avançada', subtitle: 'Sua média já está no nível de alta performance.' })
  }

  if (redacoes.length >= 10) {
    badges.push({ title: 'Treinador constante', subtitle: 'Dez redações concluídas. Você está em ritmo de prova.' })
  }

  const sortedByDate = getSortedRedacoes(redacoes)
  const firstScore = sortedByDate.length ? (sortedByDate[sortedByDate.length - 1].notaTotal ?? sortedByDate[sortedByDate.length - 1].nota_final ?? sortedByDate[sortedByDate.length - 1].resultadoCompleto?.nota_final ?? 0) : 0
  const latestScore = sortedByDate.length ? (sortedByDate[0].notaTotal ?? sortedByDate[0].nota_final ?? sortedByDate[0].resultadoCompleto?.nota_final ?? 0) : 0

  if (sortedByDate.length >= 2 && latestScore - firstScore >= 100) {
    badges.push({ title: 'Evolução em ritmo acelerado', subtitle: 'Você subiu mais de 100 pontos comparando seu primeiro e último treino.' })
  }

  return badges
}
