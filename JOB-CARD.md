# Job card

**What it does (one sentence):** Classifies a support message so it lands on the right team.

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
