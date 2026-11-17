// rhwp(WASM)를 헤드리스 Chromium 안에서 실행해 HWP/HWPX → PDF로 변환하는 스파이크 스크립트
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const PKG = path.resolve(process.argv[2]); const OUT = process.argv[3]; const files = process.argv.slice(4);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); await ctx.setOffline(false);
  await ctx.route('http://rhwp.local/**', (r) => {
    const u = new URL(r.request().url()).pathname;
    if (u === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body></body>' });
    const f = path.join(PKG, path.basename(u));
    r.fulfill({ contentType: u.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', body: fs.readFileSync(f) });
  });
  for (const f of files) {
    const name = path.basename(f).replace(/\.hwpx?$/, ''); const t = Date.now();
    const p = await ctx.newPage();
    try {
      await p.goto('http://rhwp.local/');
      const n = await p.evaluate(async (b64) => {
        const { default: init, HwpDocument } = await import('/rhwp.js');
        let c = null, last = '';
        globalThis.measureTextWidth = (font, text) => { if (!c) c = document.createElement('canvas').getContext('2d'); if (font !== last) { c.font = font; last = font; } return c.measureText(text).width; };
        await init({ module_or_path: '/rhwp_bg.wasm' });
        const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
        const doc = new HwpDocument(bin); const n = doc.pageCount(); let html = '', size = null;
        for (let i = 0; i < n; i++) { const s = doc.renderPageSvg(i); if (!size) { const m = /width="([\d.]+)"[^>]*height="([\d.]+)"/.exec(s); size = m ? [m[1], m[2]] : [794, 1123]; } html += s; }
        document.head.insertAdjacentHTML('beforeend', `<style>@page{size:${size[0]}px ${size[1]}px;margin:0}body{margin:0}svg{display:block;break-after:page}</style>`);
        document.body.innerHTML = html; return n;
      }, fs.readFileSync(f).toString('base64'));
      await p.pdf({ path: path.join(OUT, name + '.pdf'), preferCSSPageSize: true, printBackground: true });
      console.log(name, 'ok pages', n, (Date.now() - t) + 'ms');
    } catch (e) { console.log(name, 'ERR', String(e).slice(0, 160)); }
    await p.close();
  }
  await b.close();
})();
