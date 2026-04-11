[![Review Assignment Due Date](https://classroom.github.com/assets/deadline-readme-button-22041afd0340ce965d47ae6ef1cefeee28c7c493a6346c4f15d667ab976d596c.svg)](https://classroom.github.com/a/HpD0QZBI)
# CS3219 Project (PeerPrep) - AY2526S2
## Group: G18

## Group Members:
- [Lee Jia Quan, Benny](https://github.com/Shamanbenny)
- [Kannan Annamalai](https://github.com/Kannan171)
- [Heng Yee Chong Fabian](https://github.com/FabianHeng)
- [Subramanian Pon Harish](https://github.com/Ponharish)
- [Lee De En](https://github.com/leedeen01)

## Roles and Responsibilities:
- M1: User Management - Heng Yee Chong Fabian
- M2: Peer Matching - Kannan Annamalai
- M3: Question Management - Subramanian Pon Harish
- M4: Collaboration - Lee De En
- M5: UI - Lee Jia Quan, Benny

For more information regarding the Product Backlog, refer to [our documentation here](docs/BACKLOG.md).

---

## Repo File Structure
```
peerprep-g18/
  README.md
  LICENSE
  .github/
    workflows/
      ci.yml  (Continuous Integration via Github Actions)
  docs/
    deployment/
      ...     (AWS deployment guide and plan)
    images/
      ...
    misc/
      ...     (Implementation details and scenarios)
    plantUML/
      ...     (Useful UML Diagrams for the project)
    README.md
    UML.md
    SCHEMA.md
    BACKLOG.md
    API.md
    TESTING_GUIDE.md

  frontend/
    src/
      App.tsx     (handles page routing)
      components/
        ui/
          ...     (individual React elements used across pages)
        ...       (the individual pages)
      contexts/   (React contexts like UserContext)
      utils/      (utility functions like avatar.ts)
      styles/     (global CSS)
      firebase.ts (Firebase client config)
      constants.ts
    README.md

  backend/
    docker-compose.yml
    nginx.conf
    api-gateway/
      main.py
      requirements.txt
      Dockerfile
      firebase-service-account.json   (.gitignore but needed to run locally)
    user-service/
      main.py
      requirements.txt
      Dockerfile
      firebase-service-account.json   (.gitignore but needed to run locally)
      .env                            (.gitignore but needed to run locally)
    question-service/
      app/
        main.py
        database.py
        api/
          routes.py
        models/
          domain.py
      requirements.txt
      Dockerfile
      firebase-questionservice.json   (.gitignore but needed to run locally)
    matching-service/
      app/
        main.py
        worker.py
        routers/
          match.py
        schemas.py
        database.py
      requirements.txt
      Dockerfile
    collaboration-service/
      server.js                       (Yjs editor + chat over Socket.IO)
      package.json
      Dockerfile
    history-service/
      app/
        main.py
        database.py
        api/
          routes.py
        models/
          domain.py
      requirements.txt
      Dockerfile
      firebase-historyservice.json    (.gitignore but needed to run locally)
    ai-service/
      main.py                         (FastAPI — Gemini API wrapper)
      requirements.txt
      Dockerfile
      .env                            (.gitignore but needed to run locally)
```

---

## How to run the project locally (Windows)
### 1. Prerequisites
   - [Docker](https://docs.docker.com/desktop/setup/install/windows-install/): Ensure they are installed and running on your machine.
   ```
   docker --version
   ```
   - [Node.js & npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm): Required for the frontend.
   ```
   node --version
   npm --version
   ```
   - Firebase Service Account: You must have a `firebase-service-account.json` file in both `backend/api-gateway/` and `backend/user-service/`.
   - Firebase Question Service: You must have `firebase-questionservice.json` in `backend/question-service`.
   - Firebase History Service: You must have `firebase-historyservice.json` in `backend/history-service/`.
   - Environment Variables for User Service: Ensure `backend/user-service/.env` contains your `SMTP_EMAIL` and `SMTP_PASSWORD` for verification emails.
   - Environment Variables for AI Service: Ensure `backend/ai-service/.env` contains `GEMINI_API_KEY` by Google's AI Studio.

### 2. Running the Backend Services
  The backend is orchestrated using Docker Compose, which manages the microservices, Redis instances, and an Nginx reverse proxy.

   1. Open a terminal in the project root.
   2. Navigate to the `backend/` directory:
   ```
   cd backend
   ```
   3. Start the services:
   ```
   docker-compose up --build
   ```
   - Nginx will be accessible at http://localhost:80.
   - API Gateway (Internal) handles routing on port `1234`, manages **distributed session initialization** (leader election via Redis `SETNX`), and injects identity headers (`X-User-Id`, `X-User-Role`).
   - User Service manages profile data in Firestore on port `6767` and coordinates with Firebase Auth.
   - Question Service manages question data in Firestore on port `6768`.
   - Matching Service manages **polling-based user matching** on port `6769` using Redis-based queuing (LPUSH/BRPOP).
   - Collaboration Service (Internal) manages real-time code editing (Yjs) and chat over Socket.IO on port `4000`. It directly triggers history saving via the History Service.
   - History Service (Internal) saves per-user session records (code snapshots) to Firestore on port `6770`.
   - AI Service (Internal) provides Gemini-powered assistance on port `6771` (limited to 3 requests per session).
   - Redis Sessions stores session metadata, active session pointers, and WebSocket tickets.
   - Redis Auth stores auth invalidation signals (deleted users, stale claims).
   - Redis Matching manages the matching queue and timeout tracking.

### 3. Running the Frontend
  The frontend is a React application built with Vite.

   1. Open a new terminal in the project root.
   2. Navigate to the frontend/ directory:
   ```
   cd frontend
   ```
   3. Install the required dependencies:
   ```
   npm install
   ```
   4. Start the development server:
   ```
   npm run dev
   ```
   5. Access the application at the URL printed in the terminal (usually http://localhost:5173).

---

### Note:
- You are required to develop individual microservices within separate folders within this repository.
- The teaching team should be given access to the repositories, as we may require viewing the history of the repository in case of any disputes or disagreements. 
