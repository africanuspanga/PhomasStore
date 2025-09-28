import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal"; // REMOVE THIS LINE

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(), // REMOVE THIS LINE
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []), // REMOVE THIS ENTIRE BLOCK
  ],