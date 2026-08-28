import { describe, expect, it } from "bun:test";
import { loadConfig } from "../../src/server/config";

describe("server configuration", () => {
  it("accepts any non-empty shared password", () => {
    expect(loadConfig({ SHALE_PASSWORD: "x", SHALE_DATA_DIR: "." }).password).toBe("x");
  });

  it("uses public editing when no password is configured", () => {
    expect(loadConfig({ SHALE_DATA_DIR: "." }).password).toBeUndefined();
    expect(loadConfig({ SHALE_PASSWORD: "", SHALE_DATA_DIR: "." }).password).toBeUndefined();
  });

  it("rejects two password sources", () => {
    expect(() =>
      loadConfig({
        SHALE_PASSWORD: "configured",
        SHALE_PASSWORD_FILE: "password.txt",
        SHALE_DATA_DIR: ".",
      }),
    ).toThrow("Set no more than one");
  });
});
