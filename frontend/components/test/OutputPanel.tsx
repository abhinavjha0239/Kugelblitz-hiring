'use client';
import { Submission } from '@/types';
import { Terminal, CheckCircle, XCircle, Keyboard } from 'lucide-react';

interface Props {
  output: string;
  customInput: string;
  onCustomInputChange: (val: string) => void;
  activeTab: 'output' | 'results';
  onTabChange: (tab: 'output' | 'results') => void;
  submission?: Submission;
}

export default function OutputPanel({ output, customInput, onCustomInputChange, activeTab, onTabChange, submission }: Props) {
  return (
    <div className="h-full flex flex-col bg-dark-900">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-dark-700 shrink-0">
        <button
          onClick={() => onTabChange('output')}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
            activeTab === 'output' ? 'bg-dark-700 text-white' : 'text-dark-400 hover:text-dark-200'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" /> Output
        </button>
        <button
          onClick={() => onTabChange('results')}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
            activeTab === 'results' ? 'bg-dark-700 text-white' : 'text-dark-400 hover:text-dark-200'
          }`}
        >
          <CheckCircle className="w-3.5 h-3.5" /> Results
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto p-3">
          {activeTab === 'output' ? (
            <pre className="text-sm font-mono text-dark-200 whitespace-pre-wrap">{output || 'Run your code to see output here...'}</pre>
          ) : (
            <div>
              {submission?.status === 'completed' && submission.result?.testCaseResults ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="font-mono font-bold text-lg">{submission.score}</span>
                    <span className="text-dark-400 text-sm">points</span>
                    <span className="text-dark-400 text-sm ml-auto">
                      {submission.result.passedCount}/{submission.result.totalCount} passed
                    </span>
                  </div>
                  {submission.result.testCaseResults.map((tc: any, i: number) => (
                    <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                      tc.passed ? 'bg-success/10' : 'bg-danger/10'
                    }`}>
                      {tc.passed ? <CheckCircle className="w-4 h-4 text-success" /> : <XCircle className="w-4 h-4 text-danger" />}
                      <span>{tc.isHidden ? `Hidden Case ${i + 1}` : `Case ${i + 1}`}</span>
                      <span className="ml-auto text-xs text-dark-400">{tc.status}</span>
                    </div>
                  ))}
                </div>
              ) : submission?.status === 'processing' || submission?.status === 'queued' ? (
                <div className="flex items-center gap-2 text-dark-400">
                  <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  Evaluating...
                </div>
              ) : (
                <pre className="text-sm font-mono text-dark-400 whitespace-pre-wrap">{output || 'Submit your code to see results...'}</pre>
              )}
            </div>
          )}
        </div>

        {activeTab === 'output' && (
          <div className="w-[200px] border-l border-dark-700 flex flex-col">
            <div className="px-3 py-2 text-xs font-medium text-dark-400 flex items-center gap-1.5 border-b border-dark-700">
              <Keyboard className="w-3.5 h-3.5" /> Custom Input
            </div>
            <textarea
              value={customInput}
              onChange={(e) => onCustomInputChange(e.target.value)}
              className="flex-1 bg-transparent p-3 text-sm font-mono resize-none focus:outline-none text-dark-200 placeholder-dark-500"
              placeholder="stdin..."
            />
          </div>
        )}
      </div>
    </div>
  );
}
