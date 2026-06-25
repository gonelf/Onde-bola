/*
 * /image — preview + download tool for the day's top-games image. Standalone
 * document; ports lib/digest-page renderImage (noindex). The control script is
 * rendered as a real <script> element so it executes client-side.
 */

import { headers } from "next/headers";
import { buildImage, todayYmd, clampNImage, pickFormat, pickHighlight } from "@/lib/digest-render";
import { langForCountryCode } from "@/lib/i18n";
import { brandForHost, langForBrand } from "@/lib/brand";

export const dynamic = "force-dynamic";

function resolve(sp) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date || "") ? sp.date : todayYmd();
  return { date, n: clampNImage(sp.n), format: pickFormat(sp.format), highlight: pickHighlight(sp.highlight) };
}

// Host + brand-aware language: the English-only domains pin English; the default
// brand follows the visitor's country.
async function getContext() {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "hojehabola.com";
  const code = h.get("x-vercel-ip-country") || h.get("x-country") || h.get("cf-ipcountry") || "";
  return { host, lang: langForBrand(brandForHost(host), langForCountryCode(code)) };
}

export async function generateMetadata({ searchParams }) {
  const sp = (await searchParams) || {};
  const built = buildImage({ ...resolve(sp), ...(await getContext()) });
  return {
    title: built.title,
    description: built.description,
    robots: built.robots,
    icons: {
      icon: "/icon.svg",
    },
  };
}

export default async function ImagePage({ searchParams }) {
  const sp = (await searchParams) || {};
  const built = buildImage({ ...resolve(sp), ...(await getContext()) });
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: built.css }} />
      <div dangerouslySetInnerHTML={{ __html: built.bodyHtml }} />
      <script dangerouslySetInnerHTML={{ __html: built.scriptJs }} />
    </>
  );
}
