// 对真实产物复刻 loader 的 !!js 求值环境，验证 cordis.patch.yml 中表达式可求值
const expr =
  'JSON.parse(process.getBuiltinModule("node:fs").readFileSync(process.env.USERPROFILE.replaceAll(String.fromCharCode(92), "/") + "/.dsh/model-refresh/opencode-go.models.json", "utf8")).models';
const fn = new Function("ctx", "with(ctx){return (" + expr + ")}");
const models = fn({});
console.log("models:", models.length);
console.log("ids:", models.map((m) => m.id).join(", "));
if (!Array.isArray(models) || models.length === 0) {
  console.error("VERIFY FAILED");
  process.exit(1);
}
for (const m of models) {
  if (!m.id || !m.name || !m.contextWindow || !m.maxTokens) {
    console.error("VERIFY FAILED: incomplete entry", JSON.stringify(m));
    process.exit(1);
  }
}
console.log("VERIFY PASSED");
