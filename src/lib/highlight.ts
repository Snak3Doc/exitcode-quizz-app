/**
 * highlight.js core build with only the five languages the app offers, so the
 * bundle stays small. SPEC 2.
 */

import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import xml from 'highlight.js/lib/languages/xml'; // HTML
import css from 'highlight.js/lib/languages/css';
import plaintext from 'highlight.js/lib/languages/plaintext';
import type { CodeLanguage } from './types';

hljs.registerLanguage('python', python);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('plaintext', plaintext);

/** Our language names mapped to highlight.js's. */
const HLJS_NAME: Record<CodeLanguage, string> = {
  python: 'python',
  javascript: 'javascript',
  html: 'xml',
  css: 'css',
  plaintext: 'plaintext',
};

/**
 * Highlighted HTML for a snippet. highlight.js escapes the input, so the
 * result is safe to put in dangerouslySetInnerHTML.
 */
export function highlightCode(code: string, language: CodeLanguage | null): string {
  const name = HLJS_NAME[language ?? 'plaintext'] ?? 'plaintext';
  try {
    return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
