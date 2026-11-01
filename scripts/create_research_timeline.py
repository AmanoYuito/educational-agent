from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


OUTPUT = Path(
    "/Users/yu110/Downloads/Research/aituber-kit-main/output/documents/"
    "research_usage_timeline.png"
)
FONT_REGULAR_PATH = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"
FONT_BOLD_PATH = "/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc"

NAVY = "#1F4E78"
BLUE = "#4F86C6"
PALE_BLUE = "#EAF2F8"
PALE_LINE = "#C9D9E8"
ORANGE = "#D97706"
DARK = "#1F2937"
MUTED = "#5B6472"


def font(size, *, bold=False):
    path = FONT_BOLD_PATH if bold else FONT_REGULAR_PATH
    return ImageFont.truetype(path, size)


def centered(draw, xy, text, text_font, fill):
    box = draw.textbbox((0, 0), text, font=text_font)
    width = box[2] - box[0]
    height = box[3] - box[1]
    draw.text((xy[0] - width / 2, xy[1] - height / 2), text, font=text_font, fill=fill)


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (2000, 560), "white")
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle(
        (45, 35, 1955, 525), radius=34, fill=PALE_BLUE, outline=PALE_LINE, width=3
    )

    start_x, middle_x, end_x = 205, 955, 1820
    top_y, center_y, bottom_y = 242, 280, 318

    # Two connected arrow bands clearly separate the initial trial and continued-use periods.
    draw.polygon(
        [(start_x, top_y), (885, top_y), (middle_x, center_y), (885, bottom_y), (start_x, bottom_y)],
        fill=NAVY,
    )
    draw.polygon(
        [(middle_x, top_y), (1745, top_y), (end_x, center_y), (1745, bottom_y), (middle_x, bottom_y)],
        fill=BLUE,
    )

    # Milestones.
    for x, color in ((start_x, NAVY), (middle_x, ORANGE), (end_x, NAVY)):
        draw.ellipse((x - 19, center_y - 19, x + 19, center_y + 19), fill="white", outline=color, width=9)

    date_bold = font(34, bold=True)
    label_bold = font(31, bold=True)
    detail_font = font(24)
    small_font = font(22)

    centered(draw, (start_x, 92), "2026年11月5日", date_bold, NAVY)
    centered(draw, (middle_x, 92), "2026年11月12日", date_bold, ORANGE)
    centered(draw, (end_x, 92), "2027年2月4日", date_bold, NAVY)

    centered(draw, (start_x, 146), "利用開始", small_font, MUTED)
    centered(draw, (end_x, 146), "テスト期間終了", small_font, MUTED)

    # Thin guides keep each date visually tied to its milestone.
    draw.line((start_x, 172, start_x, top_y - 8), fill=PALE_LINE, width=3)
    draw.line((end_x, 172, end_x, top_y - 8), fill=PALE_LINE, width=3)

    # Questionnaire marker connected to the central milestone.
    draw.line((middle_x, 177, middle_x, top_y - 5), fill=ORANGE, width=5)
    box_w, box_h = 340, 64
    draw.rounded_rectangle(
        (middle_x - box_w / 2, 145, middle_x + box_w / 2, 145 + box_h),
        radius=18,
        fill="white",
        outline=ORANGE,
        width=4,
    )
    centered(draw, (middle_x, 177), "アンケート回答", label_bold, ORANGE)

    first_center = (start_x + middle_x) / 2
    second_center = (middle_x + end_x) / 2
    centered(draw, (first_center, 386), "集中試用期間", label_bold, NAVY)
    centered(draw, (first_center, 438), "授業内容の確認・復習", detail_font, DARK)
    centered(draw, (second_center, 386), "継続利用可能期間", label_bold, BLUE)
    centered(draw, (second_center, 438), "必要に応じて自由に利用", detail_font, DARK)

    image.save(OUTPUT, quality=95)
    print(OUTPUT)


if __name__ == "__main__":
    main()
