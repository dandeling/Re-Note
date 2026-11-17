#!/bin/sh
# 가짜 soffice: 종료 코드 0인데 PDF가 아닌 파일을 만든다
out=.
while [ $# -gt 0 ]; do [ "$1" = "--outdir" ] && out="$2"; shift; done
echo "not a pdf" > "$out/result.pdf"
