import type { APIRoute } from "astro";

const rutas = ["/"];

export const GET: APIRoute = ({ site }) => {
  const modificado = new Date().toISOString();
  const urls = rutas
    .map((ruta) => `  <url><loc>${new URL(ruta, site)}</loc><lastmod>${modificado}</lastmod></url>`)
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
