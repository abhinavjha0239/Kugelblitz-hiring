-- Extend ViolationType enum to include OUT_OF_SCOPE_ACCESS, used by the
-- InviteScopeGuard when a magic-link candidate tries to access another
-- candidate's exam (URL-bar manipulation, forged JWT testId, stolen .seb).
-- Also allow participation_id NULL because OUT_OF_SCOPE_ACCESS can fire
-- before the candidate has started a participation (e.g. they hit
-- /api/admin/* the moment they get the JWT).
--
-- Idempotent: re-running on a DB that already has the value is a no-op.
-- Run BEFORE deploying the new backend image so the audit insert path
-- doesn't fail on the first violation.

ALTER TABLE violation_logs MODIFY COLUMN type
  ENUM(
    'tab_switch',
    'fullscreen_exit',
    'copy_paste',
    'rapid_answer',
    'multiple_ip',
    'seb_header_missing',
    'seb_header_mismatch',
    'seb_preflight_failed',
    'out_of_scope_access'
  ) NOT NULL;

ALTER TABLE violation_logs MODIFY COLUMN participation_id VARCHAR(255) NULL;
