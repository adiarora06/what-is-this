"use client";

export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="appShell">
      <section className="errorPage">
        <p className="eyebrow">Something went wrong</p>
        <h1>Your saved objects are still safe.</h1>
        <p>The current screen could not finish loading. Try it again; if the problem continues, reopen the app.</p>
        <button className="primaryButton" onClick={reset}>Try again</button>
      </section>
    </main>
  );
}
