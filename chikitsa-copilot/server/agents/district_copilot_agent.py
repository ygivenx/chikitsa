#!/usr/bin/env python3
"""Plain-Python ReAct agent for district copilot answers.

Input: JSON on stdin with {"question": str, "evidence": object}
Output: JSON on stdout with {"answer": str, "used_tools": [...], "trace": [...]}

The TypeScript server owns deterministic SQL retrieval. This agent only reasons over
that evidence and may use a lightweight public web search for verification context.
"""

from __future__ import annotations

import html
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
import urllib.error
from typing import Any


MAX_STEPS = 4
MAX_EVIDENCE_CHARS = 28000
MAX_TOOL_CHARS = 2200


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("No JSON payload provided.")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("Payload must be an object.")
    return payload


def compact_json(value: Any, limit: int = MAX_EVIDENCE_CHARS) -> str:
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(text) <= limit:
        return text
    return text[:limit] + f"...[truncated {len(text) - limit} chars]"


def databricks_host() -> str:
    host = os.environ.get("DATABRICKS_HOST", "").strip()
    if not host:
        profile = os.environ.get("DATABRICKS_CONFIG_PROFILE", "").strip()
        cmd = ["databricks", "auth", "env", "-o", "json"]
        if profile:
            cmd.extend(["--profile", profile])
        completed = subprocess.run(cmd, check=True, text=True, capture_output=True, timeout=15)
        parsed = json.loads(completed.stdout)
        env = parsed.get("env") if isinstance(parsed, dict) else None
        if isinstance(env, dict):
            host = str(env.get("DATABRICKS_HOST", "")).strip()
    if not host:
        raise RuntimeError("DATABRICKS_HOST is required for the Python district agent.")
    return host.rstrip("/")


def databricks_token() -> str:
    for key in ("DATABRICKS_TOKEN", "DATABRICKS_AAD_TOKEN"):
        token = os.environ.get(key, "").strip()
        if token:
            return token

    profile = os.environ.get("DATABRICKS_CONFIG_PROFILE", "").strip()
    cmd = ["databricks", "auth", "token", "-o", "json"]
    if profile:
        cmd.extend(["--profile", profile])
    completed = subprocess.run(cmd, check=True, text=True, capture_output=True, timeout=15)
    parsed = json.loads(completed.stdout)
    token = parsed.get("access_token") or parsed.get("token_value") or parsed.get("token")
    if not token:
        raise RuntimeError("Databricks CLI did not return an access token.")
    return str(token)


def model_endpoint_name() -> str:
    return (
        os.environ.get("DATABRICKS_AGENT_MODEL_ENDPOINT")
        or os.environ.get("DATABRICKS_SERVING_ENDPOINT_NAME")
        or "chatgpt"
    ).strip()


def call_model(messages: list[dict[str, str]], *, max_tokens: int = 850) -> str:
    endpoint = model_endpoint_name()
    url = f"{databricks_host()}/serving-endpoints/{urllib.parse.quote(endpoint)}/invocations"
    body = {
        "messages": messages,
        "max_tokens": max_tokens,
        "reasoning_effort": "low",
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {databricks_token()}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Serving endpoint rejected request: HTTP {exc.code} {body[:1000]}") from exc

    if isinstance(payload, dict):
        choices = payload.get("choices")
        if isinstance(choices, list) and choices:
            message = choices[0].get("message") if isinstance(choices[0], dict) else None
            if isinstance(message, dict) and isinstance(message.get("content"), str):
                return message["content"]
            if isinstance(choices[0].get("text"), str):
                return choices[0]["text"]
        if isinstance(payload.get("content"), str):
            return payload["content"]
        if isinstance(payload.get("response"), str):
            return payload["response"]

    return json.dumps(payload, ensure_ascii=False)


def walk_evidence(value: Any, prefix: str = "") -> list[tuple[str, Any]]:
    rows: list[tuple[str, Any]] = []
    if isinstance(value, dict):
        for key, child in value.items():
            next_prefix = f"{prefix}.{key}" if prefix else str(key)
            rows.extend(walk_evidence(child, next_prefix))
    elif isinstance(value, list):
        for index, child in enumerate(value[:80]):
            rows.extend(walk_evidence(child, f"{prefix}[{index}]"))
    else:
        rows.append((prefix, value))
    return rows


def evidence_lookup(evidence: Any, query: str) -> str:
    terms = [term for term in re.split(r"[^a-z0-9]+", query.lower()) if len(term) >= 3]
    rows = []
    for path, value in walk_evidence(evidence):
        line = f"{path}: {value}"
        lower = line.lower()
        if not terms or any(term in lower for term in terms):
            rows.append(line)
        if len(rows) >= 30:
            break
    if not rows:
        return "No matching evidence fields found."
    text = "\n".join(rows)
    return text[:MAX_TOOL_CHARS]


def web_search(query: str) -> str:
    """Small no-dependency web search using DuckDuckGo Instant Answer.

    This is best-effort. The final answer must still prefer Lakebase evidence.
    """

    params = urllib.parse.urlencode(
        {
            "q": query,
            "format": "json",
            "no_html": "1",
            "skip_disambig": "1",
        }
    )
    url = f"https://api.duckduckgo.com/?{params}"
    request = urllib.request.Request(url, headers={"User-Agent": "chikitsa-copilot/0.1"})
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - plain-python tool should degrade gracefully.
        return f"Web search unavailable: {exc}"

    snippets: list[str] = []
    for field in ("Heading", "AbstractText", "AbstractURL"):
        value = payload.get(field)
        if isinstance(value, str) and value.strip():
            snippets.append(value.strip())

    related = payload.get("RelatedTopics")
    if isinstance(related, list):
        for item in related[:5]:
            if isinstance(item, dict):
                text = item.get("Text")
                first_url = item.get("FirstURL")
                if isinstance(text, str) and text.strip():
                    snippets.append(text.strip())
                if isinstance(first_url, str) and first_url.strip():
                    snippets.append(first_url.strip())

    if not snippets:
        return "No concise web result returned."
    return html.unescape("\n".join(snippets))[:MAX_TOOL_CHARS]


def parse_json_object(text: str) -> dict[str, Any]:
    text = text.strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        parsed = json.loads(match.group(0))
        if isinstance(parsed, dict):
            return parsed
    raise ValueError(f"Model did not return a JSON object: {text[:300]}")


def final_answer_prompt(question: str, evidence: Any, observations: list[dict[str, str]]) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "You are an evidence-aware public-health planning copilot for India. "
                "Use only supplied Lakebase evidence plus explicit tool observations. "
                "Treat facility counts as discovered snapshot records, not a full registry. "
                "Do not claim public trust in hospitals or doctors. Do not provide clinical advice. "
                "Keep answers compact. Use markdown. No tables unless explicitly requested."
            ),
        },
        {
            "role": "user",
            "content": "\n\n".join(
                [
                    f"Question: {question}",
                    f"Evidence JSON: {compact_json(evidence)}",
                    f"Tool observations: {compact_json(observations, 8000)}",
                    "For planning questions, return exactly: **Action:**, **Why:**, **Evidence:** max 3 bullets, **Caveat:** max 1 bullet, **Next step:**.",
                    "For facility-list questions, return: **Public facilities found:** bullets, **Caveat:**, **Next step:**.",
                ]
            ),
        },
    ]


def run_agent(question: str, evidence: Any) -> dict[str, Any]:
    tool_observations: list[dict[str, str]] = []
    trace: list[dict[str, Any]] = []
    used_tools: list[str] = []

    system = (
        "You are a simple ReAct planning agent. Decide whether to inspect evidence, use web_search, or finish. "
        "Return one JSON object only with keys: tool, tool_input, reason. "
        "Allowed tools: evidence_lookup, web_search, finish. "
        "Use web_search only for public verification context or official-listing checks. "
        "Prefer evidence_lookup for questions about facilities, services, scores, and district attributes. "
        "Do not put the final answer in reason."
    )
    messages = [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": "\n\n".join(
                [
                    f"Question: {question}",
                    f"Evidence JSON: {compact_json(evidence, 12000)}",
                    "Choose the next tool call.",
                ]
            ),
        },
    ]

    for step in range(MAX_STEPS):
        raw = call_model(messages, max_tokens=260)
        action = parse_json_object(raw)
        tool = str(action.get("tool", "")).strip()
        tool_input = str(action.get("tool_input", "")).strip()
        reason = str(action.get("reason", "")).strip()
        trace.append({"step": step + 1, "tool": tool, "tool_input": tool_input, "reason": reason})

        if tool == "finish":
            break
        if tool == "evidence_lookup":
            observation = evidence_lookup(evidence, tool_input or question)
        elif tool == "web_search":
            observation = web_search(tool_input or question)
        else:
            observation = f"Unknown tool '{tool}'. Use evidence_lookup, web_search, or finish."

        used_tools.append(tool)
        tool_observations.append({"tool": tool, "input": tool_input, "observation": observation})
        messages.append({"role": "assistant", "content": json.dumps(action, ensure_ascii=False)})
        messages.append({"role": "user", "content": f"Observation:\n{observation}\n\nChoose the next tool call."})

    answer = call_model(final_answer_prompt(question, evidence, tool_observations), max_tokens=850)
    return {
        "answer": answer,
        "model": model_endpoint_name(),
        "mode": "python-react-agent",
        "used_tools": sorted(set(used_tools)),
        "trace": trace,
    }


def main() -> None:
    payload = read_payload()
    question = str(payload.get("question", "")).strip()
    evidence = payload.get("evidence", {})
    if len(question) < 8:
        raise ValueError("Question must be at least 8 characters.")
    print(json.dumps(run_agent(question, evidence), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 - return structured failure to Node stderr.
        print(f"district_copilot_agent failed: {exc}", file=sys.stderr)
        sys.exit(1)
