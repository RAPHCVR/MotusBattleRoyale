import type { NextFunction, Request, RequestHandler, Response } from "express";

export function createCorsMiddleware(
  allowedOrigins: readonly string[],
): RequestHandler {
  const originSet = new Set(
    allowedOrigins.map((origin) => origin.trim()).filter(Boolean),
  );

  return (request: Request, response: Response, next: NextFunction) => {
    const requestOrigin = request.header("origin")?.trim() ?? "";
    if (requestOrigin && (originSet.has(requestOrigin) || originSet.has("*"))) {
      response.setHeader("Access-Control-Allow-Origin", requestOrigin);
      response.setHeader("Vary", "Origin");
    }

    response.setHeader(
      "Access-Control-Allow-Methods",
      "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    );
    const requestedHeaders = request
      .header("access-control-request-headers")
      ?.trim();
    response.setHeader(
      "Access-Control-Allow-Headers",
      requestedHeaders || "Content-Type, Authorization, X-Service-Key",
    );
    response.setHeader("Access-Control-Max-Age", "86400");

    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }

    next();
  };
}
