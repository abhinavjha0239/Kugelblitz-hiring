import { Injectable, Logger, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface Judge0Submission {
  source_code: string;
  language_id: number;
  stdin?: string;
  expected_output?: string;
  cpu_time_limit?: number;
  memory_limit?: number;
}

export interface Judge0Result {
  token: string;
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  status: { id: number; description: string };
  time: string | null;
  memory: number | null;
}

@Injectable()
export class Judge0Service {
  private readonly logger = new Logger(Judge0Service.name);
  private client: AxiosInstance;

  constructor(private configService: ConfigService) {
    const baseURL = this.configService.get<string>('judge0.apiUrl');
    const apiKey = this.configService.get<string>('judge0.apiKey');

    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: apiKey ? { 'X-Auth-Token': apiKey } : {},
    });
  }

  async submitCode(submission: Judge0Submission): Promise<string> {
    try {
      const { data } = await this.client.post('/submissions', {
        ...submission,
        source_code: Buffer.from(submission.source_code).toString('base64'),
        stdin: submission.stdin
          ? Buffer.from(submission.stdin).toString('base64')
          : undefined,
        expected_output: submission.expected_output
          ? Buffer.from(submission.expected_output).toString('base64')
          : undefined,
        base64_encoded: true,
      });
      return data.token;
    } catch (error: any) {
      this.logger.error(`Judge0 submit error: ${error.message}`);
      throw new HttpException(
        `Code execution service error: ${error.message}`,
        error.response?.status || 500,
      );
    }
  }

  async getResult(token: string): Promise<Judge0Result> {
    try {
      const { data } = await this.client.get(
        `/submissions/${token}?base64_encoded=true&fields=token,stdout,stderr,compile_output,status,time,memory`,
      );
      return {
        ...data,
        stdout: data.stdout ? Buffer.from(data.stdout, 'base64').toString() : null,
        stderr: data.stderr ? Buffer.from(data.stderr, 'base64').toString() : null,
        compile_output: data.compile_output
          ? Buffer.from(data.compile_output, 'base64').toString()
          : null,
      };
    } catch (error: any) {
      this.logger.error(`Judge0 result error: ${error.message}`);
      throw new HttpException(
        `Code execution service error: ${error.message}`,
        error.response?.status || 500,
      );
    }
  }

  async submitAndWait(submission: Judge0Submission, maxRetries = 20): Promise<Judge0Result> {
    const token = await this.submitCode(submission);

    for (let i = 0; i < maxRetries; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const result = await this.getResult(token);

      // Status IDs: 1 = In Queue, 2 = Processing
      if (result.status.id > 2) {
        return result;
      }
    }

    throw new HttpException('Code execution timed out', 408);
  }

  async runCode(
    sourceCode: string,
    languageId: number,
    stdin?: string,
  ): Promise<Judge0Result> {
    return this.submitAndWait({
      source_code: sourceCode,
      language_id: languageId,
      stdin,
    });
  }

  async getLanguages(): Promise<any[]> {
    const { data } = await this.client.get('/languages');
    return data;
  }
}
