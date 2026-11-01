"""Dify code node: reject missing/fabricated evidence before releasing a quiz."""
import json
import re
import unicodedata


def normalized(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value)).casefold()


def parse_object(raw):
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("JSONオブジェクトではありません。")
    return value


def main(question_json: str, correct_json: str, formatted_json: str, sources_json: str) -> dict:
    try:
        sources = {s["id"]: s["text"] for s in json.loads(sources_json)}
        question = parse_object(question_json)
        correct = parse_object(correct_json)
        quiz = parse_object(formatted_json)

        def evidence(value):
            if not isinstance(value, dict):
                raise ValueError("根拠がありません。")
            source = sources.get(value.get("source_id"))
            quote = value.get("quote")
            if not source or not isinstance(quote, str) or len(normalized(quote)) < 8:
                raise ValueError("根拠引用が不足しています。")
            if normalized(quote) not in normalized(source):
                raise ValueError("根拠引用が教材にありません。")
            return quote

        evidence(question.get("evidence"))
        correct_quote = evidence(correct.get("evidence"))
        public = quiz.get("public")
        if quiz.get("type") != "quiz" or not isinstance(public, dict):
            raise ValueError("問題形式ではありません。")
        text = public.get("question")
        choices = public.get("choices")
        index = quiz.get("answerIndex")
        if not isinstance(text, str) or not text.strip() or text != question.get("question"):
            raise ValueError("根拠確認後に問題文が変わっています。")
        if not isinstance(choices, list) or len(choices) != 4 or any(not isinstance(c, str) or not c.strip() for c in choices):
            raise ValueError("選択肢は空欄のない4件が必要です。")
        if len({normalized(c) for c in choices}) != 4:
            raise ValueError("選択肢が重複しています。")
        if type(index) is not int or not 0 <= index < 4:
            raise ValueError("正解番号が不正です。")
        answer = choices[index]
        if quiz.get("answer") != answer or correct.get("correct_choice") != answer:
            raise ValueError("正解が整合していません。")
        # Conservative: correct answers must be short phrases directly in the lesson.
        if normalized(answer) not in normalized(correct_quote):
            raise ValueError("正解の語句が教材の根拠引用にありません。")
        grounding = quiz.get("grounding")
        if not isinstance(grounding, dict) or grounding.get("supported") is not True:
            raise ValueError("教材だけでは正誤を判定できません。")
        evidence(grounding.get("question"))
        refs = grounding.get("choices")
        if not isinstance(refs, list) or len(refs) != 4:
            raise ValueError("各選択肢の根拠が不足しています。")
        for i, ref in enumerate(refs):
            quote = evidence(ref)
            if ref.get("choice") != choices[i] or not isinstance(ref.get("reason"), str) or not ref["reason"].strip():
                raise ValueError("選択肢と根拠の対応が不正です。")
            if i == index and normalized(answer) not in normalized(quote):
                raise ValueError("正解の根拠が一致しません。")
        explanation = quiz.get("explanation")
        if not isinstance(explanation, str) or not explanation.strip():
            raise ValueError("解説がありません。")
        # Also reject new alphabetic technical terms (e.g. DNS/MX/CNAME) absent
        # from this run's lesson excerpts, even if a model supplies a real but irrelevant quote.
        source_text = normalized("\n".join(sources.values()))
        for token in re.findall(r"[A-Za-z][A-Za-z0-9_-]+", "\n".join([text, *choices, explanation])):
            if normalized(token) not in source_text:
                raise ValueError("教材にない用語が含まれています: " + token)
        # Keep evidence in node logs; the existing app receives its usual quiz schema.
        result = {"type": "quiz", "public": public, "answerIndex": index,
                  "answer": answer, "explanation": explanation}
        return {"result": json.dumps(result, ensure_ascii=False)}
    except (ValueError, TypeError, KeyError, AttributeError) as exc:
        raise ValueError("教材の根拠確認に失敗したため出題を停止しました: " + str(exc)) from None
