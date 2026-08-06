import { z } from "zod";
import type { AccuracyFeedback, CatalogEntry, IdentificationProvider, StoryboardBoard } from "@/lib/types";

const DATABASE_NAME = "what-is-this";
const DATABASE_VERSION = 1;
const STORE_NAME = "state";
const FALLBACK_KEY = "what-is-this-state-v1";

const LEGACY_KEYS = {
  storyboard: "what-is-this-storyboard",
  boards: "what-is-this-storyboard-boards",
  catalog: "what-is-this-catalog",
  feedback: "what-is-this-accuracy-feedback",
  consent: "what-is-this-feedback-photo-consent",
} as const;

const purchaseLinkSchema = z.object({ label: z.string().max(80), url: z.string().url().max(2_048) });
const objectCardSchema = z.object({
  id: z.string().min(1).max(160),
  createdAt: z.string().max(80),
  image: z.string().max(4_000_000),
  objectName: z.string().min(1).max(160),
  shortName: z.string().min(1).max(160),
  confidence: z.number().min(0).max(1),
  category: z.string().max(120),
  about: z.string().max(1_500),
  visualClues: z.array(z.string().max(300)).max(12),
  useCases: z.array(z.string().max(300)).max(12),
  careTips: z.array(z.string().max(300)).max(12),
  purchaseQuery: z.string().max(300),
  purchaseLinks: z.array(purchaseLinkSchema).max(8),
  shoppingRecommended: z.boolean(),
  verified: z.boolean().optional(),
  safetyNote: z.string().max(1_000).optional(),
  source: z.string().max(120).optional(),
  storagePath: z.string().max(1_000).optional(),
  correctedFrom: z.string().max(160).optional(),
  detections: z.array(z.object({ label: z.string().max(160), confidence: z.number(), bbox: z.array(z.number()).max(8) })).max(30).optional(),
  alternatives: z.array(z.object({ label: z.string().max(160), confidence: z.number(), source: z.string().max(120).optional() })).max(12).optional(),
  barcode: z.string().max(160).optional(),
  recognizedText: z.array(z.string().max(240)).max(10).optional(),
  tags: z.array(z.string().max(48)).max(12).optional(),
  favorite: z.boolean().optional(),
  visualSignature: z.array(z.number().finite()).length(64).optional(),
  learnedCorrection: z.object({
    catalogEntryId: z.string().max(160),
    originalObjectName: z.string().max(160),
    originalShortName: z.string().max(160),
    originalCategory: z.string().max(120),
    originalAbout: z.string().max(1_500),
    originalPurchaseQuery: z.string().max(300),
    originalPurchaseLinks: z.array(purchaseLinkSchema).max(8),
    originalShoppingRecommended: z.boolean(),
    originalVisualClues: z.array(z.string().max(300)).max(12),
  }).optional(),
});

const boardSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(80),
  createdAt: z.string().max(80),
  items: z.array(objectCardSchema).max(1_000),
});

const catalogEntrySchema = z.object({
  id: z.string().min(1).max(160),
  createdAt: z.string().max(80),
  updatedAt: z.string().max(80),
  objectName: z.string().min(1).max(160),
  category: z.string().max(120),
  notes: z.string().max(1_500),
  matchLabels: z.array(z.string().max(160)).max(30),
  fingerprint: z.string().length(16).optional(),
  visualSignature: z.array(z.number().finite()).length(64).optional(),
  image: z.string().max(1_000_000).optional(),
});

const feedbackSchema = z.object({
  id: z.string().min(1).max(160),
  createdAt: z.string().max(80),
  predictedName: z.string().max(160),
  correctedName: z.string().max(160).optional(),
  category: z.string().max(120),
  confidence: z.number().min(0).max(1),
  source: z.string().max(120),
  wasCorrect: z.boolean(),
  image: z.string().max(1_000_000).optional(),
  storagePath: z.string().max(1_000).optional(),
});

export const preferencesSchema = z.object({
  saveFeedbackPhotos: z.boolean().default(false),
  textAssist: z.boolean().default(false),
  providerChoice: z.enum(["auto", "device", "gemini", "classifier"]).default("device"),
});

export type LocalPreferences = {
  saveFeedbackPhotos: boolean;
  textAssist: boolean;
  providerChoice: IdentificationProvider;
};

export type LocalData = {
  boards: StoryboardBoard[];
  catalog: CatalogEntry[];
  feedback: AccuracyFeedback[];
  preferences: LocalPreferences;
};

const schemas = {
  boards: z.array(boardSchema).max(100),
  catalog: z.array(catalogEntrySchema).max(2_000),
  feedback: z.array(feedbackSchema).max(5_000),
  preferences: preferencesSchema,
};

const backupSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().max(80),
  boards: schemas.boards,
  catalog: schemas.catalog,
  feedback: schemas.feedback,
  preferences: schemas.preferences,
});

type LocalDataKey = keyof typeof schemas;
let memoryState: Partial<Record<LocalDataKey, unknown>> = {};
let indexedDatabaseUnavailable = false;

export function defaultStoryboardBoards(): StoryboardBoard[] {
  const createdAt = new Date().toISOString();
  return [
    { id: "for-later", name: "For Later", createdAt, items: [] },
    { id: "shopping-ideas", name: "Shopping Ideas", createdAt, items: [] },
  ];
}

export const defaultPreferences: LocalPreferences = {
  saveFeedbackPhotos: false,
  textAssist: false,
  providerChoice: "device",
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    const timeout = globalThis.setTimeout(() => {
      indexedDatabaseUnavailable = true;
      reject(new Error("IndexedDB did not respond; using session storage instead."));
    }, 1_200);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      globalThis.clearTimeout(timeout);
      if (indexedDatabaseUnavailable) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => {
      globalThis.clearTimeout(timeout);
      indexedDatabaseUnavailable = true;
      reject(request.error || new Error("Local storage could not be opened."));
    };
    request.onblocked = () => {
      globalThis.clearTimeout(timeout);
      indexedDatabaseUnavailable = true;
      reject(new Error("Local storage is busy in another tab."));
    };
  });
}

function hasIndexedDatabase() {
  return !indexedDatabaseUnavailable && typeof indexedDB !== "undefined";
}

function readFallbackState() {
  if (typeof localStorage === "undefined") return memoryState;
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<LocalDataKey, unknown>>) : {};
  } catch {
    return {};
  }
}

async function getRecord(key: LocalDataKey) {
  if (!hasIndexedDatabase()) return readFallbackState()[key];
  const database = await openDatabase();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Local data could not be read."));
    });
  } finally {
    database.close();
  }
}

async function setRecord<T extends LocalDataKey>(key: T, value: LocalData[T]) {
  const parsed = schemas[key].parse(value);
  if (!hasIndexedDatabase()) {
    const next = { ...readFallbackState(), [key]: parsed };
    memoryState = next;
    if (typeof localStorage !== "undefined") localStorage.setItem(FALLBACK_KEY, JSON.stringify(next));
    return;
  }
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(parsed, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Local data could not be saved."));
      transaction.onabort = () => reject(transaction.error || new Error("Local data save was cancelled."));
    });
  } finally {
    database.close();
  }
}

function readLegacy<T>(key: string, schema: z.ZodType<T>, fallback: T) {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : fallback;
  } catch {
    return fallback;
  }
}

async function migrateLegacyData(): Promise<LocalData> {
  const defaultBoards = defaultStoryboardBoards();
  const oldCards = readLegacy(LEGACY_KEYS.storyboard, z.array(objectCardSchema).max(1_000), []);
  let boards = readLegacy(LEGACY_KEYS.boards, schemas.boards, []);
  if (!boards.length) {
    boards = defaultBoards;
    if (oldCards.length) boards[0] = { ...boards[0], items: oldCards };
  }
  const data: LocalData = {
    boards,
    catalog: readLegacy(LEGACY_KEYS.catalog, schemas.catalog, []),
    feedback: readLegacy(LEGACY_KEYS.feedback, schemas.feedback, []),
    preferences: {
      ...defaultPreferences,
      saveFeedbackPhotos: readLegacy(LEGACY_KEYS.consent, z.boolean(), false),
    },
  };

  await Promise.all((Object.keys(data) as LocalDataKey[]).map((key) => setRecord(key, data[key])));
  if (typeof localStorage !== "undefined") Object.values(LEGACY_KEYS).forEach((key) => localStorage.removeItem(key));
  return data;
}

export async function loadLocalData(): Promise<LocalData> {
  let records: unknown[];
  try {
    records = await Promise.all((Object.keys(schemas) as LocalDataKey[]).map((key) => getRecord(key)));
  } catch {
    indexedDatabaseUnavailable = true;
    records = (Object.keys(schemas) as LocalDataKey[]).map((key) => readFallbackState()[key]);
  }
  if (records.every((record) => record === undefined)) return migrateLegacyData();

  const [boardsRecord, catalogRecord, feedbackRecord, preferencesRecord] = records;
  const boardsResult = schemas.boards.safeParse(boardsRecord);
  const catalogResult = schemas.catalog.safeParse(catalogRecord);
  const feedbackResult = schemas.feedback.safeParse(feedbackRecord);
  const preferencesResult = schemas.preferences.safeParse(preferencesRecord);
  return {
    boards: boardsResult.success && boardsResult.data.length ? boardsResult.data : defaultStoryboardBoards(),
    catalog: catalogResult.success ? catalogResult.data : [],
    feedback: feedbackResult.success ? feedbackResult.data : [],
    preferences: preferencesResult.success ? preferencesResult.data : defaultPreferences,
  };
}

export function saveBoards(boards: StoryboardBoard[]) {
  return setRecord("boards", boards);
}

export function saveCatalog(catalog: CatalogEntry[]) {
  return setRecord("catalog", catalog);
}

export function saveFeedback(feedback: AccuracyFeedback[]) {
  return setRecord("feedback", feedback);
}

export function savePreferences(preferences: LocalPreferences) {
  return setRecord("preferences", preferences);
}

export async function saveLocalData(data: LocalData) {
  const parsed: LocalData = {
    boards: schemas.boards.parse(data.boards),
    catalog: schemas.catalog.parse(data.catalog),
    feedback: schemas.feedback.parse(data.feedback),
    preferences: schemas.preferences.parse(data.preferences),
  };
  await Promise.all((Object.keys(parsed) as LocalDataKey[]).map((key) => setRecord(key, parsed[key])));
  return parsed;
}

export function parseBackup(text: string): LocalData {
  if (text.length > 25_000_000) throw new Error("Choose a backup smaller than 25 MB.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  const result = backupSchema.safeParse(value);
  if (!result.success) throw new Error("This is not a valid What Is This backup.");
  return {
    boards: result.data.boards,
    catalog: result.data.catalog,
    feedback: result.data.feedback,
    preferences: result.data.preferences,
  };
}

export async function clearLocalData() {
  if (hasIndexedDatabase()) {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DATABASE_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error("Local data could not be deleted."));
      request.onblocked = () => reject(new Error("Close other open tabs before deleting local data."));
    });
  }
  memoryState = {};
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(FALLBACK_KEY);
    Object.values(LEGACY_KEYS).forEach((key) => localStorage.removeItem(key));
  }
}
