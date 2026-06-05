(() => {
  const VERSION_FILES = {
    "version-live": "iframe-listener-live.js",
    "version-1idf": "iframe-listener-1idf.js",
    "version-5idf": "iframe-listener-5idf.js",
  };
  const DEFAULT_VERSION = "version-live";
  const DEBUG = new URLSearchParams(location.search).get("debug_mode") === "true";
  const log = (...a) => { if (DEBUG) console.log("[portal-loader]", ...a); };

  const currentScript = document.currentScript;
  const configuredBaseUrl = currentScript?.getAttribute("data-base-url") || window.__portalIframeListenerBaseUrl || "";
  const baseUrl = configuredBaseUrl || (currentScript?.src ? new URL(".", currentScript.src).href : "");

  const detectBubbleVersion = () => (
    location.pathname
      .split("/")
      .filter(Boolean)
      .find((part) => /^version-[^/]+$/.test(part)) || DEFAULT_VERSION
  );

  const detectedVersion = detectBubbleVersion();
  const selectedVersion = VERSION_FILES[detectedVersion] ? detectedVersion : DEFAULT_VERSION;
  const selectedFile = VERSION_FILES[selectedVersion];
  const selectedUrl = baseUrl ? new URL(selectedFile, baseUrl).href : selectedFile;

  window.__portalIframeListenerLoaderDebug = () => ({
    detectedVersion,
    selectedVersion,
    selectedFile,
    selectedUrl,
    knownVersions: Object.keys(VERSION_FILES),
  });

  const script = document.createElement("script");
  script.src = selectedUrl;
  script.async = false;
  script.dataset.portalIframeListenerVersion = selectedVersion;
  script.onerror = () => log("Failed to load listener", selectedUrl);

  log("Loading listener", {
    detectedVersion,
    selectedVersion,
    selectedUrl,
  });

  document.head.appendChild(script);
})();
