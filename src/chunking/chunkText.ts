import { getEncoding } from "js-tiktoken";

export interface Chunk {
  index: number;
  text: string;
  /** Heading active when this chunk's content appeared in the source document, if any was detected. */
  section?: string;
  tokenCount: number;
}

export interface ChunkOptions {
  maxTokens: number;
  overlapTokens: number;
}

export interface Tokenizer {
  encode(text: string): number[];
  decode(tokens: number[]): string;
}

/**
 * cl100k_base is the encoding used by OpenAI's text-embedding-3-small (M7's
 * reference EmbeddingProvider) — chunk sizes measured here are the sizes
 * that provider will actually see.
 */
export function createTiktokenTokenizer(): Tokenizer {
  const encoding = getEncoding("cl100k_base");
  return {
    encode: (text) => encoding.encode(text),
    decode: (tokens) => encoding.decode(tokens),
  };
}

interface Segment {
  section: string | undefined;
  text: string;
}

const HEADING_MAX_LENGTH = 80;
const TRAILING_PUNCTUATION = /[.!?,;:]$/;
const MARKDOWN_HEADING = /^#{1,6}\s+/;

function looksLikeHeadingCasing(line: string): boolean {
  if (/[a-z]/.test(line) === false && /[A-Z]/.test(line)) return true; // ALL CAPS
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const capitalized = words.filter((w) => /^[A-Z]/.test(w)).length;
  return capitalized / words.length >= 0.7; // Title Case
}

// Plain-text export (see M5) loses real heading styling, so this is a
// best-effort heuristic, not a structural analysis. A false negative here
// just means a section boundary goes untracked (degraded, not wrong); a
// false positive would silently drop body content into a heading that's
// never chunked — so this deliberately favors precision over recall: short,
// unpunctuated, Title Case or ALL CAPS lines (or explicit Markdown "#"
// prefixes) only. Known limitation, not solved here — same "flag rather than
// gold-plate" treatment as M5's Sheets/OCR gaps.
function isHeadingParagraph(paragraph: string): boolean {
  if (paragraph.includes("\n")) return false;
  const trimmed = paragraph.trim();
  if (!trimmed) return false;
  if (MARKDOWN_HEADING.test(trimmed)) return true;
  if (trimmed.length > HEADING_MAX_LENGTH) return false;
  if (TRAILING_PUNCTUATION.test(trimmed)) return false;
  return looksLikeHeadingCasing(trimmed);
}

function headingText(paragraph: string): string {
  return paragraph.trim().replace(MARKDOWN_HEADING, "").trim();
}

function segmentBySection(text: string): Segment[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const segments: Segment[] = [];
  let currentSection: string | undefined;
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length > 0) {
      segments.push({ section: currentSection, text: buffer.join("\n\n") });
      buffer = [];
    }
  };

  for (const paragraph of paragraphs) {
    if (isHeadingParagraph(paragraph)) {
      flush();
      currentSection = headingText(paragraph);
    } else {
      buffer.push(paragraph);
    }
  }
  flush();

  return segments;
}

/**
 * Splits `text` into token-budgeted chunks with overlap, carrying
 * section/heading metadata detected by `segmentBySection`. Overlap never
 * crosses a section boundary — bleeding content from a different section
 * into a chunk would undermine the point of attaching section metadata at all.
 */
export function chunkText(text: string, tokenizer: Tokenizer, options: ChunkOptions): Chunk[] {
  if (options.maxTokens <= 0) {
    throw new Error("maxTokens must be positive");
  }
  if (options.overlapTokens < 0 || options.overlapTokens >= options.maxTokens) {
    throw new Error("overlapTokens must be non-negative and smaller than maxTokens");
  }

  const chunks: Chunk[] = [];
  let index = 0;

  for (const segment of segmentBySection(text)) {
    const tokens = tokenizer.encode(segment.text);
    if (tokens.length === 0) continue;

    let start = 0;
    while (start < tokens.length) {
      const end = Math.min(start + options.maxTokens, tokens.length);
      const chunkTokens = tokens.slice(start, end);
      chunks.push({
        index: index++,
        text: tokenizer.decode(chunkTokens).trim(),
        section: segment.section,
        tokenCount: chunkTokens.length,
      });

      if (end === tokens.length) break;
      start = end - options.overlapTokens;
    }
  }

  return chunks;
}
