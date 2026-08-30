import { Router } from 'express';
import { z } from 'zod';
import { readFileSync, appendFileSync, mkdirSync } from 'fs';
import OpenAI from 'openai';

const router = Router();

const InputSchema = z.object({
  text: z.string().min(1).max(2000)
});

const OutputSchema = z.object({
  category: z.enum(['billing', 'bug', 'feature', 'other']),
  urgency: z.enum(['low', 'normal', 'high']),
  confidence: z.number().min(0).max(1),
  reason: z.string()
});

const systemPrompt = readFileSync(new URL('../../prompts/triage-v1.md', import.meta.url), 'utf-8');
const PROMPT_VERSION = 'triage-v1';

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL,
  apiKey: process.env.LLM_API_KEY,
  timeout: 30000,
  maxRetries: 0,
});

function extractJson(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) return null;

  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function quarantine(input, rawOutput, error) {
  mkdirSync(new URL('../../logs', import.meta.url), { recursive: true });
  const logPath = new URL('../../logs/quarantine.jsonl', import.meta.url);
  const entry = {
    timestamp: new Date().toISOString(),
    input,
    raw_output: rawOutput,
    error,
    prompt_version: PROMPT_VERSION
  };
  appendFileSync(logPath, JSON.stringify(entry) + '\n');
}

function logCost(promptVersion, model, usage, durationMs, neededRepair) {
  mkdirSync(new URL('../../logs', import.meta.url), { recursive: true });
  const logPath = new URL('../../logs/cost.jsonl', import.meta.url);
  const entry = {
    timestamp: new Date().toISOString(),
    prompt_version: promptVersion,
    model,
    input_tokens: usage?.prompt_tokens ?? null,
    output_tokens: usage?.completion_tokens ?? null,
    duration_ms: durationMs,
    needed_repair: neededRepair
  };
  appendFileSync(logPath, JSON.stringify(entry) + '\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callWithRetry(fn, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.status || err.response?.status;
      const isRetryable = status === 429 || status === undefined || (status >= 500 && status < 600);

      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }

      const retryAfterHeader = err.headers?.['retry-after'];
      const waitMs = retryAfterHeader
        ? parseInt(retryAfterHeader) * 1000
        : (2 ** attempt) * 1000 + Math.random() * 300;

      console.log(`RETRY attempt=${attempt + 1} status=${status} waiting_ms=${Math.round(waitMs)}`);
      await sleep(waitMs);
    }
  }
}

async function callModel(userText, repairContext = null) {
  const messages = [{ role: 'system', content: systemPrompt }];

  if (repairContext) {
    messages.push({ role: 'user', content: userText });
    messages.push({ role: 'assistant', content: repairContext.badOutput });
    messages.push({
      role: 'user',
      content: `Your previous answer was rejected for this reason: ${repairContext.error}. Return only corrected JSON matching the schema.`
    });
  } else {
    messages.push({ role: 'user', content: userText });
  }

  const startTime = Date.now();
  const completion = await callWithRetry(() =>
    client.chat.completions.create({
      model: process.env.LLM_MODEL,
      temperature: 0,
      messages
    })
  );
  const durationMs = Date.now() - startTime;

  if (!completion || !completion.choices || !completion.choices[0]) {
    throw new Error('Model provider returned an unexpected response shape');
  }

  return { text: completion.choices[0].message.content, usage: completion.usage, durationMs };
}

router.post('/triage', async (req, res) => {
  try {
    if (process.env.LLM_ENABLED === 'false') {
      return res.status(503).json({ error: 'Triage service is temporarily disabled' });
    }

    const inputResult = InputSchema.safeParse(req.body);

    if (!inputResult.success) {
      const fieldName = inputResult.error.issues[0].path.join('.') || 'text';
      return res.status(400).json({ error: `Invalid or missing field: ${fieldName}` });
    }

    const userText = inputResult.data.text;

    if (process.env.LLM_STUB === '1') {
      return res.status(200).json({
        category: 'other',
        urgency: 'low',
        confidence: 0.3,
        reason: 'Stub mode: no model was called'
      });
    }

    let neededRepair = false;
    let result = await callModel(userText);
    let parsed = extractJson(result.text);
    let validated = parsed ? OutputSchema.safeParse(parsed) : null;

    if (!validated || !validated.success) {
      neededRepair = true;
      const errorMessage = validated
        ? validated.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
        : 'Response was not valid JSON';

      result = await callModel(userText, { badOutput: result.text, error: errorMessage });
      parsed = extractJson(result.text);
      validated = parsed ? OutputSchema.safeParse(parsed) : null;

      if (!validated || !validated.success) {
        const finalError = validated
          ? validated.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
          : 'Response was not valid JSON after repair attempt';

        quarantine(userText, result.text, finalError);
        return res.status(422).json({ error: 'Model output failed validation after repair attempt' });
      }
    }

    logCost(PROMPT_VERSION, process.env.LLM_MODEL, result.usage, result.durationMs, neededRepair);
    return res.status(200).json(validated.data);

  } catch (err) {
    console.log(`UNEXPECTED ERROR: ${err.message}`);
    return res.status(502).json({ error: 'Upstream model provider error, please try again' });
  }
});

export default router;