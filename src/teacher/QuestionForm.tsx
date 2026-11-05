/** The right-hand question form: type, text, code block, answer, timing, explanation. */

import { S } from '../strings';
import { CodeBlockEditor } from '../components/Code';
import { AnswerEditor } from './AnswerEditors';
import { defaultContent } from '../lib/quizzes';
import {
  DEFAULT_TIME_LIMIT_SECONDS,
  MAX_EXPLANATION_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_TIME_LIMIT_SECONDS,
  MIN_TIME_LIMIT_SECONDS,
  TIME_QUICK_PICKS,
} from '../lib/constants';
import { QUESTION_TYPES, type Question, type QuestionType } from '../lib/types';

export function QuestionForm({
  question,
  onChange,
  onRegenerate,
}: {
  question: Question;
  onChange: (next: Question) => void;
  /** Absent when generation is not set up, so the button simply is not there. */
  onRegenerate?: () => void;
}) {
  function patch(next: Partial<Question>) {
    onChange({ ...question, ...next });
  }

  function changeType(type: QuestionType) {
    if (type === question.type) return;
    if (hasAnswerContent(question) && !confirm(S.editor.typeChangeConfirm)) return;
    patch({ type, content: defaultContent(type) });
  }

  return (
    <div className="window">
      <div className="title-bar">
        <span>{S.editor.questionForm}</span>
        <span className="row-tight">
          {onRegenerate && (
            <button type="button" className="ghost" onClick={onRegenerate}>
              {S.editor.regenerate}
            </button>
          )}
          <span className="tag">{S.types[question.type]}</span>
        </span>
      </div>
      <div className="body">
        <div className="row-tight">
          <label htmlFor="question-type">{S.editor.typeLabel}</label>
          <select
            id="question-type"
            value={question.type}
            style={{ width: 'auto' }}
            onChange={(e) => changeType(e.target.value as QuestionType)}
          >
            {QUESTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {S.typesLong[type]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="question-prompt">{S.editor.promptLabel}</label>
          <textarea
            id="question-prompt"
            rows={2}
            value={question.prompt}
            maxLength={MAX_PROMPT_LENGTH}
            placeholder={S.editor.promptPlaceholder}
            onChange={(e) => patch({ prompt: e.target.value })}
          />
        </div>

        {question.code === null ? (
          <div>
            <button
              type="button"
              onClick={() => patch({ code: '', codeLanguage: 'python' })}
            >
              {S.editor.addCodeBlock}
            </button>
          </div>
        ) : (
          <CodeBlockEditor
            code={question.code}
            language={question.codeLanguage ?? 'python'}
            onChange={({ code, language }) => patch({ code, codeLanguage: language })}
            onRemove={() => patch({ code: null, codeLanguage: null })}
          />
        )}

        <div className="window">
          <div className="title-bar">{S.editor.answerArea}</div>
          <div className="body">
            <AnswerEditor
              type={question.type}
              content={question.content}
              onChange={(content) => patch({ content })}
            />
          </div>
        </div>

        <div className="window">
          <div className="title-bar">{S.editor.timing}</div>
          <div className="body">
            <div className="row">
              <label className="inline-label">
                <input
                  type="radio"
                  name="timing-mode"
                  checked={question.timingMode === 'wait'}
                  onChange={() => patch({ timingMode: 'wait', timeLimitSeconds: null })}
                />
                {S.editor.waitForEveryone}
              </label>
              <label className="inline-label">
                <input
                  type="radio"
                  name="timing-mode"
                  checked={question.timingMode === 'timed'}
                  onChange={() =>
                    patch({
                      timingMode: 'timed',
                      timeLimitSeconds:
                        question.timeLimitSeconds ?? DEFAULT_TIME_LIMIT_SECONDS,
                    })
                  }
                />
                {S.editor.timed}
              </label>
            </div>

            {question.timingMode === 'timed' && (
              <>
                <div className="row-tight">
                  <label htmlFor="time-limit">{S.editor.secondsLabel}</label>
                  <input
                    id="time-limit"
                    type="number"
                    min={MIN_TIME_LIMIT_SECONDS}
                    max={MAX_TIME_LIMIT_SECONDS}
                    step={1}
                    value={question.timeLimitSeconds ?? DEFAULT_TIME_LIMIT_SECONDS}
                    onChange={(e) => {
                      const value = Number.parseInt(e.target.value, 10);
                      patch({
                        timeLimitSeconds: Number.isNaN(value)
                          ? null
                          : Math.trunc(value),
                      });
                    }}
                  />
                  <span className="hint">{S.editor.secondsHint}</span>
                </div>
                <div className="row-tight">
                  <span className="hint">{S.editor.quickPick}</span>
                  {TIME_QUICK_PICKS.map((seconds) => (
                    <button
                      key={seconds}
                      type="button"
                      className={question.timeLimitSeconds === seconds ? 'primary' : 'ghost'}
                      onClick={() => patch({ timeLimitSeconds: seconds })}
                    >
                      {seconds}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="field">
          <label htmlFor="question-explanation">{S.editor.explanation}</label>
          <textarea
            id="question-explanation"
            rows={2}
            value={question.explanation ?? ''}
            maxLength={MAX_EXPLANATION_LENGTH}
            placeholder={S.editor.explanationPlaceholder}
            onChange={(e) =>
              patch({ explanation: e.target.value === '' ? null : e.target.value })
            }
          />
        </div>
      </div>
    </div>
  );
}

/** Whether changing type would throw away work the teacher has done. */
function hasAnswerContent(question: Question): boolean {
  const content = question.content;
  switch (question.type) {
    case 'mc_single':
    case 'mc_multi': {
      const options = (content.options as Array<{ text?: string; correct?: boolean }>) ?? [];
      return options.some((o) => (o.text ?? '').trim() !== '' || o.correct === true);
    }
    case 'true_false':
      return false; // One of the two is always picked; nothing is lost.
    case 'short_text':
      return ((content.accepted as string[]) ?? []).some((a) => a.trim() !== '');
    case 'fill_blank':
      return (
        String(content.snippet ?? '').trim() !== '' ||
        ((content.wordBank as string[]) ?? []).length > 0
      );
    case 'order_lines':
      return ((content.lines as Array<{ text?: string }>) ?? []).some(
        (l) => (l.text ?? '').trim() !== '',
      );
  }
}
