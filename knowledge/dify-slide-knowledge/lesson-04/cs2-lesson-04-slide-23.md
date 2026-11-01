# 第4回 スライド23 Busy-wait と Sleep and Wakeup

講義: コンピュータシステム2 第4回
出典: コンシス第4回.pdf、スライド23枚目
スライドID: cs2-lesson-04-slide-23

## スライド本文

Busy-wait と Sleep and Wakeup
• Busy-wait
• 常に繰り返しロック変数 (spin lock) をテスト (tight loop に陥る)
• CPU が無駄使いされる
• システム性能の低下につながる
• Sleep and Wakeup
• sleep システムコールを利用
• sleep している場合，CPU は他に割り当てられる
• awake システムコール
• sleep している場合，CPU の割当を開始
