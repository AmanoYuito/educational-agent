from pathlib import Path

from docx import Document
from docx.oxml import OxmlElement
from docx.text.paragraph import Paragraph


SOURCE = Path("output/オペレーティングシステムの基礎_Dify取込用.docx")
OUTPUT = Path("output/オペレーティングシステムの基礎_Dify親子チャンク用.docx")
MARKER = "===DIFY_SECTION_BREAK==="


def insert_marker_before(paragraph) -> None:
    """Insert a standalone marker paragraph immediately before a section heading."""
    marker_xml = OxmlElement("w:p")
    paragraph._p.addprevious(marker_xml)
    marker = Paragraph(marker_xml, paragraph._parent)
    marker.style = "Normal"
    marker.paragraph_format.space_before = 0
    marker.paragraph_format.space_after = 0
    marker.paragraph_format.keep_with_next = True
    run = marker.add_run(MARKER)
    run.font.size = paragraph.style.font.size


def main() -> None:
    document = Document(SOURCE)
    # The bracketed Heading 2 entries are the intended Dify parent units.
    # Keeping Heading 3 content with its Heading 2 avoids tiny, unusable
    # question-generation contexts while remaining below Dify's 4,000-character limit.
    headings = [paragraph for paragraph in document.paragraphs if paragraph.style.name == "Heading 2"]

    for heading in headings:
        insert_marker_before(heading)

    document.save(OUTPUT)
    print(f"Created {OUTPUT} with {len(headings)} section markers.")


if __name__ == "__main__":
    main()
