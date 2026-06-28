/**
 * Eleventy configuration for the Symbio AI site.
 *
 * - Input:  src/   Output: dist/
 * - Only .njk files are treated as templates (the 7 marketing pages).
 * - Everything else (CSS, JS, images, the standalone chatbot demo) is copied
 *   through verbatim so it ships exactly as authored.
 * - Links between pages are kept relative so the built site works from any
 *   subpath (Cloudflare tunnel, GitHub Pages project path, Raspberry Pi, ...).
 */
export default function (eleventyConfig) {
  // Copy assets straight through to dist/assets/*
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });

  // The chatbot demo is a self-contained, shareable file — ship it untouched.
  eleventyConfig.addPassthroughCopy({ "src/chatbot-demo.html": "chatbot-demo.html" });

  // Preserve the custom domain when GitHub Pages deploys the built dist folder.
  eleventyConfig.addPassthroughCopy({ "src/CNAME": "CNAME" });

  // Rebuild when CSS/JS change even though they are passthrough-copied.
  eleventyConfig.setServerPassthroughCopyBehavior("passthrough");
  eleventyConfig.addWatchTarget("src/assets/");

  // Current year, available to every template (footer copyright, etc.).
  eleventyConfig.addGlobalData("buildYear", () => String(new Date().getFullYear()));

  // ISO-8601 timestamp for sitemap <lastmod> (Google reads lastmod, ignores
  // priority/changefreq). Accepts a Date or anything `new Date()` can parse.
  eleventyConfig.addFilter("isoDate", (d) =>
    (d instanceof Date ? d : new Date(d || Date.now())).toISOString()
  );

  return {
    dir: {
      input: "src",
      output: "dist",
      includes: "_includes",
      data: "_data",
    },
    // Treat .njk as templates; raw .html is passthrough only (see above).
    templateFormats: ["njk"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
    // Relative URLs in templates use the pathPrefix; default "/" keeps links
    // relative-friendly. Override with --pathprefix at build time if needed.
    pathPrefix: "/",
  };
}
