# 第4回 スライド22 ビジーウェイト2: TS命令による相互排除の例

講義: コンピュータシステム2 第4回
出典: コンシス第4回.pdf、スライド22枚目
スライドID: cs2-lesson-04-slide-22

## スライド本文

ビジーウェイト2: TS命令による相互排除の例
レジスタ r1
レジスタ r2
プロセス p2
フラグ f
critical ()TSL r1, f
lock成功
1 0
t
コピー
lock:
TSL register, flag // ①
CMP register, 0 // ②
JNZ lock // ③
RET // ④
? T
不可分
プロセス p1
critical ()
ブロック
? F
1
unlock:
MOV flag // ⑤
RET // ⑥
① flagの値をレジスタにコピーして flag値を1に
② レジスタにコピーされた flag値は0か?
③ 0でなければlockの冒頭へ
④ 0なら呼び出し元に戻り際どい領域へ
⑤ flag値を0に
⑥ 呼び出し元に戻る
CMP r1, 0
チェック前にロックして
割り込みを防止している
但しループ中はビジー
(プロセッサを使用)
0
0 1
セット
1
コピー
TSL r2, f
1
セット
CMP r2, 0
MOV f, 0
1
0
TSL r2, f
1
1
コピー
セット
CMP r2, 0
? F
1
TSL r2, f
0
0
コピー
CMP r2, 0
1
0
? T
MOV f, 0
0
セット
セット
セット
不可分不可分 不可分
ブロック
lock失敗 lock失敗 lock成功
際どい領域 unlock
際どい領域 unlock
