/**
 * The form that asks for a quiz. Plan §5.7.
 *
 * The teacher owns the shape — how many questions, which types, timed or not.
 * The model owns the content. Timing especially is not the model's to pick:
 * the speed bonus only applies to timed questions, so letting it choose would
 * quietly change how the whole quiz scores.
 */

import { useState, type FormEvent } from 'react';
import { S } from '../strings';
import { QUESTION_TYPES, type QuestionType } from '../lib/types';
import {
  DEFAULT_TIME_LIMIT_SECONDS,
  MAX_TIME_LIMIT_SECONDS,
  MIN_TIME_LIMIT_SECONDS,
  TIME_QUICK_PICKS,
} from '../lib/constants';

/** Matches the Edge Function's own cap, which is well under the schema's 50. */
export const MAX_GENERATED = 20;
const DEFAULT_COUNT = 8;

const TYPE_LABELS: Record<QuestionType, string> = {
  mc_single: S.types.mc_single,
  mc_multi: S.types.mc_multi,
  true_false: S.types.true_false,
  short_text: S.types.short_text,
  fill_blank: S.types.fill_blank,
  order_lines: S.types.order_lines,
};

export interface GenerateChoices {
  topic: string;
  count: number;
  types: QuestionType[];
  timing: { mode: 'wait' | 'timed'; seconds?: number };
}

export function GenerateQuiz({
  busy,
  error,
  onCancel,
  onGenerate,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onGenerate: (choices: GenerateChoices) => void;
}) {
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [types, setTypes] = useState<QuestionType[]>([...QUESTION_TYPES]);
  // Untimed by default: it is the forgiving classroom option, and it keeps the
  // speed bonus out of a quiz nobody asked to be a race.
  const [timed, setTimed] = useState(false);
  const [seconds, setSeconds] = useState(DEFAULT_TIME_LIMIT_SECONDS);
  const [problem, setProblem] = useState<string | null>(null);

  function toggle(type: QuestionType) {
    setTypes((current) =>
      current.includes(type) ? current.filter((t) => t !== type) : [...current, type],
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (topic.trim() === '') {
      setProblem(S.generate.missingTopic);
      return;
    }
    if (types.length === 0) {
      setProblem(S.generate.missingTypes);
      return;
    }
    setProblem(null);
    onGenerate({
      topic,
      count,
      // Keep the app's own order rather than the order they were ticked in, so
      // the same choice always sends the same request.
      types: QUESTION_TYPES.filter((type) => types.includes(type)),
      timing: timed ? { mode: 'timed', seconds } : { mode: 'wait' },
    });
  }

  return (
    <form className="window" onSubmit={onSubmit}>
      <div className="title-bar">{S.generate.heading}</div>
      <div className="body">
        <div className="field">
          <label htmlFor="generate-topic">{S.generate.topicLabel}</label>
          <textarea
            id="generate-topic"
            rows={2}
            autoFocus
            disabled={busy}
            value={topic}
            placeholder={S.generate.topicPlaceholder}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="generate-count">{S.generate.countLabel}</label>
          <input
            id="generate-count"
            type="number"
            min={1}
            max={MAX_GENERATED}
            disabled={busy}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </div>

        <fieldset className="field" disabled={busy}>
          <legend>{S.generate.typesLabel}</legend>
          <div className="chips">
            {QUESTION_TYPES.map((type) => (
              <label key={type} className="chip-check">
                <input
                  type="checkbox"
                  checked={types.includes(type)}
                  onChange={() => toggle(type)}
                />
                <span>{TYPE_LABELS[type]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="field" disabled={busy}>
          <legend>{S.generate.timingLabel}</legend>
          <label className="inline-label">
            <input type="radio" checked={!timed} onChange={() => setTimed(false)} />
            <span>{S.generate.waitForEveryone}</span>
          </label>
          <label className="inline-label">
            <input type="radio" checked={timed} onChange={() => setTimed(true)} />
            <span>{S.generate.timed}</span>
          </label>

          {timed && (
            <div className="field">
              <label htmlFor="generate-seconds">{S.generate.secondsLabel}</label>
              <input
                id="generate-seconds"
                type="number"
                min={MIN_TIME_LIMIT_SECONDS}
                max={MAX_TIME_LIMIT_SECONDS}
                value={seconds}
                onChange={(e) => setSeconds(Number(e.target.value))}
              />
              <div className="chips">
                {TIME_QUICK_PICKS.map((pick) => (
                  <button
                    key={pick}
                    type="button"
                    className={pick === seconds ? 'chip is-on' : 'chip'}
                    onClick={() => setSeconds(pick)}
                  >
                    {pick}
                  </button>
                ))}
              </div>
            </div>
          )}
        </fieldset>

        <div className="row">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? S.generate.working : S.generate.submit}
          </button>
          <button type="button" onClick={onCancel} disabled={busy}>
            {S.generate.cancel}
          </button>
        </div>

        {(problem ?? error) && (
          <p className="error-text" role="alert">
            {problem ?? error}
          </p>
        )}
      </div>
    </form>
  );
}
