from copy import deepcopy
from pathlib import Path

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor


DOCUMENT_PATH = Path(
    "/Users/yu110/Downloads/Research/aituber-kit-main/output/documents/"
    "AI学習支援チャットボットの利用と研究へのご協力のお願い_修正版.docx"
)
TEMP_PATH = DOCUMENT_PATH.with_name(DOCUMENT_PATH.stem + "_updating.docx")
FONT_NAME = "Arial Unicode MS"


def normalized(text: str) -> str:
    return " ".join(text.split())


def find_paragraph(document, text: str):
    target = normalized(text)
    for paragraph in document.paragraphs:
        if normalized(paragraph.text) == target:
            return paragraph
    raise ValueError(f"Paragraph not found: {text}")


def set_run_font(run, size=11, bold=False):
    run.font.name = FONT_NAME
    r_pr = run._element.get_or_add_rPr()
    r_fonts = r_pr.get_or_add_rFonts()
    r_fonts.set(qn("w:eastAsia"), FONT_NAME)
    r_fonts.set(qn("w:ascii"), FONT_NAME)
    r_fonts.set(qn("w:hAnsi"), FONT_NAME)
    run.font.size = Pt(size)
    run.bold = bold
    run.font.color.rgb = RGBColor(0, 0, 0)


def replace_text(paragraph, text: str, size=11, bold=False):
    for run in list(paragraph.runs):
        run._element.getparent().remove(run._element)
    set_run_font(paragraph.add_run(text), size=size, bold=bold)


def insert_after(paragraph, text: str, style_source=None):
    new_p = OxmlElement("w:p")
    paragraph._p.addnext(new_p)
    new_paragraph = paragraph._parent.add_paragraph()
    new_paragraph._p.getparent().remove(new_paragraph._p)
    new_p.getparent().replace(new_p, new_paragraph._p)

    if style_source is not None:
        source_p_pr = style_source._p.pPr
        if source_p_pr is not None:
            new_paragraph._p.insert(0, deepcopy(source_p_pr))
    set_run_font(new_paragraph.add_run(text), size=11)
    return new_paragraph


def delete_paragraph(paragraph):
    element = paragraph._element
    element.getparent().remove(element)
    paragraph._p = paragraph._element = None


def main():
    document = Document(DOCUMENT_PATH)

    purpose = find_paragraph(
        document,
        "本研究では、授業資料に基づく問題、AIによる解説やフィードバック、ペット型アバターを組み合わせることで、学習者が授業内容を自分の言葉で整理し、自分が理解できていることや見直す必要があることを確認できるかを調べます。",
    )
    replace_text(
        purpose,
        "本研究では、授業資料に基づく問題、AIによる解説やフィードバック、ペット型アバターを組み合わせ、学習者がAIとの対話や記述問題への回答を通して、学んだ内容を自分の言葉で対話的に説明・整理することにより、授業内容への理解を深められるかを調べます。あわせて、自分が理解できている点や見直す必要がある点を確認できるかを検討します。",
    )

    old_items = [
        "システムとの会話内容",
        "出題された問題",
        "4択問題や記述問題への回答",
        "正誤や記述回答の評価結果",
        "回答にかかった時間",
        "表示された解説やフィードバック",
        "システムの利用状況やエラーの記録",
        "利用後アンケートへの回答",
    ]
    item_paragraphs = [find_paragraph(document, item) for item in old_items]
    bullet_style = item_paragraphs[0]
    new_items = [
        "システムとの会話内容（質問、AIの回答など）",
        "出題された問題",
        "4択問題や記述問題への回答",
        "正誤や記述回答の評価結果",
        "回答にかかった時間",
        "表示された解説やフィードバック",
        "システムの利用日時や利用時間",
        "表示した画面や授業資料の閲覧状況",
        "利用端末、OS、ブラウザ、IPアドレスなどの接続・利用環境",
        "システムの動作状況やエラーの記録",
        "利用後アンケートへの回答",
    ]

    for paragraph, text in zip(item_paragraphs, new_items[: len(item_paragraphs)]):
        replace_text(paragraph, text)

    anchor = item_paragraphs[-1]
    for text in new_items[len(item_paragraphs) :]:
        anchor = insert_after(anchor, text, style_source=bullet_style)

    use_paragraph = find_paragraph(
        document,
        "これらの情報は、研究とシステム改善の目的で使用します。また、研究発表や修士論文などで、集計した結果を使用する場合があります。",
    )
    replace_text(
        use_paragraph,
        "これらの情報は、研究とシステム改善の目的で使用します。会話内容（チャットログ）については、質問の内容、学んだことの説明の仕方、授業内容の関連づけ方などを分析し、学習者の理解の表れやつまずきの特徴を検討します。また、研究発表や修士論文などで、個人を特定できない形に集計・加工した結果を使用する場合があります。",
    )

    privacy = find_paragraph(
        document,
        "収集した情報は研究用のIDに置き換えるなど、個人を特定できない形に加工して分析します。研究発表や修士論文において、個人が特定できる情報を公表することはありません。",
    )
    replace_text(
        privacy,
        "収集した情報は研究用のIDに置き換えるなど、個人を特定できない形に加工して分析します。本研究では、収集した情報を用いて個人を特定することはありません。研究発表や修士論文において、個人が特定できる情報を公表することもありません。",
    )

    input_warning = find_paragraph(
        document,
        "チャットや記述回答、アンケートの自由記述欄にも、氏名、学籍番号、連絡先などの個人情報を入力しないでください。",
    )
    replace_text(
        input_warning,
        "チャットや記述回答、アンケートの自由記述欄には、氏名、学籍番号、連絡先などの個人情報を入力しないでください。万一、入力内容や接続情報に個人情報が含まれていた場合は、分析前に該当部分を削除または匿名化し、個人を特定できない状態にしてから使用します。",
    )

    document.save(TEMP_PATH)
    TEMP_PATH.replace(DOCUMENT_PATH)
    print(DOCUMENT_PATH)


if __name__ == "__main__":
    main()
