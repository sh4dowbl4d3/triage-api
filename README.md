## Provider portability
Three environment variables (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`) are the only difference between calling a model on my laptop and calling one in a datacenter — nothing else in the code needs to change.

## Observations from Stage 2
Testing on three real inputs (a billing complaint, a feature request, and a nonsense message), the model returned clean, unwrapped JSON matching the expected shape every time — no markdown fences or extra commentary needed stripping. This may vary with other models or under different phrasing.

## Stage 3 failure test
Temporarily added a fake fifth category ("urgent-escalation") to the prompt without updating the schema. The model did return the invalid category on the first attempt, which failed Zod validation as expected. On the repair attempt — where the model was told exactly why its answer was rejected — it self-corrected and returned a valid category from the original four. This confirms the retry-once-then-quarantine logic works, though in this case a genuine quarantine never triggered since the model corrected itself.
