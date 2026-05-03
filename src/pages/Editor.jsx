import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

// Ícones SVG minimalistas
const TimerIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const BookIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
  </svg>
);

const SparklesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275z"/>
  </svg>
);

const apiUrl = import.meta.env.VITE_API_URL
  ? new URL('/api', import.meta.env.VITE_API_URL).toString()
  : 'http://localhost:3001/api';

function userFacingApiError(error) {
  if (error.status === 400) {
    return 'Revise o tema e o texto. Sua redação precisa estar completa para uma correção precisa.'
  }
  if (error.status === 401) {
    return 'Entre novamente na sua conta para continuar.'
  }
  if (error.status === 402) {
    return error.message || 'Seu limite gratuito acabou. Assine o Pro para continuar corrigindo.'
  }
  if (error.status === 429) {
    return 'Você fez muitas tentativas em pouco tempo. Espere um pouco e tente novamente.'
  }
  if (error.status === 503) {
    return 'A correção está temporariamente indisponível. Tente novamente em alguns minutos.'
  }
  if (error.status >= 500) {
    return 'Não conseguimos corrigir sua redação agora. Tente novamente em alguns instantes.'
  }
  if (error instanceof TypeError || error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
    return 'Não conseguimos conectar ao corretor agora. Verifique sua conexão e tente novamente.'
  }
  return 'Não conseguimos concluir a correção agora. Tente novamente em instantes.'
}

export default function Editor() {
  const [content, setContent] = useState('');
  const [tema, setTema] = useState('');
  const [timeLeft, setTimeLeft] = useState(3600); // 1 hora
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [proposta, setProposta] = useState(null); 
  const [isGeneratingTheme, setIsGeneratingTheme] = useState(false);
  const [assuntoBuscado, setAssuntoBuscado] = useState('');
  const [overflowing, setOverflowing] = useState(false);
  const editorRef = useRef(null);

  const navigate = useNavigate();
  const { user } = useAuth();

  const getAuthHeaders = async () => {
    let deviceId = localStorage.getItem('redacao_did');
    if (!deviceId) {
      deviceId = Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem('redacao_did', deviceId);
    }
    const headers = { 'X-Device-Id': deviceId };

    if (!user?.getIdToken) return headers;
    try {
      const token = await user.getIdToken()
      headers.Authorization = `Bearer ${token}`;
      return headers;
    } catch (error) {
      console.error('Falha ao obter token', error)
      return headers;
    }
  }

  // ----- Controle do Cronômetro -----
  useEffect(() => {
    if (timeLeft <= 0) return;
    const intervalId = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(intervalId);
  }, [timeLeft]);

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const wordCount = content.trim().split(/\s+/).filter(word => word.length > 0).length;

  const checkOverflow = () => {
    if (!editorRef.current) return;
    const textarea = editorRef.current;
    setOverflowing(textarea.scrollHeight > textarea.clientHeight);
  };

  useEffect(() => {
    checkOverflow();
  }, [content]);

  useEffect(() => {
    const handleResize = () => checkOverflow();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ----- Gerador de Temas (Agente) -----
  const handleGerarTema = async () => {
    if (!assuntoBuscado.trim()) {
      alert("Por favor, digite um assunto para gerar o tema.");
      return;
    }
    setIsGeneratingTheme(true);
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(await getAuthHeaders()),
      }

      const res = await fetch(`${apiUrl}/gerar-tema`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ assunto: assuntoBuscado }),
      });
      if (!res.ok) {
        const text = await res.text();
        let message = `Erro ${res.status}`;
        try {
          const parsed = JSON.parse(text);
          message = parsed.error || parsed.message || message;
        } catch {
          if (text) message = text;
        }
        const apiError = new Error(message);
        apiError.status = res.status;
        throw apiError;
      }
      const data = await res.json();
      
      const resultado = data.resultado;
      setTema(resultado.tema || '');
      setProposta(resultado);
      setAssuntoBuscado(''); // limpa o input após gerar
    } catch (error) {
      console.error(error);
      alert(userFacingApiError(error));
    } finally {
      setIsGeneratingTheme(false);
    }
  };

  // ----- Submissão ao Subagente (Cloud Run) -----
  const handleSubmit = async () => {
    if (!tema.trim()) {
      alert("Por favor, preencha o tema da redação.");
      return;
    }
    
    if (wordCount < 20) {
      alert("A redação está muito curta. Tente escrever um pouco mais!");
      return;
    }

    if (overflowing) {
      alert('A redação ultrapassou a área das linhas visíveis. Ajuste o texto para ficar dentro das linhas.');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(await getAuthHeaders()),
      }

      const res = await fetch(`${apiUrl}/corrigir`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tema, redacao: content }),
      });
      
      if (!res.ok) {
        const text = await res.text();
        let message = `Erro ${res.status}`;
        try {
          const parsed = JSON.parse(text);
          message = parsed.error || parsed.message || message;
        } catch {
          if (text) message = text;
        }
        const apiError = new Error(message);
        apiError.status = res.status;
        throw apiError;
      }
      const data = await res.json();
      
      const resultadoNota = data.resultado;
      const resultadoPayload = { resultado: resultadoNota, tema, textoOriginal: content };
      window.sessionStorage.setItem('redacaoMilResultado', JSON.stringify(resultadoPayload));

      // ----- GRAVAR NO HISTÓRICO (FIRESTORE) -----
      if (user && user.uid) {
        try {
          await addDoc(collection(db, 'redacoes'), {
            userId: user.uid,
            userName: user.displayName || user.email || 'Aluno RedacaoMil',
            userEmail: user.email || '',
            tema: tema,
            textoOriginal: content,
            notaTotal: resultadoNota.nota_final || resultadoNota.nota_final_estimada || 0,
            competencias: resultadoNota.competencias || {},
            heatmap: resultadoNota.heatmap || [],
            paragrafoFeedback: resultadoNota.paragrafo_feedback || [],
            mensagensAgentes: resultadoNota.mensagens_agentes || {},
            resultadoCompleto: resultadoNota,
            createdAt: serverTimestamp()
          });
        } catch (dbError) {
          console.error("Erro ao salvar histórico da redação: ", dbError);
          // Falhar em salvar o histórico não deve impedir o aluno de ver a nota
        }
      }

      navigate('/resultado', { state: resultadoPayload });
    } catch (error) {
      console.error("Erro na correção", error);
      alert(userFacingApiError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 text-gray-800 font-sans overflow-hidden">
      
      {/* SIDEBAR - TEXTOS DE APOIO E TEMA */}
      <aside className="w-80 lg:w-96 bg-white border-r border-gray-200 p-6 flex flex-col overflow-y-auto">
        <button 
          onClick={() => navigate('/')} 
          className="text-sm text-gray-500 mb-6 hover:text-gray-800 flex items-center gap-1 w-fit"
        >
          ← Voltar ao início
        </button>

        <h2 className="text-lg font-bold flex items-center gap-2 mb-4 text-indigo-900 border-b pb-2">
          <BookIcon /> O que vamos escrever?
        </h2>
        
        <div className="space-y-6">
          <div className="flex flex-col gap-3 relative">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest flex items-center justify-between">
              <span>Tema da Redação</span>
            </label>
            
            {/* AGENTE DE TEMAS */}
            {!proposta && (
              <div className="bg-indigo-50/80 p-3 rounded-lg border border-indigo-100 flex flex-col gap-2">
                <p className="text-xs text-indigo-900 font-medium flex items-center gap-1">
                  <SparklesIcon /> Agente ENEM: Criar Proposta Mágica
                </p>
                <p className="text-[11px] text-indigo-800/80 leading-tight">
                  Tire uma ideia do papel com textos motivadores sobre qualquer assunto, e use dados reais da web.
                </p>
                <div className="flex gap-2 mt-1">
                  <input
                    type="text"
                    value={assuntoBuscado}
                    onChange={(e) => setAssuntoBuscado(e.target.value)}
                    placeholder="Ex: Inteligência Artificial"
                    className="flex-1 text-xs border border-indigo-200 bg-white rounded px-2 py-1 outline-none shadow-sm focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                    disabled={isGeneratingTheme}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleGerarTema(); }}
                  />
                  <button 
                    onClick={handleGerarTema}
                    disabled={isGeneratingTheme}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1 font-bold rounded flex items-center gap-1 disabled:opacity-50 transition-colors shadow-sm"
                  >
                    {isGeneratingTheme ? '🚀 Gerando...' : 'Gerar'}
                  </button>
                </div>
              </div>
            )}

            <input
              type="text"
              value={tema}
              onChange={(e) => setTema(e.target.value)}
              placeholder="Digite o tema ou gere um acima..."
              className="w-full bg-gray-50 border border-gray-200 rounded px-3 py-2 text-sm text-gray-800 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 transition-colors"
            />
          </div>

          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/80 p-4 text-sm text-indigo-900 space-y-3">
            <p className="font-semibold">Agentes de IA ativos</p>
            <ul className="list-disc list-inside space-y-1 text-xs text-indigo-800/90">
              <li><strong>Corretor</strong>: converte desempenho ENEM em nota de 0 a 1000.</li>
              <li><strong>Professor</strong>: explica erros e mostra como melhorar parágrafo a parágrafo.</li>
              <li><strong>Motivador</strong>: entrega mensagem personalizada para manter seu ritmo.</li>
              <li><strong>Estrategista</strong>: aponta ajuste focado em repertório e intervenção.</li>
            </ul>
          </div>

          {proposta ? (
            <div className="flex flex-col gap-4 fade-in">
              <h3 className="text-xs font-bold text-gray-700 border-b pb-1 uppercase tracking-wider">Textos Motivadores</h3>
              {proposta.textos_motivadores?.map((tm, idx) => (
                <div key={idx} className="bg-yellow-50/50 border text-left border-yellow-200/60 rounded-lg p-3 text-xs text-gray-800 shadow-sm leading-relaxed">
                  <strong className="block text-gray-900 mb-1">{tm.titulo}</strong>
                  <p className="mb-2 opacity-90">{tm.texto}</p>
                  <p className="text-[9px] text-gray-400 mt-2 font-mono break-all line-clamp-1 hover:line-clamp-none">
                    Fonte: <a href={tm.fonte} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">{tm.fonte}</a>
                  </p>
                </div>
              ))}
              
              <h3 className="text-xs font-bold text-gray-700 border-b pb-1 mt-2 uppercase tracking-wider">Instruções</h3>
              <p className="text-[11px] text-gray-600 leading-tight italic">
                {proposta.instrucoes || "A partir da leitura dos textos motivadores e com base nos conhecimentos construídos, redija um texto dissertativo-argumentativo."}
              </p>
              
              <button 
                onClick={() => setProposta(null)} 
                className="text-xs text-red-500 font-medium hover:text-red-700 mt-2 transition-colors self-start pb-4"
              >
                ← Descartar Tema
              </button>
            </div>
          ) : (
            <div className="p-4 bg-indigo-50/50 rounded-xl border border-indigo-100 mb-4 items-center">
              <p className="text-xs text-indigo-800 font-medium leading-relaxed">
                Dica de Ouro: O ENEM avalia 5 competências. Lembre-se de estruturar sua redação em introdução, desenvolvimento (2 parágrafos) e conclusão com a proposta de intervenção completa.
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* ÁREA DE ESCRITA (WORKSPACE) */}
      <main className="flex-1 flex flex-col pt-6 px-4 md:px-10 pb-0 relative">
        
        {/* HEADER: Cronômetro e Palavras */}
        <header className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-4">
            <div className={`px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm border ${timeLeft < 300 ? 'bg-red-50 text-red-600 border-red-200' : 'bg-white text-gray-700 border-gray-200'}`}>
              <TimerIcon /> {formatTime(timeLeft)}
            </div>
            <div className="text-xs text-gray-500 font-medium hidden sm:block">
              Redação Ideal ~ 350-400 palavras. Atual: <span className={wordCount < 100 ? "text-red-500 font-bold" : "text-emerald-600 font-bold"}>{wordCount}</span>
            </div>
          </div>
          <button 
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-indigo-600 hover:bg-indigo-700 transition-colors flex items-center shadow-lg text-white font-medium text-sm py-2 px-6 rounded-full disabled:opacity-50"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Corrigindo...
              </span>
            ) : 'Entregar e Corrigir'}
          </button>
        </header>

        {/* EDITOR (FOLHA DE REDAÇÃO) */}
        <div className="flex-1 bg-white rounded-t-xl shadow-md border border-gray-200 relative overflow-hidden flex flex-col">
          {/* Topo simulando folha */}
          <div className="h-8 bg-gray-50 border-b border-gray-200 w-full flex items-center px-6">
           <span className="text-xs font-mono text-gray-400">Página 1 / Simulador ENEM</span>
          </div>

          <textarea
            ref={editorRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Comece sua dissertação-argumentativa aqui..."
            className="flex-1 w-full px-6 pb-6 resize-none focus:outline-none text-base md:text-lg text-gray-700 break-words bg-white"
            style={{
              paddingTop: 16,
              paddingBottom: 16,
              fontFamily: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
              fontSize: '16px',
              lineHeight: '32px',
              letterSpacing: '0.01em',
              textRendering: 'optimizeLegibility',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
              boxSizing: 'border-box',
              backgroundImage: 'linear-gradient(to bottom, transparent 15px, #cbd5e1 15px, #cbd5e1 17px, transparent 17px)',
              backgroundSize: '100% 32px',
              backgroundPosition: '0 0',
              backgroundRepeat: 'repeat-y',
              overflowY: 'hidden',
            }}
          />
          {overflowing && (
            <p className="text-sm text-red-600 mt-3 px-8">
              Sua redação ultrapassou as linhas visíveis. Ajuste o texto para que tudo caiba na folha.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
