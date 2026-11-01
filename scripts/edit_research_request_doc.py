from copy import deepcopy
from pathlib import Path

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_ROW_HEIGHT_RULE, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor


SOURCE = Path(
    "/Users/yu110/Downloads/AI学習支援チャットボットの利用と研究へのご協力のお願い.docx"
)
OUTPUT = Path(
    "/Users/yu110/Downloads/Research/aituber-kit-main/output/documents/"
    "AI学習支援チャットボットの利用と研究へのご協力のお願い_修正版.docx"
)
TIMELINE_IMAGE = Path(
    "/Users/yu110/Downloads/Research/aituber-kit-main/output/documents/"
    "research_usage_timeline.png"
)

FONT_NAME = "Arial Unicode MS"
NAVY = "1F4E78"
PALE_BLUE = "EAF2F8"
PALE_GRAY = "F7F9FB"
LIGHT_BORDER = "D9D9D9"


def set_run_font(run, size=None, bold=None, color=None):
    run.font.name = FONT_NAME
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), FONT_NAME)
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), FONT_NAME)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), FONT_NAME)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = RGBColor.from_string(color)


def set_cell_fill(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=110, start=120, bottom=110, end=120):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for margin, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{margin}"))
        if node is None:
            node = OxmlElement(f"w:{margin}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table, color=LIGHT_BORDER, size="6"):
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.find(qn("w:tblBorders"))
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = borders.find(qn(f"w:{edge}"))
        if tag is None:
            tag = OxmlElement(f"w:{edge}")
            borders.append(tag)
        tag.set(qn("w:val"), "single")
        tag.set(qn("w:sz"), size)
        tag.set(qn("w:space"), "0")
        tag.set(qn("w:color"), color)


def remove_table_borders(table):
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.find(qn("w:tblBorders"))
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = borders.find(qn(f"w:{edge}"))
        if tag is None:
            tag = OxmlElement(f"w:{edge}")
            borders.append(tag)
        tag.set(qn("w:val"), "nil")


def set_table_bottom_border(table, color="C9D9E8", size="5"):
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.find(qn("w:tblBorders"))
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    bottom = borders.find(qn("w:bottom"))
    if bottom is None:
        bottom = OxmlElement("w:bottom")
        borders.append(bottom)
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), size)
    bottom.set(qn("w:space"), "0")
    bottom.set(qn("w:color"), color)


def set_fixed_table_widths(table, widths):
    total_twips = sum(int(width.twips) for width in widths)
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), str(total_twips))
    tbl_w.set(qn("w:type"), "dxa")

    grid_cols = table._tbl.tblGrid.findall(qn("w:gridCol"))
    for grid_col, width in zip(grid_cols, widths):
        grid_col.set(qn("w:w"), str(int(width.twips)))

    for row in table.rows:
        for cell, width in zip(row.cells, widths):
            cell.width = width
            tc_w = cell._tc.get_or_add_tcPr().find(qn("w:tcW"))
            if tc_w is not None:
                tc_w.set(qn("w:w"), str(int(width.twips)))
                tc_w.set(qn("w:type"), "dxa")


def keep_table_rows_readable(table):
    for row_index, row in enumerate(table.rows):
        tr_pr = row._tr.get_or_add_trPr()
        cant_split = tr_pr.find(qn("w:cantSplit"))
        if cant_split is None:
            tr_pr.append(OxmlElement("w:cantSplit"))
        if row_index == 0 and tr_pr.find(qn("w:tblHeader")) is None:
            tr_pr.append(OxmlElement("w:tblHeader"))


def insert_table_after(table, paragraph):
    paragraph._p.addnext(table._tbl)


def insert_paragraph_after(paragraph, text=""):
    new_p = OxmlElement("w:p")
    paragraph._p.addnext(new_p)
    new_paragraph = paragraph._parent.add_paragraph()
    new_paragraph._p.getparent().remove(new_paragraph._p)
    new_p.addnext(new_paragraph._p)
    new_paragraph._p.getparent().remove(new_paragraph._p)
    new_p.getparent().replace(new_p, new_paragraph._p)
    if text:
        new_paragraph.add_run(text)
    return new_paragraph


def delete_paragraph(paragraph):
    element = paragraph._element
    element.getparent().remove(element)
    paragraph._p = paragraph._element = None


def remove_rendered_page_break_hints(document):
    """Remove cached page-break hints that can become stale after reflow."""
    for page_break in document._element.xpath(".//w:lastRenderedPageBreak"):
        page_break.getparent().remove(page_break)


def remove_trailing_empty_paragraph(document):
    """Avoid a final empty paragraph being pushed onto an otherwise blank page."""
    if not document.paragraphs:
        return
    last = document.paragraphs[-1]
    has_embedded_content = bool(last._p.xpath(".//w:drawing | .//w:object | .//w:pict"))
    if not last.text.strip() and not has_embedded_content:
        delete_paragraph(last)


def replace_paragraph_text(paragraph, text, *, bold=False, size=11):
    for run in paragraph.runs:
        run._element.getparent().remove(run._element)
    run = paragraph.add_run(text)
    set_run_font(run, size=size, bold=bold, color="000000")


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document = Document(SOURCE)
    document.sections[0].top_margin = Cm(2.35)

    # 冒頭を、授業上の必須活動ではなく、研究への任意参加であることが伝わる表現にする。
    replace_paragraph_text(
        document.paragraphs[1],
        "本研究では、「コンピュータシステム2」の授業内容を対象として、授業内容の確認や復習を支援する学習支援AIエージェントを試用していただきます。本調査は、開発中のシステムの有用性や改善点を確認するための予備調査です。研究内容をご確認のうえ、ご協力いただける範囲で任意にご参加ください。",
        size=11,
    )

    section_heading = document.paragraphs[12]
    replace_paragraph_text(section_heading, "2．利用期間とアンケート", bold=True, size=14)
    period_intro = document.paragraphs[13]
    replace_paragraph_text(
        period_intro,
        "システムの利用期間とアンケートの実施日は、次のとおりです。",
        size=11,
    )
    period_intro.paragraph_format.space_after = Pt(7)

    old_second_period_paragraph = document.paragraphs[14]

    # 日付の節目と図形の矢印で利用期間を示すタイムラインを配置する。
    if not TIMELINE_IMAGE.exists():
        raise FileNotFoundError(f"Timeline image not found: {TIMELINE_IMAGE}")
    timeline_paragraph = insert_paragraph_after(period_intro)
    timeline_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    timeline_paragraph.paragraph_format.space_before = Pt(4)
    timeline_paragraph.paragraph_format.space_after = Pt(10)
    timeline_paragraph.add_run().add_picture(str(TIMELINE_IMAGE), width=Cm(15.0))

    # 古い期間説明を削除する。
    delete_paragraph(old_second_period_paragraph)

    # 宛名と日付をタイトルの前に、研究実施者名をタイトルの直後に配置する。
    title = document.paragraphs[0]
    letter_header = document.add_table(rows=1, cols=2)
    letter_header.alignment = WD_TABLE_ALIGNMENT.CENTER
    letter_header.autofit = False
    remove_table_borders(letter_header)
    set_table_bottom_border(letter_header)
    letter_header.rows[0].height = Cm(0.82)
    letter_header.rows[0].height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST
    header_widths = (Cm(9.6), Cm(5.4))
    set_fixed_table_widths(letter_header, header_widths)
    for index, width in enumerate(header_widths):
        letter_header.cell(0, index).vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        set_cell_margins(letter_header.cell(0, index), top=55, bottom=70, start=0, end=0)
    left = letter_header.cell(0, 0).paragraphs[0]
    left.alignment = WD_ALIGN_PARAGRAPH.LEFT
    left.paragraph_format.space_after = Pt(0)
    set_run_font(left.add_run("コンピュータシステム2受講者各位"), size=10.5, bold=True)
    right = letter_header.cell(0, 1).paragraphs[0]
    right.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    right.paragraph_format.space_after = Pt(0)
    set_run_font(right.add_run("2026年11月5日"), size=10.5)
    title._p.addprevious(letter_header._tbl)
    title.paragraph_format.space_before = Pt(11)
    title.paragraph_format.space_after = Pt(5)

    byline = insert_paragraph_after(title)
    byline.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    byline.paragraph_format.space_before = Pt(2)
    byline.paragraph_format.space_after = Pt(9)
    set_run_font(byline.add_run("研究実施者：天野結斗・加藤大貴"), size=10.5)

    # Preserve the original layout while ensuring Japanese glyphs render consistently.
    for style in document.styles:
        if getattr(style, "font", None) is not None:
            style.font.name = FONT_NAME
            style._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), FONT_NAME)
            style._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), FONT_NAME)
            style._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), FONT_NAME)
    for paragraph in document.paragraphs:
        for run in paragraph.runs:
            set_run_font(run)
    for tbl in document.tables:
        for row in tbl.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    for run in paragraph.runs:
                        set_run_font(run)

    remove_rendered_page_break_hints(document)
    remove_trailing_empty_paragraph(document)

    document.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    main()
