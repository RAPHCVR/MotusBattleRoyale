import { describe, expect, it, vi } from "vitest";

import { createCorsMiddleware } from "./http.js";

function createResponse() {
  const headers = new Map<string, string>();

  return {
    headers,
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name, value);
      return undefined;
    }),
    sendStatus: vi.fn(() => undefined),
  };
}

describe("createCorsMiddleware", () => {
  it("allows configured origins and short-circuits preflight requests", () => {
    const middleware = createCorsMiddleware(["https://motus.raphcvr.me"]);
    const response = createResponse();
    const next = vi.fn();

    middleware(
      {
        header: (name: string) =>
          name === "origin"
            ? "https://motus.raphcvr.me"
            : name === "access-control-request-headers"
              ? "content-type"
              : undefined,
        method: "OPTIONS",
      } as never,
      response as never,
      next,
    );

    expect(response.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Origin",
      "https://motus.raphcvr.me",
    );
    expect(response.setHeader).toHaveBeenCalledWith("Vary", "Origin");
    expect(response.sendStatus).toHaveBeenCalledWith(204);
    expect(next).not.toHaveBeenCalled();
  });

  it("lets non-preflight requests continue even when the origin is not allowed", () => {
    const middleware = createCorsMiddleware(["https://motus.raphcvr.me"]);
    const response = createResponse();
    const next = vi.fn();

    middleware(
      {
        header: (name: string) =>
          name === "origin" ? "https://example.com" : undefined,
        method: "GET",
      } as never,
      response as never,
      next,
    );

    expect(response.setHeader).not.toHaveBeenCalledWith(
      "Access-Control-Allow-Origin",
      expect.any(String),
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Methods",
      "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
