import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chrome Extension Privacy Policy | What Is This?",
  description: "Privacy practices for the What Is This? Guide Chrome extension.",
};

const permissions = [
  {
    name: "activeTab",
    purpose: "Captures the visible pixels of the active tab only after you invoke the extension on that tab.",
  },
  {
    name: "sidePanel",
    purpose: "Shows the capture disclosure, preview, and guide beside the page you are viewing.",
  },
  {
    name: "storage",
    purpose: "Keeps the current capture, typed context, and guide in session storage for the current Chrome session.",
  },
] as const;

export default function PrivacyPage() {
  return (
    <main className="privacyPolicyPage">
      <header className="privacyPolicyHeader">
        <a className="privacyPolicyHome" href="/" aria-label="Back to What Is This?">
          <span aria-hidden="true">←</span> What Is This?
        </a>
        <p className="eyebrow">Chrome extension</p>
        <h1>Privacy policy</h1>
        <p className="privacyPolicyLead">
          What Is This? Guide helps you capture the visible part of a tab and create a contextual guide without sending that capture away from your device.
        </p>
        <p className="privacyPolicyDate">Last updated August 11, 2026</p>
      </header>

      <section className="privacyPolicyCard" aria-labelledby="scope-heading">
        <h2 id="scope-heading">What this policy covers</h2>
        <p>
          This policy covers version 0.3.0 of the What Is This? Guide Chrome extension. Its single purpose is to turn a user-requested screenshot into a private, structured guide for identifying, explaining, troubleshooting, comparing, or completing a process.
        </p>
      </section>

      <section className="privacyPolicyCard" aria-labelledby="data-heading">
        <h2 id="data-heading">Information handled by the extension</h2>
        <p>The extension handles only the information needed to create the guide:</p>
        <ul>
          <li>A screenshot of the visible area of the active tab, captured only after a user action.</li>
          <li>Text you enter, such as a goal or clarification answer.</li>
          <li>The resulting guide and its processing status.</li>
        </ul>
        <p>
          The extension does not separately access page URLs, page titles, selected text, DOM content, form fields, cookies, the password manager, authentication APIs, browsing history, or activity from tabs running in the background.
        </p>
        <p>
          A screenshot includes everything currently visible and can therefore contain personal information, messages, usernames, security codes, financial details, or health information. Review the page before capturing it, use the crop when helpful, and do not capture a page showing passwords, authentication codes, private communications, or other sensitive records.
        </p>
      </section>

      <section className="privacyPolicyCard" aria-labelledby="processing-heading">
        <h2 id="processing-heading">On-device processing</h2>
        <p>
          On supported devices, your screenshot and text are processed by Chrome&apos;s built-in on-device LanguageModel API. Chrome may download the model needed for this feature, but the screenshot, your text, and the generated guide are not transmitted to What Is This? servers, Google, or another third party for processing.
        </p>
        <p>
          The extension contains no remote scripts and does not upload captures. It does not sell data, use data for advertising or credit decisions, or make extension data available for human review.
        </p>
      </section>

      <section className="privacyPolicyCard" aria-labelledby="retention-heading">
        <h2 id="retention-heading">Storage, retention, and deletion</h2>
        <p>
          The current screenshot, text, and guide are kept in <code>chrome.storage.session</code> for the applicable standard Chrome window. They are removed when you choose Start over, when that window closes, or when the Chrome browser session ends.
        </p>
        <p>
          Version 0.3.0 writes no captures, typed context, guides, or settings to local or synchronized storage. When updating from the earlier preview build, it deletes that build&apos;s obsolete local processing-mode preference. Reloading, updating, disabling, or removing the extension also clears its session storage.
        </p>
      </section>

      <section className="privacyPolicyCard" aria-labelledby="permissions-heading">
        <h2 id="permissions-heading">Why each Chrome permission is needed</h2>
        <dl className="privacyPolicyPermissions">
          {permissions.map((permission) => (
            <div key={permission.name}>
              <dt><code>{permission.name}</code></dt>
              <dd>{permission.purpose}</dd>
            </div>
          ))}
        </dl>
        <p>The extension requests no broad host access and cannot continuously read the sites you visit.</p>
      </section>

      <section className="privacyPolicyCard privacyPolicyCommitment" aria-labelledby="limited-use-heading">
        <h2 id="limited-use-heading">Chrome Web Store Limited Use</h2>
        <p>
          The use of information received from Chrome APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.
        </p>
        <p>
          Information is used only to provide the extension&apos;s user-facing guide. It is not transferred, sold, used for personalized advertising, or made available to people to read.
        </p>
      </section>

      <section className="privacyPolicyCard" aria-labelledby="changes-heading">
        <h2 id="changes-heading">Changes and questions</h2>
        <p>
          Material changes to these practices will be disclosed before the changed behavior is used and will be reflected on this page. To ask a privacy question or report a concern, open an issue in the project&apos;s public GitHub repository.
        </p>
        <p>Do not include a screenshot or other sensitive information in a public issue.</p>
        <a className="privacyPolicyContact" href="https://github.com/adiarora06/what-is-this/issues">
          Contact us through GitHub Issues
        </a>
      </section>

      <footer className="privacyPolicyFooter">
        <p>What Is This? Guide · Chrome extension version 0.3.0</p>
      </footer>
    </main>
  );
}
