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
});

function extractJson(text) {
  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;

  // Find the first { to the last } as a fallback, in case of stray text around it
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

  const completion = await client.chat.completions.create({
    model: process.env.LLM_MODEL,
    temperature: 0,
    messages
  });

  return completion.choices[0].message.content;
}

router.post('/triage', async (req, res) => {
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

  let rawText = await callModel(userText);
  let parsed = extractJson(rawText);
  let validated = parsed ? OutputSchema.safeParse(parsed) : null;

  if (!validated || !validated.success) {
    const errorMessage = validated
      ? validated.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
      : 'Response was not valid JSON';

    rawText = await callModel(userText, { badOutput: rawText, error: errorMessage });
    parsed = extractJson(rawText);
    validated = parsed ? OutputSchema.safeParse(parsed) : null;

    if (!validated || !validated.success) {
      const finalError = validated
        ? validated.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
        : 'Response was not valid JSON after repair attempt';

      quarantine(userText, rawText, finalError);
      return res.status(422).json({ error: 'Model output failed validation after repair attempt' });
    }
  }

  return res.status(200).json(validated.data);
});

export default router;