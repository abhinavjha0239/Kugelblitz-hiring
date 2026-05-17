import { IsIn } from 'class-validator';

export class ReportAntiCheatDto {
  @IsIn(['tab_switch', 'fullscreen_exit'])
  type: 'tab_switch' | 'fullscreen_exit';
}
