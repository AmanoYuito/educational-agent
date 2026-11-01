"""Build one quota-friendly Dify text file per lecture from slide Markdown files.

Dify's custom chunk separator `***` makes each slide a separate chunk while
keeping the document count low. Run after build-slide-knowledge.py.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "knowledge" / "dify-slide-knowledge"
DESTINATION = SOURCE / "bundles"


def build() -> None:
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for lecture, count in ((3, 36), (4, 35)):
        slides = sorted((SOURCE / f"lesson-{lecture:02d}").glob("*.md"))
        if len(slides) != count:
            raise ValueError(f"Expected {count} slides for lecture {lecture}")
        chunks = []
        for slide in slides:
            content = slide.read_text(encoding="utf-8").strip().removeprefix("# ")
            if "スライドID:" not in content or "本文:" not in content or "***" in content:
                raise ValueError(f"Invalid slide content: {slide}")
            if len(content) > 1024:
                raise ValueError(f"Slide exceeds chunk length: {slide}")
            chunks.append(content)
        (DESTINATION / f"cs2-lesson-{lecture:02d}-slides.txt").write_text(
            "\n***\n".join(chunks) + "\n", encoding="utf-8"
        )


if __name__ == "__main__":
    build()
