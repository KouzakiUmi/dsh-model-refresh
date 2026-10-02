// 验证 !!js 表达式语义：复刻 loader 的 evaluate（new Function + with + eval），
// 确认无 require 环境下 process.getBuiltinModule 可同步读取文件。
import { writeFileSync, mkdirSync } from "node:fs";

const evaluate = new Function("ctx", "expr", "with (ctx) { return eval(expr) }");

// 1) require 在此环境确实不可用
let requireAvailable = false;
try { requireAvailable = typeof (0, eval)("require") !== "undefined"; } catch { requireAvailable = false; }
console.log("typeof require =", requireAvailable ? "defined" : "undefined (expected)");

// 2) getBuiltinModule 同步读取并 JSON.parse
const expr = `JSON.parse(process.getBuiltinModule("node:fs").readFileSync(
  process.env.USERPROFILE.replace(/\\\\/g, "/") + "/.dsh/local-plugins/dsh-model-refresh/config.example.json",
  "utf8"
))`;
const result = evaluate({}, expr);
console.log("expression result: routes =", result.routes.length, "route =", result.routes[0].route);
if (requireAvailable || result.routes[0].route !== "opencode-go") {
  console.error("EXPRESSION TEST FAILED");
  process.exit(1);
}

// 3) YAML 内联形态（单行，供 cordis.patch.yml 使用）
const oneLine = 'JSON.parse(process.getBuiltinModule("node:fs").readFileSync(process.env.USERPROFILE.replaceAll(String.fromCharCode(92), "/") + "/.dsh/model-refresh/opencode-go.models.json", "utf8")).models';
const fake = { models: [{ id: "x" }] };
mkdirSync(process.env.USERPROFILE + "/.dsh/model-refresh", { recursive: true });
writeFileSync(process.env.USERPROFILE + "/.dsh/model-refresh/smoke-fixture.json", JSON.stringify(fake), "utf8");
const oneLineExpr = oneLine.replace("opencode-go.models.json", "smoke-fixture.json");
const models = evaluate({}, oneLineExpr);
console.log("one-line expression ->", JSON.stringify(models));
if (models.models?.[0]?.id !== "x" && models[0]?.id !== "x") {
  console.error("ONE-LINE FAILED"); process.exit(1);
}
console.log("EXPRESSION TESTS PASSED");
