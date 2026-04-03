import { createServerApp } from "./app.js";
import { log } from "./logger.js";

(async () => {
  const { server } = await createServerApp();

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    
    // Keep-alive self-ping every 3 minutes to prevent sleeping
    // This is completely isolated and only calls the read-only health endpoint
    const KEEP_ALIVE_INTERVAL = 3 * 60 * 1000; // 3 minutes in milliseconds
    
    setInterval(async () => {
      try {
        const response = await fetch(`http://localhost:${port}/api/health`);
        if (response.ok) {
          const data = await response.json();
          log(`💓 Keep-alive ping successful - uptime: ${Math.floor(data.uptime)}s`);
        }
      } catch (error) {
        // Silent fail - don't disrupt the app if ping fails
        log(`⚠️ Keep-alive ping failed (non-critical)`);
      }
    }, KEEP_ALIVE_INTERVAL);
    
    log(`💓 Keep-alive enabled: pinging every 3 minutes`);
  });
})();
