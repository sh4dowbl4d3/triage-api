## Provider portability
Three environment variables (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`) are the only difference between calling a model on my laptop and calling one in a datacenter — nothing else in the code needs to change.

## Observations from Stage 2
Testing on three real inputs (a billing complaint, a feature request, and a nonsense message), the model returned clean, unwrapped JSON matching the expected shape every time — no markdown fences or extra commentary needed stripping. This may vary with other models or under different phrasing.
