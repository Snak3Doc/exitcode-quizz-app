/** Read-only highlighted code, and the editor's code block with live preview. */

import { useMemo } from 'react';
import { highlightCode } from '../lib/highlight';
import { CODE_LANGUAGES, type CodeLanguage } from '../lib/types';
import { MAX_CODE_LENGTH } from '../lib/constants';
import { S } from '../strings';

export function CodeDisplay({
  code,
  language,
  className,
}: {
  code: string;
  language: CodeLanguage | null;
  className?: string;
}) {
  const html = useMemo(() => highlightCode(code, language), [code, language]);
  return (
    <pre className={`code hljs ${className ?? ''}`}>
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}

export function LanguageSelect({
  value,
  onChange,
  id,
  disabled,
}: {
  value: CodeLanguage;
  onChange: (language: CodeLanguage) => void;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      style={{ width: 'auto' }}
      aria-label={S.editor.languageLabel}
      onChange={(e) => onChange(e.target.value as CodeLanguage)}
    >
      {CODE_LANGUAGES.map((language) => (
        <option key={language} value={language}>
          {S.languages[language]}
        </option>
      ))}
    </select>
  );
}

/**
 * The teacher's code block: language dropdown, textarea, live highlighted
 * preview, and Remove. Step 16.
 */
export function CodeBlockEditor({
  code,
  language,
  onChange,
  onRemove,
  maxLength = MAX_CODE_LENGTH,
  title = S.editor.codeBlock,
  rows = 5,
}: {
  code: string;
  language: CodeLanguage;
  onChange: (next: { code: string; language: CodeLanguage }) => void;
  onRemove?: () => void;
  maxLength?: number;
  title?: string;
  rows?: number;
}) {
  return (
    <div className="window">
      <div className="title-bar">
        <span>{title}</span>
        <span className="row-tight">
          <LanguageSelect
            value={language}
            onChange={(next) => onChange({ code, language: next })}
          />
          {onRemove && (
            <button type="button" className="icon" onClick={onRemove}>
              {S.editor.removeCodeBlock}
            </button>
          )}
        </span>
      </div>
      <div className="body">
        <textarea
          className="code-input"
          value={code}
          rows={rows}
          spellCheck={false}
          maxLength={maxLength}
          placeholder={S.editor.codePlaceholder}
          aria-label={title}
          onChange={(e) => onChange({ code: e.target.value, language })}
          onKeyDown={insertTabInsteadOfLeaving}
        />
        {code.trim() !== '' && (
          <div>
            <div className="hint">{S.editor.preview}</div>
            <CodeDisplay code={code} language={language} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Tab inserts four spaces in a code textarea. Shift+Tab still moves focus, so
 * the form stays reachable from the keyboard.
 */
export function insertTabInsteadOfLeaving(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
) {
  if (event.key !== 'Tab' || event.shiftKey) return;
  event.preventDefault();
  const area = event.currentTarget;
  const { selectionStart, selectionEnd, value } = area;
  const next = `${value.slice(0, selectionStart)}    ${value.slice(selectionEnd)}`;
  // Setting .value directly would not tell React, so fire the native setter.
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  setter?.call(area, next);
  area.dispatchEvent(new Event('input', { bubbles: true }));
  requestAnimationFrame(() => {
    area.selectionStart = area.selectionEnd = selectionStart + 4;
  });
}
