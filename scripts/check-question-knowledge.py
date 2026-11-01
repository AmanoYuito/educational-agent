#!/usr/bin/env python3
"""Read-only checks for the published flow and every registered knowledge base."""
import json
import pathlib
import sys
import importlib.util
spec = importlib.util.spec_from_file_location('material_check', pathlib.Path(__file__).with_name('check-question-material.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.main()
env = module.read_env(pathlib.Path(sys.argv[1]) / '.env')
base = (env.get('DIFY_KNOWLEDGE_URL') or 'https://api.dify.ai/v1').rstrip('/')
sources = json.loads((pathlib.Path(__file__).parent.parent / 'src/config/questionKnowledge.json').read_text())
for source in sources:
    docs = module.get(base + '/datasets/' + source['id'] + '/documents?limit=100', env['DIFY_KNOWLEDGE_API_KEY'])
    if not isinstance(docs.get('data'), list) or not docs['data']:
        raise SystemExit(source['name'] + ': 教材文書がありません。')
    print(source['name'] + ': ナレッジに接続できました。')
