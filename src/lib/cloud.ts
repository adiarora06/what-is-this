import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { purchaseLinksFor, shoppingRecommendedForCategory } from "@/lib/links";
import type { AccuracyFeedback, ObjectCard, StoryboardBoard } from "@/lib/types";

const IMAGE_BUCKET = "scan-images";

type BoardRow = {
  id: string;
  name: string;
  created_at: string;
};

type ObjectRow = {
  id: string;
  storyboard_id: string;
  object_name: string;
  category: string;
  confidence: number;
  source: string | null;
  image_path: string | null;
  payload: Partial<ObjectCard>;
  created_at: string;
};

let browserClient: SupabaseClient | null = null;

export type CloudUser = Pick<User, "id" | "email">;

export function isCloudConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export function getSupabaseBrowserClient() {
  if (!isCloudConfigured()) return null;
  if (!browserClient) {
    browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
  }
  return browserClient;
}

function requireClient() {
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("Cloud storyboards are not configured.");
  return client;
}

function extensionForMime(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function dataUrlToBlob(dataUrl: string) {
  const [header, encoded] = dataUrl.split(",", 2);
  const mimeType = header.match(/^data:([^;]+);base64$/)?.[1];
  if (!mimeType || !encoded) throw new Error("The saved image is not a valid data URL.");
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

async function uploadCardImage(client: SupabaseClient, userId: string, card: ObjectCard, folder = "objects") {
  if (card.storagePath) return card.storagePath;
  if (!card.image.startsWith("data:image/")) return null;

  const blob = dataUrlToBlob(card.image);
  const path = `${userId}/${folder}/${card.id}.${extensionForMime(blob.type)}`;
  const { error } = await client.storage.from(IMAGE_BUCKET).upload(path, blob, {
    cacheControl: "31536000",
    contentType: blob.type,
    upsert: true,
  });
  if (error) throw error;
  return path;
}

async function signedImageUrls(client: SupabaseClient, paths: string[]) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  if (!uniquePaths.length) return new Map<string, string>();
  const { data, error } = await client.storage.from(IMAGE_BUCKET).createSignedUrls(uniquePaths, 60 * 60);
  if (error) throw error;
  return new Map((data || []).filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]));
}

export async function loadCloudBoards(userId: string): Promise<StoryboardBoard[]> {
  const client = requireClient();
  const [boardsResult, objectsResult] = await Promise.all([
    client.from("storyboards").select("id,name,created_at").eq("user_id", userId).order("created_at"),
    client
      .from("saved_objects")
      .select("id,storyboard_id,object_name,category,confidence,source,image_path,payload,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  if (boardsResult.error) throw boardsResult.error;
  if (objectsResult.error) throw objectsResult.error;

  const boardRows = (boardsResult.data || []) as BoardRow[];
  const objectRows = (objectsResult.data || []) as ObjectRow[];
  const imageUrls = await signedImageUrls(client, objectRows.map((row) => row.image_path || ""));

  return boardRows.map((board) => ({
    id: board.id,
    name: board.name,
    createdAt: board.created_at,
    items: objectRows
      .filter((row) => row.storyboard_id === board.id)
      .map((row) => {
        const payload = row.payload || {};
        const purchaseQuery = payload.purchaseQuery || row.object_name;
        const shoppingRecommended = payload.shoppingRecommended ?? shoppingRecommendedForCategory(row.category);
        return {
          id: row.id,
          createdAt: row.created_at,
          image: (row.image_path && imageUrls.get(row.image_path)) || "",
          objectName: row.object_name,
          shortName: payload.shortName || row.object_name,
          confidence: row.confidence,
          category: row.category,
          about: payload.about || "Saved object",
          visualClues: payload.visualClues || [],
          useCases: payload.useCases || [],
          careTips: payload.careTips || [],
          purchaseQuery,
          shoppingRecommended,
          purchaseLinks: shoppingRecommended ? payload.purchaseLinks || purchaseLinksFor(purchaseQuery) : [],
          safetyNote: payload.safetyNote,
          source: row.source || payload.source,
          correctedFrom: payload.correctedFrom,
          detections: payload.detections,
          alternatives: payload.alternatives,
          storagePath: row.image_path || undefined,
        } satisfies ObjectCard;
      }),
  }));
}

export async function saveCloudCard(userId: string, board: StoryboardBoard, card: ObjectCard) {
  const client = requireClient();
  const { error: boardError } = await client.from("storyboards").upsert(
    { id: board.id, user_id: userId, name: board.name, created_at: board.createdAt, updated_at: new Date().toISOString() },
    { onConflict: "user_id,id" },
  );
  if (boardError) throw boardError;

  const imagePath = await uploadCardImage(client, userId, card);
  const { image: _image, storagePath: _storagePath, ...payload } = card;
  const { error: objectError } = await client.from("saved_objects").upsert(
    {
      id: card.id,
      user_id: userId,
      storyboard_id: board.id,
      object_name: card.objectName,
      category: card.category,
      confidence: card.confidence,
      source: card.source || null,
      image_path: imagePath,
      payload,
      created_at: card.createdAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,id" },
  );
  if (objectError) throw objectError;
  return imagePath || undefined;
}

export async function syncCloudBoards(userId: string, boards: StoryboardBoard[], onProgress?: (done: number, total: number) => void) {
  const cards = boards.flatMap((board) => board.items.map((card) => ({ board, card })));
  if (!cards.length) {
    const client = requireClient();
    const { error } = await client.from("storyboards").upsert(
      boards.map((board) => ({ id: board.id, user_id: userId, name: board.name, created_at: board.createdAt })),
      { onConflict: "user_id,id" },
    );
    if (error) throw error;
    return;
  }

  for (let index = 0; index < cards.length; index += 1) {
    await saveCloudCard(userId, cards[index].board, cards[index].card);
    onProgress?.(index + 1, cards.length);
  }
}

export async function deleteCloudCard(userId: string, boardId: string, card: ObjectCard) {
  const client = requireClient();
  const { error } = await client
    .from("saved_objects")
    .delete()
    .eq("user_id", userId)
    .eq("storyboard_id", boardId)
    .eq("id", card.id);
  if (error) throw error;
  if (card.storagePath) {
    const { error: storageError } = await client.storage.from(IMAGE_BUCKET).remove([card.storagePath]);
    if (storageError) throw storageError;
  }
}

export async function clearCloudBoard(userId: string, board: StoryboardBoard) {
  const client = requireClient();
  const paths = board.items.map((item) => item.storagePath).filter((path): path is string => Boolean(path));
  const { error } = await client.from("saved_objects").delete().eq("user_id", userId).eq("storyboard_id", board.id);
  if (error) throw error;
  if (paths.length) {
    const { error: storageError } = await client.storage.from(IMAGE_BUCKET).remove(paths);
    if (storageError) throw storageError;
  }
}

export async function saveCloudFeedback(userId: string, card: ObjectCard, feedback: AccuracyFeedback) {
  const client = requireClient();
  const imagePath = card.storagePath || (await uploadCardImage(client, userId, card, "feedback"));
  const { error } = await client.from("scan_feedback").upsert(
    {
      id: feedback.id,
      user_id: userId,
      predicted_name: feedback.predictedName,
      corrected_name: feedback.correctedName || null,
      category: feedback.category,
      confidence: feedback.confidence,
      source: feedback.source,
      was_correct: feedback.wasCorrect,
      image_path: imagePath,
      created_at: feedback.createdAt,
    },
    { onConflict: "user_id,id" },
  );
  if (error) throw error;
}
