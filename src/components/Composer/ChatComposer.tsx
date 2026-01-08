import React from "react";
import { Question } from "../../builder/questions";

type ChatComposerProps = {
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  nextQuestions: Question[];
  answers: Record<string, string>;
  onAnswerChange: (id: string, value: string) => void;
  onContinue: () => void;
  builderError?: string | null;
  builderDebug?: string[];
  draftSummary?: string | null;
  canApplyDraft?: boolean;
  onApplyDraft?: () => void;
};

const inputTypeForQuestion = (question: Question) => {
  switch (question.expectedType) {
    case "number":
      return "number";
    case "boolean":
      return "checkbox";
    default:
      return "text";
  }
};

export const ChatComposer = ({
  chatInput,
  onChatInputChange,
  onSubmit,
  nextQuestions,
  answers,
  onAnswerChange,
  onContinue,
  builderError,
  builderDebug,
  draftSummary,
  canApplyDraft,
  onApplyDraft
}: ChatComposerProps) => (
  <>
    <form onSubmit={onSubmit}>
      <textarea
        value={chatInput}
        onChange={(event) => onChatInputChange(event.target.value)}
        placeholder="Try: text: Welcome to the raid"
        rows={6}
      />
      <button type="submit">Compose Plan</button>
    </form>
    {draftSummary && <p className="status-muted">{draftSummary}</p>}
    {canApplyDraft && onApplyDraft && (
      <button type="button" onClick={onApplyDraft}>
        Apply Draft Plan
      </button>
    )}
    {builderError && <p className="status-error">{builderError}</p>}
    {builderDebug && builderDebug.length > 0 && (
      <div className="status-muted">
        {builderDebug.map((line, index) => (
          <div key={`${line}-${index}`}>{line}</div>
        ))}
      </div>
    )}
    {nextQuestions.length > 0 && (
      <div className="builder-questions">
        <h4>Missing details</h4>
        {nextQuestions.map((question) => {
          const inputType = inputTypeForQuestion(question);
          const value = answers[question.id] ?? "";
          return (
            <label key={question.id} className="builder-question">
              <span>{question.question}</span>
              {question.expectedType === "enum" && question.choices ? (
                <select
                  value={value}
                  onChange={(event) => onAnswerChange(question.id, event.target.value)}
                >
                  <option value="">Select...</option>
                  {question.choices.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                </select>
              ) : inputType === "checkbox" ? (
                <input
                  type="checkbox"
                  checked={value === "true"}
                  onChange={(event) =>
                    onAnswerChange(question.id, event.target.checked ? "true" : "false")
                  }
                />
              ) : (
                <input
                  type={inputType}
                  value={value}
                  onChange={(event) => onAnswerChange(question.id, event.target.value)}
                />
              )}
            </label>
          );
        })}
        <button type="button" onClick={onContinue}>
          Continue
        </button>
      </div>
    )}
    <div className="chat-hints">
      <p>Planner commands:</p>
      <ul>
        <li>
          <strong>reset</strong> - restore default overlay plan
        </li>
        <li>
          <strong>text: ...</strong> - draft a WidgetSpec notes widget
        </li>
        <li>
          <strong>timer respawn 15m</strong> - draft a timer widget
        </li>
      </ul>
    </div>
  </>
);
