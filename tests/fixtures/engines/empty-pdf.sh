#!/bin/sh
# 가짜 soffice: 종료 코드 0으로 글자 없는 PDF를 만든다 (빈 PDF 감지 테스트)
out=.
while [ $# -gt 0 ]; do [ "$1" = "--outdir" ] && out="$2"; shift; done
cp "$(dirname "$0")/blank.pdf" "$out/result.pdf"
