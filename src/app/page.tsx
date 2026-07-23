"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { purchaseLinksFor } from "@/lib/links";
import type { CatalogEntry, IdentifyResponse, ObjectCard } from "@/lib/types";

const STORYBOARD_KEY = "what-is-this-storyboard";
const STORYBOARD_BOARDS_KEY = "what-is-this-storyboard-boards";
const CATALOG_KEY = "what-is-this-catalog";

type ScanState = "idle" | "camera" | "scanning" | "identifying" | "done" | "error";
type FrameCandidate = { image: string; score: number };
type BackendHealth = { ok: boolean; label: string; detail?: string };
type HealthPayload = {
  ok: boolean;
  accuracyProvider?: string;
  geminiConfigured?: boolean;
  backendConfigured?: boolean;
  backendError?: string;
  error?: string;
  backend?: {
    mode?: string;
    yoloModel?: string;
    classifierModel?: string;
  };
};
type StoryboardBoard = {
  id: string;
  name: string;
  createdAt: string;
  items: ObjectCard[];
};

function nowId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function defaultStoryboardBoards(): StoryboardBoard[] {
  const createdAt = new Date().toISOString();
  return [
    { id: "for-later", name: "For Later", createdAt, items: [] },
    { id: "shopping-ideas", name: "Shopping Ideas", createdAt, items: [] },
  ];
}

function readStoryboardBoards() {
  const boards = readStorage<StoryboardBoard[]>(STORYBOARD_BOARDS_KEY, []);
  if (boards.length) return boards;

  const oldStoryboard = readStorage<ObjectCard[]>(STORYBOARD_KEY, []);
  const defaults = defaultStoryboardBoards();
  if (oldStoryboard.length) {
    defaults[0] = { ...defaults[0], items: oldStoryboard };
  }
  writeStorage(STORYBOARD_BOARDS_KEY, defaults);
  return defaults;
}

function scoreFrame(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return 0;
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  const stride = Math.max(8, Math.floor(Math.min(width, height) / 70));
  let edgeScore = 0;
  let brightnessTotal = 0;
  let samples = 0;

  for (let y = stride; y < height - stride; y += stride) {
    for (let x = stride; x < width - stride; x += stride) {
      const i = (y * width + x) * 4;
      const right = (y * width + x + stride) * 4;
      const down = ((y + stride) * width + x) * 4;
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const rightGray = data[right] * 0.299 + data[right + 1] * 0.587 + data[right + 2] * 0.114;
      const downGray = data[down] * 0.299 + data[down + 1] * 0.587 + data[down + 2] * 0.114;
      edgeScore += Math.abs(gray - rightGray) + Math.abs(gray - downGray);
      brightnessTotal += gray;
      samples += 1;
    }
  }

  const brightness = brightnessTotal / Math.max(1, samples);
  return edgeScore / Math.max(1, samples) - Math.abs(132 - brightness) * 0.9;
}

function captureVideoFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): FrameCandidate | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const scale = Math.min(1, 1100 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return { image: canvas.toDataURL("image/jpeg", 0.82), score: scoreFrame(canvas) };
}

function labelsForCard(card: Pick<ObjectCard, "objectName" | "shortName" | "category" | "detections">) {
  return Array.from(
    new Set([card.objectName, card.shortName, card.category, ...(card.detections || []).map((item) => item.label)].map(normalizeText).filter(Boolean)),
  );
}

function applyCatalogCorrection(card: ObjectCard, catalog: CatalogEntry[]): ObjectCard {
  const labels = new Set(labelsForCard(card));
  const match = catalog.find((entry) => entry.matchLabels.some((label) => labels.has(normalizeText(label))));
  if (!match) return card;
  return {
    ...card,
    correctedFrom: card.objectName,
    objectName: match.objectName,
    shortName: match.objectName,
    category: match.category || card.category,
    about: match.notes || `Saved in your learning catalog as ${match.objectName}.`,
    purchaseQuery: match.objectName,
    purchaseLinks: purchaseLinksFor(match.objectName),
    visualClues: [`Matched your learning catalog from backend label "${card.objectName}".`, ...card.visualClues],
  };
}

function cardFromResponse(response: Extract<IdentifyResponse, { ok: true }>, image: string, catalog: CatalogEntry[]): ObjectCard {
  const purchaseQuery = response.card.purchaseQuery || response.card.objectName;
  return applyCatalogCorrection(
    {
      id: nowId(),
      createdAt: new Date().toISOString(),
      image,
      objectName: response.card.objectName,
      shortName: response.card.shortName,
      confidence: response.card.confidence,
      category: response.card.category,
      about: response.card.about,
      visualClues: response.card.visualClues,
      useCases: response.card.useCases,
      careTips: response.card.careTips,
      purchaseQuery,
      purchaseLinks: response.card.purchaseLinks?.length ? response.card.purchaseLinks : purchaseLinksFor(purchaseQuery),
      safetyNote: response.card.safetyNote,
      source: response.card.source,
      detections: response.card.detections,
      alternatives: response.card.alternatives,
    },
    catalog,
  );
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const storyboardSectionRef = useRef<HTMLElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [holdSeconds, setHoldSeconds] = useState(3);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Ready when your object is.");
  const [context, setContext] = useState("");
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [card, setCard] = useState<ObjectCard | null>(null);
  const [storyboardBoards, setStoryboardBoards] = useState<StoryboardBoard[]>([]);
  const [activeBoardId, setActiveBoardId] = useState("for-later");
  const [selectedBoardId, setSelectedBoardId] = useState("for-later");
  const [newBoardName, setNewBoardName] = useState("");
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [correctionName, setCorrectionName] = useState("");
  const [correctionCategory, setCorrectionCategory] = useState("");
  const [correctionNotes, setCorrectionNotes] = useState("");
  const [saved, setSaved] = useState(false);
  const [hasShare, setHasShare] = useState(false);
  const [backendHealth, setBackendHealth] = useState<BackendHealth>({ ok: false, label: "Checking CV backend..." });

  useEffect(() => {
    let cancelled = false;
    const savedBoards = readStoryboardBoards();
    setStoryboardBoards(savedBoards);
    setActiveBoardId(savedBoards[0]?.id || "for-later");
    setSelectedBoardId(savedBoards[0]?.id || "for-later");
    setCatalog(readStorage<CatalogEntry[]>(CATALOG_KEY, []));
    setHasShare(typeof navigator !== "undefined" && Boolean(navigator.share));

    async function checkBackend() {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const payload = (await response.json()) as HealthPayload;
        if (cancelled) return;
        const provider = (payload.accuracyProvider || "auto").toLowerCase();
        const backendDetail = [payload.backend?.mode, payload.backend?.yoloModel, payload.backend?.classifierModel].filter(Boolean).join(" + ");
        if (payload.geminiConfigured && provider !== "classifier" && provider !== "cv") {
          setBackendHealth({
            ok: true,
            label: "Gemini vision ready",
            detail: backendDetail ? `Classifier fallback: ${backendDetail}` : payload.backendError,
          });
          return;
        }
        if (!payload.ok) {
          setBackendHealth({ ok: false, label: "Classifier offline", detail: payload.error || payload.backendError });
          return;
        }
        setBackendHealth({
          ok: true,
          label: "Classifier online",
          detail: backendDetail,
        });
      } catch (error) {
        if (!cancelled) {
          setBackendHealth({ ok: false, label: "Vision status unavailable", detail: error instanceof Error ? error.message : undefined });
        }
      }
    }

    void checkBackend();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const activeBoard = useMemo(
    () => storyboardBoards.find((board) => board.id === activeBoardId) || storyboardBoards[0],
    [activeBoardId, storyboardBoards],
  );
  const selectedBoard = useMemo(
    () => storyboardBoards.find((board) => board.id === selectedBoardId) || storyboardBoards[0],
    [selectedBoardId, storyboardBoards],
  );
  const totalSavedObjects = useMemo(() => storyboardBoards.reduce((sum, board) => sum + board.items.length, 0), [storyboardBoards]);
  const canSave = useMemo(() => Boolean(card && !saved), [card, saved]);
  const canCorrect = useMemo(() => Boolean(card && correctionName.trim()), [card, correctionName]);

  function persistStoryboardBoards(nextBoards: StoryboardBoard[]) {
    setStoryboardBoards(nextBoards);
    writeStorage(STORYBOARD_BOARDS_KEY, nextBoards);
  }

  function createStoryboardBoard(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = storyboardBoards.find((board) => normalizeText(board.name) === normalizeText(trimmed));
    if (existing) return existing;
    return {
      id: nowId(),
      name: trimmed,
      createdAt: new Date().toISOString(),
      items: [],
    };
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanState("camera");
      setStatus("Hold one object in the guide and tap Scan.");
    } catch (error) {
      setScanState("error");
      setStatus(error instanceof Error ? error.message : "Camera permission was not granted.");
    }
  }

  async function identify(image: string) {
    setScanState("identifying");
    setStatus("Identifying the object...");
    setSaved(false);
    const response = await fetch("/api/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image, context: context.trim() || undefined }),
    });
    const payload = (await response.json()) as IdentifyResponse;
    if (!payload.ok) throw new Error(payload.error);
    const nextCard = cardFromResponse(payload, image, catalog);
    setCard(nextCard);
    setCorrectionName(nextCard.objectName);
    setCorrectionCategory(nextCard.category);
    setCorrectionNotes("");
    setCurrentImage(image);
    setScanState("done");
    setStatus(`Found: ${nextCard.shortName}`);
  }

  async function scanObject() {
    if (!videoRef.current || !canvasRef.current) {
      setStatus("Start the camera first.");
      return;
    }
    setScanState("scanning");
    setProgress(0);
    setCard(null);
    setSaved(false);
    const startedAt = Date.now();
    const durationMs = holdSeconds * 1000;
    const candidates: FrameCandidate[] = [];
    while (Date.now() - startedAt < durationMs) {
      const candidate = captureVideoFrame(videoRef.current, canvasRef.current);
      if (candidate) candidates.push(candidate);
      setProgress(Math.min(1, (Date.now() - startedAt) / durationMs));
      await new Promise((resolve) => setTimeout(resolve, 320));
    }
    const best = candidates.sort((a, b) => b.score - a.score)[0];
    if (!best) {
      setScanState("error");
      setStatus("I could not capture a usable frame.");
      return;
    }
    try {
      setCurrentImage(best.image);
      setProgress(1);
      await identify(best.image);
    } catch (error) {
      setScanState("error");
      setStatus(error instanceof Error ? error.message : "Identification failed.");
    }
  }

  function saveCard() {
    if (!card) return;
    const newBoard = createStoryboardBoard(newBoardName);
    const targetBoardId = newBoard?.id || selectedBoard?.id || "for-later";
    const baseBoards = storyboardBoards.length ? storyboardBoards : defaultStoryboardBoards();
    const workingBoards = newBoard ? [...baseBoards, newBoard] : baseBoards;
    const nextBoards = workingBoards.map((board) =>
      board.id === targetBoardId
        ? { ...board, items: [card, ...board.items.filter((item) => item.id !== card.id)].slice(0, 80) }
        : board,
    );

    persistStoryboardBoards(nextBoards);
    setSelectedBoardId(targetBoardId);
    setActiveBoardId(targetBoardId);
    setNewBoardName("");
    setSaved(true);
    setStatus(`Saved to ${newBoard?.name || selectedBoard?.name || "For Later"}.`);
  }

  function showSelectedStoryboard() {
    setActiveBoardId(selectedBoardId);
    window.setTimeout(() => storyboardSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function removeStoryboardItem(boardId: string, itemId: string) {
    persistStoryboardBoards(
      storyboardBoards.map((board) =>
        board.id === boardId ? { ...board, items: board.items.filter((item) => item.id !== itemId) } : board,
      ),
    );
  }

  function clearActiveBoard() {
    if (!activeBoard) return;
    persistStoryboardBoards(
      storyboardBoards.map((board) => (board.id === activeBoard.id ? { ...board, items: [] } : board)),
    );
  }

  function saveCorrection() {
    if (!card || !correctionName.trim()) return;
    const correctedName = correctionName.trim();
    const correctedCategory = correctionCategory.trim() || card.category;
    const now = new Date().toISOString();
    const entry: CatalogEntry = {
      id: nowId(),
      createdAt: now,
      updatedAt: now,
      objectName: correctedName,
      category: correctedCategory,
      notes: correctionNotes.trim(),
      matchLabels: Array.from(new Set([...labelsForCard(card), normalizeText(correctedName)])).filter(Boolean),
      image: card.image,
    };
    const nextCatalog = [entry, ...catalog.filter((item) => item.objectName !== correctedName)].slice(0, 150);
    setCatalog(nextCatalog);
    writeStorage(CATALOG_KEY, nextCatalog);
    setCard({
      ...card,
      correctedFrom: card.correctedFrom || card.objectName,
      objectName: correctedName,
      shortName: correctedName,
      category: correctedCategory,
      about: correctionNotes.trim() || card.about,
      purchaseQuery: correctedName,
      purchaseLinks: purchaseLinksFor(correctedName),
      visualClues: [`Saved to your learning catalog as ${correctedName}.`, ...card.visualClues],
    });
    setStatus(`Saved correction: ${correctedName}`);
  }

  function exportCatalog() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), entries: catalog }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "what-is-this-catalog.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function shareCard() {
    if (!card || !navigator.share) return;
    await navigator.share({ title: card.objectName, text: `${card.objectName}: ${card.about}`, url: card.purchaseLinks[0]?.url });
  }

  function loadUploadedImage(file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      const image = String(reader.result || "");
      try {
        setCurrentImage(image);
        await identify(image);
      } catch (error) {
        setScanState("error");
        setStatus(error instanceof Error ? error.message : "Identification failed.");
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <main className="appShell">
      <section className="heroBand">
        <div>
          <p className="eyebrow">What Is This?</p>
          <h1>Point your phone at one object. Hold still. Get the name, story, and where to find it.</h1>
        </div>
        <div className="heroStatus">
          <div className={`backendPill ${backendHealth.ok ? "" : "offline"}`} title={backendHealth.detail}>
            {backendHealth.label}
          </div>
          <div className={`statusPill ${scanState === "error" ? "error" : ""}`}>{status}</div>
        </div>
      </section>

      <section className="cameraPanel">
        <div className="cameraStage">
          <video ref={videoRef} playsInline muted autoPlay />
          {!streamRef.current && (
            <div className="cameraEmpty">
              <strong>Use the rear camera</strong>
              <span>Best with one object centered, good light, and a plain-ish background.</span>
            </div>
          )}
          <div className="guideBox"><span /><span /><span /><span /></div>
          {currentImage && <img className="capturePreview" src={currentImage} alt="Last captured object" />}
        </div>
        <canvas ref={canvasRef} hidden />
        <div className="controls">
          <button className="primaryButton" onClick={startCamera}>{streamRef.current ? "Restart Camera" : "Start Camera"}</button>
          <button className="scanButton" onClick={scanObject} disabled={scanState === "scanning" || scanState === "identifying"}>
            {scanState === "scanning" ? "Scanning..." : scanState === "identifying" ? "Thinking..." : "Scan Object"}
          </button>
          <button className="secondaryButton" onClick={() => fileInputRef.current?.click()}>Upload</button>
          <input ref={fileInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) loadUploadedImage(file);
            event.currentTarget.value = "";
          }} />
        </div>
        <label className="rangeField">
          <span>Hold duration <b>{holdSeconds}s</b></span>
          <input type="range" min="2" max="5" step="1" value={holdSeconds} onChange={(event) => setHoldSeconds(Number(event.target.value))} />
        </label>
        <div className="progressTrack" aria-hidden="true"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        <label className="contextBox">
          <span>Optional context</span>
          <textarea value={context} onChange={(event) => setContext(event.target.value)} placeholder="Example: identify exact model if visible." />
        </label>
      </section>

      {card && (
        <section className="resultPanel">
          <div className="resultHeader">
            <img src={card.image} alt={card.objectName} />
            <div>
              <p className="eyebrow">{card.category}</p>
              <h2>{card.objectName}</h2>
              <span>{Math.round(card.confidence * 100)}% confidence</span>
              {card.source && <span className="sourceBadge">{card.source}</span>}
              {card.correctedFrom && <span className="sourceBadge">corrected from {card.correctedFrom}</span>}
            </div>
          </div>
          <div className="aboutCard"><h3>About Me</h3><p>{card.about}</p></div>
          <InfoList title="Visual clues" items={card.visualClues} />
          <InfoList title="Backend detections" items={(card.detections || []).slice(0, 4).map((item) => `${item.label} (${Math.round(item.confidence * 100)}%)`)} />
          <InfoList title="Alternative matches" items={(card.alternatives || []).slice(0, 5).map((item) => `${item.label} (${Math.round(item.confidence * 100)}%)`)} />
          <InfoList title="Use cases" items={card.useCases} />
          <InfoList title="Care tips" items={card.careTips} />
          {card.safetyNote && <p className="safetyNote">{card.safetyNote}</p>}
          <section className="correctionPanel">
            <div><p className="eyebrow">Teach It</p><h3>Correct this result</h3></div>
            <label><span>Correct object name</span><input value={correctionName} onChange={(event) => setCorrectionName(event.target.value)} /></label>
            <label><span>Category</span><input value={correctionCategory} onChange={(event) => setCorrectionCategory(event.target.value)} /></label>
            <label><span>Notes for future cards</span><textarea value={correctionNotes} onChange={(event) => setCorrectionNotes(event.target.value)} placeholder="Example: This is my Logitech MX Master 3S mouse." /></label>
            <button className="primaryButton" onClick={saveCorrection} disabled={!canCorrect}>Save Correction To Catalog</button>
          </section>
          <div className="linkGrid">{card.purchaseLinks.map((link) => <a key={link.label} href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}</div>
          <section className="savePanel">
            <div>
              <p className="eyebrow">Save For Later</p>
              <h3>Add this scan to a storyboard</h3>
            </div>
            <label>
              <span>Choose storyboard</span>
              <select value={selectedBoardId} onChange={(event) => { setSelectedBoardId(event.target.value); setSaved(false); }}>
                {storyboardBoards.map((board) => (
                  <option key={board.id} value={board.id}>{board.name} ({board.items.length})</option>
                ))}
              </select>
            </label>
            <label>
              <span>Or make a new one</span>
              <input value={newBoardName} onChange={(event) => { setNewBoardName(event.target.value); setSaved(false); }} placeholder="Example: Gift ideas, Desk setup, Try on later" />
            </label>
            <button className="primaryButton" onClick={saveCard} disabled={!canSave}>{saved ? "Saved" : `Save to ${newBoardName.trim() || selectedBoard?.name || "For Later"}`}</button>
          </section>
          <div className="controls stickyControls">
            <button className="primaryButton" onClick={showSelectedStoryboard} disabled={!storyboardBoards.length}>View Storyboard</button>
            <button className="secondaryButton" onClick={shareCard} disabled={!hasShare}>Share</button>
          </div>
        </section>
      )}

      <section className="catalogPanel">
        <div className="sectionTitle">
          <div><p className="eyebrow">Learning Catalog</p><h2>Corrections</h2></div>
          {catalog.length > 0 && <button className="textButton" onClick={exportCatalog}>Export</button>}
        </div>
        {catalog.length === 0 ? <div className="emptyState">Correct a result once and the app will reuse that saved label when similar backend labels appear.</div> : (
          <div className="catalogGrid">{catalog.map((item) => (
            <article className="catalogItem" key={item.id}>
              {item.image && <img src={item.image} alt={item.objectName} />}
              <div><strong>{item.objectName}</strong><span>{item.category}</span><small>{item.matchLabels.slice(0, 4).join(", ")}</small></div>
              <button onClick={() => {
                const next = catalog.filter((entry) => entry.id !== item.id);
                setCatalog(next);
                writeStorage(CATALOG_KEY, next);
              }}>Remove</button>
            </article>
          ))}</div>
        )}
      </section>

      <section className="storyboardPanel" ref={storyboardSectionRef}>
        <div className="sectionTitle">
          <div><p className="eyebrow">Storyboards</p><h2>Saved Objects</h2></div>
          {activeBoard && activeBoard.items.length > 0 && <button className="textButton" onClick={clearActiveBoard}>Clear Board</button>}
        </div>
        <div className="boardTabs" aria-label="Saved object storyboards">
          {storyboardBoards.map((board) => (
            <button className={board.id === activeBoard?.id ? "active" : ""} key={board.id} onClick={() => setActiveBoardId(board.id)}>
              {board.name}<span>{board.items.length}</span>
            </button>
          ))}
        </div>
        {totalSavedObjects === 0 ? <div className="emptyState">Upload or scan an object, then save it to a shopping, research, or for-later storyboard.</div> : activeBoard && activeBoard.items.length === 0 ? (
          <div className="emptyState">No objects saved to {activeBoard.name} yet.</div>
        ) : activeBoard && (
          <div className="storyboardGrid">{activeBoard.items.map((item) => (
            <article className="storyItem" key={item.id}>
              <img src={item.image} alt={item.objectName} />
              <div><strong>{item.shortName}</strong><span>{new Date(item.createdAt).toLocaleString()}</span></div>
              <a href={item.purchaseLinks[0]?.url} target="_blank" rel="noreferrer">Shop</a>
              <button onClick={() => removeStoryboardItem(activeBoard.id, item.id)}>Remove</button>
            </article>
          ))}</div>
        )}
      </section>
    </main>
  );
}

function InfoList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <section className="infoList"><h3>{title}</h3><ul>{items.slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ul></section>;
}
