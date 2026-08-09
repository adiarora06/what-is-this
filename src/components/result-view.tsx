import { confidenceLabel } from "@/lib/catalog-match";
import type { ObjectCard, StoryboardBoard } from "@/lib/types";

type Props = {
  card: ObjectCard;
  boards: StoryboardBoard[];
  selectedBoardId: string;
  newBoardName: string;
  correctionName: string;
  correctionCategory: string;
  correctionNotes: string;
  saveFeedbackPhotos: boolean;
  saved: boolean;
  isDemo?: boolean;
  onConfirm: () => void;
  onCorrect: () => void;
  onSave: () => void;
  onScanAnother: () => void;
  onShare: () => void;
  onIgnoreLearning: () => void;
  onSelectedBoard: (value: string) => void;
  onNewBoardName: (value: string) => void;
  onCorrectionName: (value: string) => void;
  onCorrectionCategory: (value: string) => void;
  onCorrectionNotes: (value: string) => void;
  onFeedbackPhotos: (value: boolean) => void;
  onTags: (value: string[]) => void;
};

export function ResultView(props: Props) {
  const confidence = confidenceLabel(props.card.confidence);
  return (
    <section className="viewStack resultView" aria-labelledby="result-heading">
      <button className="backButton" onClick={props.onScanAnother}>Back to camera</button>
      <article className="resultPanel">
        <header className="resultHero">
          {props.card.image && <img src={props.card.image} alt="Scanned object" />}
          <div>
            <p className="eyebrow">{props.isDemo ? "Example result" : "Identification"}</p>
            <h1 id="result-heading" tabIndex={-1}>{props.card.objectName}</h1>
            <div className="resultMeta">
              <span className={`confidenceBadge ${confidence.tone}`}>{confidence.label} · {Math.round(props.card.confidence * 100)}%</span>
              <span>{props.card.category}</span>
            </div>
          </div>
        </header>

        <div className="aboutCard">
          <h2>What it is</h2>
          <p>{props.card.about}</p>
          {confidence.tone === "possible" && <p className="lowConfidence">Try another angle or add a clue if the exact identity matters.</p>}
          {props.card.safetyNote && <p className="safetyNote"><strong>Safety:</strong> {props.card.safetyNote}</p>}
        </div>

        {props.card.learnedCorrection && (
          <section className="learningBanner" aria-labelledby="learning-heading">
            <div><h2 id="learning-heading">A learned correction was applied</h2><p>The model first suggested {props.card.learnedCorrection.originalObjectName}. This label came from a similar correction saved on this device.</p></div>
            <button className="secondaryButton" onClick={props.onIgnoreLearning}>Ignore this learning</button>
          </section>
        )}

        {(props.card.barcode || props.card.recognizedText?.length) && (
          <div className="assistCard">
            <strong>Extra clues found</strong>
            {props.card.barcode && <span>Barcode: {props.card.barcode}</span>}
            {props.card.recognizedText?.length ? <span>Text: {props.card.recognizedText.join(" · ")}</span> : null}
          </div>
        )}

        {props.isDemo ? (
          <section className="verificationPanel confirmed" aria-labelledby="verify-heading">
            <div>
              <h2 id="verify-heading">See the complete flow</h2>
              <p>This example is not saved and does not affect your learning history. Scan your own image to confirm, correct, and organize a real result.</p>
            </div>
            <button className="primaryButton" onClick={props.onScanAnother}>Scan your own image</button>
          </section>
        ) : <section className={`verificationPanel ${props.card.verified ? "confirmed" : ""}`} aria-labelledby="verify-heading">
          <div>
            <h2 id="verify-heading">{props.card.verified ? "Confirmed" : "Does this look right?"}</h2>
            <p>{props.card.verified ? "It is ready to save." : "Your confirmation improves future matches on this device."}</p>
          </div>
          {!props.card.verified && (
            <>
              <label className="feedbackConsent">
                <input type="checkbox" checked={props.saveFeedbackPhotos} onChange={(event) => props.onFeedbackPhotos(event.target.checked)} />
                <span><strong>Include a small photo with feedback</strong><small>Off by default. Without it, only the name and confidence are kept.</small></span>
              </label>
              <div className="verificationActions">
                <button className="primaryButton" onClick={props.onConfirm}>Yes, correct</button>
                <details className="correctionDisclosure">
                  <summary>Correct it</summary>
                  <div className="correctionPanel">
                    <label>Correct name<input maxLength={160} value={props.correctionName} onChange={(event) => props.onCorrectionName(event.target.value)} /></label>
                    <label>Category<input maxLength={120} value={props.correctionCategory} onChange={(event) => props.onCorrectionCategory(event.target.value)} /></label>
                    <label>Helpful note<textarea maxLength={500} value={props.correctionNotes} onChange={(event) => props.onCorrectionNotes(event.target.value)} /></label>
                    <button className="primaryButton" onClick={props.onCorrect} disabled={!props.correctionName.trim()}>Use correction</button>
                  </div>
                </details>
              </div>
            </>
          )}
        </section>}

        {props.card.verified && !props.isDemo && (
          <section className="savePanel" aria-labelledby="save-heading">
            <h2 id="save-heading">Save for later</h2>
            <div className="fieldRow">
              <label>Board<select value={props.selectedBoardId} onChange={(event) => props.onSelectedBoard(event.target.value)}>{props.boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select></label>
              <label>Or new board<input maxLength={80} value={props.newBoardName} onChange={(event) => props.onNewBoardName(event.target.value)} placeholder="e.g. Workshop" /></label>
            </div>
            <label>Tags<input maxLength={160} defaultValue={(props.card.tags || []).join(", ")} onBlur={(event) => props.onTags(event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 12))} placeholder="kitchen, repair" /></label>
            <button className="primaryButton" onClick={props.onSave} disabled={props.saved}>{props.saved ? "Saved" : "Save object"}</button>
          </section>
        )}

        <details className="detailsPanel">
          <summary>Clues, uses, and care</summary>
          <div className="detailColumns">
            <Info title="Visible clues" items={props.card.visualClues} />
            <Info title="Common uses" items={props.card.useCases} />
            <Info title="Care tips" items={props.card.careTips} />
          </div>
          {props.card.alternatives?.length ? <p className="alternatives"><strong>Other possibilities:</strong> {props.card.alternatives.map((item) => item.label).join(", ")}</p> : null}
        </details>

        {props.card.shoppingRecommended && props.card.purchaseLinks.length > 0 && (
          <details className="detailsPanel">
            <summary>Compare stores</summary>
            <p className="shoppingNote">These are search links, not endorsements. Verify the exact model before buying.</p>
            <div className="linkGrid">{props.card.purchaseLinks.map((link) => <a key={link.label} href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}</div>
          </details>
        )}

        <div className="resultActions">
          {!props.isDemo && <button className="secondaryButton" onClick={props.onShare}>Share result</button>}
          <button className="scanButton" onClick={props.onScanAnother}>{props.isDemo ? "Scan your own image" : "Scan another"}</button>
        </div>
        <p className="sourceLine">Source: {props.card.source || "vision provider"}. Always confirm safety-critical identifications independently.</p>
      </article>
    </section>
  );
}

function Info({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <section className="infoList"><h2>{title}</h2><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}
