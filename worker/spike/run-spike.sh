#!/bin/sh
# 사용법: worker/spike/run-spike.sh <샘플 디렉터리> <출력 디렉터리>
# 세 가지 경로로 HWP → PDF를 시도하고 성공 여부·쪽수·소요 시간을 출력한다.
#   A) LibreOffice + H2Orestart   B) pyhwp(hwp5odt) → ODT → LibreOffice   C) rhwp(WASM) + Chromium
# 준비물: soffice, libreoffice-h2orestart, pyhwp(hwp5odt), poppler-utils(pdfinfo), node + playwright, @rhwp/core
set -u
IN="$1"; OUT="$2"; mkdir -p "$OUT/a" "$OUT/b" "$OUT/c"
PROFILE="file://$(cd "$OUT" && pwd)/lo-profile"
pages() { pdfinfo "$1" 2>/dev/null | awk '/Pages/{print $2}'; }
for f in "$IN"/*.hwp "$IN"/*.hwpx; do
  [ -f "$f" ] || continue
  b=$(basename "$f"); n="${b%.*}"
  timeout 120 soffice --headless "-env:UserInstallation=$PROFILE" --convert-to pdf --outdir "$OUT/a" "$f" >/dev/null 2>&1
  echo "A $b rc=$? pages=$(pages "$OUT/a/$n.pdf")"
  case "$b" in *.hwp)
    timeout 60 hwp5odt --output "$OUT/b/$n.odt" "$f" >/dev/null 2>&1 &&
      timeout 120 soffice --headless "-env:UserInstallation=$PROFILE" --convert-to pdf --outdir "$OUT/b" "$OUT/b/$n.odt" >/dev/null 2>&1
    echo "B $b rc=$? pages=$(pages "$OUT/b/$n.pdf")";;
  esac
done
node "$(dirname "$0")/rhwp-to-pdf.cjs" node_modules/@rhwp/core "$OUT/c" "$IN"/*.hwp "$IN"/*.hwpx 2>/dev/null | sed 's/^/C /'
