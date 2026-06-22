(() => {
  /* ==============================
   * Config & Debug
   * ============================== */
  const ALLOWED_ORIGIN = "*"; // allow all origins
  const DEBOUNCE_MS = 200;
  const AURORA_REDIRECT_GRACE_MS = 2000;
  const REACT_IFRAME_AUTH_READY_EVENT = "react_iframe_auth_ready";
  // Keep this as "yes" when write_cookie.js must finish before any React iframe
  // src is displayed. Use a quoted Bubble dynamic value if you need to vary it.
  const WAIT_FOR_REACT_IFRAME_AUTH = "yes";
  const DEBUG = new URLSearchParams(location.search).get("debug_mode") === "true";
  const log = (...a) => { if (DEBUG) console.log("[portal]", ...a); };
  const previousCleanup = window.__portalIframeListenerCleanup;
  if (typeof previousCleanup === "function") {
    try { previousCleanup(); } catch (e) { if (DEBUG) console.error(e); }
  }
  const cleanupFns = [];
  const addCleanup = (fn) => cleanupFns.push(fn);
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    addCleanup(() => target.removeEventListener(type, handler, options));
  };
  window.__portalIframeListenerCleanup = () => {
    while (cleanupFns.length) {
      try { cleanupFns.pop()(); } catch (e) { if (DEBUG) console.error(e); }
    }
  };

  /* ==============================
   * Small, re-usable helpers
   * ============================== */
  const setOrDel = (sp, k, v) => (v === undefined || v === null || v === "") ? sp.delete(k) : sp.set(k, v);
  const isBubbleYes = (v) => v === true || /^(yes|true|1)$/i.test(String(v || "").trim());
  const cleanDynamicText = (v) => {
    const value = String(v ?? "").trim();
    return /^<.+>$/.test(value) ? "" : value;
  };
  const shouldWaitForReactIframeAuth = () => isBubbleYes(WAIT_FOR_REACT_IFRAME_AUTH);
  const isReactIframeAuthReady = () => !shouldWaitForReactIframeAuth() || window.__reactIframeAuthReady === true;
  const iframeSyncFnName = () => "bubble_fn_set_main_iframe_from_url";

  const isUUID     = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s||"");
  const isBubbleId = s => /^\d{13,16}x\d{15,20}$/.test(s||"");
  const isSlug     = s => !!s && !isUUID(s) && !isBubbleId(s) && (s.includes("_") || /^[a-zA-Z0-9_-]{5,30}$/.test(s||""));
  const eqAction   = (a,b) => a===b || (!!a && !!b && ((isSlug(a)&&isUUID(b)) || (isUUID(a)&&isSlug(b))));

  const toAbs = (p) => { try { return new URL(p, location.origin).href; } catch { return String(p||""); } };
  const openBlank = (url) => {
    try {
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (w) try { w.opener = null; } catch {}
    } catch (e) { if (DEBUG) console.error(e); }
  };

  const getAfterPortal = (u) => {
    const s = u.pathname + u.search + u.hash, i = s.indexOf("/portal/");
    return i !== -1 ? s.slice(i + 8) : (u.search + u.hash);
  };

  // Canonical comparison of "?page" URLs, allowing slug↔uuid equivalence for action_path
  const canon = (pathStr) => {
    if (!pathStr) return "";
    const [rawPath="", rest=""] = String(pathStr).split("?");
    const [rawQuery="", rawHash=""] = rest.split("#");
    const path = rawPath.replace(/^\/+|\/+$/g, "");
    const entries = [...new URLSearchParams(rawQuery).entries()].sort(([a],[b]) => a.localeCompare(b));
    const q = new URLSearchParams(entries).toString();
    const hash = rawHash ? `#${rawHash}` : "";
    return q ? (path ? `${path}?${q}${hash}` : `?${q}${hash}`) : (path + hash);
  };
  const canonEq = (a, b) => {
    if (a === b) return true;
    const [ap, ar=""] = a.split("?"), [bp, br=""] = b.split("?");
    if (ap !== bp) return false;
    const [aq="", ah=""] = ar.split("#"), [bq="", bh=""] = br.split("#");
    if (ah !== bh) return false;
    if (!aq && !bq) return true;
    if (!aq || !bq) return false;
    const A = new URLSearchParams(aq), B = new URLSearchParams(bq);
    const ak = [...A.keys()].sort().join(","), bk = [...B.keys()].sort().join(",");
    if (ak !== bk) return false;
    for (const k of ak.split(",").filter(Boolean)) {
      const av = A.get(k), bv = B.get(k);
      if (k === "action_path" ? !eqAction(av, bv) : av !== bv) return false;
    }
    return true;
  };

  // Find the posting <iframe> and ensure it's visible
  const sourceIframe = (evt) => {
    for (const f of document.getElementsByTagName("iframe")) {
      try { if (f.contentWindow === evt.source) return f; } catch {}
    }
    return null;
  };
  const isVisible = (el) => {
    if (!el || !el.isConnected || el.hidden) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
    const r = el.getBoundingClientRect(); return !(r.width === 0 || r.height === 0);
  };

  // Build a same-origin absolute href preserving "/portal/" prefix if present
  const buildHref = (bubblePath) => {
    const cur = new URL(location.href);
    const full = cur.pathname + cur.search + cur.hash;
    const i = full.indexOf("/portal/");
    if (i !== -1) return cur.origin + full.slice(0, i + 8) + bubblePath;
    if (bubblePath.startsWith("?")) return cur.origin + cur.pathname + bubblePath;
    if (bubblePath.startsWith("/")) return cur.origin + bubblePath;
    return cur.origin + "/" + bubblePath;
  };

  /* ==============================
   * iframe src injection for deep-links
   * Watches for iframes being added/updated by Bubble and injects deep-link
   * params into their src before they load, so the React app boots with the
   * correct state instead of relying on postMessage timing.
   * ============================== */
  (() => {
    const injectDeepLinkIntoSrc = (frame) => {
      try {
        const sp = new URL(location.href).searchParams;
        if (sp.get("page") !== "logs" || sp.get("log_type") !== "chat") return;
        const chatId = sp.get("call");
        if (!chatId) return;

        const src = frame.getAttribute("src");
        if (!src || src === "about:blank") return;

        const srcUrl = new URL(src, location.origin);
        if (srcUrl.searchParams.get("chatId") === chatId) return; // already injected

        srcUrl.searchParams.set("chatId", chatId);
        log("Injecting chatId into iframe src →", srcUrl.href);
        frame.setAttribute("src", srcUrl.href);
      } catch (e) { if (DEBUG) console.error(e); }
    };

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.tagName === "IFRAME") injectDeepLinkIntoSrc(node);
          if (node.querySelectorAll) node.querySelectorAll("iframe").forEach(injectDeepLinkIntoSrc);
        }
        if (m.type === "attributes" && m.target.tagName === "IFRAME" && m.attributeName === "src") {
          injectDeepLinkIntoSrc(m.target);
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["src"],
    });
    addCleanup(() => observer.disconnect());

    // Handle iframes already in the DOM at script run time
    document.querySelectorAll("iframe").forEach(injectDeepLinkIntoSrc);
  })();

  /* ==============================
   * URL → iframe sync (call Bubble iframe sync on real top-level changes)
   * ============================== */
  const pageParam = (u) => { try { return (new URL(u || location.href)).searchParams.get("page") || ""; } catch { return ""; } };
  const workspaceParam = (u) => { try { return (new URL(u || location.href)).searchParams.get("workspace") || ""; } catch { return ""; } };
  const logsCallAgentIdParam = (u) => {
    try {
      const sp = (new URL(u || location.href, location.origin)).searchParams;
      return sp.get("page") === "logs" && sp.get("log_type") === "call"
        ? (sp.get("agentId") || sp.get("model") || "")
        : "";
    } catch { return ""; }
  };
  const logsCallAgentStorageKey = (workspace) => `portal_logs_call_agentId:${workspace || "default"}`;
  const readStoredLogsCallAgentId = (workspace) => {
    try { return localStorage.getItem(logsCallAgentStorageKey(workspace)) || ""; } catch { return ""; }
  };
  const writeStoredLogsCallAgentId = (workspace, agentId) => {
    try { if (agentId) localStorage.setItem(logsCallAgentStorageKey(workspace), agentId); } catch {}
  };

  let lastPage = pageParam();
  let lastWorkspace = workspaceParam();
  let lastSyncedCanon = canon(getAfterPortal(new URL(location.href)));
  let lastAuroraSyncAt = lastPage === "aurora" ? Date.now() : 0;
  let lastLogsCallAgentId = logsCallAgentIdParam();
  let lastLogsCallWorkspace = lastWorkspace;
  let queuedSyncReason = null;
  let queuedIframeSyncArg = null;
  let initialIframeSyncArgConsumed = false;
  let waitingForAuthReady = false;
  if (lastLogsCallAgentId) writeStoredLogsCallAgentId(lastLogsCallWorkspace, lastLogsCallAgentId);

  function preserveLogsCallAgentId(url) {
    if (url.searchParams.get("page") !== "logs" || url.searchParams.get("log_type") !== "call") return;

    const workspace = url.searchParams.get("workspace") || lastWorkspace || "";
    const agentId = url.searchParams.get("agentId") || url.searchParams.get("model");
    if (agentId) {
      lastLogsCallAgentId = agentId;
      lastLogsCallWorkspace = workspace;
      writeStoredLogsCallAgentId(workspace, agentId);
    }

    const restoredAgentId = lastLogsCallWorkspace === workspace
      ? lastLogsCallAgentId
      : readStoredLogsCallAgentId(workspace);
    if (!url.searchParams.get("agentId") && restoredAgentId) url.searchParams.set("agentId", restoredAgentId);
    url.searchParams.delete("model");
  }

  function preserveHistoryUrlArgs(args) {
    if (args.length < 2 || args[1] === undefined || args[1] === null) return args;

    try {
      const next = new URL(args[1], location.href);
      const before = next.href;
      preserveLogsCallAgentId(next);
      if (next.href === before) return args;

      const nextArgs = [...args];
      nextArgs[1] = next.href;
      log("Preserved logs call agentId in history URL →", next.href);
      return nextArgs;
    } catch {
      return args;
    }
  }

  function deferSyncUntilAuthReady(reason) {
    if (isReactIframeAuthReady()) return false;

    queuedSyncReason = reason || queuedSyncReason || "unknown";
    log("Deferred iframe sync until React iframe auth is ready ←", reason);

    if (!waitingForAuthReady) {
      waitingForAuthReady = true;
      listen(window, REACT_IFRAME_AUTH_READY_EVENT, (event) => {
        queuedIframeSyncArg = cleanDynamicText(event.detail?.landingPage ?? window.__reactIframeLandingPage);
        const deferredReason = queuedSyncReason || "auth_ready";
        queuedSyncReason = null;
        waitingForAuthReady = false;
        syncIframesFromUrl(`auth_ready_after_${deferredReason}`);
      });
    }

    return true;
  }

  function iframeSyncArgFor(reason) {
    if (queuedIframeSyncArg !== null) {
      const arg = queuedIframeSyncArg;
      queuedIframeSyncArg = null;
      initialIframeSyncArgConsumed = true;
      return arg;
    }

    if (!initialIframeSyncArgConsumed && isReactIframeAuthReady()) {
      initialIframeSyncArgConsumed = true;
      return cleanDynamicText(window.__reactIframeLandingPage);
    }

    return "";
  }

  function syncIframesFromUrl(reason) {
    if (deferSyncUntilAuthReady(reason)) return;

    try { normalizeTopLevelUrl(reason); } catch (e) { if (DEBUG) console.error(e); }

    const fnName = iframeSyncFnName();
    const fn = window[fnName];
    if (typeof fn === "function") {
      try {
        const iframeSyncArg = iframeSyncArgFor(reason);
        if (iframeSyncArg) fn(iframeSyncArg);
        else fn();
        log("Synced iframes from URL ←", reason, location.href, iframeSyncArg ? { iframeSyncArg } : "");
      } catch (e) { if (DEBUG) console.error(e); }
    } else {
      log(`${fnName} missing; skip`);
    }
    lastPage = pageParam();
    if (lastPage === "aurora") lastAuroraSyncAt = Date.now();
    lastSyncedCanon = canon(getAfterPortal(new URL(location.href)));
    refreshIfWorkspaceChanged(`workspace change from ${reason}`);

    // For in-session navigations (iframe already loaded), also send a postMessage
    // so the React app can handle the deep-link without a full src reload.
    // The MutationObserver handles the refresh/initial-load case via src injection.
    const sp = new URL(location.href).searchParams;
    if (sp.get("page") === "logs" && sp.get("log_type") === "chat") {
      const chatId = sp.get("call");
      if (chatId) {
        const path = `/logs/chat?chatId=${encodeURIComponent(chatId)}`;
        log("Forwarding chat deep-link to iframe →", path);
        for (const frame of document.getElementsByTagName("iframe")) {
          try {
            if (isVisible(frame)) frame.contentWindow.postMessage({ type: "navigate", path }, "*");
          } catch (e) { if (DEBUG) console.error(e); }
        }
      }
    }
  }

  function maybeSyncOnUrlChange(href, pushedState, reasonTag) {
    if (pushedState && pushedState.portalNav) return;
    const nextCanon = canon(getAfterPortal(new URL(href, location.origin)));
    if (canonEq(nextCanon, lastSyncedCanon)) return;
    const nextPage = pageParam(href);
    if (lastPage && nextPage && nextPage !== lastPage) {
      log(`?page changed (external): ${lastPage} → ${nextPage}`);
    }
    syncIframesFromUrl(reasonTag || "history_change");
  }

  // Observe ANY top-level SPA nav
  (() => {
    const { pushState, replaceState } = history;

    const patchedPushState = function(state, ...args) {
      const nextArgs = preserveHistoryUrlArgs(args);
      const r = pushState.apply(this, [state, ...nextArgs]);
      try { maybeSyncOnUrlChange(location.href, state, "pushState"); } catch {}
      return r;
    };

    const patchedReplaceState = function(state, ...args) {
      const nextArgs = preserveHistoryUrlArgs(args);
      const r = replaceState.apply(this, [state, ...nextArgs]);
      try { maybeSyncOnUrlChange(location.href, state, "replaceState"); } catch {}
      return r;
    };

    history.pushState = patchedPushState;
    history.replaceState = patchedReplaceState;
    addCleanup(() => {
      if (history.pushState === patchedPushState) history.pushState = pushState;
      if (history.replaceState === patchedReplaceState) history.replaceState = replaceState;
    });

    listen(window, "popstate", (ev) => {
      if (ev && ev.isTrusted === false) return;
      const nextCanon = canon(getAfterPortal(new URL(location.href)));
      if (!canonEq(nextCanon, lastSyncedCanon)) syncIframesFromUrl("popstate");
    });

    listen(window, "hashchange", (ev) => {
      if (ev && ev.isTrusted === false) return;
      const nextCanon = canon(getAfterPortal(new URL(location.href)));
      if (!canonEq(nextCanon, lastSyncedCanon)) syncIframesFromUrl("hashchange");
    });
  })();

  /* ==============================
   * Mapping: iframe route → Bubble page/params
   * ============================== */
  const GLOBAL_KEEP = new Set(["page","debug_mode","workspace","conversationId"]);
  const BUBBLE_PAGE_PASSTHROUGH = new Set(["preferences","subaccounts","third-parties","billing"]);
  const BUBBLE_PAGE_ALIASES = {
    settings: "preferences",
    agency: "subaccounts",
    integrations: "third-parties",
  };
  const MEMORY_KEEP = new Set(["contact_type","phone_book_url","phone_book_path","memory_group_id", ...GLOBAL_KEEP]);
  const ALLOW = {
    "test-center": new Set(["view","type","session_id","testCaseId", ...GLOBAL_KEEP]),
    "rag":         new Set([                                            ...GLOBAL_KEEP]),
    "analytics":   new Set([                                            ...GLOBAL_KEEP]),
    "workflow-builder": new Set([                                       ...GLOBAL_KEEP]),
    "aurora":      new Set([                                            ...GLOBAL_KEEP]),
    "agents":      new Set(["model","view",                             ...GLOBAL_KEEP]),
    "actions":     new Set(["action_type","action_path","action_url","action_id","view", ...GLOBAL_KEEP]),
    "contacts":    MEMORY_KEEP,
    "memory":      MEMORY_KEEP,
    "phones":      new Set(["action",                                   ...GLOBAL_KEEP]),
    "preferences": new Set([                                            ...GLOBAL_KEEP]),
    "subaccounts": new Set(["subaccount","tab","integration",             ...GLOBAL_KEEP]),
    "third-parties": new Set(["integration",                            ...GLOBAL_KEEP]),
    "billing":     new Set([                                            ...GLOBAL_KEEP]),
    "logs":        new Set(["log_type","call","log","model","agentId",  ...GLOBAL_KEEP]),
  };

  const applyAllow = (url, page) => {
    const keep = ALLOW[page] || GLOBAL_KEEP;
    const drop = [];
    for (const k of url.searchParams.keys()) if (!keep.has(k)) drop.push(k);
    drop.forEach(k => url.searchParams.delete(k));
  };

  const copyAllowedParams = (target, source, page) => {
    const keep = ALLOW[page] || GLOBAL_KEEP;
    for (const [k, v] of source.searchParams.entries()) {
      if (k !== "page" && keep.has(k)) setOrDel(target.searchParams, k, v);
    }
  };

  function normalizeTopLevelUrl(reason) {
    const cur = new URL(location.href);
    let page = cur.searchParams.get("page");

    const before = cur.href;
    if (page === "contacts") {
      cur.searchParams.set("page", "memory");
      page = "memory";
    }
    if (page === "settings") {
      const action = cur.searchParams.get("action");
      page = action === "billing"
        ? "billing"
        : action === "integrations" || action === "third-parties"
          ? "third-parties"
          : "preferences";
      cur.searchParams.set("page", page);
    }
    if (page === "agency") {
      cur.searchParams.set("page", "subaccounts");
      page = "subaccounts";
    }
    if (page === "integrations") {
      cur.searchParams.set("page", "third-parties");
      page = "third-parties";
    }
    preserveLogsCallAgentId(cur);

    if (!page || !ALLOW[page]) {
      if (cur.href !== before) {
        history.replaceState({ portalNav: true, normalized: true }, "", cur.href);
        log("Normalized parent URL before iframe sync ←", reason, cur.href);
      }
      return;
    }

    applyAllow(cur, page);
    if (BUBBLE_PAGE_PASSTHROUGH.has(page)) {
      if (cur.href !== before) {
        history.replaceState({ portalNav: true, normalized: true }, "", cur.href);
        log("Normalized parent URL before iframe sync ←", reason, cur.href);
      }
      return;
    }

    if (cur.href === before) return;

    history.replaceState({ portalNav: true, normalized: true }, "", cur.href);
    log("Normalized parent URL before iframe sync ←", reason, cur.href);
  }

  const normalizeGlobals = (host, iframe) => {
    const callId = iframe.searchParams.get("call_id");
    if (callId) host.searchParams.set("call", callId);

    const workspace = iframe.searchParams.get("workspace");
    if (workspace) host.searchParams.set("workspace", workspace);

    const testCaseId = iframe.searchParams.get("testCaseId");
    if (testCaseId) host.searchParams.set("testCaseId", testCaseId);
  };

  const mapBubblePageUrl = (iu) => {
    const rawPage = iu.searchParams.get("page");
    const action = iu.searchParams.get("action");
    const page = rawPage === "settings" && (action === "integrations" || action === "third-parties")
      ? "third-parties"
      : rawPage === "settings" && action === "billing"
        ? "billing"
        : BUBBLE_PAGE_ALIASES[rawPage] || rawPage;
    if (!BUBBLE_PAGE_PASSTHROUGH.has(page)) return null;

    const host = new URL(location.href);
    normalizeGlobals(host, iu);
    host.searchParams.set("page", page);
    copyAllowedParams(host, iu, page);
    applyAllow(host, page);

    const bubblePath = getAfterPortal(host);
    log("Mapped Bubble page URL →", { from: iu.href, page, bubblePath });
    return { bubblePath, newPage: page };
  };

  // Declarative routes (each returns target Bubble "page" and mutates search params)
  const ROUTES = {
    "test-center": (u, parts, iu) => {
      u.searchParams.set("page","test-center");
      const sub = parts[1];
      const itemId = sub && !(sub === "run-history" && parts[2] === "session") ? parts[2] : "";
      setOrDel(u.searchParams,"view", sub || "");
      setOrDel(u.searchParams,"type", iu.searchParams.get("type"));
      if (sub === "run-history" && parts[2] === "session" && parts[3]) setOrDel(u.searchParams,"session_id", parts[3]);
      else u.searchParams.delete("session_id");
      setOrDel(u.searchParams,"testCaseId", iu.searchParams.get("testCaseId") || itemId);
    },
    "knowledge-base": (u) => { u.searchParams.set("page","rag"); },
    "aurora":         (u) => { u.searchParams.set("page","aurora"); },
    "analytics":      (u) => { u.searchParams.set("page","analytics"); },
    "workflows":      (u) => { u.searchParams.set("page","workflow-builder"); },
    "workflow-builder": (u) => { u.searchParams.set("page","workflow-builder"); },
    "integrations":   (u) => { u.searchParams.set("page","third-parties"); },
    "agency": (u) => {
      u.searchParams.set("page","subaccounts");
    },
    "agents": (u, parts) => {
      u.searchParams.set("page","agents");
      setOrDel(u.searchParams,"model", parts[1]);
      setOrDel(u.searchParams,"view",  parts[2]);
    },
    "actions": (u, parts, iu) => {
      u.searchParams.set("page","actions");
      const sub = parts[1];
      const sp = u.searchParams;
      if (!sub) { ["action_type","action_path","action_url","action_id","view"].forEach(k=>sp.delete(k)); return; }
      if (sub === "custom-action") {
        sp.delete("action_url"); sp.set("action_type","custom-action");
        setOrDel(sp,"action_path", parts[2]);
        setOrDel(sp,"action_id", iu.searchParams.get("action_id"));
        setOrDel(sp,"view", parts[3]);
      } else {
        sp.delete("action_path"); sp.delete("view");
        sp.set("action_type", sub);
        setOrDel(sp,"action_url", iu.searchParams.get("action_url"));
        setOrDel(sp,"action_id", iu.searchParams.get("action_id"));
      }
    },
    "contacts": (u, parts, iu) => {
      u.searchParams.set("page","memory");
      const sub = parts[1], sp = u.searchParams;
      if (!sub) { ["contact_type","phone_book_url","phone_book_path","memory_group_id"].forEach(k=>sp.delete(k)); return; }
      if (sub === "phone-books") {
        sp.set("contact_type","phone-books");
        setOrDel(sp,"phone_book_url", iu.searchParams.get("phone_book_id"));
        setOrDel(sp,"phone_book_path", parts[2]); sp.delete("memory_group_id");
      } else if (sub === "memory-groups") {
        sp.set("contact_type","memory-groups");
        setOrDel(sp,"memory_group_id", parts[2]); sp.delete("phone_book_url"); sp.delete("phone_book_path");
      } else {
        ["contact_type","phone_book_url","phone_book_path","memory_group_id"].forEach(k=>sp.delete(k));
      }
    },
    "phone-numbers": (u) => { u.searchParams.set("page","phones"); u.searchParams.set("action","phones-active"); },
    "settings": (u, parts) => {
      u.searchParams.set("page",
        parts[1] === "integrations" ? "third-parties" :
        parts[1] === "billing" ? "billing" :
        "preferences"
      );
    },
    "logs": (u, parts, iu) => {
      u.searchParams.set("page","logs");
      const sub = parts[1];
      setOrDel(u.searchParams,"log_type", sub);
      // chatId covers chat logs; callId/call_id/call cover call logs
      const callId = iu.searchParams.get("chatId") || iu.searchParams.get("callId") || iu.searchParams.get("call_id") || iu.searchParams.get("call");
      setOrDel(u.searchParams,"call", callId);
      const apiLogId = iu.searchParams.get("apiLogId") || iu.searchParams.get("api_log_id");
      setOrDel(u.searchParams,"log", apiLogId);
      const agentId = iu.searchParams.get("agentId");
      if (sub === "call") {
        setOrDel(u.searchParams,"agentId", agentId);
        u.searchParams.delete("model");
      } else {
        setOrDel(u.searchParams,"model", agentId);
        u.searchParams.delete("agentId");
      }
    },
  };

  const mapIframeToBubblePath = (iframePath) => {
    const iu = new URL(iframePath, location.origin);
    const bubblePage = mapBubblePageUrl(iu);
    if (bubblePage) return bubblePage;

    const parts = iu.pathname.split("/").filter(Boolean);
    const route = parts[0];
    const host = new URL(location.href);

    normalizeGlobals(host, iu);

    const mutate = ROUTES[route];
    if (!mutate) {
      log("Unknown iframe route:", { iframePath, route });
      return { bubblePath:null, newPage:null };
    }

    mutate(host, parts, iu);
    if (!host.searchParams.get("page")) {
      log("Route canceled without page:", { iframePath, route });
      return { bubblePath:null, newPage:null };
    }

    copyAllowedParams(host, iu, host.searchParams.get("page"));
    preserveLogsCallAgentId(host);
    applyAllow(host, host.searchParams.get("page"));

    const bubblePath = getAfterPortal(host);
    log("Mapped iframe route →", { iframePath, route, bubblePath });
    return { bubblePath, newPage: host.searchParams.get("page") };
  };

  const iframeRoute = (iframePath) => {
    try { return new URL(iframePath, location.origin).pathname.split("/").filter(Boolean)[0] || ""; }
    catch { return ""; }
  };

  const refreshBubblePage = (reason) => {
    const fn = window.bubble_fn_refresh_page;
    if (typeof fn === "function") {
      try { fn(); log("Triggered Bubble page refresh ←", reason); } catch (e) { if (DEBUG) console.error(e); }
    } else {
      log("bubble_fn_refresh_page missing; skip");
    }
  };

  window.__portalListenerDebug = () => ({
    waitForReactIframeAuth: WAIT_FOR_REACT_IFRAME_AUTH,
    isReactIframeAuthReady: isReactIframeAuthReady(),
    landingPage: cleanDynamicText(window.__reactIframeLandingPage),
    selectedIframeFn: iframeSyncFnName(),
    refreshFn: typeof window.bubble_fn_refresh_page,
    currentWorkspace: workspaceParam(),
    lastWorkspace,
    parentUrl: location.href,
  });

  function refreshIfWorkspaceChanged(reason, href) {
    const nextWorkspace = workspaceParam(href);
    if (nextWorkspace === lastWorkspace) return false;

    const previousWorkspace = lastWorkspace;
    lastWorkspace = nextWorkspace;
    log("Workspace changed:", previousWorkspace, "→", nextWorkspace);
    refreshBubblePage(reason);
    return true;
  }

  /* ==============================
   * Soft navigation (no reload)
   * ============================== */
  const softNavigate = (href, meta) => {
    const state = { portalNav:true, ...meta, href };
    // The iframe already creates the browser history entry for React route
    // changes. Mirror that entry in the parent URL instead of adding a second
    // parent entry, otherwise Back has to be clicked twice.
    try { history.replaceState(state, "", href); }
    catch { try { history.pushState(state, "", href); } catch {} }

    try { lastSyncedCanon = canon(getAfterPortal(new URL(href, location.origin))); } catch {}

    try {
      window.dispatchEvent(new PopStateEvent("popstate", { state }));
    } catch {
      try {
        const ev = document.createEvent("PopStateEvent");
        ev.initPopStateEvent("popstate", false, false, state);
        window.dispatchEvent(ev);
      } catch {
        try { window.dispatchEvent(new Event("popstate")); } catch {}
      }
    }

    const shouldSyncIframeFromUrl = meta.pageWillChange && BUBBLE_PAGE_PASSTHROUGH.has(meta.newPage);

    if (shouldSyncIframeFromUrl) {
      log(`Calling ${iframeSyncFnName()} due to page change →`, meta.newPage);
      syncIframesFromUrl("iframe_initiated_page_change");
    } else if (meta.pageWillChange) {
      log("Skipped iframe src sync for full-iframe React page change →", meta.newPage);
    }

    if (meta.workspaceWillChange) refreshIfWorkspaceChanged("workspace change from iframe navigation", href);
  };

  /* ==============================
   * Message handling (from iframe)
   * ============================== */
  const normalizeMsg = (raw) => {
    if (Array.isArray(raw)) {
      const a = raw.map(v => v == null ? "" : String(v));
      const blank = (a[0]||"").toLowerCase() === "_blank" ? {path:a[1],target:"_blank"} :
                    (a[1]||"").toLowerCase() === "_blank" ? {path:a[0],target:"_blank"} :
                    {path:a[0]||"", target:(a[1]||"").toLowerCase()};
      return blank;
    }
    if (raw && typeof raw === "object") {
      const p = raw.path ?? raw.payload ?? raw;
      const t = (raw.target || "").toString().toLowerCase();
      if (Array.isArray(p)) { const n = normalizeMsg(p); return { path:n.path, target:n.target || t }; }
      return { path: typeof p === "string" ? p : "", target: t };
    }
    if (typeof raw === "string") return { path: raw, target: "" };
    return { path:"", target:"" };
  };

  const msgType = (data) => {
    const nested = data && typeof data === "object" && data.payload && typeof data.payload === "object" ? data.payload : null;
    return (data?.type ?? nested?.type ?? "").toString().toLowerCase();
  };

  const messageDebugSummary = (data) => {
    if (typeof data === "string") return { rawString: data };
    if (!data || typeof data !== "object") return { kind: typeof data };

    const nested = data.payload && typeof data.payload === "object" ? data.payload : null;
    const normalized = normalizeMsg(data.path ?? data.payload ?? data);
    return {
      type: msgType(data),
      target: data.target || nested?.target || normalized.target || "",
      path: normalized.path || data.path || nested?.path || "",
      payloadType: Array.isArray(data.payload) ? "array" : typeof data.payload,
      keys: Object.keys(data).slice(0, 8),
    };
  };

  const ackWorkspaceChange = (event, workspace) => {
    try {
      event.source?.postMessage(
        { type: "set_workspace_ack", workspace },
        event.origin && event.origin !== "null" ? event.origin : "*"
      );
    } catch (e) { if (DEBUG) console.error(e); }
  };

  let pending = null, t = null;

  listen(window, "message", (event) => {
    if (ALLOWED_ORIGIN !== "*" && event.origin !== ALLOWED_ORIGIN) return;

    const data = event.data || {};
    const type = msgType(data);
    log("Message received:", { origin: event.origin, summary: messageDebugSummary(data) });
    if (type !== "navigate" && type !== "logout" && type !== "set_workspace") {
      log("Ignored message: unsupported type", messageDebugSummary(data));
      return;
    }

    const frame = sourceIframe(event);
    if (!frame || !isVisible(frame)) { log(`Ignored ${type}: iframe not found/visible`); return; }

    if (type === "set_workspace") {
      const workspace = String(data.workspace ?? data.workspace_id ?? data.payload?.workspace ?? data.payload?.workspace_id ?? "");
      if (!workspace) { log("Ignored set_workspace: missing workspace"); return; }

      const cur = new URL(location.href);
      const currentWorkspace = cur.searchParams.get("workspace") || "";
      if (workspace === currentWorkspace) {
        const refreshed = refreshIfWorkspaceChanged("set_workspace message already reflected in URL", cur.href);
        if (!refreshed) log("Ignored set_workspace: workspace unchanged", workspace);
        ackWorkspaceChange(event, workspace);
        return;
      }

      cur.searchParams.set("workspace", workspace);
      history.replaceState({ portalNav: true, workspaceSync: true }, "", cur.href);
      lastSyncedCanon = canon(getAfterPortal(cur));
      refreshIfWorkspaceChanged("set_workspace message", cur.href);
      ackWorkspaceChange(event, workspace);
      return;
    }

    if (type === "logout") {
      const fn = window.bubble_fn_logout;
      if (typeof fn === "function") {
        try { fn(); log("Triggered parent logout from iframe message"); } catch (e) { if (DEBUG) console.error(e); }
      } else {
        log("bubble_fn_logout missing; skip");
      }
      return;
    }

    // The aurora app sends a spurious /agents redirect on load. Suppress only
    // that startup redirect; allow normal user navigation away from aurora.
    const currentPage = new URL(location.href).searchParams.get("page");
    const { path: msgPath } = normalizeMsg(data.path ?? data.payload ?? data);
    if (
      currentPage === "aurora" &&
      iframeRoute(msgPath) === "agents" &&
      Date.now() - lastAuroraSyncAt < AURORA_REDIRECT_GRACE_MS
    ) {
      log("Ignored: aurora startup redirect to", msgPath);
      return;
    }

    const normalizedNavigate = normalizeMsg(data.path ?? data.payload ?? data);
    const path = normalizedNavigate.path;
    const target = normalizedNavigate.target || (data.target || "").toString().toLowerCase();
    if (!path) { log("Ignored navigate: missing path", messageDebugSummary(data)); return; }

    pending = { path, target };
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      const payload = pending; pending = null; t = null;
      if (!payload) return;

      if (payload.target === "_blank") {
        let url = toAbs(payload.path);
        try {
          const { bubblePath } = mapIframeToBubblePath(payload.path);
          if (bubblePath) url = buildHref(bubblePath);
        } catch (e) { if (DEBUG) console.error(e); }
        log("Opening new tab:", url); openBlank(url); return;
      }

      const { bubblePath, newPage } = mapIframeToBubblePath(payload.path);
      if (!bubblePath) { log("No bubblePath (route canceled/unknown)"); return; }

      const nowCanon = canon(getAfterPortal(new URL(location.href)));
      const dstCanon = canon(bubblePath);
      if (canonEq(dstCanon, nowCanon)) { log("No-op: canonical match"); return; }

      const newHref = buildHref(bubblePath);
      const pageWillChange = (newPage || "") !== (new URL(location.href)).searchParams.get("page");
      const currentWorkspace = (new URL(location.href)).searchParams.get("workspace") || "";
      const nextWorkspace = (new URL(newHref, location.origin)).searchParams.get("workspace") || "";
      const workspaceWillChange = nextWorkspace !== currentWorkspace;

      log("Soft navigate →", newHref, { pageWillChange, workspaceWillChange, newPage });
      softNavigate(newHref, { pageWillChange, workspaceWillChange, newPage, targetCanon:dstCanon, currentCanon:nowCanon });
    }, DEBOUNCE_MS);
  });

  // Initial deep-link sync
  if (document.readyState === "loading") {
    listen(window, "DOMContentLoaded", () => syncIframesFromUrl("initial_load"));
  } else {
    syncIframesFromUrl("initial_load");
  }
})();
