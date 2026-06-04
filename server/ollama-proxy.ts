import type { RequestHandler } from "express";
import { Readable } from "node:stream";

/** Forward /api/* to Ollama, preserving the full path (e.g. /api/ps). */
export function ollamaProxy(ollamaHost: string): RequestHandler {
  const base = ollamaHost.replace(/\/$/, "");

  return async (req, res, next) => {
    const urlPath = req.originalUrl ?? req.url;
    if (!urlPath.startsWith("/api") || urlPath.startsWith("/api/dashboard")) {
      next();
      return;
    }

    try {
      const target = new URL(urlPath, `${base}/`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (!value || key.toLowerCase() === "host") continue;
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v);
        } else {
          headers.set(key, value);
        }
      }

      const init: RequestInit & { duplex?: "half" } = {
        method: req.method,
        headers,
      };

      if (req.method !== "GET" && req.method !== "HEAD") {
        init.body = Readable.toWeb(req) as ReadableStream;
        init.duplex = "half";
      }

      const upstream = await fetch(target, init);
      res.status(upstream.status);

      upstream.headers.forEach((value, key) => {
        if (key.toLowerCase() === "transfer-encoding") return;
        res.setHeader(key, value);
      });

      if (upstream.body) {
        Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(
          res,
        );
      } else {
        res.end();
      }
    } catch (err) {
      next(err);
    }
  };
}
