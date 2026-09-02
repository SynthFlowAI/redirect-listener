/*
 * Maps a fine-tuner.ai / Bubble portal URL to a standalone React path.
 *
 * Load this on the Bubble page before portal_handoff.js. It publishes
 * window.bubblePathToReactPath so later Run javascript steps can reuse it.
 *
 * Mirrors the Bubble iframe-src expression (page + path segments + destination
 * query). Iframe-only query (user_id, theme, bubble_version, navstart) is dropped.
 * Unknown or empty page falls back to /agents.
 */
(function publishBubbleToReactPath() {
  var PAGE_ALIASES = {
    contacts: "memory",
    agency: "subaccounts",
    integrations: "third-parties",
  };

  var PAGE_TO_REACT = {
    agents: "/agents",
    logs: "/logs",
    rag: "/knowledge-base",
    aurora: "/aurora",
    analytics: "/analytics",
    "workflow-builder": "/workflows",
    workflows: "/workflows",
    "third-parties": "/integrations",
    subaccounts: "/agency",
    actions: "/actions",
    memory: "/contacts",
    phones: "/phone-numbers",
    "test-center": "/test-center",
    billing: "/settings/billing",
    preferences: "/settings",
  };

  var REACT_ROOTS = {
    agents: true,
    logs: true,
    "knowledge-base": true,
    aurora: true,
    analytics: true,
    workflows: true,
    "workflow-builder": true,
    integrations: true,
    agency: true,
    actions: true,
    contacts: true,
    "phone-numbers": true,
    "test-center": true,
    settings: true,
  };

  var IFRAME_ONLY_QUERY = {
    user_id: true,
    theme: true,
    bubble_version: true,
    navstart: true,
  };

  function clean(value) {
    var text = String(value || "").trim();
    return /^<.+>$/.test(text) ? "" : text;
  }

  function parseInput(input) {
    var raw = clean(input);
    if (!raw) return new URL("https://fine-tuner.ai/portal");
    if (/^https?:\/\//i.test(raw)) return new URL(raw);
    if (raw.charAt(0) === "?") return new URL("https://fine-tuner.ai/portal" + raw);
    return new URL(raw, "https://fine-tuner.ai");
  }

  function afterPortal(pathname) {
    var match = String(pathname || "").match(/\/portal\/(.*)$/);
    return match ? "/" + match[1] : pathname;
  }

  function normalizePage(params) {
    var page = clean(params.get("page"));
    var action = clean(params.get("action"));
    if (page === "settings" && action === "billing") return "billing";
    if (page === "settings" && (action === "integrations" || action === "third-parties")) {
      return "third-parties";
    }
    if (page === "settings") return "preferences";
    return PAGE_ALIASES[page] || page;
  }

  function appendSegment(parts, value) {
    var segment = clean(value).replace(/^\/+|\/+$/g, "");
    if (segment) parts.push(segment);
  }

  function setQuery(search, key, value) {
    var text = clean(value);
    if (text) search.set(key, text);
  }

  function isSafeReactPath(path) {
    return typeof path === "string" && path.charAt(0) === "/" && path.charAt(1) !== "/" && path.indexOf("://") === -1;
  }

  function isReactPathname(pathname) {
    var root = String(pathname || "").replace(/^\/+|\/+$/g, "").split("/")[0] || "";
    return !!REACT_ROOTS[root];
  }

  function copyNonIframeQuery(fromUrl) {
    var search = new URLSearchParams();
    fromUrl.searchParams.forEach(function (value, key) {
      if (!IFRAME_ONLY_QUERY[key] && key !== "page") setQuery(search, key, value);
    });
    return search;
  }

  function destinationQuery(params, page) {
    var search = new URLSearchParams();
    var logType = clean(params.get("log_type"));
    var callId = clean(
      params.get("call") ||
      params.get("callId") ||
      params.get("call_id") ||
      params.get("chatId") ||
      params.get("log_id")
    );
    var apiLogId = clean(params.get("apiLogId") || params.get("api_log_id") || params.get("log"));
    var agentId = clean(params.get("agentId") || (logType !== "call" ? params.get("model") : ""));

    setQuery(search, "workspace", params.get("workspace"));
    setQuery(search, "conversationId", params.get("conversationId"));
    setQuery(search, "debug_mode", params.get("debug_mode"));

    if (page === "logs") {
      if (logType === "chat") setQuery(search, "chatId", callId);
      else setQuery(search, "callId", callId);
      setQuery(search, "apiLogId", apiLogId);
      setQuery(search, "agentId", agentId);
    } else {
      setQuery(search, "call", params.get("call"));
      setQuery(search, "action_id", params.get("action_id"));
      setQuery(search, "action_url", params.get("action_url"));
      setQuery(search, "phone_book_id", params.get("phone_book_url") || params.get("phone_book_id"));
      setQuery(search, "type", params.get("type"));
      setQuery(search, "testCaseId", params.get("testCaseId"));
    }

    return search;
  }

  function bubblePathToReactPath(input) {
    var url = parseInput(input);
    var pathname = afterPortal(url.pathname || "/");

    if (isReactPathname(pathname)) {
      var kept = copyNonIframeQuery(url);
      var existing = pathname + (kept.toString() ? "?" + kept.toString() : "");
      return isSafeReactPath(existing) ? existing : "/agents";
    }

    var params = url.searchParams;
    var page = normalizePage(params);
    var parts = [PAGE_TO_REACT[page] || "/agents"];
    var model = clean(params.get("model"));
    var view = clean(params.get("view"));

    if (model) appendSegment(parts, model);
    if (view && model) appendSegment(parts, view);
    appendSegment(parts, params.get("action_type"));
    appendSegment(parts, params.get("action_path"));
    if (view && page === "actions") appendSegment(parts, view);
    appendSegment(parts, params.get("log_type"));
    appendSegment(parts, params.get("contact_type"));
    appendSegment(parts, params.get("phone_book_path"));
    appendSegment(parts, params.get("memory_group_id"));
    if (view && page === "test-center") appendSegment(parts, view);
    if (clean(params.get("session_id"))) {
      appendSegment(parts, "session");
      appendSegment(parts, params.get("session_id"));
    }
    if (page === "test-center") appendSegment(parts, params.get("testCaseId"));

    var path = parts.join("/").replace(/\/{2,}/g, "/");
    var query = destinationQuery(params, page).toString();
    var result = query ? path + "?" + query : path;
    return isSafeReactPath(result) ? result : "/agents";
  }

  window.bubblePathToReactPath = bubblePathToReactPath;
})();
