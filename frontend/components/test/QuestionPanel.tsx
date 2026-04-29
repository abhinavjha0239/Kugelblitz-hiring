'use client';
import { Question } from '@/types';
import { Code, ListChecks, FileText } from 'lucide-react';

interface Props {
  question: Question;
  mcqAnswer?: string;
  onMcqAnswer?: (answer: string) => void;
}

export default function QuestionPanel({ question, mcqAnswer, onMcqAnswer }: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex items-center gap-2 mb-4">
        {question.type === 'coding' ? (
          <Code className="w-5 h-5 text-accent" />
        ) : (
          <ListChecks className="w-5 h-5 text-warning" />
        )}
        <h2 className="text-lg font-semibold">{question.title}</h2>
        <span className="ml-auto text-xs bg-dark-800 px-2 py-1 rounded">{question.marks} pts</span>
      </div>

      <div className="prose prose-invert prose-sm max-w-none mb-6">
        {question.description.split('\n').map((line, i) => {
          if (line.startsWith('**') && line.endsWith('**')) {
            return <p key={i} className="font-bold text-dark-200 mt-3 mb-1">{line.replace(/\*\*/g, '')}</p>;
          }
          if (line.trim() === '') return <br key={i} />;
          return <p key={i} className="text-dark-300 leading-relaxed my-0.5">{line}</p>;
        })}
      </div>

      {question.type === 'mcq' && question.mcqOptions && (
        <div className="space-y-2 mb-4">
          <p className="text-sm font-medium text-dark-300 mb-3">Select your answer:</p>
          {question.mcqOptions.map((opt) => (
            <label
              key={opt.id}
              className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                mcqAnswer === opt.id
                  ? 'bg-accent/10 border border-accent'
                  : 'bg-dark-800 border border-transparent hover:border-dark-600'
              }`}
            >
              <input
                type="radio"
                name="mcq"
                checked={mcqAnswer === opt.id}
                onChange={() => onMcqAnswer?.(opt.id)}
                className="w-4 h-4 text-accent"
              />
              <span className="font-mono text-sm mr-2">{opt.id.toUpperCase()}.</span>
              <span className="text-sm">{opt.text}</span>
            </label>
          ))}
        </div>
      )}

      {question.type === 'coding' && question.testCases && question.testCases.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-dark-300 mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4" /> Sample Test Cases
          </h3>
          <div className="space-y-3">
            {question.testCases.map((tc, i) => (
              <div key={tc.id} className="bg-dark-800 rounded-lg p-3 space-y-2">
                <p className="text-xs text-dark-400 font-medium">Case {i + 1}</p>
                <div>
                  <p className="text-xs text-dark-500 mb-1">Input:</p>
                  <pre className="text-sm font-mono bg-dark-900 p-2 rounded overflow-x-auto">{tc.input}</pre>
                </div>
                <div>
                  <p className="text-xs text-dark-500 mb-1">Expected Output:</p>
                  <pre className="text-sm font-mono bg-dark-900 p-2 rounded overflow-x-auto">{tc.expectedOutput}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
