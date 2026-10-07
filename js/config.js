// Kalshi Killa settings. Fill these in once (see SETUP.md), commit, and the app picks them up.
// None of these values are secrets: the Firebase web config is meant to be public, and the
// Anthropic key lives only in the Cloudflare Worker.

export const config = {
  firebase: {
    apiKey: "AIzaSyBgwZNRTbv1O7u_HhG-ivIIBklboPzdATE",
    authDomain: "kalsi-killa.firebaseapp.com",
    projectId: "kalsi-killa",
    appId: "1:283761330483:web:3639edb85dfdaa51095646",
  },
  // Your Cloudflare Worker address with /parse on the end,
  // e.g. "https://kalshi-killa.yourname.workers.dev/parse"
  parseUrl: "https://kalshi-killa.burnzzzstock.workers.dev/parse",
};
