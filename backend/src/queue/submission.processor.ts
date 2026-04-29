import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Submission, SubmissionStatus } from '../submissions/submission.entity';
import { Judge0Service } from '../judge0/judge0.service';
import { QuestionsService } from '../questions/questions.service';
import { SubmissionJobData } from './submission.producer';

@Processor('submissions', { concurrency: 5 })
export class SubmissionProcessor extends WorkerHost {
  private readonly logger = new Logger(SubmissionProcessor.name);

  constructor(
    @InjectRepository(Submission)
    private submissionsRepo: Repository<Submission>,
    private judge0Service: Judge0Service,
    private questionsService: QuestionsService,
  ) {
    super();
  }

  async process(job: Job<SubmissionJobData>): Promise<void> {
    const { submissionId, questionId, sourceCode, languageId, isFinal } = job.data;
    this.logger.log(`Processing submission ${submissionId}`);

    try {
      await this.submissionsRepo.update(submissionId, {
        status: SubmissionStatus.PROCESSING,
      });

      const testCases = await this.questionsService.getTestCasesForExecution(questionId);
      const results: any[] = [];
      let passedCount = 0;
      let totalTime = 0;
      let maxMemory = 0;

      for (const tc of testCases) {
        try {
          const result = await this.judge0Service.submitAndWait({
            source_code: sourceCode,
            language_id: languageId,
            stdin: tc.input,
            expected_output: tc.expectedOutput,
          });

          // Status 3 = Accepted
          const passed = result.status.id === 3;
          if (passed) passedCount++;

          const time = parseFloat(result.time || '0');
          totalTime += time;
          if (result.memory && result.memory > maxMemory) {
            maxMemory = result.memory;
          }

          results.push({
            testCaseId: tc.id,
            isHidden: tc.isHidden,
            passed,
            status: result.status.description,
            stdout: result.stdout,
            stderr: result.stderr,
            compileOutput: result.compile_output,
            time: result.time,
            memory: result.memory,
          });
        } catch (error: any) {
          results.push({
            testCaseId: tc.id,
            isHidden: tc.isHidden,
            passed: false,
            status: 'Runtime Error',
            error: error.message,
          });
        }
      }

      const question = await this.questionsService.findById(questionId);
      const score =
        testCases.length > 0
          ? (passedCount / testCases.length) * question.marks
          : 0;

      await this.submissionsRepo.update(submissionId, {
        status: SubmissionStatus.COMPLETED,
        result: { testCaseResults: results, passedCount, totalCount: testCases.length } as any,
        score: Math.round(score * 100) / 100,
        executionTime: Math.round(totalTime * 10000) / 10000,
        memoryUsed: maxMemory,
      });

      this.logger.log(
        `Submission ${submissionId} completed: ${passedCount}/${testCases.length} passed, score: ${score}`,
      );
    } catch (error: any) {
      this.logger.error(`Submission ${submissionId} failed: ${error.message}`);
      await this.submissionsRepo.update(submissionId, {
        status: SubmissionStatus.FAILED,
        result: { error: error.message },
      });
      throw error;
    }
  }
}
