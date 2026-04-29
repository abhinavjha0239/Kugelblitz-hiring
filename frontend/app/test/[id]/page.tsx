'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { testSessionService } from '@/services/test-session.service';
import { submissionsService } from '@/services/submissions.service';
import { useAuth } from '@/hooks/useAuth';
import { Question, Submission, LANGUAGES } from '@/types';
import CodeEditor from '@/components/test/CodeEditor';
import QuestionPanel from '@/components/test/QuestionPanel';
import OutputPanel from '@/components/test/OutputPanel';
import {
  Clock, Send, Play, ChevronLeft, ChevronRight,
  Maximize, Lock, Unlock, CheckCircle,
  ListChecks, Code, AlertTriangle, ArrowRight,
  Shield, Zap, Save, RotateCcw, Keyboard,
} from 'lucide-react';

type Section = 'mcq' | 'coding';
const MAX_TAB_SWITCHES = 3;
const TAB_RETURN_TIMEOUT = 10;

export default function TestPage() {
  const { id: testId } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loadFromStorage } = useAuth();

  const [session, setSession] = useState<any>(null);
  const [test, setTest] = useState<any>(null);
  const [mcqQuestions, setMcqQuestions] = useState<Question[]>([]);
  const [codingQuestions, setCodingQuestions] = useState<Question[]>([]);
  const [activeSection, setActiveSection] = useState<Section>('mcq');
  const [mcqSubmitted, setMcqSubmitted] = useState(false);
  const [codingUnlocked, setCodingUnlocked] = useState(false);
  const [mcqResult, setMcqResult] = useState<any>(null);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [mcqAnswers, setMcqAnswers] = useState<Record<string, string>>({});
  const [code, setCode] = useState<Record<string, string>>({});
  const [langId, setLangId] = useState<Record<string, number>>({});
  const [submissions, setSubmissions] = useState<Record<string, Submission>>({});
  const [output, setOutput] = useState('');
  const [outputTab, setOutputTab] = useState<'output' | 'results'>('output');
  const [customInput, setCustomInput] = useState('');
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [multiPaperEnabled, setMultiPaperEnabled] = useState(false);
  const [paperStatuses, setPaperStatuses] = useState<any[]>([]);
  const [activePaperId, setActivePaperId] = useState<string | null>(null);
  const [paperQuestions, setPaperQuestions] = useState<any[]>([]);
  const [paperAnswers, setPaperAnswers] = useState<Record<string, string>>({});
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const syncRef = useRef<NodeJS.Timeout | null>(null);

  // Fullscreen
  const [fsWarningOpen, setFsWarningOpen] = useState(false);
  const [fsExitCount, setFsExitCount] = useState(0);
  const fsReentryTimer = useRef<NodeJS.Timeout | null>(null);

  // Tab switch proctoring
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [tabAwayOverlay, setTabAwayOverlay] = useState(false);
  const [tabCountdown, setTabCountdown] = useState(TAB_RETURN_TIMEOUT);
  const tabCountdownRef = useRef<NodeJS.Timeout | null>(null);
  const [violationCount, setViolationCount] = useState(0);

  // Auto-save
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const autoSaveRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  const loadPaperStatus = useCallback(async () => {
    const status: any = await testSessionService.getExamStatus(testId);
    setPaperStatuses(status.papers || []);
    setActivePaperId(status.currentPaperId || null);
    return status;
  }, [testId]);

  const startPaperFlow = useCallback(async (paperId: string) => {
    const paperData: any = await testSessionService.startPaper(paperId);
    setPaperQuestions(paperData.questions || []);
    setPaperAnswers(paperData.answers || {});
    setCurrentQIndex(0);
    setActivePaperId(paperId);
  }, []);

  // ─── LOAD SESSION + RESTORE STATE ─────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        await testSessionService.startExam(testId);
        const examStatus: any = await loadPaperStatus();
        if (Array.isArray(examStatus?.papers) && examStatus.papers.length > 0) {
          setMultiPaperEnabled(true);
          const nextPaper = examStatus.papers.find((p: any) => !p.locked && p.status !== 'submitted');
          if (nextPaper?.paperId) {
            await startPaperFlow(nextPaper.paperId);
            if (typeof nextPaper.remainingSeconds === 'number') {
              setRemaining(nextPaper.remainingSeconds);
            }
          }
        }

        await testSessionService.startTest(testId);
        const status: any = await testSessionService.getStatus(testId);
        setSession(status.participation);
        setTest(status.test);
        setMcqQuestions(status.mcqQuestions || []);
        setCodingQuestions(status.codingQuestions || []);
        setMcqSubmitted(status.participation.mcqSubmitted);
        setCodingUnlocked(status.participation.codingUnlocked);
        setActiveSection(status.participation.currentSection || 'mcq');
        setRemaining(status.timer?.remaining || 0);
        setViolationCount(status.participation.violationCount || 0);
        setTabSwitchCount(status.participation.tabSwitchCount || 0);
        if (status.savedAnswers) setMcqAnswers(status.savedAnswers);

        const dc: Record<string, string> = {};
        const dl: Record<string, number> = {};
        (status.codingQuestions || []).forEach((q: Question) => {
          if (q.type === 'coding') {
            const savedCode = typeof window !== 'undefined' ? localStorage.getItem(`code_${testId}_${q.id}`) : null;
            const savedLang = typeof window !== 'undefined' ? localStorage.getItem(`lang_${testId}_${q.id}`) : null;
            dc[q.id] = savedCode || '';
            dl[q.id] = savedLang ? Number(savedLang) : (q.allowedLanguages?.[0] || 71);
          }
        });
        setCode(dc);
        setLangId(dl);
      } catch (err: any) {
        toast.error(err.message || 'Failed to load test');
        router.push('/student');
      } finally { setLoading(false); }
    };
    load();
  }, [testId, router, loadPaperStatus, startPaperFlow]);

  // ─── TIMER ─────────────────────────────────────────────
  useEffect(() => {
    if (loading || !session) return;
    timerRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) { clearInterval(timerRef.current!); handleAutoSubmit(); return 0; }
        return prev - 1;
      });
    }, 1000);
    syncRef.current = setInterval(async () => {
      try { const t = await testSessionService.getTimer(testId); setRemaining(t.remaining); if (t.remaining <= 0) handleAutoSubmit(); } catch {}
    }, 30000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); if (syncRef.current) clearInterval(syncRef.current); };
  }, [loading, session, testId]);

  // ─── FULLSCREEN ────────────────────────────────────────
  useEffect(() => {
    if (loading || !session) return;
    (async () => { try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch {} })();
  }, [loading, session]);

  const forceReenterFullscreen = useCallback(async () => {
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); setFsWarningOpen(false); } catch {}
  }, []);

  const enterFullscreen = useCallback(async () => {
    try { await document.documentElement.requestFullscreen(); setFsWarningOpen(false); } catch {}
  }, []);

  // ─── AUTO-SAVE CODE (every 5s) ────────────────────────
  useEffect(() => {
    if (loading || activeSection !== 'coding') return;
    autoSaveRef.current = setInterval(() => {
      Object.entries(code).forEach(([qId, src]) => {
        if (src && typeof window !== 'undefined') {
          localStorage.setItem(`code_${testId}_${qId}`, src);
          localStorage.setItem(`lang_${testId}_${qId}`, String(langId[qId] || 71));
        }
      });
      setLastSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 5000);
    return () => { if (autoSaveRef.current) clearInterval(autoSaveRef.current); };
  }, [loading, activeSection, code, langId, testId]);

  useEffect(() => {
    if (loading || !multiPaperEnabled || !activePaperId) return;
    const id = setInterval(() => {
      testSessionService.autosavePaperAnswers(activePaperId, paperAnswers).catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, [loading, multiPaperEnabled, activePaperId, paperAnswers]);

  // ─── TAB SWITCH PROCTORING ────────────────────────────
  useEffect(() => {
    if (loading) return;

    const handleVisibility = () => {
      if (document.hidden) {
        testSessionService.logAntiCheat(testId, 'tab_switch').catch(() => {});
        setTabSwitchCount((prev) => {
          const next = prev + 1;
          setViolationCount((v) => v + 1);
          if (next >= MAX_TAB_SWITCHES) {
            handleAutoSubmit();
            return next;
          }
          setTabAwayOverlay(true);
          setTabCountdown(TAB_RETURN_TIMEOUT);
          // Start countdown
          if (tabCountdownRef.current) clearInterval(tabCountdownRef.current);
          tabCountdownRef.current = setInterval(() => {
            setTabCountdown((c) => {
              if (c <= 1) {
                clearInterval(tabCountdownRef.current!);
                handleAutoSubmit();
                return 0;
              }
              return c - 1;
            });
          }, 1000);
          return next;
        });
      } else {
        // User returned
        if (tabCountdownRef.current) clearInterval(tabCountdownRef.current);
        setTabAwayOverlay(false);
        setTabCountdown(TAB_RETURN_TIMEOUT);
      }
    };

    const logClipboard = () => {
      testSessionService.logAntiCheat(testId, 'copy_paste').catch(() => {});
      setViolationCount((v) => v + 1);
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        testSessionService.logAntiCheat(testId, 'fullscreen_exit').catch(() => {});
        setFsExitCount((p) => p + 1);
        setViolationCount((v) => v + 1);
        setFsWarningOpen(true);
        if (fsReentryTimer.current) clearTimeout(fsReentryTimer.current);
        fsReentryTimer.current = setTimeout(forceReenterFullscreen, 500);
      } else { setFsWarningOpen(false); }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
      // Ctrl+Enter = Run, Ctrl+Shift+Enter = Submit
      if (e.ctrlKey && e.key === 'Enter' && !e.shiftKey && activeSection === 'coding') { e.preventDefault(); handleRunCode(); }
      if (e.ctrlKey && e.shiftKey && e.key === 'Enter' && activeSection === 'coding') { e.preventDefault(); handleSubmitCoding(); }
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };

    document.addEventListener('copy', logClipboard);
    document.addEventListener('paste', logClipboard);
    document.addEventListener('cut', logClipboard);
    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('copy', logClipboard);
      document.removeEventListener('paste', logClipboard);
      document.removeEventListener('cut', logClipboard);
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (fsReentryTimer.current) clearTimeout(fsReentryTimer.current);
      if (tabCountdownRef.current) clearInterval(tabCountdownRef.current);
    };
  }, [testId, loading, forceReenterFullscreen, activeSection]);

  // ─── HANDLERS ──────────────────────────────────────────
  const handleAutoSubmit = useCallback(async () => {
    try { await testSessionService.finalSubmit(testId, true); toast.error('Test auto-submitted.'); router.push('/student'); } catch {}
  }, [testId, router]);

  const handleSaveMcq = async (questionId: string, option: string) => {
    setMcqAnswers((prev) => ({ ...prev, [questionId]: option }));
    try { await testSessionService.saveMcqAnswer(testId, questionId, option); } catch (err: any) { toast.error(err.message); }
  };

  const handleSubmitMcq = async () => {
    if (!confirm('Submit MCQ section? You cannot change answers after submission.')) return;
    setSubmitting(true);
    try {
      const result = await testSessionService.submitMcqSection(testId);
      setMcqResult(result); setMcqSubmitted(true); setCodingUnlocked(result.codingUnlocked);
      if (result.codingUnlocked) {
        toast.success(result.message);
        const status: any = await testSessionService.getStatus(testId);
        setCodingQuestions(status.codingQuestions || []);
        const dc: Record<string, string> = {}; const dl: Record<string, number> = {};
        (status.codingQuestions || []).forEach((q: Question) => {
          const saved = typeof window !== 'undefined' ? localStorage.getItem(`code_${testId}_${q.id}`) : null;
          dc[q.id] = saved || ''; dl[q.id] = q.allowedLanguages?.[0] || 71;
        });
        setCode(dc); setLangId(dl);
      } else { toast.error(result.message); }
    } catch (err: any) { toast.error(err.message); } finally { setSubmitting(false); }
  };

  const handleSwitchToCoding = () => {
    if (!codingUnlocked) { toast.error('Complete MCQ section first'); return; }
    setActiveSection('coding'); setCurrentQIndex(0); setOutput('');
  };

  const formatJ0Error = (result: any): string => {
    if (!result) return 'Unknown error';
    const sid = result.status?.id;
    if (sid === 6) return `Compilation Error:\n${result.compile_output || 'Check your syntax'}`;
    if (sid === 7 || sid === 8 || sid === 9 || sid === 10 || sid === 11 || sid === 12) return `Runtime Error:\n${result.stderr || result.message || 'Your program crashed'}`;
    if (sid === 5) return 'Time Limit Exceeded — your solution is too slow.';
    if (sid === 13) return `Execution Error:\n${result.message || 'Internal error — try again'}`;
    let out = '';
    if (result.compile_output) out += `Compilation:\n${result.compile_output}\n\n`;
    if (result.stdout) out += `Output:\n${result.stdout}`;
    if (result.stderr) out += `\nErrors:\n${result.stderr}`;
    if (!out.trim()) out = `Status: ${result.status?.description || 'Unknown'}`;
    return out;
  };

  const handleRunCode = async () => {
    const q = codingQuestions[currentQIndex]; if (!q || running) return;
    setRunning(true); setOutputTab('output'); setOutput('Running...');
    try {
      const result = await submissionsService.runCode({ languageId: langId[q.id], sourceCode: code[q.id] || '', stdin: customInput });
      if (result.status?.id === 3) {
        setOutput(`Output:\n${result.stdout || '(no output)'}\n\nTime: ${result.time || '0'}s | Memory: ${result.memory || 0}KB`);
      } else {
        setOutput(formatJ0Error(result) + `\n\nTime: ${result.time || '0'}s | Memory: ${result.memory || 0}KB`);
      }
    } catch (err: any) { setOutput(`Error: ${err.message}`); } finally { setRunning(false); }
  };

  const handleSubmitCoding = async () => {
    const q = codingQuestions[currentQIndex]; if (!q || submitting) return;
    setSubmitting(true);
    try {
      const sub = await testSessionService.submitCoding({ testId, questionId: q.id, languageId: langId[q.id], sourceCode: code[q.id] || '' });
      setSubmissions((p) => ({ ...p, [q.id]: sub }));
      toast.success('Evaluating...'); setOutputTab('results'); setOutput('Evaluating against test cases...');
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const updated = await submissionsService.getById(sub.id);
          if (updated.status === 'completed' || updated.status === 'failed') {
            clearInterval(poll); setSubmissions((p) => ({ ...p, [q.id]: updated }));
            if (updated.result?.testCaseResults) {
              const r = updated.result;
              let out = `Score: ${updated.score}/${q.marks}\nPassed: ${r.passedCount}/${r.totalCount}\n\n`;
              r.testCaseResults.forEach((tc: any, i: number) => {
                const icon = tc.passed ? '✓' : '✗';
                out += `${icon} ${tc.isHidden ? 'Hidden ' : ''}Case ${i + 1}: ${tc.passed ? 'PASSED' : 'FAILED'}`;
                if (!tc.passed) out += ` (${tc.status})`;
                if (tc.stdout && !tc.isHidden) out += `\n  Output: ${tc.stdout.trim()}`;
                out += '\n';
              });
              if (updated.executionTime) out += `\nTime: ${updated.executionTime}s`;
              if (updated.memoryUsed) out += ` | Memory: ${updated.memoryUsed}KB`;
              setOutput(out);
            } else { setOutput(`Status: ${updated.status}`); }
          }
        } catch {}
        if (attempts > 30) clearInterval(poll);
      }, 2000);
    } catch (err: any) { toast.error(err.message); } finally { setSubmitting(false); }
  };

  const handleResetCode = () => {
    const q = codingQuestions[currentQIndex]; if (!q) return;
    if (!confirm('Reset code to empty? This cannot be undone.')) return;
    setCode((p) => ({ ...p, [q.id]: '' }));
    if (typeof window !== 'undefined') localStorage.removeItem(`code_${testId}_${q.id}`);
  };

  const handleFinalSubmit = async () => {
    if (!confirm('Submit the entire test? This cannot be undone.')) return;
    try { await testSessionService.finalSubmit(testId, false); toast.success('Test submitted!'); router.push('/student'); } catch (err: any) { toast.error(err.message); }
  };

  const handleSavePaperAnswer = async (questionId: string, optionId: string) => {
    setPaperAnswers((prev) => ({ ...prev, [questionId]: optionId }));
  };

  const handleSubmitPaper = async () => {
    if (!activePaperId) return;
    if (!confirm('Submit this paper? You cannot change answers after submission.')) return;
    try {
      const res: any = await testSessionService.submitPaper(activePaperId, paperAnswers);
      toast.success(`Paper submitted. Score: ${res.score ?? 0}`);
      const latest = await loadPaperStatus();
      const next = latest.papers?.find((p: any) => !p.locked && p.status !== 'submitted');
      if (next?.paperId) {
        await startPaperFlow(next.paperId);
      } else if (latest.participation?.status === 'submitted') {
        toast.success('Exam completed!');
        router.push('/student');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit paper');
    }
  };

  // ─── DERIVED ───────────────────────────────────────────
  const timerMinutes = Math.floor(remaining / 60);
  const timerSeconds = remaining % 60;
  const timerFormatted = `${String(timerMinutes).padStart(2, '0')}:${String(timerSeconds).padStart(2, '0')}`;
  const isLow = remaining < 300;
  const isCritical = remaining < 60;
  const currentQuestions = activeSection === 'mcq' ? mcqQuestions : codingQuestions;
  const currentQuestion = currentQuestions[currentQIndex];
  const answeredCount = Object.keys(mcqAnswers).length;

  // ─── LOADING ───────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a0e1a] via-[#111827] to-[#0f172a] bg-grid flex items-center justify-center">
        <div className="animate-fade-in flex flex-col items-center gap-6">
          <div className="relative">
            <div className="w-16 h-16 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          </div>
          <div className="text-center">
            <p className="text-slate-300 font-medium">Preparing your assessment</p>
            <p className="text-slate-500 text-sm mt-1">Setting up secure environment...</p>
          </div>
        </div>
      </div>
    );
  }

  if (multiPaperEnabled) {
    const currentPaper = paperStatuses.find((p) => p.paperId === activePaperId) || null;
    const currentPaperQuestion = paperQuestions[currentQIndex];
    return (
      <div className="h-screen flex flex-col bg-gradient-to-br from-[#0a0e1a] via-[#111827] to-[#0f172a] bg-grid overflow-hidden">
        <header className="h-14 glass-strong border-b border-slate-700/30 flex items-center px-5 justify-between shrink-0 z-50">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-slate-200">{test?.title || 'Exam'}</h1>
            <span className="text-xs text-blue-400">{currentPaper?.name || 'Paper'}</span>
          </div>
          <div className="font-mono text-sm text-blue-300">{timerFormatted}</div>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-72 border-r border-slate-700/30 p-4 overflow-y-auto">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Papers</p>
            <div className="space-y-2 mb-6">
              {paperStatuses.map((p) => (
                <button
                  key={p.paperId}
                  onClick={() => !p.locked && p.status !== 'submitted' && startPaperFlow(p.paperId)}
                  disabled={p.locked}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                    p.paperId === activePaperId ? 'bg-blue-600/20 text-blue-300' : p.locked ? 'bg-slate-900/50 text-slate-600' : 'bg-slate-800/40 text-slate-300'
                  }`}
                >
                  {p.name} - {p.locked ? 'Locked' : p.status}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Questions</p>
            <div className="grid grid-cols-5 gap-2">
              {paperQuestions.map((q, idx) => (
                <button
                  key={q.id}
                  onClick={() => setCurrentQIndex(idx)}
                  className={`h-8 rounded text-xs ${idx === currentQIndex ? 'bg-blue-600 text-white' : paperAnswers[q.id] ? 'bg-emerald-700/30 text-emerald-300' : 'bg-slate-800/40 text-slate-400'}`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
          </aside>
          <main className="flex-1 p-8 overflow-y-auto">
            {currentPaperQuestion ? (
              <div className="max-w-3xl">
                <h2 className="text-white text-xl font-semibold mb-2">{currentPaperQuestion.title}</h2>
                <p className="text-slate-400 mb-6">{currentPaperQuestion.description}</p>
                <div className="space-y-3">
                  {(currentPaperQuestion.mcqOptions || []).map((opt: any) => (
                    <button
                      key={opt.id}
                      onClick={() => handleSavePaperAnswer(currentPaperQuestion.id, opt.id)}
                      className={`w-full text-left px-4 py-3 rounded-xl border ${
                        paperAnswers[currentPaperQuestion.id] === opt.id
                          ? 'bg-blue-600/20 border-blue-500 text-white'
                          : 'bg-slate-800/30 border-slate-700 text-slate-300'
                      }`}
                    >
                      {opt.text}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-8">
                  <button className="btn-secondary" onClick={() => setCurrentQIndex((v) => Math.max(0, v - 1))}>
                    Previous
                  </button>
                  <button className="btn-secondary" onClick={() => setCurrentQIndex((v) => Math.min(paperQuestions.length - 1, v + 1))}>
                    Next
                  </button>
                </div>
                <div className="mt-8">
                  <button className="btn-primary" onClick={handleSubmitPaper}>Submit Paper</button>
                </div>
              </div>
            ) : (
              <p className="text-slate-500">No unlocked paper available.</p>
            )}
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-[#0a0e1a] via-[#111827] to-[#0f172a] bg-grid overflow-hidden">

      {/* ═══ TAB AWAY OVERLAY (countdown) ══════════════════ */}
      {tabAwayOverlay && (
        <div className="fixed inset-0 z-[10000] bg-black/90 backdrop-blur-md flex items-center justify-center animate-fade-in">
          <div className="text-center max-w-md mx-4">
            <div className="w-24 h-24 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border-2 border-red-500/30">
              <span className="text-4xl font-bold text-red-400 font-mono">{tabCountdown}</span>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">You left the test!</h2>
            <p className="text-slate-400 mb-2">Return within {tabCountdown} seconds or your test will be auto-submitted.</p>
            <p className="text-red-400 text-sm font-medium">
              Tab switches: {tabSwitchCount}/{MAX_TAB_SWITCHES} (auto-submit at {MAX_TAB_SWITCHES})
            </p>
          </div>
        </div>
      )}

      {/* ═══ FULLSCREEN WARNING ════════════════════════════ */}
      {fsWarningOpen && !tabAwayOverlay && (
        <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md flex items-center justify-center animate-fade-in">
          <div className="glass-strong rounded-3xl p-8 max-w-md w-full mx-4 shadow-2xl text-center">
            <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-red-500/20">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Fullscreen Required</h2>
            <p className="text-slate-400 text-sm mb-6">Exits: {fsExitCount}. Please remain in fullscreen.</p>
            <button onClick={enterFullscreen} className="w-full py-3 rounded-xl font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-all flex items-center justify-center gap-2">
              <Maximize className="w-5 h-5" /> Re-enter Fullscreen
            </button>
          </div>
        </div>
      )}

      {/* ═══ TOP HEADER ════════════════════════════════════ */}
      <header className="h-14 glass-strong border-b border-slate-700/30 flex items-center px-5 justify-between shrink-0 z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center">
              <span className="text-xs font-bold text-white">G</span>
            </div>
            <h1 className="text-sm font-semibold text-slate-200 truncate max-w-[160px] hidden sm:block">{test?.title}</h1>
          </div>
          <div className="flex items-center gap-0.5 bg-slate-800/50 rounded-xl p-1 border border-slate-700/30">
            <button onClick={() => { setActiveSection('mcq'); setCurrentQIndex(0); }}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${activeSection === 'mcq' ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : mcqSubmitted ? 'text-emerald-400' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
              <ListChecks className="w-3.5 h-3.5" /> MCQ {mcqSubmitted && <CheckCircle className="w-3 h-3" />}
            </button>
            <button onClick={handleSwitchToCoding} disabled={!codingUnlocked}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${activeSection === 'coding' ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : codingUnlocked ? 'text-slate-400 hover:text-white hover:bg-slate-700/50' : 'text-slate-600 cursor-not-allowed'}`}>
              {codingUnlocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />} Coding
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Question pills */}
          <div className="hidden lg:flex gap-1">
            {currentQuestions.map((_, i) => {
              const q = currentQuestions[i];
              const isAnswered = activeSection === 'mcq' ? !!mcqAnswers[q.id] : !!submissions[q.id];
              return (
                <button key={i} onClick={() => setCurrentQIndex(i)}
                  className={`w-7 h-7 rounded-lg text-[11px] font-medium transition-all duration-200 ${
                    i === currentQIndex ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25 scale-110' :
                    isAnswered ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' :
                    'bg-slate-800/50 text-slate-500 hover:bg-slate-700/50 border border-slate-700/30'
                  }`}>{i + 1}</button>
              );
            })}
          </div>

          {/* Violation indicator */}
          {violationCount > 0 && (
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border ${
              violationCount >= 5 ? 'bg-red-500/10 text-red-400 border-red-500/20' :
              violationCount >= 2 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
              'bg-slate-800/50 text-slate-400 border-slate-700/30'
            }`}>
              <Shield className="w-3 h-3" /> {violationCount}
            </div>
          )}

          {/* Timer */}
          <div className={`flex items-center gap-2 px-4 py-1.5 rounded-xl font-mono text-sm font-bold border ${
            isCritical ? 'bg-red-500/10 text-red-400 border-red-500/20 timer-critical' :
            isLow ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 timer-warn' :
            'bg-blue-500/10 text-blue-400 border-blue-500/20 timer-glow'
          }`}>
            <Clock className="w-4 h-4" />{timerFormatted}
          </div>

          <button onClick={handleFinalSubmit} className="bg-red-600/80 hover:bg-red-500 text-white text-sm py-1.5 px-4 rounded-xl font-medium flex items-center gap-1.5 transition-all hover:shadow-lg hover:shadow-red-500/20">
            <Send className="w-3.5 h-3.5" /> Finish
          </button>
        </div>
      </header>

      {/* ═══ MAIN CONTENT ══════════════════════════════════ */}
      <div className="flex-1 flex overflow-hidden animate-fade-in">

        {/* ─── MCQ SECTION ─────────────────────────────── */}
        {activeSection === 'mcq' && (
          <div className="flex-1 flex">
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-8">
                <div className="max-w-3xl mx-auto">
                  {currentQuestion ? (
                    <div className="animate-fade-in" key={currentQuestion.id}>
                      <div className="flex items-center gap-3 mb-6">
                        <span className="text-xs font-mono bg-slate-800/60 text-slate-400 px-3 py-1.5 rounded-lg border border-slate-700/30">Q{currentQIndex + 1}/{mcqQuestions.length}</span>
                        <span className="text-xs bg-blue-500/10 text-blue-400 px-3 py-1.5 rounded-lg border border-blue-500/15 font-medium">{currentQuestion.marks} marks</span>
                      </div>
                      <h2 className="text-2xl font-bold text-white mb-3 leading-tight">{currentQuestion.title}</h2>
                      <div className="mb-8">
                        {currentQuestion.description.split('\n').map((line, i) => (
                          <p key={i} className="text-slate-400 leading-relaxed my-0.5 text-[15px]">{line || <br />}</p>
                        ))}
                      </div>
                      {currentQuestion.mcqOptions && (
                        <div className="space-y-3">
                          {currentQuestion.mcqOptions.map((opt, idx) => {
                            const isSelected = mcqAnswers[currentQuestion.id] === opt.id;
                            return (
                              <div key={opt.id} onClick={() => !mcqSubmitted && handleSaveMcq(currentQuestion.id, opt.id)}
                                className={`group flex items-center gap-4 p-5 rounded-2xl cursor-pointer transition-all duration-300 border ${isSelected ? 'bg-blue-500/10 border-blue-500/30 shadow-lg shadow-blue-500/5' : 'bg-slate-800/30 border-slate-700/20 hover:bg-slate-800/50 hover:border-slate-600/40'} ${mcqSubmitted ? 'pointer-events-none opacity-60' : ''}`}>
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 transition-all ${isSelected ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30' : 'bg-slate-700/50 text-slate-400 group-hover:bg-slate-600/50 border border-slate-600/30'}`}>
                                  {String.fromCharCode(65 + idx)}
                                </div>
                                <span className={`text-base transition-colors ${isSelected ? 'text-white font-medium' : 'text-slate-300 group-hover:text-white'}`}>{opt.text}</span>
                                {isSelected && <CheckCircle className="w-5 h-5 text-blue-400 ml-auto" />}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : <div className="text-slate-500 text-center py-20">No questions available</div>}
                </div>
              </div>
              <div className="p-4 glass-strong border-t border-slate-700/20 flex items-center justify-between">
                <div className="flex gap-2">
                  <button onClick={() => setCurrentQIndex(Math.max(0, currentQIndex - 1))} disabled={currentQIndex === 0} className="btn-secondary text-sm py-2 flex items-center gap-1.5"><ChevronLeft className="w-4 h-4" /> Previous</button>
                  <button onClick={() => setCurrentQIndex(Math.min(mcqQuestions.length - 1, currentQIndex + 1))} disabled={currentQIndex === mcqQuestions.length - 1} className="btn-secondary text-sm py-2 flex items-center gap-1.5">Next <ChevronRight className="w-4 h-4" /></button>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-slate-500">{answeredCount}/{mcqQuestions.length} answered</span>
                  {!mcqSubmitted ? (
                    <button onClick={handleSubmitMcq} disabled={submitting} className="bg-blue-600 hover:bg-blue-500 text-white text-sm py-2 px-5 rounded-xl font-medium flex items-center gap-2 transition-all disabled:opacity-50">
                      <Send className="w-4 h-4" /> {submitting ? 'Submitting...' : 'Submit MCQ'}
                    </button>
                  ) : codingUnlocked ? (
                    <button onClick={handleSwitchToCoding} className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm py-2 px-5 rounded-xl font-medium flex items-center gap-2 transition-all">
                      <ArrowRight className="w-4 h-4" /> Go to Coding
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            {/* Right sidebar */}
            <div className="w-60 glass border-l border-slate-700/20 flex flex-col shrink-0">
              <div className="p-4 border-b border-slate-700/20">
                <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Questions</h3>
                <div className="grid grid-cols-5 gap-2">
                  {mcqQuestions.map((q, i) => (
                    <button key={q.id} onClick={() => setCurrentQIndex(i)}
                      className={`w-9 h-9 rounded-xl text-xs font-medium transition-all ${i === currentQIndex ? 'bg-blue-600 text-white shadow-md scale-105' : mcqAnswers[q.id] ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800/40 text-slate-500 border border-slate-700/30'}`}>{i + 1}</button>
                  ))}
                </div>
              </div>
              {mcqResult && (
                <div className="p-4 border-t border-slate-700/20">
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500">Score</span><span className="font-bold text-blue-400">{mcqResult.mcqScore}/{mcqResult.totalMcqMarks}</span></div>
                    <div className={`p-2.5 rounded-xl text-center font-semibold ${mcqResult.cutoffMet ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                      {mcqResult.cutoffMet ? 'Cutoff Cleared' : 'Below Cutoff'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── CODING SECTION ──────────────────────────── */}
        {activeSection === 'coding' && codingUnlocked && (
          <>
            <div className="w-[400px] glass border-r border-slate-700/20 flex flex-col shrink-0">
              {currentQuestion && <QuestionPanel question={currentQuestion} />}
              <div className="p-3 border-t border-slate-700/20 flex justify-between">
                <button onClick={() => setCurrentQIndex(Math.max(0, currentQIndex - 1))} disabled={currentQIndex === 0} className="btn-secondary text-sm py-1.5 flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> Prev</button>
                <button onClick={() => setCurrentQIndex(Math.min(codingQuestions.length - 1, currentQIndex + 1))} disabled={currentQIndex === codingQuestions.length - 1} className="btn-secondary text-sm py-1.5 flex items-center gap-1">Next <ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex-1 flex flex-col">
              {currentQuestion && currentQuestion.type === 'coding' && (
                <>
                  <div className="h-12 glass-strong border-b border-slate-700/20 flex items-center px-4 justify-between shrink-0">
                    <div className="flex items-center gap-3">
                      <select value={langId[currentQuestion.id] || 71}
                        onChange={(e) => setLangId((p) => ({ ...p, [currentQuestion.id]: Number(e.target.value) }))}
                        className="bg-slate-800/50 border border-slate-700/40 rounded-xl px-3 py-1.5 text-sm text-slate-300">
                        {(currentQuestion.allowedLanguages.length > 0 ? currentQuestion.allowedLanguages : Object.keys(LANGUAGES).map(Number))
                          .map((id) => (<option key={id} value={id}>{LANGUAGES[id]?.name || `Lang ${id}`}</option>))}
                      </select>
                      {lastSaved && (
                        <span className="text-[11px] text-slate-600 flex items-center gap-1">
                          <Save className="w-3 h-3" /> Saved {lastSaved}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={handleResetCode} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700/50 transition-all" title="Reset code">
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <div className="hidden sm:flex items-center gap-1 text-[10px] text-slate-600 border-r border-slate-700/30 pr-2 mr-1">
                        <Keyboard className="w-3 h-3" /> Ctrl+Enter: Run
                      </div>
                      <button onClick={handleRunCode} disabled={running}
                        className="btn-secondary text-sm py-1.5 flex items-center gap-1.5">
                        <Play className="w-4 h-4" /> {running ? 'Running...' : 'Run'}
                      </button>
                      <button onClick={handleSubmitCoding} disabled={submitting}
                        className="btn-primary text-sm py-1.5 flex items-center gap-1.5">
                        <Send className="w-4 h-4" /> {submitting ? 'Submitting...' : 'Submit'}
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex-1 overflow-hidden">
                      <CodeEditor language={LANGUAGES[langId[currentQuestion.id] || 71]?.monacoId || 'python'}
                        value={code[currentQuestion.id] || ''}
                        onChange={(val) => setCode((p) => ({ ...p, [currentQuestion.id]: val || '' }))} />
                    </div>
                    <div className="h-[250px] border-t border-slate-700/20 shrink-0">
                      <OutputPanel output={output} customInput={customInput} onCustomInputChange={setCustomInput}
                        activeTab={outputTab} onTabChange={setOutputTab} submission={submissions[currentQuestion.id]} />
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ─── CODING LOCKED ──────────────────────────── */}
        {activeSection === 'coding' && !codingUnlocked && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md animate-fade-in">
              <div className="w-20 h-20 bg-slate-800/50 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-slate-700/30">
                <Lock className="w-10 h-10 text-slate-500" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-3">Coding Section Locked</h2>
              <p className="text-slate-400 mb-8">
                {mcqSubmitted ? `Your MCQ score did not meet the ${test?.mcqCutoffPercent}% cutoff.` : `Complete MCQ first. Need ${test?.mcqCutoffPercent || 40}% to unlock.`}
              </p>
              {!mcqSubmitted && (
                <button onClick={() => { setActiveSection('mcq'); setCurrentQIndex(0); }} className="btn-primary flex items-center gap-2 mx-auto py-3 px-6">
                  <ArrowRight className="w-5 h-5" /> Go to MCQ
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
