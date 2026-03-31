import { getVercelApp } from "../server/app";

export default async function handler(req: any, res: any) {
  const app = await getVercelApp();
  return app(req, res);
}
