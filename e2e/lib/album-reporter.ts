import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPORT_DIR } from './env';

type Entry = { file: string; line: number; title: string; status: string; ms: number; error?: string; media: Array<{ name: string; kind: 'img' | 'text'; src: string }> };

/** A copy of a large GIF small enough to inline, or the original. */
function inlineable(src: string) {
  const file = path.join(REPORT_DIR, src);
  if (!src.endsWith('.gif') || statSync(file).size <= 900_000) return src;
  const small = src.replace(/\.gif$/, '.small.gif');
  for (const [fps, width] of [[12, 440], [10, 360], [8, 300], [6, 240]]) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', file, '-vf',
      `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`,
      path.join(REPORT_DIR, small)]);
    if (statSync(path.join(REPORT_DIR, small)).size <= 900_000) break;
  }
  return small;
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

/** Writes e2e-report/index.html: one expandable entry per test, with its screenshots and GIFs. */
export default class AlbumReporter implements Reporter {
  private entries: Entry[] = [];
  private mediaDir = path.join(REPORT_DIR, 'media');
  private n = 0;

  onBegin() {
    rmSync(this.mediaDir, { recursive: true, force: true });
    mkdirSync(this.mediaDir, { recursive: true });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    // Keep only the final attempt of a retried test.
    this.entries = this.entries.filter(entry => entry.title !== test.title || entry.file !== path.basename(test.location.file));
    const media: Entry['media'] = [];
    for (const attachment of result.attachments) {
      const body = attachment.body ?? (attachment.path ? readFileSync(attachment.path) : undefined);
      if (!body) continue;
      if (attachment.contentType.startsWith('image/')) {
        const ext = attachment.contentType === 'image/gif' ? 'gif' : attachment.contentType === 'image/png' ? 'png' : 'jpg';
        const name = `${String(++this.n).padStart(4, '0')}.${ext}`;
        if (attachment.path) copyFileSync(attachment.path, path.join(this.mediaDir, name));
        else writeFileSync(path.join(this.mediaDir, name), body);
        media.push({ name: attachment.name.replace(/^\d+ /, ''), kind: 'img', src: `media/${name}` });
      } else if (attachment.contentType === 'text/plain') {
        media.push({ name: attachment.name, kind: 'text', src: body.toString('utf8') });
      }
    }
    const error = result.errors.map(e => stripAnsi(e.message ?? e.value ?? '')).join('\n\n') || undefined;
    this.entries.push({ file: path.basename(test.location.file), line: test.location.line, title: test.title, status: result.status, ms: result.duration, error, media });
  }

  onEnd(result: FullResult) {
    const passed = this.entries.filter(e => e.status === 'passed').length;
    const failed = this.entries.filter(e => e.status === 'failed' || e.status === 'timedOut').length;
    const skipped = this.entries.length - passed - failed;
    // Animations run first for speed (00-) but read best last.
    const rank = (file: string) => file.includes('animations') ? 99 : Number(file.split('-')[0]);
    this.entries.sort((a, b) => rank(a.file) - rank(b.file) || a.file.localeCompare(b.file) || a.line - b.line);
    const files = [...new Set(this.entries.map(e => e.file))];
    const mark = (s: string) => s === 'passed' ? '<b class=p>PASS</b>' : s === 'skipped' ? '<b class=s>SKIP</b>' : '<b class=f>FAIL</b>';
    const page = (src: (m: Entry['media'][number]) => string) => {
      const body = files.map(file => {
        const tests = this.entries.filter(e => e.file === file);
        return `<h2>${esc(file.replace(/^\d+-/, '').replace(/\.spec\.ts$/, ''))}</h2>\n` + tests.map(e => `<details${e.status === 'passed' || e.status === 'skipped' ? '' : ' open'}><summary>${mark(e.status)} ${esc(e.title)} <i>${(e.ms / 1000).toFixed(1)}s</i></summary>
${e.error ? `<pre class=err>${esc(e.error)}</pre>` : ''}${e.media.map(m => m.kind === 'img'
          ? `<figure><img loading=lazy src="${src(m)}"><figcaption>${esc(m.name)}</figcaption></figure>`
          : `<figure><pre>${esc(m.src)}</pre><figcaption>${esc(m.name)}</figcaption></figure>`).join('')}
</details>`).join('\n');
      }).join('\n');
      // No page colors, so it reads in light or dark surroundings.
      return `<!doctype html><meta charset=utf-8><title>Rush 10 e2e</title>
<style>
body{font:14px system-ui,sans-serif;margin:0 auto;max-width:1200px}
h1{font-size:16px;margin:0 0 8px}h2{font-size:14px;margin:18px 0 2px;opacity:.7}
details{border-top:1px solid rgba(127,127,127,.25);padding:4px 0}summary{cursor:pointer}
i{opacity:.55;font-style:normal;font-size:12px}
.p{color:var(--success,#16a34a)}.f{color:var(--destructive,#dc2626)}.s{opacity:.55}
figure{display:inline-block;margin:8px 8px 0 0;vertical-align:top;max-width:100%}
img{max-width:min(540px,100%);border:1px solid rgba(127,127,127,.35);display:block}figcaption{font-size:12px;opacity:.7}
pre{white-space:pre-wrap;font-size:12px;max-width:540px;max-height:320px;overflow:auto;background:rgba(127,127,127,.12);padding:6px;margin:0}
pre.err{max-width:none;color:var(--destructive,#dc2626)}
</style>
<h1><span class=p>${passed} passed</span>${failed ? `, <span class=f>${failed} failed</span>` : ''}${skipped ? `, ${skipped} skipped` : ''} · ${(result.duration / 1000).toFixed(1)}s · ${new Date().toLocaleString()}</h1>
${body}
`;
    };
    writeFileSync(path.join(REPORT_DIR, 'index.html'), page(m => m.src));
    // Absolute image paths, for tools that inline local files; those refuse images over about 1 MB.
    writeFileSync(path.join(REPORT_DIR, 'artifact.html'), page(m => path.join(REPORT_DIR, inlineable(m.src))));
    console.log(`\nAlbum: ${path.join(REPORT_DIR, 'index.html')}`);
  }
}
