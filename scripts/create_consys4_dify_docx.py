from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.text import WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor


OUTPUT = Path("output/documents/コンシス第4回_Difyナレッジ.docx")
FONT = "Hiragino Sans"


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def set_run_font(run, size=10.5, bold=False, color=None, name=FONT) -> None:
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    run.font.size = Pt(size)
    run.bold = bold
    if color:
        run.font.color.rgb = RGBColor(*color)


def add_paragraph(doc, text: str, *, bold_prefix: str | None = None, space_after=5, left=0):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.22
    p.paragraph_format.left_indent = Cm(left)
    if bold_prefix and text.startswith(bold_prefix):
        r1 = p.add_run(bold_prefix)
        set_run_font(r1, bold=True)
        r2 = p.add_run(text[len(bold_prefix):])
        set_run_font(r2)
    else:
        r = p.add_run(text)
        set_run_font(r)
    return p


def add_bullets(doc, items):
    for item in items:
        add_paragraph(doc, f"・{item}", space_after=2, left=0.45)


def add_code(doc, lines):
    for line in lines:
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Cm(0.7)
        p.paragraph_format.space_after = Pt(0)
        r = p.add_run(line)
        set_run_font(r, size=9.5, name=FONT)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def add_heading(doc, title: str, level=1):
    p = doc.add_heading(title, level=level)
    p.paragraph_format.keep_with_next = True
    p.paragraph_format.space_before = Pt(10 if level == 1 else 6)
    p.paragraph_format.space_after = Pt(4)
    for run in p.runs:
        set_run_font(
            run,
            size=14 if level == 1 else 12,
            bold=True,
            color=(31, 78, 121) if level == 1 else (54, 95, 145),
        )
    return p


def add_source(doc, text: str):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(5)
    r = p.add_run(f"参照範囲：{text}")
    set_run_font(r, size=8.5, color=(100, 100, 100))


def section(doc, number: int, title: str, source: str, paragraphs=(), bullets=(), code=()):
    if number > 1:
        separator = doc.add_paragraph()
        separator.paragraph_format.space_before = Pt(6)
        separator.paragraph_format.space_after = Pt(6)
        run = separator.add_run("===DIFY_SECTION_BREAK===")
        set_run_font(run, size=9, color=(89, 99, 113))

    add_heading(doc, f"【SECTION {number:02d}｜{title}】", level=1)
    add_source(doc, source)
    for paragraph in paragraphs:
        add_paragraph(doc, paragraph)
    if bullets:
        add_bullets(doc, bullets)
    if code:
        add_code(doc, code)


def make_document():
    doc = Document()
    sec = doc.sections[0]
    sec.top_margin = Cm(1.8)
    sec.bottom_margin = Cm(1.8)
    sec.left_margin = Cm(2.0)
    sec.right_margin = Cm(2.0)

    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = FONT
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    normal.font.size = Pt(10.5)

    title = doc.add_paragraph()
    title.alignment = 1
    title.paragraph_format.space_after = Pt(6)
    r = title.add_run("コンピュータシステム2 第4回\nDifyナレッジ用教材")
    set_run_font(r, size=20, bold=True, color=(31, 78, 121))

    subtitle = doc.add_paragraph()
    subtitle.alignment = 1
    subtitle.paragraph_format.space_after = Pt(14)
    r = subtitle.add_run("並行プロセスと相互排除・同期")
    set_run_font(r, size=14, bold=True, color=(89, 89, 89))

    box = doc.add_table(rows=1, cols=1)
    box.autofit = True
    cell = box.cell(0, 0)
    set_cell_shading(cell, "EAF2F8")
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    rr = p.add_run("収録範囲")
    set_run_font(rr, bold=True, color=(31, 78, 121))
    for line in [
        "・教科書 3.1『並行プロセスとは』（p.41-42）",
        "・教科書 3.3『プロセスの同期と相互排除』（p.45-51）",
        "・授業資料で扱う割込み禁止、ロック変数、Busy-wait、Sleep/Wakeup、生産者・消費者問題を補足",
        "・3.2 並行プロセスの指定、3.4 プロセス間通信、3.5 デッドロックは今回の対象外",
    ]:
        pp = cell.add_paragraph()
        pp.paragraph_format.space_after = Pt(1)
        rr = pp.add_run(line)
        set_run_font(rr, size=9.5)

    add_paragraph(
        doc,
        "この文書は、Difyの検索・問題生成で節の意味が混ざりにくいよう、各SECTIONを単独でも理解できる文章にしている。用語、仕組み、具体例、注意点を同じSECTION内にまとめ、複雑な表は使用していない。",
        space_after=10,
    )

    section(
        doc,
        1,
        "並行プロセスと逐次プロセス",
        "教科書 p.41-42／授業資料 3-12ページ",
        paragraphs=[
            "逐次プロセス（sequential process）は、依存関係などのため同時に実行できず、決められた順序で実行されるプロセスである。並行プロセス（concurrent process）は、2つ以上が同じ時間帯に進行可能なプロセスである。1個のCPUで処理を細かく切り替える場合も、複数のCPUで本当に同時実行する場合も、外から見れば複数処理が進行するため並行処理として扱われる。",
            "並行処理は、CPUがI/O待ちの間に別の処理を進めることや、Webサーバが複数の利用者の要求を待たせにくくすることに役立つ。一方、複数プロセスが同じデータや装置を扱う場合は、実行順序によって結果が変化するため、同期や相互排除が必要になる。",
        ],
        bullets=[
            "素（disjoint）な並行プロセス：共通に操作するデータが存在しない。",
            "交差（overlapping）する並行プロセス：共通のデータや資源を操作する。",
            "協同型逐次プロセス：同時実行できるが、共有資源を正しく使うために連絡や相互排除を必要とする。",
        ],
    )

    section(
        doc,
        2,
        "命令の交差と競合状態",
        "教科書 p.42／授業資料 10-12、19-20ページ",
        paragraphs=[
            "並行プロセスでは、高水準言語の1行が複数の機械語命令に分解される点が重要である。たとえば共有変数xの初期値が0で、P1が「x := x + 1」、P2が「x := x + 2」を実行するとする。各代入は、(1) xをレジスタへ読み出す、(2) 値を加算する、(3) 結果をxへ書き戻す、という複数命令で処理される。",
            "P1とP2の命令が交差すると、両方が同じ古い値0を読み、後から書いた値が先の結果を上書きすることがある。そのため、期待値3だけでなく1や2になる可能性がある。このように、実行のタイミングや順序によって結果が変わる状態を競合状態（race condition）という。",
            "競合を避けるには、読み出しから書き戻しまでの一連の操作を途中で分割されない不可分（indivisible／atomic）な操作として扱うか、その間に他プロセスが同じ資源へ入れないよう制御する。",
        ],
    )

    section(
        doc,
        3,
        "共有資源・逐次的資源・臨界領域",
        "教科書 p.45／授業資料 13ページ",
        paragraphs=[
            "複数のプロセスから利用されるプログラム、データ、ファイル、メモリ領域、プリンタなどを共有資源（shared resource）という。共有資源のうち、同時には1つのプロセスしか安全に利用できない資源を逐次的資源（sequential resource）という。",
            "各プロセスのプログラム中で逐次的資源を使用する部分を臨界領域（critical section／critical region）という。複数プロセスが同時に同じ臨界領域へ入ると、データ破壊、出力の混在、不整合などが発生する可能性がある。",
            "臨界領域は、共有資源へのアクセス前に利用権を獲得し、処理後に必ず解放する構造にする。共有資源が衝突する可能性が少しでもある場合は、タイミング任せにせず制御を行う必要がある。",
        ],
    )

    section(
        doc,
        4,
        "同期と相互排除の違い",
        "教科書 p.45／授業資料 13-15ページ",
        paragraphs=[
            "相互排除（mutual exclusion）は、あるプロセスが共有資源を使用している間、他のプロセスを待たせ、同時利用を防ぐ仕組みである。目的は、臨界領域へ同時に入るプロセスを高々1つにして、データ破壊や競合を防ぐことである。",
            "同期（synchronization）は、あるプロセスの処理を、別のプロセスで起きた事象や処理結果に合わせる仕組みである。たとえば消費者は、バッファが空なら生産者がデータを入れるまで待つ。生産者は、バッファが満杯なら消費者がデータを取り出すまで待つ。",
            "相互排除は『同時に使わせない』制御であり、同期は『条件が整うまで待ち、整ったことを連絡する』制御である。生産者・消費者問題のように、実際の並行処理では両者を組み合わせることが多い。",
        ],
    )

    section(
        doc,
        5,
        "割込み禁止による相互排除",
        "授業資料 15-16ページ（教科書3.3の補足）",
        paragraphs=[
            "CPUが別プロセスへ切り替わる主な契機は割込みである。臨界領域へ入る直前に割込みを禁止し、出る直前に許可すれば、処理途中で別プロセスへ切り替わりにくくなるため、単一CPU上では相互排除を実現できる。",
            "ただし、割込み禁止中は重要な通知への応答が遅れる。禁止時間の設計が難しく、利用者プログラムへ許可するとシステム全体を停止させる危険もある。複数CPUでは、1つのCPUの割込みを止めても別CPUが共有資源へアクセスできる。このため、BIOSやデバイスドライバなどの短く限定された処理を除き、一般的な相互排除手段としては使いにくい。",
        ],
    )

    section(
        doc,
        6,
        "単純なロック変数が安全でない理由",
        "授業資料 19-20ページ／教科書 p.42、47-48",
        paragraphs=[
            "単純なロック変数では、一般に0を未使用、1を使用中として共有する。プロセスはlockが0か調べ、0なら1へ変更して臨界領域へ入り、終了時に0へ戻す。考え方は単純だが、『0か確認する処理』と『1へ変更する処理』が別命令なら安全ではない。",
            "P1が0を確認した直後、1へ変更する前にP2へ切り替わると、P2も0を確認できる。その後、両方が1を設定して臨界領域へ入ってしまう。したがって、ロック変数を使うだけでは不十分であり、確認と設定を1つの不可分操作として実行する同期基本命令が必要になる。",
        ],
    )

    section(
        doc,
        7,
        "Dekker／Peterson型アルゴリズム",
        "教科書 p.45-47／授業資料 17-18ページ",
        paragraphs=[
            "Dekkerのアルゴリズムは、主記憶への単純な読み書きが不可分であることを利用し、2つのプロセスだけで相互排除を実現する代表的なソフトウェア方式である。各プロセスは、自分が臨界領域へ入りたいことを示すフラグと、同時に希望した場合の優先順を示すturnを共有する。相手も希望している場合はturnに従って一方が待ち、退出時に相手へ順番を渡す。",
            "授業資料ではPetersonのアルゴリズムをDekkerのアルゴリズムと併記している。厳密には別のアルゴリズムだが、いずれも『進入希望』と『順番』を共有して2プロセスの相互排除を説明する方式である。Petersonの方式は元のDekker方式より単純で、相互排除の原理を理解する教材として使われる。",
            "この方式は、対象プロセスがあらかじめ分かっている必要があり、待機中も共有変数を確認し続ける。多数の動的なプロセスを扱う実用システムでは、そのまま使うより、CPU命令やOSが提供するロック、セマフォ、モニタを利用する。",
        ],
    )

    section(
        doc,
        8,
        "TS命令・Busy-wait・スピンロック",
        "教科書 p.47-48／授業資料 21-23ページ",
        paragraphs=[
            "TS命令（test and set）は、共有変数の値を読み出して調べる処理と、新しい値を設定する処理を1つの不可分な機械語命令として行う同期基本命令である。実行途中に割込みが入らないため、複数プロセスが同時にロック獲得に成功することを防げる。",
            "TS命令でロックを獲得できるまで短いループを繰り返す待ち方をBusy-waitという。このとき使用するロックはスピンロック（spin lock）と呼ばれる。待ち時間が非常に短い場合は、プロセス切替の負担を避けられる利点がある。一方、待機中もCPUを使い続けるため、長時間の待ちや単一CPU環境ではCPUを無駄にし、システム性能を低下させる。",
        ],
        code=[
            "lock:   old = test_and_set(flag)   // flagを1にし、変更前の値を得る（不可分）",
            "        if old != 0 then goto lock",
            "        // 臨界領域",
            "unlock: flag = 0",
        ],
    )

    section(
        doc,
        9,
        "SleepとWakeupによる待機",
        "授業資料 23ページ（教科書3.3の補足）",
        paragraphs=[
            "Busy-waitの代わりに、資源を利用できないプロセスをsleepさせ、実行可能なプロセスへCPUを割り当てる方法がある。資源が利用可能になったとき、別プロセスまたはOSがwakeupを行い、待っていたプロセスを再び実行可能にする。",
            "Sleep/Wakeup方式は、待機中にCPUを消費しないため、待ち時間が長い場合に向いている。ただし、待ち始める直前とwakeup通知の順序がずれると通知を失う可能性がある。このため、実用上は待ち行列と状態変更を不可分に扱うセマフォや条件変数などを用いる。",
        ],
    )

    section(
        doc,
        10,
        "セマフォの基本",
        "教科書 p.48-50／授業資料 24-27ページ",
        paragraphs=[
            "セマフォ（semaphore）はDijkstraが提案した同期用の非負整数変数であり、P操作とV操作の2種類の不可分操作だけを通して変更する。授業資料ではPをdown、Vをupとも呼ぶ。",
        ],
        bullets=[
            "P／down：値が0より大きければ1減らして先へ進む。0なら待ち行列に入りsleepする。",
            "V／up：値を1増やす。待ち行列にプロセスがあれば、そのうち1つを起こしてP操作の終了を許可する。",
            "2進セマフォ：値を0と1として相互排除に使う。初期値1なら、同時に臨界領域へ入れるのは1プロセス。",
            "計数セマフォ：0以上の値を取り、同時利用可能な資源数やバッファの空き数・データ数を表す。",
        ],
        code=[
            "down(S);      // 利用権を得る。得られなければ待つ",
            "critical();   // 共有資源を使う臨界領域",
            "up(S);        // 利用権を返す",
        ],
    )

    section(
        doc,
        11,
        "2進セマフォによる相互排除",
        "教科書 p.49-50／授業資料 25-27ページ",
        paragraphs=[
            "相互排除に使う2進セマフォmutexの初期値を1にする。最初のプロセスがdown(mutex)を実行すると値は0になり、臨界領域へ入る。別プロセスがdown(mutex)を実行したとき値が0なら、そのプロセスは待ち行列へ入る。先のプロセスがup(mutex)を実行すると、待っているプロセスの1つが起こされる。",
            "セマフォの値の確認、更新、待ち行列への移動、起床は一貫して処理されなければならないため、downとupはOSの不可分なシステムコールとして実装される。初期値を2にすれば同時に2プロセスまで入れるなど、資源数に合わせて制限を表現できる。",
        ],
    )

    section(
        doc,
        12,
        "生産者・消費者問題と計数セマフォ",
        "授業資料 28-32ページ／教科書 p.50-51の同期例に対応",
        paragraphs=[
            "生産者・消費者問題では、生産者がデータを固定長バッファへ入れ、消費者が取り出す。バッファが満杯なら生産者は待ち、空なら消費者は待つ。また、挿入と取り出しでバッファ管理情報が壊れないよう相互排除が必要である。",
            "容量Nのバッファに対し、empty=N（空き数）、full=0（格納済み数）、mutex=1（バッファ操作の相互排除）で開始する。emptyとfullは同期・連絡を、mutexは相互排除を担当する。操作順序を守ることで、満杯や空の状態を待ちつつ、バッファを安全に更新できる。",
        ],
        code=[
            "生産者: down(empty) → down(mutex) → insert() → up(mutex) → up(full)",
            "消費者: down(full)  → down(mutex) → remove() → up(mutex) → up(empty)",
        ],
    )

    section(
        doc,
        13,
        "セマフォ利用時の注意点",
        "教科書 p.50／授業資料 34ページ",
        paragraphs=[
            "セマフォは柔軟だが、downとupを各処理へ明示的に書くため、指定位置や順序を誤りやすい。条件分岐や例外処理でupを飛ばすと資源が永久に解放されず、逆にdownを忘れると相互排除できない。複数セマフォの獲得順序が不統一だと、プロセス同士が互いの解放を待つデッドロックを起こす可能性もある。",
            "downで待ちに入ると、そのP操作が完了するまで別の処理へ進めない。さらに、セマフォを必要としない処理からも変数が見える設計では誤操作の原因になる。そこで、共有資源と操作を一体化し、排他制御を構造側で保証するモニタが利用される。",
        ],
    )

    section(
        doc,
        14,
        "モニタの考え方",
        "教科書 p.50-51／授業資料 35-37ページ",
        paragraphs=[
            "モニタ（monitor）は、HoareとBrinch Hansenが提案した高水準の同期機構である。共有資源、その資源を操作する手続き、初期化コードを1つのモジュールへまとめ、外部プロセスはモニタ内の手続きを呼び出して資源を利用する。共有変数へ直接アクセスさせないため、誤りをモニタ内へ局在化できる。",
            "モニタ内では、一度に1つのプロセスだけがアクティブになるよう処理系が保証する。そのため、プログラマが各所で明示的にlockとunlockを書く必要がなく、解放忘れを減らせる。同期・連絡が絡む並行プログラムを、セマフォより構造的に記述しやすい。",
        ],
    )

    section(
        doc,
        15,
        "条件変数wait・signalとモニタ",
        "教科書 p.50-51／授業資料 36-37ページ",
        paragraphs=[
            "モニタ内部で、単に排他的に実行するだけでなく条件が整うまで待つために条件変数（condition variable）を使う。waitは、条件を満たせないプロセスを待ち状態にし、モニタの実行権を別プロセスへ渡す。signalは、その条件変数で待っているプロセスの1つを再開可能にする。待っているプロセスがなければ何もしない。",
            "条件変数はセマフォのような回数を保存するカウンタではない。signalを先に実行しても、後から行われるwaitのために通知が蓄積されるわけではない。授業で扱うモニタの相互排除規則では、signal後にどのプロセスがモニタ内を実行するかを明確にする必要があり、signalを実行した側は速やかにモニタを出る形で説明される。",
        ],
    )

    section(
        doc,
        16,
        "モニタによる有限バッファの同期",
        "教科書 p.51／授業資料 37ページ",
        paragraphs=[
            "有限バッファをモニタで実装する場合、バッファ、格納データ数no_of_data、取り出し手続きget、格納手続きput、条件変数emptyとfullを1つにまとめる。getはデータ数が0ならempty.waitで待ち、データを取り出した後にfull.signalで『満杯ではなくなった』ことを知らせる。putはデータ数がN以上ならfull.waitで待ち、格納後にempty.signalで『空ではなくなった』ことを知らせる。",
            "getとputはモニタ手続きなので、バッファやno_of_dataの更新は同時に1プロセスだけが行う。これにより、相互排除はモニタ構造が保証し、空・満杯に関する同期は条件変数が担当する。生産者・消費者問題で必要な2種類の制御を分けて表現できる。",
        ],
    )

    section(
        doc,
        17,
        "相互排除方式の使い分け",
        "授業資料 15-37ページのまとめ",
        bullets=[
            "割込み禁止：OS内部の非常に短い処理向け。一般アプリケーションには危険で、複数CPUにもそのまま対応できない。",
            "単純ロック変数：確認と設定が分離されるため安全ではない。",
            "Dekker／Peterson型：ソフトウェアだけで原理を説明できるが、対象プロセスが既知で、実用上の制約が大きい。",
            "TS命令・スピンロック：不可分にロックできる。待ちが短い場合は有効だが、Busy-waitでCPUを消費する。",
            "Sleep/Wakeup：待機中のCPU消費を避けられるが、通知と待機状態の管理を安全に行う仕組みが必要。",
            "セマフォ：相互排除と同期の両方を表現できるが、P/Vの位置や順序を誤りやすい。",
            "モニタ：共有資源と操作を一体化し、相互排除を構造的に保証する。条件変数で同期も表現できる。",
        ],
    )

    section(
        doc,
        18,
        "重要用語一覧",
        "今回の対象範囲全体",
        bullets=[
            "並行プロセス：同じ時間帯に進行できる複数のプロセス。",
            "競合状態：実行順序やタイミングによって共有データの結果が変わる状態。",
            "不可分操作：途中で割り込まれず、1つのまとまりとして実行される操作。",
            "共有資源：複数プロセスから利用されるデータ、プログラム、装置など。",
            "臨界領域：逐次的資源を利用するプログラム部分。",
            "相互排除：共有資源を同時に複数プロセスへ使わせない制御。",
            "同期：別プロセスの事象や条件に合わせて処理を待機・再開する制御。",
            "Busy-wait：条件成立までCPUを使って繰り返し確認する待ち方。",
            "スピンロック：Busy-waitでロック獲得を待つ方式。",
            "セマフォ：P/downとV/upで資源数や条件を管理する同期変数。",
            "モニタ：共有資源、操作、初期化、同期処理をまとめた高水準の同期機構。",
            "条件変数：モニタ内で条件待ちを表す変数。waitとsignalで待機・再開を制御する。",
        ],
    )

    # Footer
    for sec in doc.sections:
        footer = sec.footer
        p = footer.paragraphs[0]
        p.alignment = 2
        r = p.add_run("コンピュータシステム2 第4回｜Difyナレッジ用")
        set_run_font(r, size=8, color=(128, 128, 128))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUTPUT)
    print(OUTPUT.resolve())


if __name__ == "__main__":
    make_document()
