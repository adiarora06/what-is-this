import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLocalData, defaultPreferences, defaultStoryboardBoards, loadLocalData, parseBackup, saveBoards, savePreferences } from "@/lib/local-store";

const storage = new Map<string, string>();

beforeEach(async () => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  await clearLocalData();
});

afterEach(() => vi.unstubAllGlobals());

describe("local store", () => {
  it("migrates legacy boards and removes legacy values", async () => {
    const boards = defaultStoryboardBoards();
    storage.set("what-is-this-storyboard-boards", JSON.stringify(boards));
    storage.set("what-is-this-feedback-photo-consent", "true");

    const data = await loadLocalData();

    expect(data.boards).toHaveLength(2);
    expect(data.preferences.saveFeedbackPhotos).toBe(true);
    expect(storage.has("what-is-this-storyboard-boards")).toBe(false);
  });

  it("rejects corrupt legacy values and returns safe defaults", async () => {
    storage.set("what-is-this-storyboard-boards", "{broken");
    storage.set("what-is-this-accuracy-feedback", JSON.stringify([{ confidence: 42 }]));

    const data = await loadLocalData();

    expect(data.boards).toHaveLength(2);
    expect(data.feedback).toEqual([]);
  });

  it("persists validated records", async () => {
    const boards = defaultStoryboardBoards();
    boards[0].name = "Workbench";
    await saveBoards(boards);
    await savePreferences({ saveFeedbackPhotos: true, textAssist: true, providerChoice: "device" });

    const data = await loadLocalData();
    expect(data.boards[0].name).toBe("Workbench");
    expect(data.preferences).toEqual({ saveFeedbackPhotos: true, textAssist: true, providerChoice: "device" });
  });
});

describe("backup validation", () => {
  it("accepts a versioned exported backup", () => {
    const backup = parseBackup(JSON.stringify({ version: 1, exportedAt: new Date(0).toISOString(), boards: defaultStoryboardBoards(), catalog: [], feedback: [], preferences: defaultPreferences }));
    expect(backup.boards).toHaveLength(2);
    expect(backup.preferences.providerChoice).toBe("device");
  });

  it("rejects arbitrary JSON", () => {
    expect(() => parseBackup(JSON.stringify({ version: 1, secrets: true }))).toThrow("not a valid What Is This backup");
  });
});
