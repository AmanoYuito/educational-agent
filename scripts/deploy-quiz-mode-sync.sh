#!/usr/bin/env bash
# Run from the staged update directory on the existing Linux server.
set -Eeuo pipefail
umask 077

release_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
app_dir=${1:-"$HOME/aituber-kit"}
app_dir=$(cd -- "$app_dir" && pwd)
backup_parent=${2:-"$HOME"}

cd "$release_dir"
sha256sum --check PAYLOAD.sha256
cd "$app_dir"
test -f docker-compose.yml
test -f src/lib/server/quizGrading.ts
sha256sum --check "$release_dir/BASELINE.sha256"
while IFS= read -r file; do
  if [[ -e "$file" || -L "$file" ]]; then
    printf '新規ファイルが既に存在するため停止します: %s\n' "$file" >&2
    exit 1
  fi
done < "$release_dir/NEW_FILES.txt"

printf 'サーバーのsudoパスワードを入力してください。\n'
sudo -v
sudo docker compose ps
backup_dir=$(mktemp -d "$backup_parent/aituber-quiz-mode-sync-backup.XXXXXXXX")
printf 'バックアップ先: %s\n' "$backup_dir"

# Stop before modifying sources if either backup fails.
sudo docker compose exec -T postgres pg_dump -U aituber_user -d aituber_kit -Fc > "$backup_dir/database.dump.part"
test -s "$backup_dir/database.dump.part"
sudo docker compose exec -T postgres pg_restore --list < "$backup_dir/database.dump.part" > /dev/null
mv "$backup_dir/database.dump.part" "$backup_dir/database.dump"
tar -czf "$backup_dir/source-before.tar.gz" -T "$release_dir/EXISTING_FILES.txt"
app_container=$(sudo docker compose ps -q app)
test -n "$app_container"
old_image=$(sudo docker inspect --format '{{.Image}}' "$app_container")
rollback_image="aituber-quiz-mode-sync-rollback:$(date +%Y%m%d-%H%M%S)"
sudo docker tag "$old_image" "$rollback_image"
printf 'services:\n  app:\n    image: %s\n' "$rollback_image" > "$backup_dir/rollback.compose.yml"
cp "$release_dir/NEW_FILES.txt" "$backup_dir/new-files.txt"

restart_attempted=0
rollback() {
  exit_code=$?
  trap - ERR
  set +e
  printf '更新に失敗しました。ソースをバックアップから戻します。\n' >&2
  tar -xzf "$backup_dir/source-before.tar.gz" -C "$app_dir"
  while IFS= read -r file; do
    rm -f -- "$app_dir/$file"
  done < "$backup_dir/new-files.txt"
  if [[ "$restart_attempted" == 1 ]]; then
    sudo docker compose -f docker-compose.yml -f "$backup_dir/rollback.compose.yml" up -d --no-deps --no-build app
  fi
  printf 'バックアップは %s にあります。DBは復元・削除していません。\n' "$backup_dir" >&2
  exit "$exit_code"
}
trap rollback ERR

while IFS= read -r file; do
  install -D -m 644 "$release_dir/$file" "$app_dir/$file"
done < "$release_dir/FILES.txt"

# Keep the old application running while the new image is built.
sudo docker compose build app
restart_attempted=1
sudo docker compose up -d --no-deps app

ready=0
for attempt in $(seq 1 30); do
  if sudo docker compose exec -T app node -e '
    const root = "http://127.0.0.1:3000" + (process.env.BASE_PATH || "");
    Promise.all([
      fetch(root + "/admin/quiz-evaluation/", { redirect: "manual", signal: AbortSignal.timeout(3000) }),
      fetch(root + "/api/quiz-evaluations/", { signal: AbortSignal.timeout(3000) })
    ]).then(([page, api]) => {
      if (![302, 307].includes(page.status) || api.status !== 401) process.exit(1);
    }).catch(() => process.exit(1));
  ' > /dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "$ready" != 1 ]]; then
  printf '更新後の画面・APIを確認できませんでした。\n' >&2
  false
fi
trap - ERR
sudo docker compose ps app
printf '\n反映完了。ブラウザーを再読み込みしてください。最新のAIメッセージのアイコンとアバターで帽子の有無が揃います。\nバックアップ: %s\n' "$backup_dir"
