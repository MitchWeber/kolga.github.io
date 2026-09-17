# kolga.github.io

The Kolga download page: it detects the visitor's hardware in the browser and
offers the matching build, behind a password.

## Layout

| Path | What it is |
| --- | --- |
| `src/index.html` | the real page — edit this one |
| `index.html` | generated: the password gate plus the encrypted page |
| `tools/build.mjs` | encrypts `src/index.html` into `index.html` |
| `tools/gate.html` | the gate's markup, styling and unlock script |
| `_config.yml` | keeps `src/`, `tools/` and this file out of the published site |

## Editing the page

```sh
$EDITOR src/index.html
node tools/build.mjs            # prompts for the password
git add src/index.html index.html
```

`node tools/build.mjs` reads the password from `KOLGA_SITE_PASSWORD`, from
`--password=…`, from a pipe, or from a hidden prompt, and never writes it to
disk. It is a no-op when the published page already holds exactly the current
source, so rebuilding does not churn the file. Changing the password is the same
command with a different password.

Lost `src/index.html`? `node tools/build.mjs --unlock` decrypts the published
page back into it.

**Rebuild before every deploy.** Editing `src/index.html` alone changes nothing
that visitors see — `index.html` is the only copy the site serves.

## How the gate works

`index.html` carries the page as AES-256-GCM ciphertext. The key comes from the
password through PBKDF2-HMAC-SHA256 at 310,000 iterations; the browser derives
it with WebCrypto, decrypts in place and replaces the document. GCM authenticates
as it decrypts, so a wrong password simply fails — there is no password hash
sitting in the file to attack separately. The password is held in `sessionStorage`
so a reload within the same tab does not ask again, and it never leaves the
browser.

### What it does and does not protect

- **It does** keep the page's content away from anyone who opens the site
  without the password. The plaintext is not in the served file.
- **It does not** hide anything from someone reading this repository: it is
  public, so `src/index.html` and the pre-gate git history are both readable on
  GitHub. Making the content genuinely private means making the repository
  private, which needs a paid plan for Pages to keep serving it.
- **It does not** cover the other files the site serves. `robots.txt` and the
  release feeds below stay public.
- The gate needs a secure context, which GitHub Pages provides. Over plain
  `http://` (other than `localhost`) WebCrypto is unavailable and the page says so.
- The password protects an encrypted file that anyone can download, so its
  strength is the whole of the security. Use a long random one.

`_config.yml` is what keeps the plaintext `src/index.html` from being published
alongside the gate; it works because GitHub Pages builds this site with Jekyll.
**If the site is ever switched to an Actions-based Pages workflow, that exclude
stops applying** and the workflow has to skip `src/` and `tools/` itself.

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
