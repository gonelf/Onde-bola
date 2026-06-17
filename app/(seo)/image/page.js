/*
 * /image — preview + download tool for the day's top-games image. Standalone
 * document; ports lib/digest-page renderImage (noindex). The control script is
 * rendered as a real <script> element so it executes client-side.
 */

import { buildImage, todayYmd, clampN } from "@/lib/digest-render";

export const dynamic = "force-dynamic";

function resolve(sp) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date || "") ? sp.date : todayYmd();
  return { date, n: clampN(sp.n) };
}

export async function generateMetadata({ searchParams }) {
  const sp = (await searchParams) || {};
  const built = buildImage(resolve(sp));
  return {
    title: built.title,
    description: built.description,
    robots: built.robots,
    icons: {
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>",
    },
  };
}

export default async function ImagePage({ searchParams }) {
  const sp = (await searchParams) || {};
  const built = buildImage(resolve(sp));
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: built.css }} />
      <div dangerouslySetInnerHTML={{ __html: built.bodyHtml }} />
      <script dangerouslySetInnerHTML={{ __html: built.scriptJs }} />
    </>
  );
}
