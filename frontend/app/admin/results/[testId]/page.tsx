'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { resultsService } from '@/services/results.service';
import { LeaderboardEntry } from '@/types';
import { ArrowLeft, Trophy, Medal, Award } from 'lucide-react';

export default function ResultsPage() {
  const { testId } = useParams<{ testId: string }>();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await resultsService.getLeaderboard(testId);
        setLeaderboard(data);
      } catch (err: any) { toast.error(err.message); }
      finally { setLoading(false); }
    };
    load();
  }, [testId]);

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Trophy className="w-5 h-5 text-yellow-400" />;
    if (rank === 2) return <Medal className="w-5 h-5 text-gray-300" />;
    if (rank === 3) return <Award className="w-5 h-5 text-amber-600" />;
    return <span className="text-sm text-dark-400 w-5 text-center">{rank}</span>;
  };

  return (
    <div className="p-8">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin" className="p-2 hover:bg-dark-800 rounded-lg"><ArrowLeft className="w-5 h-5" /></Link>
        <div>
          <h1 className="text-2xl font-bold">Leaderboard</h1>
          <p className="text-dark-400 text-sm mt-1">{leaderboard.length} participants</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-dark-400">Loading results...</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-dark-700">
                <th className="text-left py-3 px-4 text-sm font-medium text-dark-400 w-16">Rank</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-dark-400">Student</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-dark-400">Score</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-dark-400">Time Taken</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((entry) => (
                <tr key={entry.userId} className={`border-b border-dark-800 hover:bg-dark-800/50 ${entry.rank <= 3 ? 'bg-dark-800/30' : ''}`}>
                  <td className="py-3 px-4">{getRankIcon(entry.rank)}</td>
                  <td className="py-3 px-4">
                    <p className="font-medium">{entry.name}</p>
                    <p className="text-xs text-dark-400">{entry.email}</p>
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-mono font-bold text-lg">{entry.totalScore}</span>
                    <span className="text-dark-400 text-sm">/{entry.totalPossible}</span>
                  </td>
                  <td className="py-3 px-4 text-sm text-dark-300">
                    {entry.timeTaken ? `${entry.timeTaken} min` : '-'}
                  </td>
                </tr>
              ))}
              {leaderboard.length === 0 && (
                <tr><td colSpan={4} className="py-12 text-center text-dark-400">No results yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
