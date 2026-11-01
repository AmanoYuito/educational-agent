# 4択問題のサーバー採点への更新

## 変更内容

- 正誤判定をReactからNode.jsの `/api/grade-quiz/` へ移動。
- Difyから取得した問題・正答・解説を `issued_quizzes` に保存し、回答前は問題と選択肢だけをブラウザへ返す。
- 採点と回答履歴の保存を同じトランザクションで実行。同じ問題への再送は最初の結果を返す。
- 正答は `happy`、誤答は `sweat`。表示・アバターの見た目は変更しない。
- 本更新の対象は4択問題。未実装の記述式サーバー採点はエラー表示にし、未検証の結果は保存しない。
- 既存の回答履歴を削除しない。更新前の未回答問題は、新しく問題を生成して置き換える。

## 1. Macから更新ファイルを送る

Mac側のターミナルで実行する。SSH接続中のサーバー側では実行しない。

```bash
scp /Users/yu110/Downloads/Research/aituber-kit-main/outputs/aituber-server-grading-update.tar.gz amano@160.251.180.133:~/
```

このアーカイブには変更したソース・テストのみを含む。`.env`、`.env.local`、Docker設定、DBデータは含まない。

## 2. サーバーでバックアップ・反映

```bash
ssh amano@160.251.180.133
cd ~/aituber-kit
sudo docker compose exec -T postgres pg_dump -U aituber_user -d aituber_kit > "$HOME/aituber_kit_before_grading_$(date +%Y%m%d_%H%M%S).sql"
```

バックアップがエラーなく完了したことを確認してから続ける。

```bash
tar -xzf ~/aituber-server-grading-update.tar.gz
sudo docker compose build app && sudo docker compose up -d --no-deps app
sudo docker compose logs --tail=80 app
```

ビルド成功時だけアプリを入れ替える。PostgreSQLコンテナを停止・再作成する必要はない。`docker compose down -v` は実行しない。

新テーブルはアプリのDB初期化処理で自動作成される。手動のDB初期化・既存バックアップの再投入・Difyフローの変更は不要。

## 3. 確認

1. Web画面を再読み込みしてログインする。
2. 「問題生成」で新しい4択問題を生成する。
3. 回答後に結果・解説・従来の感情表現が表示されることを確認する。
4. ページを再読み込みし、回答履歴・学習状況が残っていることを確認する。

通信失敗時は同じ回答を再送する。送信がサーバーで完了していた場合も履歴は重複しない。最初に保存された回答を後から別の選択肢に変更することはできない。

## 構成図への反映

「正誤判定」はNode.jsに対応する位置へ移す。Reactは回答入力・判定結果表示・感情表現を担当する。PostgreSQLには学習履歴に加えて、採点用の出題データも保持される。

## 検証範囲

関連テスト、本番ビルド、一時的なPostgreSQLとテスト用Dify応答を使った実通信試験を実施。本番サーバーへの反映と、実際のDify・Live2Dを使った画面確認は別途必要。
