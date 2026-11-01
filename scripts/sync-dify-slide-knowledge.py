"""Sync per-slide Markdown or one bundled text file to a Dify knowledge base.

Example:
    python3 scripts/sync-dify-slide-knowledge.py --lesson 4 --dataset-id UUID --bundle
    python3 scripts/sync-dify-slide-knowledge.py --lesson 4 --dataset-id UUID --bundle --apply --replace

The operation is resumable: documents already present by filename are skipped.
The API key is read from DIFY_KNOWLEDGE_API_KEY or the local .env.local file.
"""

import argparse
import json
import os
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import UUID, uuid4


ROOT = Path(__file__).resolve().parents[1]
API_ROOT = "https://api.dify.ai/v1"
UPLOAD_INTERVAL_SECONDS = 12
PROCESS_RULE = {
    "mode": "custom",
    "rules": {
        "pre_processing_rules": [
            {"id": "remove_extra_spaces", "enabled": True},
            {"id": "remove_urls_emails", "enabled": False},
        ],
        "segmentation": {"separator": "***", "max_tokens": 1024, "chunk_overlap": 50},
    },
}


def api_key() -> str:
    key = os.environ.get("DIFY_KNOWLEDGE_API_KEY", "").strip()
    if not key:
        local_env = ROOT / ".env.local"
        if local_env.exists():
            for line in local_env.read_text(encoding="utf-8").splitlines():
                if line.startswith("DIFY_KNOWLEDGE_API_KEY="):
                    key = line.split("=", 1)[1].strip().strip("\"'")
                    break
    if not key:
        raise RuntimeError("DIFY_KNOWLEDGE_API_KEY is missing")
    return key


def request(path: str, key: str, body: bytes | None = None, content_type: str = "") -> dict:
    headers = {"Authorization": f"Bearer {key}"}
    if content_type:
        headers["Content-Type"] = content_type
    for attempt in range(5):
        try:
            req = Request(API_ROOT + path, data=body, headers=headers, method="POST" if body else "GET")
            with urlopen(req, timeout=40) as response:
                return json.load(response)
        except HTTPError as error:
            detail = error.read(500).decode("utf-8", errors="replace")
            if error.code == 403 and "knowledge base request rate limit" in detail and attempt < 4:
                print("Dify rate limit reached; waiting 65 seconds", flush=True)
                time.sleep(65)
                continue
            if error.code not in (429, 500, 502, 503, 504) or attempt == 4:
                raise RuntimeError(f"Dify HTTP {error.code}: {detail}") from error
        except (TimeoutError, ConnectionError) as error:
            if attempt == 4:
                raise RuntimeError(f"Dify request failed: {error}") from error
        time.sleep(2**attempt)
    raise RuntimeError("Dify request failed")


def existing_documents(dataset_id: str, key: str) -> dict[str, dict]:
    documents: dict[str, dict] = {}
    page = 1
    while True:
        result = request(f"/datasets/{dataset_id}/documents?page={page}&limit=100", key)
        for document in result["data"]:
            name = document["name"]
            if name in documents:
                raise RuntimeError(f"Duplicate document name in Dify: {name}")
            documents[name] = document
        if not result["has_more"]:
            return documents
        page += 1


def upload(path: Path, dataset_id: str, key: str, document_id: str | None = None) -> dict:
    settings = json.dumps(
        {
            "indexing_technique": "high_quality",
            "doc_form": "text_model",
            "doc_language": "Japanese",
            "process_rule": PROCESS_RULE,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    boundary = "slide" + uuid4().hex
    parts: list[bytes] = []
    for name, filename, mime_type, content in (
        ("data", None, "application/json", settings),
        ("file", path.name, "text/markdown", path.read_bytes()),
    ):
        header = f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"'
        if filename:
            header += f'; filename="{filename}"'
        header += f"\r\nContent-Type: {mime_type}\r\n\r\n"
        parts.extend((header.encode("utf-8"), content, b"\r\n"))
    body = b"".join(parts) + f"--{boundary}--\r\n".encode("ascii")
    endpoint = (
        f"/datasets/{dataset_id}/documents/{document_id}/update-by-file"
        if document_id
        else f"/datasets/{dataset_id}/document/create-by-file"
    )
    return request(
        endpoint,
        key,
        body,
        f"multipart/form-data; boundary={boundary}",
    )


def verify(files: list[Path], dataset_id: str, key: str) -> None:
    deadline = time.monotonic() + 180
    while True:
        documents = existing_documents(dataset_id, key)
        pending = [p.name for p in files if documents.get(p.name, {}).get("indexing_status") != "completed"]
        failed = [name for name in pending if documents.get(name, {}).get("indexing_status") == "error"]
        if failed:
            raise RuntimeError(f"Indexing failed: {failed}")
        if not pending:
            break
        if time.monotonic() > deadline:
            raise RuntimeError(f"Indexing timed out: {pending}")
        print(f"Waiting for indexing: {len(pending)} documents", flush=True)
        time.sleep(4)
    for path in files:
        document = documents[path.name]
        result = request(
            f"/datasets/{dataset_id}/documents/{document['id']}/segments?page=1&limit=100",
            key,
        )
        segments = result["data"]
        number = int(re.search(r"-slide-(\d+)\.md$", path.name).group(1))
        if (
            result.get("has_more")
            or len(segments) != 1
            or segments[0].get("status") != "completed"
            or f"スライド{number}" not in segments[0].get("content", "")
            or "本文:" not in segments[0].get("content", "")
        ):
            raise RuntimeError(f"Chunk verification failed: {path.name}")
    print(f"Verified {len(files)} documents, one numbered chunk each", flush=True)


def verify_bundle(lesson: int, dataset_id: str, key: str, document_id: str) -> None:
    expected = list(range(3, 39 if lesson == 3 else 38))
    deadline = time.monotonic() + 180
    while True:
        documents = existing_documents(dataset_id, key)
        document = next((d for d in documents.values() if d["id"] == document_id), None)
        if document is None:
            raise RuntimeError("Bundle document is missing")
        if document["indexing_status"] == "completed":
            break
        if document["indexing_status"] == "error":
            raise RuntimeError(f"Bundle indexing failed: {document.get('error')}")
        if time.monotonic() > deadline:
            raise RuntimeError("Bundle indexing timed out")
        time.sleep(4)
    result = request(
        f"/datasets/{dataset_id}/documents/{document_id}/segments?page=1&limit=100", key
    )
    actual = []
    for segment in result["data"]:
        content = segment.get("content", "")
        ids = re.findall(rf"スライドID:\s*cs2-lesson-{lesson:02d}-slide-(\d+)", content)
        if segment.get("status") != "completed" or len(ids) != 1 or "本文:" not in content:
            raise RuntimeError(f"Invalid bundle chunk: {segment.get('id')}")
        actual.append(int(ids[0]))
    if result.get("has_more") or sorted(actual) != expected:
        raise RuntimeError(f"Bundle chunk mismatch: {actual}")
    print(f"Verified lecture {lesson} bundle: {len(actual)} numbered chunks", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lesson", type=int, choices=(3, 4), required=True)
    parser.add_argument("--dataset-id", required=True)
    parser.add_argument("--apply", action="store_true", help="Upload missing files")
    parser.add_argument("--bundle", action="store_true", help="Use one text file for the entire lecture")
    parser.add_argument("--replace", action="store_true", help="Reindex an existing bundle document")
    parser.add_argument("--limit", type=int, help="Process only the first N files")
    args = parser.parse_args()
    dataset_id = str(UUID(args.dataset_id))
    if args.replace and (not args.bundle or not args.apply):
        parser.error("--replace requires --bundle --apply")
    key = api_key()
    if args.bundle:
        path = ROOT / "knowledge/dify-slide-knowledge/bundles" / f"cs2-lesson-{args.lesson:02d}-slides.txt"
        if not path.exists():
            raise RuntimeError(f"Missing bundle: {path}")
        documents = existing_documents(dataset_id, key)
        document = documents.get(path.name)
        if document is None:
            if not args.apply:
                print(f"Bundle missing in Dify: {path.name}")
                return
            response = upload(path, dataset_id, key)
            document_id = response["document"]["id"]
        else:
            document_id = document["id"]
            if args.replace:
                upload(path, dataset_id, key, document_id)
        verify_bundle(args.lesson, dataset_id, key, document_id)
        return
    files = sorted((ROOT / "knowledge/dify-slide-knowledge" / f"lesson-{args.lesson:02d}").glob("*.md"))
    if args.limit:
        files = files[: args.limit]
    if len(files) < 1:
        raise RuntimeError("No slide files found")
    for path in files:
        content = path.read_text(encoding="utf-8")
        if "本文:" not in content or len(content) > 1024:
            raise RuntimeError(f"Invalid source document: {path.name}")
    documents = existing_documents(dataset_id, key)
    missing = [path for path in files if path.name not in documents]
    print(f"Lesson {args.lesson}: {len(files)} files, {len(missing)} missing", flush=True)
    if not args.apply:
        return
    for index, path in enumerate(missing, 1):
        result = upload(path, dataset_id, key)
        print(f"Uploaded {index}/{len(missing)}: {path.name} ({result['document']['id']})", flush=True)
        if index < len(missing):
            time.sleep(UPLOAD_INTERVAL_SECONDS)
    verify(files, dataset_id, key)


if __name__ == "__main__":
    main()
