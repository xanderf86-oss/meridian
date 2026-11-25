import { decodeEntities } from "./clean.mjs";

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decodeEntities(match[1]).trim() : "";
}

export function parseRss(xml) {
  const items = [];
  for (const match of String(xml || "").matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    items.push({
      title: tag(block, "title"),
      link: tag(block, "link"),
      description: tag(block, "description") || tag(block, "content:encoded"),
      pubDate: tag(block, "pubDate") || tag(block, "dc:date"),
      category: tag(block, "category"),
    });
  }
  return items;
}
