import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

let _client = null;

function getClient() {
  if (_client) return _client;
  _client = new Anthropic();
  return _client;
}

/**
 * Analyze with Claude, return raw text.
 */
export async function analyze(prompt, opts = {}) {
  const client = getClient();
  const res = await client.messages.create({
    model: opts.model || 'claude-sonnet-4-20250514',
    max_tokens: opts.maxTokens || 4096,
    messages: [{ role: 'user', content: prompt }],
  });
  return res.content[0].text;
}

/**
 * Analyze with Claude, return parsed JSON.
 */
export async function analyzeJson(prompt, opts = {}) {
  const client = getClient();
  const res = await client.messages.create({
    model: opts.model || 'claude-sonnet-4-20250514',
    max_tokens: opts.maxTokens || 4096,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = res.content[0].text;
  // Extract JSON from response (handles markdown code blocks)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  try {
    return JSON.parse(jsonMatch[1].trim());
  } catch {
    // Try parsing the whole response
    const bracketMatch = text.match(/[\[{][\s\S]*[\]}]/);
    if (bracketMatch) return JSON.parse(bracketMatch[0]);
    throw new Error(`Failed to parse JSON from Claude response: ${text.slice(0, 200)}`);
  }
}

/**
 * Analyze an image with Claude Vision.
 */
export async function analyzeImage(imagePath, prompt, opts = {}) {
  const client = getClient();
  const imageData = readFileSync(imagePath);
  const base64 = imageData.toString('base64');
  const mediaType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

  const res = await client.messages.create({
    model: opts.model || 'claude-sonnet-4-20250514',
    max_tokens: opts.maxTokens || 2048,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: prompt },
      ],
    }],
  });
  const text = res.content[0].text;

  // Try to parse as JSON if the prompt asks for JSON
  if (prompt.toLowerCase().includes('json')) {
    try {
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
      return JSON.parse(jsonMatch[1].trim());
    } catch {
      const bracketMatch = text.match(/[\[{][\s\S]*[\]}]/);
      if (bracketMatch) return JSON.parse(bracketMatch[0]);
    }
  }
  return text;
}
