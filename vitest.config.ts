/** Vitest config: unit tests live next to the backend code in backend/test. */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["backend/test/**/*.test.ts"],
    environment: "node",
  },
});
