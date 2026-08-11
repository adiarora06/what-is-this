"use client";

import { useState } from "react";
import type { AccuracyFeedback, CatalogEntry, IdentificationProvider } from "@/lib/types";

export type SettingsUser = { id: string; email?: string } | null;

type Props = {
  cloudEnabled: boolean;
  cloudUser: SettingsUser;
  cloudStatus: string;
  authEmail: string;
  authBusy: boolean;
  providerChoice: IdentificationProvider;
  availableProviders: IdentificationProvider[];
  textAssist: boolean;
  saveFeedbackPhotos: boolean;
  backendLabel: string;
  backendDetail?: string;
  backendOk: boolean;
  privateModelAvailable: boolean | null;
  installAvailable: boolean;
  installed: boolean;
  feedback: AccuracyFeedback[];
  catalog: CatalogEntry[];
  pendingCloudChanges: number;
  lastSyncAt: string | null;
  backupPreview: { fileName: string; boards: number; objects: number; corrections: number; reviews: number } | null;
  backupError?: string;
  onAuthEmail: (value: string) => void;
  onMagicLink: () => void;
  onSignOut: () => void;
  onSync: () => void;
  onProvider: (value: IdentificationProvider) => void;
  onTextAssist: (value: boolean) => void;
  onFeedbackPhotos: (value: boolean) => void;
  onInstall: () => void;
  onExport: () => void;
  onDeleteLocal: () => void;
  onClearModel: () => void;
  onBackupFile: (file?: File) => void;
  onApplyBackup: () => void;
  onCancelBackup: () => void;
  onUpdateCatalog: (entry: CatalogEntry) => void;
  onRemoveCatalog: (id: string) => void;
};

const providerNames: Record<IdentificationProvider, string> = {
  auto: "Best available",
  device: "On-device only",
  gemini: "Gemini vision",
  classifier: "Private server classifier",
};

const providerHelp: Record<Exclude<IdentificationProvider, "device">, string> = {
  auto: "Uses compatible cloud services when available; object identification falls back to private on-device recognition.",
  gemini: "Sends the selected image to the configured Gemini service for recognition and guided help.",
  classifier: "Sends the selected image to the private server classifier for identification. Guided answers are unavailable in this mode.",
};

export default function SettingsView(props: Props) {
  const correct = props.feedback.filter((item) => item.wasCorrect).length;
  return (
    <section className="viewStack settingsView" aria-labelledby="settings-heading">
      <header className="viewIntro compact">
        <p className="eyebrow">Control center</p>
        <h1 id="settings-heading" tabIndex={-1}>Settings</h1>
        <p>Choose where recognition runs, what gets stored, and whether your library syncs.</p>
      </header>

      <section className="settingsPanel" aria-labelledby="privacy-heading">
        <div className="sectionHeading"><div><p className="eyebrow">Privacy</p><h2 id="privacy-heading">Recognition & data</h2></div><span className={`backendPill ${props.backendOk ? "" : "offline"}`}>{props.backendLabel}</span></div>
        {props.backendDetail && <p className="supportingText">{props.backendDetail}</p>}
        <label className="settingField">Recognition mode<select value={props.providerChoice} onChange={(event) => props.onProvider(event.target.value as IdentificationProvider)}>{props.availableProviders.map((provider) => <option key={provider} value={provider}>{providerNames[provider]}</option>)}</select><small>{props.providerChoice === "device" ? props.privateModelAvailable ? "Images remain in this browser. The verified model is downloaded and ready offline." : "Images remain in this browser. The first scan downloads a verified model of about 13 MB." : providerHelp[props.providerChoice]}</small></label>
        <label className="settingToggle"><span><strong>Read visible text</strong><small>Uses optional on-device OCR to make labels and packaging easier to identify.</small></span><input type="checkbox" checked={props.textAssist} onChange={(event) => props.onTextAssist(event.target.checked)} /></label>
        <label className="settingToggle"><span><strong>Include photos in feedback</strong><small>Off by default. You can still confirm or correct without sharing a photo.</small></span><input type="checkbox" checked={props.saveFeedbackPhotos} onChange={(event) => props.onFeedbackPhotos(event.target.checked)} /></label>
        <button className="secondaryButton" onClick={props.onClearModel} disabled={props.privateModelAvailable === false}>Remove downloaded private models</button>
      </section>

      <section className="settingsPanel" aria-labelledby="account-heading">
        <div className="sectionHeading"><div><p className="eyebrow">Optional</p><h2 id="account-heading">Sync across devices</h2></div></div>
        {!props.cloudEnabled ? (
          <p className="emptyState">Cloud sync is not configured. Everything remains saved on this device.</p>
        ) : props.cloudUser ? (
          <div className="accountStack"><p>Signed in as <strong>{props.cloudUser.email || "your account"}</strong></p><span className="supportingText">{props.cloudStatus}</span><span className="supportingText">{props.pendingCloudChanges ? `${props.pendingCloudChanges} local change${props.pendingCloudChanges === 1 ? "" : "s"} waiting to sync.` : props.lastSyncAt ? `Last synced ${new Date(props.lastSyncAt).toLocaleString()}.` : "No completed sync on this device yet."}</span><div className="buttonRow"><button className="primaryButton" onClick={props.onSync}>Sync now</button><button className="secondaryButton" onClick={props.onSignOut}>Sign out</button></div></div>
        ) : (
          <div className="accountStack">
            <p>Get a secure sign-in link by email. No password is stored in this app.</p>
            <label>Email address<input type="email" inputMode="email" autoComplete="email" maxLength={254} value={props.authEmail} onChange={(event) => props.onAuthEmail(event.target.value)} placeholder="you@example.com" /></label>
            <button className="primaryButton" disabled={props.authBusy || !props.authEmail.trim()} onClick={props.onMagicLink}>{props.authBusy ? "Sending…" : "Email me a sign-in link"}</button>
            <span className="supportingText" role="status">{props.cloudStatus}</span>
          </div>
        )}
      </section>

      <section className="settingsPanel" aria-labelledby="app-heading">
        <div className="sectionHeading"><div><p className="eyebrow">This device</p><h2 id="app-heading">App & backups</h2></div></div>
        {!props.installed && props.installAvailable && <button className="primaryButton" onClick={props.onInstall}>Install this app</button>}
        {props.installed && <p className="successText">The app is installed on this device.</p>}
        <div className="buttonRow"><button className="secondaryButton" onClick={props.onExport}>Export a backup</button><label className="backupPicker">Restore a backup<input className="srOnly" type="file" accept="application/json,.json" onChange={(event) => { props.onBackupFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div>
        {props.backupError && <p className="inlineError" role="alert">{props.backupError}</p>}
        {props.backupPreview && <section className="restorePreview" aria-labelledby="restore-heading"><h3 id="restore-heading">Review {props.backupPreview.fileName}</h3><p>{props.backupPreview.boards} boards · {props.backupPreview.objects} objects · {props.backupPreview.corrections} corrections · {props.backupPreview.reviews} reviews</p><p>This replaces the data currently stored on this device. Export first if you need a rollback copy.</p><div className="buttonRow"><button className="primaryButton" onClick={props.onApplyBackup}>Replace device data</button><button className="secondaryButton" onClick={props.onCancelBackup}>Cancel</button></div></section>}
        <button className="secondaryButton dangerText" onClick={props.onDeleteLocal}>Delete device data</button>
      </section>

      <details className="settingsPanel labsPanel">
        <summary>Labs & learning</summary>
        <p className="supportingText">Diagnostics and corrections are tucked away from the main scanning flow.</p>
        <div className="accuracyStats"><div><strong>{props.feedback.length}</strong><span>reviews</span></div><div><strong>{correct}</strong><span>correct</span></div><div><strong>{props.catalog.length}</strong><span>learned</span></div></div>
        {props.catalog.length > 0 && <div className="catalogGrid">{props.catalog.slice(0, 12).map((entry) => <CatalogEditor key={`${entry.id}:${entry.updatedAt}`} entry={entry} onUpdate={props.onUpdateCatalog} onRemove={props.onRemoveCatalog} />)}</div>}
      </details>
    </section>
  );
}

function CatalogEditor({ entry, onUpdate, onRemove }: { entry: CatalogEntry; onUpdate: (entry: CatalogEntry) => void; onRemove: (id: string) => void }) {
  const [name, setName] = useState(entry.objectName);
  const [category, setCategory] = useState(entry.category);
  const [notes, setNotes] = useState(entry.notes);
  const dirty = name !== entry.objectName || category !== entry.category || notes !== entry.notes;
  return (
    <article className="catalogItem catalogEditor">
      {entry.image ? <img src={entry.image} alt="" /> : <div className="imagePlaceholder">No image</div>}
      <div className="catalogFields">
        <label>Name<input maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Category<input maxLength={120} value={category} onChange={(event) => setCategory(event.target.value)} /></label>
        <label>Note<textarea maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      </div>
      <div className="storyActions"><button disabled={!dirty || !name.trim()} onClick={() => onUpdate({ ...entry, objectName: name.trim(), category: category.trim(), notes: notes.trim(), updatedAt: new Date().toISOString() })}>Save changes</button><button className="dangerText" onClick={() => onRemove(entry.id)}>Forget</button></div>
    </article>
  );
}
