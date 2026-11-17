"""변환 엔진: unhwp로 HWP/HWPX를 Markdown + 그림 파일로 추출한다 (가져오기의 중간 형식).

사용법: python3 worker/engines/unhwp-extract.py <입력.hwp|.hwpx> <출력 디렉터리>
결과: <출력>/document.md, <출력>/assets/<그림 이름>. Markdown은 그림을 assets/<이름>으로 참조한다.
별도 프로세스로 실행된다(server/jobs/import-hwp.ts). 실패하면 0이 아닌 코드로 끝난다.
"""
import os
import sys

import unhwp


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: unhwp-extract.py <input> <outdir>", file=sys.stderr)
        return 2
    source, out = sys.argv[1], sys.argv[2]
    result = unhwp.parse(source)
    assets = os.path.join(out, "assets")
    os.makedirs(assets, exist_ok=True)
    for image in result.images:
        name = os.path.basename(image.name)
        if not name or name.startswith("."):
            continue
        with open(os.path.join(assets, name), "wb") as fh:
            fh.write(bytes(image.data))
    with open(os.path.join(out, "document.md"), "w", encoding="utf-8") as fh:
        fh.write(result.markdown)
    return 0


if __name__ == "__main__":
    sys.exit(main())
