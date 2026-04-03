import { getVercelApp } from "../../../server/app.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: any, res: any) {
  const app = await getVercelApp();
  return app(req, res);
}
