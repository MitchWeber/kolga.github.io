# kolga.github.io

The Kolga download page. One static file, `index.html`, with no build step: it
detects the visitor's hardware in the browser and offers the matching build.

## Where the version comes from

Nothing about a release is hard-coded. On load the page reads electron-builder's
update feeds from this repository, beside `index.html`:

| Feed | Platform |
| --- | --- |
| `latest-mac.yml` | macOS |
| `latest.yml` | Windows |
| `latest-linux.yml`, `latest-linux-arm64.yml` | Linux |

Each feed names the version, the artifacts and their sizes, and the page builds
its download list from exactly that — so cutting a release means copying the new
feeds into this repository, and nothing else.

**The feeds have to be served from this origin.** `github.com` sends no
`Access-Control-Allow-Origin` header on release downloads, so the page cannot
read a feed straight out of a GitHub release, whether the repository is public
or private. The release job has to copy them here.

A platform with no feed is reported as having no build in the current release,
rather than being offered a link that 404s. If no feed can be read at all, the
page falls back to the artifact names in `FALLBACK_FILES` near the top of the
script — keep those in step with the last release.

## Download links

`RELEASE.downloadBase` points at the release assets; `{version}` in it is filled
in per platform, because macOS and Windows do not always ship from the same
release. Those links only resolve for visitors who can see the repository, so
the app repository has to be public for the page to work for the public.
