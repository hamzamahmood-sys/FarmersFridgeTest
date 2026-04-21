"use client";

import { useState, useTransition } from "react";
import type { ToneSettings } from "./types";

type Props = {
  initialToneSettings: ToneSettings;
  pageError: string | null;
  pageSuccess: string | null;
  setPageError: (msg: string | null) => void;
  setPageSuccess: (msg: string | null) => void;
};

export function TonePage({ initialToneSettings, pageError, pageSuccess, setPageError, setPageSuccess }: Props) {
  const [toneSettings, setToneSettings] = useState<ToneSettings>(initialToneSettings);
  const [savePending, startSaveTransition] = useTransition();

  function saveToneSettings() {
    setPageError(null);
    setPageSuccess(null);

    startSaveTransition(async () => {
      try {
        const response = await fetch("/api/tone", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toneSettings)
        });

        const data = (await response.json()) as { tone?: ToneSettings; error?: string };
        if (!response.ok || !data.tone) {
          throw new Error(data.error || "Failed to save tone settings.");
        }

        setToneSettings(data.tone);
        setPageSuccess("Tone settings saved. New research runs will use this voice.");
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Failed to save tone settings.");
      }
    });
  }

  return (
    <>
      <header className="pageHeader">
        <div>
          <h1>Tone of Voice</h1>
          <p>Set the Farmers Fridge outbound style you want the AI to follow for future research and sequence generation.</p>
        </div>
      </header>

      {pageError ? <p className="error">{pageError}</p> : null}
      {pageSuccess ? <p className="success">{pageSuccess}</p> : null}

      <section className="toneGrid">
        <article className="dashboardPanel">
          <h2>How This Works</h2>
          <p>These settings feed directly into the outreach prompt. Keep the guidance concrete so the copy stays consistent across new account research runs.</p>
          <div className="summaryList">
            <div className="summaryRow">
              <span>Best for</span>
              <strong>Voice direction, phrasing examples, and red lines</strong>
            </div>
            <div className="summaryRow">
              <span>Applied to</span>
              <strong>Initial emails plus follow-ups</strong>
            </div>
            <div className="summaryRow">
              <span>Last updated</span>
              <strong>{toneSettings.updatedAt ? new Date(toneSettings.updatedAt).toLocaleString() : "Not yet saved"}</strong>
            </div>
          </div>
        </article>

        <section className="draftEditor toneEditor">
          <div className="draftField">
            <label>Voice Description</label>
            <textarea
              value={toneSettings.voiceDescription}
              onChange={(event) => setToneSettings((current) => ({ ...current, voiceDescription: event.target.value }))}
              placeholder="Warm, credible, practical, and specific. Sound like a strong account executive, not a marketing campaign."
            />
          </div>

          <div className="draftField">
            <label>Do Examples</label>
            <textarea
              value={toneSettings.doExamples}
              onChange={(event) => setToneSettings((current) => ({ ...current, doExamples: event.target.value }))}
              placeholder="Use specific observations, mention food access or employee experience, keep CTAs low-friction."
            />
          </div>

          <div className="draftField">
            <label>Don&apos;t Examples</label>
            <textarea
              value={toneSettings.dontExamples}
              onChange={(event) => setToneSettings((current) => ({ ...current, dontExamples: event.target.value }))}
              placeholder="Avoid corporate speak, inflated ROI claims, or generic wellness buzzwords."
            />
          </div>

          <div className="draftField">
            <label>Sample Email</label>
            <textarea
              value={toneSettings.sampleEmail}
              onChange={(event) => setToneSettings((current) => ({ ...current, sampleEmail: event.target.value }))}
              placeholder="Paste a strong example you want future AI-generated outreach to rhyme with."
            />
          </div>

          <div className="draftFooter">
            <button className="primaryButton" type="button" onClick={saveToneSettings} disabled={savePending}>
              {savePending ? "Saving..." : "Save Tone Settings"}
            </button>
          </div>
        </section>
      </section>
    </>
  );
}
