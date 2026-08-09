"use client";

import dynamic from "next/dynamic";
import Script from "next/script";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppNavigation, type AppView } from "@/components/app-navigation";
import { GuideResultView } from "@/components/guide-result-view";
import { ResultView } from "@/components/result-view";
import { SavedView } from "@/components/saved-view";
import { ScanView } from "@/components/scan-view";
import { mergeBoards } from "@/lib/board-merge";
import { applyCatalogCorrection, findDuplicateCard, ignoreCatalogCorrection } from "@/lib/catalog-match";
import {
  buildWebGuideRequest,
  clarificationContext,
  guideContextForCard,
  guideGoalRequired,
  guideOperationKey,
  guideProviderAvailableForChoice,
  GuideGoalRequiredError,
  GuidePrivacyBoundaryError,
  GuideRequestError,
  isGuideImageDataUrl,
  type GuideRemoteProvider,
} from "@/lib/guide-client";
import {
  captureVideoFrame,
  fileAsDataUrl,
  imageFingerprint,
  imageVisualSignature,
  isAbortError,
  makeFeedbackThumbnail,
  MAX_UPLOAD_FILE_BYTES,
  normalizeText,
  resizeImageDataUrl,
  SUPPORTED_UPLOAD_TYPES,
  waitForVideoReady,
} from "@/lib/image-tools";
import {
  clearLocalData,
  defaultPreferences,
  defaultStoryboardBoards,
  loadLocalData,
  parseBackup,
  saveBoards,
  saveCatalog,
  saveFeedback,
  saveLocalData,
  savePreferences,
  type LocalData,
  type LocalPreferences,
} from "@/lib/local-store";
import { purchaseLinksFor, shoppingRecommendedForCategory } from "@/lib/links";
import { friendlyCloudStatus, friendlyGuideError, friendlyScanError, guideErrorReference } from "@/lib/public-error";
import { demoCard } from "@/lib/demo-card";
import type { AccuracyFeedback, CatalogEntry, GuideIntent, GuideResult, IdentificationProvider, IdentifyResponse, ObjectCard, StoryboardBoard } from "@/lib/types";

const SettingsView = dynamic(() => import("@/components/settings-view"), {
  loading: () => <div className="settingsPanel"><p>Opening settings…</p></div>,
});

type ScanState = "idle" | "camera" | "scanning" | "identifying" | "done" | "error";
type FeedbackChoice = "correct" | "incorrect";
type BackendHealth = { ok: boolean; label: string; detail?: string };
type CloudUser = { id: string; email?: string } | null;
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type ActionableGuideIntent = Exclude<GuideIntent, "identify">;
type GuideRequestSnapshot = {
  intent: ActionableGuideIntent;
  goal: string;
  pageContext: string;
  title?: string;
  image?: string;
  sourceKey: string;
};

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: { sitekey: string; action: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

function nowId() {
  return `${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(16).slice(2)}`;
}

async function cardFromResponse(
  response: Extract<IdentifyResponse, { ok: true }>,
  image: string,
  catalog: CatalogEntry[],
  assist: { barcode?: string; recognizedText?: string[] },
) {
  const purchaseQuery = response.card.purchaseQuery || response.card.objectName;
  const shoppingRecommended = response.card.shoppingRecommended ?? shoppingRecommendedForCategory(response.card.category);
  const [fingerprint, visualSignature] = await Promise.all([imageFingerprint(image), imageVisualSignature(image)]);
  const card: ObjectCard = {
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
    purchaseLinks: shoppingRecommended
      ? response.card.purchaseLinks?.length
        ? response.card.purchaseLinks
        : purchaseLinksFor(purchaseQuery)
      : [],
    shoppingRecommended,
    verified: false,
    safetyNote: response.card.safetyNote,
    source: response.card.source || response.provider,
    detections: response.card.detections,
    alternatives: response.card.alternatives,
    barcode: assist.barcode,
    recognizedText: assist.recognizedText,
    visualSignature,
  };
  return applyCatalogCorrection(card, catalog, fingerprint, visualSignature);
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const identifyTurnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const guideTurnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const identifyTurnstileWidgetRef = useRef<string | null>(null);
  const guideTurnstileWidgetRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureSequenceRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const guideControllerRef = useRef<AbortController | null>(null);
  const guideSequenceRef = useRef(0);
  const guideSourceKeyRef = useRef("");
  const lastGuideRequestRef = useRef<GuideRequestSnapshot | null>(null);
  const lastFocusTargetRef = useRef<string | null>(null);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const cloudEnabled = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

  const [view, setView] = useState<AppView>("scan");
  const [showResult, setShowResult] = useState(false);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [cameraReady, setCameraReady] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [card, setCard] = useState<ObjectCard | null>(null);
  const [progress, setProgress] = useState(0);
  const [modelMessage, setModelMessage] = useState<string>();
  const [holdSeconds, setHoldSeconds] = useState(3);
  const [context, setContext] = useState("");
  const [guideIntent, setGuideIntent] = useState<GuideIntent>("identify");
  const [guideGoal, setGuideGoal] = useState("");
  const [guideGoalError, setGuideGoalError] = useState<string>();
  const [guideResult, setGuideResult] = useState<GuideResult | null>(null);
  const [guideWarnings, setGuideWarnings] = useState<string[]>([]);
  const [guideRequestId, setGuideRequestId] = useState<string>();
  const [guideSourceCard, setGuideSourceCard] = useState<ObjectCard | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [guideClarificationError, setGuideClarificationError] = useState<string>();
  const [guideBusy, setGuideBusy] = useState(false);
  const [status, setStatus] = useState("Ready when your object is.");
  const [boards, setBoards] = useState<StoryboardBoard[]>(() => defaultStoryboardBoards());
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [feedback, setFeedback] = useState<AccuracyFeedback[]>([]);
  const [preferences, setPreferences] = useState<LocalPreferences>(defaultPreferences);
  const [activeBoardId, setActiveBoardId] = useState("for-later");
  const [selectedBoardId, setSelectedBoardId] = useState("for-later");
  const [newBoardName, setNewBoardName] = useState("");
  const [savedQuery, setSavedQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [correctionName, setCorrectionName] = useState("");
  const [correctionCategory, setCorrectionCategory] = useState("");
  const [correctionNotes, setCorrectionNotes] = useState("");
  const [saved, setSaved] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [identifyTurnstileToken, setIdentifyTurnstileToken] = useState<string | null>(null);
  const [guideTurnstileToken, setGuideTurnstileToken] = useState<string | null>(null);
  const [availableProviders, setAvailableProviders] = useState<IdentificationProvider[]>(["device"]);
  const [availableGuideProviders, setAvailableGuideProviders] = useState<GuideRemoteProvider[] | null>(null);
  const [remoteProviderAvailable, setRemoteProviderAvailable] = useState<boolean | null>(null);
  const [privateModelAvailable, setPrivateModelAvailable] = useState<boolean | null>(null);
  const [backendHealth, setBackendHealth] = useState<BackendHealth>({ ok: false, label: "Checking cloud vision…" });
  const [cloudUser, setCloudUser] = useState<CloudUser>(null);
  const [cloudStatus, setCloudStatus] = useState(cloudEnabled ? "Sign in to sync your library" : "Saved only on this device");
  const [authEmail, setAuthEmail] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [pendingCloudChanges, setPendingCloudChanges] = useState(0);
  const [backupData, setBackupData] = useState<LocalData | null>(null);
  const [backupFileName, setBackupFileName] = useState("");
  const [backupError, setBackupError] = useState<string>();

  const totalSaved = useMemo(() => boards.reduce((sum, board) => sum + board.items.length, 0), [boards]);
  const guideMode = guideIntent !== "identify";
  const guideProviderAvailable = guideProviderAvailableForChoice(preferences.providerChoice, availableGuideProviders);
  const guideBlockedReason = !guideMode
    ? undefined
    : preferences.providerChoice === "device"
      ? "On-device mode keeps images in this browser, so it cannot call the cloud guide service. Choose an available cloud mode in Settings only when you want to send an image."
      : preferences.providerChoice === "classifier"
        ? "The private classifier can identify objects but cannot produce guided answers. Choose an available cloud mode in Settings to continue; this image has not been sent."
        : availableGuideProviders === null
          ? "Cloud guidance availability is still being checked. No image will be sent until it is ready."
          : !guideProviderAvailable
            ? "A cloud guide provider is not available for this recognition mode. No image will be sent; identification still works."
            : undefined;
  const activeTurnstileToken = guideMode ? guideTurnstileToken : identifyTurnstileToken;
  const securityReady = preferences.providerChoice === "device" || !turnstileSiteKey || Boolean(activeTurnstileToken);

  useEffect(() => {
    let cancelled = false;
    void loadLocalData()
      .then((data) => {
        if (cancelled) return;
        setBoards(data.boards);
        setCatalog(data.catalog);
        setFeedback(data.feedback);
        setPreferences(data.preferences);
        setActiveBoardId(data.boards[0]?.id || "for-later");
        setSelectedBoardId(data.boards[0]?.id || "for-later");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "Saved data could not be opened."));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/health", { cache: "no-store" })
      .then(async (response) => ({
        response,
        payload: (await response.json()) as {
          ok?: boolean;
          availableProviders?: string[];
          availableGuideProviders?: string[];
          error?: string;
        },
      }))
      .then(({ response, payload }) => {
        if (cancelled) return;
        const reportedProviders = payload.availableProviders || [];
        const remote = reportedProviders.filter((provider): provider is IdentificationProvider => provider === "gemini" || provider === "classifier");
        const hasOpenAIAuto = reportedProviders.includes("openai");
        const hasRemoteProvider = Boolean(response.ok && payload.ok && (remote.length > 0 || hasOpenAIAuto));
        const guideProviders = (payload.availableGuideProviders || []).filter(
          (provider): provider is GuideRemoteProvider => provider === "gemini" || provider === "openai",
        );
        const hasGuideProvider = Boolean(response.ok && payload.ok && guideProviders.length > 0);
        const healthDetail = friendlyCloudStatus(payload.error);
        setRemoteProviderAvailable(hasRemoteProvider);
        setAvailableGuideProviders(hasGuideProvider ? guideProviders : []);
        setAvailableProviders(Array.from(new Set(["device", ...(hasRemoteProvider || hasGuideProvider ? ["auto" as const, ...(hasRemoteProvider ? remote : [])] : [])])) as IdentificationProvider[]);
        setBackendHealth(hasRemoteProvider
          ? { ok: true, label: "Cloud recognition ready", detail: "On-device mode is also available." }
          : hasGuideProvider
            ? { ok: true, label: "Cloud guidance ready", detail: "Object identification will fall back to on-device recognition." }
          : { ok: false, label: "Cloud recognition unavailable", detail: healthDetail });
      })
      .catch(() => {
        setRemoteProviderAvailable(false);
        setAvailableGuideProviders([]);
        setAvailableProviders(["device"]);
        setBackendHealth({ ok: false, label: "Cloud status unavailable", detail: "On-device mode remains available." });
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (remoteProviderAvailable === null || availableProviders.includes(preferences.providerChoice)) return;
    setPreferences((current) => {
      if (availableProviders.includes(current.providerChoice)) return current;
      const updated = { ...current, providerChoice: "device" as const };
      void savePreferences(updated).catch(() => setStatus("The available recognition mode could not be saved."));
      return updated;
    });
  }, [availableProviders, preferences.providerChoice, remoteProviderAvailable]);

  useEffect(() => {
    let cancelled = false;
    void import("@/lib/local-vision")
      .then(({ privateModelReady }) => privateModelReady())
      .then((ready) => { if (!cancelled) setPrivateModelAvailable(ready); })
      .catch(() => { if (!cancelled) setPrivateModelAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const headingId = showResult ? "result-heading" : `${view}-heading`;
    const focusTarget = `${headingId}:${showResult && guideResult ? guideRequestId || "guide" : "view"}`;
    if (lastFocusTargetRef.current === null) {
      lastFocusTargetRef.current = focusTarget;
      return;
    }
    if (lastFocusTargetRef.current === focusTarget) return;
    lastFocusTargetRef.current = focusTarget;
    const frame = window.requestAnimationFrame(() => document.getElementById(headingId)?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [guideRequestId, guideResult, showResult, view]);

  useEffect(() => {
    if (scanState !== "error" || view !== "scan") return;
    const frame = window.requestAnimationFrame(() => document.getElementById("scan-error-heading")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [scanState, view]);

  useEffect(() => {
    const shouldRender = view === "scan" && !showResult && guideIntent === "identify" && preferences.providerChoice !== "device";
    if (!shouldRender || !turnstileSiteKey || !turnstileReady || !identifyTurnstileContainerRef.current || !window.turnstile || identifyTurnstileWidgetRef.current) return;
    identifyTurnstileWidgetRef.current = window.turnstile.render(identifyTurnstileContainerRef.current, {
      sitekey: turnstileSiteKey,
      action: "identify",
      callback: setIdentifyTurnstileToken,
      "expired-callback": () => setIdentifyTurnstileToken(null),
      "error-callback": () => setStatus("Security verification could not load. Choose on-device mode or try again."),
    });
    return () => {
      if (identifyTurnstileWidgetRef.current && window.turnstile) window.turnstile.remove(identifyTurnstileWidgetRef.current);
      identifyTurnstileWidgetRef.current = null;
      setIdentifyTurnstileToken(null);
    };
  }, [guideIntent, preferences.providerChoice, showResult, turnstileReady, turnstileSiteKey, view]);

  useEffect(() => {
    const guideInputVisible = view === "scan" && !showResult && guideIntent !== "identify";
    const clarificationVisible = view === "scan" && showResult && Boolean(guideResult?.clarificationQuestion);
    const shouldRender = (guideInputVisible || clarificationVisible)
      && preferences.providerChoice !== "device"
      && preferences.providerChoice !== "classifier"
      && guideProviderAvailable;
    if (!shouldRender || !turnstileSiteKey || !turnstileReady || !guideTurnstileContainerRef.current || !window.turnstile || guideTurnstileWidgetRef.current) return;
    guideTurnstileWidgetRef.current = window.turnstile.render(guideTurnstileContainerRef.current, {
      sitekey: turnstileSiteKey,
      action: "guide",
      callback: setGuideTurnstileToken,
      "expired-callback": () => setGuideTurnstileToken(null),
      "error-callback": () => setStatus("Guide verification could not load. Return to identification or try again."),
    });
    return () => {
      if (guideTurnstileWidgetRef.current && window.turnstile) window.turnstile.remove(guideTurnstileWidgetRef.current);
      guideTurnstileWidgetRef.current = null;
      setGuideTurnstileToken(null);
    };
  }, [guideIntent, guideProviderAvailable, guideResult?.clarificationQuestion, preferences.providerChoice, showResult, turnstileReady, turnstileSiteKey, view]);

  useEffect(() => {
    if (!cloudEnabled) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void import("@/lib/cloud").then(({ getSupabaseBrowserClient }) => {
      const client = getSupabaseBrowserClient();
      if (!client || cancelled) return;
      void client.auth.getUser().then(({ data, error }) => {
        if (cancelled) return;
        setCloudUser(data.user ? { id: data.user.id, email: data.user.email } : null);
        if (error) setCloudStatus("Cloud sign-in is unavailable");
      });
      const listener = client.auth.onAuthStateChange((_event, session) => {
        const user = session?.user;
        setCloudUser(user ? { id: user.id, email: user.email } : null);
        setCloudStatus(user ? "Cloud account connected" : "Sign in to sync your library");
      });
      unsubscribe = () => listener.data.subscription.unsubscribe();
    });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [cloudEnabled]);

  useEffect(() => {
    if (!cloudUser) return;
    let cancelled = false;
    setCloudStatus("Checking cloud library…");
    void import("@/lib/cloud").then(({ loadCloudBoards }) => loadCloudBoards(cloudUser.id)).then((cloudBoards) => {
      if (cancelled) return;
      if (cloudBoards.length) {
        setBoards((current) => {
          const merged = mergeBoards(current, cloudBoards);
          void saveBoards(merged);
          setActiveBoardId(merged[0]?.id || "for-later");
          setSelectedBoardId(merged[0]?.id || "for-later");
          return merged;
        });
      }
      setLastSyncAt(new Date().toISOString());
      setPendingCloudChanges(0);
      setCloudStatus(cloudBoards.length ? "Cloud and device libraries merged" : "Cloud is ready for your first sync");
    }).catch((error) => !cancelled && setCloudStatus(error instanceof Error ? error.message : "Cloud sync failed"));
    return () => { cancelled = true; };
  }, [cloudUser]);

  useEffect(() => {
    setIsInstalled(window.matchMedia("(display-mode: standalone)").matches);
    const beforeInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    const installed = () => { setInstallPrompt(null); setIsInstalled(true); };
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") void navigator.serviceWorker.register("/sw.js");
    return () => { window.removeEventListener("beforeinstallprompt", beforeInstall); window.removeEventListener("appinstalled", installed); };
  }, []);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    if (parameters.get("view") !== "settings" || parameters.get("source") !== "extension") return;
    setView("settings");
    setShowResult(false);
    setStatus("Review recognition and account settings. Returning here from the extension did not send a screenshot or sign-in token.");
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => () => {
    captureSequenceRef.current += 1;
    requestControllerRef.current?.abort();
    guideControllerRef.current?.abort();
    guideSequenceRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function persistBoards(next: StoryboardBoard[]) {
    try {
      await saveBoards(next);
      setBoards(next);
      if (cloudUser) setPendingCloudChanges((count) => count + 1);
      return true;
    } catch {
      setStatus("This device is out of storage. Remove saved objects or export a backup, then try again.");
      return false;
    }
  }

  function markCloudChangeSynced() {
    setPendingCloudChanges((count) => Math.max(0, count - 1));
    setLastSyncAt(new Date().toISOString());
    setCloudStatus("Cloud library synced");
  }

  function updatePreferences(next: Partial<LocalPreferences>) {
    const updated = { ...preferences, ...next };
    setPreferences(updated);
    void savePreferences(updated).catch(() => setStatus("That preference could not be saved."));
  }

  function stopCamera() {
    captureSequenceRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }

  function invalidateGuideOperation() {
    guideSequenceRef.current += 1;
    guideControllerRef.current?.abort();
    guideControllerRef.current = null;
    guideSourceKeyRef.current = "";
    lastGuideRequestRef.current = null;
    setGuideBusy(false);
  }

  function clearGuideState(options: { source?: boolean; intent?: boolean } = {}) {
    invalidateGuideOperation();
    setGuideResult(null);
    setGuideWarnings([]);
    setGuideRequestId(undefined);
    setClarificationAnswer("");
    setGuideClarificationError(undefined);
    setGuideGoalError(undefined);
    if (options.source !== false) setGuideSourceCard(null);
    if (options.intent !== false) {
      setGuideIntent("identify");
      setGuideGoal("");
    }
  }

  function focusGuideField(id: "guide-goal" | "guide-clarification-answer") {
    window.requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  function handleGuideFailure(error: unknown, preserveResult = false) {
    if (isAbortError(error)) return;
    console.error("Guide generation failed", error);
    const reference = guideErrorReference(error);
    const message = `${friendlyGuideError(error)}${reference ? ` Reference: ${reference}.` : ""}`;
    setGuideBusy(false);
    setModelMessage(undefined);
    setScanState(preserveResult ? "done" : "error");
    setStatus(message);
    if (preserveResult) {
      setGuideClarificationError(message);
      focusGuideField("guide-clarification-answer");
    }
  }

  async function prepareGuideImage(image: string | null | undefined) {
    if (!isGuideImageDataUrl(image)) return undefined;
    const resized = (await resizeImageDataUrl(image, 1_400, 0.8)) || image;
    return resized.length <= 3_900_000 ? resized : undefined;
  }

  async function requestGuide(input: {
    intent: ActionableGuideIntent;
    goal: string;
    image?: string | null;
    sourceCard?: ObjectCard | null;
    pageContext?: string;
    preserveResult?: boolean;
  }) {
    const sequence = ++guideSequenceRef.current;
    guideControllerRef.current?.abort();
    const controller = new AbortController();
    let sourceKey = "";
    guideControllerRef.current = controller;
    setGuideBusy(true);
    setGuideGoalError(undefined);
    setGuideClarificationError(undefined);
    if (!input.preserveResult) {
      setGuideResult(null);
      setGuideWarnings([]);
      setGuideRequestId(undefined);
      setScanState("identifying");
    }
    setProgress(0.9);
    setStatus(input.preserveResult ? "Updating the guide with your answer…" : "Creating a careful guide…");

    try {
      const image = await prepareGuideImage(input.image);
      if (sequence !== guideSequenceRef.current) return;
      if (input.image && isGuideImageDataUrl(input.image) && !image) {
        throw new GuideRequestError("The selected image could not be prepared safely.");
      }

      const cardContext = input.sourceCard ? guideContextForCard(input.sourceCard) : "";
      const pageContext = (input.preserveResult
        ? input.pageContext || ""
        : [context.trim(), cardContext, input.pageContext || ""].filter(Boolean).join("\n")
      ).slice(0, 16_000);
      sourceKey = guideOperationKey({
        card: input.sourceCard,
        intent: input.intent,
        goal: input.goal,
        image,
      });
      guideSourceKeyRef.current = sourceKey;

      const requestBody = buildWebGuideRequest({
        intent: input.intent,
        image,
        goal: input.goal,
        pageContext,
        title: input.sourceCard?.objectName,
        providerChoice: preferences.providerChoice,
        turnstileToken: guideTurnstileToken,
      });
      const response = await fetch("/api/guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      const rawPayload: unknown = await response.json().catch(() => null);
      if (sequence !== guideSequenceRef.current || sourceKey !== guideSourceKeyRef.current) return;
      const { guideResponseSchema } = await import("@/lib/guide-contract");
      const parsedPayload = guideResponseSchema.safeParse(rawPayload);
      if (!parsedPayload.success) {
        throw new GuideRequestError("The guide response was unreadable.", response.headers.get("x-request-id") || undefined);
      }
      const payload = parsedPayload.data;
      if (!response.ok || !payload.ok) {
        throw new GuideRequestError(payload.ok ? "Guidance is temporarily unavailable." : payload.error, payload.requestId);
      }
      if (sequence !== guideSequenceRef.current || sourceKey !== guideSourceKeyRef.current) return;

      lastGuideRequestRef.current = {
        intent: input.intent,
        goal: requestBody.goal || payload.result.goal,
        pageContext,
        title: input.sourceCard?.objectName,
        image,
        sourceKey,
      };
      setGuideResult(payload.result);
      setGuideWarnings(payload.warnings || []);
      setGuideRequestId(payload.requestId);
      setGuideSourceCard(input.sourceCard || null);
      setClarificationAnswer("");
      setGuideClarificationError(undefined);
      setCurrentImage(image || null);
      setProgress(1);
      setScanState("done");
      setShowResult(true);
      setStatus(payload.result.clarificationQuestion ? "One more detail will make this guide reliable." : "Guide ready. Review warnings before taking the next step.");
      stopCamera();
    } catch (error) {
      const stale = sequence !== guideSequenceRef.current
        || controller.signal.aborted
        || guideControllerRef.current !== controller
        || Boolean(sourceKey && sourceKey !== guideSourceKeyRef.current);
      if (stale) return;
      throw error;
    } finally {
      const currentOperation = sequence === guideSequenceRef.current && guideControllerRef.current === controller;
      if (currentOperation) {
        guideControllerRef.current = null;
        setGuideBusy(false);
        if (guideTurnstileWidgetRef.current && window.turnstile) window.turnstile.reset(guideTurnstileWidgetRef.current);
        setGuideTurnstileToken(null);
      }
    }
  }

  async function runSelectedIntent(image: string, sourceCard: ObjectCard | null = null) {
    if (guideIntent === "identify") {
      if (!isGuideImageDataUrl(image)) {
        setStatus("This cloud-saved preview cannot be used for a new identification. The image was not sent.");
        return;
      }
      clearGuideState();
      await identify(image);
      return;
    }
    if (guideBlockedReason) {
      setCurrentImage(image);
      setScanState("idle");
      setStatus(guideBlockedReason);
      stopCamera();
      return;
    }
    if (sourceCard && (!sourceCard.verified || isDemo)) {
      setStatus("Confirm the identification before requesting actionable guidance.");
      return;
    }
    if (guideGoalRequired(guideIntent) && !guideGoal.trim()) {
      setGuideGoalError("Describe the problem, comparison target, or outcome before continuing.");
      setStatus("Add the required goal before creating this guide.");
      focusGuideField("guide-goal");
      return;
    }
    try {
      await requestGuide({ intent: guideIntent, goal: guideGoal, image, sourceCard });
    } catch (error) {
      if (error instanceof GuidePrivacyBoundaryError) {
        setCurrentImage(image);
        setScanState("idle");
        setStatus(error.message);
        stopCamera();
        return;
      }
      if (error instanceof GuideGoalRequiredError) {
        setGuideGoalError(error.message);
        focusGuideField("guide-goal");
      }
      handleGuideFailure(error);
    }
  }

  function handleIdentificationError(error: unknown) {
    console.error("Identification failed", error);
    setScanState("error");
    setModelMessage(undefined);
    setStatus(friendlyScanError(error));
  }

  function updateModelProgress(event: { phase: "checking" | "downloading" | "preparing" | "ready"; loaded?: number; total?: number }) {
    if (event.phase === "checking") {
      setProgress(0.84);
      setModelMessage("Checking the private model…");
      return;
    }
    if (event.phase === "downloading") {
      const fraction = event.total ? Math.min(1, event.loaded! / event.total) : 0;
      setProgress(0.84 + fraction * 0.12);
      const percent = event.total ? `${Math.round(fraction * 100)}%` : `${Math.round((event.loaded || 0) / 1_000_000)} MB`;
      setModelMessage(`Downloading the private model · ${percent}`);
      return;
    }
    if (event.phase === "preparing") {
      setProgress(0.97);
      setModelMessage("Preparing private recognition…");
      return;
    }
    setProgress(0.99);
    setModelMessage("Private recognition is ready offline.");
    setPrivateModelAvailable(true);
  }

  async function startCamera() {
    if (scanState === "scanning" || scanState === "identifying") return;
    if (guideMode && guideBlockedReason) {
      setStatus(guideBlockedReason);
      return;
    }
    if (guideMode && guideGoalRequired(guideIntent) && !guideGoal.trim()) {
      setGuideGoalError("Describe the problem, comparison target, or outcome before continuing.");
      setStatus("Add the required goal before opening the camera.");
      focusGuideField("guide-goal");
      return;
    }
    const captureSequence = ++captureSequenceRef.current;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    clearGuideState({ intent: false });
    setCard(null);
    setIsDemo(false);
    setCameraReady(false);
    setCurrentImage(null);
    setShowResult(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not supported here. Upload a photo instead.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (captureSequence !== captureSequenceRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (!videoRef.current) throw new Error("The camera preview is not available.");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      await waitForVideoReady(videoRef.current);
      if (captureSequence !== captureSequenceRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        if (streamRef.current === stream) streamRef.current = null;
        return;
      }
      setCameraReady(true);
      setScanState("camera");
      setStatus("Camera ready. Center one object and scan.");
    } catch (error) {
      if (captureSequence !== captureSequenceRef.current) return;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setScanState("error");
      setStatus(error instanceof Error ? error.message : "Camera access was not granted.");
    }
  }

  async function identify(image: string) {
    invalidateGuideOperation();
    setGuideResult(null);
    setGuideWarnings([]);
    setGuideRequestId(undefined);
    setGuideSourceCard(null);
    const sequence = ++requestSequenceRef.current;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setScanState("identifying");
    setProgress(0.86);
    setStatus("Reading the image…");
    setSaved(false);
    setIsDemo(false);
    try {
      const localVision = await import("@/lib/local-vision");
      if (sequence !== requestSequenceRef.current || controller.signal.aborted) return;
      const barcode = await localVision.detectBarcode(image);
      if (sequence !== requestSequenceRef.current || controller.signal.aborted) return;
      let recognizedText: string[] | undefined;
      if (preferences.textAssist) {
        setStatus("Reading visible text privately…");
        recognizedText = await localVision.extractText(image, (value) => setProgress(0.86 + value * 0.1));
        if (sequence !== requestSequenceRef.current || controller.signal.aborted) return;
      }
      const assistContext = [context.trim(), barcode ? `Barcode: ${barcode}` : "", recognizedText?.length ? `Visible text: ${recognizedText.join(" | ").slice(0, 240)}` : ""].filter(Boolean).join(" ").slice(0, 500);
      let response: Extract<IdentifyResponse, { ok: true }>;
      if (preferences.providerChoice === "device") {
        setStatus("Identifying privately on this device…");
        response = await localVision.identifyOnDevice(image, assistContext, updateModelProgress);
      } else {
        setStatus("Identifying the object…");
        try {
          const remote = await fetch("/api/identify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image, context: assistContext || undefined, provider: preferences.providerChoice, turnstileToken: identifyTurnstileToken || undefined }),
            signal: controller.signal,
          });
          const payload = (await remote.json()) as IdentifyResponse;
          if (!payload.ok) throw new Error(payload.error);
          response = payload;
        } catch (error) {
          if (preferences.providerChoice !== "auto" || isAbortError(error)) throw error;
          setStatus("Cloud vision is unavailable. Switching to private recognition…");
          response = await localVision.identifyOnDevice(image, assistContext, updateModelProgress);
          response.warnings = ["Cloud vision was unavailable, so this result was produced on your device.", ...(response.warnings || [])];
        }
      }
      if (sequence !== requestSequenceRef.current) return;
      const nextCard = await cardFromResponse(response, image, catalog, { barcode, recognizedText });
      if (sequence !== requestSequenceRef.current) return;
      setCard(nextCard);
      setCorrectionName(nextCard.objectName);
      setCorrectionCategory(nextCard.category);
      setCorrectionNotes("");
      setCurrentImage(image);
      setProgress(1);
      setModelMessage(undefined);
      setScanState("done");
      setShowResult(true);
      setStatus(response.warnings?.[0] || `Found: ${nextCard.shortName}. Please confirm the match.`);
      stopCamera();
    } catch (error) {
      if (sequence !== requestSequenceRef.current || controller.signal.aborted || requestControllerRef.current !== controller) return;
      throw error;
    } finally {
      const currentOperation = sequence === requestSequenceRef.current && requestControllerRef.current === controller;
      if (currentOperation) {
        requestControllerRef.current = null;
        if (identifyTurnstileWidgetRef.current && window.turnstile) window.turnstile.reset(identifyTurnstileWidgetRef.current);
        setIdentifyTurnstileToken(null);
      }
    }
  }

  async function scanObject() {
    if (guideMode && guideBlockedReason) {
      setStatus(guideBlockedReason);
      return;
    }
    if (guideMode && guideGoalRequired(guideIntent) && !guideGoal.trim()) {
      setGuideGoalError("Describe the problem, comparison target, or outcome before continuing.");
      setStatus("Add the required goal before capturing an image.");
      focusGuideField("guide-goal");
      return;
    }
    if (!cameraReady || !streamRef.current?.active || !videoRef.current || !canvasRef.current) {
      setStatus("Start the camera and wait until it is ready.");
      return;
    }
    setScanState("scanning");
    setProgress(0);
    setCard(null);
    setGuideSourceCard(null);
    const captureSequence = ++captureSequenceRef.current;
    const startedAt = Date.now();
    const candidates: Array<{ image: string; score: number }> = [];
    while (Date.now() - startedAt < holdSeconds * 1_000) {
      if (captureSequence !== captureSequenceRef.current) return;
      if (!streamRef.current?.active) {
        setScanState("error");
        setStatus("The camera stopped before the scan finished. Restart it and try again.");
        return;
      }
      const frame = captureVideoFrame(videoRef.current, canvasRef.current);
      if (frame) candidates.push(frame);
      setProgress(Math.min(0.78, ((Date.now() - startedAt) / (holdSeconds * 1_000)) * 0.78));
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    }
    if (captureSequence !== captureSequenceRef.current) return;
    const best = candidates.sort((left, right) => right.score - left.score)[0];
    if (!best) { setScanState("error"); setStatus("No usable frame was captured. Try more light or upload a photo."); return; }
    setCurrentImage(best.image);
    try { await runSelectedIntent(best.image); } catch (error) { if (!isAbortError(error)) handleIdentificationError(error); }
  }

  async function handleFile(file?: File) {
    if (!file) return;
    if (guideMode && guideBlockedReason) { setStatus(guideBlockedReason); return; }
    if (!SUPPORTED_UPLOAD_TYPES.has(file.type)) { setStatus("Choose a JPEG, PNG, or WebP image."); return; }
    if (file.size > MAX_UPLOAD_FILE_BYTES) { setStatus("Choose an image smaller than 15 MB."); return; }
    const captureSequence = ++captureSequenceRef.current;
    try {
      const raw = await fileAsDataUrl(file);
      if (captureSequence !== captureSequenceRef.current) return;
      const image = (await resizeImageDataUrl(raw, 1_600, 0.86)) || raw;
      if (captureSequence !== captureSequenceRef.current) return;
      setCard(null);
      setGuideSourceCard(null);
      setCurrentImage(image);
      await runSelectedIntent(image);
    } catch (error) {
      if (captureSequence === captureSequenceRef.current && !isAbortError(error)) handleIdentificationError(error);
    }
  }

  function openUploadPicker() {
    if (guideMode && guideBlockedReason) {
      setStatus(guideBlockedReason);
      return;
    }
    if (guideMode && guideGoalRequired(guideIntent) && !guideGoal.trim()) {
      setGuideGoalError("Describe the problem, comparison target, or outcome before continuing.");
      setStatus("Add the required goal before choosing a photo.");
      focusGuideField("guide-goal");
      return;
    }
    fileInputRef.current?.click();
  }

  async function retryIdentification() {
    const retryImage = currentImage || guideSourceCard?.image || "";
    if (!retryImage && !(guideMode && guideSourceCard)) return;
    try { await runSelectedIntent(retryImage, guideSourceCard); } catch (error) { if (!isAbortError(error)) handleIdentificationError(error); }
  }

  function selectGuideIntent(intent: GuideIntent) {
    if (intent === "identify" && guideSourceCard) {
      backToIdentification();
      return;
    }
    invalidateGuideOperation();
    setGuideIntent(intent);
    setGuideGoal(intent === "explain" && guideSourceCard ? `Explain ${guideSourceCard.objectName}`.slice(0, 500) : "");
    setContext("");
    setGuideResult(null);
    setGuideWarnings([]);
    setGuideRequestId(undefined);
    setClarificationAnswer("");
    setGuideClarificationError(undefined);
    setGuideGoalError(undefined);
    setScanState(currentImage ? "idle" : scanState === "camera" ? "camera" : "idle");
    setStatus(intent === "identify" ? "Ready to identify the image." : `Ready to ${intent}. Review the goal and privacy mode.`);
  }

  function startGuideFromCard(intent: ActionableGuideIntent) {
    if (!card?.verified || isDemo) {
      setStatus("Confirm the identification before requesting actionable guidance.");
      return;
    }
    invalidateGuideOperation();
    setGuideIntent(intent);
    setGuideGoal(intent === "explain" ? `Explain ${card.objectName}`.slice(0, 500) : "");
    setGuideGoalError(undefined);
    setGuideResult(null);
    setGuideWarnings([]);
    setGuideRequestId(undefined);
    setClarificationAnswer("");
    setGuideClarificationError(undefined);
    setGuideSourceCard(card);
    setCurrentImage(card.image);
    setContext("");
    setShowResult(false);
    setScanState("idle");
    setStatus(isGuideImageDataUrl(card.image)
      ? "Using the confirmed image. Review the goal and privacy mode before continuing."
      : "Using confirmed object details. The cloud-saved preview will not be included in the guide request.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function backToIdentification() {
    const source = guideSourceCard;
    if (!source) {
      resetScan();
      return;
    }
    invalidateGuideOperation();
    setGuideResult(null);
    setGuideWarnings([]);
    setGuideRequestId(undefined);
    setClarificationAnswer("");
    setGuideClarificationError(undefined);
    setGuideIntent("identify");
    setGuideGoal("");
    setCard(source);
    setCurrentImage(source.image);
    setGuideSourceCard(null);
    setScanState("done");
    setShowResult(true);
    setStatus(`Back to the confirmed identification: ${source.shortName}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function clarifyGuide() {
    const previous = lastGuideRequestRef.current;
    const question = guideResult?.clarificationQuestion;
    const answer = clarificationAnswer.trim();
    if (!previous || !question || !answer) return;
    if (previous.sourceKey !== guideSourceKeyRef.current) {
      const message = "This guide no longer matches the selected object. Start again from the identification.";
      setGuideClarificationError(message);
      setStatus(message);
      focusGuideField("guide-clarification-answer");
      return;
    }
    if (!securityReady) {
      const message = "Complete the guide security check before updating the answer.";
      setGuideClarificationError(message);
      setStatus(message);
      focusGuideField("guide-clarification-answer");
      return;
    }
    try {
      await requestGuide({
        intent: previous.intent,
        goal: previous.goal,
        image: previous.image,
        sourceCard: guideSourceCard,
        pageContext: [previous.pageContext, clarificationContext(question, answer)].filter(Boolean).join("\n"),
        preserveResult: true,
      });
    } catch (error) {
      handleGuideFailure(error, true);
    }
  }

  async function identifyGuideImage() {
    if (!isGuideImageDataUrl(currentImage)) {
      setStatus("This saved reference has no local image available for a new identification.");
      return;
    }
    const image = currentImage;
    clearGuideState();
    setShowResult(false);
    try {
      await identify(image);
    } catch (error) {
      if (!isAbortError(error)) handleIdentificationError(error);
    }
  }

  async function recordFeedback(choice: FeedbackChoice, correctedName?: string) {
    if (!card) return;
    const entry: AccuracyFeedback = {
      id: nowId(), createdAt: new Date().toISOString(), predictedName: card.objectName, correctedName,
      category: card.category, confidence: card.confidence, source: card.source || "unknown", wasCorrect: choice === "correct",
      image: preferences.saveFeedbackPhotos ? await makeFeedbackThumbnail(card.image) : undefined,
    };
    const next = [entry, ...feedback].slice(0, 5_000);
    setFeedback(next);
    await saveFeedback(next);
    if (cloudUser) {
      void import("@/lib/cloud").then(({ saveCloudFeedback }) => saveCloudFeedback(cloudUser.id, card, entry, preferences.saveFeedbackPhotos)).catch(() => setCloudStatus("Feedback saved here; cloud feedback sync failed"));
    }
  }

  function confirmCard() {
    if (!card) return;
    setCard({ ...card, verified: true });
    void recordFeedback("correct").catch(() => setStatus("Confirmed, but the feedback record could not be saved."));
    setStatus("Confirmed. Choose a board and save it.");
  }

  async function correctCard() {
    if (!card || !correctionName.trim()) return;
    clearGuideState({ intent: false });
    const correctedName = correctionName.trim().slice(0, 160);
    const category = correctionCategory.trim().slice(0, 120) || card.category;
    const [fingerprint, visualSignature, thumbnail] = await Promise.all([imageFingerprint(card.image), imageVisualSignature(card.image), resizeImageDataUrl(card.image, 240, 0.64)]);
    const entry: CatalogEntry = {
      id: nowId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), objectName: correctedName,
      category, notes: correctionNotes.trim().slice(0, 500), matchLabels: Array.from(new Set([card.objectName, card.shortName, ...(card.detections || []).map((item) => item.label)])),
      fingerprint, visualSignature, image: thumbnail,
    };
    const nextCatalog = [entry, ...catalog.filter((item) => item.id !== card.learnedCorrection?.catalogEntryId)].slice(0, 2_000);
    const shoppingRecommended = shoppingRecommendedForCategory(category);
    setCatalog(nextCatalog);
    await saveCatalog(nextCatalog);
    setCard({ ...card, correctedFrom: card.objectName, objectName: correctedName, shortName: correctedName, category, about: correctionNotes.trim() || card.about, purchaseQuery: correctedName, shoppingRecommended, purchaseLinks: shoppingRecommended ? purchaseLinksFor(correctedName) : [], verified: true, visualSignature, learnedCorrection: undefined });
    await recordFeedback("incorrect", correctedName);
    setStatus("Correction saved. Similar future scans can learn from it.");
  }

  async function ignoreLearning() {
    if (!card?.learnedCorrection) return;
    clearGuideState({ intent: false });
    const nextCatalog = catalog.filter((item) => item.id !== card.learnedCorrection?.catalogEntryId);
    try {
      await saveCatalog(nextCatalog);
      const restored = ignoreCatalogCorrection(card);
      setCatalog(nextCatalog);
      setCard(restored);
      setCorrectionName(restored.objectName);
      setCorrectionCategory(restored.category);
      setCorrectionNotes("");
      setStatus("Learned correction ignored and removed. Confirm or correct the original model result.");
    } catch {
      setStatus("That learned correction could not be removed.");
    }
  }

  async function saveCard() {
    if (!card?.verified) { setStatus("Confirm or correct the identification before saving."); return; }
    const duplicate = findDuplicateCard(card, boards);
    if (duplicate) { setSaved(true); setStatus(`Already saved in ${duplicate.board.name}.`); return; }
    const image = (await resizeImageDataUrl(card.image, 720, 0.72)) || card.image;
    const storedCard = { ...card, image };
    const trimmed = newBoardName.trim().slice(0, 80);
    const existing = boards.find((board) => normalizeText(board.name) === normalizeText(trimmed));
    const newBoard = trimmed && !existing ? { id: nowId(), name: trimmed, createdAt: new Date().toISOString(), items: [] as ObjectCard[] } : undefined;
    const targetId = existing?.id || newBoard?.id || selectedBoardId || boards[0]?.id || "for-later";
    const base = boards.length ? boards : defaultStoryboardBoards();
    const working = newBoard ? [...base, newBoard] : base;
    const next = working.map((board) => ({ ...board, items: board.id === targetId ? [storedCard, ...board.items] : board.items }));
    if (!(await persistBoards(next))) return;
    setSelectedBoardId(targetId); setActiveBoardId(targetId); setNewBoardName(""); setSaved(true);
    setStatus(`Saved to ${next.find((board) => board.id === targetId)?.name || "your library"}.`);
    if (cloudUser) {
      const target = next.find((board) => board.id === targetId);
      if (target) void import("@/lib/cloud").then(({ saveCloudCard }) => saveCloudCard(cloudUser.id, target, storedCard)).then(markCloudChangeSynced).catch(() => setCloudStatus("Saved here; cloud upload failed"));
    }
  }

  function resetScan() {
    captureSequenceRef.current += 1;
    requestControllerRef.current?.abort();
    requestSequenceRef.current += 1;
    stopCamera();
    clearGuideState();
    setCard(null); setCurrentImage(null); setShowResult(false); setSaved(false); setIsDemo(false); setProgress(0); setScanState("idle"); setContext("");
    setModelMessage(undefined); setStatus("Ready for another object.");
  }

  async function toggleFavorite(item: ObjectCard) {
    const next = boards.map((board) => ({ ...board, items: board.items.map((stored) => stored.id === item.id ? { ...stored, favorite: !stored.favorite } : stored) }));
    if (!(await persistBoards(next)) || !cloudUser) return;
    const target = next.find((board) => board.items.some((stored) => stored.id === item.id));
    const updated = target?.items.find((stored) => stored.id === item.id);
    if (target && updated) void import("@/lib/cloud").then(({ saveCloudCard }) => saveCloudCard(cloudUser.id, target, updated)).then(markCloudChangeSynced).catch(() => setCloudStatus("Favorite saved here; cloud sync is pending"));
  }

  async function removeCard(item: ObjectCard) {
    if (!window.confirm(`Remove ${item.objectName} from this board?`)) return;
    const sourceBoard = boards.find((board) => board.items.some((stored) => stored.id === item.id));
    const next = boards.map((board) => ({ ...board, items: board.items.filter((stored) => stored.id !== item.id) }));
    if (!(await persistBoards(next))) return;
    setStatus(`${item.objectName} removed.`);
    if (cloudUser && sourceBoard) void import("@/lib/cloud").then(({ deleteCloudCard }) => deleteCloudCard(cloudUser.id, sourceBoard.id, item)).then(markCloudChangeSynced).catch(() => setCloudStatus("Removed here; cloud delete is pending"));
  }

  async function clearBoard() {
    const board = boards.find((item) => item.id === activeBoardId);
    if (!board?.items.length || !window.confirm(`Remove all ${board.items.length} objects from ${board.name}?`)) return;
    if (!(await persistBoards(boards.map((item) => item.id === board.id ? { ...item, items: [] } : item)))) return;
    if (cloudUser) void import("@/lib/cloud").then(({ clearCloudBoard }) => clearCloudBoard(cloudUser.id, board)).then(markCloudChangeSynced).catch(() => setCloudStatus("Cleared here; cloud delete is pending"));
  }

  async function shareCard() {
    if (!card) return;
    const text = `${card.objectName} — ${card.about}`;
    try {
      if (navigator.share) await navigator.share({ title: card.objectName, text });
      else { await navigator.clipboard.writeText(text); setStatus("Result copied to the clipboard."); }
    } catch (error) {
      if (!isAbortError(error)) setStatus("Sharing is unavailable in this browser.");
    }
  }

  async function sendMagicLink() {
    if (!authEmail.trim()) return;
    setAuthBusy(true); setCloudStatus("Sending secure link…");
    try {
      const { getSupabaseBrowserClient } = await import("@/lib/cloud");
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error("Cloud sync is not configured.");
      const { error } = await client.auth.signInWithOtp({ email: authEmail.trim(), options: { emailRedirectTo: window.location.origin } });
      if (error) throw error;
      setCloudStatus("Check your email for the secure sign-in link.");
    } catch (error) { setCloudStatus(error instanceof Error ? error.message : "Sign-in link could not be sent."); }
    finally { setAuthBusy(false); }
  }

  async function signOut() {
    const { getSupabaseBrowserClient } = await import("@/lib/cloud");
    await getSupabaseBrowserClient()?.auth.signOut();
    setCloudUser(null); setCloudStatus("Signed out. Your device library remains available.");
  }

  async function syncCloud() {
    if (!cloudUser) return;
    setCloudStatus("Syncing…");
    try {
      const { syncCloudBoards } = await import("@/lib/cloud");
      await syncCloudBoards(cloudUser.id, boards, (done, total) => setCloudStatus(`Syncing ${done} of ${total}…`));
      setPendingCloudChanges(0);
      setLastSyncAt(new Date().toISOString());
      setCloudStatus("Cloud library synced");
    } catch (error) { setCloudStatus(error instanceof Error ? error.message : "Cloud sync failed"); }
  }

  function exportData() {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), boards, catalog, feedback, preferences }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `what-is-this-backup-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
    URL.revokeObjectURL(url); setStatus("Backup exported.");
  }

  async function previewBackup(file?: File) {
    setBackupError(undefined);
    setBackupData(null);
    setBackupFileName("");
    if (!file) return;
    if (file.size > 25_000_000) { setBackupError("Choose a backup smaller than 25 MB."); return; }
    try {
      const parsed = parseBackup(await file.text());
      setBackupData(parsed);
      setBackupFileName(file.name.slice(0, 160));
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : "The backup could not be read.");
    }
  }

  async function applyBackup() {
    if (!backupData) return;
    try {
      const restored = await saveLocalData(backupData);
      setBoards(restored.boards);
      setCatalog(restored.catalog);
      setFeedback(restored.feedback);
      setPreferences(restored.preferences);
      setActiveBoardId(restored.boards[0]?.id || "for-later");
      setSelectedBoardId(restored.boards[0]?.id || "for-later");
      setPendingCloudChanges(cloudUser ? 1 : 0);
      setBackupData(null);
      setBackupFileName("");
      setBackupError(undefined);
      setStatus("Backup restored on this device. Review it before syncing to the cloud.");
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : "The backup could not be restored.");
    }
  }

  async function updateCatalogEntry(entry: CatalogEntry) {
    const next = catalog.map((item) => item.id === entry.id ? entry : item);
    try {
      await saveCatalog(next);
      setCatalog(next);
      setStatus(`Updated learning for ${entry.objectName}.`);
    } catch {
      setStatus("That learned correction could not be updated.");
    }
  }

  async function removeCatalogEntry(id: string) {
    const entry = catalog.find((item) => item.id === id);
    if (!entry || !window.confirm(`Forget the learned correction for ${entry.objectName}?`)) return;
    const next = catalog.filter((item) => item.id !== id);
    try {
      await saveCatalog(next);
      setCatalog(next);
      setStatus(`Forgot the learned correction for ${entry.objectName}.`);
    } catch {
      setStatus("That learned correction could not be removed.");
    }
  }

  async function deleteDeviceData() {
    if (!window.confirm("Delete all saved boards, feedback, corrections, and preferences from this device? This cannot be undone.")) return;
    await clearLocalData();
    const defaults = defaultStoryboardBoards();
    setBoards(defaults); setCatalog([]); setFeedback([]); setPreferences(defaultPreferences); setActiveBoardId(defaults[0].id); setSelectedBoardId(defaults[0].id);
    setStatus("All app data on this device was deleted.");
  }

  async function installApp() {
    await installPrompt?.prompt();
    const choice = await installPrompt?.userChoice;
    if (choice?.outcome === "accepted") setInstallPrompt(null);
  }

  async function clearPrivateModel() {
    try {
      const { clearPrivateModelCache } = await import("@/lib/local-vision");
      await clearPrivateModelCache();
      setPrivateModelAvailable(false);
      setStatus("Downloaded private models removed.");
    } catch {
      setStatus("The private model cache could not be cleared.");
    }
  }

  function cancelBackupRestore() {
    setBackupData(null);
    setBackupFileName("");
    setBackupError(undefined);
  }

  function changeView(next: AppView) {
    captureSequenceRef.current += 1;
    requestSequenceRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    const preserveGuideSetup = guideMode && !guideResult && (
      (next === "settings" && view === "scan" && !showResult) ||
      (next === "scan" && view === "settings")
    );
    if (preserveGuideSetup) {
      invalidateGuideOperation();
      setGuideWarnings([]);
      setGuideRequestId(undefined);
      setClarificationAnswer("");
    } else {
      clearGuideState();
      setCurrentImage(null);
      setCard(null);
      setIsDemo(false);
      setContext("");
    }
    stopCamera();
    setScanState("idle");
    setProgress(0);
    setModelMessage(undefined);
    setStatus(next === "settings"
      ? "Choose how recognition and guidance should run."
      : next === "saved"
        ? `${totalSaved} saved object${totalSaved === 1 ? "" : "s"}.`
        : preserveGuideSetup
          ? "Guide setup restored. Review the goal and privacy mode."
          : "Ready when your object is.");
    setView(next);
    setShowResult(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="appShell">
      {turnstileSiteKey && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={() => setTurnstileReady(true)}
        />
      )}
      <header className="topBar">
        <button className="wordmark" onClick={() => changeView("scan")} aria-label="What Is This home">
          What Is This?
        </button>
        <span className={`statusDot ${scanState === "error" ? "error" : ""}`} aria-hidden="true" />
      </header>
      <div className={`globalStatus ${scanState === "error" ? "error" : ""}`} role="status" aria-live="polite">
        {status}
      </div>

      {view === "scan" && !showResult && (
        <ScanView
          videoRef={videoRef}
          canvasRef={canvasRef}
          fileInputRef={fileInputRef}
          turnstileContainerRef={guideMode ? guideTurnstileContainerRef : identifyTurnstileContainerRef}
          currentImage={currentImage}
          currentImageIsReferenceOnly={Boolean(guideSourceCard && !isGuideImageDataUrl(currentImage))}
          scanState={scanState}
          cameraReady={cameraReady}
          progress={progress}
          holdSeconds={holdSeconds}
          context={context}
          intent={guideIntent}
          goal={guideGoal}
          goalError={guideGoalError}
          guideBlockedReason={guideBlockedReason}
          securityNeeded={Boolean(turnstileSiteKey)
            && preferences.providerChoice !== "device"
            && (!guideMode || (preferences.providerChoice !== "classifier" && guideProviderAvailable))}
          securityReady={securityReady}
          privacyMode={preferences.providerChoice === "device" ? "device" : "remote"}
          modelMessage={modelMessage}
          canRetry={Boolean(currentImage || (guideMode && guideSourceCard))}
          onStartCamera={() => void startCamera()}
          onScan={() => void scanObject()}
          onUpload={openUploadPicker}
          onUseCurrentImage={() => {
            const selectedImage = currentImage || guideSourceCard?.image || "";
            if (selectedImage || (guideMode && guideSourceCard)) void runSelectedIntent(selectedImage, guideSourceCard);
          }}
          onRetry={() => void retryIdentification()}
          onOpenSettings={() => changeView("settings")}
          onFile={(file) => void handleFile(file)}
          onHoldSeconds={setHoldSeconds}
          onContext={setContext}
          onIntent={selectGuideIntent}
          onGoal={(value) => { setGuideGoal(value); if (value.trim()) setGuideGoalError(undefined); }}
          onCancelGuideSetup={guideSourceCard ? backToIdentification : undefined}
        />
      )}
      {view === "scan" && showResult && guideResult && (
        <GuideResultView
          result={guideResult}
          image={isGuideImageDataUrl(currentImage) ? currentImage : undefined}
          providerWarnings={guideWarnings}
          requestId={guideRequestId}
          clarificationAnswer={clarificationAnswer}
          clarificationBusy={guideBusy}
          clarificationError={guideClarificationError}
          securityNeeded={Boolean(turnstileSiteKey)
            && preferences.providerChoice !== "device"
            && preferences.providerChoice !== "classifier"
            && guideProviderAvailable}
          securityReady={securityReady}
          turnstileContainerRef={guideTurnstileContainerRef}
          hasIdentification={Boolean(guideSourceCard)}
          canIdentifyImage={isGuideImageDataUrl(currentImage)}
          onClarificationAnswer={(value) => { setClarificationAnswer(value); setGuideClarificationError(undefined); }}
          onClarify={() => void clarifyGuide()}
          onBackToIdentification={backToIdentification}
          onIdentifyImage={() => void identifyGuideImage()}
          onScanAnother={resetScan}
        />
      )}
      {view === "scan" && showResult && !guideResult && card && (
        <ResultView
          card={card}
          boards={boards}
          selectedBoardId={selectedBoardId}
          newBoardName={newBoardName}
          correctionName={correctionName}
          correctionCategory={correctionCategory}
          correctionNotes={correctionNotes}
          saveFeedbackPhotos={preferences.saveFeedbackPhotos}
          saved={saved}
          isDemo={isDemo}
          onConfirm={confirmCard}
          onCorrect={() => void correctCard()}
          onSave={() => void saveCard()}
          onScanAnother={resetScan}
          onShare={() => void shareCard()}
          onIgnoreLearning={() => void ignoreLearning()}
          onSelectedBoard={setSelectedBoardId}
          onNewBoardName={setNewBoardName}
          onCorrectionName={setCorrectionName}
          onCorrectionCategory={setCorrectionCategory}
          onCorrectionNotes={setCorrectionNotes}
          onFeedbackPhotos={(value) => updatePreferences({ saveFeedbackPhotos: value })}
          onTags={(tags) => setCard((current) => current ? { ...current, tags } : current)}
          onStartGuide={startGuideFromCard}
        />
      )}
      {view === "saved" && (
        <SavedView
          boards={boards}
          activeBoardId={activeBoardId}
          query={savedQuery}
          favoritesOnly={favoritesOnly}
          onActiveBoard={setActiveBoardId}
          onQuery={setSavedQuery}
          onFavoritesOnly={setFavoritesOnly}
          onView={(item) => {
            captureSequenceRef.current += 1;
            requestSequenceRef.current += 1;
            requestControllerRef.current?.abort();
            clearGuideState();
            setCard(item);
            setCurrentImage(item.image);
            setContext("");
            setSaved(true);
            setIsDemo(false);
            setScanState("done");
            setView("scan");
            setShowResult(true);
            setStatus(`Viewing the saved identification: ${item.shortName}.`);
            window.scrollTo({ top: 0 });
          }}
          onFavorite={(item) => void toggleFavorite(item)}
          onRemove={(item) => void removeCard(item)}
          onClearBoard={() => void clearBoard()}
          onScan={() => changeView("scan")}
          onPreviewExample={() => {
            captureSequenceRef.current += 1;
            requestSequenceRef.current += 1;
            requestControllerRef.current?.abort();
            clearGuideState();
            setCard(demoCard);
            setCurrentImage(demoCard.image);
            setContext("");
            setSaved(false);
            setIsDemo(true);
            setScanState("done");
            setView("scan");
            setShowResult(true);
            setStatus("Previewing an example. Nothing here is saved.");
            window.scrollTo({ top: 0 });
          }}
        />
      )}
      {view === "settings" && (
        <SettingsView
          cloudEnabled={cloudEnabled}
          cloudUser={cloudUser}
          cloudStatus={cloudStatus}
          authEmail={authEmail}
          authBusy={authBusy}
          providerChoice={preferences.providerChoice}
          availableProviders={availableProviders}
          textAssist={preferences.textAssist}
          saveFeedbackPhotos={preferences.saveFeedbackPhotos}
          backendLabel={backendHealth.label}
          backendDetail={backendHealth.detail}
          backendOk={backendHealth.ok}
          privateModelAvailable={privateModelAvailable}
          installAvailable={Boolean(installPrompt)}
          installed={isInstalled}
          feedback={feedback}
          catalog={catalog}
          pendingCloudChanges={pendingCloudChanges}
          lastSyncAt={lastSyncAt}
          backupPreview={backupData ? {
            fileName: backupFileName,
            boards: backupData.boards.length,
            objects: backupData.boards.reduce((sum, board) => sum + board.items.length, 0),
            corrections: backupData.catalog.length,
            reviews: backupData.feedback.length,
          } : null}
          backupError={backupError}
          onAuthEmail={setAuthEmail}
          onMagicLink={() => void sendMagicLink()}
          onSignOut={() => void signOut()}
          onSync={() => void syncCloud()}
          onProvider={(value) => updatePreferences({ providerChoice: value })}
          onTextAssist={(value) => updatePreferences({ textAssist: value })}
          onFeedbackPhotos={(value) => updatePreferences({ saveFeedbackPhotos: value })}
          onInstall={() => void installApp()}
          onExport={exportData}
          onBackupFile={(file) => void previewBackup(file)}
          onApplyBackup={() => void applyBackup()}
          onCancelBackup={cancelBackupRestore}
          onDeleteLocal={() => void deleteDeviceData()}
          onClearModel={() => void clearPrivateModel()}
          onUpdateCatalog={(entry) => void updateCatalogEntry(entry)}
          onRemoveCatalog={(id) => void removeCatalogEntry(id)}
        />
      )}
      <AppNavigation active={view} savedCount={totalSaved} onChange={changeView} />
    </main>
  );
}
