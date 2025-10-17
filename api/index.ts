import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "../server/routes";
import path from "path";

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (reqPath.startsWith("/api")) {
      let logLine = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      console.log(logLine);
    }
  });

  next();
});

let routesRegistered = false;
let server: any = null;

async function setupRoutes() {
  if (!routesRegistered) {
    server = await registerRoutes(app);
    
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      res.status(status).json({ message });
    });

    const staticPath = path.join(process.cwd(), "dist/public");
    app.use(express.static(staticPath));
    
    app.get("*", (_req, res) => {
      res.sendFile(path.join(staticPath, "index.html"));
    });
    
    routesRegistered = true;
  }
}

export default async function handler(req: any, res: any) {
  await setupRoutes();
  return app(req, res);
}
