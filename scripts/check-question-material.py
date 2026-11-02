#!/usr/bin/env python3
"""Read-only deployment preflight. Never prints API keys or response bodies."""
import json
import pathlib
import sys
import subprocess
import uuid


def read_env(path):
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line.startswith('export '):
            line = line[7:]
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        value = value.strip()
        if len(value) > 1 and value[0] == value[-1] and value[0] in '\"\'':
            value = value[1:-1]
        else:
            value = value.split(' #', 1)[0].strip()
        values[key.strip()] = value
    return values


def get(url, key):
    config = 'header = ' + json.dumps('Authorization: Bearer ' + key) + '\n'
    result = subprocess.run(
        ['curl', '--config', '-', '--silent', '--show-error', '--max-time', '20',
         '--write-out', '\n%{http_code}', url],
        input=config, capture_output=True, text=True,
    )
    body, _, status = result.stdout.rpartition('\n')
    if result.returncode or status != '200':
        raise SystemExit('APIの事前確認に失敗しました（HTTP %s）。キー・公開状態・対象IDを確認してください。' % status)
    try:
        return json.loads(body)
    except ValueError:
        raise SystemExit('APIの事前確認に失敗しました。応答を読み取れません。')


def validate_pool_parameters(parameters):
    fields = {}
    for form in parameters.get('user_input_form', []):
        for value in form.values():
            if isinstance(value, dict) and value.get('variable'):
                fields[value['variable']] = value
    expected = {'source_context', 'question_type', 'bloom_level', 'difficulty_level', 'understand_skill'}
    if not expected.issubset(fields) or any(v.get('required') for k, v in fields.items() if k not in expected):
        raise SystemExit('最新の教材ランダム出題YAMLを取り込んで公開してください。教材・問題形式・認知レベル・難易度・記述の問い方の入力設定が必要です。')
    if set(fields['question_type'].get('options', [])) != {'multiple_choice', 'written'} or set(fields['bloom_level'].get('options', [])) != {'remember', 'understand'}:
        raise SystemExit('問題形式と認知レベルの選択肢が一致しません。4択・記述対応の教材ランダム出題YAMLを公開してください。')
    if set(fields['difficulty_level'].get('options', [])) != set('123456') or set(fields['understand_skill'].get('options', [])) != {'interpret', 'exemplify', 'classify', 'summarize', 'infer', 'compare', 'explain'}:
        raise SystemExit('難易度または記述の問い方の選択肢が一致しません。最新の教材ランダム出題YAMLを公開してください。')

    if fields['bloom_level'].get('required') or fields['bloom_level'].get('default'):
        raise SystemExit('認知レベルは記述専用の任意入力（既定値なし）にしてください。最新の教材ランダム出題YAMLを公開してください。')


def main():
    env = read_env(pathlib.Path(sys.argv[1]) / '.env')
    for name in ['DIFY_KNOWLEDGE_API_KEY', 'DIFY_KNOWLEDGE_DATASET_ID', 'DIFY_QUESTION_POOL_API_KEY']:
        if not env.get(name):
            raise SystemExit(name + ' が未設定です。稼働中のコードは変更していません。')
    try:
        uuid.UUID(env['DIFY_KNOWLEDGE_DATASET_ID'])
    except ValueError:
        raise SystemExit('ナレッジIDはUUIDで設定してください。')
    pool = env.get('DIFY_QUESTION_POOL_URL') or 'https://api.dify.ai/v1'
    pool = pool.rstrip('/').removesuffix('/chat-messages')
    parameters = get(pool + '/parameters', env['DIFY_QUESTION_POOL_API_KEY'])
    validate_pool_parameters(parameters)
    base = (env.get('DIFY_KNOWLEDGE_URL') or 'https://api.dify.ai/v1').rstrip('/')
    docs = get(base + '/datasets/' + env['DIFY_KNOWLEDGE_DATASET_ID'] + '/documents?limit=1', env['DIFY_KNOWLEDGE_API_KEY'])
    if not isinstance(docs.get('data'), list) or not docs['data']:
        raise SystemExit('対象ナレッジに文書がありません。')
    print('公開済みフローの教材・形式・認知レベル入力と、ナレッジAPIへの接続を確認しました。')


if __name__ == '__main__':
    main()
