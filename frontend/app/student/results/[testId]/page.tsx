'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { resultsService } from '@/services/results.service';
import { ArrowLeft, CheckCircle, XCircle } from 'lucide-react';

export default function DetailedResultPage() {
  const { testId } = useParams<{ testId: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await resultsService.getDetailedResult(testId);
        setData(res);
      } catch (err: any) { toast.error(err.message); }
      finally { setLoading(false); }
    };
    load();
  }, [testId]);

  if (loading) return <div className="p-8 text-dark-400">Loading results...</div>;
  if (!data) return <div className="p-8 text-dark-400">No results found</div>;

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/student/results" className="p-2 hover:bg-dark-800 rounded-lg"><ArrowLeft className="w-5 h-5" /></Link>
        <div>
          <h1 className="text-2xl font-bold">Test Results</h1>
          <p className="text-dark-400 mt-1">
            Total Score: <span className="font-mono font-bold text-accent text-xl">{data.totalScore}</span>
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {data.questions?.map((q: any, i: number) => (
          <div key={q.questionId} className="card">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-medium">Q{i + 1}: {q.questionTitle}</h3>
                <p className="text-sm text-dark-400 mt-1">
                  Best Score: <span className="font-mono font-bold">{q.bestScore}</span> · {q.totalAttempts} attempts
                </p>
              </div>
              {q.bestScore > 0 ? <CheckCircle className="w-6 h-6 text-success" /> : <XCircle className="w-6 h-6 text-danger" />}
            </div>
            {q.lastSubmission?.result?.testCaseResults && (
              <div className="mt-3 flex gap-2 flex-wrap">
                {q.lastSubmission.result.testCaseResults.map((tc: any, j: number) => (
                  <div key={j} className={`px-2 py-1 rounded text-xs ${tc.passed ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                    {tc.isHidden ? `Hidden ${j + 1}` : `Case ${j + 1}`}: {tc.passed ? 'Passed' : tc.status}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
