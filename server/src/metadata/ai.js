// ai.js — optional: identify a book from a photo of its cover using Claude.
// Only active when ANTHROPIC_API_KEY is set. Without it, cover scans rely on the
// text the phone reads off the cover (OCR) and a normal title search.

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

export const enabled = () => !!config.anthropicKey;

let client = null;
const getClient = () => (client ??= new Anthropic({ apiKey: config.anthropicKey }));

const SCHEMA = {
  type: 'object',
  properties: {
    is_book: { type: 'boolean', description: 'True if the photo shows a book cover or spine' },
    title: { type: 'string', description: 'Book title exactly as printed, without the series name' },
    subtitle: { type: 'string' },
    authors: { type: 'array', items: { type: 'string' } },
    series: { type: 'string', description: 'Series name if printed, e.g. "Magic Tree House"' },
    series_number: { type: 'string', description: 'Number within the series if printed, e.g. "12"' },
    isbn: { type: 'string', description: 'ISBN only if visibly printed on the cover, otherwise empty' },
    search_query: { type: 'string', description: 'Best short query to find this book in a catalogue' },
  },
  required: ['is_book', 'title', 'subtitle', 'authors', 'series', 'series_number', 'isbn', 'search_query'],
  additionalProperties: false,
};

const PROMPT = `This is a photo of a book cover taken with a phone so it can be added to a home library catalogue.
Read what is printed on the cover and identify the book. Use only what you can see plus well-known
knowledge of the book (for example, the series a numbered children's book belongs to).
Leave a field as an empty string (or empty list) when you can't tell. ocr_text below is what the
phone's text recognizer read from the same photo; it may be incomplete or jumbled.`;

// Checks the key and model without using any tokens (free).
export async function checkKey() {
  const model = await getClient().models.retrieve(config.anthropicModel);
  return model.display_name || model.id;
}

// imageBuffer: JPEG/PNG bytes. Returns the parsed identification or null.
export async function identifyCover(imageBuffer, mediaType = 'image/jpeg', ocrText = '') {
  if (!enabled()) return null;
  const response = await getClient().beta.messages.create({
    model: config.anthropicModel,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') } },
          { type: 'text', text: `${PROMPT}\n\nocr_text:\n${String(ocrText).slice(0, 2000)}` },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') return null;
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) return null;
  try {
    const result = JSON.parse(textBlock.text);
    return result.is_book ? result : null;
  } catch {
    return null;
  }
}
