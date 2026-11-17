#!/bin/sh
# 정적 호스팅(GitHub Pages 등)용 체험판을 만든다: sh build-web.sh <출력 디렉터리>
# 아티팩트와 같은 파일에, 브라우저 안에서만 도는 대체 백엔드(web-backend.js)를 얹는다.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"; OUT="$1"
[ -n "$OUT" ] || { echo "usage: build-web.sh <out>"; exit 1; }
mkdir -p "$OUT"
cp "$SRC"/core.js "$SRC"/mod-*.js "$SRC"/seed.json "$SRC"/web-backend.js "$OUT"/
RESET='html{color-scheme:light}:root{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}'
{
  printf '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>%s</style></head><body><script src="web-backend.js"></script>\n' "$RESET"
  cat "$SRC"/index.html
  printf '\n</body></html>\n'
} > "$OUT"/index.html
touch "$OUT"/.nojekyll
ls "$OUT" | wc -l
