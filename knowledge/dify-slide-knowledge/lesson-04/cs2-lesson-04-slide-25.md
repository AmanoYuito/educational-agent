# 第4回 スライド25 Semaphoreの典型的な利用例

講義: コンピュータシステム2 第4回
出典: コンシス第4回.pdf、スライド25枚目
スライドID: cs2-lesson-04-slide-25

## スライド本文

Semaphoreの典型的な利用例
Semaphore S = 初期値; /* 1 or 2 (1の場合同時1, 2の場合同時2*/
Process 1, 2, 3, 4
/* ソースは共通で記述. 同じである必要はない*/
...
down(S); /*Down (P) 操作*/
Critical_region(); /* Critical Region にあるコード */
up(S); /* Up (V) 操作 */
...
