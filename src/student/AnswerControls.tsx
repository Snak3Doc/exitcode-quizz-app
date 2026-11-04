/** What a student actually answers with, one control set per type. SPEC 3.7. */

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
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { S } from '../strings';
import { BlankSnippet, OptionBody } from '../components/QuestionView';
import { optionLetter } from '../lib/game-logic';
import type {
  AnswerValue,
  ChoiceOption,
  CodeLanguage,
  OrderLine,
  QuestionType,
} from '../lib/types';

type PublicOption = Omit<ChoiceOption, 'correct'>;

export function AnswerControls({
  type,
  content,
  answer,
  onChange,
  disabled,
}: {
  type: QuestionType;
  content: Record<string, unknown>;
  answer: AnswerValue | undefined;
  onChange: (next: AnswerValue) => void;
  disabled?: boolean;
}) {
  switch (type) {
    case 'mc_single': {
      const options = (content.options as PublicOption[]) ?? [];
      return (
        <div className="stack">
          {options.map((option, index) => (
            <label
              key={option.id}
              className={`option ${answer === option.id ? 'chosen' : ''}`}
            >
              <input
                type="radio"
                name="answer"
                disabled={disabled}
                checked={answer === option.id}
                onChange={() => onChange(option.id)}
              />
              <span className="letter">{optionLetter(index)}</span>
              <span className="option-body">
                <OptionBody option={option} />
              </span>
            </label>
          ))}
        </div>
      );
    }

    case 'mc_multi': {
      const options = (content.options as PublicOption[]) ?? [];
      const chosen = Array.isArray(answer) ? (answer as string[]) : [];
      return (
        <div className="stack">
          <p className="hint">{S.play.selectAllThatApply}</p>
          {options.map((option, index) => {
            const ticked = chosen.includes(option.id);
            return (
              <label key={option.id} className={`option ${ticked ? 'chosen' : ''}`}>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={ticked}
                  onChange={() =>
                    onChange(
                      ticked
                        ? chosen.filter((id) => id !== option.id)
                        : [...chosen, option.id],
                    )
                  }
                />
                <span className="letter">{optionLetter(index)}</span>
                <span className="option-body">
                  <OptionBody option={option} />
                </span>
              </label>
            );
          })}
        </div>
      );
    }

    case 'true_false':
      return (
        <div className="tf-buttons">
          {[true, false].map((value) => (
            <button
              key={String(value)}
              type="button"
              disabled={disabled}
              className={answer === value ? 'primary' : ''}
              aria-pressed={answer === value}
              onClick={() => onChange(value)}
            >
              {value ? S.answers.trueLabel : S.answers.falseLabel}
            </button>
          ))}
        </div>
      );

    case 'short_text':
      return (
        <input
          type="text"
          autoFocus
          disabled={disabled}
          value={typeof answer === 'string' ? answer : ''}
          placeholder={S.play.typeYourAnswer}
          aria-label={S.play.typeYourAnswer}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'fill_blank': {
      const chosen =
        typeof answer === 'object' && answer !== null && !Array.isArray(answer)
          ? (answer as Record<string, string>)
          : {};
      const wordBank = (content.wordBank as string[]) ?? [];
      return (
        <BlankSnippet
          snippet={String(content.snippet ?? '')}
          language={(content.language as CodeLanguage) ?? 'plaintext'}
          renderBlank={(blank) => (
            <select
              className="blank"
              disabled={disabled}
              aria-label={S.answers.blankAnswer(blank)}
              value={chosen[String(blank)] ?? ''}
              onChange={(e) =>
                onChange({ ...chosen, [String(blank)]: e.target.value })
              }
            >
              <option value="">{S.answers.choose}</option>
              {wordBank.map((word) => (
                <option key={word} value={word}>
                  {word}
                </option>
              ))}
            </select>
          )}
        />
      );
    }

    case 'order_lines': {
      const lines = (content.lines as OrderLine[]) ?? [];
      // The shuffled order the student was sent already counts as an answer.
      const order = Array.isArray(answer)
        ? (answer as string[])
        : lines.map((line) => line.id);
      return (
        <OrderAnswer
          lines={lines}
          order={order}
          disabled={disabled}
          onChange={onChange}
        />
      );
    }
  }
}

function OrderAnswer({
  lines,
  order,
  disabled,
  onChange,
}: {
  lines: OrderLine[];
  order: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const ordered = order.map((id) => byId.get(id)).filter((l): l is OrderLine => !!l);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onChange(arrayMove(order, from, to));
  }

  return (
    <div className="stack">
      <p className="hint">{S.play.dragIntoOrder}</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div className="stack" style={{ gap: 6 }}>
            {ordered.map((line, index) => (
              <SortableAnswerLine
                key={line.id}
                id={line.id}
                text={line.text}
                position={index + 1}
                disabled={disabled}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableAnswerLine({
  id,
  text,
  position,
  disabled,
}: {
  id: string;
  text: string;
  position: number;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      className={`sortable-line ${isDragging ? 'dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        className="drag-handle"
        disabled={disabled}
        aria-label={`${S.play.dragIntoOrder} (${position})`}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <span className="line-text">{text}</span>
    </div>
  );
}
