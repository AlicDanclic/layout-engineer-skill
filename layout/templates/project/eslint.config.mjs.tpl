// layout-engineer 提供的 ESLint 配置：几何裸字面量规则。
// 规则本身驻留在 Skill 里（layout/scripts/validate/lint-geometry），项目只引用插件。
import geometry from "{{SKILL_REL}}/layout/layout/scripts/validate/lint-geometry/eslint-plugin.mjs";

export default [
  {
    files: ["src/layout/**/*.{ts,tsx,js,jsx}", "src/serializers/**/*.{ts,tsx,js,jsx}"],
    plugins: { geometry },
    rules: {
      "geometry/no-geometry-literals": "error",
    },
  },
  {
    // 变量定义处本来就允许写字面量：整个目录白名单豁免
    files: ["variables/**/*.{ts,tsx,js,jsx}"],
    rules: { "geometry/no-geometry-literals": "off" },
  },
];
