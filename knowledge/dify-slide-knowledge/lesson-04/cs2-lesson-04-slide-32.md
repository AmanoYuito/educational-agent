# 第4回 スライド32 計数 (counting) セマフォによる読み書き同期の例

講義: コンピュータシステム2 第4回
出典: コンシス第4回.pdf、スライド32枚目
スライドID: cs2-lesson-04-slide-32

## スライド本文

計数 (counting) セマフォによる読み書き同期の例
プロセス
(p)
empty
(e)
mutex
(m)
full
(f)
insert()down(e)
f++して スリープ中の
cを起こす
wake
up!
t
1
0
-1
0 1
+1
プロセス
(c)
0
4
1
e > 0なら
-1して次へ
4 3
-1
down(f)
0
f == 0 なので スリープ
down(m)
1 0
-1
m > 0なら
-1して次へ
up(m)
1
+1
ロック
up(f)
1
+1
m++
down(f) down(m)
1
-1
remove() up(m) up(e)
ロック
4
+1
f > 0なら
-1して次へ
m > 0なら
-1して次へ
p c
down(e)
↑
e e e e p c
↑
down(m)
e e e p c
←insert()
e e e p c
up(m)
↑
e e e p c
up(f)↑
f e e e
