"""커밋되는 자체 제작 fixture를 다시 만든다 (제3자 저작물 없음).

사용법 (저장소 루트에서):
  python3 tests/fixtures/make-fixtures.py          # HWPX, DOCX, MD, 손상 파일
  node tests/fixtures/make-fixtures.mjs            # HWP(rhwp로 HWPX→HWP), PDF(Chromium 인쇄), 스캔 PDF
준비물: pip install python-hwpx python-docx, node + playwright + @rhwp/core
"""
import io, struct, zlib
from pathlib import Path

ROOT = Path(__file__).parent
HWP = ROOT / "hwp"
IMP = ROOT / "import"
HWP.mkdir(exist_ok=True)
IMP.mkdir(exist_ok=True)


def png(width=40, height=24, rgb=(40, 110, 200)) -> bytes:
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def make_hwpx():
    from hwpx import HwpxDocument

    doc = HwpxDocument.new()
    doc.add_heading("음향 블랙홀 진동 감쇠 실험 보고서", level=1)
    doc.add_paragraph("이 문서는 ResearchMate 변환 테스트용으로 직접 만든 HWPX 샘플입니다.")
    doc.add_heading("실험 방법", level=2)
    doc.add_paragraph("알루미늄 보의 끝단 두께를 점차 줄여 진동 에너지를 모았다.")
    table = doc.add_table(3, 2)
    cells = [["조건", "감쇠율"], ["기준 보", "12.5"], ["음향 블랙홀 보", "31.0"]]
    for r, row in enumerate(cells):
        for c, value in enumerate(row):
            table.set_cell_text(r, c, value)
    doc.add_paragraph("표 아래 문단: 감쇠율은 세 번 측정한 평균이다.")
    doc.save_to_path(str(HWP / "sample.hwpx"))


def make_docx():
    from docx import Document

    d = Document()
    d.add_heading("DOCX 가져오기 샘플", level=1)
    p = d.add_paragraph("첫 문단에는 ")
    p.add_run("굵은 글씨").bold = True
    p.add_run("와 ")
    p.add_run("기울임").italic = True
    p.add_run("이 있습니다.")
    d.add_heading("결과", level=2)
    d.add_paragraph("항목 하나", style="List Bullet")
    d.add_paragraph("항목 둘", style="List Bullet")
    t = d.add_table(rows=2, cols=2)
    for r, row in enumerate([["시료", "길이"], ["A", "10 mm"]]):
        for c, value in enumerate(row):
            t.cell(r, c).text = value
    d.add_picture(io.BytesIO(png()))
    d.add_paragraph("그림 아래 문단입니다.")
    d.save(str(IMP / "sample.docx"))


MD = """# Markdown 가져오기 샘플

첫 문단에는 **굵은 글씨**와 *기울임*, `코드`, [링크](https://example.com)가 있습니다.

## 목록과 표

- 항목 하나
- 항목 둘

1. 첫째
2. 둘째

| 시료 | 길이 |
| --- | --- |
| A | 10 mm |
| B | 12 mm |

> 인용문입니다.

```python
print("hello")
```

<script>alert("xss")</script>
<img src="x" onerror="alert(1)">

[위험한 링크](javascript:alert(1))
"""


def make_corrupt():
    # HWP 5.x의 OLE 매직바이트만 맞고 나머지는 쓰레기인 파일
    (HWP / "corrupt.hwp").write_bytes(bytes.fromhex("d0cf11e0a1b11ae1") + bytes(range(256)) * 16)
    # ZIP 매직바이트만 맞는 HWPX
    (HWP / "corrupt.hwpx").write_bytes(b"PK\x03\x04" + bytes(range(256)) * 8)
    # 정상 HWPX를 중간에서 자른 파일
    data = (HWP / "sample.hwpx").read_bytes()
    (HWP / "truncated.hwpx").write_bytes(data[: len(data) // 2])
    # 확장자는 PDF인데 내용은 텍스트
    (IMP / "fake.pdf").write_bytes(b"this is not a pdf\n")
    (IMP / "corrupt.docx").write_bytes(b"PK\x03\x04" + bytes(range(256)) * 4)
    (IMP / "pixel.png").write_bytes(png())


if __name__ == "__main__":
    make_hwpx()
    make_docx()
    (IMP / "sample.md").write_text(MD, encoding="utf-8")
    make_corrupt()
    print("ok")
