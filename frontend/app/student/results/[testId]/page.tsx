'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { resultsService } from '@/services/results.service';
import {
  ArrowLeft, CheckCircle, XCircle, Clock, Code, Trophy, Shield,
  AlertTriangle, BookOpen, ChevronDown, ChevronUp, MinusCircle,
} from 'lucide-react';

type Tab = 'overview' | 'review' | 'proctoring';

export default function DetailedResultPage() {
  const { testId } = useParams<{ testId: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [openMcq, setOpenMcq] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Lockdown: a magic-link candidate visiting another candidate's
    // results page gets redirected to their own exam. Backend
    // InviteScopeGuard also rejects the underlying API call; this is
    // the soft client-side redirect.
    const stored = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
    if (stored?.inviteScope?.lockedToTest && stored.inviteScope.testId !== testId) {
      router.replace(`/test/${stored.inviteScope.testId}`);
      return;
    }
    const load = async () => {
      try {
        const res = await resultsService.getDetailedResult(testId);
        setData(res);
      } catch (err: any) { toast.error(err.message); }
      finally { setLoading(false); }
    };
    load();
  }, [testId, router]);

  const summary = useMemo(() => {
    if (!data) return null;
    const papers = data.papers || [];
    const submittedPapers = papers.filter((p: any) => p.status === 'submitted');
    const lockedPapers = papers.filter((p: any) => p.status === 'locked_fail');
    const attemptedDenom = submittedPapers.reduce((s: number, p: any) => s + Number(p.totalMarks || 0), 0);
    const totalDenom = data.test?.totalMarks ?? attemptedDenom ?? 0;
    const score = Number(data.totalScore || 0);
    const partial = lockedPapers.length > 0;
    const denom = partial && attemptedDenom > 0 ? attemptedDenom : totalDenom;
    const percent = denom > 0 ? Math.round((score / denom) * 100) : 0;
    const mcqStats = (data.mcq || []).reduce(
      (acc: any, r: any) => ({
        total: acc.total + 1,
        correct: acc.correct + (r.isCorrect ? 1 : 0),
        attempted: acc.attempted + (r.selectedOption ? 1 : 0),
      }),
      { total: 0, correct: 0, attempted: 0 },
    );
    return { papers, submittedPapers, lockedPapers, score, denom, totalDenom, partial, percent, mcqStats };
  }, [data]);

  if (loading) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <div className="h-32 bg-slate-800/30 rounded-2xl animate-pulse mb-6" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 bg-slate-800/30 rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!data || !summary) {
    return (
      <div className="p-8 max-w-3xl mx-auto text-center">
        <XCircle className="w-12 h-12 text-rose-400 mx-auto mb-3" />
        <p className="text-dark-400">No results found for this test.</p>
        <Link href="/student" className="btn-secondary mt-4 inline-flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
      </div>
    );
  }

  const { score, denom, percent, partial, papers, submittedPapers, mcqStats } = summary;
  const verdict =
    percent >= 70 ? { label: 'Excellent', color: 'emerald' } :
    percent >= 40 ? { label: 'Pass', color: 'blue' } :
    { label: 'Below cutoff', color: 'rose' };

  const submittedAt = data.participation?.submittedAt ? new Date(data.participation.submittedAt) : null;
  const startedAt = data.participation?.startedAt ? new Date(data.participation.startedAt) : null;
  const totalMin = startedAt && submittedAt ? Math.round((submittedAt.getTime() - startedAt.getTime()) / 60_000) : null;

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/student" className="p-2 hover:bg-dark-800 rounded-lg" title="Back">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <p className="text-xs text-dark-500 uppercase tracking-wider">Result</p>
          <h1 className="text-xl lg:text-2xl font-bold">{data.test?.title || 'Assessment'}</h1>
          <p className="text-xs text-dark-400 mt-0.5">
            {submittedAt ? `Submitted ${submittedAt.toLocaleString()}` : 'In progress'}
            {totalMin != null && ` · ${totalMin} min taken`}
          </p>
        </div>
      </div>

      <div className="card mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <CircularScore percent={percent} size={120} />
            <div>
              <p className="text-xs text-dark-500 uppercase tracking-wider mb-1">Total score</p>
              <p className="text-3xl font-bold font-mono">
                {score.toFixed(0)}<span className="text-lg text-dark-500">/{denom}</span>
              </p>
              <p className={`text-sm mt-1 font-medium text-${verdict.color}-400`}>
                {verdict.label}{partial && <span className="text-dark-500 font-normal ml-1">(of attempted papers)</span>}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 md:gap-6 text-center">
            <Mini label="MCQ" value={`${data.mcqScore}`} sub={mcqStats.total ? `${mcqStats.correct}/${mcqStats.total}` : '—'} />
            <Mini label="Coding" value={`${data.codingScore}`} sub={(data.coding?.length ?? 0) > 0 ? `${data.coding.length} q` : '—'} />
            <Mini label="Papers" value={`${submittedPapers.length}/${papers.length || '—'}`} sub={papers.length ? 'submitted' : ''} />
          </div>
        </div>
      </div>

      <div className="flex gap-1 glass rounded-xl p-1 mb-6 w-fit">
        {([
          { key: 'overview', label: 'Overview', icon: Trophy },
          { key: 'review', label: 'Question review', icon: BookOpen },
          { key: 'proctoring', label: 'Proctoring', icon: Shield },
        ] as { key: Tab; label: string; icon: any }[]).map(({ key, label, icon: I }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
              tab === key ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <I className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          {papers.length === 0 ? (
            <p className="text-dark-400 text-sm text-center py-8">No paper-based breakdown available.</p>
          ) : (
            papers.map((p: any) => <PaperRow key={p.paperId} paper={p} />)
          )}
          {data.coding?.length > 0 && (
            <div className="card mt-6">
              <div className="flex items-center gap-2 mb-3">
                <Code className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-semibold uppercase tracking-wider">Coding submissions</h3>
              </div>
              <div className="space-y-2">
                {data.coding.map((c: any) => (
                  <div key={c.questionId} className="flex items-center justify-between bg-dark-800/40 rounded-lg p-3">
                    <div>
                      <p className="text-sm font-medium">{c.questionTitle}</p>
                      <p className="text-xs text-dark-500">{c.totalAttempts} attempt{c.totalAttempts > 1 ? 's' : ''}</p>
                    </div>
                    <span className={`font-mono font-bold ${c.bestScore > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {Number(c.bestScore).toFixed(0)}<span className="text-dark-500 text-xs">/{c.questionMarks}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'review' && (
        <div className="space-y-3">
          {(!data.mcq || data.mcq.length === 0) ? (
            <p className="text-dark-400 text-sm text-center py-8">No MCQ responses to review.</p>
          ) : (
            data.mcq.map((r: any, i: number) => {
              const isOpen = openMcq.has(r.questionId);
              const toggle = () => {
                setOpenMcq((prev) => {
                  const next = new Set(prev);
                  if (next.has(r.questionId)) next.delete(r.questionId);
                  else next.add(r.questionId);
                  return next;
                });
              };
              return (
                <div key={r.questionId} className="card p-0 overflow-hidden">
                  <button onClick={toggle} className="w-full flex items-center justify-between p-4 hover:bg-dark-800/40 transition-colors">
                    <div className="flex items-center gap-3 text-left flex-1 min-w-0">
                      <span className="text-xs text-dark-500 font-mono shrink-0">Q{i + 1}</span>
                      {r.selectedOption == null ? (
                        <MinusCircle className="w-5 h-5 text-dark-500 shrink-0" />
                      ) : r.isCorrect ? (
                        <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                      )}
                      <span className="text-sm font-medium truncate">{r.title}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-sm font-mono ${r.marksAwarded > 0 ? 'text-emerald-400' : r.marksAwarded < 0 ? 'text-rose-400' : 'text-dark-500'}`}>
                        {r.marksAwarded > 0 ? '+' : ''}{r.marksAwarded}<span className="text-dark-500 text-xs">/{r.questionMarks}</span>
                      </span>
                      {isOpen ? <ChevronUp className="w-4 h-4 text-dark-500" /> : <ChevronDown className="w-4 h-4 text-dark-500" />}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 border-t border-dark-700">
                      <p className="text-sm text-dark-300 my-3 whitespace-pre-line">{r.description}</p>
                      <div className="space-y-2">
                        {(r.options || []).map((opt: any, optIdx: number) => {
                          const isSelected = r.selectedOption === opt.id;
                          const isCorrect = r.correctAnswer === opt.id;
                          return (
                            <div
                              key={opt.id}
                              className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-sm ${
                                isCorrect ? 'bg-emerald-900/20 border-emerald-700/50 text-emerald-100' :
                                isSelected ? 'bg-rose-900/20 border-rose-700/50 text-rose-100' :
                                'bg-dark-800/40 border-dark-700 text-dark-300'
                              }`}
                            >
                              <span className="font-mono text-xs uppercase">{String.fromCharCode(65 + optIdx)}.</span>
                              <span className="flex-1">{opt.text}</span>
                              {isCorrect && <span className="text-[10px] uppercase text-emerald-300 font-semibold">correct</span>}
                              {isSelected && !isCorrect && <span className="text-[10px] uppercase text-rose-300 font-semibold">your pick</span>}
                              {isSelected && isCorrect && <span className="text-[10px] uppercase text-emerald-300 font-semibold">your pick</span>}
                            </div>
                          );
                        })}
                      </div>
                      {r.selectedOption == null && (
                        <p className="text-xs text-dark-500 mt-3 italic">You didn't answer this question.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === 'proctoring' && (
        <ProctoringCard p={data.proctoring} />
      )}
    </div>
  );
}

function CircularScore({ percent, size }: { percent: number; size: number }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (percent / 100) * c;
  const stroke = percent >= 70 ? '#10b981' : percent >= 40 ? '#3b82f6' : '#f43f5e';
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(148,163,184,0.15)" strokeWidth="8" fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={stroke} strokeWidth="8" fill="none"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 800ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold font-mono">{percent}<span className="text-sm text-dark-500">%</span></span>
      </div>
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col items-center bg-dark-800/40 rounded-xl px-4 py-3">
      <span className="text-xs uppercase tracking-wider text-dark-500">{label}</span>
      <span className="text-lg font-bold font-mono mt-1">{value}</span>
      <span className="text-[10px] text-dark-500 mt-0.5">{sub}</span>
    </div>
  );
}

function PaperRow({ paper }: { paper: any }) {
  const ratio = paper.totalMarks > 0 ? Number(paper.score) / Number(paper.totalMarks) : 0;
  const pct = Math.round(ratio * 100);
  const isLocked = paper.status === 'locked_fail';
  const passColor = paper.cutoffPassed === true ? 'emerald' : paper.cutoffPassed === false ? 'rose' : 'dark';

  return (
    <div className={`card border ${
      isLocked ? 'border-rose-700/40 bg-rose-950/10' :
      paper.cutoffPassed === true ? 'border-emerald-700/40' :
      paper.cutoffPassed === false ? 'border-rose-700/40' :
      'border-dark-700'
    }`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-xs text-dark-500 uppercase tracking-wider">Paper {paper.order}</p>
          <h3 className="text-base font-semibold">{paper.name}</h3>
          {isLocked && (
            <p className="text-xs text-rose-400 mt-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Locked — previous paper cutoff not met
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <span className="text-2xl font-mono font-bold">
            {Number(paper.score).toFixed(0)}<span className="text-sm text-dark-500">/{paper.totalMarks}</span>
          </span>
          <p className={`text-xs font-medium text-${passColor}-400 mt-0.5`}>
            {isLocked ? 'Skipped' :
              paper.cutoffPassed === true ? '✓ Passed' :
              paper.cutoffPassed === false ? '✗ Cutoff missed' :
              paper.status === 'submitted' ? 'Submitted' : 'Not started'}
          </p>
        </div>
      </div>
      {!isLocked && paper.totalMarks > 0 && (
        <div className="h-1.5 bg-dark-800 rounded-full overflow-hidden mb-2">
          <div className={`h-full ${pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-blue-500' : 'bg-rose-500'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="flex items-center gap-3 text-xs text-dark-500 flex-wrap">
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {paper.timeTakenMin != null ? `${paper.timeTakenMin} min taken` : 'No time data'}</span>
        <span>·</span>
        <span>Allotted {paper.durationMinutes} min</span>
        {paper.cutoffType && paper.cutoffType !== 'none' && (
          <>
            <span>·</span>
            <span>Cutoff: {paper.cutoffValue}{paper.cutoffType === 'percent' ? '%' : ' marks'}</span>
          </>
        )}
      </div>
    </div>
  );
}

function ProctoringCard({ p }: { p: any }) {
  const risk = p.riskScore || 0;
  const riskBand =
    risk >= 30 ? { label: 'High', color: 'rose' } :
    risk >= 15 ? { label: 'Medium', color: 'amber' } :
    { label: 'Low', color: 'emerald' };
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <p className="text-xs text-dark-500 uppercase tracking-wider">Proctoring summary</p>
          <p className={`text-sm mt-1 font-medium text-${riskBand.color}-400`}>
            <Shield className="w-4 h-4 inline mr-1" /> Risk: {riskBand.label} <span className="text-dark-500">(score {risk})</span>
          </p>
        </div>
        <div className="flex gap-3 text-xs text-dark-400">
          <Stat label="Tab switches" value={p.tabSwitchCount} />
          <Stat label="Fullscreen exits" value={p.fullscreenExitCount} />
          <Stat label="Copy/paste" value={p.copyPasteCount} />
          <Stat label="Total flags" value={p.totalViolations} />
        </div>
      </div>
      {p.totalViolations === 0 ? (
        <p className="text-sm text-emerald-400 flex items-center gap-2">
          <CheckCircle className="w-4 h-4" /> No proctoring violations recorded.
        </p>
      ) : (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-dark-500 mb-2">Recent events</p>
          {p.recent.map((e: any, i: number) => (
            <div key={i} className="flex items-center justify-between text-xs bg-dark-800/40 rounded px-3 py-2">
              <span className="font-mono uppercase text-dark-300">{e.type.replace(/_/g, ' ')}</span>
              <span className="text-dark-500">{new Date(e.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-lg font-mono font-bold leading-none">{value}</p>
      <p className="text-[10px] text-dark-500 mt-1 uppercase tracking-wider">{label}</p>
    </div>
  );
}
