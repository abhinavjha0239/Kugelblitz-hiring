import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { User } from '../users/user.entity';
import { PasswordReset } from '../users/password-reset.entity';
import { Test } from '../tests/test.entity';
import { Question } from '../questions/question.entity';
import { TestCase } from '../questions/test-case.entity';
import { Submission } from '../submissions/submission.entity';
import { TestParticipation } from '../results/test-participation.entity';
import { McqResponse } from '../test-session/mcq-response.entity';
import { ViolationLog } from '../test-session/violation-log.entity';
import { ActionLog } from '../test-session/action-log.entity';
import { Paper } from '../paper/paper.entity';
import { PaperQuestion } from '../paper/paper-question.entity';
import { StudentPaperSession } from '../paper/student-paper-session.entity';
import { PdfUpload } from '../pdf-ingestion/pdf-upload.entity';
import { MagicLink } from '../magic-link/magic-link.entity';
import { ExamSet } from '../exam-set/exam-set.entity';
dotenv.config();

const AppDataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3307', 10),
  username: process.env.DB_USERNAME || 'codeassess',
  password: process.env.DB_PASSWORD || 'codeassess_secret',
  database: process.env.DB_NAME || 'codeassess',
  charset: 'utf8mb4',
  entities: [User, PasswordReset, Test, Question, TestCase, Submission, TestParticipation, McqResponse, ViolationLog, ActionLog, Paper, PaperQuestion, StudentPaperSession, PdfUpload, MagicLink, ExamSet],
  synchronize: true,
});

async function seed() {
  await AppDataSource.initialize();
  console.log('Database connected. Seeding...');

  const usersRepo = AppDataSource.getRepository('users');
  const testsRepo = AppDataSource.getRepository('tests');
  const questionsRepo = AppDataSource.getRepository('questions');
  const testCasesRepo = AppDataSource.getRepository('test_cases');
  const papersRepo = AppDataSource.getRepository('papers');
  const paperQuestionsRepo = AppDataSource.getRepository('paper_questions');

  const existingAdmin = await usersRepo.findOne({ where: { email: 'admin@codeassess.com' } });
  if (!existingAdmin) {
    const adminPassword = await bcrypt.hash('admin123', 12);
    const studentPassword = await bcrypt.hash('student123', 12);

    await usersRepo.save({
      email: 'admin@codeassess.com', password: adminPassword,
      firstName: 'Admin', lastName: 'User', role: 'admin', profileComplete: true,
    });
    await usersRepo.save({
      email: 'student@codeassess.com', password: studentPassword,
      firstName: 'Student', lastName: 'User', role: 'student', profileComplete: true,
    });
    console.log('Users created.');
  }

  const admin = await usersRepo.findOne({ where: { email: 'admin@codeassess.com' } });

  // Check if section-based test already exists
  const existingTest = await testsRepo.findOne({ where: { title: 'Full Stack Developer Assessment' } });
  if (existingTest) {
    console.log('Section-based test already exists. Skipping.');
    await AppDataSource.destroy();
    return;
  }

  // ─── SECTION-BASED TEST ─────────────────────────────────────
  const test = await testsRepo.save({
    title: 'Full Stack Developer Assessment',
    description: 'A comprehensive assessment with MCQ aptitude/reasoning (Paper 1) followed by coding challenges (Paper 2). You must score at least 40% on MCQ to unlock coding.',
    durationMinutes: 90,
    isActive: true,
    createdById: (admin as any).id,
    allowedLanguages: [71, 63, 54, 62, 50, 73],
    totalMarks: 100,
    hasSections: true,
    mcqCutoffPercent: 40,
    negativeMarkValue: 0.5,
    mcqTimeMinutes: 30,
    codingTimeMinutes: 60,
    timerMode: 'per_paper',
    overallDurationMinutes: 90,
    timeCarryOver: false,
  });

  const testId = (test as any).id;

  // ─── PAPERS (multi-paper config) ────────────────────────────
  const paper1 = await papersRepo.save({
    examId: testId,
    name: 'Paper 1 — MCQ Aptitude & Reasoning',
    order: 1,
    totalQuestions: 10,
    durationMinutes: 30,
    passRequired: true,
    cutoffType: 'percent',
    cutoffValue: 40,
    cutoffFailBehavior: 'lock_next',
    totalMarks: 50,
  });
  const paper2 = await papersRepo.save({
    examId: testId,
    name: 'Paper 2 — Coding Challenges',
    order: 2,
    totalQuestions: 3,
    durationMinutes: 60,
    passRequired: false,
    cutoffType: 'none',
    cutoffValue: 0,
    cutoffFailBehavior: 'none',
    totalMarks: 50,
  });

  // ════════════════════════════════════════════════════════════
  // SECTION 1: MCQ Questions (Aptitude + Reasoning + Tech)
  // ════════════════════════════════════════════════════════════

  const mcqQuestions = [
    {
      title: 'Pattern Recognition',
      description: 'What comes next in the series: 2, 6, 12, 20, 30, ?',
      marks: 5, negativeMarks: 0.5, section: 1, orderIndex: 0,
      mcqOptions: [
        { id: 'a', text: '40' }, { id: 'b', text: '42' },
        { id: 'c', text: '38' }, { id: 'd', text: '44' },
      ],
      mcqCorrectAnswer: 'b',
    },
    {
      title: 'Logical Reasoning',
      description: 'All roses are flowers. Some flowers fade quickly. Which conclusion follows?\n\nI. Some roses fade quickly\nII. Some roses do not fade quickly',
      marks: 5, negativeMarks: 0.5, section: 1, orderIndex: 1,
      mcqOptions: [
        { id: 'a', text: 'Only I follows' }, { id: 'b', text: 'Only II follows' },
        { id: 'c', text: 'Both follow' }, { id: 'd', text: 'Neither follows' },
      ],
      mcqCorrectAnswer: 'd',
    },
    {
      title: 'Percentage Problem',
      description: 'A shopkeeper offers a 20% discount on an item and still makes a 25% profit. If the cost price is ₹400, what is the marked price?',
      marks: 5, negativeMarks: 0.5, section: 1, orderIndex: 2,
      mcqOptions: [
        { id: 'a', text: '₹500' }, { id: 'b', text: '₹600' },
        { id: 'c', text: '₹625' }, { id: 'd', text: '₹550' },
      ],
      mcqCorrectAnswer: 'c',
    },
    {
      title: 'Time Complexity',
      description: 'What is the average time complexity of QuickSort?',
      marks: 5, negativeMarks: 0.5, section: 1, orderIndex: 3,
      mcqOptions: [
        { id: 'a', text: 'O(n)' }, { id: 'b', text: 'O(n log n)' },
        { id: 'c', text: 'O(n²)' }, { id: 'd', text: 'O(log n)' },
      ],
      mcqCorrectAnswer: 'b',
    },
    {
      title: 'Data Structure',
      description: 'Which data structure uses LIFO (Last In First Out) principle?',
      marks: 5, negativeMarks: 0.5, section: 1, orderIndex: 4,
      mcqOptions: [
        { id: 'a', text: 'Queue' }, { id: 'b', text: 'Array' },
        { id: 'c', text: 'Stack' }, { id: 'd', text: 'Linked List' },
      ],
      mcqCorrectAnswer: 'c',
    },
    {
      title: 'SQL Knowledge',
      description: 'Which SQL clause is used to filter groups created by GROUP BY?',
      marks: 5, negativeMarks: 0.5, section: 1, orderIndex: 5,
      mcqOptions: [
        { id: 'a', text: 'WHERE' }, { id: 'b', text: 'HAVING' },
        { id: 'c', text: 'FILTER' }, { id: 'd', text: 'GROUP FILTER' },
      ],
      mcqCorrectAnswer: 'b',
    },
    {
      title: 'Probability',
      description: 'Two dice are thrown. What is the probability that the sum is 7?',
      marks: 5, negativeMarks: 0.5, section: 1, orderIndex: 6,
      mcqOptions: [
        { id: 'a', text: '1/6' }, { id: 'b', text: '1/12' },
        { id: 'c', text: '5/36' }, { id: 'd', text: '7/36' },
      ],
      mcqCorrectAnswer: 'a',
    },
    {
      title: 'OOP Concepts',
      description: 'Which OOP principle allows a class to have multiple methods with the same name but different parameters?',
      marks: 5, negativeMarks: 0.5, section: 1, orderIndex: 7,
      mcqOptions: [
        { id: 'a', text: 'Encapsulation' }, { id: 'b', text: 'Inheritance' },
        { id: 'c', text: 'Polymorphism (Overloading)' }, { id: 'd', text: 'Abstraction' },
      ],
      mcqCorrectAnswer: 'c',
    },
    {
      title: 'Network Basics',
      description: 'Which protocol is used for secure web communication?',
      marks: 5, negativeMarks: 0.5, section: 1, orderIndex: 8,
      mcqOptions: [
        { id: 'a', text: 'HTTP' }, { id: 'b', text: 'FTP' },
        { id: 'c', text: 'HTTPS' }, { id: 'd', text: 'SMTP' },
      ],
      mcqCorrectAnswer: 'c',
    },
    {
      title: 'Number Series',
      description: 'Find the missing number: 1, 1, 2, 3, 5, 8, 13, ?',
      marks: 5, negativeMarks: 0.5, section: 1, orderIndex: 9,
      mcqOptions: [
        { id: 'a', text: '18' }, { id: 'b', text: '20' },
        { id: 'c', text: '21' }, { id: 'd', text: '15' },
      ],
      mcqCorrectAnswer: 'c',
    },
  ];

  const savedMcqs: any[] = [];
  for (const q of mcqQuestions) {
    const saved = await questionsRepo.save({ testId, type: 'mcq', ...q });
    savedMcqs.push(saved);
  }
  for (const m of savedMcqs) {
    await paperQuestionsRepo.save({ paperId: (paper1 as any).id, questionId: (m as any).id });
  }
  console.log(`Created ${mcqQuestions.length} MCQ questions (Paper 1, 50 marks total)`);

  // ════════════════════════════════════════════════════════════
  // SECTION 2: Coding Questions
  // ════════════════════════════════════════════════════════════

  const q1 = await questionsRepo.save({
    testId, type: 'coding', section: 2, orderIndex: 0,
    title: 'FizzBuzz',
    description: `Print numbers from 1 to N. For multiples of 3 print "Fizz", for multiples of 5 print "Buzz", for multiples of both print "FizzBuzz".\n\n**Input:** Single integer N\n**Output:** N lines, each containing the number or Fizz/Buzz/FizzBuzz\n\n**Example:**\nInput: 5\nOutput:\n1\n2\nFizz\n4\nBuzz`,
    marks: 15, allowedLanguages: [71, 63, 54, 62],
  });

  await testCasesRepo.save([
    { questionId: (q1 as any).id, input: '5', expectedOutput: '1\n2\nFizz\n4\nBuzz', isHidden: false },
    { questionId: (q1 as any).id, input: '15', expectedOutput: '1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz', isHidden: false },
    { questionId: (q1 as any).id, input: '3', expectedOutput: '1\n2\nFizz', isHidden: true },
    { questionId: (q1 as any).id, input: '1', expectedOutput: '1', isHidden: true },
    { questionId: (q1 as any).id, input: '30', expectedOutput: '1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz\n16\n17\nFizz\n19\nBuzz\nFizz\n22\n23\nFizz\nBuzz\n26\nFizz\n28\n29\nFizzBuzz', isHidden: true },
  ]);

  const q2 = await questionsRepo.save({
    testId, type: 'coding', section: 2, orderIndex: 1,
    title: 'Two Sum',
    description: `Given an array of integers and a target, find two numbers that add up to target.\n\nPrint the two numbers space-separated in ascending order.\n\n**Input:**\nLine 1: N (array size)\nLine 2: N space-separated integers\nLine 3: target\n\n**Output:** Two space-separated integers\n\n**Example:**\nInput:\n4\n2 7 11 15\n9\nOutput:\n2 7`,
    marks: 20, allowedLanguages: [71, 63, 54, 62],
  });

  await testCasesRepo.save([
    { questionId: (q2 as any).id, input: '4\n2 7 11 15\n9', expectedOutput: '2 7', isHidden: false },
    { questionId: (q2 as any).id, input: '3\n3 2 4\n6', expectedOutput: '2 4', isHidden: false },
    { questionId: (q2 as any).id, input: '5\n1 5 3 7 2\n8', expectedOutput: '1 7', isHidden: true },
    { questionId: (q2 as any).id, input: '4\n-1 0 3 5\n2', expectedOutput: '-1 3', isHidden: true },
    { questionId: (q2 as any).id, input: '6\n10 20 30 40 50 60\n70', expectedOutput: '10 60', isHidden: true },
  ]);

  const q3 = await questionsRepo.save({
    testId, type: 'coding', section: 2, orderIndex: 2,
    title: 'Reverse Words',
    description: `Given a string of words separated by spaces, reverse the order of the words.\n\n**Input:** A single line string\n**Output:** Words in reversed order\n\n**Example:**\nInput: hello world foo\nOutput: foo world hello`,
    marks: 15, allowedLanguages: [71, 63, 54, 62],
  });

  await testCasesRepo.save([
    { questionId: (q3 as any).id, input: 'hello world foo', expectedOutput: 'foo world hello', isHidden: false },
    { questionId: (q3 as any).id, input: 'the quick brown fox', expectedOutput: 'fox brown quick the', isHidden: false },
    { questionId: (q3 as any).id, input: 'a', expectedOutput: 'a', isHidden: true },
    { questionId: (q3 as any).id, input: 'one two three four five', expectedOutput: 'five four three two one', isHidden: true },
  ]);

  for (const q of [q1, q2, q3]) {
    await paperQuestionsRepo.save({ paperId: (paper2 as any).id, questionId: (q as any).id });
  }
  console.log('Created 3 Coding questions (Paper 2, 50 marks total)');
  console.log('');
  console.log('=== SEED COMPLETE ===');
  console.log('Test: Full Stack Developer Assessment');
  console.log('  Paper 1 (MCQ):    10 questions, 50 marks, cutoff=percent 40%, fail=lock_next');
  console.log('  Paper 2 (Coding): 3 questions,  50 marks, no cutoff (unlocks if Paper 1 passes)');
  console.log('  Timer mode: per_paper, time carry-over: off');
  console.log('  Total: 100 marks, 90 minutes (30 + 60)');
  console.log('');
  console.log('Admin:   admin@codeassess.com / admin123');
  console.log('Student: student@codeassess.com / student123');

  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
