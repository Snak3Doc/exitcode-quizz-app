/**
 * Showing a question. The same pieces serve the projector and the students,
 * so what the class sees and what each student sees cannot drift apart.
 */

import { Fragment, type ReactNode } from 'react';
import { S } from '../strings';
import { CodeDisplay } from './Code';
import { highlightCode } from '../lib/highlight';
import { optionLetter } from '../lib/game-logic';
import type {
  ChoiceOption,
  CodeLanguage,
  CorrectAnswer,
  OrderLine,
  QuestionType,
} from '../lib/types';

type PublicOption = Omit<ChoiceOption, 'correct'>;

/** The question text and its optional code block. */
export function QuestionBody({
  prompt,
  code,
  codeLanguage,
}: {
  prompt: string;
  code?: string | null;
  codeLanguage?: CodeLanguage | null;
}) {
  return (
    <div className="stack">
      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{prompt}</p>
      {code && <CodeDisplay code={code} language={codeLanguage ?? 'plaintext'} />}
    </div>
  );
}

/** One lettered option, text or code. */
export function OptionBody({ option }: { option: PublicOption }) {
  if (option.kind === 'code') {
    // `wrap` rather than the scrolling a code block normally gets. An option
    // is usually one short expression, and a long one in a scrolling box is
    // unreadable on a projector -- nobody can scroll it from the back of the
    // room. The question's own code block keeps its scroll, where the line
    // structure matters and the teacher chose the content.
    return (
      <CodeDisplay
        code={option.text}
        language={option.language ?? 'plaintext'}
        className="wrap"
      />
    );
  }
  return <span style={{ whiteSpace: 'pre-wrap' }}>{option.text}</span>;
}

/**
 * What the projector shows in the answer area: the same options the students
 * have, never marked. SPEC 3.6.
 */
export function AnswerPreview({
  type,
  content,
}: {
  type: QuestionType;
  content: Record<string, unknown>;
}) {
  switch (type) {
    case 'mc_single':
    case 'mc_multi': {
      const options = (content.options as PublicOption[]) ?? [];
      return (
        <>
          {type === 'mc_multi' && <p className="hint">{S.play.selectAllThatApply}</p>}
          <div className="option-grid">
            {options.map((option, index) => (
              <div key={option.id} className="option">
                <span className="letter">[{optionLetter(index)}]</span>
                <span className="option-body">
                  <OptionBody option={option} />
                </span>
              </div>
            ))}
          </div>
        </>
      );
    }

    case 'true_false':
      return (
        <div className="tf-buttons">
          <div className="option">
            <span className="option-body">{S.answers.trueLabel}</span>
          </div>
          <div className="option">
            <span className="option-body">{S.answers.falseLabel}</span>
          </div>
        </div>
      );

    case 'short_text':
      return <p className="dim">{S.host.answerPlaceholder}</p>;

    case 'fill_blank':
      return (
        <div className="stack">
          <BlankSnippet
            snippet={String(content.snippet ?? '')}
            language={(content.language as CodeLanguage) ?? 'plaintext'}
            renderBlank={(n) => (
              <span className="blank-slot" key={n}>
                {n}
              </span>
            )}
          />
          <div className="chips">
            {((content.wordBank as string[]) ?? []).map((word) => (
              <span key={word} className="chip">
                <code>{word}</code>
              </span>
            ))}
          </div>
        </div>
      );

    case 'order_lines': {
      const lines = (content.lines as OrderLine[]) ?? [];
      return (
        <div className="stack" style={{ gap: 6 }}>
          {lines.map((line) => (
            <div key={line.id} className="sortable-line">
              <span className="line-text">{line.text}</span>
            </div>
          ))}
        </div>
      );
    }
  }
}

/**
 * A fill-in-the-blank snippet with something rendered at each blank. The code
 * between blanks is highlighted; the blanks themselves are live controls.
 */
export function BlankSnippet({
  snippet,
  language,
  renderBlank,
}: {
  snippet: string;
  language: CodeLanguage;
  renderBlank: (blankNumber: number) => ReactNode;
}) {
  const parts = snippet.split(/(\{\{\d+\}\})/g);
  return (
    <div className="blank-snippet hljs">
      {parts.map((part, index) => {
        const match = /^\{\{(\d+)\}\}$/.exec(part);
        if (match) return <Fragment key={index}>{renderBlank(Number(match[1]))}</Fragment>;
        if (part === '') return null;
        return <InlineCode key={index} code={part} language={language} />;
      })}
    </div>
  );
}

function InlineCode({ code, language }: { code: string; language: CodeLanguage }) {
  // The same highlighter as a code block, but inline between the blanks.
  return (
    <span
      style={{ whiteSpace: 'pre-wrap' }}
      dangerouslySetInnerHTML={{ __html: highlightCached(code, language) }}
    />
  );
}

/** The snippet is re-highlighted on every keystroke, so cache the pieces. */
const highlightCache = new Map<string, string>();

function highlightCached(code: string, language: CodeLanguage): string {
  const key = `${language}\u0000${code}`;
  const hit = highlightCache.get(key);
  if (hit !== undefined) return hit;
  const html = highlightCode(code, language);
  if (highlightCache.size > 200) highlightCache.clear();
  highlightCache.set(key, html);
  return html;
}

/** The correct answer, as both results screens show it. SPEC 3.6. */
export function CorrectAnswerView({ correct }: { correct: CorrectAnswer }) {
  switch (correct.type) {
    case 'mc_single':
    case 'mc_multi': {
      const correctIds = new Set(correct.optionIds);
      return (
        <div className="stack">
          {correct.options.map((option, index) =>
            correctIds.has(option.id) ? (
              <div key={option.id} className="option is-correct">
                <span className="letter">[{optionLetter(index)}]</span>
                <span className="option-body">
                  <OptionBody option={option} />
                </span>
                <span className="mark correct">✓</span>
              </div>
            ) : null,
          )}
        </div>
      );
    }

    case 'true_false':
      return (
        <div className="option is-correct">
          <span className="option-body">
            {correct.correct ? S.answers.trueLabel : S.answers.falseLabel}
          </span>
          <span className="mark correct">✓</span>
        </div>
      );

    case 'short_text':
      return (
        <div className="chips">
          {correct.accepted.map((answer) => (
            <span key={answer} className="chip">
              <code>{answer}</code>
            </span>
          ))}
        </div>
      );

    case 'fill_blank':
      return (
        <BlankSnippet
          snippet={correct.snippet}
          language={correct.language}
          renderBlank={(n) => (
            <span className="blank-slot" style={{ color: 'var(--correct)' }}>
              {correct.answers[String(n)] ?? '?'}
            </span>
          )}
        />
      );

    case 'order_lines':
      return (
        <CodeDisplay
          code={correct.lines.map((line) => line.text).join('\n')}
          language={correct.language}
        />
      );
  }
}

/** ✓ ½ ✗ – — never colour on its own. SPEC 8. */
export function ResultMark({ status }: { status: 'correct' | 'partial' | 'wrong' | 'none' }) {
  const marks = { correct: '✓', partial: '½', wrong: '✗', none: '–' } as const;
  return <span className={`mark ${status}`}>{marks[status]}</span>;
}
