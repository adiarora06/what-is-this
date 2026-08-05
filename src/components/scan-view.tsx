import type { RefObject } from "react";

type ScanState = "idle" | "camera" | "scanning" | "identifying" | "done" | "error";

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  turnstileContainerRef: RefObject<HTMLDivElement | null>;
  currentImage: string | null;
  scanState: ScanState;
  cameraReady: boolean;
  progress: number;
  holdSeconds: number;
  context: string;
  securityNeeded: boolean;
  securityReady: boolean;
  privacyMode: "device" | "remote";
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
};

export function ScanView(props: Props) {
  const busy = props.scanState === "scanning" || props.scanState === "identifying";
  return (
    <section className="viewStack" aria-labelledby="scan-heading">
      <header className="viewIntro">
        <p className="eyebrow">Point. Scan. Know.</p>
        <h1 id="scan-heading" tabIndex={-1}>What is this?</h1>
        <p>Take one clear photo. You will confirm the answer before anything is saved.</p>
      </header>

      <div className="cameraPanel">
        <div className="cameraStage">
          <video ref={props.videoRef} playsInline muted aria-label="Live camera preview" />
          {props.currentImage && props.scanState !== "camera" && <img className="capturePreview" src={props.currentImage} alt="Object selected for identification" />}
          {!props.cameraReady && !props.currentImage && (
            <div className="cameraEmpty">
              <strong>Place one object in view</strong>
              <span>Good light and a plain background give the clearest result.</span>
            </div>
          )}
          {props.cameraReady && <div className="guideBox" aria-hidden="true"><span /><span /><span /><span /></div>}
        </div>

        <div className="cameraSidebar">
          <div className="privacyStrip">
            <strong>{props.privacyMode === "device" ? "Private on this device" : "Cloud recognition"}</strong>
            <span>{props.privacyMode === "device" ? "Your image stays in this browser." : "Your image is sent securely for identification, then discarded."}</span>
          </div>

          <div className="scanActions">
            {!props.cameraReady ? (
              <button className="primaryButton" onClick={props.onStartCamera} disabled={busy}>Use camera</button>
            ) : (
              <button className="scanButton" onClick={props.onScan} disabled={busy || !props.securityReady}>
                {props.scanState === "scanning" ? "Finding best frame…" : props.scanState === "identifying" ? "Identifying…" : "Scan object"}
              </button>
            )}
            <button className="secondaryButton" onClick={props.onUpload} disabled={busy}>Upload photo</button>
            {props.cameraReady && <button className="textButton" onClick={props.onStartCamera} disabled={busy}>Restart camera</button>}
          </div>

          <input
            ref={props.fileInputRef}
            className="srOnly"
            type="file"
            accept="image/jpeg,image/png,image/webp"
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
              <p>Your photo is still private. Retry here or change recognition mode.</p>
              <div className="buttonRow">
                <button className="primaryButton" onClick={props.onRetry} disabled={!props.canRetry}>Retry</button>
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
            <summary>Improve this scan</summary>
            <label className="rangeField">
              <span>Hold steady <strong>{props.holdSeconds}s</strong></span>
              <input type="range" min="1" max="5" value={props.holdSeconds} onChange={(event) => props.onHoldSeconds(Number(event.target.value))} />
            </label>
            <label className="contextBox">
              Optional clue
              <textarea maxLength={500} value={props.context} onChange={(event) => props.onContext(event.target.value)} placeholder="Where did you find it? What does it connect to?" />
              <small>{props.context.length}/500</small>
            </label>
          </details>
        </div>
      </div>
    </section>
  );
}
