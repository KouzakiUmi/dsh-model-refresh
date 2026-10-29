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
  return res.json();
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
  return Boolean(r.error || r.warnings?.length || r.official === "failed" || r.official === "no-key");
}
function toGlobalDraft(s) {
  return {
    intervalMinutes: String(s.intervalMinutes),
    proxyUrl: s.proxyUrl,
    removeStale: s.removeStale,
    modelsDevFallback: s.modelsDevFallback,
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
    apiKeyEnv: config?.apiKeyEnv ?? "",
    complete: config?.complete === true
  };
}
var EDITABLE_OFFICIAL_KEYS = ["endpoint", "baseUrl", "auth", "apiKeyEnv", "complete"];
function withoutEditableOfficialKeys(stored) {
  const output = {};
  for (const [key, value] of Object.entries(stored)) if (!EDITABLE_OFFICIAL_KEYS.includes(key)) output[key] = value;
  return output;
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
  const baseUrl = draft.baseUrl.trim();
  if (baseUrl) {
    const url = new URL(baseUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("\u6E05\u5355\u8BF7\u6C42\u6839 URL \u65E0\u6548");
  }
  const value = { complete: draft.complete };
  if (endpoint) value.endpoint = endpoint;
  if (baseUrl) value.baseUrl = baseUrl;
  if (draft.auth) value.auth = draft.auth;
  if (apiKeyEnv) value.apiKeyEnv = apiKeyEnv;
  return value;
}
function IdList(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { fontSize: 13, marginTop: 5, overflowWrap: "anywhere" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: props.label }),
    " ",
    props.ids === void 0 ? props.unknown ?? "\u5C1A\u65E0\u8BB0\u5F55" : `${props.ids.length}\uFF1A${props.ids.join("\u3001") || "\u2014"}`
  ] });
}
var MODEL_STATES = {
  ok: { label: "\u53EF\u7528", color: "var(--dsh-success, #3fb950)" },
  added: { label: "\u65B0\u589E", color: "var(--dsh-accent, #58a6ff)" },
  pending: { label: "\u5F85\u786E\u8BA4", color: "var(--dsh-warning, #d29922)" },
  stale: { label: "\u7F3A\u5931", color: "var(--dsh-warning, #d29922)" },
  unverified: { label: "\u672A\u9A8C\u8BC1", color: "var(--dsh-muted, #8b949e)" }
};
function fmtTokens(value) {
  if (typeof value !== "number" || value <= 0) return "\u2014";
  if (value >= 1e6) return `${(value / 1e6).toFixed(value % 1e6 === 0 ? 0 : 1)}M`;
  if (value >= 1024) return `${Math.round(value / 1024)}K`;
  return String(value);
}
function ModelTable(props) {
  const counts = { all: props.rows.length };
  for (const row2 of props.rows) counts[row2.state] = (counts[row2.state] ?? 0) + 1;
  const visible = props.filter === "all" ? props.rows : props.rows.filter((row2) => row2.state === props.filter);
  const order = ["pending", "added", "stale", "unverified", "ok"];
  const ordered = [...visible].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.id.localeCompare(b.id));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginTop: 8 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...row, flexWrap: "wrap", gap: 6 }, children: ["all", "ok", "added", "pending", "stale", "unverified"].map((key) => {
      const label = key === "all" ? "\u5168\u90E8" : MODEL_STATES[key].label;
      const active = props.filter === key;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          style: { ...button, fontWeight: active ? 600 : 400, opacity: counts[key] ? 1 : 0.5 },
          onClick: () => props.onFilter(key),
          children: [
            label,
            " ",
            counts[key] ?? 0
          ]
        },
        key
      );
    }) }),
    ordered.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: muted, children: "\u6B64\u7B5B\u9009\u4E0B\u6CA1\u6709\u6A21\u578B\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 6 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { style: { textAlign: "left" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: { padding: "4px 6px", width: 72 }, children: "\u72B6\u6001" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: { padding: "4px 6px" }, children: "\u6A21\u578B" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: { padding: "4px 6px", width: 110 }, children: "\u4E0A\u4E0B\u6587 / \u8F93\u51FA" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { style: { padding: "4px 6px" }, children: "\u5907\u6CE8" })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: ordered.map((row2) => {
        const meta = MODEL_STATES[row2.state];
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { style: { borderTop: "1px solid var(--dsh-border, #333)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { style: { padding: "4px 6px", color: meta.color, whiteSpace: "nowrap" }, children: meta.label }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", { style: { padding: "4px 6px", overflowWrap: "anywhere" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: row2.id }),
            row2.reasoning ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: muted, children: " \xB7 \u601D\u8003" }) : null,
            row2.input?.includes("image") ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: muted, children: " \xB7 \u56FE\u50CF" }) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", { style: { padding: "4px 6px", whiteSpace: "nowrap" }, children: [
            fmtTokens(row2.contextWindow),
            " / ",
            fmtTokens(row2.maxTokens)
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { style: { padding: "4px 6px", ...muted }, children: row2.reason ?? (row2.name && row2.name !== row2.id ? row2.name : "") })
        ] }, row2.id);
      }) })
    ] })
  ] });
}
function RouteCard(props) {
  const { r, busy, expanded } = props;
  const [draft, setDraft] = (0, import_react.useState)(() => toOfficialDraft(props.config));
  const [localError, setLocalError] = (0, import_react.useState)(null);
  const [modelFilter, setModelFilter] = (0, import_react.useState)("all");
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
  const modelRows = r.modelList ?? [];
  const pendingCount = modelRows.filter((m) => m.state === "pending").length;
  const addedCount = modelRows.filter((m) => m.state === "added").length;
  const mirrorName = r.mirrorRoute ?? "\uFF08\u540E\u7AEF\u672A\u63D0\u4F9B\u955C\u50CF\u8DEF\u7531\uFF09";
  const registeredLabel = r.registered === true ? "\u955C\u50CF provider \u5DF2\u6CE8\u518C" : r.registered === false ? "\u955C\u50CF provider \u672A\u6CE8\u518C" : "\u955C\u50CF provider \u6CE8\u518C\u72B6\u6001\u672A\u77E5";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { style: box, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: row, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", style: { ...button, fontWeight: 600 }, "aria-expanded": expanded, onClick: props.onToggle, children: [
        expanded ? "\u25BE" : "\u25B8",
        " ",
        r.route
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: r.enabled, disabled: busy, onChange: (e) => props.onEnable(e.target.checked) }),
        "\u542F\u7528\u52A8\u6001\u955C\u50CF"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: badge, children: [
        "\u6E90\u8DEF\u7531 \u2192 \u955C\u50CF\u8DEF\u7531\uFF1A",
        r.route,
        " \u2192 ",
        mirrorName
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: r.registered === true ? badge : warning, children: registeredLabel }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: muted, children: r.enabled ? "\u5DF2\u542F\u7528\u52A8\u6001\u955C\u50CF" : "\u672A\u542F\u7528\u52A8\u6001\u955C\u50CF" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: r.official === "failed" || r.official === "no-key" ? warning : badge, children: officialLabel }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: muted, children: [
        r.models ?? "\u2014",
        " \u4E2A\u6A21\u578B",
        pendingCount ? ` \xB7 \u5F85\u786E\u8BA4 ${pendingCount}` : "",
        addedCount ? ` \xB7 \u65B0\u589E ${addedCount}` : ""
      ] }),
      hasIssue(r) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: warning, children: "\u6709\u5F02\u5E38 / \u8B66\u544A" })
    ] }),
    expanded && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { marginTop: 12, borderTop: "1px solid var(--dsh-border, #555)", paddingTop: 10 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: muted, children: [
        "\u5237\u65B0\u65F6\u95F4\uFF1A",
        fmtTime(r.fetchedAt),
        " \xB7 \u57FA\u7EBF\uFF1A",
        fmtTime(r.installedAt),
        r.as ? ` \xB7 \u5143\u6570\u636E\u6620\u5C04\uFF1A${r.as}` : ""
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: muted, children: "\u542F\u7528\u52A8\u6001\u955C\u50CF\u540E\uFF0C\u5237\u65B0\u4F1A\u5728\u5185\u5B58\u4E2D\u751F\u6210\u8BE5\u6E90\u8DEF\u7531\u7684\u65B0\u6A21\u578B\u5FEB\u7167\uFF0C\u7531 DSH \u6A21\u578B\u9009\u62E9\u5668\u4E2D\u7684 refresh-* \u72EC\u7ACB provider \u63D0\u4F9B\uFF1B\u5DF2\u5B89\u88C5\u7684 pi-ai \u4EE3\u7801\u4E0E\u539F provider \u5747\u4FDD\u6301\u4E0D\u53D8\u3002\u5FEB\u7167\u5185\u5BB9\u4E0D\u4EE3\u8868\u8FDC\u7AEF\u63A8\u7406\u5DF2\u9A8C\u8BC1\u3002" }),
      !r.enabled && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: warning, children: "\u672A\u542F\u7528\u52A8\u6001\u955C\u50CF\u3002\u542F\u7528\u540E\u9700\u5728 DSH \u6A21\u578B\u9009\u62E9\u5668\u4E2D\u9009\u62E9\u5BF9\u5E94\u7684 refresh-* provider\uFF1B\u539F provider \u4E0D\u4F1A\u88AB\u66FF\u6362\u3002" }),
      r.error && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { role: "alert", style: failure, children: [
        "\u8DEF\u7531\u9519\u8BEF\uFF1A",
        r.error
      ] }),
      r.warnings?.map((item, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: warning, children: [
        "\u8B66\u544A\uFF1A",
        item
      ] }, i)),
      modelRows.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ModelTable, { rows: modelRows, filter: modelFilter, onFilter: setModelFilter }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: muted, children: "\u5C1A\u65E0\u6A21\u578B\u8BB0\u5F55\uFF1B\u6267\u884C\u4E00\u6B21\u5237\u65B0\u540E\u8FD9\u91CC\u4F1A\u5217\u51FA\u6BCF\u4E2A\u6A21\u578B\u53CA\u5176\u72B6\u6001\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { style: { marginTop: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { style: { cursor: "pointer" }, children: "\u8BCA\u65AD\u8BE6\u60C5" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: muted, children: "\u4EE5\u4E0B\u4E3A\u955C\u50CF\u5FEB\u7167\u7684\u539F\u59CB\u5206\u7C7B\uFF0C\u7528\u4E8E\u6392\u67E5\u5F02\u5E38\u3002\u4E3B\u8868\u5DF2\u6309\u6A21\u578B\u5408\u5E76\u5C55\u793A\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IdList, { label: "\u955C\u50CF\u76EE\u5F55\u65B0\u589E", ids: r.added }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IdList, { label: "\u955C\u50CF\u76EE\u5F55\u5DF2\u66F4\u65B0", ids: r.updated }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IdList, { label: "\u5B98\u65B9\u8865\u7F3A\u5019\u9009", ids: r.officialAdded }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IdList, { label: "\u7F3A\u5931\u5019\u9009", ids: r.stale }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IdList, { label: "\u5DF2\u6392\u9664", ids: r.excluded }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IdList, { label: "\u672A\u9A8C\u8BC1\u5019\u9009", ids: r.unverified }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IdList, { label: "\u56FA\u5B9A\u4FDD\u7559", ids: r.keep }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IdList, { label: "\u56FA\u5B9A\u6392\u9664", ids: r.exclude }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...muted, marginTop: 8, overflowWrap: "anywhere" }, children: [
          "\u5B9E\u9645\u6838\u5BF9\u7AEF\u70B9\uFF1A",
          r.officialEndpoint ?? "\u5C1A\u65E0\u8BB0\u5F55"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { style: { marginTop: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", { style: { cursor: "pointer" }, children: [
          "\u5B98\u65B9\u6E05\u5355\u6838\u5BF9\u914D\u7F6E",
          dirty.current ? "\uFF08\u8349\u7A3F\u672A\u4FDD\u5B58\uFF09" : ""
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: muted, children: "\u8FD9\u91CC\u53EA\u914D\u7F6E\u5B98\u65B9\u6E05\u5355\u8BC1\u636E\u7684\u6765\u6E90\uFF1A\u7AEF\u70B9\u3001\u6E05\u5355\u6839\u5730\u5740\u3001\u9274\u6743\u65B9\u5F0F\u4E0E\u51ED\u636E\u540D\u79F0\uFF0C\u4E0D\u8F93\u5165\u771F\u5B9E\u5BC6\u94A5\u3002\u6B64\u5904\u4E0D\u58F0\u660E\u955C\u50CF\u63A8\u7406\u7684\u534F\u8BAE\uFF0C\u4E5F\u4E0D\u58F0\u660E\u6A21\u578B\u80FD\u529B\uFF1B\u7A7A\u5B57\u6BB5\u5141\u8BB8\u540E\u7AEF\u91C7\u7528\u5DF2\u9A8C\u8BC1\u9ED8\u8BA4\u503C\u3002" }),
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
              "\u6E05\u5355\u8BF7\u6C42\u6839 URL\uFF08\u4E0D\u4FEE\u6539\u63A8\u7406\u7AEF\u70B9\uFF09 ",
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...input, width: "100%" }, type: "url", value: draft.baseUrl, disabled: draft.disabled, placeholder: "\u7559\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u6E05\u5355\u6839\u5730\u5740", onChange: (e) => change("baseUrl", e.target.value) })
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
              "\u51ED\u636E\u73AF\u5883\u53D8\u91CF\u540D\u79F0 ",
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { style: { ...input, width: "100%" }, value: draft.apiKeyEnv, disabled: draft.disabled, placeholder: "PROVIDER_API_KEY\uFF08\u540D\u79F0\uFF0C\u4E0D\u662F\u5BC6\u94A5\uFF09", autoComplete: "off", onChange: (e) => change("apiKeyEnv", e.target.value) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: row, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: draft.complete, disabled: draft.disabled, onChange: (e) => change("complete", e.target.checked) }),
              "\u6211\u786E\u8BA4\u6B64\u7AEF\u70B9\u8FD4\u56DE\u5F53\u524D\u5957\u9910\u7684\u6743\u5A01\u5168\u91CF\u6E05\u5355"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: warning, children: "\u4EC5\u660E\u786E\u786E\u8BA4\u5957\u9910\u8303\u56F4\u3001\u5206\u9875\u5904\u7406\u548C\u5B8C\u6574\u6027\u540E\u542F\u7528\uFF1B\u5F00\u542F\u540E\u5141\u8BB8\u5C06\u6E05\u5355\u7F3A\u5931\u7528\u4E8E\u79FB\u9664\u5224\u5B9A\u3002" })
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
  const globalBase = (0, import_react.useRef)(null);
  const [draft, setDraft] = (0, import_react.useState)(null);
  const [expanded, setExpanded] = (0, import_react.useState)(/* @__PURE__ */ new Set());
  const [query, setQuery] = (0, import_react.useState)("");
  const [filter, setFilter] = (0, import_react.useState)("all");
  const reload = (0, import_react.useCallback)(async () => {
    const request = ++sequence.current;
    const next = await getJson(`${BASE}/status`);
    if (alive.current && request === sequence.current) {
      setStatus(next);
      setLoadError(null);
      if (!draftInitialized.current && next.settings) {
        const initial = toGlobalDraft(next.settings);
        setDraft(initial);
        globalBase.current = initial;
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
        proxyUrl: draft.proxyUrl.trim(),
        expectedRevision: draftRevision.current,
        intervalMinutes: numberValue(draft.intervalMinutes, "\u5237\u65B0\u95F4\u9694", 1, true),
        staleGraceHours: numberValue(draft.staleGraceHours, "\u7F3A\u5931\u5BBD\u9650\u671F", 1),
        staleConfirmations: numberValue(draft.staleConfirmations, "\u8FDE\u7EED\u786E\u8BA4\u6B21\u6570", 2, true)
      };
      const latest = await getJson(`${BASE}/status`);
      const latestDraft = toGlobalDraft(latest.settings);
      const changed = Object.keys(draft).filter((k) => draft[k] !== globalBase.current?.[k]);
      for (const key of changed) if (latestDraft[key] !== globalBase.current?.[key]) throw new Error(`${key} \u5DF2\u88AB\u5176\u5B83\u9875\u9762\u4FEE\u6539\uFF0C\u8BF7\u6838\u5BF9\u540E\u91CD\u8F7D\u8349\u7A3F`);
      await postJson(`${BASE}/config`, { ...Object.fromEntries(changed.map((k) => [k, body[k]])), expectedRevision: latest.settingsRevision });
      const next = await reload();
      if (alive.current) {
        const saved = toGlobalDraft(next.settings);
        setDraft(saved);
        globalBase.current = saved;
        draftRevision.current = next.settingsRevision;
      }
    }, "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u3002\u65B0\u7684\u5185\u5B58\u5FEB\u7167\u4F1A\u5728\u4E0B\u4E00\u6B21\u5237\u65B0\u540E\u751F\u6548\u3002");
  };
  const saveOfficial = async (route, config) => run(async () => {
    const latest = await getJson(`${BASE}/status`);
    const previous = latest.settings.officialRoutes ?? {};
    const value = config === null ? null : { ...withoutEditableOfficialKeys(previous[route] ?? {}), ...config };
    await postJson(`${BASE}/config`, { expectedRevision: latest.settingsRevision, officialRoutes: { ...previous, [route]: value } });
    await reload();
  }, `${route} \u5B98\u65B9\u6E05\u5355\u914D\u7F6E\u5DF2\u4FDD\u5B58\u3002`);
  const toggleRoute = async (route, enabled) => {
    await run(async () => {
      await postJson(`${BASE}/route`, { route, enabled });
      await reload();
    }, `${route} ${enabled ? "\u542F\u7528" : "\u505C\u7528"}\u52A8\u6001\u955C\u50CF\u8BF7\u6C42\u5DF2\u63A5\u53D7\uFF1B\u5FEB\u7167\u7ED3\u679C\u4EE5\u72B6\u6001\u8BB0\u5F55\u4E3A\u51C6\u3002`);
  };
  const refreshNow = async () => {
    await run(async () => {
      await postJson(`${BASE}/refresh`, {});
      await reload();
    }, "\u5237\u65B0\u8BF7\u6C42\u5DF2\u63A5\u53D7\uFF1B\u65B0\u7684\u5185\u5B58\u6A21\u578B\u5FEB\u7167\u4F1A\u5728\u5237\u65B0\u5B8C\u6210\u540E\u751F\u6210\u3002");
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
    return !search || [r.route, r.mirrorRoute ?? "", r.as ?? "", ...r.added ?? [], ...r.updated ?? [], ...(r.pending ?? []).map((item) => `${item.id} ${item.reason}`), ...r.warnings ?? [], r.error ?? ""].join(" ").toLocaleLowerCase().includes(search);
  });
  const sum = (key) => routes.reduce((n, r) => n + (r[key]?.length ?? 0), 0);
  const disabled = busy || status?.running === true || status?.initialized === false;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { maxWidth: 920 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { style: { marginTop: 0 }, children: "\u6A21\u578B\u5237\u65B0\uFF08\u9AD8\u7EA7\uFF09" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: muted, children: "\u5DF2\u5B89\u88C5\u7684 pi-ai \u4EE3\u7801\u4E0E\u539F provider \u4FDD\u6301\u4E0D\u53D8\u3002\u63D2\u4EF6\u5237\u65B0\u540E\u7531 refresh-* \u72EC\u7ACB provider \u63D0\u4F9B\u6700\u65B0\u5B8C\u6574\u6A21\u578B\u76EE\u5F55\uFF1A\u5728 DSH \u6A21\u578B\u9009\u62E9\u5668\u4E2D\u9009\u62E9\u5BF9\u5E94\u7684 refresh-* provider \u5373\u53EF\u4F7F\u7528\u3002\u672C\u9875\u7528\u4E8E\u5237\u65B0\u3001\u542F\u7528\u955C\u50CF\u4E0E\u8BCA\u65AD\u3002" }),
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
            " \u5DF2\u542F\u7528\u52A8\u6001\u955C\u50CF"
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
            "\u5DF2\u66F4\u65B0 ",
            sum("updated")
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "\u5F85\u786E\u8BA4 ",
            sum("pending")
          ] })
        ] }),
        status.piAiUpstream && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...row, marginTop: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: badge, children: [
            "pi-ai ",
            status.piAiUpstream.version ? `@${status.piAiUpstream.version}` : "\u4E0D\u53EF\u7528"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: muted, children: [
            status.piAiUpstream.providerCount,
            " \u4E2A provider \xB7 ",
            status.piAiUpstream.modelCount,
            " \u4E2A\u804A\u5929\u6A21\u578B \xB7 \u68C0\u67E5\u4E8E ",
            fmtTime(status.piAiUpstream.checkedAt)
          ] }),
          status.piAiUpstream.stale && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: warning, children: [
            "\u4E0A\u6E38\u4E0D\u53EF\u7528\uFF0C\u6B63\u5728\u4F7F\u7528\u7F13\u5B58\uFF1A",
            status.piAiUpstream.error
          ] }),
          !status.piAiUpstream.version && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: warning, children: [
            "\u672A\u627E\u5230\u6709\u6548\u4E0A\u6E38\u7F13\u5B58\uFF1A",
            status.piAiUpstream.error
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
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "enabled", children: "\u5DF2\u542F\u7528\u955C\u50CF" }),
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
      routes.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { hidden: !visible.some((item) => item.route === r.route), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RouteCard, { r, config: status.settings?.officialRoutes?.[r.route], busy: disabled, expanded: expanded.has(r.route), onToggle: () => toggleExpand(r.route), onEnable: (enabled) => void toggleRoute(r.route, enabled), onSaveOfficial: (config) => saveOfficial(r.route, config) }) }, r.route)),
      draft && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", { style: { ...box, marginTop: 18 }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { style: { cursor: "pointer", fontWeight: 600 }, children: "\u5168\u5C40\u8BBE\u7F6E \xB7 \u68C0\u67E5\u95F4\u9694\u3001\u4EE3\u7406\u4E0E\u79FB\u9664\u7B56\u7565" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: muted, children: "\u6A21\u578B\u6E05\u5355\u540C\u6B65\u81EA pi-ai \u4E0A\u6E38\uFF1B\u5B98\u65B9\u6E05\u5355\u7528\u4E8E\u6838\u5BF9\u5957\u9910\u53EF\u7528\u6027\u3002\u5237\u65B0\u4F1A\u751F\u6210\u65B0\u7684\u5185\u5B58\u6A21\u578B\u5FEB\u7167\uFF0C\u65B0\u8BF7\u6C42\u4F7F\u7528\u65B0\u5FEB\u7167\uFF1B\u5FEB\u7167\u4E0D\u4EE3\u8868\u8FDC\u7AEF\u63A8\u7406\u5DF2\u6D4B\u901A\u3002\u79FB\u9664\u7B56\u7565\u53EA\u5F71\u54CD\u955C\u50CF\u76EE\u5F55\uFF0C\u4E0D\u6539\u52A8\u539F provider\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { disabled, style: { border: 0, padding: 0, margin: "10px 0 0", display: "grid", gap: 10 }, children: [
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
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: draft.modelsDevFallback, onChange: (e) => updateDraft("modelsDevFallback", e.target.checked) }),
            "pi-ai \u4E0A\u6E38\u4E0D\u53EF\u7528\u65F6\u6539\u7528 models.dev \u5907\u9009"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: row, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: draft.officialVerify, onChange: (e) => updateDraft("officialVerify", e.target.checked) }),
            "\u542F\u7528\u5B98\u65B9\u6E05\u5355\u6838\u5BF9\u4E0E\u8865\u7F3A"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { style: { cursor: "pointer", ...muted }, children: "\u79FB\u9664\u7B56\u7565\uFF08\u9ED8\u8BA4\u5173\u95ED\uFF1B\u53EA\u6709\u6743\u5A01\u5168\u91CF\u6E05\u5355\u8FDE\u7EED\u786E\u8BA4\u7F3A\u5931\u624D\u4F1A\u79FB\u9664\uFF09" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "grid", gap: 8, marginTop: 8 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: row, children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: draft.removeStale, onChange: (e) => updateDraft("removeStale", e.target.checked) }),
                "\u5141\u8BB8\u4ECE\u955C\u50CF\u76EE\u5F55\u79FB\u9664\u8FDE\u7EED\u786E\u8BA4\u7F3A\u5931\u7684\u6A21\u578B"
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
              ] })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: row, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, onClick: () => void saveGlobal(), children: "\u4FDD\u5B58\u5168\u5C40\u8BBE\u7F6E" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { style: button, onClick: () => {
              const reset = toGlobalDraft(status.settings);
              setDraft(reset);
              globalBase.current = reset;
              draftRevision.current = status.settingsRevision;
            }, children: "\u653E\u5F03\u5168\u5C40\u8349\u7A3F" })
          ] })
        ] })
      ] }) })
    ] })
  ] });
}
var name = "dsh-model-refresh-client";
var inject = ["slots", "locale"];
function apply(ctx) {
  ctx.slots.inject("settings.section", () => {
    if (ctx.slots.entries("settings.section").some((entry) => entry.id === "model-refresh")) return () => void 0;
    return ctx.slots.register({ name: "settings.section", id: "model-refresh", order: 17, label: () => "\u6A21\u578B\u5237\u65B0\uFF08\u9AD8\u7EA7\uFF09", inject: () => ({}) }, ModelRefreshSettings);
  });
}
