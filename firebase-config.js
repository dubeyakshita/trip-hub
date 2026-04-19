import { initializeApp }    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence }
                             from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider }
                             from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDKlupNZ01zjRVXw5MA59Q7GSql2M3qcJ0",
  authDomain:        "triphub-7d75b.firebaseapp.com",
  projectId:         "triphub-7d75b",
  storageBucket:     "triphub-7d75b.firebasestorage.app",
  messagingSenderId: "647759772326",
  appId:             "1:647759772326:web:940eab9c22cb9676505267"
};

const app      = initializeApp(firebaseConfig);
const db       = getFirestore(app);
const auth     = getAuth(app);
const provider = new GoogleAuthProvider();

enableIndexedDbPersistence(db).catch(() => {});

export { db, auth, provider };
