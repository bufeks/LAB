// Atom feeds of items priced below their usual level. Entries link to
// SHELF's own pages, not to shops: affiliate programs forbid their links in
// mail-like channels, and a feed reader is one.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

// Stable per price level: a new entry appears when the price changes, not
// every day the item stays cheap.
const entryId = (base, item) => `${base}#${encodeURIComponent(item.id)}@${item.price}`;

export function atomFeed({ id, title, subtitle, selfUrl, pageUrl, updated, lang, entries }) {
  const body = entries
    .map(
      (e) => `  <entry>
    <id>${esc(e.id)}</id>
    <title>${esc(e.title)}</title>
    <link rel="alternate" href="${esc(e.link)}"/>
    <updated>${esc(e.updated)}</updated>
    <summary>${esc(e.summary)}</summary>
  </entry>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${esc(lang)}">
  <id>${esc(id)}</id>
  <title>${esc(title)}</title>
  ${subtitle ? `<subtitle>${esc(subtitle)}</subtitle>\n  ` : ''}<link rel="self" href="${esc(selfUrl)}"/>
  <link rel="alternate" href="${esc(pageUrl)}"/>
  <updated>${esc(updated)}</updated>
  <author><name>SHELF</name></author>
${body}
</feed>
`;
}

// Entries for items that are cheaper than usual; `describe` turns an item
// into the localized summary line.
export function dealEntries(items, { base, pageOf, updated, describe }) {
  return items.map((x) => ({
    id: entryId(base, x),
    title: x.title,
    link: pageOf(x),
    updated,
    summary: describe(x),
  }));
}
