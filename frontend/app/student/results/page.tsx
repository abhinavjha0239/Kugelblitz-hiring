'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { testsService } from '@/services/tests.service';
import { resultsService } from '@/services/results.service';
import { FileText, Eye } from 'lucide-react';

export default function StudentResultsPage() {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const tests = await testsService.getActive();
        const res: any[] = [];
        for (const t of tests) {
          try {
            const p = await resultsService.getParticipation(t.id);
            if (p && (p.status === 'submitted' || p.status === 'timed_out')) {
              res.push({ test: t, participation: p });
            }
          } catch {}
        }
        setResults(res);
      } catch (err: any) { toast.error(err.message); }
      finally { setLoading(false); }
    };
    load();
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-8">My Results</h1>
      {loading ? (
        <div className="text-center py-12 text-dark-400">Loading...</div>
      ) : results.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="w-16 h-16 text-dark-600 mx-auto mb-4" />
          <p className="text-dark-400">No completed tests yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {results.map(({ test, participation }) => (
            <div key={test.id} className="card flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">{test.title}</h3>
                <p className="text-sm text-dark-400 mt-1">
                  Score: <span className="font-mono font-bold text-accent">{participation.totalScore}</span> / {test.totalMarks}
                </p>
              </div>
              <Link href={`/student/results/${test.id}`} className="btn-secondary flex items-center gap-2">
                <Eye className="w-4 h-4" /> View Details
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
