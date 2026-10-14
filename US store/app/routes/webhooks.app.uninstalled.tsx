import type { ActionFunctionArgs } from "react-router";
import { authenticate, sessionStorage } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session } = await authenticate.webhook(request);

  if (session) {
    await sessionStorage.deleteSession(session.id);
  }

  await prisma.session.deleteMany({ where: { shop } });

  return new Response();
};
