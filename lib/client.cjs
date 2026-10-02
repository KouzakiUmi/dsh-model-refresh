var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  ModelRefreshSettings: () => ModelRefreshSettings,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var BASE = "/plugins/dsh-model-refresh";
var box = {
  border: "1px solid var(--dsh-border, #333)",
  borderRadius: 8,
  padding: "12px 14px",
  marginBottom: 10
};
var row = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };
var muted = { opacity: 0.65, fontSize: 12 };
var input = {
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid var(--dsh-border, #333)",
  background: "transparent",
  color: "inherit",
  minWidth: 240
};
var button = { padding: "4px 14px", borderRadius: 6, cursor: "pointer" };
var codeBlock = {
  display: "block",
  padding: "10px 12px",
  borderRadius: 6,
  border: "1px solid var(--dsh-border, #333)",
  background: "rgba(127,127,127,0.12)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 13,
  wordBreak: "break-all",
  userSelect: "all"
};
async function getJson(path) {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}
async function postJson(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok && res.status !== 202) throw new Error(`${path}: ${res.status}`);
}
function fmtTime(iso) {
  if (iso === null || iso === void 0 || iso === "") return "\u2014";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
function copyText(text) {
  if (navigator.clipboard?.writeText !== void 0) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
    } catch (e) {
      reject(e);
    } finally {
      ta.remove();
    }
  });
}
function GrantDialog(props) {
  const [copied, setCopied] = (0, import_react.useState)(false);
  const doCopy = async () => {
    try {
      await copyText(props.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2e3);
    } catch (_e) {
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "div",
    {
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 1e3,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      },
      onClick: props.onClose,
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "div",
        {
          style: {
            ...box,
            maxWidth: 560,
            width: "92%",
            marginBottom: 0,
            background: "var(--dsh-bg, #1e1e1e)",
            padding: 18
          },
          onClick: (e) => e.stopPropagation(),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...row, justifyContent: "space-between" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "\u4E00\u6B21\u6027\u7BA1\u7406\u5458\u6388\u6743" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, onClick: props.onClose, children: "\u5173\u95ED" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: { fontSize: 13, opacity: 0.85 }, children: [
              "\u4EE5",
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "\u7BA1\u7406\u5458\u8EAB\u4EFD" }),
              "\u6253\u5F00 PowerShell\uFF0C\u7C98\u8D34\u4E0B\u9762\u7684\u547D\u4EE4\u5E76\u56DE\u8F66\uFF08\u8FD0\u884C\u4E00\u6B21\u5373\u53EF\uFF09\u3002"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { style: codeBlock, children: props.command }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...row, marginTop: 10 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: { ...button, fontWeight: 600 }, onClick: () => void doCopy(), children: copied ? "\u2713 \u5DF2\u590D\u5236" : "\u590D\u5236\u547D\u4EE4" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: muted, children: "\u547D\u4EE4\u57FA\u4E8E\u771F\u5B9E\u5B89\u88C5\u8DEF\u5F84\uFF1BSID 545 \u662F\u5185\u7F6E Users \u7EC4\uFF0C\u5404\u8BED\u8A00\u7CFB\u7EDF\u901A\u7528\u3002" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...muted, marginTop: 10, lineHeight: 1.6 }, children: props.note })
          ]
        }
      )
    }
  );
}
function RouteCard(props) {
  const { r, busy, expanded } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: box, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        style: { ...row, cursor: "pointer", userSelect: "none" },
        onClick: props.onToggle,
        role: "button",
        "aria-expanded": expanded,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 12, width: 16 }, children: expanded ? "\u2B06\uFE0F" : "\u2B07\uFE0F" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "label",
            {
              style: { display: "flex", alignItems: "center", gap: 8, fontWeight: 600 },
              onClick: (e) => e.stopPropagation(),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "input",
                  {
                    type: "checkbox",
                    checked: r.enabled,
                    disabled: busy,
                    onChange: (e) => props.onEnable(e.target.checked)
                  }
                ),
                r.route
              ]
            }
          ),
          r.models !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { fontSize: 13 }, children: [
            r.models,
            " \u4E2A\u6A21\u578B"
          ] }),
          !r.enabled && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { ...muted, color: "#b8860b" }, children: "\u5DF2\u505C\u7528" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: muted, children: [
            "\u6570\u636E\u65F6\u95F4\uFF1A",
            fmtTime(r.fetchedAt)
          ] })
        ]
      }
    ),
    expanded && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--dsh-border, #333)" }, children: [
      r.added !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 13, lineHeight: 1.9 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          "\u65B0\u589E ",
          r.added.length,
          "\uFF1A",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: muted, children: r.added.join(", ") || "\u2014" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          "\u5237\u65B0 ",
          r.updated?.length ?? 0,
          " \xB7 \u8FC7\u65F6 ",
          r.stale?.length ?? 0,
          " \xB7 \u6392\u9664 ",
          r.excluded?.length ?? 0
        ] }),
        (r.stale?.length ?? 0) > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          "\u8FC7\u65F6\uFF08\u4E0A\u6E38\u5DF2\u79FB\u9664\u3001\u9ED8\u8BA4\u4FDD\u7559\uFF09\uFF1A",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: muted, children: r.stale?.join(", ") })
        ] }),
        (r.excluded?.length ?? 0) > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          "\u672C\u8F6E\u6392\u9664\uFF1A",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: muted, children: r.excluded?.join(", ") })
        ] })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: muted, children: "\u5C1A\u672A\u62C9\u53D6\uFF08\u7B49\u5F85\u9996\u8F6E\u5237\u65B0\uFF09" }),
      r.exclude.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...muted, marginTop: 6 }, children: [
        "\u56FA\u5B9A\u6392\u9664\uFF1A",
        r.exclude.join(", ")
      ] }),
      r.keep.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...muted, marginTop: 2 }, children: [
        "\u56FA\u5B9A\u4FDD\u7559\uFF1A",
        r.keep.join(", ")
      ] }),
      !r.enabled && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...muted, marginTop: 6 }, children: "\u5DF2\u505C\u7528\uFF1A\u4EA7\u7269\u56DE\u9000\u4E3A\u5B89\u88C5\u76EE\u5F55\u5FEB\u7167\uFF0C\u63D2\u4EF6\u5408\u5165\u7684 catalog \u6761\u76EE\u5DF2\u56DE\u6EDA\u3002" })
    ] })
  ] });
}
function ModelRefreshSettings() {
  const [status, setStatus] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)(null);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [expanded, setExpanded] = (0, import_react.useState)(/* @__PURE__ */ new Set());
  const [grantOpen, setGrantOpen] = (0, import_react.useState)(false);
  const [endpoint, setEndpoint] = (0, import_react.useState)("");
  const [interval, setInterval_] = (0, import_react.useState)("");
  const [proxyUrl, setProxyUrl] = (0, import_react.useState)("");
  const [patchCatalog, setPatchCatalog] = (0, import_react.useState)(true);
  const [draftReady, setDraftReady] = (0, import_react.useState)(false);
  const reload = (0, import_react.useCallback)(async () => {
    try {
      const next = await getJson(`${BASE}/status`);
      setStatus(next);
      setError(null);
      if (!draftReady) {
        setEndpoint(next.settings.endpoint);
        setInterval_(String(next.settings.intervalMinutes));
        setProxyUrl(next.settings.proxyUrl);
        setPatchCatalog(next.settings.patchCatalog);
        setDraftReady(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [draftReady]);
  (0, import_react.useEffect)(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 1e4);
    return () => window.clearInterval(timer);
  }, [reload]);
  const toggleExpand = (route) => {
    setExpanded((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(route)) nextSet.delete(route);
      else nextSet.add(route);
      return nextSet;
    });
  };
  const saveConfig = async () => {
    setBusy(true);
    try {
      await postJson(`${BASE}/config`, {
        endpoint,
        intervalMinutes: Number(interval) || 360,
        proxyUrl,
        patchCatalog
      });
      setDraftReady(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const toggleRoute = async (route, enabled) => {
    setBusy(true);
    try {
      await postJson(`${BASE}/route`, { route, enabled });
      window.setTimeout(() => void reload(), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const refreshNow = async () => {
    setBusy(true);
    try {
      await postJson(`${BASE}/refresh`, {});
      window.setTimeout(() => void reload(), 2e3);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { maxWidth: 720 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { style: { marginTop: 0 }, children: "\u6A21\u578B\u5237\u65B0\uFF08dsh-model-refresh\uFF09" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: muted, children: "\u4ECE models.dev \u5B9A\u671F\u62C9\u53D6\u6700\u65B0\u6A21\u578B\u5143\u6570\u636E\uFF0C\u4E0E\u5DF2\u5B89\u88C5 pi-ai \u76EE\u5F55\u5408\u5E76\uFF0C\u5E76\u628A\u65B0\u6A21\u578B\u5408\u5165\u5B89\u88C5\u6811 catalog\u3002 \u6A21\u578B\u5217\u8868\u53D8\u66F4\u9700\u91CD\u542F DSH \u751F\u6548\uFF08\u4E24\u6B21\u91CD\u542F\u4E4B\u95F4\u662F\u5FEB\u7167\uFF09\u3002" }),
    error !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...box, borderColor: "#c0392b" }, children: [
      "\u52A0\u8F7D\u5931\u8D25\uFF1A",
      error
    ] }),
    status !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: box, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: row, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "\u8FD0\u884C\u72B6\u6001" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: status.running ? "\u5237\u65B0\u4E2D\u2026" : "\u7A7A\u95F2" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: muted, children: [
            "\u4E0A\u6B21\u5237\u65B0\uFF1A",
            fmtTime(status.lastRun)
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, disabled: busy || status.running, onClick: () => void refreshNow(), children: "\u7ACB\u5373\u5237\u65B0" })
        ] }),
        status.lastError !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { color: "#c0392b", marginTop: 6 }, children: [
          "\u6700\u8FD1\u9519\u8BEF\uFF1A",
          status.lastError
        ] }),
        status.restartRequired && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { marginTop: 6, color: "#b8860b" }, children: "\u5B89\u88C5\u6811 catalog \u5DF2\u53D8\u66F4 \u2014\u2014 \u91CD\u542F DSH \u540E\u751F\u6548\u3002" }),
        status.catalogWritable === false && status.catalogGrantCommand !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...row, marginTop: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: "#b8860b" }, children: "\u65B0\u6A21\u578B\u65E0\u6CD5\u5199\u5165\u5B89\u88C5\u6811 catalog\uFF08\u76EE\u5F55\u65E0\u5199\u6743\u9650\uFF09\u3002" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: { ...button, fontWeight: 600 }, onClick: () => setGrantOpen(true), children: "\u67E5\u770B\u6388\u6743\u547D\u4EE4" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { children: [
        "Provider \u8DEF\u7531\uFF08",
        status.routes.length,
        " \u4E2A\uFF0C\u70B9\u51FB\u5C55\u5F00\u8BE6\u60C5\uFF09"
      ] }),
      status.routes.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        RouteCard,
        {
          r,
          busy,
          expanded: expanded.has(r.route),
          onToggle: () => toggleExpand(r.route),
          onEnable: (enabled) => void toggleRoute(r.route, enabled)
        },
        r.route
      )),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "\u5168\u5C40\u8BBE\u7F6E" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: box, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: row, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { children: "\u6570\u636E\u6E90" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: input, value: endpoint, onChange: (e) => setEndpoint(e.target.value) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: row, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { children: "\u5237\u65B0\u95F4\u9694\uFF08\u5206\u949F\uFF09" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              style: { ...input, minWidth: 100 },
              value: interval,
              onChange: (e) => setInterval_(e.target.value)
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: row, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { children: "\u4EE3\u7406\uFF08http(s)://\uFF0C\u7559\u7A7A\u76F4\u8FDE\uFF09" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              style: input,
              value: proxyUrl,
              placeholder: "http://127.0.0.1:7890",
              onChange: (e) => setProxyUrl(e.target.value)
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: row, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              type: "checkbox",
              checked: patchCatalog,
              onChange: (e) => setPatchCatalog(e.target.checked)
            }
          ),
          "\u628A\u65B0\u6A21\u578B\u5199\u5165\u5B89\u88C5\u6811 catalog\uFF08\u9700\u8981\u76EE\u5F55\u5199\u6743\u9650\uFF09"
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...row, marginTop: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, disabled: busy, onClick: () => void saveConfig(), children: "\u4FDD\u5B58\u8BBE\u7F6E" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: muted, children: "\u4FDD\u5B58\u540E\u4E0B\u4E00\u8F6E\u5237\u65B0\u751F\u6548\uFF08\u6216\u70B9\u300C\u7ACB\u5373\u5237\u65B0\u300D\uFF09\u3002" })
        ] })
      ] })
    ] }),
    grantOpen && status?.catalogGrantCommand != null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      GrantDialog,
      {
        command: status.catalogGrantCommand,
        note: status.catalogGrantNote ?? "",
        onClose: () => setGrantOpen(false)
      }
    )
  ] });
}
var name = "dsh-model-refresh-client";
var inject = ["slots", "locale"];
function apply(ctx) {
  ctx.slots.inject("settings.section", () => {
    const existing = ctx.slots.entries("settings.section").some(
      (entry) => entry.id === "model-refresh"
    );
    if (existing) return () => void 0;
    return ctx.slots.register(
      {
        name: "settings.section",
        id: "model-refresh",
        order: 17,
        label: () => "\u6A21\u578B\u5237\u65B0",
        inject: () => ({})
      },
      ModelRefreshSettings
    );
  });
}
