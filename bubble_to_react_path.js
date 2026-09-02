/*
 * Maps a Bubble portal URL to a standalone React path.
 *
 * Bubble dynamic values:
 *   properties.param1 = portal base, e.g. "https://fine-tuner.ai/portal"
 *                       or "https://fine-tuner.ai/version-8k1/portal"
 *
 * Load this on the Bubble page before portal_handoff.js. It publishes
 * window.bubblePathToReactPath so later Run javascript steps can reuse it.
 * Later steps may pass a base as the second argument:
 *   bubblePathToReactPath(location.href)
 *   bubblePathToReactPath("?page=logs", "https://fine-tuner.ai/version-8k1/portal")
 *
 * To add a page, append one object to PAGE_ROUTES (first match wins):
 *   pages    Bubble ?page= values
 *   when     optional extra query that must match (e.g. { action: "billing" })
 *   path     React pathname
 *   segments path parts after `path`: "param", { param, require }, { literal, require }
 *   query    search params: "sameName", { from, as, when, unless }
 *            `from` may be a list; first non-empty wins. Same `as` is first-wins.
 *
 * Iframe-only query (user_id, theme, bubble_version, navstart) is dropped.
 * Unknown or empty page falls back to /agents.
 */
(function publishBubbleToReactPath() {
  var PORTAL_BASE_PARAM = typeof properties !== "undefined" && properties ? properties.param1 : "";
  var IFRAME_ONLY_QUERY = {
    user_id: true,
    theme: true,
    bubble_version: true,
    navstart: true,
  };

  var GLOBAL_QUERY = ["workspace", "conversationId", "debug_mode"];

  var CALL_ID_FROM = ["call", "callId", "call_id", "chatId", "log_id"];

  var PAGE_ROUTES = [
    {
      pages: ["agents"],
      path: "/agents",
      segments: ["model", { param: "view", require: "model" }],
    },
    {
      pages: ["logs"],
      path: "/logs",
      segments: ["log_type"],
      query: [
        { from: CALL_ID_FROM, as: "chatId", when: { log_type: "chat" } },
        { from: CALL_ID_FROM, as: "callId", unless: { log_type: "chat" } },
        { from: ["apiLogId", "api_log_id", "log"], as: "apiLogId" },
        { from: "agentId", as: "agentId" },
        { from: "model", as: "agentId", unless: { log_type: "call" } },
      ],
    },
    {
      pages: ["actions"],
      path: "/actions",
      segments: ["action_type", "action_path", "view"],
      query: ["action_id", "action_url", "call"],
    },
    {
      pages: ["memory", "contacts"],
      path: "/contacts",
      segments: ["contact_type", "phone_book_path", "memory_group_id"],
      query: [{ from: ["phone_book_url", "phone_book_id"], as: "phone_book_id" }],
    },
    {
      pages: ["test-center"],
      path: "/test-center",
      segments: [
        "view",
        { literal: "session", require: "session_id" },
        { param: "session_id", require: "session_id" },
        "testCaseId",
      ],
      query: ["type", "testCaseId"],
    },
    { pages: ["rag"], path: "/knowledge-base" },
    { pages: ["aurora"], path: "/aurora" },
    { pages: ["analytics"], path: "/analytics" },
    { pages: ["workflow-builder", "workflows"], path: "/workflows" },
    { pages: ["third-parties", "integrations"], path: "/integrations" },
    { pages: ["settings"], when: { action: ["integrations", "third-parties"] }, path: "/integrations" },
    { pages: ["subaccounts", "agency"], path: "/agency" },
    { pages: ["phones"], path: "/phone-numbers" },
    { pages: ["billing"], path: "/settings/billing" },
    { pages: ["settings"], when: { action: "billing" }, path: "/settings/billing" },
    { pages: ["preferences", "settings"], path: "/settings" },
  ];

  var DEFAULT_ROUTE = PAGE_ROUTES[0];

  var REACT_ROOTS = (function collectReactRoots() {
    var roots = { "workflow-builder": true };
    for (var i = 0; i < PAGE_ROUTES.length; i++) {
      var root = PAGE_ROUTES[i].path.replace(/^\/+|\/+$/g, "").split("/")[0];
      if (root) roots[root] = true;
    }
    return roots;
  })();

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

  function asList(value) {
    if (value == null) return [];
    return Object.prototype.toString.call(value) === "[object Array]" ? value : [value];
  }

  function matchesWhen(when, params) {
    if (!when) return true;
    for (var key in when) {
      if (!Object.prototype.hasOwnProperty.call(when, key)) continue;
      if (asList(when[key]).indexOf(clean(params.get(key))) === -1) return false;
    }
    return true;
  }

  function findRoute(params) {
    var page = clean(params.get("page"));
    for (var i = 0; i < PAGE_ROUTES.length; i++) {
      var route = PAGE_ROUTES[i];
      if (route.pages.indexOf(page) === -1) continue;
      if (!matchesWhen(route.when, params)) continue;
      return route;
    }
    return DEFAULT_ROUTE;
  }

  function appendSegment(parts, value) {
    var segment = clean(value).replace(/^\/+|\/+$/g, "");
    if (segment) parts.push(encodeURIComponent(segment));
  }

  function applySegments(parts, params, segments) {
    if (!segments) return;
    for (var i = 0; i < segments.length; i++) {
      var spec = segments[i];
      if (typeof spec === "string") {
        appendSegment(parts, params.get(spec));
        continue;
      }
      if (spec.require && !clean(params.get(spec.require))) continue;
      if (spec.literal) appendSegment(parts, spec.literal);
      else appendSegment(parts, params.get(spec.param));
    }
  }

  function setQuery(search, key, value) {
    var text = clean(value);
    if (text) search.set(key, text);
  }

  function applyQuery(params, search, specs) {
    if (!specs) return;
    for (var i = 0; i < specs.length; i++) {
      var spec = specs[i];
      if (typeof spec === "string") spec = { from: spec, as: spec };
      if (spec.when && !matchesWhen(spec.when, params)) continue;
      if (spec.unless && matchesWhen(spec.unless, params)) continue;
      var as = spec.as || asList(spec.from)[0];
      if (!as || search.get(as)) continue;
      setQuery(search, as, firstClean(params, asList(spec.from)));
    }
  }

  function applyGlobalQuery(params, search) {
    for (var i = 0; i < GLOBAL_QUERY.length; i++) {
      setQuery(search, GLOBAL_QUERY[i], params.get(GLOBAL_QUERY[i]));
    }
  }

  function inferPortalBaseFromLocation() {
    if (typeof location === "undefined" || !location.href) return "";
    try {
      var here = new URL(location.href);
      var parts = here.pathname.split("/").filter(Boolean);
      var prefix = parts[0] && /^version-[^/]+$/.test(parts[0]) ? "/" + parts[0] : "";
      return here.origin + prefix + "/portal";
    } catch (e) {
      return "";
    }
  }

  function resolvePortalBase(override) {
    var raw = clean(override) || clean(PORTAL_BASE_PARAM) || inferPortalBaseFromLocation();
    if (!raw) raw = "https://bubble.local/portal";
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw.replace(/^\/+/, "");
    return new URL(raw);
  }

  function parseInput(input, portalBase) {
    var raw = clean(input);
    var base = resolvePortalBase(portalBase);
    if (!raw) return base;
    if (/^https?:\/\//i.test(raw)) return new URL(raw);
    if (raw.charAt(0) === "?") return new URL(base.pathname.replace(/\/+$/, "") + raw, base.origin);
    return new URL(raw, base.origin);
  }

  function afterPortal(pathname) {
    var match = String(pathname || "").match(/\/portal\/(.*)$/);
    return match ? "/" + match[1] : pathname;
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

  function bubblePathToReactPath(input, portalBase) {
    var url = parseInput(input, portalBase);
    var pathname = afterPortal(url.pathname || "/");

    if (isReactPathname(pathname)) {
      var kept = copyNonIframeQuery(url);
      var existing = pathname + (kept.toString() ? "?" + kept.toString() : "");
      return isSafeReactPath(existing) ? existing : "/agents";
    }

    var params = url.searchParams;
    var route = findRoute(params);
    var parts = [route.path];
    applySegments(parts, params, route.segments);

    var search = new URLSearchParams();
    applyGlobalQuery(params, search);
    applyQuery(params, search, route.query);

    var path = parts.join("/").replace(/\/{2,}/g, "/");
    var query = search.toString();
    var result = query ? path + "?" + query : path;
    return isSafeReactPath(result) ? result : "/agents";
  }

  window.bubblePathToReactPath = bubblePathToReactPath;
})();
