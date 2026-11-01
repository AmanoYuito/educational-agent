"""Build one Dify source document per lecture slide from the distributed PDFs.

Run with the bundled artifact Python runtime, which includes pypdf. The first
two pages of each lecture are a cover and an agenda, not quiz material.
"""

from pathlib import Path
import re

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "knowledge" / "dify-slide-knowledge"
LECTURES = ((3, 38), (4, 37))


def page_lines(page, number: int) -> list[str]:
    lines = [re.sub(r"\s+", " ", line).strip() for line in (page.extract_text() or "").splitlines()]
    lines = [line for line in lines if line]
    if str(number) in lines:
        lines.remove(str(number))
    return lines


def build() -> None:
    for lecture, expected_pages in LECTURES:
        pdf = ROOT / "public" / "materials" / "computer-systems-2" / f"lesson-{lecture:02d}" / "material.pdf"
        reader = PdfReader(pdf)
        if len(reader.pages) != expected_pages:
            raise ValueError(f"Unexpected PDF length: {pdf}")
        destination = OUTPUT / f"lesson-{lecture:02d}"
        destination.mkdir(parents=True, exist_ok=True)
        for number in range(3, len(reader.pages) + 1):
            lines = page_lines(reader.pages[number - 1], number)
            if not lines:
                raise ValueError(f"No text on lecture {lecture}, slide {number}")
            title = next((line for line in lines if not line.startswith("•")), lines[0])[:120]
            body = "\n".join(lines)
            content = (
                f"# 第{lecture}回 スライド{number:02d} {title}\n\n"
                f"講義: コンピュータシステム2 第{lecture}回\n"
                f"出典: コンシス第{lecture}回.pdf、スライド{number}枚目\n"
                f"スライドID: cs2-lesson-{lecture:02d}-slide-{number:02d}\n\n"
                f"本文:\n{body}\n"
            )
            (destination / f"cs2-lesson-{lecture:02d}-slide-{number:02d}.md").write_text(
                content, encoding="utf-8"
            )


if __name__ == "__main__":
    build()
