// Testament Quest — retention-quiz generator for chapters outside the
// hand-authored John bank.
//
// GET /.netlify/functions/quest-quiz?book=1&chapter=1
//   → { questions: [{ q, options[4], a, ref }] }
//
// Unlike ./claude.js (a pass-through proxy), the model, prompt and output
// schema are fixed here, so this endpoint can only generate chapter quizzes.
// The response is cached at the CDN per (book, chapter), so each chapter costs
// one model call no matter how many readers take it.
import Anthropic from '@anthropic-ai/sdk';
import { BOOK_BY_NUM } from '../../quest/js/data/books.js';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['q', 'options', 'a', 'ref'],
        properties: {
          q: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          a: { type: 'integer' },
          ref: { type: 'string' },
        },
      },
    },
  },
};

const SYSTEM = `You write short reading-retention quizzes for a personal Bible-reading app.
Readers use the New World Translation of the Holy Scriptures (2013 revision); use its
wording and its name for God, Jehovah, where the chapter uses it.

Write exactly 3 multiple-choice questions about the single chapter you are given.
- Test recall of what the chapter actually says: people, places, events, key statements.
- Questions must be answerable from that chapter alone. No interpretation, doctrine or opinion.
- Exactly 4 options each, one clearly correct, distractors plausible but wrong.
- "a" is the 0-based index of the correct option; vary its position across questions.
- "ref" is the verse or verse range that answers it, e.g. "Genesis 1:27".
- One sentence per question, under 25 words.`;

const json = (statusCode, body, extra = {}) =>
  ({ statusCode, headers: { ...HEADERS, ...extra }, body: JSON.stringify(body) });

export function validQuiz(data, bookName) {
  const qs = data?.questions;
  if (!Array.isArray(qs) || qs.length !== 3) return false;
  return qs.every(q =>
    typeof q.q === 'string' && q.q.length > 5 &&
    Array.isArray(q.options) && q.options.length === 4 && q.options.every(o => typeof o === 'string' && o) &&
    Number.isInteger(q.a) && q.a >= 0 && q.a < 4 &&
    typeof q.ref === 'string' && q.ref.startsWith(bookName));
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET only' });

  const num = Number(event.queryStringParameters?.book);
  const chapter = Number(event.queryStringParameters?.chapter);
  const book = BOOK_BY_NUM[num];
  if (!book || !Number.isInteger(chapter) || chapter < 1 || chapter > book.chapters) {
    return json(400, { error: 'Unknown book or chapter' });
  }
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: 'Quiz service not configured' });

  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `${book.name} chapter ${chapter}` }],
    });

    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      return json(502, { error: `Quiz generation stopped (${response.stop_reason})` });
    }
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const data = JSON.parse(text);
    if (!validQuiz(data, book.name)) return json(502, { error: 'Generated quiz failed validation' });

    return json(200, { questions: data.questions, source: 'ai' }, {
      'Cache-Control': 'public, max-age=3600',
      'Netlify-CDN-Cache-Control': 'public, durable, max-age=2592000', // 30 days per chapter URL
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json(429, { error: 'Busy — try again shortly' });
    if (err instanceof SyntaxError) return json(502, { error: 'Malformed quiz output' });
    if (err instanceof Anthropic.APIError) return json(502, { error: `Quiz service error (${err.status})` });
    console.error('quest-quiz failed', err);
    return json(500, { error: 'Unexpected error' });
  }
};
