/**
 * ESLint 插件封装（flat config）。
 *
 * eslint.config.js:
 *   import geometry from "./scripts/validate/lint-geometry/eslint-plugin.mjs";
 *   export default [{ plugins: { geometry }, rules: { "geometry/no-geometry-literals": "error" } }];
 */
import { rules } from "../../lint-geometry.mjs";

export const meta = { name: "geometry", version: "1.0.0" };
export { rules };

export default { meta, rules };
