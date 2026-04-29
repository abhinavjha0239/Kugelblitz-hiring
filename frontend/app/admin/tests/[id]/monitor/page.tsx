'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { resultsService } from '@/services/results.service';
import { formatDuration } from '@/lib/utils';
import { ArrowLeft, RefreshCw, Users, CheckCircle, Clock, AlertTriangle } from 'lucide-react';

export default function MonitorPage() {
  const { id: testId } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await resultsService.getMonitor(testId);
      setData(res);
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [testId]);

  if (loading) return <div className="p-8 text-dark-400">Loading monitor...</div>;
  if (!data) return <div className="p-8 text-dark-400">No data available</div>;

  return (
    <div className="p-8">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin" className="p-2 hover:bg-dark-800 rounded-lg"><ArrowLeft className="w-5 h-5" /></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Live Monitor: {data.test?.title}</h1>
          <p className="text-dark-400 text-sm mt-1">Auto-refreshes every 10 seconds</p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Refresh</button>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-8">
        <div className="card flex items-center gap-4">
          <Users className="w-8 h-8 text-accent" />
          <div><p className="text-2xl font-bold">{data.totalParticipants}</p><p className="text-sm text-dark-400">Total</p></div>
        </div>
        <div className="card flex items-center gap-4">
          <Clock className="w-8 h-8 text-warning" />
          <div><p className="text-2xl font-bold">{data.inProgress}</p><p className="text-sm text-dark-400">In Progress</p></div>
        </div>
        <div className="card flex items-center gap-4">
          <CheckCircle className="w-8 h-8 text-success" />
          <div><p className="text-2xl font-bold">{data.submitted}</p><p className="text-sm text-dark-400">Submitted</p></div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-dark-700">
              <th className="text-left py-3 px-4 text-sm font-medium text-dark-400">Student</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-dark-400">Status</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-dark-400">Score</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-dark-400">Remaining</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-dark-400">Flags</th>
            </tr>
          </thead>
          <tbody>
            {data.participants.map((p: any) => (
              <tr key={p.id} className="border-b border-dark-800 hover:bg-dark-800/50">
                <td className="py-3 px-4">
                  <p className="font-medium">{p.userName}</p>
                  <p className="text-xs text-dark-400">{p.email}</p>
                </td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    p.status === 'submitted' ? 'bg-success/10 text-success' :
                    p.status === 'in_progress' ? 'bg-warning/10 text-warning' :
                    'bg-dark-700 text-dark-400'
                  }`}>{p.status}</span>
                </td>
                <td className="py-3 px-4 font-mono">{p.totalScore}</td>
                <td className="py-3 px-4 text-sm">{p.remainingTime != null ? formatDuration(p.remainingTime) : '-'}</td>
                <td className="py-3 px-4">
                  {(p.tabSwitchCount > 0 || p.fullscreenExitCount > 0) && (
                    <div className="flex items-center gap-1 text-danger">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-xs">Tab: {p.tabSwitchCount} | FS: {p.fullscreenExitCount}</span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {data.participants.length === 0 && (
              <tr><td colSpan={5} className="py-8 text-center text-dark-400">No participants yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
