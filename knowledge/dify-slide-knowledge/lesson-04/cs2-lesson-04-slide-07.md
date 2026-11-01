# 第4回 スライド07 (参考) Windowsにおける各プロセスのThreads

講義: コンピュータシステム2 第4回
出典: コンシス第4回.pdf、スライド7枚目
スライドID: cs2-lesson-04-slide-07

本文:
(参考) Windowsにおける各プロセスのThreads
• Powershell アプリを起動
o 以下の powershell comandlet を起動
o Get-process (cr) .... 実行中のプロセス一覧を表示
o Get-process | fl * .... 実行中のプロセスの諸状況を表示
o Get-process ap-name | fl * .... ap-name というアプリの状況を表示
o この中で，Threads ... の部分を参照
• MacOSの場合
o アクティビティモニタアプリを起動（実機未確認 )
o https://support.apple.com/ja -jp/guide/activity-monitor/actmntr1001/mac
o すいません．Macの実機を持っていないため例示できません．
o ターミナル上で，ps xM コマンド実行でも表示される (らしい)
