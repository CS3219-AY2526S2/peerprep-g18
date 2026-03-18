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
  docs/
    images/
      ...
    plantUML/
      ...
    README.md
    UML.md
    SCHEMA.md
    BACKLOG.md
    API.md

  frontend/
    src/
      App.tsx     (handles page routing)
      components/
        ui/
          ...     (individual React elements used across pages)
        ...       (the individual pages)
    README.md
    Dockerfile    (TODO...)

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
      ...
    collaboration-service/
      server.js
      Dockerfile
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
   - Environment Variables: Ensure `backend/user-service/.env` contains your `SMTP_EMAIL` and `SMTP_PASSWORD` for verification emails.

### 2. Running the Backend Services
  The backend is orchestrated using Docker Compose, which manages the API Gateway, User Service, Collaboration Service, and an Nginx reverse proxy.

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
   - API Gateway (Internal) handles routing on port `1234` to each micro-services.
   - User Service manages profile data in Firestore on port `6767`.
   - Question Service manages question data in Firestore on port `6768`.
   - Matching Service manages event-based user matching on port `6769`.
   - Collaboration Service (Internal) manages real-time sockets on port `4000`.

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
