import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { MAIL_QUEUE, JOB_INVITE } from './mail.processor.constants';

export interface InvitePayload {
  to: string;
  candidateName?: string | null;
  testTitle: string;
  link: string;
  validFrom: Date | string;
  validUntil: Date | string;
  // Set when the test mandates Safe Exam Browser. The HTML/text invite gets
  // an extra block telling the candidate how to download SEB and which apps
  // to close before launch.
  requireSafeExamBrowser?: boolean;
  sebConfigUrl?: string;
}

interface SenderConfig {
  user: string;
  pass: string;
  from: string;
}

interface SenderRuntime extends SenderConfig {
  transporter: Transporter;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private senders: SenderRuntime[] = [];
  private senderIdx = 0;
  private host: string | undefined;
  private port: number;
  private rateLimitPerMin: number;

  constructor(
    private readonly config: ConfigService,
    @InjectQueue(MAIL_QUEUE) private readonly queue: Queue<InvitePayload>,
  ) {
    this.host = this.config.get<string>('SMTP_HOST');
    this.port = parseInt(this.config.get<string>('SMTP_PORT') || '587', 10);
    this.rateLimitPerMin = parseInt(this.config.get<string>('SMTP_RATE_PER_MINUTE') || '30', 10);
    this.senders = this.buildSenders();
    if (this.senders.length > 0) {
      this.logger.log(
        `SMTP configured: host=${this.host}:${this.port} senders=${this.senders.length} rate=${this.rateLimitPerMin}/min/sender`,
      );
    } else {
      this.logger.warn('SMTP not configured (SMTP_HOST/USER/PASS missing) — emails will be logged to console.');
    }
  }

  /**
   * Reads SMTP_USER + SMTP_PASS, plus SMTP_USER_2/SMTP_PASS_2, SMTP_USER_3/SMTP_PASS_3, …
   * for round-robin multi-mailbox sending. Each gets its own pooled transporter
   * with maxConnections + per-minute rate limit (Microsoft 365 default 30/min).
   */
  private buildSenders(): SenderRuntime[] {
    if (!this.host) return [];
    const out: SenderRuntime[] = [];
    const probes = [['SMTP_USER', 'SMTP_PASS', 'MAIL_FROM']];
    for (let i = 2; i <= 20; i++) {
      probes.push([`SMTP_USER_${i}`, `SMTP_PASS_${i}`, `MAIL_FROM_${i}`]);
    }
    for (const [uKey, pKey, fKey] of probes) {
      const user = this.config.get<string>(uKey);
      const pass = this.config.get<string>(pKey);
      if (!user || !pass) continue;
      const from = this.config.get<string>(fKey) || user;
      const transporter = nodemailer.createTransport({
        host: this.host,
        port: this.port,
        secure: this.port === 465,
        auth: { user, pass },
        tls: { ciphers: 'SSLv3' },
        pool: true,
        maxConnections: parseInt(this.config.get<string>('SMTP_POOL_MAX_CONNECTIONS') || '5', 10),
        maxMessages: 100,
        rateDelta: 60_000,
        rateLimit: this.rateLimitPerMin,
      } as any);
      out.push({ user, pass, from, transporter });
    }
    return out;
  }

  /** Round-robin pick a sender for one outgoing message. */
  private nextSender(): SenderRuntime | null {
    if (this.senders.length === 0) return null;
    const s = this.senders[this.senderIdx % this.senders.length];
    this.senderIdx = (this.senderIdx + 1) % this.senders.length;
    return s;
  }

  /**
   * Enqueue many invites for background sending. Returns queueId per row so
   * the admin UI can poll progress. Default attempts=5 with exponential backoff
   * (handles transient SMTP failures, throttling).
   */
  async enqueueInvites(payloads: InvitePayload[]): Promise<{ jobIds: string[]; queueName: string }> {
    if (payloads.length === 0) return { jobIds: [], queueName: MAIL_QUEUE };
    const jobs = await this.queue.addBulk(
      payloads.map((p, i) => ({
        name: JOB_INVITE,
        data: p,
        opts: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { age: 3600, count: 1000 }, // keep recent 1h / 1000 for status
          removeOnFail: { age: 86_400 },
        },
      })),
    );
    return { jobIds: jobs.map((j) => String(j.id)), queueName: MAIL_QUEUE };
  }

  async getQueueStats() {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    return counts;
  }

  /** Direct send (used by the worker). Falls back to console-log if SMTP unconfigured. */
  async sendInvite(payload: InvitePayload): Promise<{ delivered: boolean; senderUsed: string | null }> {
    const { to, candidateName, testTitle, link, validFrom, validUntil, requireSafeExamBrowser, sebConfigUrl } = payload;
    const greeting = candidateName ? `Hi ${candidateName},` : 'Hi there,';
    const subject = `Your invitation: ${testTitle}`;
    const validFromDate = new Date(validFrom);
    const validUntilDate = new Date(validUntil);
    // Plaintext fallback. Single visible URL (the magic link) — the SEB
    // launch URL is intentionally NOT shown in plaintext to keep the message
    // simple. SEB candidates first land on the web page anyway, which has
    // its own "Launch in Safe Exam Browser" button.
    const sebTextLine = requireSafeExamBrowser
      ? '\nThis exam runs in Safe Exam Browser. The link will guide you through setup.\n'
      : '';
    const text = [
      greeting, '',
      `You've been invited to ${testTitle}.`, '',
      `Click here to start: ${link}`, '',
      `Opens:  ${formatDate(validFromDate)}`,
      `Closes: ${formatDate(validUntilDate)}`,
      sebTextLine,
      'Tip: if your laptop crashes mid-exam, click the same link again to resume.',
      '',
      '— Graviton',
    ].join('\n');

    const html = renderInviteHtml({
      greeting,
      testTitle,
      link,
      validFromLabel: formatDate(validFromDate),
      validUntilLabel: formatDate(validUntilDate),
      sebRequired: !!requireSafeExamBrowser,
      sebConfigUrl: sebConfigUrl || null,
    });

    const sender = this.nextSender();
    if (!sender) {
      // Don't log the magic link itself — it's a single-use auth credential.
      // The fallback path only runs when SMTP is unconfigured (dev), but logs
      // can still leak via stdout to centralized collectors.
      this.logger.log(`[INVITE FALLBACK] to=${to} linkLen=${link.length}`);
      return { delivered: false, senderUsed: null };
    }
    try {
      await sender.transporter.sendMail({
        from: sender.from,
        to,
        subject,
        text,
        html,
      });
      return { delivered: true, senderUsed: sender.user };
    } catch (err: any) {
      this.logger.error(`SMTP send failed via ${sender.user} to ${to}: ${err.message}`);
      throw err; // BullMQ will retry per attempts policy
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Format a date in IST (most candidates are India-based) like
// "Mon, 12 May 2026 · 09:00 IST" — readable across regions and avoids
// the unhelpful raw ISO/UTC string in the previous template.
function formatDate(d: Date): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-IN', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Kolkata',
    });
    const parts = fmt.formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
    return `${get('weekday')}, ${get('day')} ${get('month')} ${get('year')} · ${get('hour')}:${get('minute')} IST`;
  } catch {
    return d.toUTCString();
  }
}

interface InviteHtmlVars {
  greeting: string;
  testTitle: string;
  link: string;
  validFromLabel: string;
  validUntilLabel: string;
  sebRequired?: boolean;
  sebConfigUrl?: string | null;
}

// Bulletproof HTML email: table-based layout, all CSS inlined, VML
// fallback button for Outlook desktop, mobile-responsive via @media
// queries (Apple Mail / Gmail iOS support them; Gmail web ignores them
// but the desktop layout still looks right).
//
// Design intent: ONE primary CTA — the magic link. The candidate lands on
// our web page first; from there they download SEB if needed. We do NOT
// expose `sebs://` URLs, app names ("TeamViewer/AnyDesk/…"), or any other
// implementation detail in the email itself. The web page handles the
// SEB-launch step with its own UI.
function renderInviteHtml(v: InviteHtmlVars): string {
  const title = escapeHtml(v.testTitle);
  const greet = escapeHtml(v.greeting);
  const fromLabel = escapeHtml(v.validFromLabel);
  const untilLabel = escapeHtml(v.validUntilLabel);
  const link = v.link; // anchor href — not user-supplied content
  // Inline SEB notice (one short line, NOT a separate launch path). We send
  // candidates to the magic-link landing page in their normal browser; that
  // page detects SEB-required and walks them through download + launch.
  const sebInlineNotice = v.sebRequired
    ? `
                <tr>
                  <td class="px" style="padding:0 40px 8px 40px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td valign="top" style="width:36px;padding-top:2px;">
                          <div style="width:28px;height:28px;border-radius:50%;background:#fef3c7;text-align:center;line-height:28px;font-size:14px;">🔒</div>
                        </td>
                        <td valign="top" style="padding-left:12px;">
                          <p class="text-primary" style="margin:0 0 4px 0;color:#0f172a;font-size:14px;line-height:20px;font-weight:600;">Locked-down exam</p>
                          <p class="text-muted" style="margin:0;color:#64748b;font-size:13px;line-height:20px;">
                            This assessment runs in a secure browser. The link will guide you through the quick setup before the exam starts.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`
    : '';
  const preheader = `You're invited to ${title}. Window: ${fromLabel} → ${untilLabel}.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${title}</title>
<!--[if mso]>
<style>* { font-family: 'Segoe UI', Arial, sans-serif !important; }</style>
<![endif]-->
<style>
  @media (max-width: 600px) {
    .container { width: 100% !important; }
    .px { padding-left: 24px !important; padding-right: 24px !important; }
    .h1 { font-size: 24px !important; line-height: 32px !important; }
    .cta { padding: 14px 28px !important; font-size: 16px !important; }
    .meta-cell { display: block !important; width: 100% !important; padding: 12px 0 !important; }
  }
  @media (prefers-color-scheme: dark) {
    .bg-page { background: #0b0d12 !important; }
    .bg-card { background: #14161d !important; }
    .text-primary { color: #f3f4f6 !important; }
    .text-muted { color: #9ca3af !important; }
    .divider { border-color: #232733 !important; }
    .meta-card { background: #1a1d26 !important; border-color: #232733 !important; }
  }
</style>
</head>
<body class="bg-page" style="margin:0;padding:0;background:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="display:none;font-size:1px;color:#f5f7fb;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f7fb;" class="bg-page">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;">
          <!-- Brand header -->
          <tr>
            <td align="center" style="padding:0 0 24px 0;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td valign="middle" style="padding-right:10px;">
                    <div style="width:32px;height:32px;background:#2563eb;border-radius:9px;text-align:center;line-height:32px;color:#ffffff;font-weight:700;font-size:18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">G</div>
                  </td>
                  <td valign="middle">
                    <span style="color:#0f172a;font-weight:700;font-size:18px;letter-spacing:1px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">GRAVITON</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td class="bg-card" style="background:#ffffff;border-radius:16px;box-shadow:0 2px 16px rgba(15,23,42,0.05);overflow:hidden;">
              <!-- Body -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td class="px" style="padding:40px 40px 12px 40px;">
                    <p class="text-muted" style="margin:0 0 6px 0;color:#64748b;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Assessment invitation</p>
                    <h1 class="h1" style="margin:0 0 24px 0;color:#0f172a;font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.4px;">${title}</h1>
                    <p class="text-primary" style="margin:0 0 8px 0;color:#0f172a;font-size:16px;line-height:24px;">${greet}</p>
                    <p class="text-muted" style="margin:0 0 28px 0;color:#475569;font-size:15px;line-height:24px;">
                      You've been invited to take an assessment. Click the button below to begin — you'll be signed in automatically, no password needed.
                    </p>
                    <!-- Bulletproof CTA button -->
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto;">
                      <tr>
                        <td align="center" style="border-radius:10px;background:#2563eb;">
                          <!--[if mso]>
                          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${link}" style="height:52px;v-text-anchor:middle;width:220px;" arcsize="20%" stroke="f" fillcolor="#2563eb">
                            <w:anchorlock/>
                            <center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:700;">Start assessment →</center>
                          </v:roundrect>
                          <![endif]-->
                          <!--[if !mso]><!-- -->
                          <a href="${link}" class="cta" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:16px;font-weight:700;line-height:20px;text-decoration:none;padding:16px 32px;border-radius:10px;mso-hide:all;">
                            Start assessment&nbsp;&nbsp;→
                          </a>
                          <!--<![endif]-->
                        </td>
                      </tr>
                    </table>
                    <p class="text-muted" style="margin:14px 0 0 0;text-align:center;color:#94a3b8;font-size:12px;line-height:18px;">
                      Trouble with the button? <a href="${link}" style="color:#2563eb;text-decoration:underline;">Click here</a> to open it directly.
                    </p>
                    <p class="text-muted" style="margin:6px 0 0 0;text-align:center;color:#94a3b8;font-size:12px;line-height:18px;">
                      This link is unique to you. Please don't share it.
                    </p>
                  </td>
                </tr>
                <!-- Window card -->
                <tr>
                  <td class="px" style="padding:20px 40px 8px 40px;">
                    <table role="presentation" class="meta-card" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
                      <tr>
                        <td style="padding:18px 22px;">
                          <p class="text-muted" style="margin:0 0 12px 0;color:#64748b;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Exam window</p>
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                            <tr>
                              <td class="meta-cell" valign="top" style="padding-right:16px;width:50%;">
                                <p class="text-muted" style="margin:0 0 4px 0;color:#94a3b8;font-size:11px;letter-spacing:0.5px;">OPENS</p>
                                <p class="text-primary" style="margin:0;color:#0f172a;font-size:14px;line-height:20px;font-weight:600;">${fromLabel}</p>
                              </td>
                              <td class="meta-cell" valign="top" style="width:50%;">
                                <p class="text-muted" style="margin:0 0 4px 0;color:#94a3b8;font-size:11px;letter-spacing:0.5px;">CLOSES</p>
                                <p class="text-primary" style="margin:0;color:#0f172a;font-size:14px;line-height:20px;font-weight:600;">${untilLabel}</p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                ${sebInlineNotice}
                <!-- Resume tip -->
                <tr>
                  <td class="px" style="padding:8px 40px 32px 40px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td valign="top" style="width:36px;padding-top:2px;">
                          <div style="width:28px;height:28px;border-radius:50%;background:#dbeafe;text-align:center;line-height:28px;font-size:14px;">💡</div>
                        </td>
                        <td valign="top" style="padding-left:12px;">
                          <p class="text-primary" style="margin:0 0 4px 0;color:#0f172a;font-size:14px;line-height:20px;font-weight:600;">Laptop crashed mid-exam?</p>
                          <p class="text-muted" style="margin:0;color:#64748b;font-size:13px;line-height:20px;">
                            Just click the link again — you'll resume right where you left off.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding:20px 16px 8px 16px;">
              <p class="text-muted" style="margin:0;color:#94a3b8;font-size:12px;line-height:18px;">
                Graviton · You received this because someone invited you to an assessment.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
