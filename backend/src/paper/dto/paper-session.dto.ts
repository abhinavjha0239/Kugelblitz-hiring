import { IsObject, IsOptional } from 'class-validator';

// paperId comes from the URL — body should not duplicate it. Including the
// field in the body let a malicious autosave target a paper different from
// the URL. Both DTOs accept only `answers`.

export class SubmitPaperDto {
  @IsObject()
  @IsOptional()
  answers?: Record<string, string>;
}

export class AutosavePaperAnswersDto {
  @IsObject()
  answers: Record<string, string>;
}
