#!/bin/sh
# 스파이크용 HWP 5.x 샘플(pyhwp 저장소의 테스트 픽스처)을 tests/fixtures/hwp/third-party 에 내려받는다.
# 제3자 저작물이라 저장소에는 커밋하지 않는다(.gitignore).
set -e
DEST="$(dirname "$0")/../../tests/fixtures/hwp/third-party"
BASE=https://raw.githubusercontent.com/mete0r/pyhwp/develop/tests/hwp5_tests/fixtures
mkdir -p "$DEST"
for f in sample-5017 footnote-endnote multicolumns matrix textbox shapepict-scaled charshape facename pagedefs; do
  curl -fsS -m 30 -o "$DEST/$f.hwp" "$BASE/$f.hwp" && echo "ok $f.hwp"
done
