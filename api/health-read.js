export default async function handler(_req, res) {
  return res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    runtime: "standalone-vercel",
    uptime: process.uptime(),
  });
}
