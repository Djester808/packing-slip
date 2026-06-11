import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { fetchSlip } from "../slip.server";
import prisma from "../db.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const settings = await prisma.appSettings.upsert({
    where: { id: "singleton" }, update: {}, create: { id: "singleton" },
  });
  const slip = await fetchSlip(params.id!, settings);
  return json(slip);
};
