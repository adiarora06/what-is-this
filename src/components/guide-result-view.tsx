import { useEffect, useRef, type FormEvent, type RefObject } from "react";
import { GUIDE_INTENT_DETAILS } from "@/lib/guide-client";
import type { GuideResult } from "@/lib/types";

type Props = {
  result: GuideResult;
  image?: string;
  providerWarnings?: string[];
  requestId?: string;
  clarificationAnswer: string;
  clarificationBusy: boolean;
  clarificationError?: string;
  securityNeeded: boolean;
  securityReady: boolean;
  turnstileContainerRef: RefObject<HTMLDivElement | null>;
  hasIdentification: boolean;
  canIdentifyImage: boolean;
  onClarificationAnswer: (value: string) => void;
  onClarify: () => void;
  onBackToIdentification: () => void;
  onIdentifyImage: () => void;
  onScanAnother: () => void;
};

function confidenceText(result: GuideResult) {
  if (result.clarificationQuestion) return "More information needed";
  if (result.confidence >= 0.82) return "Strongly supported";
  if (result.confidence >= 0.55) return "Likely";
  return "Needs confirmation";
}

export function GuideResultView(props: Props) {
  const warnings = Array.from(new Set([...(props.result.warnings || []), ...(props.providerWarnings || [])]));
  const clarification = props.result.clarificationQuestion;
  const clarificationInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (props.clarificationError) clarificationInputRef.current?.focus();
  }, [props.clarificationError]);

  function submitClarification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onClarify();
  }

  return (
    <section className="viewStack resultView guideResultView" aria-labelledby="result-heading">
      <button className="backButton" onClick={props.hasIdentification ? props.onBackToIdentification : props.onScanAnother}>
        {props.hasIdentification ? "Back to identification" : "Back to camera"}
      </button>

      <article className="resultPanel">
        <header className="resultHero guideHero">
          {props.image ? <img src={props.image} alt="Context used for this guide" /> : null}
          <div>
            <p className="eyebrow">{clarification ? "More information needed" : GUIDE_INTENT_DETAILS[props.result.intent].label}</p>
            <h1 id="result-heading" tabIndex={-1}>{props.result.subject}</h1>
            <div className="resultMeta">
              <span className="confidenceBadge">{confidenceText(props.result)} · {Math.round(props.result.confidence * 100)}%</span>
              <span>{props.result.goal}</span>
            </div>
          </div>
        </header>

        {warnings.length > 0 ? (
          <section className="guideWarnings" aria-labelledby="guide-warnings-heading">
            <h2 id="guide-warnings-heading">Before you continue</h2>
            <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </section>
        ) : null}

        {clarification ? (
          <section className="clarificationPanel" aria-labelledby="clarification-heading">
            <div>
              <p className="eyebrow">One useful question</p>
              <h2 id="clarification-heading">{clarification}</h2>
            </div>
            <form onSubmit={submitClarification}>
              <label>
                Your answer
                <textarea
                  id="guide-clarification-answer"
                  ref={clarificationInputRef}
                  maxLength={500}
                  required
                  aria-invalid={Boolean(props.clarificationError)}
                  aria-describedby={props.clarificationError ? "clarification-answer-error" : undefined}
                  value={props.clarificationAnswer}
                  onChange={(event) => props.onClarificationAnswer(event.target.value)}
                  placeholder="Add the exact label, symptom, option, or outcome."
                />
              </label>
              {props.clarificationError ? <p id="clarification-answer-error" className="inlineError" role="alert">{props.clarificationError}</p> : null}
              {props.securityNeeded ? (
                <div className="securityCheck">
                  <span>{props.securityReady ? "Security check complete" : "Complete the security check to continue"}</span>
                  <div ref={props.turnstileContainerRef} />
                </div>
              ) : null}
              <button className="primaryButton" type="submit" disabled={props.clarificationBusy || !props.clarificationAnswer.trim() || !props.securityReady}>
                {props.clarificationBusy ? "Updating…" : "Update the guide"}
              </button>
            </form>
          </section>
        ) : null}

        <section className="aboutCard guideSummary" aria-labelledby="guide-summary-heading">
          <h2 id="guide-summary-heading">What this means</h2>
          <p>{props.result.summary}</p>
        </section>

        {!clarification ? (
          <section className="recommendationPanel" aria-labelledby="recommendation-heading">
            <p className="eyebrow">Recommended next move</p>
            <h2 id="recommendation-heading">{props.result.recommendedAction.title}</h2>
            <p>{props.result.recommendedAction.reason}</p>
          </section>
        ) : null}

        {props.result.steps.length > 0 ? (
          <section className="guideSteps" aria-labelledby="guide-steps-heading">
            <h2 id="guide-steps-heading">Steps</h2>
            <ol>
              {props.result.steps.map((step) => (
                <li key={step.id}>
                  <div>
                    <h3>{step.title}</h3>
                    {step.risk ? <p className="stepRisk"><strong>Risk:</strong> {step.risk}</p> : null}
                    <p>{step.instruction}</p>
                    {step.completionCheck ? <p className="stepCheck"><strong>Check:</strong> {step.completionCheck}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {props.result.completionChecks.length > 0 ? (
          <section className="completionPanel" aria-labelledby="completion-heading">
            <h2 id="completion-heading">You’re done when</h2>
            <ul>{props.result.completionChecks.map((check) => <li key={check}>{check}</li>)}</ul>
          </section>
        ) : null}

        {props.result.alternatives.length > 0 ? (
          <details className="detailsPanel guideDetails">
            <summary>Other approaches</summary>
            <ul>{props.result.alternatives.map((alternative) => <li key={`${alternative.title}:${alternative.tradeoff}`}><strong>{alternative.title}</strong><span>{alternative.tradeoff}</span></li>)}</ul>
          </details>
        ) : null}

        {props.result.evidence.length > 0 ? (
          <details className="detailsPanel guideDetails">
            <summary>Visible evidence</summary>
            <ul>{props.result.evidence.map((evidence) => <li key={`${evidence.claim}:${evidence.visibleSource || ""}`}><strong>{evidence.claim}</strong>{evidence.visibleSource ? <span>{evidence.visibleSource}</span> : null}</li>)}</ul>
          </details>
        ) : null}

        {props.result.sources.length > 0 ? (
          <details className="detailsPanel guideDetails">
            <summary>Provided page</summary>
            <div className="guideSources">{props.result.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}</a>)}</div>
          </details>
        ) : null}

        <div className="resultActions">
          {props.hasIdentification ? <button className="secondaryButton" onClick={props.onBackToIdentification}>Back to identification</button> : props.canIdentifyImage ? <button className="secondaryButton" onClick={props.onIdentifyImage}>Identify this image</button> : null}
          <button className="scanButton" onClick={props.onScanAnother}>Scan another</button>
        </div>
        <p className="sourceLine">This guide is temporary and is not added to Saved. Confirm safety-critical guidance independently.{props.requestId ? ` Reference: ${props.requestId}.` : ""}</p>
      </article>
    </section>
  );
}
