#!/usr/bin/env bash
set -Eeuo pipefail
cd "$HOME/aituber-kit"
sudo -v
# Recreate only the app so Docker reloads .env; keep the database running.
sudo docker compose up -d --no-deps --force-recreate --no-build app
python3 - <<'PY' | sudo docker compose exec -T app node -e '
let input="";
process.stdin.on("data", chunk => input+=chunk);
process.stdin.on("end", () => {
  const expected=JSON.parse(input);
  const actual=[process.env.DIFY_KEY,process.env.DIFY_API_KEY,process.env.NEXT_PUBLIC_DIFY_API_KEY].find(v=>v && v.trim());
  if (!actual || actual.trim()!==expected) {
    console.error("Difyキーの読み込みが一致しません。設定を確認してください。");
    process.exit(1);
  }
  console.log("Difyキーの読み込み一致を確認しました（値は表示しません）。");
});'
import pathlib,re,json
text=pathlib.Path('.env').read_text()
match=re.search(r"(?m)^DIFY_API_KEY='(app-[A-Za-z0-9_-]+)'\s*$",text)
if not match: raise ValueError('Dify key entry not found')
print(json.dumps(match.group(1)))
PY
ready=0
for attempt in $(seq 1 20); do
  if sudo docker compose exec -T app node -e '
    fetch("http://127.0.0.1:3000"+(process.env.BASE_PATH||"")+"/api/quiz-evaluations/", {signal:AbortSignal.timeout(3000)})
      .then(r=>{if(r.status!==401)process.exit(1)}).catch(()=>process.exit(1));
  ' > /dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "$ready" != 1 ]]; then
  printf '起動確認ができませんでした。アプリの状態を確認してください。\n' >&2
  exit 1
fi
printf 'Difyキーの反映とアプリの起動確認が完了しました。\n'
