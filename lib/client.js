window.__ModuleLoader__.load({
	id: "dsh-model-refresh",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
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
var box = { border: "1px solid var(--dsh-border, #555)", borderRadius: 8, padding: "12px 14px", marginBottom: 10 };
var row = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };
var muted = { opacity: 0.72, fontSize: 12, lineHeight: 1.6 };
var input = { padding: "6px 8px", borderRadius: 6, border: "1px solid var(--dsh-border, #555)", background: "var(--dsh-bg, #1e1e1e)", color: "inherit", maxWidth: "100%", boxSizing: "border-box" };
var button = { padding: "6px 12px", borderRadius: 6, cursor: "pointer" };
var warning = { ...muted, color: "var(--dsh-warning, #dba449)", opacity: 1 };
var failure = { color: "var(--dsh-error, #e97878)", fontSize: 13, overflowWrap: "anywhere" };
var badge = { ...muted, border: "1px solid var(--dsh-border, #555)", padding: "2px 8px", borderRadius: 999 };
async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`\u8BFB\u53D6\u72B6\u6001\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
  return res.json();
}
async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      if (typeof data.error === "string") detail = `\uFF1A${data.error}`;
    } catch {
    }
    throw new Error(`\u64CD\u4F5C\u5931\u8D25\uFF08HTTP ${res.status}\uFF09${detail}`);
  }
}
function fmtTime(value) {
  if (!value) return "\u2014";
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString();
}
function messageOf(e) {
  return e instanceof Error ? e.message : String(e);
}
function hasIssue(r) {
  return Boolean(r.error || r.warnings?.length || r.conflicts?.length || r.official === "failed" || r.official === "no-key");
}
function toGlobalDraft(s) {
  return {
    endpoint: s.endpoint,
    intervalMinutes: String(s.intervalMinutes),
    proxyUrl: s.proxyUrl,
    patchCatalog: s.patchCatalog,
    removeStale: s.removeStale,
    litellmEnabled: s.litellmEnabled,
    officialVerify: s.officialVerify,
    staleGraceHours: String(s.staleGraceHours ?? 24),
    staleConfirmations: String(s.staleConfirmations ?? 2)
  };
}
function toOfficialDraft(config) {
  return {
    disabled: config === null,
    endpoint: config?.endpoint ?? "",
    baseUrl: config?.baseUrl ?? "",
    auth: config?.auth ?? "",
    protocol: config?.protocol ?? "",
    apiKeyEnv: config?.apiKeyEnv ?? "",
    complete: config?.complete === true,
    assumeChat: config?.assumeChat === true,
    contextWindow: config?.contextWindow === void 0 ? "" : String(config.contextWindow),
    maxTokens: config?.maxTokens === void 0 ? "" : String(config.maxTokens)
  };
}
function numberValue(value, label, minimum, integer = false) {
  const n = Number(value);
  if (value.trim() === "" || !Number.isFinite(n) || n < minimum || integer && !Number.isInteger(n)) {
    throw new Error(`${label}\u987B\u4E3A${integer ? "\u6574\u6570" : "\u6570\u5B57"}\uFF0C\u4E14\u4E0D\u5C0F\u4E8E ${minimum}`);
  }
  return n;
}
function officialValue(draft) {
  if (draft.disabled) return null;
  const endpoint = draft.endpoint.trim();
  if (endpoint) {
    const url = new URL(endpoint);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("\u5B98\u65B9\u7AEF\u70B9\u987B\u4E3A\u4E0D\u542B\u5185\u5D4C\u51ED\u636E\u7684 HTTP(S) URL");
  }
  const apiKeyEnv = draft.apiKeyEnv.trim();
  if (apiKeyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) throw new Error("\u51ED\u636E\u73AF\u5883\u53D8\u91CF\u540D\u79F0\u683C\u5F0F\u65E0\u6548\uFF1B\u8BF7\u52FF\u8F93\u5165\u771F\u5B9E\u5BC6\u94A5");
  const contextWindow = draft.contextWindow.trim() ? numberValue(draft.contextWindow, "\u4E0A\u4E0B\u6587\u5BB9\u91CF", 1, true) : void 0;
  const maxTokens = draft.maxTokens.trim() ? numberValue(draft.maxTokens, "\u8F93\u51FA\u5BB9\u91CF", 1, true) : void 0;
  if (contextWindow !== void 0 && maxTokens !== void 0 && maxTokens > contextWindow) throw new Error("\u8F93\u51FA\u5BB9\u91CF\u4E0D\u80FD\u5927\u4E8E\u4E0A\u4E0B\u6587\u5BB9\u91CF");
  const baseUrl = draft.baseUrl.trim();
  if (baseUrl) {
    const url = new URL(baseUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("\u63A8\u7406 baseUrl \u65E0\u6548");
  }
  return {
    endpoint: endpoint || void 0,
    baseUrl: baseUrl || void 0,
    auth: draft.auth || void 0,
    protocol: draft.protocol || void 0,
    apiKeyEnv: apiKeyEnv || void 0,
    complete: draft.complete,
    assumeChat: draft.assumeChat,
    contextWindow,
    maxTokens
  };
}
async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const previous = document.activeElement;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  try {
    ta.select();
    if (!document.execCommand("copy")) throw new Error("\u526A\u8D34\u677F\u4E0D\u53EF\u7528");
  } finally {
    ta.remove();
    previous?.focus();
  }
}
function GrantDialog(props) {
  const root = (0, import_react.useRef)(null);
  const [copyResult, setCopyResult] = (0, import_react.useState)("");
  (0, import_react.useEffect)(() => {
    const previous = document.activeElement;
    const dialog = root.current;
    dialog?.querySelector("button")?.focus();
    const keydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll('button:not(:disabled), [tabindex="0"]'));
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [props.onClose]);
  const copy = async () => {
    try {
      await copyText(props.command);
      setCopyResult("\u5DF2\u590D\u5236");
    } catch {
      setCopyResult("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u9009\u4E2D\u4E0B\u9762\u547D\u4EE4\u540E\u624B\u52A8\u590D\u5236\u3002");
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { position: "fixed", inset: 0, zIndex: 1e3, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center" }, onClick: props.onClose, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ref: root, role: "dialog", "aria-modal": "true", "aria-labelledby": "model-refresh-grant-title", style: { ...box, background: "var(--dsh-bg, #1e1e1e)", width: "90%", maxWidth: 600, maxHeight: "85vh", overflow: "auto" }, onClick: (e) => e.stopPropagation(), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...row, justifyContent: "space-between" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { id: "model-refresh-grant-title", children: "\u76EE\u5F55\u5199\u5165\u6388\u6743\u8BF4\u660E" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, onClick: props.onClose, children: "\u5173\u95ED" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: muted, children: "\u4EC5\u5728\u786E\u8BA4\u6388\u6743\u8303\u56F4\u540E\uFF0C\u4EE5\u7BA1\u7406\u5458\u8EAB\u4EFD\u6253\u5F00 PowerShell \u624B\u52A8\u6267\u884C\u3002\u6B64\u9875\u9762\u4E0D\u4F1A\u6267\u884C\u547D\u4EE4\u6216\u81EA\u52A8\u91CD\u542F\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { tabIndex: 0, style: { display: "block", padding: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere", userSelect: "all", border: "1px solid var(--dsh-border, #555)" }, children: props.command }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...row, marginTop: 10 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, onClick: () => void copy(), children: "\u590D\u5236\u547D\u4EE4" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { role: "status", style: muted, children: copyResult })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: muted, children: props.note })
  ] }) });
}
function IdList(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 13, marginTop: 5, overflowWrap: "anywhere" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: props.label }),
    " ",
    props.ids === void 0 ? props.unknown ?? "\u5C1A\u65E0\u8BB0\u5F55" : `${props.ids.length}\uFF1A${props.ids.join("\u3001") || "\u2014"}`
  ] });
}
function RouteCard(props) {
  const { r, busy, expanded } = props;
  const [draft, setDraft] = (0, import_react.useState)(() => toOfficialDraft(props.config));
  const [localError, setLocalError] = (0, import_react.useState)(null);
  const dirty = (0, import_react.useRef)(false);
  (0, import_react.useEffect)(() => {
    if (!dirty.current) setDraft(toOfficialDraft(props.config));
  }, [props.config]);
  const change = (key, value) => {
    dirty.current = true;
    setDraft((old) => ({ ...old, [key]: value }));
  };
  const save = async () => {
    setLocalError(null);
    try {
      if (await props.onSaveOfficial(officialValue(draft))) dirty.current = false;
    } catch (e) {
      setLocalError(messageOf(e));
    }
  };
  const officialLabel = r.official === "verified" ? `\u5B98\u65B9\u6E05\u5355\u5DF2\u8FD4\u56DE${r.officialComplete === true ? " \xB7 \u5B8C\u6574" : " \xB7 \u5B8C\u6574\u6027\u672A\u786E\u8BA4"}` : r.official === "failed" ? "\u5B98\u65B9\u6E05\u5355\u62C9\u53D6\u5931\u8D25" : r.official === "no-key" ? "\u5B98\u65B9\u6E05\u5355\u7F3A\u51ED\u636E" : "\u5B98\u65B9\u6E05\u5355\u672A\u6838\u5BF9";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: box, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: row, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", style: { ...button, fontWeight: 600 }, "aria-expanded": expanded, onClick: props.onToggle, children: [
        expanded ? "\u25BE" : "\u25B8",
        " ",
        r.route
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: r.enabled, disabled: busy, onChange: (e) => props.onEnable(e.target.checked) }),
        "\u542F\u7528"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: badge, children: r.source === "none" ? "\u65E0\u7B2C\u4E09\u65B9\u6E90" : r.source ?? "\u5C1A\u672A\u5237\u65B0" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: r.official === "failed" || r.official === "no-key" ? warning : badge, children: officialLabel }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: muted, children: [
        r.models ?? "\u2014",
        " \u4E2A\u6A21\u578B \xB7 \u53D1\u73B0 ",
        r.added?.length ?? 0,
        " \xB7 \u5DF2\u5E94\u7528 ",
        r.applied?.length ?? "\u2014",
        " \xB7 \u5F85\u786E\u8BA4 ",
        r.pending?.length ?? 0
      ] }),
      hasIssue(r) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: warning, children: "\u6709\u5F02\u5E38 / \u8B66\u544A" })
    ] }),
    expanded && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginTop: 12, borderTop: "1px solid var(--dsh-border, #555)", paddingTop: 10 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: muted, children: [
        "\u5237\u65B0\u65F6\u95F4\uFF1A",
        fmtTime(r.fetchedAt),
        " \xB7 \u76EE\u5F55\u57FA\u7EBF\uFF1A",
        fmtTime(r.installedAt),
        r.as ? ` \xB7 \u5143\u6570\u636E\u6620\u5C04\uFF1A${r.as}` : ""
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: muted, children: "\u5B98\u65B9\u6E05\u5355\u8FD4\u56DE\u4EC5\u786E\u8BA4\u6A21\u578B\u5217\u51FA\uFF0C\u4E0D\u4EE3\u8868\u63A8\u7406\u5DF2\u6D4B\u901A\u3002\u53EA\u6709\u6743\u5A01\u5957\u9910\u5168\u91CF\u6E05\u5355\u4E14\u5B8C\u6574\u6027\u786E\u8BA4\uFF0C\u624D\u53EF\u7528\u4E8E\u7F3A\u5931\u5224\u5B9A\uFF1B\u7F3A\u51ED\u636E\u6216\u62C9\u53D6\u5931\u8D25\u65F6\u4FDD\u7559\u5DF2\u6709\u76EE\u5F55\u3002" }),
      r.source === "none" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: muted, children: "\u65E0\u7B2C\u4E09\u65B9\u5143\u6570\u636E\u4ECD\u53EF\u901A\u8FC7\u5B98\u65B9\u6E05\u5355\u53D1\u73B0\u65B0\u6A21\u578B\uFF1B\u80FD\u529B\u3001\u5BB9\u91CF\u6216\u534F\u8BAE\u4F9D\u636E\u4E0D\u8DB3\u7684\u6761\u76EE\u5E94\u8FDB\u5165\u5F85\u786E\u8BA4\u3002" }),
      !r.enabled && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: warning, children: "\u8DEF\u7531\u5DF2\u505C\u7528\u3002\u662F\u5426\u6062\u590D\u6216\u56DE\u6EDA\u4EE5\u5B9E\u9645\u540C\u6B65\u8BB0\u5F55\u4E3A\u51C6\uFF0C\u505C\u7528\u672C\u8EAB\u4E0D\u8BC1\u660E\u56DE\u6EDA\u6210\u529F\u3002" }),
      r.error && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { role: "alert", style: failure, children: [
        "\u8DEF\u7531\u9519\u8BEF\uFF1A",
        r.error
      ] }),
      r.warnings?.map((item, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: warning, children: [
        "\u8B66\u544A\uFF1A",
        item
      ] }, i)),
      r.conflicts?.map((item, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: warning, children: [
        "\u540C\u6B65\u51B2\u7A81\uFF1A",
        item
      ] }, i)),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IdList, { label: "\u53D1\u73B0\u65B0\u589E\uFF08diff.added\uFF0C\u4E0D\u7B49\u4E8E\u5199\u5165\u6210\u529F\uFF09", ids: r.added }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IdList, { label: "\u771F\u5B9E\u5DF2\u5E94\u7528", ids: r.applied, unknown: "\u540E\u7AEF\u5C1A\u672A\u63D0\u4F9B\u5E94\u7528\u8BB0\u5F55\uFF0C\u4E0D\u80FD\u63A8\u65AD\u5DF2\u5199\u5165" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IdList, { label: "\u5B9E\u9645\u5DF2\u79FB\u9664", ids: r.removed, unknown: "\u540E\u7AEF\u5C1A\u672A\u63D0\u4F9B\u79FB\u9664\u8BB0\u5F55" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IdList, { label: "\u5B98\u65B9\u8865\u7F3A\u5019\u9009", ids: r.officialAdded }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IdList, { label: "\u7F3A\u5931\u5019\u9009\uFF08\u4E0D\u7B49\u4E8E\u5DF2\u5220\u9664\uFF09", ids: r.stale }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IdList, { label: "\u672A\u9A8C\u8BC1\u5019\u9009", ids: r.unverified }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IdList, { label: "\u56FA\u5B9A\u4FDD\u7559", ids: r.keep }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IdList, { label: "\u56FA\u5B9A\u6392\u9664", ids: r.exclude }),
      (r.pending?.length ?? 0) > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginTop: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
          "\u5F85\u786E\u8BA4 ",
          r.pending?.length
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { style: { ...muted, overflowWrap: "anywhere" }, children: r.pending?.map((item, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: item.id }),
          "\uFF1A",
          item.reason
        ] }, `${item.id}-${i}`)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...muted, marginTop: 8, overflowWrap: "anywhere" }, children: [
        "\u5B9E\u9645\u6838\u5BF9\u7AEF\u70B9\uFF1A",
        r.officialEndpoint ?? "\u5C1A\u65E0\u8BB0\u5F55"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { style: { marginTop: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", { style: { cursor: "pointer" }, children: [
          "\u5B98\u65B9\u6E05\u5355\u9AD8\u7EA7\u914D\u7F6E",
          dirty.current ? "\uFF08\u8349\u7A3F\u672A\u4FDD\u5B58\uFF09" : ""
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: muted, children: "\u4EC5\u914D\u7F6E\u7AEF\u70B9\u3001\u534F\u8BAE\u4E0E\u51ED\u636E\u540D\u79F0\uFF0C\u4E0D\u8F93\u5165\u771F\u5B9E\u5BC6\u94A5\u3002\u7A7A\u5B57\u6BB5\u5141\u8BB8\u540E\u7AEF\u91C7\u7528\u5DF2\u9A8C\u8BC1\u9ED8\u8BA4\u503C\uFF1B\u672A\u77E5\u534F\u8BAE\u4E0D\u5F97\u731C\u6D4B\u3002\u5B8C\u6574\u6027\u9ED8\u8BA4\u5173\u95ED\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { disabled: busy, style: { border: 0, padding: 0, margin: 0 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: row, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: draft.disabled, onChange: (e) => change("disabled", e.target.checked) }),
            "\u7981\u7528\u6B64\u8DEF\u7531\u5B98\u65B9\u6838\u5BF9\uFF08\u914D\u7F6E\u4E3A null\uFF09"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "grid", gap: 8, marginTop: 8 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
              "\u5B98\u65B9\u5217\u8868\u5B8C\u6574 URL ",
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...input, width: "100%" }, type: "url", value: draft.endpoint, disabled: draft.disabled, placeholder: "https://provider.example/v1/models", onChange: (e) => change("endpoint", e.target.value) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
              "\u63A8\u7406 baseUrl\uFF08\u4E0E\u5217\u8868 URL \u5206\u5F00\uFF09 ",
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...input, width: "100%" }, type: "url", value: draft.baseUrl, disabled: draft.disabled, placeholder: "\u7559\u7A7A\u7EE7\u627F\u76EE\u5F55\u540C\u534F\u8BAE\u7AEF\u70B9", onChange: (e) => change("baseUrl", e.target.value) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
              "\u6E05\u5355\u9274\u6743 ",
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { style: { ...input, marginLeft: 8 }, value: draft.auth, disabled: draft.disabled, onChange: (e) => change("auth", e.target.value), children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u4F7F\u7528\u9002\u914D\u5668\u9ED8\u8BA4" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "bearer", children: "Bearer" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "anthropic", children: "Anthropic x-api-key" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "none", children: "\u516C\u5F00\u63A5\u53E3\uFF08\u4E0D\u53D1\u51ED\u636E\uFF09" })
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
              "\u63A8\u7406\u534F\u8BAE ",
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { style: { ...input, marginLeft: 8 }, value: draft.protocol, disabled: draft.disabled, onChange: (e) => change("protocol", e.target.value), children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: "\u4F7F\u7528\u5DF2\u9A8C\u8BC1\u9ED8\u8BA4 / \u4E0D\u6307\u5B9A" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "openai-completions", children: "openai-completions" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "openai-responses", children: "openai-responses" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "anthropic-messages", children: "anthropic-messages" })
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
              "\u51ED\u636E\u73AF\u5883\u53D8\u91CF\u540D\u79F0 ",
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...input, width: "100%" }, value: draft.apiKeyEnv, disabled: draft.disabled, placeholder: "PROVIDER_API_KEY\uFF08\u540D\u79F0\uFF0C\u4E0D\u662F\u5BC6\u94A5\uFF09", autoComplete: "off", onChange: (e) => change("apiKeyEnv", e.target.value) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: row, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: draft.complete, disabled: draft.disabled, onChange: (e) => change("complete", e.target.checked) }),
              "\u6211\u786E\u8BA4\u6B64\u7AEF\u70B9\u8FD4\u56DE\u5F53\u524D\u5957\u9910\u7684\u6743\u5A01\u5168\u91CF\u6E05\u5355"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: warning, children: "\u4EC5\u660E\u786E\u786E\u8BA4\u5957\u9910\u8303\u56F4\u3001\u5206\u9875\u5904\u7406\u548C\u5B8C\u6574\u6027\u540E\u542F\u7528\uFF1B\u5F00\u542F\u540E\u5141\u8BB8\u5C06\u6E05\u5355\u7F3A\u5931\u7528\u4E8E\u79FB\u9664\u5224\u5B9A\u3002" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: row, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
                "\u672A\u77E5\u6A21\u578B\u4E0A\u4E0B\u6587\u9ED8\u8BA4\u503C ",
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...input, width: 130 }, type: "number", min: 1, step: 1, value: draft.contextWindow, disabled: draft.disabled, onChange: (e) => change("contextWindow", e.target.value) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
                "\u672A\u77E5\u6A21\u578B\u8F93\u51FA\u9ED8\u8BA4\u503C ",
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...input, width: 130 }, type: "number", min: 1, step: 1, value: draft.maxTokens, disabled: draft.disabled, onChange: (e) => change("maxTokens", e.target.value) })
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: muted, children: "\u663E\u5F0F\u9ED8\u8BA4\u503C\u662F\u4F60\u7684\u914D\u7F6E\uFF0C\u4E0D\u662F\u5B98\u65B9\u5DF2\u516C\u5E03\u7684\u6A21\u578B\u80FD\u529B\uFF1B\u7559\u7A7A\u65F6\u80FD\u529B\u4E0D\u8DB3\u7684\u6A21\u578B\u53EF\u80FD\u5F85\u786E\u8BA4\u3002" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: row, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: draft.assumeChat, disabled: draft.disabled, onChange: (e) => change("assumeChat", e.target.checked) }),
              "\u6211\u786E\u8BA4\u7F3A\u5C11\u7C7B\u578B\u5143\u6570\u636E\u7684\u5B98\u65B9\u65B0\u589E ID \u53EF\u7528\u4E8E\u6587\u672C\u804A\u5929"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: warning, children: "\u9ED8\u8BA4\u4E0D\u731C\u7528\u9014\u3002\u4EC5\u5728\u660E\u786E\u6B64\u5957\u9910\u53EA\u63D0\u4F9B\u804A\u5929\u6A21\u578B\u65F6\u786E\u8BA4\uFF1B\u660E\u786E\u6807\u4E3A embedding\u3001\u97F3\u9891\u6216\u56FE\u50CF\u751F\u6210\u7684\u6761\u76EE\u4ECD\u4E0D\u4F1A\u52A0\u5165\u3002" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...row, marginTop: 10 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, onClick: () => void save(), children: "\u4FDD\u5B58\u6B64\u8DEF\u7531\u5B98\u65B9\u914D\u7F6E" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, onClick: () => {
              dirty.current = false;
              setDraft(toOfficialDraft(props.config));
              setLocalError(null);
            }, children: "\u653E\u5F03\u8349\u7A3F" })
          ] })
        ] }),
        localError && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "alert", style: failure, children: localError })
      ] })
    ] })
  ] });
}
function ModelRefreshSettings() {
  const [status, setStatus] = (0, import_react.useState)(null);
  const [loadError, setLoadError] = (0, import_react.useState)(null);
  const [actionError, setActionError] = (0, import_react.useState)(null);
  const [notice, setNotice] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  const locked = (0, import_react.useRef)(false);
  const alive = (0, import_react.useRef)(true);
  const sequence = (0, import_react.useRef)(0);
  const draftInitialized = (0, import_react.useRef)(false);
  const draftRevision = (0, import_react.useRef)(void 0);
  const [draft, setDraft] = (0, import_react.useState)(null);
  const [expanded, setExpanded] = (0, import_react.useState)(/* @__PURE__ */ new Set());
  const [grantOpen, setGrantOpen] = (0, import_react.useState)(false);
  const [query, setQuery] = (0, import_react.useState)("");
  const [filter, setFilter] = (0, import_react.useState)("all");
  const closeGrant = (0, import_react.useCallback)(() => setGrantOpen(false), []);
  const reload = (0, import_react.useCallback)(async () => {
    const request = ++sequence.current;
    const next = await getJson(`${BASE}/status`);
    if (alive.current && request === sequence.current) {
      setStatus(next);
      setLoadError(null);
      if (!draftInitialized.current && next.settings) {
        setDraft(toGlobalDraft(next.settings));
        draftInitialized.current = true;
        draftRevision.current = next.settingsRevision;
      }
    }
    return next;
  }, []);
  (0, import_react.useEffect)(() => {
    alive.current = true;
    const poll = () => {
      void reload().catch((e) => {
        if (alive.current) setLoadError(messageOf(e));
      });
    };
    poll();
    const timer = window.setInterval(poll, 1e4);
    return () => {
      alive.current = false;
      sequence.current++;
      window.clearInterval(timer);
    };
  }, [reload]);
  const run = async (work, success) => {
    if (locked.current || status?.running) return false;
    locked.current = true;
    setBusy(true);
    setActionError(null);
    setNotice("");
    try {
      await work();
      if (alive.current) setNotice(success);
      return true;
    } catch (e) {
      if (alive.current) setActionError(messageOf(e));
      return false;
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const updateDraft = (key, value) => {
    setDraft((old) => old === null ? old : { ...old, [key]: value });
  };
  const saveGlobal = async () => {
    if (!draft) return;
    await run(async () => {
      const body = {
        ...draft,
        endpoint: draft.endpoint.trim(),
        proxyUrl: draft.proxyUrl.trim(),
        expectedRevision: draftRevision.current,
        intervalMinutes: numberValue(draft.intervalMinutes, "\u5237\u65B0\u95F4\u9694", 1, true),
        staleGraceHours: numberValue(draft.staleGraceHours, "\u7F3A\u5931\u5BBD\u9650\u671F", 1),
        staleConfirmations: numberValue(draft.staleConfirmations, "\u8FDE\u7EED\u786E\u8BA4\u6B21\u6570", 2, true)
      };
      await postJson(`${BASE}/config`, body);
      const next = await reload();
      if (alive.current) {
        setDraft(toGlobalDraft(next.settings));
        draftRevision.current = next.settingsRevision;
      }
    }, "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u3002\u5B9E\u9645\u53D8\u66F4\u8BF7\u4EE5\u5237\u65B0\u540E\u7684\u5E94\u7528\u8BB0\u5F55\u4E3A\u51C6\u3002");
  };
  const saveOfficial = async (route, config) => run(async () => {
    const latest = await getJson(`${BASE}/status`);
    const previous = latest.settings.officialRoutes ?? {};
    const value = config === null ? null : { ...previous[route] ?? {}, ...config };
    await postJson(`${BASE}/config`, { expectedRevision: latest.settingsRevision, officialRoutes: { ...previous, [route]: value } });
    await reload();
  }, `${route} \u5B98\u65B9\u914D\u7F6E\u5DF2\u4FDD\u5B58\u3002`);
  const toggleRoute = async (route, enabled) => {
    await run(async () => {
      await postJson(`${BASE}/route`, { route, enabled });
      await reload();
    }, `${route} ${enabled ? "\u542F\u7528" : "\u505C\u7528"}\u8BF7\u6C42\u5DF2\u63A5\u53D7\uFF1B\u540C\u6B65\u7ED3\u679C\u4EE5\u72B6\u6001\u8BB0\u5F55\u4E3A\u51C6\u3002`);
  };
  const refreshNow = async () => {
    await run(async () => {
      await postJson(`${BASE}/refresh`, {});
      await reload();
    }, "\u5237\u65B0\u8BF7\u6C42\u5DF2\u63A5\u53D7\uFF1B\u53D1\u73B0\u65B0\u589E\u3001\u5DF2\u5E94\u7528\u4E0E\u5F85\u786E\u8BA4\u4F1A\u5206\u522B\u66F4\u65B0\u3002");
  };
  const toggleExpand = (route) => setExpanded((old) => {
    const next = new Set(old);
    if (next.has(route)) next.delete(route);
    else next.add(route);
    return next;
  });
  const routes = status?.routes ?? [];
  const search = query.trim().toLocaleLowerCase();
  const visible = routes.filter((r) => {
    if (filter === "enabled" && !r.enabled) return false;
    if (filter === "issues" && !hasIssue(r)) return false;
    if (filter === "pending" && !r.pending?.length) return false;
    return !search || [r.route, r.as ?? "", ...r.added ?? [], ...r.applied ?? [], ...(r.pending ?? []).map((item) => `${item.id} ${item.reason}`), ...r.warnings ?? [], ...r.conflicts ?? [], r.error ?? ""].join(" ").toLocaleLowerCase().includes(search);
  });
  const sum = (key) => routes.reduce((n, r) => n + (r[key]?.length ?? 0), 0);
  const disabled = busy || status?.running === true || status?.initialized === false;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { maxWidth: 920 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { style: { marginTop: 0 }, children: "\u6A21\u578B\u76EE\u5F55\u5237\u65B0" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: muted, children: "\u5B98\u65B9\u6E05\u5355\u7528\u4E8E\u53D1\u73B0\u548C\u6838\u5BF9\uFF0C\u7B2C\u4E09\u65B9\u5143\u6570\u636E\u7528\u4E8E\u8F85\u52A9\u8865\u7F3A\u3002\u5DF2\u6709\u6A21\u578B\u9ED8\u8BA4\u4FDD\u7559\uFF1B\u5B58\u5728\u6027\u3001\u63A8\u7406\u534F\u8BAE\u3001\u5957\u9910\u8303\u56F4\u548C\u771F\u5B9E\u5199\u5165\u7ED3\u679C\u5206\u522B\u786E\u8BA4\u3002" }),
    loadError && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { role: "alert", style: { ...box, ...failure }, children: [
      "\u72B6\u6001\u8BFB\u53D6\u5931\u8D25\uFF1A",
      loadError,
      "\u3002\u4FDD\u7559\u4E0A\u6B21\u72B6\u6001\u4E0E\u672A\u4FDD\u5B58\u8349\u7A3F\u3002"
    ] }),
    actionError && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { role: "alert", style: { ...box, ...failure }, children: [
      "\u64CD\u4F5C\u5931\u8D25\uFF1A",
      actionError,
      " ",
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, onClick: () => setActionError(null), children: "\u5173\u95ED\u9519\u8BEF\u63D0\u793A" })
    ] }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "status", style: { ...box, ...muted }, children: notice }),
    !status && !loadError && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u72B6\u6001\u2026" }),
    status && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: box, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...row, justifyContent: "space-between" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: status.degraded ? "\u63D2\u4EF6\u542F\u52A8\u5931\u8D25" : status.running ? "\u6B63\u5728\u5237\u65B0\u2026" : "\u5237\u65B0\u5C31\u7EEA" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: muted, children: [
            "\u4E0A\u6B21\u8FD0\u884C\uFF1A",
            fmtTime(status.lastRun)
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, disabled, onClick: () => void refreshNow(), children: "\u7ACB\u5373\u5237\u65B0" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...row, marginTop: 12 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            routes.length,
            " \u4E2A\u8DEF\u7531"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            routes.filter((r) => r.enabled).length,
            " \u5DF2\u542F\u7528"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            routes.filter(hasIssue).length,
            " \u6709\u5F02\u5E38"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "\u53D1\u73B0 ",
            sum("added")
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "\u5DF2\u5E94\u7528 ",
            sum("applied"),
            routes.some((r) => r.applied === void 0) ? "\uFF08\u90E8\u5206\u8DEF\u7531\u672A\u62A5\u544A\uFF09" : ""
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "\u5F85\u786E\u8BA4 ",
            sum("pending")
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "\u5DF2\u79FB\u9664 ",
            sum("removed")
          ] })
        ] }),
        status.degraded && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "alert", style: failure, children: [
          "\u542F\u52A8\u5931\u8D25\uFF1A",
          status.lastError ?? "\u672A\u77E5\u539F\u56E0",
          "\u3002",
          status.degradedHint
        ] }),
        status.warnings?.map((item, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: warning, children: item }, i)),
        !status.degraded && status.lastError && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { role: "alert", style: failure, children: [
          "\u6700\u8FD1\u8FD0\u884C\u9519\u8BEF\uFF1A",
          status.lastError
        ] }),
        status.restartRequired && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: warning, children: "\u540E\u7AEF\u62A5\u544A\u76EE\u5F55\u5DF2\u53D8\u66F4\uFF0C\u9700\u8981\u91CD\u542F\u540E\u751F\u6548\u3002\u672C\u9875\u9762\u4E0D\u4F1A\u81EA\u52A8\u91CD\u542F\u3002" }),
        status.catalogWritable === false && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...row, marginTop: 10 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: warning, children: "\u76EE\u5F55\u5199\u5165\u4E0D\u53EF\u7528\uFF1B\u5019\u9009\u53D1\u73B0\u4E0D\u7B49\u4E8E\u5199\u5165\u6210\u529F\u3002" }),
          status.catalogGrantCommand && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, onClick: () => setGrantOpen(true), children: "\u67E5\u770B\u6388\u6743\u8BF4\u660E" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...row, marginBottom: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { flexGrow: 1 }, children: [
          "\u641C\u7D22\u8DEF\u7531 / \u6A21\u578B ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...input, width: "100%" }, type: "search", value: query, onChange: (e) => setQuery(e.target.value), placeholder: "\u540D\u79F0\u3001\u6A21\u578B ID\u3001\u5F85\u786E\u8BA4\u539F\u56E0" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          "\u7B5B\u9009 ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { style: input, value: filter, onChange: (e) => setFilter(e.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "all", children: "\u5168\u90E8" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "enabled", children: "\u5DF2\u542F\u7528" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "issues", children: "\u5F02\u5E38 / \u8B66\u544A" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "pending", children: "\u5F85\u786E\u8BA4" })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { children: [
        "Provider \u8DEF\u7531 ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { style: muted, children: [
          visible.length,
          " / ",
          routes.length,
          " \xB7 \u9ED8\u8BA4\u6298\u53E0"
        ] })
      ] }),
      visible.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: muted, children: "\u6CA1\u6709\u5339\u914D\u7684\u8DEF\u7531\u3002" }),
      routes.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { hidden: !visible.some((item) => item.route === r.route), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RouteCard, { r, config: status.settings.officialRoutes?.[r.route], busy: disabled, expanded: expanded.has(r.route), onToggle: () => toggleExpand(r.route), onEnable: (enabled) => void toggleRoute(r.route, enabled), onSaveOfficial: (config) => saveOfficial(r.route, config) }) }, r.route)),
      draft && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: { ...box, marginTop: 18 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: { marginTop: 0 }, children: "\u5168\u5C40\u8BBE\u7F6E" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: muted, children: "\u8F6E\u8BE2\u4E0D\u4F1A\u8986\u76D6\u672A\u4FDD\u5B58\u7684\u5168\u5C40\u8349\u7A3F\u3002\u4FDD\u5B58\u540E\u53EF\u7ACB\u5373\u5237\u65B0\uFF0C\u68C0\u67E5\u5F85\u786E\u8BA4\u4E0E\u540C\u6B65\u8BB0\u5F55\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { disabled, style: { border: 0, padding: 0, margin: 0, display: "grid", gap: 10 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
            "models.dev \u6570\u636E\u6E90 ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...input, width: "100%" }, type: "url", value: draft.endpoint, onChange: (e) => updateDraft("endpoint", e.target.value) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: row, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
              "\u95F4\u9694\uFF08\u5206\u949F\uFF09 ",
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...input, width: 110 }, type: "number", min: 1, value: draft.intervalMinutes, onChange: (e) => updateDraft("intervalMinutes", e.target.value) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
              "\u4EE3\u7406 URL\uFF08\u7559\u7A7A\u76F4\u8FDE\uFF09 ",
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: input, value: draft.proxyUrl, placeholder: "http://127.0.0.1:7890", onChange: (e) => updateDraft("proxyUrl", e.target.value) })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: row, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: draft.patchCatalog, onChange: (e) => updateDraft("patchCatalog", e.target.checked) }),
            "\u5141\u8BB8\u540C\u6B65\u5B89\u88C5\u76EE\u5F55 catalog\uFF08\u9700\u5199\u6743\u9650\uFF09"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: muted, children: "\u5173\u95ED\u6216\u505C\u7528\u4E0D\u4EE3\u8868\u56DE\u6EDA\u5DF2\u5B8C\u6210\uFF1B\u7ED3\u679C\u4EE5\u771F\u5B9E\u5E94\u7528\u8BB0\u5F55\u3001\u8B66\u544A\u4E0E\u51B2\u7A81\u4E3A\u51C6\u3002" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: row, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: draft.litellmEnabled, onChange: (e) => updateDraft("litellmEnabled", e.target.checked) }),
            "\u542F\u7528 LiteLLM \u8F85\u52A9\u5143\u6570\u636E"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: row, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: draft.officialVerify, onChange: (e) => updateDraft("officialVerify", e.target.checked) }),
            "\u542F\u7528\u5B98\u65B9\u6E05\u5355\u6838\u5BF9\u4E0E\u8865\u7F3A\uFF08\u65E0\u7B2C\u4E09\u65B9\u6E90\u4E5F\u53EF\u53D1\u73B0\uFF09"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: row, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: draft.removeStale, onChange: (e) => updateDraft("removeStale", e.target.checked) }),
            "\u5141\u8BB8\u79FB\u9664\u5B98\u65B9\u5B8C\u6574\u6E05\u5355\u8FDE\u7EED\u786E\u8BA4\u7F3A\u5931\u7684\u6A21\u578B"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: row, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
              "\u7F3A\u5931\u5BBD\u9650\u671F\uFF08\u5C0F\u65F6\uFF09 ",
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...input, width: 110 }, type: "number", min: 1, value: draft.staleGraceHours, onChange: (e) => updateDraft("staleGraceHours", e.target.value) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
              "\u8FDE\u7EED\u786E\u8BA4\u6B21\u6570 ",
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...input, width: 100 }, type: "number", min: 2, step: 1, value: draft.staleConfirmations, onChange: (e) => updateDraft("staleConfirmations", e.target.value) })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: warning, children: "\u9ED8\u8BA4 24 \u5C0F\u65F6\u5BBD\u9650\u671F + 2 \u6B21\u5B8C\u6574\u5B98\u65B9\u6E05\u5355\u786E\u8BA4\u3002\u7B2C\u4E09\u65B9\u7F3A\u5931\u3001\u7F3A\u51ED\u636E\u3001\u8BF7\u6C42\u5931\u8D25\u6216\u6E05\u5355\u4E0D\u5B8C\u6574\u5747\u4E0D\u80FD\u4F5C\u4E3A\u5220\u9664\u4F9D\u636E\uFF1B\u56FA\u5B9A\u4FDD\u7559\u4E0E\u540C\u6B65\u51B2\u7A81\u5E94\u963B\u6B62\u5220\u9664\u3002" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: row, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, onClick: () => void saveGlobal(), children: "\u4FDD\u5B58\u5168\u5C40\u8BBE\u7F6E" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, onClick: () => {
              setDraft(toGlobalDraft(status.settings));
              draftRevision.current = status.settingsRevision;
            }, children: "\u653E\u5F03\u5168\u5C40\u8349\u7A3F" })
          ] })
        ] })
      ] })
    ] }),
    grantOpen && status?.catalogGrantCommand && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(GrantDialog, { command: status.catalogGrantCommand, note: status.catalogGrantNote ?? "", onClose: closeGrant })
  ] });
}
var name = "dsh-model-refresh-client";
var inject = ["slots", "locale"];
function apply(ctx) {
  ctx.slots.inject("settings.section", () => {
    if (ctx.slots.entries("settings.section").some((entry) => entry.id === "model-refresh")) return () => void 0;
    return ctx.slots.register({ name: "settings.section", id: "model-refresh", order: 17, label: () => "\u6A21\u578B\u5237\u65B0", inject: () => ({}) }, ModelRefreshSettings);
  });
}

		return module.exports;
	}
});
