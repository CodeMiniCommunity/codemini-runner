# CodeMini preview runner

A tiny static site that runs CodeMini's previews on a **different origin** from the app, so a previewed page cannot
read the app's storage (My Keys vault, GitHub token record, device key) or call its functions. It has no build step,
no server code and no secrets: `shell.html`, `shell.js`, `config.js`, `index.html` and `vercel.json`.

- App: `https://the-code-mini-ide.vercel.app`
- Runner: `https://the-code-mini-runner.vercel.app`

## Deploy (Vercel CLI)

Run these **from inside this `runner/` folder**, not the repo root:

```
cd runner
vercel            # first time: answer the prompts, name the project  the-code-mini-runner
vercel --prod
```

- Framework preset: **Other**. No build command, no output directory (the folder itself is served).
- The project name decides the address. If `the-code-mini-runner` is taken and Vercel gives you another one, change
  `DEFAULT_URL` in `js/viewers/runner-client.js` to match.
- If the app's address is not `the-code-mini-ide.vercel.app`, change it in **both** `config.js` (`allowedParents`) and
  `vercel.json` (`frame-ancestors`). The browser enforces the header; the list is a second check inside the page.
- Deploy the app from the repo root as before. `.vercelignore` keeps `runner/` out of the app deployment.

## Check it works

1. Open `https://the-code-mini-runner.vercel.app/` in a private window. You should see a short sentence, not a Vercel
   login page. (If you see a login page, switch off Deployment Protection for the production domain in the project's
   settings; the runner holds nothing private.)
2. In CodeMini, preview an HTML file. The toolbar shows a green shield; hovering says **Isolated**. An amber warning
   icon means the runner could not be reached and the preview ran in the app's own origin.
3. In the browser console of the app, `CodeMiniRunner.status()` returns `"isolated"`.

## Settings (browser `localStorage`)

| Key | Effect |
| --- | --- |
| `codemini_runner` = `off` | previews run in the app's own origin (not isolated) |
| `codemini_runner_url` | **localhost only**: use a local runner while developing, e.g. `http://localhost:8766` |

## Run it locally

```
npx http-server runner -p 8766        # or any static server
localStorage.setItem('codemini_runner_url', 'http://localhost:8766')   // in the app on http://localhost:8765
```

`config.js` allows the app on `localhost:8765` only when the runner itself is on localhost.

## Known limits

Pop-out is unavailable while isolated. All previews share the runner's origin (see SECURITY.md). The terminal and
notebooks still run inside the app's origin.
