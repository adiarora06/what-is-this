export type AppView = "scan" | "saved" | "settings";

type Props = {
  active: AppView;
  savedCount: number;
  onChange: (view: AppView) => void;
};

export function AppNavigation({ active, savedCount, onChange }: Props) {
  return (
    <nav className="appNav" aria-label="Main navigation">
      <button className={active === "scan" ? "active" : ""} aria-current={active === "scan" ? "page" : undefined} onClick={() => onChange("scan")}>
        Scan
      </button>
      <button className={active === "saved" ? "active" : ""} aria-current={active === "saved" ? "page" : undefined} onClick={() => onChange("saved")}>
        Saved <span>{savedCount}</span>
      </button>
      <button className={active === "settings" ? "active" : ""} aria-current={active === "settings" ? "page" : undefined} onClick={() => onChange("settings")}>
        Settings
      </button>
    </nav>
  );
}
