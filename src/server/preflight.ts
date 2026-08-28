import { loadConfig } from "./config";

try {
  loadConfig();
} catch (error) {
  const message = error instanceof Error ? error.message : "Invalid server configuration.";
  console.error(`Shale server did not start: ${message}`);
  process.exit(1);
}
