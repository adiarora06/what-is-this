import type { ObjectCard, StoryboardBoard } from "@/lib/types";

type Props = {
  boards: StoryboardBoard[];
  activeBoardId: string;
  query: string;
  favoritesOnly: boolean;
  onActiveBoard: (id: string) => void;
  onQuery: (value: string) => void;
  onFavoritesOnly: (value: boolean) => void;
  onView: (card: ObjectCard) => void;
  onFavorite: (card: ObjectCard) => void;
  onRemove: (card: ObjectCard) => void;
  onClearBoard: () => void;
  onScan: () => void;
  onPreviewExample: () => void;
};

export function SavedView(props: Props) {
  const activeBoard = props.boards.find((board) => board.id === props.activeBoardId) || props.boards[0];
  const totalItems = props.boards.reduce((sum, board) => sum + board.items.length, 0);
  const normalizedQuery = props.query.trim().toLowerCase();
  const items = (activeBoard?.items || []).filter((item) => {
    if (props.favoritesOnly && !item.favorite) return false;
    if (!normalizedQuery) return true;
    return [item.objectName, item.category, ...(item.tags || [])].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
  return (
    <section className="viewStack savedView" aria-labelledby="saved-heading">
      <header className="viewIntro compact">
        <p className="eyebrow">Your library</p>
        <h1 id="saved-heading" tabIndex={-1}>Saved objects</h1>
        <p>Search, favorite, and organize everything you have confirmed.</p>
      </header>
      <div className="storyboardPanel">
        <div className="boardTabs" role="tablist" aria-label="Saved boards">
          {props.boards.map((board) => <button key={board.id} role="tab" aria-selected={board.id === activeBoard?.id} className={board.id === activeBoard?.id ? "active" : ""} onClick={() => props.onActiveBoard(board.id)}>{board.name}<span>{board.items.length}</span></button>)}
        </div>
        <div className="savedTools">
          <label className="searchField">Search saved objects<input type="search" maxLength={120} value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder="Name, category, or tag" /></label>
          <label className="toggleField"><input type="checkbox" checked={props.favoritesOnly} onChange={(event) => props.onFavoritesOnly(event.target.checked)} /> Favorites only</label>
        </div>
        {!items.length ? (
          <div className="emptyState">
            <h2>{activeBoard?.items.length ? "No matches here" : totalItems ? "This board is empty" : "Build your first reference"}</h2>
            <p>{activeBoard?.items.length ? "Try a broader search or turn off the favorite filter." : totalItems ? "Save a confirmed scan to this board when you want to find it again." : "A saved reference keeps the answer, visible clues, care guidance, and your corrections together."}</p>
            {!totalItems && (
              <ol className="emptySteps" aria-label="How saved references work">
                <li><strong>Capture</strong><span>Take or upload a clear photo.</span></li>
                <li><strong>Confirm</strong><span>Check the answer or teach the app a correction.</span></li>
                <li><strong>Reuse</strong><span>Save it to a searchable board for later.</span></li>
              </ol>
            )}
            {!activeBoard?.items.length && (
              <div className="emptyActions">
                {!totalItems && <button className="secondaryButton" onClick={props.onPreviewExample}>Preview an example</button>}
                <button className="primaryButton" onClick={props.onScan}>{totalItems ? "Scan an object" : "Scan your first object"}</button>
              </div>
            )}
          </div>
        ) : (
          <div className="storyboardGrid">
            {items.map((item) => (
              <article className="storyItem" key={item.id}>
                {item.image ? <img src={item.image} alt="" /> : <div className="imagePlaceholder">No image</div>}
                <div><h2>{item.objectName}</h2><span>{item.category} · {new Date(item.createdAt).toLocaleDateString()}</span>{item.tags?.length ? <small>{item.tags.join(" · ")}</small> : null}</div>
                <button className="favoriteButton" aria-label={item.favorite ? `Remove ${item.objectName} from favorites` : `Add ${item.objectName} to favorites`} aria-pressed={Boolean(item.favorite)} onClick={() => props.onFavorite(item)}>{item.favorite ? "Favorited" : "Favorite"}</button>
                <div className="storyActions"><button onClick={() => props.onView(item)}>View</button><button className="dangerText" onClick={() => props.onRemove(item)}>Remove</button></div>
              </article>
            ))}
          </div>
        )}
        {activeBoard?.items.length ? <button className="textButton dangerText" onClick={props.onClearBoard}>Clear this board</button> : null}
      </div>
    </section>
  );
}
