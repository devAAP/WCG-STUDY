// Outbound study links. Patterns match those already used by the WCG Study
// app (index.html → buildBibleUrl). The app only links out; it never embeds
// or scrapes jw.org content.
const WOL = 'https://wol.jw.org/en/wol';

// Study Edition chapter page (verse text + study notes + media where available).
export const studyChapterUrl = (bookNum, chapter) => `${WOL}/b/r1/lp-e/nwtsty/${bookNum}/${chapter}`;

// Jump to a verse: "John 3:16" or "John 3:16-18".
export function verseUrl(bookNum, ref) {
  const m = /(\d+):(\d+)/.exec(ref);
  return m ? `${studyChapterUrl(bookNum, m[1])}#v=${bookNum}:${m[1]}:${m[2]}` : null;
}

// "Examining the Scriptures Daily" for a given local date (YYYY-MM-DD).
export function dailyTextUrl(day) {
  const [y, m, d] = day.split('-').map(Number);
  return `${WOL}/h/r1/lp-e/${y}/${m}/${d}`;
}

// jw.org videos: the per-book "Introduction to <Book>" video series, reached
// through jw.org search so the link survives jw.org catalogue changes.
export const bookVideoUrl = bookName =>
  `https://www.jw.org/en/search/?q=${encodeURIComponent(`Introduction to ${bookName}`)}`;
export const topicVideoUrl = topic =>
  `https://www.jw.org/en/search/?q=${encodeURIComponent(topic)}`;
