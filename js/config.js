// Kalshi Killa settings. Fill these in once (see SETUP.md), commit, and the app picks them up.
// None of these values are secrets: the Firebase web config is meant to be public, and the
// Anthropic key lives only in the Cloudflare Worker.

export const config = {
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    appId: "",
  },
  // Your Cloudflare Worker address with /parse on the end,
  // e.g. "https://kalshi-killa.yourname.workers.dev/parse"
  parseUrl: "",
};
