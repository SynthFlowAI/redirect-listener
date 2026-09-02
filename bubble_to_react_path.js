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

  function firstClean(params, keys) {
    for (var i = 0; i < keys.length; i++) {
      var text = clean(params.get(keys[i]));
      if (text) return text;
    }
    return "";
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

  function applyGlobalQuery(params, search) {
    setQuery(search, "workspace", params.get("workspace"));
    setQuery(search, "conversationId", params.get("conversationId"));
    setQuery(search, "debug_mode", params.get("debug_mode"));
  }

  var PAGE_ROUTES = {
    // Agents
    // Bubble: ?page=agents&model=&view=
    // React:  /agents/:model/:view
    agents: {
      path: "/agents",
      appendPath: function (parts, params) {
        var model = clean(params.get("model"));
        appendSegment(parts, model);
        if (model) appendSegment(parts, params.get("view"));
      },
    },

    // Logs
    // Bubble: ?page=logs&log_type=&call=&log=&agentId=  (call also as callId/chatId/log_id)
    // React:  /logs/:log_type?chatId= | ?callId=&apiLogId=&agentId=
    logs: {
      path: "/logs",
      appendPath: function (parts, params) {
        appendSegment(parts, params.get("log_type"));
      },
      appendQuery: function (params, search) {
        var logType = clean(params.get("log_type"));
        var callId = firstClean(params, ["call", "callId", "call_id", "chatId", "log_id"]);
        var apiLogId = firstClean(params, ["apiLogId", "api_log_id", "log"]);
        var agentId = clean(params.get("agentId") || (logType !== "call" ? params.get("model") : ""));
        if (logType === "chat") setQuery(search, "chatId", callId);
        else setQuery(search, "callId", callId);
        setQuery(search, "apiLogId", apiLogId);
        setQuery(search, "agentId", agentId);
      },
    },

    // Actions
    // Bubble: ?page=actions&action_type=&action_path=&view=&action_id=&action_url=&call=
    // React:  /actions/:action_type/:action_path/:view?action_id=&action_url=&call=
    actions: {
      path: "/actions",
      appendPath: function (parts, params) {
        appendSegment(parts, params.get("action_type"));
        appendSegment(parts, params.get("action_path"));
        appendSegment(parts, params.get("view"));
      },
      appendQuery: function (params, search) {
        setQuery(search, "action_id", params.get("action_id"));
        setQuery(search, "action_url", params.get("action_url"));
        setQuery(search, "call", params.get("call"));
      },
    },

    // Contacts (Bubble page=memory, alias page=contacts)
    // Bubble: ?page=memory&contact_type=&phone_book_path=&memory_group_id=&phone_book_url=
    // React:  /contacts/:contact_type/:phone_book_path|:memory_group_id?phone_book_id=
    memory: {
      path: "/contacts",
      appendPath: function (parts, params) {
        appendSegment(parts, params.get("contact_type"));
        appendSegment(parts, params.get("phone_book_path"));
        appendSegment(parts, params.get("memory_group_id"));
      },
      appendQuery: function (params, search) {
        setQuery(search, "phone_book_id", params.get("phone_book_url") || params.get("phone_book_id"));
      },
    },

    // Test center
    // Bubble: ?page=test-center&view=&session_id=&testCaseId=&type=
    // React:  /test-center/:view/session/:session_id/:testCaseId?type=&testCaseId=
    "test-center": {
      path: "/test-center",
      appendPath: function (parts, params) {
        appendSegment(parts, params.get("view"));
        if (clean(params.get("session_id"))) {
          appendSegment(parts, "session");
          appendSegment(parts, params.get("session_id"));
        }
        appendSegment(parts, params.get("testCaseId"));
      },
      appendQuery: function (params, search) {
        setQuery(search, "type", params.get("type"));
        setQuery(search, "testCaseId", params.get("testCaseId"));
      },
    },

    // Knowledge base — ?page=rag → /knowledge-base
    rag: { path: "/knowledge-base" },

    // Aurora — ?page=aurora → /aurora
    aurora: { path: "/aurora" },

    // Analytics — ?page=analytics → /analytics
    analytics: { path: "/analytics" },

    // Workflows — ?page=workflow-builder|workflows → /workflows
    "workflow-builder": { path: "/workflows" },
    workflows: { path: "/workflows" },

    // Integrations — ?page=third-parties|integrations → /integrations
    "third-parties": { path: "/integrations" },

    // Agency — ?page=subaccounts|agency → /agency
    subaccounts: { path: "/agency" },

    // Phone numbers — ?page=phones → /phone-numbers
    phones: { path: "/phone-numbers" },

    // Settings — ?page=preferences|settings → /settings
    //            ?page=billing|settings&action=billing → /settings/billing
    preferences: { path: "/settings" },
    billing: { path: "/settings/billing" },
  };

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
    var route = PAGE_ROUTES[page] || PAGE_ROUTES.agents;
    var parts = [route.path];
    if (route.appendPath) route.appendPath(parts, params);

    var search = new URLSearchParams();
    applyGlobalQuery(params, search);
    if (route.appendQuery) route.appendQuery(params, search);

    var path = parts.join("/").replace(/\/{2,}/g, "/");
    var query = search.toString();
    var result = query ? path + "?" + query : path;
    return isSafeReactPath(result) ? result : "/agents";
  }

  window.bubblePathToReactPath = bubblePathToReactPath;
})();
