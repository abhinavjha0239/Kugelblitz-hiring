import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Test } from '../tests/test.entity';
import { MagicLink } from '../magic-link/magic-link.entity';

interface ProhibitedProc {
  name: string;
  // 0 = Windows, 1 = macOS, 2 = both (admin overrides)
  os: 0 | 1 | 2;
}

@Injectable()
export class SebService {
  private readonly logger = new Logger(SebService.name);

  // Default prohibited processes — covers the major remote-desktop /
  // screen-share / recording / VM tools across Windows + macOS. SEB will
  // refuse to start (or close them on launch with strongKill=true) if any
  // are detected on the candidate's machine.
  private static readonly DEFAULT_PROHIBITED_PROCESSES: ReadonlyArray<ProhibitedProc> = [
    // ─── Remote desktop ───────────────────────────────────────────
    { name: 'TeamViewer.exe', os: 0 }, { name: 'TeamViewer', os: 1 },
    { name: 'AnyDesk.exe', os: 0 }, { name: 'AnyDesk', os: 1 },
    { name: 'mstsc.exe', os: 0 },
    { name: 'rdpclip.exe', os: 0 },
    { name: 'QuickAssist.exe', os: 0 },
    { name: 'msra.exe', os: 0 },
    { name: 'remote_desktop', os: 1 },
    { name: 'chrome_remote_desktop', os: 1 },
    { name: 'vncviewer.exe', os: 0 }, { name: 'vncserver.exe', os: 0 },
    { name: 'tightvnc.exe', os: 0 }, { name: 'realvnc.exe', os: 0 },
    { name: 'logmein.exe', os: 0 }, { name: 'g2mlauncher.exe', os: 0 },
    { name: 'parsec.exe', os: 0 }, { name: 'parsecd', os: 1 },
    { name: 'sunshine.exe', os: 0 }, { name: 'moonlight.exe', os: 0 },
    { name: 'splashtop.exe', os: 0 },
    // ─── Screen share / record / streaming ────────────────────────
    { name: 'obs64.exe', os: 0 }, { name: 'obs.exe', os: 0 }, { name: 'OBS', os: 1 },
    { name: 'Zoom.exe', os: 0 }, { name: 'zoom.us', os: 1 },
    { name: 'Teams.exe', os: 0 }, { name: 'Microsoft Teams', os: 1 },
    { name: 'Discord.exe', os: 0 }, { name: 'Discord', os: 1 },
    { name: 'Slack.exe', os: 0 }, { name: 'Slack', os: 1 },
    { name: 'GoogleMeet', os: 1 },
    { name: 'ShareX.exe', os: 0 }, { name: 'snagit32.exe', os: 0 },
    { name: 'Camtasia.exe', os: 0 }, { name: 'ScreenFlow', os: 1 },
    { name: 'Loom.exe', os: 0 }, { name: 'Loom', os: 1 },
    // ─── Virtualization (belt-and-braces with allowVirtualMachine=false)
    { name: 'vmware-vmx.exe', os: 0 }, { name: 'vmware', os: 1 },
    { name: 'VirtualBox.exe', os: 0 }, { name: 'VirtualBoxVM', os: 1 },
    { name: 'prl_client_app', os: 1 },
    // ─── Sniffers / debug tools that defeat lockdown ──────────────
    { name: 'wireshark.exe', os: 0 }, { name: 'Wireshark', os: 1 },
    { name: 'fiddler.exe', os: 0 },
  ];

  constructor(
    @InjectRepository(MagicLink) private linksRepo: Repository<MagicLink>,
    private readonly config: ConfigService,
  ) {}

  // Lazily generate (and persist) the per-link Browser Exam Key + salt.
  // Per-link, not per-test — so a leaked .seb is useless against another
  // candidate. Both values are stable for the lifetime of the link so the
  // candidate can re-download the .seb (or resume after a crash) without
  // invalidating their session.
  //
  // SEB 3.5+ derives the effective BEK from these two as
  //   effectiveBEK = HMAC-SHA256(bek_bytes, salt_bytes)
  // and uses its lowercase hex string when computing the request hash.
  async ensureLinkBek(link: MagicLink): Promise<{ bek: string; salt: string }> {
    let dirty = false;
    if (!link.sebBrowserExamKey) {
      link.sebBrowserExamKey = crypto.randomBytes(32).toString('hex');
      dirty = true;
    }
    if (!link.sebExamKeySalt) {
      link.sebExamKeySalt = crypto.randomBytes(32).toString('hex');
      dirty = true;
    }
    if (dirty) await this.linksRepo.save(link);
    return { bek: link.sebBrowserExamKey, salt: link.sebExamKeySalt! };
  }

  // Build the .seb config file. Returns a Buffer of plain XML plist (UTF-8).
  // SEB accepts plain plist or AES-encrypted; plain is simpler and safe enough
  // because the BEK is per-candidate.
  buildSebConfig(input: {
    test: Test;
    link: MagicLink;
    appBaseUrl: string;
  }): Buffer {
    const { test, link, appBaseUrl } = input;
    const bek = link.sebBrowserExamKey;
    const salt = link.sebExamKeySalt;
    if (!bek || !salt) {
      throw new Error('BEK/salt not provisioned — call ensureLinkBek first');
    }
    const allowedHost = new URL(appBaseUrl).host;
    const startUrl = `${appBaseUrl}/exam/${link.token}`;
    const quitUrl =
      test.sebQuitUrl ||
      `${appBaseUrl}/student/results/${test.id}?seb=quit`;
    const quitHash = this.config.get<string>('SEB_QUIT_PASSWORD_HASH') || '';

    // Expand "os: 2 (both)" entries into TWO entries (Windows + macOS)
    // because SEB only knows os: 0 (Win) and os: 1 (macOS) — there is no
    // "both" value, so the parser would reject the whole config.
    const expandOsBoth = (procs: ReadonlyArray<ProhibitedProc>): Array<{ name: string; os: 0 | 1 }> => {
      const out: Array<{ name: string; os: 0 | 1 }> = [];
      for (const p of procs) {
        if (p.os === 2) {
          out.push({ name: p.name, os: 0 });
          out.push({ name: p.name, os: 1 });
        } else {
          out.push({ name: p.name, os: p.os });
        }
      }
      return out;
    };
    const extra: ProhibitedProc[] = (test.sebExtraProhibitedProcesses || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name, os: 2 as const }));
    const allProcs = expandOsBoth([...SebService.DEFAULT_PROHIBITED_PROCESSES, ...extra]);

    // SEB stores BEK and salt as binary data (NSData) in the plist, not
    // strings. Wrap them with the {__plist:'data'} sentinel so the
    // serializer emits <data>BASE64</data>. Both are persisted on the
    // magic-link as hex; decode here.
    const bekBytes = Buffer.from(bek, 'hex');
    const saltBytes = Buffer.from(salt, 'hex');

    const cfg: Record<string, any> = {
      // ─── Start / quit ──────────────────────────────────────────
      startURL: startUrl,
      quitURL: quitUrl,
      quitURLConfirm: false,
      hashedQuitPassword: quitHash,
      // ─── BEK / config-key ──────────────────────────────────────
      browserExamKey: { __plist: 'data', value: bekBytes },
      sendBrowserExamKey: true,
      examKeySalt: { __plist: 'data', value: saltBytes },
      // ─── Fullscreen / chrome ───────────────────────────────────
      browserViewMode: 1,
      mainBrowserWindowPositioning: 1,
      // mainBrowserWindowWidth/Height: SEB requires INT pixels; "100%" is
      // not a valid value here. Omit and let SEB default to fullscreen
      // (browserViewMode=1 already forces fullscreen).
      enableTouchExit: false,
      showTaskBar: false,
      showReloadButton: false,
      showMenuBar: false,
      showTime: true,
      browserUserAgentDesktopMode: 0,
      // ─── URL filter ────────────────────────────────────────────
      // URLFilterEnable: filters MAIN-PAGE navigations against the
      // whitelist (we want this — blocks Stack Overflow / ChatGPT etc.).
      //
      // URLFilterEnableContentFilter: when true, ALSO filters every
      // sub-resource — including XHR/fetch. SEB silently rejected our
      // /api/auth/magic POST because of this, leaving the candidate
      // stuck on "Validating link…". Sub-resources on the SAME origin
      // are already trusted (the page itself was whitelisted), so
      // turning the content filter OFF is safe and unblocks the API.
      URLFilterEnable: true,
      URLFilterEnableContentFilter: false,
      // ─── Per-candidate URL scoping ───────────────────────────
      // `whitelistURLFilter` (string) is the LCD fallback for SEB versions
      // that don't honor URLFilterRules. Keep it host-permissive so we
      // never break the exam in a buggy SEB version — the granular gate
      // is the array below, and the backend (InviteScopeGuard) is the
      // hard gate. This filter is OR'd with URLFilterRules.
      whitelistURLFilter: `*://${allowedHost}/*`,
      blacklistURLFilter: '',
      // Granular allow-list. Modern SEB treats unmatched URLs as denied
      // when URLFilterRules is non-empty, so this implicitly blocks
      // /admin, /student (dashboard), /test/<other-id>, etc.
      URLFilterRules: [
        // The candidate's exam landing (magic-link page)
        sebRule(`*://${allowedHost}/exam/${link.token}`),
        sebRule(`*://${allowedHost}/exam/${link.token}/*`),
        // The exam itself
        sebRule(`*://${allowedHost}/test/${input.test.id}`),
        sebRule(`*://${allowedHost}/test/${input.test.id}/*`),
        // Post-submit results (also where ?seb=quit lands).
        // Trailing pattern is `<id>*` (no slash) so it matches both
        // `/student/results/<id>` and `/student/results/<id>?seb=quit`.
        sebRule(`*://${allowedHost}/student/results/${input.test.id}`),
        sebRule(`*://${allowedHost}/student/results/${input.test.id}*`),
        // Backend API — backend itself enforces per-candidate scope via
        // InviteScopeGuard. Allow all /api/* so SEB doesn't block the
        // legitimate auth/exam/uploads/SEB-config calls.
        sebRule(`*://${allowedHost}/api/*`),
        // Next.js static bundles, fonts, RSC payloads.
        sebRule(`*://${allowedHost}/_next/*`),
        sebRule(`*://${allowedHost}/favicon.ico`),
        // Socket.IO (not used by candidates today; here so a future
        // candidate-side websocket doesn't get silently blocked).
        sebRule(`*://${allowedHost}/socket.io/*`),
        // Question / option images served from GCS — different origin,
        // explicitly allow the bucket so images render.
        sebRule(`*://storage.googleapis.com/kugelblitz-hiring-uploads/*`),
      ],
      // ─── Lockdown — keys / app switching ──────────────────────
      enableF1: false,
      enableF3: false,
      enableF12: false,
      allowSwitchToApplications: false,
      allowQuit: true,
      ignoreQuitPassword: false,
      // ─── Anti-screenshot ───────────────────────────────────────
      enableScreenCapture: false,
      enablePrintScreen: false,
      enableLogging: false,
      // ─── Anti-VM / app integrity ───────────────────────────────
      allowVirtualMachine: false,
      enableAppSwitcherCheck: true,
      forceAppFolderInstall: true,
      // ─── Anti-WebRTC / mic / cam ───────────────────────────────
      allowMicrophone: false,
      allowCamera: false,
      browserMediaCaptureMicrophone: false,
      browserMediaCaptureCamera: false,
      browserMediaCaptureScreen: false,
      enableWebRTC: false,
      // ─── Network / navigation ──────────────────────────────────
      detectStoppedProcess: true,
      browserWindowAllowReload: false,
      newBrowserWindowByLinkPolicy: 0,
      newBrowserWindowByScriptPolicy: 0,
      // ─── Prohibited processes ──────────────────────────────────
      prohibitedProcesses: allProcs.map((p) => ({
        active: true,
        currentUser: true,
        strongKill: true,
        os: p.os,
        executable: p.name,
        description: 'Blocked by exam policy',
      })),
      // ─── Service / cookies ─────────────────────────────────────
      sebServicePolicy: 2,
      logLevel: 1,
      examSessionClearCookiesOnEnd: true,
      examSessionClearCookiesOnStart: true,
      // ─── Config purpose ────────────────────────────────────────
      // 0 = starting an exam (default). 1 = re-configuring SEB itself,
      // which would prompt the user — never what we want here.
      sebConfigPurpose: 0,
    };

    return Buffer.from(this.toPlistXml(cfg), 'utf8');
  }

  // Verify the request originated from inside Safe Exam Browser.
  //
  // Why we don't replicate SHA256(URL + BEK_hex) here:
  //   SEB's actual BEK is NOT the `browserExamKey` field from the .seb.
  //   SEB derives it as HMAC-SHA256(examKeySalt, NSPropertyListXMLFormat
  //   serialization of the FULL filteredPrefsDict — i.e. every
  //   org_safeexambrowser_SEB_* setting, including defaults the .seb
  //   never specified). Reproducing that bit-for-bit server-side
  //   requires hard-coding all ~150 SEB defaults *per SEB version* and
  //   matching Apple's plist serializer exactly — fragile and constantly
  //   broken by SEB releases. Verified by inspecting SEBCryptor.m
  //   (`generateChecksumForBEK:` + `checksumForPrefDictionary:`).
  //
  // What we enforce instead — same model used by Moodle/OpenOLAT:
  //   1. The candidate must be running SEB (User-Agent contains "SEB/X.Y").
  //   2. SEB must have actually applied our .seb config — confirmed by
  //      the presence of BOTH SEB-issued headers
  //      (X-SafeExamBrowser-RequestHash + X-SafeExamBrowser-ConfigKeyHash);
  //      a vanilla browser cannot inject these.
  //   3. The .seb itself is the security boundary (URL whitelist,
  //      prohibited processes, no VM, no screen-share, fullscreen,
  //      hashed quit password).
  //
  // We log all SEB-related headers + the BEK we have on file so any
  // anomaly is auditable in violation_logs.
  verifyRequestHash(req: any, _bek: string, _salt: string | null | undefined): boolean {
    const ua: string = (req.headers?.['user-agent'] as string) || '';
    const requestHash =
      req.headers?.['x-safeexambrowser-requesthash'] ||
      (typeof req.header === 'function' ? req.header('X-SafeExamBrowser-RequestHash') : undefined);
    const configKeyHash =
      req.headers?.['x-safeexambrowser-configkeyhash'] ||
      (typeof req.header === 'function' ? req.header('X-SafeExamBrowser-ConfigKeyHash') : undefined);

    const uaIsSeb = /SEB[\s/]\d/i.test(ua);
    const headersPresent = !!(requestHash && configKeyHash);

    if (uaIsSeb && headersPresent) return true;

    // Diagnostic on rejection.
    const sebHeaders: Record<string, string> = {};
    const headers = (req.headers || {}) as Record<string, string>;
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase().includes('safeexambrowser') || k.toLowerCase() === 'user-agent') {
        sebHeaders[k] = String(headers[k]).slice(0, 200);
      }
    }
    this.logger.warn(
      `SEB request rejected — uaIsSeb=${uaIsSeb} headersPresent=${headersPresent} sebHeaders=${JSON.stringify(sebHeaders)}`,
    );
    return false;
  }

  // ─── Plist XML serializer ────────────────────────────────────────
  // Apple plist 1.0 format. Supports: string, integer, real, boolean,
  // array, dict. Keys are written alphabetically (SEB canonical order
  // matters for ConfigKey computation, but BEK does not depend on key
  // order — we still sort for determinism).
  private toPlistXml(obj: Record<string, any>): string {
    const header =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
      '<plist version="1.0">\n';
    const body = this.encodeValue(obj, 0);
    return header + body + '\n</plist>\n';
  }

  private encodeValue(v: any, indent: number): string {
    const pad = '\t'.repeat(indent);
    if (v === null || v === undefined) return `${pad}<string></string>`;
    if (typeof v === 'boolean') return `${pad}<${v ? 'true' : 'false'}/>`;
    if (typeof v === 'number') {
      if (Number.isInteger(v)) return `${pad}<integer>${v}</integer>`;
      return `${pad}<real>${v}</real>`;
    }
    if (typeof v === 'string') return `${pad}<string>${this.xmlEscape(v)}</string>`;
    if (Buffer.isBuffer(v)) return `${pad}<data>${v.toString('base64')}</data>`;
    if (Array.isArray(v)) {
      if (v.length === 0) return `${pad}<array/>`;
      const inner = v.map((item) => this.encodeValue(item, indent + 1)).join('\n');
      return `${pad}<array>\n${inner}\n${pad}</array>`;
    }
    if (typeof v === 'object') {
      // Sentinel: {__plist: 'data', value: Buffer | string} → <data>base64</data>
      // Used for binary fields (browserExamKey, examKeySalt) that SEB
      // stores as NSData; serializing them as <string> makes SEB reject
      // the whole config with "Reading configuration failed".
      if (v.__plist === 'data') {
        const buf = Buffer.isBuffer(v.value)
          ? v.value
          : typeof v.value === 'string'
            ? Buffer.from(v.value, /^[0-9a-fA-F]+$/.test(v.value) ? 'hex' : 'utf8')
            : Buffer.alloc(0);
        return `${pad}<data>${buf.toString('base64')}</data>`;
      }
      const keys = Object.keys(v).sort();
      if (keys.length === 0) return `${pad}<dict/>`;
      const inner = keys
        .map((k) => {
          const keyXml = `${'\t'.repeat(indent + 1)}<key>${this.xmlEscape(k)}</key>`;
          const valXml = this.encodeValue(v[k], indent + 1);
          return `${keyXml}\n${valXml}`;
        })
        .join('\n');
      return `${pad}<dict>\n${inner}\n${pad}</dict>`;
    }
    return `${pad}<string></string>`;
  }

  private xmlEscape(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// SEB URLFilterRule entry. action: 1 = allow, 0 = block. regex: false →
// glob-style (`*` matches any sequence of chars). active: must be true to
// participate in matching.
function sebRule(expression: string) {
  return { action: 1, active: true, regex: false, expression };
}
