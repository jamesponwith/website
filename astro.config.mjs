import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { unified } from "@astrojs/markdown-remark";
import {
  rehypeCode,
  remarkCodeTab,
  remarkHeading,
  remarkNpm,
} from "fumadocs-core/mdx-plugins";
import { buildSearchIndex } from "./scripts/build-search.mjs";
import { isConnectPath, isDocsPath, isEmbedPath, isVgpuConceptPath } from "./host/routes.ts";
import { publishLlmsTxt } from "./scripts/publish-llms.ts";
import { splitDocsSitemap } from "./scripts/split-sitemaps.ts";
import { pageLastmods } from "./scripts/sitemap-lastmod.ts";
import { wgslVitePlugin } from "@vgpu/wgsl/loader-vite";

const siteRoot = fileURLToPath(new URL(".", import.meta.url));
const lastmods = pageLastmods(siteRoot);

// The docs pages render with the Fumadocs markdown pipeline: anchored headings
// (for the TOC), npm-install tabs, and Shiki-highlighted code.
// sync-docs runs first; old comparison URLs land on /compare once the phux
// checkout publishes it, and on the nearest live page until then.
const compare = existsSync(fileURLToPath(new URL("./src/content/docs/_synced/compare.md", import.meta.url)))
  ? "/compare"
  : null;

const remarkPlugins = [remarkHeading, remarkCodeTab, remarkNpm];
const rehypePlugins = [rehypeCode];

// Tables keep their semantics, while the wrapper provides keyboard scrolling
// and an announced region on narrow screens.
function rehypeAccessibleTables() {
  return (tree) => {
    function visit(node) {
      if (!node.children) return;
      node.children = node.children.map((child) => {
        if (child.type === "element" && child.tagName === "table") {
          return {
            type: "element",
            tagName: "div",
            properties: {
              className: ["table-region"],
              role: "region",
              tabIndex: 0,
              ariaLabel: "Scrollable data table",
            },
            children: [child],
          };
        }
        visit(child);
        return child;
      });
    }
    visit(tree);
  };
}

rehypePlugins.push(rehypeAccessibleTables);

// Emits the static search index into dist/api/search.json after every build so
// the site deploys fully static (see scripts/build-search.mjs).
const searchIndex = () => ({
  name: "phux-static-search",
  hooks: {
    "astro:build:done": async ({ dir }) => {
      await buildSearchIndex(fileURLToPath(dir));
    },
  },
});

export default defineConfig({
  devToolbar: { enabled: false },
  site: "https://phux.sh",
  // Match the wire/phall.io house style: bare, no-trailing-slash canonical paths.
  trailingSlash: "never",
  build: { format: "file" },
  // The phux docs were flattened in 2026-10; keep the old public URLs
  // landing somewhere sensible.
  // The phux docs were flattened in 2026-10; keep the old public URLs
  // landing somewhere sensible. ADR deep links are not redirected; the
  // archive is the pre-reset tree on GitHub.
  redirects: {
    "/quickstart": "/getting-started",
    "/quickstart/install": "/installation",
    "/quickstart/config": "/config",
    "/concepts/when-to-use": compare ?? "/concepts",
    "/concepts/coming-from": "/getting-started",
    "/concepts/vision": "/architecture",
    "/remote-access": "/remote",
    "/consumers": "/clients",
    "/wire": "/protocol",
    "/consumers/agents/cli": "/scripting",
    "/consumers/agents/targeting": "/scripting",
    "/consumers/agents/json": "/scripting",
    "/consumers/agents/integrations": "/scripting",
    "/consumers/agents": "/scripting",
    "/consumers/attention": "/agents",
    "/consumers/harness": "/agents",
    "/consumers/mission": "/agents",
    "/consumers/mcp": "/agents",
    "/consumers/claude": "/agents",
    "/consumers/grok": "/agents",
    "/consumers/omp": "/agents",
    "/consumers/opencode-v2": "/agents",
    "/consumers/pi": "/agents",
    "/consumers/pi-in-60-seconds": "/agents",
    "/consumers/getting-started": "/agents",
    "/consumers/android": "/clients",
    "/consumers/ios": "/clients",
    "/consumers/cockpit": "/clients",
    "/consumers/desktop": "/clients",
    "/consumers/web": "/clients",
    "/consumers/tui": "/getting-started",
    "/consumers/tui/commands": "/getting-started",
    "/consumers/tui/configuration": "/getting-started",
    "/consumers/tui/interface": "/getting-started",
    "/consumers/tui/automation": "/getting-started",
    "/consumers/tui/reference": "/getting-started",
    "/consumers/recording": "/getting-started",
    "/consumers/build-a-client": "/protocol",
    "/consumers/sdk": "/protocol",
    "/wire/changelog": "/protocol",
    "/wire/l1": "/protocol",
    "/wire/l2": "/protocol",
    "/wire/l3": "/protocol",
    "/wire/tutorial": "/protocol",
    "/wire/appendix-encoding": "/protocol",
    "/wire/appendix-reserved": "/protocol",
    "/wire/coordinator": "/protocol",
    "/wire/input": "/protocol",
    "/wire/proto": "/protocol",
    "/wire/workload-auth": "/protocol",
    "/architecture/diagram": "/architecture",
    "/architecture/client-runtime": "/architecture",
    "/architecture/crate-graph": "/architecture",
    "/architecture/data-model": "/architecture",
    "/architecture/declared-producers": "/architecture",
    "/architecture/defguard-federation": "/architecture",
    "/architecture/desktop-verification": "/architecture",
    "/architecture/desktop": "/architecture",
    "/architecture/module-structure": "/architecture",
    "/architecture/phux-and-herdr": "/architecture",
    "/architecture/predictive-echo": "/architecture",
    "/architecture/process-model": "/architecture",
    "/architecture/render-layering": "/architecture",
    "/architecture/state-sync": "/architecture",
    "/architecture/threading": "/architecture",
    "/architecture/transport": "/architecture",
    "/architecture/usage-collector": "/architecture",
    "/architecture/verification": "/architecture",
    "/architecture/operations": "/troubleshooting",
  },
  // The hero is a React island (<HeroDemo client:load />); it loads
  // the terminal on demand. Docs chrome is <Docs client:load />. Host
  // split (phux.sh vs docs.phux.sh) is the site worker in host/index.ts.
  integrations: [
    react(),
    mdx({ extendMarkdownConfig: true, syntaxHighlight: false }),
    sitemap({
      filter: (page) => !isEmbedPath(new URL(page).pathname) && !isVgpuConceptPath(new URL(page).pathname) && !isConnectPath(new URL(page).pathname),
      serialize(item) {
        const url = new URL(item.url);
        const docs = isDocsPath(url.pathname);
        if (docs) {
          url.hostname = "docs.phux.sh";
          item.url = url.href;
        }
        const lastmod = lastmods.get(url.pathname);
        if (lastmod) item.lastmod = lastmod;
        else delete item.lastmod;
        return item;
      },
    }),
    {
      name: "phux-host-sitemaps",
      hooks: {
        "astro:build:done": async ({ dir }) => {
          const out = fileURLToPath(dir);
          await splitDocsSitemap(out);
          await publishLlmsTxt(out);
        },
      },
    },
    searchIndex(),
  ],
  markdown: {
    processor: unified({
      syntaxHighlight: false,
      remarkPlugins,
      rehypePlugins,
    }),
  },
  vite: {
    plugins: [tailwindcss(), wgslVitePlugin()],
    server: {
      proxy: { "/__scene": { target: "http://127.0.0.1:4399", rewrite: (path) => path.replace(/^\/__scene/, "") } },
    },
    // The phux-web client ships a .wasm asset (the wire client + embedded
    // libghostty-vt engine); keep it un-inlined so it streams.
    assetsInclude: ["**/*.wasm"],
  },
});
