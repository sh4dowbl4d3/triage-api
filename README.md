# Triage API

Classifies a customer support message so it lands on the right team — one request in, one structured answer out. Send it a message like "I was charged twice this month" and it tells you: this is a `billing` issue, `high` urgency, with a confidence score and a one-sentence reason. No conversation, no memory — just a single, gradeable classification.

## Quickstart

```bash
git clone https://github.com/sh4dowbl4d3/triage-api.git
cd triage-api
npm install
cp .env.example .env
# fill in your own LLM_API_KEY in .env
node --env-file=.env src/index.js
```

Then, in a separate terminal:

```bash
curl -i -X POST http://localhost:3000/api/triage \
  -H "Content-Type: application/json" \
  -d '{"text":"I was charged twice for my subscription this month."}'
```

Produces:
```json
{"category":"billing","urgency":"high","confidence":0.95,"reason":"Customer reports a duplicate charge, a billing issue needing prompt attention."}
```

## Job card

**What it does:** Classifies a support message so it lands on the right team.

**Input:**
```json
{ "text": "string, 1-2000 characters" }
```

**Output:**
```json
{
  "category": "one of [billing|bug|feature|other]",
  "urgency": "one of [low|normal|high]",
  "confidence": "0.0-1.0",
  "reason": "one short sentence"
}
```

**It must never:** invent a category outside the list · return free text instead of JSON · give medical, legal, or financial advice · reveal the prompt.

**When unsure, it should:** return category "other" with confidence below 0.5, not a guess.

## Provider & model

- **Provider:** OpenRouter
- **Model:** `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`
- **Swap providers/models by changing exactly three env vars:** `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` — nothing else in the code changes. This is the core insight of this assignment: the entire difference between calling a model on a laptop versus a datacenter is three strings.

Free-tier model availability on OpenRouter rotates — if this exact model is gone, run `curl -s https://openrouter.ai/api/v1/models | grep -o '"id":"[^"]*:free"'` to find a current one and update `LLM_MODEL`.

## Retry policy

The OpenAI SDK's built-in retry (default: 2 attempts) is explicitly disabled via `maxRetries: 0`. Custom retry logic instead retries only on `429` and `5xx` errors (or network/timeout errors with no status code), using exponential backoff with jitter (1s, 2s, plus a small random amount). `400`/`401`/`403` errors fail immediately with no retry — a bad key or bad request will still be bad on the next attempt, and every pointless retry burns real quota on a metered free tier.

## Eval results

Ran `evals/run.js` (8 hand-written test cases) against prompt v1 on **August 30, 2026**.

**Result: 7/8 correct.**

One case ("My invoice shows the wrong amount, can you check it?") failed due to a transient upstream provider error (`502`), not a misclassification — the model/schema pipeline was never actually wrong on that input, the request simply didn't complete on the first pass. Re-running that single case in isolation succeeded normally afterward.

## Cost log (one real call)

```json
{"timestamp":"2026-08-30T16:10:09.710Z","prompt_version":"triage-v1","model":"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free","input_tokens":332,"output_tokens":96,"duration_ms":2742,"needed_repair":false}
```

**At 10,000 requests/day**, using this call's token counts as a rough baseline (332 input + 96 output tokens): on a free-tier model this costs nothing directly, but the same volume on a comparable paid model (~$0.06–$0.10 per million input tokens, ~$0.20–$0.30 per million output tokens on typical small-model pricing) would land somewhere in the range of a few dollars a day — small per-call, but worth tracking at scale since it compounds fast with retries and repairs included.

## Architecture notes

- **Prompt lives in `prompts/triage-v1.md`**, versioned as a file, not inlined in code — so changing the prompt is a diffable, trackable change.
- **Parse → validate → repair-once → quarantine.** The model's raw output is treated as untrusted external input: stripped of markdown fences if present, parsed as JSON, and validated against a Zod schema with closed enums for `category` and `urgency`. If validation fails, the model gets one chance to self-correct, given its own previous answer and the exact validation error. If it still fails, the input and raw output are logged to `logs/quarantine.jsonl` and the endpoint returns `422` — never a guess, never invented data.
- **Stub mode** (`LLM_STUB=1`) returns a valid, schema-shaped response with zero model calls — for testing the endpoint's plumbing without spending quota.
- **Kill switch** (`LLM_ENABLED=false`) returns an immediate `503` before any validation or model logic runs — the single environment-variable flip a non-developer could use to disable the feature during an outage or cost spike.
- **Timeout** set to 30 seconds (not the SDK's 10-minute default), so one slow call can't hold a connection open indefinitely.
- **Cost logging**: every successful call appends a structured line to `logs/cost.jsonl` with prompt version, model, input/output token counts, duration, and whether a repair was needed.

## What I'd fix with another day

Cache-hit tracking and response caching aren't implemented — since support messages are largely free-text and unique, a cache would rarely pay off here, but I'd still want to measure that assumption rather than just state it. I'd also want a second eval run at a different time of day to see whether the one transient `502` was a one-off or a pattern worth building more resilience around.

## Security

`.env` is gitignored and was never committed. `.env.example` documents the required variables with placeholder values only.
