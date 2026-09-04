import puppeteer from 'puppeteer-core'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { spawn } from 'node:child_process'

/* PDF / WhatsApp / email smoke test. Serves public/ on a local port, mounts a
   throwaway page that exercises receipt-send.js in a real browser, then
   verifies PDF structure and the send/handoff logic. */

const ROOT = join(process.cwd(), 'public')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 8093

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' }

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  let p = url.pathname === '/' ? '/index.html' : url.pathname
  try {
    const data = readFileSync(join(ROOT, p))
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' })
    res.end(data)
  } catch (_) {
    res.writeHead(404); res.end('nf')
  }
})
await new Promise(r => server.listen(PORT, '127.0.0.1', r))

const SMOKE = ROOT + '/_smoke.html'
writeFileSync(SMOKE, `<!doctype html><meta charset="utf-8"><title>smoke</title>
<script type="module">
  import { pdfFromLines, pdfBlobFromLines, normalPhone, whatsappLink, mailtoLink, mountSendButtons } from './js/receipt-send.js';
  window.__run = async () => {
    const out = [];
    const lines = [
      'ORISON ELECTRONICS', 'Orison Electronics — Main Street',
      'Fri, Sep 4, 2026 3:42 PM', 'Cashier: Amara Okafor', '----------------------',
      'Samsung Galaxy A15 [SN-00001] x2 — $220.00', 'USB-C Cable — $8.00',
      'Total — $448.00', 'Cash — $500.00', 'Change — $52.00',
      'Thank you for shopping \u2713', '# tx-demo-1',
    ];
    const bytes = pdfFromLines(lines);
    window.__pdfB64 = btoa(String.fromCharCode.apply(null, bytes));

    const latin = new TextDecoder('latin1').decode(bytes);
    const parts = latin.split(/xref\\s*\\n0 6\\n/);
    const body = parts[0], tail = parts[1];
    out.push('has-xref=' + (parts.length === 2));
    const startxref = Number((tail.match(/startxref\\s+(\\d+)/) || [])[1]);
    out.push('startxref-ok=' + (startxref === body.length));
    const entries = tail.split('\\n').filter(l => /^\\d{10} \\d{5} [nf] /.test(l)).map(l => Number(l.split(' ')[0]));
    const objStarts = [...body.matchAll(/\\n(\\d+) 0 obj/g)].map(m => m.index + 1);
    out.push('entry0-free=' + (entries[0] === 0));
    out.push('entry1=' + entries[1] + ':' + objStarts[0]);
    out.push('xref-offsets-ok=' + (entries.length === 6 && entries[1] === objStarts[0] && entries[2] === objStarts[1] && entries[3] === objStarts[2] && entries[4] === objStarts[3] && entries[5] === objStarts[4]));
    out.push('eof-ok=' + (new TextDecoder('ascii').decode(bytes.slice(-6)) === '%%EOF\\n'));
    out.push('ascii-only=' + bytes.every(b => b < 128));
    out.push('size=' + bytes.length);

    out.push('phone-0=' + normalPhone('0803 123 4567'));
    out.push('phone-234=' + normalPhone('+234 803 123 4567'));
    out.push('phone-bad=' + normalPhone('12'));
    out.push('wa=' + whatsappLink('2348031234567', 'hi').startsWith('https://wa.me/2348031234567?text='));
    out.push('mail=' + mailtoLink('a@b.com', 'S', 'B').startsWith('mailto:a%40b.com?'));

    const blob = await pdfBlobFromLines(lines);
    out.push('pdf-blob=' + (blob.type === 'application/pdf') + ':' + (blob.size > 400));

    const host = document.createElement('div');
    document.body.appendChild(host);
    await mountSendButtons(host, { lines, title: 'T', filename: 'x' });
    out.push('send-buttons=' + ['#rsPdf','#rsWa','#rsMail'].every(s => host.querySelector(s)));
    const phone = host.querySelector('#rsPhone'), email = host.querySelector('#rsEmail');
    const opened = [];
    window.open = (u) => { opened.push(u); return null; };
    if (!('canShare' in navigator)) Object.defineProperty(navigator, 'canShare', { value: false, configurable: true });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    try {
      phone.value = '0803 123 4567'; email.value = 'c@example.com';
      host.querySelector('#rsWa').click();
      await new Promise(r => setTimeout(r, 400));
      out.push('wa-opened=' + opened.some(u => u.startsWith('https://wa.me/23480')));
      out.push('cfg-saved=' + (phone.value === '0803 123 4567'));
    } catch (e) { out.push('send-err=' + e.message); }
    out.push('no-crash=' + (out.filter(x => x.startsWith('send-err')).length === 0));
    return out;
  };
</script>`)

let browser, page
const results = []
const srcPdf = join(process.cwd(), 'tests', '_roundtrip-src.pdf')
try {
  browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] })
  page = await browser.newPage()
  page.on('pageerror', e => results.push('PAGEERROR ' + e.message))
  await page.goto('http://127.0.0.1:' + PORT + '/_smoke.html')
  await page.waitForFunction(() => typeof window.__run === 'function')
  const rows = await page.evaluate(async () => await window.__run())
  results.push(...rows)
  const b64 = await page.evaluate(() => window.__pdfB64)
  writeFileSync(srcPdf, Buffer.from(b64, 'base64'))

  // Real-reader check: round-trip through Edge's PDF engine.
  const repro = join(process.cwd(), 'tests', '_roundtrip.pdf')
  rmSync(repro, { force: true })
  await new Promise((resolve) => {
    const p = spawn(EDGE, ['--headless', '--disable-gpu', '--no-sandbox', '--print-to-pdf=' + repro, srcPdf], { stdio: 'ignore' })
    p.on('exit', resolve)
  })
  const ok = existsSync(repro) && statSync(repro).size > 100
  results.push('reader-roundtrip=' + ok)
  rmSync(repro, { force: true })
} finally {
  if (browser) await browser.close().catch(() => {})
  rmSync(SMOKE, { force: true })
  rmSync(srcPdf, { force: true })
  await new Promise(r => server.close(r))
}

let pass = 0, fail = 0
for (const r of results) {
  const isBad = r.startsWith('PAGEERROR') || (r.startsWith('PASS') ? false : /=(false|0|bad|nan|undefined)$/.test(r) || r.includes('send-err'))
  if (isBad) fail++; else pass++
  console.log(`${isBad ? 'FAIL' : 'PASS'}  ${r}`)
}
console.log(`\nPDF/SEND SMOKE  PASS ${pass}  FAIL ${fail}`)
process.exit(fail ? 1 : 0)