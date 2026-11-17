// 로컬 확인용 정적 서버: node dev-server.mjs [포트]. /dev.html 이 가짜 claude 환경(dev-mock.js)을 얹어 index.html을 연다.
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = import.meta.dirname; const port = Number(process.argv[2] || 4100);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".csv": "text/csv" };
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); let p = decodeURIComponent(u.pathname);
  if (p === "/" || p === "/dev.html") {
    const body = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const reset = "html{color-scheme:light}:root{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}";
    res.writeHead(200, { "content-type": types[".html"] });
    return res.end(`<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${reset}</style></head><body><script src="dev-mock.js"></script>${body}</body></html>`);
  }
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log("http://localhost:" + port + "/dev.html"));
