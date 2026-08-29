import { Router } from 'express';
import { z } from 'zod';

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

  // Real model call goes here in Stage 2 — nothing yet
  return res.status(501).json({ error: 'Real model call not implemented yet' });
});

export default router;
