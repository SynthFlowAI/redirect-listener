(() => {
  const BUBBLE_IFRAME_SYNC_FN = "bubble_fn_set_main_iframe_from_url";
  const BASE_LISTENER_FILE = "iframe-listener-5idf.js";
  const RETRY_MS = 25;

  const currentScript = document.currentScript;
  const baseUrl = currentScript?.src ? new URL(".", currentScript.src).href : "";
  const baseListenerUrl = baseUrl
    ? new URL(BASE_LISTENER_FILE, baseUrl).href
    : BASE_LISTENER_FILE;

  const clean = (value) => String(value ?? "").trim();

  const reactIframeBaseUrl = () => {
    try {
      const debug = window.__reactIframeCookieDebug;
      if (typeof debug !== "function") return "";

      const apiUrl = clean(debug()?.apiUrl);
      return apiUrl ? new URL(apiUrl, location.href).origin : "";
    } catch {
      return "";
    }
  };

  const wrapBubbleIframeSync = () => {
    const original = window[BUBBLE_IFRAME_SYNC_FN];
    if (typeof original !== "function") return false;
    if (original.__iframeListener8k1Wrapped === true) return true;

    const wrapped = (payload) => {
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const nextPayload = { ...payload };
        if (!clean(nextPayload.output1)) nextPayload.output1 = reactIframeBaseUrl();
        return original(nextPayload);
      }

      return original({
        value: payload == null ? "" : payload,
        output1: reactIframeBaseUrl(),
      });
    };

    wrapped.__iframeListener8k1Wrapped = true;
    wrapped.__iframeListener8k1Original = original;
    window[BUBBLE_IFRAME_SYNC_FN] = wrapped;
    return true;
  };

  const loadBaseListener = () => {
    const script = document.createElement("script");
    script.src = baseListenerUrl;
    script.async = false;
    script.dataset.portalIframeListenerBase = "5idf";
    script.onerror = () => console.error("Failed to load base iframe listener", baseListenerUrl);
    document.head.appendChild(script);
  };

  const start = () => {
    if (!wrapBubbleIframeSync()) {
      setTimeout(start, RETRY_MS);
      return;
    }

    loadBaseListener();
  };

  start();
})();
