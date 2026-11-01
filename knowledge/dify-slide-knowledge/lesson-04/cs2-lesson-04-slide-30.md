# 第4回 スライド30 【参考】 Semaphoreの例 (C言語)

講義: コンピュータシステム2 第4回
出典: コンシス第4回.pdf、スライド30枚目
スライドID: cs2-lesson-04-slide-30

本文:
【参考】 Semaphoreの例 (C言語)
• 別プロセス間での相互排除:
• semabinit.c , sema.c, semb.c をコンパイル・リンク
• 最初に semabinit を実行
• semaphore を確保 (名前 1492)
• 2つterminal window を開いてそれぞれのwindowsで，sema/semb を実行
• Thread による相互排除の利用:
• Producer-Consumer 問題
• gcc -o p-c p-c.c -lpthread でコンパイル・リンク
• ./p-c で実行
• このプログラムは前スライドのアルゴリズムとは異なっている．適当な
バッファ容量 N を定義して, 前スライド のアルゴリズムを実現してみよ．
