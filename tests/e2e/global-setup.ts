import { execFileSync } from "node:child_process";
import { E2E_DATABASE_URL } from "../../playwright.config";

export default function globalSetup() {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: "pipe",
  });
}
