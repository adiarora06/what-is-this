"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { IdentifyResponse, ObjectCard } from "@/lib/types";
import { purchaseLinksFor } from "@/lib/links";

const STORAGE_KEY = "what-is-this-storyboard";

type ScanState = "idle" | "camera" | "scanning" | "identifying" | "done" | "error";

type FrameCandidate = {
  image: string;
  score: number;
};

function nowId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readStoryboard(): ObjectCard[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as ObjectCard[];
  } catch {
    return [];
  }
}

function writeStoryboard(cards: ObjectCard[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards.slice(0, 60)));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function scoreFrame(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return 0;

  const { width, height } = canvas;
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  let edgeScore = 0;
  let brightnessTotal = 0;
  let samples = 0;
  const stride = Math.max(8, Math.floor(Math.min(width, height) / 70));

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
  const exposurePenalty = Math.abs(132 - brightness) * 0.9;
  return edgeScore / Math.max(1, samples) - exposurePenalty;
}

function captureVideoFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): FrameCandidate | null {
  if (!video.videoWidth || !video.videoHeight) return null;

  const maxSide = 1100;
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);

  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  return {
    image: canvas.toDataURL("image/jpeg", 0.82),
    score: scoreFrame(canvas),
  };
}

function cardFromResponse(response: Extract<IdentifyResponse, { ok: true }>, image: string): ObjectCard {
  const purchaseQuery = response.card.purchaseQuery || response.card.objectName;
  return {
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
  };
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [holdSeconds, setHoldSeconds] = useState(3);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Ready when your object is.");
  const [context, setContext] = useState("");
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [card, setCard] = useState<ObjectCard | null>(null);
  const [storyboard, setStoryboard] = useState<ObjectCard[]>([]);
  const [saved, setSaved] = useState(false);
  const [hasShare, setHasShare] = useState(false);

  useEffect(() => {
    setStoryboard(readStoryboard());
    setHasShare(typeof navigator !== "undefined" && Boolean(navigator.share));

    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const canSave = useMemo(() => Boolean(card && !saved), [card, saved]);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
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
    if (!payload.ok) {
      throw new Error(payload.error);
    }

    const nextCard = cardFromResponse(payload, image);
    setCard(nextCard);
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
    setStatus(`Hold steady for ${holdSeconds} seconds.`);
    setCard(null);
    setSaved(false);

    const startedAt = Date.now();
    const durationMs = holdSeconds * 1000;
    const candidates: FrameCandidate[] = [];

    while (Date.now() - startedAt < durationMs) {
      const candidate = captureVideoFrame(videoRef.current, canvasRef.current);
      if (candidate) candidates.push(candidate);
      setProgress(clamp((Date.now() - startedAt) / durationMs, 0, 1));
      await new Promise((resolve) => setTimeout(resolve, 320));
    }

    const best = candidates.sort((a, b) => b.score - a.score)[0];
    if (!best) {
      setScanState("error");
      setStatus("I could not capture a usable frame.");
      return;
    }

    setCurrentImage(best.image);
    setProgress(1);

    try {
      await identify(best.image);
    } catch (error) {
      setScanState("error");
      setStatus(error instanceof Error ? error.message : "Identification failed.");
    }
  }

  function saveCard() {
    if (!card) return;
    const next = [card, ...storyboard.filter((item) => item.id !== card.id)];
    setStoryboard(next);
    writeStoryboard(next);
    setSaved(true);
  }

  function removeStoryboardItem(id: string) {
    const next = storyboard.filter((item) => item.id !== id);
    setStoryboard(next);
    writeStoryboard(next);
  }

  function clearStoryboard() {
    setStoryboard([]);
    writeStoryboard([]);
  }

  async function shareCard() {
    if (!card || !navigator.share) return;
    await navigator.share({
      title: card.objectName,
      text: `${card.objectName}: ${card.about}`,
      url: card.purchaseLinks[0]?.url,
    });
  }

  function loadUploadedImage(file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      const image = String(reader.result || "");
      setCurrentImage(image);
      try {
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
        <div className={`statusPill ${scanState === "error" ? "error" : ""}`}>{status}</div>
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
          <div className="guideBox">
            <span />
            <span />
            <span />
            <span />
          </div>
          {currentImage && <img className="capturePreview" src={currentImage} alt="Last captured object" />}
        </div>

        <canvas ref={canvasRef} hidden />

        <div className="controls">
          <button className="primaryButton" onClick={startCamera}>
            {streamRef.current ? "Restart Camera" : "Start Camera"}
          </button>
          <button className="scanButton" onClick={scanObject} disabled={scanState === "scanning" || scanState === "identifying"}>
            {scanState === "scanning" ? "Scanning..." : scanState === "identifying" ? "Thinking..." : "Scan Object"}
          </button>
          <button className="secondaryButton" onClick={() => fileInputRef.current?.click()}>
            Upload
          </button>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) loadUploadedImage(file);
              event.currentTarget.value = "";
            }}
          />
        </div>

        <label className="rangeField">
          <span>
            Hold duration <b>{holdSeconds}s</b>
          </span>
          <input
            type="range"
            min="2"
            max="5"
            step="1"
            value={holdSeconds}
            onChange={(event) => setHoldSeconds(Number(event.target.value))}
          />
        </label>

        <div className="progressTrack" aria-hidden="true">
          <div style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>

        <label className="contextBox">
          <span>Optional context</span>
          <textarea
            value={context}
            onChange={(event) => setContext(event.target.value)}
            placeholder="Example: identify the exact model if visible, or focus on kitchen use."
          />
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
            </div>
          </div>

          <div className="aboutCard">
            <h3>About Me</h3>
            <p>{card.about}</p>
          </div>

          <InfoList title="Visual clues" items={card.visualClues} />
          <InfoList title="Use cases" items={card.useCases} />
          <InfoList title="Care tips" items={card.careTips} />

          {card.safetyNote && <p className="safetyNote">{card.safetyNote}</p>}

          <div className="linkGrid">
            {card.purchaseLinks.map((link) => (
              <a key={link.label} href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ))}
          </div>

          <div className="controls stickyControls">
            <button className="primaryButton" onClick={saveCard} disabled={!canSave}>
              {saved ? "Saved" : "Save Later"}
            </button>
            <button className="secondaryButton" onClick={shareCard} disabled={!hasShare}>
              Share
            </button>
          </div>
        </section>
      )}

      <section className="storyboardPanel">
        <div className="sectionTitle">
          <div>
            <p className="eyebrow">Storyboard</p>
            <h2>Saved Objects</h2>
          </div>
          {storyboard.length > 0 && (
            <button className="textButton" onClick={clearStoryboard}>
              Clear
            </button>
          )}
        </div>

        {storyboard.length === 0 ? (
          <div className="emptyState">Saved objects appear here as a visual shopping or research board.</div>
        ) : (
          <div className="storyboardGrid">
            {storyboard.map((item) => (
              <article className="storyItem" key={item.id}>
                <img src={item.image} alt={item.objectName} />
                <div>
                  <strong>{item.shortName}</strong>
                  <span>{new Date(item.createdAt).toLocaleString()}</span>
                </div>
                <a href={item.purchaseLinks[0]?.url} target="_blank" rel="noreferrer">
                  Find
                </a>
                <button onClick={() => removeStoryboardItem(item.id)}>Remove</button>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function InfoList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;

  return (
    <section className="infoList">
      <h3>{title}</h3>
      <ul>
        {items.slice(0, 5).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
