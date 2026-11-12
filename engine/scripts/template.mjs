// The starter deck written by `pnpm new <slug>`. Kept in its own module so a
// test can compile it and assert it produces no warnings.

/** `my-talk` → `My talk` */
export function titleFromSlug(slug) {
  const words = slug.split('-').filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function starterDeck(slug) {
  const title = titleFromSlug(slug);
  return `---
title: ${JSON.stringify(title)}
---

<!-- Starter deck. README.md explains the format: slides, layouts, builds, notes, and media. Comments like this one are speaker notes. -->

# ${title}

One line about what this talk is for.

---

## Three things to say

+ The first point appears on the first click
+ The second point waits for the next one
+ Lines starting with + build one at a time

---

## A slide with a picture

Add an image above or below this text and the slide splits in two. An image above the text goes on the left; below, on the right.

<!-- The image goes here. Save it as media/photo.jpg next to deck.md, then add this line outside the comment: \`![What the picture shows](media/photo.jpg)\` -->

---

> A quotation that sums up the idea.
>
> — Someone worth quoting

---

# Thank you

Where people can find you.
`;
}
