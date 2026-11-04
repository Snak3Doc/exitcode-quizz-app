/** The answer area of the question form, one editor per type. SPEC 3.4, step 18. */

import { useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { S } from '../strings';
import { CodeDisplay, LanguageSelect, insertTabInsteadOfLeaving } from '../components/Code';
import { newId } from '../lib/quizzes';
import { findBlanks } from '../lib/schema';
import {
  MAX_ACCEPTED_ANSWERS,
  MAX_ACCEPTED_ANSWER_LENGTH,
  MAX_LINES,
  MAX_LINE_LENGTH,
  MAX_OPTIONS,
  MAX_OPTION_CODE_LENGTH,
  MAX_OPTION_TEXT_LENGTH,
  MAX_SNIPPET_LENGTH,
  MAX_WORD_BANK,
  MAX_WORD_LENGTH,
  MIN_LINES,
  MIN_OPTIONS,
  OPTION_LETTERS,
} from '../lib/constants';
import type {
  ChoiceOption,
  FillBlankContent,
  OrderLine,
  OrderLinesContent,
  QuestionType,
  ShortTextContent,
} from '../lib/types';

type Content = Record<string, unknown>;
type OnChange = (next: Content) => void;

export function AnswerEditor({
  type,
  content,
  onChange,
}: {
  type: QuestionType;
  content: Content;
  onChange: OnChange;
}) {
  switch (type) {
    case 'mc_single':
    case 'mc_multi':
      return <ChoiceEditor type={type} content={content} onChange={onChange} />;
    case 'true_false':
      return <TrueFalseEditor content={content} onChange={onChange} />;
    case 'short_text':
      return <ShortTextEditor content={content} onChange={onChange} />;
    case 'fill_blank':
      return <FillBlankEditor content={content} onChange={onChange} />;
    case 'order_lines':
      return <OrderLinesEditor content={content} onChange={onChange} />;
  }
}

// ---------- multiple choice ----------

function ChoiceEditor({
  type,
  content,
  onChange,
}: {
  type: 'mc_single' | 'mc_multi';
  content: Content;
  onChange: OnChange;
}) {
  const options = (content.options as ChoiceOption[] | undefined) ?? [];
  const single = type === 'mc_single';

  function setOptions(next: ChoiceOption[]) {
    onChange({ ...content, options: next });
  }

  function update(id: string, patch: Partial<ChoiceOption>) {
    setOptions(options.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  function setCorrect(id: string, correct: boolean) {
    if (single) {
      // Exactly one correct: choosing one clears the rest.
      setOptions(options.map((o) => ({ ...o, correct: o.id === id })));
    } else {
      update(id, { correct });
    }
  }

  return (
    <div className="stack">
      {options.map((option, index) => (
        <div key={option.id} className="stack" style={{ gap: 6 }}>
          <div className="row-tight">
            <input
              type={single ? 'radio' : 'checkbox'}
              name={single ? 'correct-option' : undefined}
              checked={option.correct === true}
              aria-label={`Option ${OPTION_LETTERS[index] ?? index + 1} is correct`}
              onChange={(e) => setCorrect(option.id, e.target.checked)}
            />
            <span className="tag accent">{OPTION_LETTERS[index] ?? index + 1}</span>
            <select
              value={option.kind}
              style={{ width: 'auto' }}
              aria-label="Option kind"
              onChange={(e) => {
                const kind = e.target.value as 'text' | 'code';
                update(option.id, {
                  kind,
                  language: kind === 'code' ? (option.language ?? 'python') : undefined,
                });
              }}
            >
              <option value="text">{S.answers.kindText}</option>
              <option value="code">{S.answers.kindCode}</option>
            </select>
            {option.kind === 'code' && (
              <LanguageSelect
                value={option.language ?? 'python'}
                onChange={(language) => update(option.id, { language })}
              />
            )}
            <div className="grow" />
            <button
              type="button"
              className="icon"
              title={S.answers.removeOption}
              disabled={options.length <= MIN_OPTIONS}
              onClick={() => setOptions(options.filter((o) => o.id !== option.id))}
            >
              ✕
            </button>
          </div>

          {option.kind === 'code' ? (
            <>
              <textarea
                className="code-input"
                rows={3}
                spellCheck={false}
                value={option.text}
                maxLength={MAX_OPTION_CODE_LENGTH}
                aria-label={`Option ${OPTION_LETTERS[index] ?? index + 1} code`}
                onChange={(e) => update(option.id, { text: e.target.value })}
                onKeyDown={insertTabInsteadOfLeaving}
              />
              {option.text.trim() !== '' && (
                <CodeDisplay code={option.text} language={option.language ?? 'python'} />
              )}
            </>
          ) : (
            <input
              type="text"
              value={option.text}
              maxLength={MAX_OPTION_TEXT_LENGTH}
              placeholder={S.answers.optionPlaceholder}
              aria-label={`Option ${OPTION_LETTERS[index] ?? index + 1} text`}
              onChange={(e) => update(option.id, { text: e.target.value })}
            />
          )}
        </div>
      ))}

      <div className="row-tight">
        <button
          type="button"
          disabled={options.length >= MAX_OPTIONS}
          onClick={() =>
            setOptions([...options, { id: newId(), kind: 'text', text: '', correct: false }])
          }
        >
          {S.answers.addOption}
        </button>
        <span className="hint">{S.answers.optionCountHint}</span>
      </div>
      <p className="hint">
        {single ? S.answers.markCorrectSingle : S.answers.markCorrectMulti}
      </p>
    </div>
  );
}

// ---------- true / false ----------

function TrueFalseEditor({ content, onChange }: { content: Content; onChange: OnChange }) {
  const correct = content.correct === true;
  return (
    <div className="stack">
      {[true, false].map((value) => (
        <label key={String(value)} className="inline-label">
          <input
            type="radio"
            name="true-false-correct"
            checked={correct === value}
            onChange={() => onChange({ correct: value })}
          />
          {value ? S.answers.trueLabel : S.answers.falseLabel}
        </label>
      ))}
      <p className="hint">{S.answers.trueFalseHint}</p>
    </div>
  );
}

// ---------- short text ----------

function ShortTextEditor({ content, onChange }: { content: Content; onChange: OnChange }) {
  const c = content as unknown as ShortTextContent;
  const accepted = c.accepted ?? [''];

  function setAccepted(next: string[]) {
    onChange({ ...content, accepted: next });
  }

  return (
    <div className="stack">
      {accepted.map((answer, index) => (
        <div key={index} className="row-tight">
          <label htmlFor={`accepted-${index}`} style={{ minWidth: 80 }}>
            {S.answers.acceptedLabel}
          </label>
          <input
            id={`accepted-${index}`}
            type="text"
            value={answer}
            maxLength={MAX_ACCEPTED_ANSWER_LENGTH}
            onChange={(e) =>
              setAccepted(accepted.map((a, i) => (i === index ? e.target.value : a)))
            }
          />
          <button
            type="button"
            className="icon"
            title={S.answers.removeAccepted}
            disabled={accepted.length <= 1}
            onClick={() => setAccepted(accepted.filter((_, i) => i !== index))}
          >
            ✕
          </button>
        </div>
      ))}

      <div>
        <button
          type="button"
          disabled={accepted.length >= MAX_ACCEPTED_ANSWERS}
          onClick={() => setAccepted([...accepted, ''])}
        >
          {S.answers.addAccepted}
        </button>
      </div>

      <label className="inline-label">
        <input
          type="checkbox"
          checked={c.caseSensitive === true}
          onChange={(e) => onChange({ ...content, caseSensitive: e.target.checked })}
        />
        {S.answers.caseSensitive}
      </label>
      <p className="hint">{S.answers.shortTextHint}</p>
    </div>
  );
}

// ---------- fill in the blank ----------

function FillBlankEditor({ content, onChange }: { content: Content; onChange: OnChange }) {
  const c = content as unknown as FillBlankContent;
  const language = c.language ?? 'python';
  const snippet = c.snippet ?? '';
  const wordBank = c.wordBank ?? [];
  const answers = c.answers ?? {};
  const blanks = [...new Set(findBlanks(snippet))].sort((a, b) => a - b);
  const [newWord, setNewWord] = useState('');

  function patch(next: Partial<FillBlankContent>) {
    onChange({ ...content, ...next });
  }

  function addWord() {
    const word = newWord.trim();
    if (word === '' || wordBank.includes(word) || wordBank.length >= MAX_WORD_BANK) return;
    patch({ wordBank: [...wordBank, word] });
    setNewWord('');
  }

  function removeWord(word: string) {
    const nextAnswers = { ...answers };
    for (const [blank, value] of Object.entries(nextAnswers)) {
      if (value === word) delete nextAnswers[blank];
    }
    patch({ wordBank: wordBank.filter((w) => w !== word), answers: nextAnswers });
  }

  return (
    <div className="stack">
      <div className="row-tight">
        <label htmlFor="fill-language">{S.editor.languageLabel}</label>
        <LanguageSelect
          id="fill-language"
          value={language}
          onChange={(next) => patch({ language: next })}
        />
      </div>

      <div className="field">
        <label htmlFor="fill-snippet">{S.answers.snippetLabel}</label>
        <textarea
          id="fill-snippet"
          className="code-input"
          rows={5}
          spellCheck={false}
          value={snippet}
          maxLength={MAX_SNIPPET_LENGTH}
          placeholder={'for i in {{1}}(3):\n    {{2}}(i)'}
          onChange={(e) => patch({ snippet: e.target.value })}
          onKeyDown={insertTabInsteadOfLeaving}
        />
        <p className="hint">{S.answers.snippetHint}</p>
      </div>

      {snippet.trim() !== '' && <CodeDisplay code={snippet} language={language} />}

      <div className="field">
        <label>{S.answers.wordBank}</label>
        <div className="chips">
          {wordBank.map((word) => (
            <span key={word} className="chip">
              <code>{word}</code>
              <button
                type="button"
                className="icon"
                title={S.answers.removeWord}
                onClick={() => removeWord(word)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <div className="row-tight">
          <input
            type="text"
            value={newWord}
            maxLength={MAX_WORD_LENGTH}
            placeholder={S.answers.newWordPlaceholder}
            aria-label={S.answers.newWordPlaceholder}
            style={{ width: 200 }}
            onChange={(e) => setNewWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addWord();
              }
            }}
          />
          <button
            type="button"
            onClick={addWord}
            disabled={wordBank.length >= MAX_WORD_BANK || newWord.trim() === ''}
          >
            {S.answers.addWord}
          </button>
        </div>
      </div>

      {blanks.map((blank) => (
        <div key={blank} className="row-tight">
          <label htmlFor={`blank-${blank}`} style={{ minWidth: 130 }}>
            {S.answers.blankAnswer(blank)}
          </label>
          <select
            id={`blank-${blank}`}
            style={{ width: 'auto' }}
            value={answers[String(blank)] ?? ''}
            onChange={(e) =>
              patch({ answers: { ...answers, [String(blank)]: e.target.value } })
            }
          >
            <option value="">{S.answers.choose}</option>
            {wordBank.map((word) => (
              <option key={word} value={word}>
                {word}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

// ---------- order the lines ----------

function OrderLinesEditor({ content, onChange }: { content: Content; onChange: OnChange }) {
  const c = content as unknown as OrderLinesContent;
  const language = c.language ?? 'python';
  const lines = c.lines ?? [];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function setLines(next: OrderLine[]) {
    onChange({ ...content, lines: next });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = lines.findIndex((l) => l.id === active.id);
    const to = lines.findIndex((l) => l.id === over.id);
    if (from === -1 || to === -1) return;
    setLines(arrayMove(lines, from, to));
  }

  return (
    <div className="stack">
      <div className="row-tight">
        <label htmlFor="lines-language">{S.editor.languageLabel}</label>
        <LanguageSelect
          id="lines-language"
          value={language}
          onChange={(next) => onChange({ ...content, language: next })}
        />
      </div>

      <label>{S.answers.linesLabel}</label>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={lines.map((l) => l.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="stack" style={{ gap: 6 }}>
            {lines.map((line, index) => (
              <SortableLineRow
                key={line.id}
                id={line.id}
                canRemove={lines.length > MIN_LINES}
                onRemove={() => setLines(lines.filter((l) => l.id !== line.id))}
              >
                <input
                  type="text"
                  value={line.text}
                  maxLength={MAX_LINE_LENGTH}
                  spellCheck={false}
                  style={{ fontFamily: 'var(--mono)' }}
                  aria-label={`Line ${index + 1}`}
                  onChange={(e) =>
                    setLines(
                      lines.map((l) =>
                        l.id === line.id ? { ...l, text: e.target.value } : l,
                      ),
                    )
                  }
                />
              </SortableLineRow>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div>
        <button
          type="button"
          disabled={lines.length >= MAX_LINES}
          onClick={() => setLines([...lines, { id: newId(), text: '' }])}
        >
          {S.answers.addLine}
        </button>
      </div>
      <p className="hint">{S.answers.orderLinesHint}</p>
    </div>
  );
}

export function SortableLineRow({
  id,
  children,
  canRemove,
  onRemove,
}: {
  id: string;
  children: React.ReactNode;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`sortable-line ${isDragging ? 'dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        className="drag-handle"
        aria-label={S.editor.dragToReorder}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <div className="grow">{children}</div>
      <button
        type="button"
        className="icon"
        title={S.answers.removeLine}
        disabled={!canRemove}
        onClick={onRemove}
      >
        ✕
      </button>
    </div>
  );
}
