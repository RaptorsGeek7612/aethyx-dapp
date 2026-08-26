import js from "@eslint/js";
import tseslint from "typescript-eslint";
import chaiFriendly from "eslint-plugin-chai-friendly";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["node_modules/**", "artifacts/**", "cache/**", "types/**", "ignition/deployments/**", "dist/**"],
  },
  {
    plugins: { "chai-friendly": chaiFriendly },
    rules: {
      // Fixture destructuring in the test suite deliberately pulls out values a given test
      // doesn't use (see e.g. test/InvestOrGateway.ts), for consistency with the fixture's
      // shared return shape.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // Chai assertions like `expect(x).to.be.true` are property-access chains, not function
      // calls — both the base rule and its typescript-eslint variant flag every one of them as
      // dead code.
      "no-unused-expressions": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "chai-friendly/no-unused-expressions": "error",
    },
  },
);
