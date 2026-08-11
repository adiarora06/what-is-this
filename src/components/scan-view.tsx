import type { RefObject } from "react";
import { GUIDE_INTENT_DETAILS, guideGoalRequired } from "@/lib/guide-client";
import { GUIDE_INTENTS, type GuideIntent } from "@/lib/guide-contract";

type ScanState = "idle" | "camera" | "scanning" | "identifying" | "done" | "error";

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  turnstileContainerRef: RefObject<HTMLDivElement | null>;
  currentImage: string | null;
  currentImageIsReferenceOnly?: boolean;
  scanState: ScanState;
  cameraReady: boolean;
  progress: number;
  holdSeconds: number;
  context: string;
  intent: GuideIntent;
  goal: string;
  goalError?: string;
  guideBlockedReason?: string;
  securityNeeded: boolean;
  securityReady: boolean;
  privacyMode: "device" | "remote";
  cloudProcessorLabel: string;
  modelMessage?: string;
  canRetry: boolean;
  onStartCamera: () => void;
  onScan: () => void;
  onUpload: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
  onFile: (file?: File) => void;
  onHoldSeconds: (value: number) => void;
  onContext: (value: string) => void;
  onIntent: (value: GuideIntent) => void;
  onGoal: (value: string) => void;
  onUseCurrentImage: () => void;
  onCancelGuideSetup?: () => void;
};

export function ScanView(props: Props) {
  const busy = props.scanState === "scanning" || props.scanState === "identifying";
  const guideMode = props.intent !== "identify";
  const imageEntryBlocked = guideMode && Boolean(props.guideBlockedReason);
  const metadataOnlySource = guideMode && Boolean(props.currentImageIsReferenceOnly);
  const intentDetails = GUIDE_INTENT_DETAILS[props.intent];
  const actionLabel = props.scanState === "scanning"
    ? "Finding best frame…"
    : props.scanState === "identifying"
      ? guideMode ? "Creating guide…" : "Identifying…"
      : guideMode ? intentDetails.action : "Scan object";
  const privacyHeading = imageEntryBlocked
    ? "Image not sent in this mode"
    : metadataOnlySource
      ? `Confirmed details only · ${props.cloudProcessorLabel}`
      : props.privacyMode === "device"
        ? "Private on this device"
        : `Cloud processing · ${props.cloudProcessorLabel}`;
  const privacyDescription = imageEntryBlocked
    ? "This screen will not send an image while guidance is unavailable."
    : metadataOnlySource
      ? `The stored preview is not re-uploaded. Confirmed text details, your goal, and context you add are sent securely to ${props.cloudProcessorLabel}. This app does not retain the request after processing; the selected service handles it under its own data policy.`
      : props.privacyMode === "device"
        ? "Your image stays in this browser."
        : `Your image is sent securely to ${props.cloudProcessorLabel} for ${guideMode ? "guided help" : "identification"}. This app does not retain the request after processing; the selected service handles it under its own data policy.`;
  return (
    <section className="viewStack scanView" aria-labelledby="scan-heading">
      {guideMode && props.onCancelGuideSetup ? (
        <button className="backButton" type="button" onClick={props.onCancelGuideSetup}>Back to identification</button>
      ) : null}

      <header className="viewIntro">
        <p className="eyebrow">{guideMode ? "See it. Understand it. Act." : "Point. Scan. Know."}</p>
        <h1 id="scan-heading" tabIndex={-1}>{guideMode ? "Get help from a photo" : "What is this?"}</h1>
        <p>{guideMode ? "Use one clear image, choose the outcome, and add context when it helps." : "Take one clear photo. You will confirm the answer before anything is saved."}</p>
      </header>

      <section className="intentPanel" aria-labelledby="intent-heading">
        <div className="sectionHeading">
          <div><p className="eyebrow">Choose the outcome</p><h2 id="intent-heading">What do you need?</h2></div>
        </div>
        <div className="intentGrid" role="group" aria-labelledby="intent-heading">
          {GUIDE_INTENTS.map((intent) => (
            <button
              key={intent}
              type="button"
              className={props.intent === intent ? "active" : ""}
              aria-pressed={props.intent === intent}
              disabled={busy}
              onClick={() => props.onIntent(intent)}
            >
              <strong>{GUIDE_INTENT_DETAILS[intent].label}</strong>
              <span>{GUIDE_INTENT_DETAILS[intent].description}</span>
            </button>
          ))}
        </div>

        {guideMode ? (
          <label className="guideGoalField" htmlFor="guide-goal">
            <span>{intentDetails.goalLabel}{guideGoalRequired(props.intent) ? " *" : ""}</span>
            <textarea
              id="guide-goal"
              maxLength={500}
              required={guideGoalRequired(props.intent)}
              disabled={busy}
              aria-invalid={Boolean(props.goalError)}
              aria-describedby={props.goalError ? "guide-goal-help guide-goal-error" : "guide-goal-help"}
              value={props.goal}
              onChange={(event) => props.onGoal(event.target.value)}
              placeholder={props.intent === "compare" ? "Example: Compare it with the newer model for travel use." : "Describe the result you want."}
            />
            <small id="guide-goal-help">{intentDetails.goalHelp} · {props.goal.length}/500</small>
            {props.goalError ? <span id="guide-goal-error" className="inlineError" role="alert">{props.goalError}</span> : null}
          </label>
        ) : null}

        {guideMode && props.guideBlockedReason ? (
          <div className="guidePrivacyNotice" role="note">
            <div>
              <strong>Guided answers are not enabled in this mode</strong>
              <span>{props.guideBlockedReason}</span>
              <span className="guidePrivacyAssurance">This screen will not send an image while guidance is unavailable.</span>
            </div>
            <button className="secondaryButton" type="button" onClick={props.onOpenSettings}>Open Settings</button>
          </div>
        ) : null}
      </section>

      <div className="cameraPanel">
        <div className="cameraStage">
          <video ref={props.videoRef} playsInline muted aria-label="Live camera preview" />
          {props.currentImage && props.scanState !== "camera" && <img className="capturePreview" src={props.currentImage} alt={metadataOnlySource ? "Cloud-saved preview; not included in the guide request" : guideMode ? "Image selected for guided help" : "Object selected for identification"} />}
          {!props.cameraReady && !props.currentImage && (
            <div className="cameraEmpty">
              <strong>{metadataOnlySource ? "Confirmed details ready" : "Place one object in view"}</strong>
              <span>{metadataOnlySource ? "No stored preview will be re-uploaded. Add a new photo only if visual detail matters." : "Good light and a plain background give the clearest result."}</span>
            </div>
          )}
          {props.cameraReady && <div className="guideBox" aria-hidden="true"><span /><span /><span /><span /></div>}
        </div>

        <div className="cameraSidebar">
          <div className="privacyStrip">
            <strong>{privacyHeading}</strong>
            <span>{privacyDescription}</span>
          </div>

          <div className="scanActions">
            {(props.currentImage || metadataOnlySource) && !props.cameraReady && props.scanState !== "error" ? (
              <button className="primaryButton" onClick={props.onUseCurrentImage} disabled={busy || !props.securityReady || imageEntryBlocked}>{metadataOnlySource ? "Use confirmed details (no image sent)" : guideMode ? `Use this image to ${intentDetails.label.toLowerCase()}` : "Identify this image"}</button>
            ) : !props.cameraReady ? (
              <button className="primaryButton" onClick={props.onStartCamera} disabled={busy || imageEntryBlocked}>Use camera</button>
            ) : (
              <button className="scanButton" onClick={props.onScan} disabled={busy || !props.securityReady || imageEntryBlocked}>
                {actionLabel}
              </button>
            )}
            <button className="secondaryButton" onClick={props.onUpload} disabled={busy || !props.securityReady || imageEntryBlocked}>Upload photo</button>
            {props.cameraReady && <button className="textButton" onClick={props.onStartCamera} disabled={busy || imageEntryBlocked}>Restart camera</button>}
          </div>

          <input
            ref={props.fileInputRef}
            className="srOnly"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy || !props.securityReady || imageEntryBlocked}
            onChange={(event) => {
              props.onFile(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <canvas ref={props.canvasRef} className="srOnly" aria-hidden="true" />

          {busy && <><div className="progressTrack" aria-label="Scan progress" role="progressbar" aria-valuenow={Math.round(props.progress * 100)}><div style={{ width: `${Math.round(props.progress * 100)}%` }} /></div>{props.modelMessage && <p className="modelProgressText">{props.modelMessage}</p>}</>}

          {props.scanState === "error" && (
            <section className="recoveryPanel" aria-labelledby="scan-error-heading">
              <h2 id="scan-error-heading" tabIndex={-1}>The scan needs attention</h2>
              <p>The selected photo is still available. Retry here or change recognition mode.</p>
              <div className="buttonRow">
                <button className="primaryButton" onClick={props.onRetry} disabled={!props.canRetry || imageEntryBlocked}>Retry</button>
                <button className="secondaryButton" onClick={props.onOpenSettings}>Open Settings</button>
              </div>
            </section>
          )}

          {props.securityNeeded && (
            <div className="securityCheck">
              <span>{props.securityReady ? "Security check complete" : "Complete the security check to use cloud recognition"}</span>
              <div ref={props.turnstileContainerRef} />
            </div>
          )}

          <details className="advancedPanel">
            <summary>{guideMode ? "Add more context" : "Improve this scan"}</summary>
            <label className="rangeField">
              <span>Hold steady <strong>{props.holdSeconds}s</strong></span>
              <input type="range" min="1" max="5" value={props.holdSeconds} disabled={busy} onChange={(event) => props.onHoldSeconds(Number(event.target.value))} />
            </label>
            <label className="contextBox">
              {guideMode ? "Optional visible context" : "Optional clue"}
              <textarea maxLength={500} value={props.context} disabled={busy} onChange={(event) => props.onContext(event.target.value)} placeholder={guideMode ? "Add a visible label, current state, or detail from the image." : "Where did you find it? What does it connect to?"} />
              <small>{props.context.length}/500</small>
            </label>
          </details>
        </div>
      </div>
    </section>
  );
}
