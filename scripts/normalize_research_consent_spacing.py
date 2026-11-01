from __future__ import annotations

import os
from pathlib import Path

from docx import Document


DOCUMENT_PATH = Path(
    "/Users/yu110/Downloads/Research/aituber-kit-main/output/documents/"
    "AI学習支援チャットボットの利用と研究へのご協力のお願い_修正版.docx"
)
LINE_SPACING = 1.1


def iter_cell_paragraphs(cell):
    yield from cell.paragraphs
    for table in cell.tables:
        yield from iter_table_paragraphs(table)


def iter_table_paragraphs(table):
    seen_cells: set[int] = set()
    for row in table.rows:
        for cell in row.cells:
            cell_id = id(cell._tc)
            if cell_id in seen_cells:
                continue
            seen_cells.add(cell_id)
            yield from iter_cell_paragraphs(cell)


def iter_all_paragraphs(document):
    yield from document.paragraphs
    for table in document.tables:
        yield from iter_table_paragraphs(table)

    seen_parts: set[str] = set()
    for section in document.sections:
        for container in (
            section.header,
            section.first_page_header,
            section.even_page_header,
            section.footer,
            section.first_page_footer,
            section.even_page_footer,
        ):
            part_name = str(container.part.partname)
            if part_name in seen_parts:
                continue
            seen_parts.add(part_name)
            yield from container.paragraphs
            for table in container.tables:
                yield from iter_table_paragraphs(table)


def main() -> None:
    document = Document(DOCUMENT_PATH)
    updated = 0

    for paragraph in iter_all_paragraphs(document):
        if not paragraph.text.strip():
            continue
        paragraph.paragraph_format.line_spacing = LINE_SPACING
        updated += 1

    temporary_path = DOCUMENT_PATH.with_suffix(".spacing.tmp.docx")
    document.save(temporary_path)
    os.replace(temporary_path, DOCUMENT_PATH)
    print(f"Updated line spacing for {updated} text paragraphs to {LINE_SPACING} lines.")


if __name__ == "__main__":
    main()
