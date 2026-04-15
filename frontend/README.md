# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Setup Documentation (Windows)

> This section of the README.md is a temporary documentation on the setup process used by Benny, via a Window machine. Feel free to ignore this section.

1. From the project's root directory (`peerprep-g18/`), run the following command:
`npx create-vite frontend --template react-ts; cd frontend; npm install --silent`

2. Select the follow options:
```
│
◇  Use Vite 8 beta (Experimental)?:
│  No
│
◇  Install with npm and start now?
│  Yes
│
```

3. Dependencies installed:
```
npm install lucide-react
npm install -D tailwindcss@3 postcss autoprefixer
npx tailwindcss init -p
```

## Running the frontend

### Prerequisites
- Node.js + npm installed

### Steps

1) Open a terminal at the project's root directory (`peerprep-g18/`) and navigate into `frontend/`.
2) Install dependencies (only needed the first time, or after pulling changes).
`npm install`
3) Start the dev server and access the URL printed in the terminal for local view.
`npm run dev`

### Optional (useful commands):
- npm run build (creates a production build in `dist/`).
- npm run preview (serves the built `dist/` locally for a quick check; not a production server).

## Design & UI Credits

This frontend’s UI layout and styling were derived from a Figma Make design file (used as a reference during implementation).

> Note that the use of Figma Make is **solely** to help with the UI design component, but the major bulk of the application's interaction with the backend is created under seperate workflow.

### Figma source
- **Design Reference Used:** [Bill Splitter Mobile App UI UX Design](https://www.behance.net/gallery/126981033/Bill-Splitter-Mobile-App-UI-UX-Design#)
- **Link:** [Figma Make link](https://www.figma.com/make/HeUvwSyEBHtYqdFQi6u4it/UI-Design-Analysis-for-PeerPrep?t=r06AvxC1qhZ9Yjg8-20&fullscreen=1)
- **Author/Creator:** Lee Jia Quan, Benny
- **Changes:** Implemented in React + TypeScript with Tailwind CSS; adapted components, spacing, and colors where needed.

### Third-party components/assets
- Some UI components in the design reference shadcn/ui (MIT License): https://ui.shadcn.com/ and https://github.com/shadcn-ui/ui/blob/main/LICENSE.md
- Photos referenced in the design are from Unsplash (Unsplash License; attribution not required but appreciated): https://unsplash.com/license
- Avatars used as profile pictures are from Avataaars (Free for personal and commercial use): https://avataaars.com/

---

## Current Application State (April 2026)

The PeerPrep frontend is fully implemented as a high-fidelity React (TypeScript) application, following a **"Cyber-Purple"** aesthetic with dark mode and neon highlights.

### Core Features
- **Dynamic Auth:** Seamless integration with Firebase Auth (OAuth and Email/Password).
- **Matchmaking Dashboard:** Interactive selection of topic and difficulty with a 60-second polling-based match timer.
- **Advanced Collaboration:** 
  - Real-time shared editor powered by **Yjs** (CRDT) for conflict-free synchronization.
  - Integrated chat system with instant messaging.
  - **AI Assistant:** @gemini bot integrated into chat for real-time problem-solving support.
- **Admin Suite:** Full management of the question bank and user roles (Admin/Root).
- **History Portal:** Detailed per-user records of past collaborative sessions, including code snapshots.

### Tech Stack & Architecture
- **Framework:** React 19 + Vite.
- **Styling:** TailwindCSS v3 for responsive, theme-consistent layouts.
- **Real-time:** Socket.IO client for editor/chat synchronization.
- **Auth Proxying:** All sensitive requests are routed through the API Gateway, which injects identity headers (`X-User-Id`).
- **State Management:** UserContext for global authentication and profile state.
