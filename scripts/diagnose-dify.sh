#!/usr/bin/env bash
set -Eeuo pipefail
cd "$HOME/aituber-kit"
sudo -v
printf '\n--- 稼働中アプリのキー確認 ---\n'
python3 - <<'PY' | sudo docker compose exec -T app node -e '
let input="";process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>{
 const expected=JSON.parse(input);
 const actual=[process.env.DIFY_KEY,process.env.DIFY_API_KEY,process.env.NEXT_PUBLIC_DIFY_API_KEY].find(v=>v&&v.trim());
 console.log(actual&&actual.trim()===expected?"新しいキーと一致しています。":"新しいキーと一致していません。再起動による反映が必要です。");
});'
import pathlib,re,json
m=re.search(r"(?m)^DIFY_API_KEY='(app-[A-Za-z0-9_-]+)'\s*$",pathlib.Path('.env').read_text())
if not m: raise ValueError('Expected key entry not found')
print(json.dumps(m.group(1)))
PY
printf '\n--- 最近のDifyエラー（キーは伏せ字） ---\n'
sudo docker compose logs --no-color --since 45m --tail 1500 app 2>&1 | python3 -c '
import sys,re
lines=sys.stdin.read().splitlines();blocks=[];i=0
while i<len(lines):
    line=lines[i]
    if any(mark in line for mark in ["[difyChat] Dify API error:","[difyChat] Dify fetch error:","[difyChat] Error:","[difyChat] Unexpected error:","[difyChat] Failed to load conversation variables:"]) or ("[difyChat] Extracted response text:" in line and "insufficient_material" in line):
        block=[line];i+=1
        while i<len(lines) and len(block)<9 and "[difyChat]" not in lines[i]:
            block.append(lines[i]);i+=1
        blocks.append("\n".join(block))
    else:i+=1
output="\n\n".join(blocks[-8:]) or "対象のエラーログが見つかりませんでした。"
output=re.sub(r"(?:app-|sk-)[A-Za-z0-9_-]+","[REDACTED]",output)
output=re.sub(r"(?i)Bearer\s+\S+","Bearer [REDACTED]",output)
print(output)
'
