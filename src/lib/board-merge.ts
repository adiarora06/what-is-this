import type { ObjectCard, StoryboardBoard } from "@/lib/types";

function mergeCards(localItems: ObjectCard[], cloudItems: ObjectCard[]) {
  const byId = new Map(localItems.map((item) => [item.id, item]));
  for (const cloudItem of cloudItems) {
    const localItem = byId.get(cloudItem.id);
    byId.set(cloudItem.id, localItem
      ? { ...localItem, ...cloudItem, image: cloudItem.image || localItem.image }
      : cloudItem);
  }
  return Array.from(byId.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function mergeBoards(localBoards: StoryboardBoard[], cloudBoards: StoryboardBoard[]) {
  const byId = new Map(localBoards.map((board) => [board.id, board]));
  for (const cloudBoard of cloudBoards) {
    const localBoard = byId.get(cloudBoard.id);
    byId.set(cloudBoard.id, localBoard
      ? { ...localBoard, ...cloudBoard, items: mergeCards(localBoard.items, cloudBoard.items) }
      : cloudBoard);
  }
  return Array.from(byId.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
