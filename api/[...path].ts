import { getVercelApp } from "../server/app.ts";

// Let Express/multer read the raw request stream for multipart uploads on Vercel.
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: any, res: any) {
  const app = await getVercelApp();
  return app(req, res);
}
