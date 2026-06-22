import { json } from "@remix-run/node";
import prisma from "../db.server";

export const loader = async () => {
  const transitDeleted = await prisma.transitCache.deleteMany({});
  const weatherDeleted = await prisma.weatherCache.deleteMany({});

  return json({
    message: "Cache cleared",
    transitCache: transitDeleted.count,
    weatherCache: weatherDeleted.count,
  });
};
