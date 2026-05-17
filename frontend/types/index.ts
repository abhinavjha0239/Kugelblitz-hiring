export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'student';
  // Set when this session was minted by a magic-link invite. Locks the
  // candidate to a single test on both server (InviteScopeGuard) and
  // client (layout redirects). Absent for admin / password-based logins.
  inviteScope?: { testId: string; lockedToTest: true };
}

export interface AuthResponse {
  user: User;
  accessToken: string;
}

export interface Test {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  allowedLanguages: number[];
  totalMarks: number;
  questions?: Question[];
  createdAt: string;
  papers?: Paper[];
  timerMode?: 'overall' | 'per_paper';
  overallDurationMinutes?: number;
  timeCarryOver?: boolean;
  // Legacy section-based fields (preserved for backward compat with old tests).
  hasSections?: boolean;
  mcqCutoffPercent?: number;
  mcqTimeMinutes?: number;
  codingTimeMinutes?: number;
  negativeMarkValue?: number;
  // Safe Exam Browser lockdown
  requireSafeExamBrowser?: boolean;
  sebQuitUrl?: string | null;
  sebExtraProhibitedProcesses?: string | null;
}

export interface Paper {
  id: string;
  examId: string;
  name: string;
  order: number;
  totalQuestions: number;
  durationMinutes: number;
  passRequired: boolean;
  cutoffType?: 'percent' | 'marks' | 'none';
  cutoffValue?: number;
  cutoffFailBehavior?: 'end_exam' | 'lock_next' | 'none';
  totalMarks?: number;
}

export interface ExamPaperStatus {
  paperId: string;
  name: string;
  order: number;
  durationMinutes: number;
  totalQuestions: number;
  passRequired: boolean;
  status: 'not_started' | 'in_progress' | 'submitted';
  locked: boolean;
  startedAt: string | null;
  submittedAt: string | null;
  remainingSeconds: number | null;
  totalMarks?: number;
  score?: number;
  cutoffPassed?: boolean | null;
}

export interface Question {
  id: string;
  testId: string;
  type: 'coding' | 'mcq';
  title: string;
  description: string;
  marks: number;
  orderIndex: number;
  allowedLanguages: number[];
  imageUrls?: string[] | null;
  mcqOptions: { id: string; text: string; imageUrl?: string }[] | null;
  // Only populated on admin endpoints — always null/absent for students.
  mcqCorrectAnswer?: string | null;
  testCases: TestCase[];
}

export interface TestCase {
  id: string;
  input: string;
  expectedOutput: string;
  isHidden: boolean;
}

export interface Submission {
  id: string;
  userId: string;
  questionId: string;
  testId: string;
  languageId: number;
  sourceCode: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  result: any;
  score: number;
  executionTime: number | null;
  memoryUsed: number | null;
  isFinal: boolean;
  createdAt: string;
}

export interface TestParticipation {
  id: string;
  userId: string;
  testId: string;
  startedAt: string;
  submittedAt: string | null;
  totalScore: number;
  tabSwitchCount: number;
  fullscreenExitCount: number;
  status: 'in_progress' | 'submitted' | 'timed_out';
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  email: string;
  totalScore: number;
  totalPossible: number;
  submittedAt: string;
  timeTaken: number | null;
}

export interface RunCodeResult {
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  status: { id: number; description: string };
  time: string | null;
  memory: number | null;
}

export const LANGUAGES: Record<number, { name: string; monacoId: string }> = {
  50: { name: 'C (GCC 9.2.0)', monacoId: 'c' },
  54: { name: 'C++ (GCC 9.2.0)', monacoId: 'cpp' },
  51: { name: 'C# (Mono 6.6)', monacoId: 'csharp' },
  62: { name: 'Java (OpenJDK 13)', monacoId: 'java' },
  63: { name: 'JavaScript (Node 12)', monacoId: 'javascript' },
  71: { name: 'Python (3.8)', monacoId: 'python' },
  73: { name: 'Rust (1.40)', monacoId: 'rust' },
};

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
}

export interface ParsedPdfQuestion {
  text: string;
  options: [string, string, string, string];
  correctOption: number | null;
  module: 'aptitude' | 'critical' | 'psychometric';
  status: 'valid' | 'invalid';
  issues: string[];
}

export interface PdfUploadPreview {
  id: string;
  fileName: string;
  status: 'queued' | 'processing' | 'preview_ready' | 'partial' | 'failed' | 'confirmed';
  progress: number;
  errorMessage: string | null;
  parsedQuestions: ParsedPdfQuestion[] | null;
  stats: {
    total: number;
    valid: number;
    invalid: number;
    duplicatesRemoved: number;
  } | null;
  savedTestId: string | null;
}
