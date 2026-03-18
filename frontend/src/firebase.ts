// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBNoBGiUbVK7xGpO9U5yGTBU43-4v38kcs",
  authDomain: "cs3219-user-service.firebaseapp.com",
  projectId: "cs3219-user-service",
  storageBucket: "cs3219-user-service.firebasestorage.app",
  messagingSenderId: "505457837569",
  appId: "1:505457837569:web:7e45eb1d2bd81f770e2200",
  measurementId: "G-QBDY1CBGJG"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Initialize Authentication and export it so AuthPage.tsx can use it
export const auth = getAuth(app);