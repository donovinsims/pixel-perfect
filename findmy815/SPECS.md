# FindMy815

A static directory of cafes: 67 pages, no framework, no build step, no backend.

## Run it

```bash
cd findmy815
python3 -m http.server 8123
```

Open <http://localhost:8123>. `index.html` in every folder makes the
extensionless routes resolve without rewriting anything.

## Rebuild the pages

All pages are generated from the data at the top of `tools/build-pages.mjs`
(cafes, categories, neighbourhoods, styles, blog posts, legal copy):

```bash
node tools/build-pages.mjs
```

It rewrites every route and `routes.json`, and deletes the generated folders
first so a renamed or removed route cannot leave a stale page behind.

## Layout

```
findmy815/
  index.html                     home
  about/                         about + FAQ
  cafes/                         every cafe, with Load More
  cafes/<slug>/                  24 cafe detail pages
  category/                      category index
  category/<slug>/               9 filtered listings
  location/  location/<slug>/    9 neighbourhoods
  theme/     theme/<slug>/       9 styles
  blog/      blog/<slug>/        index + 4 posts
  submit/  contact/              forms (local only)
  legal/<slug>/                  terms, privacy, disclaimer
  styles/{tokens,base,components,pages}.css
  js/site.js                     theme, menu, filters, load more, FAQ, forms
  assets/icon.png                app icon (256px PNG, shown uncropped)
  assets/fonts/                  Geist 400/500/600/700
```

Everything the site needs sits in this folder: the pages at the top level, with
`styles/`, `js/` and `assets/` beside them. No asset is fetched from another host
except the Google Maps search links, which open in a new tab.

## Routes (67)

| Route | Pages |
| --- | --- |
| `/` | 1 |
| `/about/` | 1 |
| `/cafes/` + `/cafes/<slug>/` | 25 |
| `/category/` + `/category/<slug>/` | 10 |
| `/location/` + `/location/<slug>/` | 10 |
| `/theme/` + `/theme/<slug>/` | 10 |
| `/blog/` + `/blog/<slug>/` | 5 |
| `/submit/`, `/contact/` | 2 |
| `/legal/<slug>/` | 3 |

## Data

- 24 cafes, each with a category list, a style, a neighbourhood, an address and
  two paragraphs of copy.
- 9 categories, 9 neighbourhoods, 9 styles — every one has at least two cafes, so
  no listing page is empty.
- 4 blog posts.

Card markup carries `data-search`, `data-categories`, `data-themes` and
`data-locations`; the sidebar checkboxes, the three home-page selects and the
search field all filter on those attributes, so filtering works on every list.

## Design tokens

Light: page `#fafafa`, ink `#0f0f11`, body text `#49494f`, muted `#67676e`,
fills `#ececef`/`#e3e3e6`, hairline `#d2d2d6`, control outline `#767681`,
accent `#ffd60a`, placeholder `#dcdce0`.

Dark (tuned, not measured): page `#1c1c20`, ink `#f8f8fa`, body text `#d2d2d9`,
muted `#a5a5ae`, fills `#2b2b31`/`#35353d`, hairline `#46464f`, control outline
`#7e7e8a`, badge `#3a3a43`, placeholder `#31313a`.

The light palette came from measuring the reference design. The dark palette did
not: the reference's dark values left every surface, hairline and placeholder
almost invisible against the page, which is why the surfaces are lifted here and
why the control outlines are a separate token from the hairlines. `color-scheme`
is set per theme so native controls and scrollbars follow.

Typography: display 60/48/32px at 600 with −0.04em tracking; section titles
30px/39px; body copy 18px/27px; card titles 18px/27px at 500; small text 16px.
Radii 4, 6, 10, 12, 24 and 999px.

## Behaviour

- **Theme** — system default, remembered in `localStorage` under
  `findmy815-theme`, toggled from the header; the icon swaps between a moon and
  a sun, and `aria-pressed` tracks the state.
- **Filters** — search, selects and checkboxes combine; the empty state appears
  only when nothing matches; a chip reset clears everything.
- **Load More** — reveals six more cards per click on the home page and on
  `/cafes/`, and hides itself when there is nothing left to reveal.
- **FAQ** — rows expand in place and carry their answer text.
- **Forms** — newsletter, submit and contact prevent submission and print a local
  confirmation; nothing is sent.
- **Mobile** — the menu button opens the nav panel under 810px.

## Deliberate limits

- Photography is not reproduced: all 63 image slots are placeholder blocks at the
  measured aspect ratios.
- Maps are a static panel with an “Open in Maps” link, not a live embed.
- Forms store nothing and send nothing.
- The 810–1199px tablet range uses the compact layout; the reference had a
  separate design at those widths that was never captured.
