// Data layer. Firebase Auth + Firestore with on-phone persistence:
// writes land on the phone instantly and sync to the cloud when there's signal.
// Layout: users/{uid}/positions/{positionId}, users/{uid}/shots/{sha256}

const FB = "https://www.gstatic.com/firebasejs/12.19.0";

export function isConfigured(config) {
  const f = config.firebase || {};
  return Boolean(f.apiKey && f.projectId && f.appId);
}

const clean = (o) => JSON.parse(JSON.stringify(o));

export async function createFirebaseStore(config) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`),
  ]);
  const app = initializeApp(config.firebase);
  const auth = A.getAuth(app);
  let db;
  try {
    db = F.initializeFirestore(app, {
      localCache: F.persistentLocalCache({ tabManager: F.persistentSingleTabManager() }),
    });
  } catch {
    db = F.getFirestore(app);
  }

  let user = null;
  const store = {
    mode: "firebase",
    get user() {
      return user ? { uid: user.uid, email: user.email || "" } : null;
    },
    onAuth(cb) {
      return A.onAuthStateChanged(auth, (u) => {
        user = u;
        cb(store.user);
      });
    },
    signIn: (email, pw) => A.signInWithEmailAndPassword(auth, email, pw),
    signOut: () => A.signOut(auth),
    resetPassword: (email) => A.sendPasswordResetEmail(auth, email),
    idToken: () => (user ? user.getIdToken() : Promise.resolve("")),

    subscribe({ onPositions, onShots, onStatus, onError }) {
      const uid = user.uid;
      const posCol = F.collection(db, "users", uid, "positions");
      const shotCol = F.collection(db, "users", uid, "shots");
      const status = (snap) => {
        if (snap.metadata.hasPendingWrites) onStatus("syncing");
        else if (snap.metadata.fromCache) onStatus(navigator.onLine ? "connecting" : "offline");
        else onStatus("synced");
      };
      const u1 = F.onSnapshot(
        posCol,
        { includeMetadataChanges: true },
        (snap) => {
          onPositions(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
          status(snap);
        },
        (e) => onError && onError(e),
      );
      const u2 = F.onSnapshot(
        shotCol,
        (snap) => {
          const m = {};
          snap.docs.forEach((d) => (m[d.id] = d.data()));
          onShots(m);
        },
        (e) => onError && onError(e),
      );
      return () => {
        u1();
        u2();
      };
    },
    // Writes resolve when the server confirms; the UI updates from the local snapshot right away.
    put: (pos) => F.setDoc(F.doc(db, "users", user.uid, "positions", pos.id), clean(pos)),
    remove: (id) => F.deleteDoc(F.doc(db, "users", user.uid, "positions", id)),
    putShot: (hash, data) => F.setDoc(F.doc(db, "users", user.uid, "shots", hash), clean(data)),
    async putMany(list) {
      for (let i = 0; i < list.length; i += 400) {
        const b = F.writeBatch(db);
        for (const pos of list.slice(i, i + 400)) b.set(F.doc(db, "users", user.uid, "positions", pos.id), clean(pos));
        await b.commit();
      }
    },
  };
  return store;
}

// Sample book for previewing the app before setup. Nothing here is real.
export function createDemoStore(samplePositions) {
  let positions = clean(samplePositions);
  let shots = {};
  let listeners = null;
  const emit = () => {
    if (!listeners) return;
    listeners.onPositions(clean(positions));
    listeners.onShots({ ...shots });
    listeners.onStatus("sample");
  };
  return {
    mode: "demo",
    user: { uid: "sample", email: "sample data" },
    onAuth(cb) {
      setTimeout(() => cb(this.user), 0);
      return () => {};
    },
    signIn: async () => {},
    signOut: async () => location.assign(location.pathname),
    resetPassword: async () => {},
    idToken: async () => "",
    subscribe(l) {
      listeners = l;
      setTimeout(emit, 0);
      return () => (listeners = null);
    },
    put: async (pos) => {
      const i = positions.findIndex((p) => p.id === pos.id);
      if (i >= 0) positions[i] = clean(pos);
      else positions.push(clean(pos));
      emit();
    },
    remove: async (id) => {
      positions = positions.filter((p) => p.id !== id);
      emit();
    },
    putShot: async (hash, data) => {
      shots[hash] = data;
      emit();
    },
    putMany: async (list) => {
      for (const pos of list) {
        const i = positions.findIndex((p) => p.id === pos.id);
        if (i >= 0) positions[i] = clean(pos);
        else positions.push(clean(pos));
      }
      emit();
    },
  };
}
