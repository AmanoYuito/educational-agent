#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

release_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
app_dir=${1:-"$HOME/aituber-kit"}
app_dir=$(cd -- "$app_dir" && pwd)
backup_parent=${2:-"$HOME"}

files=(
  src/components/chatLog.tsx
  src/components/messageInput.tsx
  src/components/quizPerformanceSummary.tsx
  src/lib/server/learningFeedback.ts
  src/lib/server/learningFeedbackText.ts
  src/lib/server/learningSessions.ts
)

cd "$app_dir"
test -f docker-compose.yml
for file in "${files[@]}"; do
  test -f "$release_dir/$file"
done

printf 'サーバーのsudoパスワードを入力してください。\n'
sudo -v
sudo docker compose ps app

backup_dir=$(mktemp -d "$backup_parent/aituber-feedback-ui-cleanup-backup.XXXXXXXX")
printf 'バックアップ: %s\n' "$backup_dir"
: > "$backup_dir/preexisting-files.txt"
for file in "${files[@]}"; do
  if [[ -f "$app_dir/$file" ]]; then
    printf '%s\n' "$file" >> "$backup_dir/preexisting-files.txt"
  fi
done

if [[ -s "$backup_dir/preexisting-files.txt" ]]; then
  tar -czf "$backup_dir/source-before.tar.gz" -T "$backup_dir/preexisting-files.txt"
fi

app_container=$(sudo docker compose ps -q app)
test -n "$app_container"
old_image=$(sudo docker inspect --format '{{.Image}}' "$app_container")
rollback_image="aituber-feedback-ui-cleanup-rollback:$(date +%Y%m%d-%H%M%S)"
sudo docker tag "$old_image" "$rollback_image"
printf 'services:\n  app:\n    image: %s\n' "$rollback_image" > "$backup_dir/rollback.compose.yml"

restart_attempted=0
rollback() {
  exit_code=$?
  trap - ERR
  set +e
  printf '更新に失敗したため、変更ファイルと旧イメージを復元します。\n' >&2
  if [[ -f "$backup_dir/source-before.tar.gz" ]]; then
    tar -xzf "$backup_dir/source-before.tar.gz" -C "$app_dir"
  fi
  for file in "${files[@]}"; do
    if ! grep -Fqx "$file" "$backup_dir/preexisting-files.txt"; then
      rm -f "$app_dir/$file"
    fi
  done
  if [[ "$restart_attempted" == 1 ]]; then
    sudo docker compose -f docker-compose.yml -f "$backup_dir/rollback.compose.yml" up -d --no-deps --no-build app
  fi
  printf 'DB、回答履歴、APIキー、Dify設定は変更していません。バックアップ: %s\n' "$backup_dir" >&2
  exit "$exit_code"
}
trap rollback ERR

for file in "${files[@]}"; do
  mkdir -p "$(dirname "$app_dir/$file")"
  install -m 644 "$release_dir/$file" "$app_dir/$file"
done

sudo docker compose build app
restart_attempted=1
sudo docker compose up -d --no-deps app

ready=0
for attempt in $(seq 1 30); do
  if sudo docker compose exec -T app node -e '
    const root = "http://127.0.0.1:3000" + (process.env.BASE_PATH || "");
    Promise.all([
      fetch(root + "/", {redirect:"manual", signal:AbortSignal.timeout(3000)}),
      fetch(root + "/lessons/computer-systems-2-04/", {redirect:"manual", signal:AbortSignal.timeout(3000)})
    ]).then(([home, lesson]) => {
      const ok = status => [200, 302, 307, 308].includes(status);
      if (!ok(home.status) || !ok(lesson.status)) process.exit(1);
    }).catch(() => process.exit(1));
  ' > /dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "$ready" != 1 ]]; then
  printf '更新後の画面を確認できませんでした。\n' >&2
  false
fi

trap - ERR
sudo docker compose ps app
printf '\n表示変更を反映しました。ブラウザを再読み込みしてください。\nバックアップ: %s\n' "$backup_dir"
