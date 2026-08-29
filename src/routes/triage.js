import { Router } from 'express';
import { z } from 'zod';
import { readFileSync } from 'fs';
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

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL,
  apiKey: process.env.LLM_API_KEY,
});

router.post('/triage', async (req, res) => {
  const inputResult = InputSchema.safeParse(req.body);

  if (!inputResult.success) {
    const fieldName = inputResult.error.issues[0].path.join('.') || 'text';
    return res.status(400).json({ error: `Invalid or missing field: ${fieldName}` });
  }

  if (process.env.LLM_STUB === '1') {
    return res.status(200).json({
      category: 'other',
      urgency: 'low',
      confidence: 0.3,
      reason: 'Stub mode: no model was called'
    });
  }

  const completion = await client.chat.completions.create({
    model: process.env.LLM_MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: inputResult.data.text }
    ]
  });

  const rawText = completion.choices[0].message.content;

  // Stage 3 will parse and validate this properly — for now just return the raw text
  return res.status(200).json({ raw: rawText });
});

export default router;