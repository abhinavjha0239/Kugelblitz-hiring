'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { testSessionService } from '@/services/test-session.service';
import {
  ArrowLeft, ShieldAlert, Eye, Clipboard, Maximize,
  AlertTriangle, CheckCircle, XCircle, Zap, Globe, RefreshCw,
} from 'lucide-react';

interface ResultEntry {
  rank: number;
  userId: string;
  name: string;
  email: string;
  status: string;
  mcqScore: number;
  codingScore: number;
  totalScore: number;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  violationCount: number;
  tabSwitchCount: number;
  fullscreenExitCount: number;
  copyPasteCount: number;
  ipAddress: string | null;
  autoSubmitted: boolean;
  startedAt: string;
  submittedAt: string | null;
}

interface Violation {
  id: string;
  userId: string;
  userName: string;
  type: string;
  ipAddress: string | null;
  metadata: any;
  createdAt: string;
}

export default function ProctoringDashboard() {
  const { testId } = useParams<{ testId: string }>();
  const [results, setResults] = useState<ResultEntry[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [tab, setTab] = useState<'results' | 'violations'>('results');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [res, vio] = await Promise.all([
        testSessionService.getAdminResults(testId),
        testSessionService.getAdminViolations(testId),
      ]);
      setResults(res as any);
      setViolations((vio as any).violations || []);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [testId]);

  const getRiskBadge = (level: string, score: number) => {
    const colors = {
      low: 'bg-green-500/10 text-green-400 border-green-500/30',
      medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
      high: 'bg-red-500/10 text-red-400 border-red-500/30',
    };
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${colors[level as keyof typeof colors] || colors.low}`}>
        <ShieldAlert className="w-3 h-3" />
        {score} ({level})
      </span>
    );
  };

  const getViolationIcon = (type: string) => {
    switch (type) {
      case 'tab_switch': return <Eye className="w-4 h-4 text-yellow-400" />;
      case 'copy_paste': return <Clipboard className="w-4 h-4 text-red-400" />;
      case 'fullscreen_exit': return <Maximize className="w-4 h-4 text-orange-400" />;
      case 'rapid_answer': return <Zap className="w-4 h-4 text-purple-400" />;
      case 'multiple_ip': return <Globe className="w-4 h-4 text-red-500" />;
      default: return <AlertTriangle className="w-4 h-4 text-gray-400" />;
    }
  };

  const highRiskCount = results.filter(r => r.riskLevel === 'high').length;
  const medRiskCount = results.filter(r => r.riskLevel === 'medium').length;
  const totalViolations = results.reduce((s, r) => s + r.violationCount, 0);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="p-2 hover:bg-dark-800 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-accent" /> Proctoring Dashboard
            </h1>
            <p className="text-dark-400 text-sm mt-1">{results.length} participants</p>
          </div>
        </div>
        <button onClick={load} className="btn-secondary text-sm flex items-center gap-1.5">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="card text-center">
          <p className="text-2xl font-bold text-white">{results.length}</p>
          <p className="text-xs text-dark-400 mt-1">Total Participants</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-red-400">{highRiskCount}</p>
          <p className="text-xs text-dark-400 mt-1">High Risk</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-yellow-400">{medRiskCount}</p>
          <p className="text-xs text-dark-400 mt-1">Medium Risk</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-orange-400">{totalViolations}</p>
          <p className="text-xs text-dark-400 mt-1">Total Violations</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-dark-800 rounded-lg p-1 mb-6 w-fit">
        <button
          onClick={() => setTab('results')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'results' ? 'bg-accent text-white' : 'text-dark-400 hover:text-white'}`}
        >
          Results + Risk Scores
        </button>
        <button
          onClick={() => setTab('violations')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'violations' ? 'bg-accent text-white' : 'text-dark-400 hover:text-white'}`}
        >
          Violation Log ({violations.length})
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-dark-400">Loading...</div>
      ) : tab === 'results' ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-dark-700 text-xs text-dark-400 uppercase tracking-wider">
                  <th className="text-left py-3 px-3">#</th>
                  <th className="text-left py-3 px-3">Student</th>
                  <th className="text-left py-3 px-3">Status</th>
                  <th className="text-center py-3 px-3">MCQ</th>
                  <th className="text-center py-3 px-3">Coding</th>
                  <th className="text-center py-3 px-3">Total</th>
                  <th className="text-center py-3 px-3">Risk</th>
                  <th className="text-center py-3 px-3">
                    <Eye className="w-3.5 h-3.5 inline" aria-label="Tab Switches" />
                  </th>
                  <th className="text-center py-3 px-3">
                    <Clipboard className="w-3.5 h-3.5 inline" aria-label="Copy/Paste" />
                  </th>
                  <th className="text-center py-3 px-3">
                    <Maximize className="w-3.5 h-3.5 inline" aria-label="Fullscreen Exits" />
                  </th>
                  <th className="text-left py-3 px-3">IP</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.userId} className={`border-b border-dark-800 hover:bg-dark-800/50 ${r.riskLevel === 'high' ? 'bg-red-500/5' : ''}`}>
                    <td className="py-3 px-3 text-sm text-dark-400">{r.rank}</td>
                    <td className="py-3 px-3">
                      <p className="font-medium text-sm">{r.name}</p>
                      <p className="text-xs text-dark-500">{r.email}</p>
                    </td>
                    <td className="py-3 px-3">
                      {r.status === 'submitted' ? (
                        <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3.5 h-3.5" /> Done</span>
                      ) : r.status === 'timed_out' ? (
                        <span className="flex items-center gap-1 text-xs text-orange-400"><AlertTriangle className="w-3.5 h-3.5" /> Timed Out</span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-blue-400"><Zap className="w-3.5 h-3.5" /> In Progress</span>
                      )}
                      {r.autoSubmitted && <span className="text-[10px] text-dark-500 block">auto</span>}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-sm">{r.mcqScore}</td>
                    <td className="py-3 px-3 text-center font-mono text-sm">{r.codingScore}</td>
                    <td className="py-3 px-3 text-center font-mono text-sm font-bold">{r.totalScore}</td>
                    <td className="py-3 px-3 text-center">{getRiskBadge(r.riskLevel, r.riskScore)}</td>
                    <td className="py-3 px-3 text-center text-sm">{r.tabSwitchCount || '-'}</td>
                    <td className="py-3 px-3 text-center text-sm">{r.copyPasteCount || '-'}</td>
                    <td className="py-3 px-3 text-center text-sm">{r.fullscreenExitCount || '-'}</td>
                    <td className="py-3 px-3 text-xs text-dark-500 font-mono">{r.ipAddress || '-'}</td>
                  </tr>
                ))}
                {results.length === 0 && (
                  <tr><td colSpan={11} className="py-12 text-center text-dark-400">No participants yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-dark-700 text-xs text-dark-400 uppercase tracking-wider">
                  <th className="text-left py-3 px-4">Type</th>
                  <th className="text-left py-3 px-4">Student</th>
                  <th className="text-left py-3 px-4">IP</th>
                  <th className="text-left py-3 px-4">Details</th>
                  <th className="text-left py-3 px-4">Time</th>
                </tr>
              </thead>
              <tbody>
                {violations.map((v) => (
                  <tr key={v.id} className="border-b border-dark-800 hover:bg-dark-800/50">
                    <td className="py-3 px-4">
                      <span className="flex items-center gap-2 text-sm">
                        {getViolationIcon(v.type)}
                        {v.type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm">{v.userName}</td>
                    <td className="py-3 px-4 text-xs font-mono text-dark-500">{v.ipAddress || '-'}</td>
                    <td className="py-3 px-4 text-xs text-dark-400">
                      {v.metadata?.riskAdded ? `+${v.metadata.riskAdded} risk` : ''}
                      {v.metadata?.questionId ? ` Q: ${v.metadata.questionId.slice(0, 8)}...` : ''}
                    </td>
                    <td className="py-3 px-4 text-xs text-dark-500">
                      {new Date(v.createdAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
                {violations.length === 0 && (
                  <tr><td colSpan={5} className="py-12 text-center text-dark-400">No violations logged</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
