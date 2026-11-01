"""Dify code node: restrict retrieved chunks to the intended lesson."""
import json
import unicodedata

ALLOWED_DOCUMENTS = {"johokiso3-1-2.html"}


def document_name(value):
    return unicodedata.normalize("NFKC", str(value or "")).strip().replace("\\", "/").rsplit("/", 1)[-1]


def main(retrieval: list) -> dict:
    sources = []
    for item in retrieval or []:
        if not isinstance(item, dict):
            continue
        metadata = item.get("metadata") or {}
        # Prefer the document name supplied by the retrieval service, never the content.
        name = document_name(metadata.get("document_name") or item.get("title"))
        content = item.get("content")
        if name not in ALLOWED_DOCUMENTS or not isinstance(content, str) or not content.strip():
            continue
        content = content.strip()
        if any(s["text"] == content for s in sources):
            continue
        sources.append({"id": "S" + str(len(sources) + 1), "document": name, "text": content})
    if not sources:
        raise ValueError("教材の検索結果がありません。johokiso3-1-2.html の登録名・検索結果を確認してください。教材外の知識による出題は停止しました。")
    context = "\n\n".join("[" + s["id"] + "] " + s["document"] + "\n" + s["text"] for s in sources)
    if len(context) > 60000:
        raise ValueError("教材検索結果が長すぎます。チャンクサイズを調整してください。")
    return {"context": context, "sources_json": json.dumps(sources, ensure_ascii=False)}
