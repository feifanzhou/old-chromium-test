import "es6-promise/auto";
import "whatwg-fetch";
import "./polyfills/object-assign";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";

const tubiUrl = "https://tubitv.com/?utm_source=dev";

function App() {
  const [title, setTitle] = useState("Not loaded yet");
  const [isLoading, setIsLoading] = useState(false);

  function handleLoadTitleClick() {
    setIsLoading(true);
    setTitle("Loading title...");

    if (typeof window !== "undefined") {
      window.__demoTubiRequest = {
        attempted: false,
        url: tubiUrl,
      };
    }

    fetch(tubiUrl, { mode: "no-cors" })
      .then(() => {
        if (typeof window !== "undefined" && window.__demoTubiRequest) {
          window.__demoTubiRequest.attempted = true;
        }
      })
      .catch(() => {
        if (typeof window !== "undefined" && window.__demoTubiRequest) {
          window.__demoTubiRequest.attempted = true;
        }

        // We only need to trigger the request for this behavior check.
      })
      .then(() => fetch(`/api/title?url=${encodeURIComponent(tubiUrl)}`))
      .then((response) => {
        if (!response.ok) {
          throw new Error("Could not fetch title");
        }
        return response.json();
      })
      .then((data) => {
        setTitle(data.title || "Title not found");
      })
      .catch(() => {
        setTitle("Failed to load title");
      })
      .then(() => {
        setIsLoading(false);
      })
      .catch(() => {
        setIsLoading(false);
      });
  }

  return (
    <main>
      <h1>Hello World</h1>
      <button data-testid="fetch-tubi-button" onClick={handleLoadTitleClick} disabled={isLoading}>
        {isLoading ? "Loading..." : "Load Tubi Title"}
      </button>
      <p data-testid="tubi-title">Tubi title: {title}</p>
    </main>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);
